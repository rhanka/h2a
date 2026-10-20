import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import {
  NativeTerminalRequestTimeoutError,
  type NativeTerminalClient,
} from "./client.js";
import {
  NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
} from "./protocol.js";
import { runAttach, sessionExitCrashEntry, type NativeTerminalAttachRuntime } from "./op.js";
import { readCrashLog, resolveCrashLogPath } from "../crash-log.js";
import { TerminalModeTracker } from "./terminal-modes.js";
import { NATIVE_TERMINAL_RESET_MARKER } from "./reset-relay.js";

class FakeInput extends EventEmitter {
  readonly isTTY = false;
  readonly resume = vi.fn();
  readonly pause = vi.fn();
  readonly setRawMode = vi.fn();
}

class FakeOutput {
  readonly columns = 120;
  readonly rows = 40;
  readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
}

type AttachClient = Pick<
  NativeTerminalClient,
  | "readOutput"
  | "state"
  | "acquireController"
  | "releaseController"
  | "write"
  | "resize"
  | "close"
>;

function running(controlled = false): NativeTerminalSessionState {
  return {
    id: "h2a-alpha",
    pid: 4242,
    status: "running",
    exit: null,
    generation: "generation-1",
    incarnation: 1,
    controllerEpoch: controlled ? 1 : 0,
    controlled,
  };
}

function exited(): NativeTerminalSessionState {
  return {
    ...running(false),
    status: "exited",
    exit: { exitCode: 0 },
  };
}

function replay(seq: number, data: string): NativeTerminalReplay {
  return {
    id: "h2a-alpha",
    earliestSeq: seq,
    latestSeq: seq,
    truncated: false,
    chunks: [{ seq, data }],
  };
}

