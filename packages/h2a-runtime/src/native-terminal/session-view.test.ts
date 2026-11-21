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
import type { NativeTerminalClient } from "./client.js";
import { runAttach, type NativeTerminalAttachRuntime } from "./op.js";
import { buildRightPanelSnapshot } from "./right-panel.js";
import { createSessionView, type SessionViewStatusBar } from "./session-view.js";

class FakeInput extends EventEmitter {
  readonly isTTY = false;
  readonly resume = vi.fn();
  readonly pause = vi.fn();
  readonly setRawMode = vi.fn();
}

class FakeOutput {
  columns = 120;
  rows = 40;
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

function running(id: string, controlled = true): NativeTerminalSessionState {
  return {
    id,
    pid: 4242,
    status: "running",
    exit: null,
    generation: "gen-s0",
    incarnation: 1,
    controllerEpoch: controlled ? 1 : 0,
    controlled,
  };
}

function replay(id: string, seq: number, data: string): NativeTerminalReplay {
  return {
    id,
    earliestSeq: seq,
    latestSeq: seq,
    truncated: false,
    chunks: [{ seq, data }],
  };
}

// Oracle captured on unmodified origin/main (dac65c6a3).
const EXPECTED_PANEL_OFF_STDOUT =
  "\x1b[?1004h\x1b[?2004hhello world\r\n\r\n[h2a] detached from native session (session keeps running)\r\n\x1b[?1004l\x1b[?2004l";

const EXPECTED_PANEL_ON_STDOUT =
  "\x1b[s\x1b[1;120H│\x1b[2;120H│\x1b[3;120H│\x1b[4;120H│\x1b[5;120H│\x1b[6;120H│\x1b[7;120H│\x1b[8;120H│\x1b[9;120H│\x1b[10;120H│\x1b[11;120H│\x1b[12;120H│\x1b[13;120H│\x1b[14;120H│\x1b[15;120H│\x1b[16;120H│\x1b[17;120H│\x1b[18;120H│\x1b[19;120H│\x1b[20;120H\x1b[41m*\x1b[0m\x1b[21;120H│\x1b[22;120H│\x1b[23;120H│\x1b[24;120H│\x1b[25;120H│\x1b[26;120H│\x1b[27;120H│\x1b[28;120H│\x1b[29;120H│\x1b[30;120H│\x1b[31;120H│\x1b[32;120H│\x1b[33;120H│\x1b[34;120H│\x1b[35;120H│\x1b[36;120H│\x1b[37;120H│\x1b[38;120H│\x1b[39;120H│\x1b[u" +
  "\x1b[?1000h\x1b[?1006h\x1b[s\x1b[?69h\x1b[1;88s\x1b[1;89H[core] docs                     \x1b[2;89H\x1b[32m●\x1b[0m  alpha               \x1b[3;89H\x1b[31m✖\x1b[0m* beta                \x1b[4;89H\x1b[5;89H\x1b[6;89H\x1b[7;89H\x1b[8;89H\x1b[9;89H\x1b[10;89H\x1b[11;89H\x1b[12;89H\x1b[13;89H\x1b[14;89H\x1b[15;89H\x1b[16;89H\x1b[17;89H\x1b[18;89H\x1b[19;89H\x1b[20;89H\x1b[21;89H\x1b[22;89H\x1b[23;89H\x1b[24;89H\x1b[25;89H\x1b[26;89H\x1b[27;89H\x1b[28;89H\x1b[29;89H\x1b[30;89H\x1b[31;89H\x1b[32;89H\x1b[33;89H\x1b[34;89H\x1b[35;89H\x1b[36;89H\x1b[37;89H\x1b[38;89H\x1b[39;89H\x1b[u" +
  "\x1b[?1004hfirst\r\n" +
  "\x1b[s\x1b[?69h\x1b[1;88s\x1b[1;89H[core] docs                     \x1b[2;89H\x1b[32m●\x1b[0m  alpha               \x1b[3;89H\x1b[31m✖\x1b[0m* beta                \x1b[4;89H\x1b[5;89H\x1b[6;89H\x1b[7;89H\x1b[8;89H\x1b[9;89H\x1b[10;89H\x1b[11;89H\x1b[12;89H\x1b[13;89H\x1b[14;89H\x1b[15;89H\x1b[16;89H\x1b[17;89H\x1b[18;89H\x1b[19;89H\x1b[20;89H\x1b[21;89H\x1b[22;89H\x1b[23;89H\x1b[24;89H\x1b[25;89H\x1b[26;89H\x1b[27;89H\x1b[28;89H\x1b[29;89H\x1b[30;89H\x1b[31;89H\x1b[32;89H\x1b[33;89H\x1b[34;89H\x1b[35;89H\x1b[36;89H\x1b[37;89H\x1b[38;89H\x1b[39;89H\x1b[u" +
  "\x1b[s\x1b[?69h\x1b[1;88s\x1b[1;89Hcore [docs]                     \x1b[2;89H\x1b[37m○\x1b[0m  gamma               \x1b[3;89H\x1b[4;89H\x1b[5;89H\x1b[6;89H\x1b[7;89H\x1b[8;89H\x1b[9;89H\x1b[10;89H\x1b[11;89H\x1b[12;89H\x1b[13;89H\x1b[14;89H\x1b[15;89H\x1b[16;89H\x1b[17;89H\x1b[18;89H\x1b[19;89H\x1b[20;89H\x1b[21;89H\x1b[22;89H\x1b[23;89H\x1b[24;89H\x1b[25;89H\x1b[26;89H\x1b[27;89H\x1b[28;89H\x1b[29;89H\x1b[30;89H\x1b[31;89H\x1b[32;89H\x1b[33;89H\x1b[34;89H\x1b[35;89H\x1b[36;89H\x1b[37;89H\x1b[38;89H\x1b[39;89H\x1b[u" +
  "\x1b[s\x1b[?69h\x1b[1;88s\x1b[1;89Hcore [docs]                     \x1b[2;89H◆* gateway posture              \x1b[3;89H\x1b[4;89H\x1b[5;89H\x1b[6;89H\x1b[7;89H\x1b[8;89H\x1b[9;89H\x1b[10;89H\x1b[11;89H\x1b[12;89H\x1b[13;89H\x1b[14;89H\x1b[15;89H\x1b[16;89H\x1b[17;89H\x1b[18;89H\x1b[19;89H\x1b[20;89H\x1b[21;89H\x1b[22;89H\x1b[23;89H\x1b[24;89H\x1b[25;89H\x1b[26;89H\x1b[27;89H\x1b[28;89H\x1b[29;89H\x1b[30;89H\x1b[31;89H\x1b[32;89H\x1b[33;89H\x1b[34;89H\x1b[35;89H\x1b[36;89H\x1b[37;89H\x1b[38;89H\x1b[39;89H\x1b[u" +
  "second\r\n" +
  "\x1b[s\x1b[?69h\x1b[1;88s\x1b[1;89Hcore [docs]                     \x1b[2;89H◆* gateway posture              \x1b[3;89H\x1b[4;89H\x1b[5;89H\x1b[6;89H\x1b[7;89H\x1b[8;89H\x1b[9;89H\x1b[10;89H\x1b[11;89H\x1b[12;89H\x1b[13;89H\x1b[14;89H\x1b[15;89H\x1b[16;89H\x1b[17;89H\x1b[18;89H\x1b[19;89H\x1b[20;89H\x1b[21;89H\x1b[22;89H\x1b[23;89H\x1b[24;89H\x1b[25;89H\x1b[26;89H\x1b[27;89H\x1b[28;89H\x1b[29;89H\x1b[30;89H\x1b[31;89H\x1b[32;89H\x1b[33;89H\x1b[34;89H\x1b[35;89H\x1b[36;89H\x1b[37;89H\x1b[38;89H\x1b[39;89H\x1b[u" +
  "third\r\n" +
  "\x1b[s\x1b[?69h\x1b[1;88s\x1b[1;89Hcore [docs]                     \x1b[2;89H◆* gateway posture              \x1b[3;89H\x1b[4;89H\x1b[5;89H\x1b[6;89H\x1b[7;89H\x1b[8;89H\x1b[9;89H\x1b[10;89H\x1b[11;89H\x1b[12;89H\x1b[13;89H\x1b[14;89H\x1b[15;89H\x1b[16;89H\x1b[17;89H\x1b[18;89H\x1b[19;89H\x1b[20;89H\x1b[21;89H\x1b[22;89H\x1b[23;89H\x1b[24;89H\x1b[25;89H\x1b[26;89H\x1b[27;89H\x1b[28;89H\x1b[29;89H\x1b[30;89H\x1b[31;89H\x1b[32;89H\x1b[33;89H\x1b[34;89H\x1b[35;89H\x1b[36;89H\x1b[37;89H\x1b[38;89H\x1b[39;89H\x1b[u" +
  "\r\n[h2a] detached from native session (session keeps running)\r\n\x1b[?1004l\x1b[?1006l\x1b[?1000l\x1b[?69l";

async function runPanelOffScenario() {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  let now = 0;
  let reads = 0;
  let resizeListener: (() => void) | undefined;
  const childWrites: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const savedResets: string[] = [];

  const lease: NativeTerminalControllerLease = {
    role: "controller",
    id: "h2a-alpha",
    generation: "gen-s0",
    incarnation: 1,
    controllerId: "ctrl-s0",
    epoch: 1,
  };

  const client: AttachClient = {
    async acquireController() {
      return lease;
    },
    async releaseController() {
      return { controlled: false, controllerEpoch: 1 };
    },
    async readOutput() {
      reads += 1;
      if (reads === 1) {
        stdin.emit("data", Buffer.from("ls\r"));
        stdin.emit("data", Buffer.from("\x1b[24~"));
        return replay("h2a-alpha", 1, "\x1b[?1004h\x1b[?2004hhello ");
      }
      if (reads === 2) {
        stdout.columns = 100;
        stdout.rows = 30;
        resizeListener?.();
        return replay("h2a-alpha", 2, "world\r\n");
      }
      stdin.emit("data", Buffer.from([0x1c]));
      return replay("h2a-alpha", 3, "");
    },
    async state() {
      return running("h2a-alpha", true);
    },
    async write(_lease, data) {
      childWrites.push(data);
    },
    async resize(_lease, cols, rows) {
      resizes.push({ cols, rows });
    },
    close() {},
  };

  const runtime: NativeTerminalAttachRuntime = {
    connect: async () => client,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    now: () => now,
    delay: async (ms) => {
      now += ms;
    },
    onResize: (listener) => {
      resizeListener = listener;
    },
    offResize: () => {
      resizeListener = undefined;
    },
    saveTerminalReset: (seq) => {
      savedResets.push(seq);
    },
  };

  const exitCode = await runAttach("h2a-alpha", runtime, {
    statusBar: false,
    rightPanel: false,
  });

  return {
    exitCode,
    stdoutBytes: stdout.chunks.join(""),
    childWrites,
    resizes,
    savedResets,
  };
}

async function runPanelOnScenario() {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  let now = 0;
  let reads = 0;
  const childWrites: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const savedResets: string[] = [];

  const lease: NativeTerminalControllerLease = {
    role: "controller",
    id: "h2a-alpha",
    generation: "gen-s0",
    incarnation: 1,
    controllerId: "ctrl-s0",
    epoch: 1,
  };

  const client: AttachClient = {
    async acquireController() {
      return lease;
    },
    async releaseController() {
      return { controlled: false, controllerEpoch: 1 };
    },
    async readOutput() {
      reads += 1;
      if (reads === 1) {
        stdin.emit("data", Buffer.from("\x1b[24~"));
        return replay("h2a-alpha", 1, "\x1b[?1004hfirst\r\n");
      }
      if (reads === 2) {
        stdin.emit("data", Buffer.from("\t"));
        stdin.emit("data", Buffer.from("/d"));
        stdin.emit("data", Buffer.from("\x1b"));
        return replay("h2a-alpha", 2, "second\r\n");
      }
      if (reads === 3) {
        stdin.emit("data", Buffer.from("hi"));
        return replay("h2a-alpha", 3, "third\r\n");
      }
      stdin.emit("data", Buffer.from([0x1c]));
      return replay("h2a-alpha", 4, "");
    },
    async state() {
      return running("h2a-alpha", true);
    },
    async write(_lease, data) {
      childWrites.push(data);
    },
    async resize(_lease, cols, rows) {
      resizes.push({ cols, rows });
    },
    close() {},
  };

  const runtime: NativeTerminalAttachRuntime = {
    connect: async () => client,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    now: () => now,
    delay: async (ms) => {
      now += ms;
    },
    onResize: () => {},
    offResize: () => {},
    saveTerminalReset: (seq) => {
      savedResets.push(seq);
    },
  };

  const exitCode = await runAttach("h2a-alpha", runtime, {
    statusBar: false,
    rightPanel: {
      enabled: true,
      width: 32,
      snapshot: buildRightPanelSnapshot({
        currentSessionId: "h2a-alpha",
        groups: [
          {
            title: "core",
            sessions: [
              { id: "h2a-alpha", label: "alpha", status: "running" },
              { id: "h2a-beta", label: "beta", status: "blocked" },
            ],
          },
          {
            title: "docs",
            sessions: [{ id: "h2a-gamma", label: "gamma", status: "idle" }],
          },
        ],
        decisions: [
          {
            id: "D1",
            title: "gateway posture",
            kind: "decision",
            sessionId: "h2a-beta",
          },
        ],
      }),
    },
  });

  return {
    exitCode,
    stdoutBytes: stdout.chunks.join(""),
    childWrites,
    resizes,
    savedResets,
  };
}

describe("S0 Step 1 — attach byte-for-byte characterization oracle", () => {
  let root = "";
  let prevStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-s0-session-view-"));
    prevStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(root, "state");
  });

