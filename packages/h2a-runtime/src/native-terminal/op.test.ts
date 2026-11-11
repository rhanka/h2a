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
  let root = "";
  let previousStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-attach-recovery-"));
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
      const reset = "\x1b[<1u\x1b[?1004l";
      const output = stdout.chunks.join("");
      expect(output).not.toMatch(/\[h2a\]|reconnecting|reconnected|input delivery became uncertain/i);
      expect(output).toBe(`\x1b[?1004h\x1b[>1ufirst-outputsecond-output${reset}`);
      expect(output.split(reset)).toHaveLength(2); // final exit only; no mode reset/resume on fast reconnect
      expect(output.endsWith(reset)).toBe(true);
      const terminal = new TerminalModeTracker();
      terminal.feed(output);
      expect(terminal.resetSequence()).toBe("");
      const rows = attachRows();
      expect(rows).toContainEqual(
        expect.objectContaining({
          event: "reconnect",
          sessionId: "h2a-alpha",
          durationMs: expect.any(Number),
          detail: expect.stringMatching(/\d+ms/),
        }),
      );
      expect(rows).toContainEqual(
        expect.objectContaining({
          event: "refusal",
          sessionId: "h2a-alpha",
          reason: "input-delivery-uncertain",
        }),
      );
      // At idle, the adaptive delay keeps this scenario to a handful of RPCs,
      // rather than the old read+state every 40ms (~50 RPC/s).
      expect(reads.filter((read) => read.connection === 2).length).toBeLessThan(8);
    },
  );

  it("keeps the socket alive and stdout clean when the host stalls 6s on state while readOutput is healthy", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    let now = 0;
    let connections = 0;
    let closeCalls = 0;
    let readCount = 0;
    let stateCalls = 0;
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1 as unknown as string,
      controllerId: "stall-controller",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() {
        return lease;
      },
      async releaseController() {
        return { id: "h2a-alpha", generation: "generation-1", incarnation: 1 as unknown as string, controllerEpoch: 1 };
      },
      async readOutput() {
        readCount += 1;
        if (readCount === 1) {
          // Simulate output before the stall; advance past the 1s state poll window.
          now += 900;
          return replay(1, "\x1b[?1004hbefore-stall");
        }
        if (readCount === 2) {
          return replay(2, "-after-6s-stall");
        }
        now += 2_000;
        return {
          ...replay(2, ""),
          chunks: [],
        };
      },
      async state() {
        stateCalls += 1;
        if (stateCalls === 1) {
          return running(true);
        }
        if (stateCalls === 2) {
          // Single-threaded host stalls 6s (> 5s RPC timeout) during state probe.
          now += 6_000;
          throw new NativeTerminalRequestTimeoutError("state", 5_000);
        }
        if (stateCalls === 3) {
          return running(true);
        }
        return exited();
      },
      async write() {},
      async resize() {},
      close() {
        closeCalls += 1;
      },
    };

    const runtime: NativeTerminalAttachRuntime = {
      connect: async () => {
        connections += 1;
        return client;
      },
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

    expect(connections).toBe(1);
    expect(closeCalls).toBe(1); // closed only in finally on session exit
    expect(stdout.chunks.join("")).toBe("\x1b[?1004hbefore-stall-after-6s-stall\x1b[?1004l");
    expect(stdout.chunks.join("")).not.toMatch(/\[h2a\]|interrupted|reconnected/i);
    expect(attachRows().filter((row) => row.event === "reconnect")).toHaveLength(0);
  });

  it("uses state merged into readOutput and survives a 6s host stall without polling state separately", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    let now = 0;
    let connections = 0;
    let stateCalls = 0;
    let readCount = 0;
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1 as unknown as string,
      controllerId: "merged-state-controller",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() {
        return lease;
      },
      async releaseController() {
        return { id: "h2a-alpha", generation: "generation-1", incarnation: "incarnation-1", controllerEpoch: 1 };
      },
      async readOutput() {
        readCount += 1;
        if (readCount === 1) {
          // Host stalls 6s (< 30s interactive read timeout) while serving readOutput.
          now += 6_000;
          return {
            ...replay(1, "\x1b[?1004hlive-across-6s-stall"),
            state: running(true),
          };
        }
        return {
          ...replay(1, ""),
          chunks: [],
          state: exited(),
        };
      },
      async state() {
        stateCalls += 1;
        if (stateCalls === 2) {
          throw new NativeTerminalRequestTimeoutError("state", 5_000);
        }
        return stateCalls >= 3 ? exited() : running(false);
      },
      async write() {},
      async resize() {},
      close() {},
    };

    const runtime: NativeTerminalAttachRuntime = {
      connect: async () => {
        connections += 1;
        return client;
      },
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

    expect(connections).toBe(1);
    expect(stateCalls).toBe(1); // initial connectAndAcquire only
    expect(stdout.chunks.join("")).toBe("\x1b[?1004hlive-across-6s-stall\x1b[?1004l");
  });

  it("reconnects and fails as today on a truly dead host, silently on stdout and logged in attach.log", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    let now = 0;
    let connections = 0;
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: "incarnation-1",
      controllerId: "dead-host-controller",
      epoch: 1,
    };

    const runtime: NativeTerminalAttachRuntime = {
      connect: async () => {
        connections += 1;
        if (connections === 2) {
          now += 150;
          throw new Error("socket not ready yet");
        }
        if (connections >= 3) {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        }
        let readCount = 0;
        return {
          async acquireController() {
            return lease;
          },
          async releaseController() {
            return { id: "h2a-alpha", generation: "generation-1", incarnation: "incarnation-1", controllerEpoch: 1 };
          },
          async readOutput() {
            readCount += 1;
            if (readCount === 1) {
              return replay(1, "\x1b[?1004houtput-before-crash");
            }
            throw new Error("terminal host connection closed");
          },
          async state() {
            return running(true);
          },
          async write() {},
          async resize() {},
          close() {},
        };
      },
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => {
        now += ms;
      },
      onResize: () => {},
      offResize: () => {},
    };

    await expect(runAttach("h2a-alpha", runtime)).resolves.toBe(1);

    expect(connections).toBe(3);
    expect(stdout.chunks.join("")).toBe("\x1b[?1004houtput-before-crash\x1b[?1004l");
    expect(stdout.chunks.join("")).not.toMatch(/\[h2a\]|interrupted|reconnected|no longer available/i);
    const rows = attachRows();
    expect(rows).toContainEqual(
      expect.objectContaining({
        event: "sessionExit",
        sessionId: "h2a-alpha",
        reason: "definitive-absence",
        durationMs: 250,
        detail: expect.stringMatching(/250ms/),
      }),
    );
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