describe("native terminal attach recovery", () => {
  it("should consume wrapper reset requests even when attached to an older verbatim host", async () => {
    const stdout = new FakeOutput();
    let now = 0;
    let seq = 0;
    const chunks = ["\x1b[?1004h", NATIVE_TERMINAL_RESET_MARKER.slice(0, 5),
      NATIVE_TERMINAL_RESET_MARKER.slice(5) + "prompt"];
    const lease = { role: "controller", id: "h2a-alpha", generation: "g", incarnation: "i", controllerId: "test", epoch: 1 } as const;
    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() { const data = chunks[seq++] ?? ""; return replay(seq, data); },
      async state() { return now >= 1000 ? exited() : running(); },
      async write() {}, async resize() {}, close() {},
    };
    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: new FakeInput() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize() {}, offResize() {},
    });
    expect(stdout.chunks.join("")).toBe("\x1b[?1004h\x1b[?1004lprompt");
  });
  it("paces sustained output instead of spinning local read-output RPCs", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    let now = 0;
    let reads = 0;
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "paced-controller",
      epoch: 1,
    };
    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        reads += 1;
        return replay(reads, `chunk-${reads}`);
      },
      async state() { return now >= 1_000 ? exited() : running(true); },
      async write() {},
      async resize() {},
      close() {},
    };
    const runtime: NativeTerminalAttachRuntime = {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: () => {},
      offResize: () => {},
    };

    await expect(runAttach("h2a-alpha", runtime)).resolves.toBe(0);

    // At 100ms per non-empty replay, one second of sustained output is bounded
    // to ten read RPCs plus the periodic state check, rather than a tight spin.
    expect(reads).toBe(10);
    expect(now).toBe(1_000);
  });

  it.each([
    [
      "read timeout",
      () =>
        new NativeTerminalRequestTimeoutError(
          "read-output",
          NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
        ),
    ],
    ["socket close", () => new Error("terminal host connection closed")],
  ])(
    "reconnects after %s without killing the PTY or overlapping controllers",
    async (_label, failure) => {
      const stdin = new FakeInput();
      const stdout = new FakeOutput();
      let now = 0;
      let connections = 0;
      let controllers = 0;
      let maxControllers = 0;
      let rejectFirstWrite: ((error: Error) => void) | undefined;
      const reads: Array<{ connection: number; afterSeq: number; timeoutMs?: number }> = [];
      const writes: Array<{ connection: number; data: string }> = [];

      const connect = async (): Promise<AttachClient> => {
        connections += 1;
        const connection = connections;
        let closed = false;
        let leased = false;
        let readCount = 0;
        let stateCount = 0;
        const lease: NativeTerminalControllerLease = {
          role: "controller",
          id: "h2a-alpha",
          generation: "generation-1",
          incarnation: 1,
          controllerId: `controller-${connection}`,
          epoch: connection,
        };

        return {
          async acquireController() {
            expect(controllers).toBe(0);
            leased = true;
            controllers += 1;
            maxControllers = Math.max(maxControllers, controllers);
            if (connection === 2) {
              // Keystrokes received while the new controller is being acquired
              // must be held and delivered after recovery, never dropped.
              stdin.emit("data", Buffer.from("continued-input"));
            }
            return lease;
          },
          async releaseController() {
            if (leased) {
              leased = false;
              controllers -= 1;
            }
            return { controlled: false, controllerEpoch: connection };
          },
          async readOutput(_id, afterSeq, timeoutMs) {
            readCount += 1;
            reads.push({ connection, afterSeq, timeoutMs });
            if (connection === 1 && readCount === 1) {
              queueMicrotask(() => stdin.emit("data", Buffer.from("uncertain-input")));
              return replay(1, "\x1b[?1004h\x1b[>1ufirst-output");
            }
            if (connection === 1) throw failure();
            if (readCount === 1) {
              // Settle the old socket's in-flight write only after connection 2
              // owns the controller. Its stale failure must not close the new
              // connection or replay the ambiguous chunk.
              rejectFirstWrite?.(new Error("old socket write response lost"));
              await Promise.resolve();
              return replay(2, "second-output");
            }
            return {
              id: "h2a-alpha",
              earliestSeq: 2,
              latestSeq: 2,
              truncated: false,
              chunks: [],
            };
          },
          async state() {
            stateCount += 1;
            // First state read validates the newly-connected session. The
            // periodic state read ends the deterministic scenario.
            return connection === 2 && stateCount > 1 ? exited() : running(leased);
          },
          write(_lease, data) {
            writes.push({ connection, data });
            if (connection === 1) {
              return new Promise<void>((_resolve, reject) => {
                rejectFirstWrite = reject;
              });
            }
            return Promise.resolve();
          },
          async resize() {},
          close() {
            if (closed) return;
            closed = true;
            if (leased) {
              leased = false;
              controllers -= 1;
            }
          },
        } as AttachClient;
      };

      const runtime: NativeTerminalAttachRuntime = {
        connect,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        now: () => now,
        delay: async (ms) => {
          now += ms;
        },
        onResize: () => {},
        offResize: () => {},
      };

      await expect(runAttach("h2a-alpha", runtime)).resolves.toBe(0);

      expect(connections).toBe(2);
      expect(maxControllers).toBe(1);
      expect(controllers).toBe(0);
      expect(reads[0]).toEqual({
        connection: 1,
        afterSeq: 0,
        timeoutMs: NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
      });
      expect(reads.find((read) => read.connection === 2)).toMatchObject({
        afterSeq: 1,
        timeoutMs: NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
      });
      expect(writes).toContainEqual({ connection: 1, data: "uncertain-input" });
      expect(writes).toContainEqual({ connection: 2, data: "continued-input" });
      expect(stdout.chunks.join("")).toContain("first-output");
      expect(stdout.chunks.join("")).toContain("second-output");
      expect(stdout.chunks.join("")).toMatch(/reconnecting/i);
      expect(stdout.chunks.join("")).toMatch(/reconnected/i);
      expect(stdout.chunks.join("")).toMatch(/input delivery became uncertain/i);
      const reset = "\x1b[<1u\x1b[?1004l";
      const output = stdout.chunks.join("");
      expect(output.split(reset)).toHaveLength(3); // transport loss + final exit
      expect(output).toContain("reconnected\r\n\x1b[>1u\x1b[?1004h");
      expect(output.endsWith(reset)).toBe(true);
      const terminal = new TerminalModeTracker();
      terminal.feed(output);
      expect(terminal.resetSequence()).toBe("");
      // At idle, the adaptive delay keeps this scenario to a handful of RPCs,
      // rather than the old read+state every 40ms (~50 RPC/s).
      expect(reads.filter((read) => read.connection === 2).length).toBeLessThan(8);
    },
  );
});

describe("lot L4-hint RED: survivor hints after the PTY ends", () => {
  const RECREATION = "h2a run 'claude' '/home/u/my dir' --name 'a' -r 'c'";
  const ATTACH = "h2a attach a";

  function hintClient(exitAt: number, now: () => number): AttachClient {
    const lease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "hint-controller",
      epoch: 1,
    } as const;
    return {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() { return replay(0, ""); },
      async state() { return now() >= exitAt ? exited() : running(true); },
      async write() {}, async resize() {}, close() {},
    };
  }

  function hintRuntime(
    stdin: FakeInput,
    stdout: FakeOutput,
    now: () => number,
    advance: (ms: number) => void,
    exitAt: number,
  ): NativeTerminalAttachRuntime {
    return {
      connect: async () => hintClient(exitAt, now),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now,
      delay: async (ms) => { advance(ms); },
      onResize: () => {},
      offResize: () => {},
    };
  }

  it("should print the h2a run recreation line only after the PTY itself ends (second Ctrl-D)", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    let now = 0;
    await runAttach("h2a-alpha", hintRuntime(stdin, stdout, () => now, (ms) => { now += ms; }, 500), {
      sessionEndHint: { recreation: RECREATION, attach: ATTACH },
    });
    const out = stdout.chunks.join("");
    expect(out).toContain(RECREATION);
    expect(out).not.toContain(ATTACH);
  });

  it("should print h2a attach, not a recreation command, on detach", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    let now = 0;
    const promise = runAttach("h2a-alpha", hintRuntime(stdin, stdout, () => now, (ms) => { now += ms; }, Number.POSITIVE_INFINITY), {
      sessionEndHint: { recreation: RECREATION, attach: ATTACH },
    });
    stdin.emit("data", Buffer.from([0x1c])); // Ctrl-\
    await promise;
    const out = stdout.chunks.join("");
    expect(out).toContain(ATTACH);
    expect(out).not.toContain("h2a run");
  });
});