  afterEach(() => {
    if (prevStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = prevStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("matches exact base oracle bytes for attach with right panel OFF", async () => {
    const result = await runPanelOffScenario();
    expect(result).toEqual({
      exitCode: 0,
      stdoutBytes: EXPECTED_PANEL_OFF_STDOUT,
      childWrites: ["ls\r", "\x1b[24~"],
      resizes: [
        { cols: 120, rows: 40 },
        { cols: 100, rows: 30 },
      ],
      savedResets: ["\x1b[?1004l\x1b[?2004l", ""],
    });
  });

  it("matches exact base oracle bytes for attach with right panel ON", async () => {
    const result = await runPanelOnScenario();
    expect(result).toEqual({
      exitCode: 0,
      stdoutBytes: EXPECTED_PANEL_ON_STDOUT,
      childWrites: ["hi"],
      resizes: [
        { cols: 119, rows: 40 },
        { cols: 88, rows: 40 },
        { cols: 88, rows: 40 },
      ],
      savedResets: ["\x1b[?1004l", ""],
    });
  });
});

function noopStatusBar(stdout: FakeOutput): SessionViewStatusBar {
  return {
    childRows: () => stdout.rows,
    probe: async () => {},
    onResize: () => {},
    flushAfterOutputBatch: () => {},
    flushPendingSequence: () => "",
    resumeAfterReset: () => {},
    dispose: () => {},
    peekRestoreSequence: () => "",
    restoreSequence: () => "",
    transformChildOutput: (data) => data,
  };
}

describe("S0 Step 2 — re-entrant session views A/B without closure on an initial ID", () => {
  it("creates successive views A then B with completely independent state, seq, modes, and leases", async () => {
    const stdout = new FakeOutput();
    const writesA: string[] = [];
    const writesB: string[] = [];
    const acquiredIds: string[] = [];
    const releasedIds: string[] = [];
    const crashEntries: Array<{ sessionId?: string }> = [];
    const savedResets: string[] = [];

    const makeClient = (id: string, writes: string[]): AttachClient => ({
      async acquireController(sessionId) {
        acquiredIds.push(sessionId);
        return {
          role: "controller",
          id: sessionId,
          generation: `gen-${id}`,
          incarnation: 1,
          controllerId: `ctrl-${id}`,
          epoch: 1,
        };
      },
      async releaseController(lease) {
        releasedIds.push(lease.id);
        return { controlled: false, controllerEpoch: lease.epoch };
      },
      async readOutput() {
        return replay(id, 1, "");
      },
      async state(sessionId) {
        return running(sessionId, true);
      },
      async write(_lease, data) {
        writes.push(data);
      },
      async resize() {},
      close() {},
    });

    const viewA = createSessionView({
      sessionId: "h2a-session-A",
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      tty: "test-tty",
      statusBar: noopStatusBar(stdout),
      saveTerminalReset: (seq) => savedResets.push(`A:${seq}`),
      onCrashLog: (entry) => crashEntries.push(entry),
    });

    const clientA = makeClient("h2a-session-A", writesA);
    await viewA.connectAndAcquire(async () => clientA);
    viewA.feedReplay(replay("h2a-session-A", 7, "\x1b[?1004hfrom-A"));
    viewA.enqueueInput(Buffer.from("input-for-A"));
    await viewA.drainInputPump();
    viewA.resetModes();
    await viewA.releaseActive();
    viewA.dispose();

    const viewB = createSessionView({
      sessionId: "h2a-session-B",
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => 2_000,
      tty: "test-tty",
      statusBar: noopStatusBar(stdout),
      saveTerminalReset: (seq) => savedResets.push(`B:${seq}`),
      onCrashLog: (entry) => crashEntries.push(entry),
    });

    const clientB = makeClient("h2a-session-B", writesB);
    await viewB.connectAndAcquire(async () => clientB);
    viewB.feedReplay(replay("h2a-session-B", 2, "\x1b[?2004hfrom-B"));
    viewB.enqueueInput(Buffer.from("input-for-B"));
    await viewB.drainInputPump();

    // Controller-change on B must record B's sessionId, never A's.
    const changed = viewB.controllerChanged(
      { ...running("h2a-session-B", false), controllerEpoch: 2 },
      viewB.active!.lease,
    );
    expect(changed).toBe(true);
    expect(viewB.terminalEnded).toBe(true);
    expect(viewA.terminalEnded).toBe(false);

    viewB.resetModes();
    await viewB.releaseActive();
    viewB.dispose();

    expect(viewA.sessionId).toBe("h2a-session-A");
    expect(viewB.sessionId).toBe("h2a-session-B");
    expect(viewA.seq).toBe(7);
    expect(viewB.seq).toBe(2);
    expect(acquiredIds).toEqual(["h2a-session-A", "h2a-session-B"]);
    expect(releasedIds).toEqual(["h2a-session-A", "h2a-session-B"]);
    expect(writesA).toEqual(["input-for-A"]);
    expect(writesB).toEqual(["input-for-B"]);
    expect(crashEntries).toEqual([
      expect.objectContaining({
        event: "refusal",
        sessionId: "h2a-session-B",
        reason: "controller-changed",
      }),
    ]);
    expect(savedResets).toContain("A:\x1b[?1004l");
    expect(savedResets).toContain("B:\x1b[?2004l");
  });
});
