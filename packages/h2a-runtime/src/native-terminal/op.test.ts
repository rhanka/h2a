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

describe("native attach status bar (cran 2)", () => {
  let root = "";
  let previousStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-statusbar-"));
    previousStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(root, "state");
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previousStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  class FakeTtyOutput extends FakeOutput {
    isTTY = true;
  }

  async function inspectScreen(raw: string, cols: number, rows: number) {
    const { default: xterm } = await import("@xterm/headless");
    const terminal = new xterm.Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
    try {
      await new Promise<void>((resolve) => terminal.write(raw, resolve));
      const buffer = terminal.buffer.active;
      const lines: string[] = [];
      for (let r = 0; r < rows; r++) {
        lines.push(buffer.getLine(buffer.viewportY + r)?.translateToString(false) ?? "");
      }
      const lastLine = buffer.getLine(buffer.viewportY + rows - 1);
      const cell0 = lastLine?.getCell(0);
      const bgRgb = cell0?.isBgRGB() ? cell0.getBgColor() : undefined;
      const bgPalette = cell0?.isBgPalette() ? cell0.getBgColor() : undefined;
      return {
        lines,
        cursorRow: buffer.cursorY + 1,
        cursorCol: buffer.cursorX + 1,
        bgRgb,
        bgPalette,
      };
    } finally {
      terminal.dispose();
    }
  }

  it("sets DECSTBM 1..N-1, resizes child PTY to N-1 rows, draws amber bar on row N, and restores full screen on exit", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 120;
    stdout.rows = 40;
    let now = 0;
    let readCount = 0;
    const resizes: Array<{ cols: number; rows: number }> = [];
    const childWrites: string[] = [];
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "g-1",
      incarnation: 1,
      controllerId: "ctrl-1",
      epoch: 1,
    };

    const registryPath = join(root, "registry.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "alpha",
            label: "alpha",
            tmuxSession: "h2a-alpha",
            tool: "claude",
            kind: "local-native",
            cwd: root,
            source: "run",
            sessionClass: "human",
            gatewayMode: "direct",
            gatewayProvenance: "explicit",
            enrolledAt: "2026-11-11T10:00:00.000Z",
            lastSeenAt: "2026-11-11T10:00:00.000Z",
          },
        ],
      }),
    );
    const h2aRoot = join(root, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });

    let streamBeforeExit = "";
    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        readCount += 1;
        if (readCount === 1) return replay(1, "hello from child\r\n");
        if (readCount === 2) {
          streamBeforeExit = stdout.chunks.join("");
          stdin.emit("data", Buffer.from([0x1c])); // detach
        }
        return replay(1, "");
      },
      async state() { return running(true); },
      async write(_l, data) { childWrites.push(data); },
      async resize(_l, cols, rows) { resizes.push({ cols, rows }); },
      close() {},
    };

    const code = await runAttach(
      "h2a-alpha",
      {
        connect: async () => client,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        now: () => now,
        delay: async (ms) => { now += ms; },
        onResize: () => {},
        offResize: () => {},
      },
      {
        statusBar: {
          registryPath,
          h2aRoot,
        },
      },
    );

    expect(code).toBe(0);
    expect(resizes[0]).toEqual({ cols: 120, rows: 39 });
    expect(childWrites).toEqual([]);
    expect(streamBeforeExit).toContain("\x1b[1;39r");
    expect(streamBeforeExit).toContain("\x1b[40;1H");

    const activeScreen = await inspectScreen(streamBeforeExit, 120, 40);
    expect(activeScreen.lines[0]?.trimEnd()).toBe("hello from child");
    expect(activeScreen.lines[39]).toContain("claude · h2a-alpha · attached");
    expect(activeScreen.lines[39]).toContain("gw off");
    expect(activeScreen.bgRgb).toBe(0x7c2d12);

    const fullOutput = stdout.chunks.join("");
    // On detach/exit, scroll region is reset (\x1b[r) and row 40 is cleared (\x1b[40;1H\x1b[2K).
    expect(fullOutput).toContain("\x1b[r\x1b[40;1H\x1b[2K");
  });

  it("handles SIGWINCH resize (recomputes DECSTBM, resizes child PTY to N-1, auto-offs under 10 rows)", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 100;
    stdout.rows = 30;
    let now = 0;
    let readCount = 0;
    let resizeHandler: (() => void) | undefined;
    const resizes: Array<{ cols: number; rows: number }> = [];
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "g-1",
      incarnation: 1,
      controllerId: "ctrl-1",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        readCount += 1;
        if (readCount === 1) {
          stdout.columns = 90;
          stdout.rows = 20;
          resizeHandler?.();
          return replay(1, "step-1\r\n");
        }
        if (readCount === 2) {
          // Shrink below 10 rows -> status bar auto-offs and gives all 8 rows to child PTY
          stdout.columns = 90;
          stdout.rows = 8;
          resizeHandler?.();
          return replay(2, "step-2\r\n");
        }
        if (readCount === 3) {
          // Grow back to 15 rows -> status bar re-activates and gives 14 rows to child PTY
          stdout.columns = 90;
          stdout.rows = 15;
          resizeHandler?.();
          stdin.emit("data", Buffer.from([0x1c]));
        }
        return replay(2, "");
      },
      async state() { return running(true); },
      async write() {},
      async resize(_l, cols, rows) { resizes.push({ cols, rows }); },
      close() {},
    };

    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: (fn) => { resizeHandler = fn; },
      offResize: () => { resizeHandler = undefined; },
    });

    expect(resizes).toEqual([
      { cols: 100, rows: 29 },
      { cols: 90, rows: 19 },
      { cols: 90, rows: 8 },
      { cols: 90, rows: 14 },
    ]);
    const out = stdout.chunks.join("");
    expect(out).toContain("\x1b[1;29r");
    expect(out).toContain("\x1b[1;19r");
    expect(out).toContain("\x1b[1;14r");
  });

  it("respects disable flags (env, config, <10 rows, and non-TTY)", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "g-1",
      incarnation: 1,
      controllerId: "ctrl-1",
      epoch: 1,
    };

    const runScenario = async (opts: {
      env?: Record<string, string>;
      configDisabled?: boolean;
      rows?: number;
      tty?: boolean;
    }) => {
      const stdin = new FakeInput();
      const stdout = opts.tty === false ? new FakeOutput() : new FakeTtyOutput();
      stdout.columns = 100;
      stdout.rows = opts.rows ?? 30;
      const resizes: Array<{ cols: number; rows: number }> = [];
      let reads = 0;
      const configHome = join(root, `cfg-${Math.random().toString(36).slice(2)}`);
      if (opts.configDisabled) {
        mkdirSync(join(configHome, ".config", "sentropic", "h2a"), { recursive: true });
        writeFileSync(
          join(configHome, ".config", "sentropic", "h2a", "config.json"),
          JSON.stringify({ statusBar: { enabled: false } }),
        );
      }
      const prevConfigHome = process.env["REMOTE_CLI_CONFIG_HOME"];
      process.env["REMOTE_CLI_CONFIG_HOME"] = configHome;
      try {
        const client: AttachClient = {
          async acquireController() { return lease; },
          async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
          async readOutput() {
            reads += 1;
            if (reads === 1) stdin.emit("data", Buffer.from([0x1c]));
            return replay(1, "plain-output");
          },
          async state() { return running(true); },
          async write() {},
          async resize(_l, cols, rows) { resizes.push({ cols, rows }); },
          close() {},
        };
        await runAttach(
          "h2a-alpha",
          {
            connect: async () => client,
            stdin: stdin as unknown as NodeJS.ReadStream,
            stdout: stdout as unknown as NodeJS.WriteStream,
            now: () => 0,
            delay: async () => {},
            onResize: () => {},
            offResize: () => {},
          },
          {
            statusBar: {
              ...(opts.env ? { env: opts.env } : {}),
            },
          },
        );
        return { resizes, output: stdout.chunks.join("") };
      } finally {
        if (prevConfigHome === undefined) delete process.env["REMOTE_CLI_CONFIG_HOME"];
        else process.env["REMOTE_CLI_CONFIG_HOME"] = prevConfigHome;
      }
    };

    const enabledDefault = await runScenario({});
    expect(enabledDefault.resizes[0]).toEqual({ cols: 100, rows: 29 });
    expect(enabledDefault.output).toContain("\x1b[1;29r");

    const byEnv = await runScenario({ env: { H2A_STATUS_BAR: "0" } });
    expect(byEnv.resizes[0]).toEqual({ cols: 100, rows: 30 });
    expect(byEnv.output).not.toContain("\x1b[1;29r");

    const byConfig = await runScenario({ configDisabled: true });
    expect(byConfig.resizes[0]).toEqual({ cols: 100, rows: 30 });
    expect(byConfig.output).not.toContain("\x1b[1;29r");

    const byShortRows = await runScenario({ rows: 9 });
    expect(byShortRows.resizes[0]).toEqual({ cols: 100, rows: 9 });
    expect(byShortRows.output).not.toContain("\x1b[1;8r");

    const byNonTty = await runScenario({ tty: false });
    expect(byNonTty.resizes[0]).toEqual({ cols: 100, rows: 30 });
    expect(byNonTty.output).not.toContain("\x1b[1;29r");
  });

  it("populates fields from real fixtures (registry, presence/inbox/loops, gateway receipt) and shows link state on reconnect without inventing missing values", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 120;
    stdout.rows = 24;
    let now = 1_760_000_000_000;

    // 1) First check that with no fixtures, no field is invented (all unknown -> '?')
    const emptyRegistryPath = join(root, "missing-registry.json");
    const emptyH2aRoot = join(root, "missing-h2a");
    let unknownScreenLine = "";
    {
      let reads = 0;
      const lease: NativeTerminalControllerLease = {
        role: "controller", id: "h2a-bare", generation: "g", incarnation: 1, controllerId: "c", epoch: 1,
      };
      const client: AttachClient = {
        async acquireController() { return lease; },
        async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
        async readOutput() {
          reads += 1;
          if (reads === 1) {
            const screen = await inspectScreen(stdout.chunks.join(""), 120, 24);
            unknownScreenLine = screen.lines[23] ?? "";
            stdin.emit("data", Buffer.from([0x1c]));
          }
          return replay(1, "");
        },
        async state() { return running(true); },
        async write() {}, async resize() {}, close() {},
      };
      await runAttach(
        "h2a-bare",
        {
          connect: async () => client,
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          now: () => now,
          delay: async (ms) => { now += ms; },
          onResize: () => {},
          offResize: () => {},
        },
        {
          statusBar: {
            registryPath: emptyRegistryPath,
            h2aRoot: emptyH2aRoot,
          },
        },
      );
    }
    expect(unknownScreenLine).toContain("? · h2a-bare · attached");
    expect(unknownScreenLine).toContain("J? I? L?");
    expect(unknownScreenLine).toContain("role ?");
    expect(unknownScreenLine).toContain("gw ?");
    expect(unknownScreenLine).toContain("deleg ?");

    // 2) Now populate real fixtures: registry + .h2a (presence, instances, subagents, inbox, loops) + gateway receipt
    const registryPath = join(root, "registry.json");
    const h2aRoot = join(root, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });
    mkdirSync(join(h2aRoot, "registry"), { recursive: true });
    mkdirSync(join(h2aRoot, "inbox", "claude__conductor__01"), { recursive: true });
    mkdirSync(join(h2aRoot, "loops", "loop-alpha"), { recursive: true });

    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "alpha",
            label: "alpha",
            tmuxSession: "h2a-alpha",
            tool: "claude",
            kind: "local-native",
            cwd: root,
            source: "run",
            sessionClass: "human",
            gatewayMode: "gateway",
            gatewayProvenance: "explicit",
            enrolledAt: new Date(now - 60_000).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
          },
          {
            id: "worker-1",
            label: "worker-1",
            tmuxSession: "h2a-worker-1",
            tool: "codex",
            kind: "local-native",
            cwd: root,
            source: "run",
            role: "job",
            jobState: "throttled",
            sessionClass: "background",
            pid: process.pid,
            delegationOrigin: "cli:h2a-delegate",
            delegatorInstance: "claude:conductor:01",
            delegatorTmuxSession: "h2a-alpha",
            enrolledAt: new Date(now - 30_000).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
          },
        ],
      }),
    );

    writeFileSync(
      join(h2aRoot, "presence", "sess-alpha.json"),
      JSON.stringify({
        sessionId: "sess-alpha",
        instance: "claude:conductor:01",
        host: "claude",
        pid: process.pid,
        name: "alpha",
        startedAt: new Date(now - 60_000).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        state: "live",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: [],
        launchContext: {
          cwd: root,
          command: "h2a mcp-serve",
          nativePty: { session: "h2a-alpha" },
        },
      }),
    );
    writeFileSync(
      join(h2aRoot, "registry", "instances.jsonl"),
      `${JSON.stringify({ instance: "claude:conductor:01", roles: ["CONDUCTOR"], registeredAt: new Date(now - 60_000).toISOString() })}\n`,
    );
    writeFileSync(
      join(h2aRoot, "registry", "subagents.jsonl"),
      `${JSON.stringify({ id: "claude:conductor:01~Researcher", parentInstance: "claude:conductor:01", name: "Researcher", createdAt: new Date(now - 30_000).toISOString() })}\n`,
    );
    writeFileSync(join(h2aRoot, "registry", "subagent-audit.jsonl"), "");
    mkdirSync(join(h2aRoot, "inbox", "claude__conductor__01~Researcher"), { recursive: true });
    for (const id of ["env:1"]) {
      writeFileSync(
        join(h2aRoot, "inbox", "claude__conductor__01", `${id.replace(":", "-")}.json`),
        JSON.stringify({
          protocol: "sentropic.h2a",
          version: "0.1",
          id,
          type: "event",
          actor: { instance: "codex:worker:01", role: "AGENTS", scope: "scope:default" },
          body: { topic: "task.done" },
          createdAt: new Date(now - 5_000).toISOString(),
        }),
      );
    }
    writeFileSync(
      join(h2aRoot, "inbox", "claude__conductor__01~Researcher", "env-2.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env:2",
        type: "event",
        actor: { instance: "codex:worker:01", role: "AGENTS", scope: "scope:default" },
        body: { topic: "subagent.done" },
        createdAt: new Date(now - 4_000).toISOString(),
      }),
    );
    writeFileSync(
      join(h2aRoot, "loops", "loop-alpha", "state.json"),
      JSON.stringify({
        id: "loop-alpha",
        ownerSystem: "h2a",
        name: "Cran 2 status bar",
        goal: "ship status bar",
        status: "waiting-human",
        repos: [],
        refs: [],
        agents: [
          {
            role: "conductor",
            tool: "claude",
            placement: "local",
            status: "running",
            h2aInstance: "claude:conductor:01",
          },
        ],
        policy: {},
        createdAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
    );
    mkdirSync(join(h2aRoot, "loops", "loop-stopped"), { recursive: true });
    writeFileSync(
      join(h2aRoot, "loops", "loop-stopped", "state.json"),
      JSON.stringify({
        id: "loop-stopped",
        ownerSystem: "h2a",
        name: "Stopped loop",
        goal: "already stopped",
        status: "stopped",
        repos: [],
        refs: [],
        agents: [],
        policy: {},
        createdAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
    );

    const fetchLedger: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("/v1/status/client/h2a-alpha");
      return new Response(
        JSON.stringify({
          gatewaySessionId: "gw-sess-1",
          clientSessionId: "h2a-alpha",
          state: "active",
          requestedModel: "claude-opus-4-6",
          upstreamModel: "claude-sonnet-4-6",
          transport: "messages",
          account: { id: "seat-1", provider: "anthropic", label: "work-seat" },
          updatedAt: new Date(now).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const stdout2 = new FakeTtyOutput();
    stdout2.columns = 120;
    stdout2.rows = 24;
    const stdin2 = new FakeInput();
    let connections = 0;
    let reconnectingBarLine = "";
    let recoveredBarLine = "";

    const connect = async (): Promise<AttachClient> => {
      connections += 1;
      const conn = connections;
      if (conn === 2) {
        // While reconnecting, inspect the bar on row 24 before connection 2 succeeds
        const screen = await inspectScreen(stdout2.chunks.join(""), 120, 24);
        reconnectingBarLine = screen.lines[23] ?? "";
      }
      let reads = 0;
      const lease: NativeTerminalControllerLease = {
        role: "controller",
        id: "h2a-alpha",
        generation: "g-1",
        incarnation: 1,
        controllerId: `ctrl-${conn}`,
        epoch: conn,
      };
      return {
        async acquireController() { return lease; },
        async releaseController() { return { controlled: false, controllerEpoch: conn }; },
        async readOutput() {
          reads += 1;
          if (conn === 1 && reads === 1) return replay(1, "agent output\r\n");
          if (conn === 1 && reads === 2) throw new Error("socket closed");
          if (conn === 2 && reads === 1) {
            const screen = await inspectScreen(stdout2.chunks.join(""), 120, 24);
            recoveredBarLine = screen.lines[23] ?? "";
            stdin2.emit("data", Buffer.from([0x1c]));
          }
          return replay(1, "");
        },
        async state() { return running(true); },
        async write() {},
        async resize() {},
        close() {},
      };
    };

    await runAttach(
      "h2a-alpha",
      {
        connect,
        stdin: stdin2 as unknown as NodeJS.ReadStream,
        stdout: stdout2 as unknown as NodeJS.WriteStream,
        now: () => now,
        delay: async (ms) => { now += ms; },
        onResize: () => {},
        offResize: () => {},
      },
      {
        statusBar: {
          registryPath,
          h2aRoot,
          gatewayBaseUrl: "http://127.0.0.1:43199",
          fetchImpl: fetchLedger,
          nativeWorkerPidForSession: (s) => (s === "h2a-worker-1" ? process.pid : undefined),
        },
      },
    );

    expect(reconnectingBarLine).toContain("claude · h2a-alpha · reconnecting");
    expect(recoveredBarLine).toContain("claude · h2a-alpha · attached");
    expect(recoveredBarLine).toContain("J1!1 I2 L1!1");
    expect(recoveredBarLine).toContain("role conductor");
    expect(recoveredBarLine).toContain("gw active · claude-opus-4-6→claude-sonnet-4-6");
    expect(recoveredBarLine).toContain("deleg 1");
  });

  it("rate-limits status refreshes to at most 1 update/s and never corrupts a relative-redraw or alternate-screen child TUI", async () => {
    const { writeFileSync } = await import("node:fs");
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 100;
    stdout.rows = 20;
    let now = 1_760_000_000_000;
    let fetchCalls = 0;

    const registryPath = join(root, "registry.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "alpha",
            label: "alpha",
            tmuxSession: "h2a-alpha",
            tool: "claude",
            kind: "local-native",
            cwd: root,
            source: "run",
            sessionClass: "human",
            gatewayMode: "gateway",
            gatewayProvenance: "explicit",
            enrolledAt: new Date(now - 60_000).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
          },
        ],
      }),
    );

    const fetchLedger: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          gatewaySessionId: "gw-1",
          clientSessionId: "h2a-alpha",
          state: "active",
          requestedModel: "claude-opus-4-6",
          upstreamModel: `claude-opus-4-6-v${fetchCalls}`,
          transport: "messages",
          account: { id: "seat-1", provider: "anthropic", label: "seat-1" },
          updatedAt: new Date(now).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const chunks = [
      // Relative redraw child (like Claude Code / Ink):
      "Header line\r\nThinking...\r\nPrompt > ",
      "\r\x1b[1A\x1b[2KStep 1 complete\r\nPrompt > ",
      "\r\x1b[1A\x1b[2KStep 2 complete\r\nPrompt > ",
      // Alternate screen child (like vim / htop) that emits CSI r, CSI 2J, and 999;1H:
      "\x1b[?1049h\x1b[r\x1b[2J\x1b[1;1HALT-TOP\x1b[999;1HALT-BOTTOM",
      // Exit alternate screen and do one more relative redraw on normal screen:
      "\x1b[?1049l\r\x1b[1A\x1b[2KFinal normal line\r\nPrompt > ",
    ];

    let seq = 0;
    let altScreenSnapshot: { lines: string[] } | undefined;
    let finalNormalSnapshot: { lines: string[]; cursorRow: number; cursorCol: number } | undefined;
    const lease: NativeTerminalControllerLease = {
      role: "controller", id: "h2a-alpha", generation: "generation-1", incarnation: 1, controllerId: "c-1", epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        seq += 1;
        if (seq === 5) {
          // Capture alt-screen state right after chunk 4 was written
          altScreenSnapshot = await inspectScreen(stdout.chunks.join(""), 100, 20);
        }
        if (seq === 6) {
          // Advance clock by 1000ms so exactly one more status refresh is permitted
          now += 1_000;
          return replay(seq, "done");
        }
        if (seq === 7) {
          finalNormalSnapshot = await inspectScreen(stdout.chunks.join(""), 100, 20);
          stdin.emit("data", Buffer.from([0x1c]));
          return replay(seq, "");
        }
        const data = chunks[seq - 1] ?? "";
        return replay(seq, data);
      },
      async state() { return running(true); },
      async write() {},
      async resize() {},
      close() {},
    };

    await runAttach(
      "h2a-alpha",
      {
        connect: async () => client,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        now: () => now,
        delay: async (ms) => { now += ms; },
        onResize: () => {},
        offResize: () => {},
      },
      {
        statusBar: {
          registryPath,
          h2aRoot: join(root, "missing-h2a"),
          gatewayBaseUrl: "http://127.0.0.1:43199",
          fetchImpl: fetchLedger,
        },
      },
    );

    // 5 chunks arrived within <500ms, then 1 chunk after +1000ms -> at most 2 status fetches total!
    expect(fetchCalls).toBeLessThanOrEqual(2);
    expect(fetchCalls).toBeGreaterThanOrEqual(1);

    // In alternate screen: ALT-TOP is on row 1, ALT-BOTTOM is clamped to row 19 (N-1), row 20 (N) is status bar!
    expect(altScreenSnapshot?.lines[0]?.trimEnd()).toBe("ALT-TOP");
    expect(altScreenSnapshot?.lines[18]?.trimEnd()).toBe("ALT-BOTTOM");
    expect(altScreenSnapshot?.lines[19]).toContain("claude · h2a-alpha · attached");

    // Back on normal screen: relative redraws succeeded cleanly on rows 1..3 and row 20 holds the status bar!
    expect(finalNormalSnapshot?.lines[0]?.trimEnd()).toBe("Header line");
    expect(finalNormalSnapshot?.lines[1]?.trimEnd()).toBe("Final normal line");
    expect(finalNormalSnapshot?.lines[2]?.trimEnd()).toBe("Prompt > done");
    expect(finalNormalSnapshot?.lines[19]).toContain("claude · h2a-alpha · attached");
  });

  it("B1: parses escape sequences split byte-by-byte across chunks and defers mid-sequence status repaints", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 80;
    stdout.rows = 20;
    let now = 1_760_000_000_000;

    // Split CSI r, CSI 2J, CSI 20;1H, OSC 0;title BEL, OSC 0;title ST, DCS ST across single-byte chunks
    const rawStream =
      "\x1b[r\x1b[2J\x1b]0;my-title\x07\x1b]0;st-title\x1b\\\x1bP1$r0m\x1b\\\x1b[1;1HTOP-LINE\x1b[20;1HCLAMPED-BOTTOM";
    const byteChunks = Array.from(rawStream);

    let idx = 0;
    let midSnap: { lines: string[]; cursorRow: number; cursorCol: number } | undefined;
    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "c-1",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        if (idx < byteChunks.length) {
          const ch = byteChunks[idx++]!;
          // Advance clock by 1000ms right in the middle of an escape sequence to trigger a status refresh
          if (idx === 10 || idx === 30) {
            now += 1_000;
          }
          return replay(idx, ch);
        }
        if (idx === byteChunks.length) {
          idx += 1;
          now += 1_000;
          midSnap = await inspectScreen(stdout.chunks.join(""), 80, 20);
          stdin.emit("data", Buffer.from([0x1c]));
        }
        return replay(idx, "");
      },
      async state() { return running(true); },
      async write() {},
      async resize() {},
      close() {},
    };

    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: () => {},
      offResize: () => {},
    });

    expect(midSnap?.lines[0]?.trimEnd()).toBe("TOP-LINE");
    expect(midSnap?.lines[18]?.trimEnd()).toBe("CLAMPED-BOTTOM");
    expect(midSnap?.lines[19]).toContain("h2a-alpha · attached");
  });

  it("B2: detaching or exiting from alternate screen cleans both buffers, exits alt screen, and keeps detach notice visible", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 80;
    stdout.rows = 20;
    let now = 1_760_000_000_000;
    let reads = 0;
    let receiptDuringAlt = "";

    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "c-1",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        reads += 1;
        if (reads === 1) {
          return replay(1, "Normal line 1\r\nNormal line 2\x1b[?1049h\x1b[1;1HAlt screen content");
        }
        if (reads === 2) {
          stdin.emit("data", Buffer.from([0x1c]));
        }
        return replay(2, "");
      },
      async state() { return running(true); },
      async write() {},
      async resize() {},
      close() {},
    };

    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: () => {},
      offResize: () => {},
      saveTerminalReset: (seq) => {
        if (seq) receiptDuringAlt = seq;
      },
    });

    // Crash recovery receipt while attached must include the status-bar restore sequence (\x1b[r and row 20 clear)
    expect(receiptDuringAlt).toContain("\x1b[r\x1b[20;1H\x1b[2K");

    const afterDetach = await inspectScreen(stdout.chunks.join(""), 80, 20);
    // Normal screen is active again, Normal line 1 is intact, detach notice is visible, and row 20 is NOT the amber status bar
    expect(afterDetach.lines[0]?.trimEnd()).toBe("Normal line 1");
    expect(afterDetach.lines.some((line) => line.includes("[h2a] detached from native session"))).toBe(true);
    expect(afterDetach.lines[19]).not.toContain("h2a-alpha · attached");
  });

  it("B3: preserves 256-color and 24-bit RGB SGR with zero channels across status bar repaints", async () => {
    const { default: xterm } = await import("@xterm/headless");
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 80;
    stdout.rows = 20;
    let now = 1_760_000_000_000;
    let reads = 0;
    let rawBeforeDetach = "";

    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "c-1",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        reads += 1;
        if (reads === 1) {
          // Set 256-color fg 0 (palette 0) and RGB bg (0, 128, 0) — both contain '0' sub-operands!
          return replay(1, "\x1b[1;1H\x1b[38;5;0;48;2;0;128;0mA");
        }
        if (reads === 2) {
          // Trigger a status bar repaint by advancing clock >= 1000ms, then write 'B' relying on preserved SGR
          now += 1_000;
          return replay(2, "B");
        }
        if (reads === 3) {
          rawBeforeDetach = stdout.chunks.join("");
          stdin.emit("data", Buffer.from([0x1c]));
        }
        return replay(3, "");
      },
      async state() { return running(true); },
      async write() {},
      async resize() {},
      close() {},
    };

    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: () => {},
      offResize: () => {},
    });

    const terminal = new xterm.Terminal({ cols: 80, rows: 20, scrollback: 0, allowProposedApi: true });
    try {
      await new Promise<void>((resolve) => terminal.write(rawBeforeDetach, resolve));
      const row0 = terminal.buffer.active.getLine(0);
      const cellB = row0?.getCell(1);
      expect(row0?.translateToString(true).slice(0, 2)).toBe("AB");
      expect(cellB?.isFgPalette()).toBe(true);
      expect(cellB?.getFgColor()).toBe(0);
      expect(cellB?.isBgRGB()).toBe(true);
      expect(cellB?.getBgColor()).toBe(0x008000);
    } finally {
      terminal.dispose();
    }
  });

  it("B4 & B5: handles DECOM (?6h), DECSTR (!p), RIS (ESC c), DECSED (?2J), pendingWrap at right margin, CHT/CBT/REP, and DECSC/DECRC", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 20;
    stdout.rows = 12;
    let now = 1_760_000_000_000;
    let reads = 0;
    let snap: { lines: string[]; cursorRow: number; cursorCol: number } | undefined;

    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "c-1",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        reads += 1;
        if (reads === 1) {
          // 1) RIS (\x1bc), then DECSTR (\x1b[!p), then DECSED (\x1b[?2J)
          // 2) Set scroll region 3..10, enable DECOM (\x1b[?6h), CUP 1;1 (which means row 3 col 1!) and write "DECOM-ROW3"
          return replay(1, "\x1bc\x1b[!p\x1b[?2J\x1b[3;10r\x1b[?6h\x1b[1;1HDECOM-ROW3");
        }
        if (reads === 2) {
          now += 1_000;
          // Disable DECOM, reset scroll region, save cursor at row 5 col 2, move elsewhere, restore cursor and write "SAVED"
          return replay(2, "\x1b[?6l\x1b[r\x1b[5;2H\x1b7\x1b[1;1HIGNORE\x1b8SAVED");
        }
        if (reads === 3) {
          now += 1_000;
          // Fill row 7 right up to column 20 (triggers pendingWrap at col 20)
          return replay(3, "\x1b[7;1H12345678901234567890");
        }
        if (reads === 4) {
          // Trigger repaint while pendingWrap is true on row 7 col 20, then emit "WRAP" -> must wrap to row 8 col 1!
          now += 1_000;
          return replay(4, "WRAP");
        }
        if (reads === 5) {
          now += 1_000;
          // Use REP (\x1b[3b) and CHT (\x1b[1I) on row 9
          return replay(5, "\x1b[9;1HX\x1b[3b\x1b[1IY");
        }
        if (reads === 6) {
          snap = await inspectScreen(stdout.chunks.join(""), 20, 12);
          stdin.emit("data", Buffer.from([0x1c]));
        }
        return replay(6, "");
      },
      async state() { return running(true); },
      async write() {},
      async resize() {},
      close() {},
    };

    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: () => {},
      offResize: () => {},
    });

    expect(snap?.lines[2]?.trimEnd()).toBe("DECOM-ROW3");
    expect(snap?.lines[4]?.trimEnd()).toBe(" SAVED");
    expect(snap?.lines[6]?.trimEnd()).toBe("12345678901234567890");
    expect(snap?.lines[7]?.trimEnd()).toBe("WRAP");
    expect(snap?.lines[8]?.trimEnd()).toBe("XXXX    Y");
    // Row 12 (index 11) still has the status bar after RIS, DECSTR, DECSED, DECOM, and pendingWrap!
    expect(snap?.lines[11]).toContain("h2a-alpha");
  });

  it("B6: resizing from 20 rows down to 8 rows disables the status bar without erasing line 8 of the child TUI", async () => {
    const stdin = new FakeInput();
    const stdout = new FakeTtyOutput();
    stdout.columns = 60;
    stdout.rows = 20;
    let now = 1_760_000_000_000;
    let reads = 0;
    let resizeHandler: (() => void) | undefined;
    let shrunkOutput = "";

    const lease: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-alpha",
      generation: "generation-1",
      incarnation: 1,
      controllerId: "c-1",
      epoch: 1,
    };

    const client: AttachClient = {
      async acquireController() { return lease; },
      async releaseController() { return { controlled: false, controllerEpoch: 1 }; },
      async readOutput() {
        reads += 1;
        if (reads === 1) {
          return replay(
            1,
            "\x1b[1;1HL1\r\nL2\r\nL3\r\nL4\r\nL5\r\nL6\r\nL7\r\nLINE-8-KEEP",
          );
        }
        if (reads === 2) {
          stdout.rows = 8;
          resizeHandler?.();
          return replay(2, "");
        }
        if (reads === 3) {
          shrunkOutput = stdout.chunks.join("");
          stdin.emit("data", Buffer.from([0x1c]));
        }
        return replay(3, "");
      },
      async state() { return running(true); },
      async write() {},
      async resize() {},
      close() {},
    };

    await runAttach("h2a-alpha", {
      connect: async () => client,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => now,
      delay: async (ms) => { now += ms; },
      onResize: (fn) => { resizeHandler = fn; },
      offResize: () => { resizeHandler = undefined; },
    });

    // When shrinking from 20 rows to 8 rows, the status bar must NOT emit \x1b[20;1H\x1b[2K (which xterm clamps to row 8 and erases LINE-8-KEEP)
    const afterResizeSlice = shrunkOutput.slice(shrunkOutput.indexOf("LINE-8-KEEP") + "LINE-8-KEEP".length);
    expect(afterResizeSlice).not.toContain("\x1b[20;1H\x1b[2K");
    expect(afterResizeSlice).not.toContain("\x1b[8;1H\x1b[2K");
  });
});