describe("session exit crash records (revcrashlog constat 2)", () => {
  let root = "";
  let previousStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-sessionexit-"));
    previousStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(root, "state");
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previousStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  function attachRows() {
    return readCrashLog("attach", resolveCrashLogPath("attach", { XDG_STATE_HOME: join(root, "state") }));
  }

  it("maps a natural exit to its real code with no signal", () => {
    const entry = sessionExitCrashEntry(
      { exit: { exitCode: 3 }, stopSignal: null },
      { sessionId: "h2a-x" },
    );
    expect(entry).toMatchObject({ event: "sessionExit", sessionId: "h2a-x", exitCode: 3 });
    expect("signal" in entry).toBe(false);
  });

  it("maps a killed session to its code and its stop signal", () => {
    const entry = sessionExitCrashEntry(
      { exit: { exitCode: 137, signal: 9 }, stopSignal: "SIGKILL" },
      { sessionId: "h2a-x" },
    );
    expect(entry).toMatchObject({ event: "sessionExit", exitCode: 137, signal: "SIGKILL" });
  });

  it("omits the code (never invents 0) when a stopped session reports none", () => {
    const entry = sessionExitCrashEntry(
      { exit: null, stopSignal: "SIGTERM" },
      { sessionId: "h2a-x" },
    );
    expect(entry).toMatchObject({ event: "sessionExit", signal: "SIGTERM" });
    expect("exitCode" in entry).toBe(false);
  });

  it("names a numeric pty signal on a natural signal exit", () => {
    const entry = sessionExitCrashEntry(
      { exit: { exitCode: 0, signal: 15 }, stopSignal: null },
      { sessionId: "h2a-x" },
    );
    expect(entry).toMatchObject({ event: "sessionExit", exitCode: 0, signal: "SIGTERM" });
  });

  it("logs an already-exited session with its real code and signal", async () => {
    const stopped = {
      ...running(false),
      status: "exited",
      stopSignal: "SIGKILL",
      exit: { exitCode: 137, signal: 9 },
    } as NativeTerminalSessionState;
    const client = {
      async state() { return stopped; },
      async acquireController() { throw new Error("must not acquire an exited session"); },
      async releaseController() {},
      async readOutput() { throw new Error("must not read an exited session"); },
      async write() {}, async resize() {}, close() {},
    };
    const code = await runAttach("h2a-alpha", {
      connect: async () => client as never,
      stdin: new FakeInput() as unknown as NodeJS.ReadStream,
      stdout: new FakeOutput() as unknown as NodeJS.WriteStream,
      now: () => 0,
      delay: async () => {},
      onResize: () => {},
      offResize: () => {},
    });
    expect(code).toBe(137);
    const rows = attachRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "sessionExit", sessionId: "h2a-alpha", exitCode: 137, signal: "SIGKILL" });
  });

  it("logs a definitive absence with no invented exit code", async () => {
    const { NativeTerminalRemoteError } = await import("./protocol.js");
    const missing = new NativeTerminalRemoteError({ code: "operation-failed", message: "unknown terminal session h2a-gone" });
    const client = {
      async state(): Promise<NativeTerminalSessionState> { throw missing; },
      async acquireController() { throw missing; },
      async releaseController() {},
      async readOutput(): Promise<never> { throw missing; },
      async write() {}, async resize() {}, close() {},
    };
    const stdout = new FakeOutput();
    const code = await runAttach("h2a-gone", {
      connect: async () => client as never,
      stdin: new FakeInput() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => 0,
      delay: async () => {},
      onResize: () => {},
      offResize: () => {},
    });
    expect(code).toBe(1);
    const rows = attachRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "sessionExit", sessionId: "h2a-gone", reason: "definitive-absence" });
    expect("exitCode" in rows[0]!).toBe(false);
  });
});
