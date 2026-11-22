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

  it("matches L0.5b attach contract with right panel ON (whole-attach mouse, no ?69 or CSI s/u, pre-published reset)", async () => {
    const result = await runPanelOnScenario();
    expect(result.exitCode).toBe(0);
    expect(result.childWrites).toEqual(["hi"]);
    expect(result.resizes).toEqual([
      { cols: 119, rows: 40 },
      { cols: 88, rows: 40 },
    ]);
    // Whole-attach mouse + hygiene pre-published before child modes, then child ?1004l added, then cleared on detach.
    expect(result.savedResets).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[4l\x1b[?6l\x1b[r\x1b[0m",
      "\x1b[?1004l\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[4l\x1b[?6l\x1b[r\x1b[0m",
      "",
    ]);
    // No DECLRMM (?69) and no DECSC/SCOSC (CSI s/u) emitted by the panel.
    expect(result.stdoutBytes).not.toContain("\x1b[?69h");
    expect(result.stdoutBytes).not.toContain("\x1b[?69l");
    expect(result.stdoutBytes).not.toContain("\x1b[s");
    expect(result.stdoutBytes).not.toContain("\x1b[u");
    // Whole-attach outer mouse enabled once at attach start and never torn down before detach.
    const detachIdx = result.stdoutBytes.indexOf("[h2a] detached");
    expect(detachIdx).toBeGreaterThan(0);
    const beforeDetach = result.stdoutBytes.slice(0, detachIdx);
    const afterDetach = result.stdoutBytes.slice(detachIdx);
    expect(beforeDetach).toContain("\x1b[?1000h\x1b[?1006h");
    expect(beforeDetach).not.toContain("\x1b[?1000l");
    expect(beforeDetach).not.toContain("\x1b[?1006l");
    // Bar inactive => panel spans rows 1..40, renders full-width padded rows, and switches views/tabs.
    expect(beforeDetach).toContain("\x1b[40;120H│");
    expect(beforeDetach).toContain("[core] docs");
    expect(beforeDetach).toContain("core [docs]");
    expect(beforeDetach).toContain("◆* gateway posture");
    expect(beforeDetach).toContain("first\r\n");
    expect(beforeDetach).toContain("second\r\n");
    expect(beforeDetach).toContain("third\r\n");
    // Detach cleanly resets both child modes and h2a outer mouse.
    expect(afterDetach).toContain("\x1b[?1004l");
    expect(afterDetach).toContain("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
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

  it("LH-05 transitions to observer on remote switch, purges input queue, filters queries, and takes back on keystroke", async () => {
    const stdout = new FakeOutput();
    const writes: string[] = [];
    const acquireCalls: Array<Record<string, unknown>> = [];
    const releaseCalls: number[] = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    const banners: Array<string | undefined> = [];

    const lease1: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-lh05-sv",
      generation: "gen-1",
      incarnation: "inc-1",
      controllerId: "ctrl-1",
      epoch: 1,
    };
    const lease2: NativeTerminalControllerLease = {
      ...lease1,
      epoch: 3,
    };
    let rejectFirstWrite!: (err: Error) => void;
    const firstWriteBlocked = new Promise<void>((_, reject) => {
      rejectFirstWrite = reject;
    });
    let writeCount = 0;
    let switchedToRemote = false;

    const client: AttachClient = {
      async acquireController(_id, _cid, _act, opts) {
        acquireCalls.push(opts as Record<string, unknown>);
        return acquireCalls.length === 1 ? lease1 : lease2;
      },
      async releaseController(l) {
        releaseCalls.push(l.epoch);
        return { id: "h2a-lh05-sv", generation: "gen-1", incarnation: "inc-1", controllerEpoch: l.epoch };
      },
      async readOutput() {
        return replay("h2a-lh05-sv", 1, "");
      },
      async state() {
        return {
          ...running("h2a-lh05-sv", true),
          generation: "gen-1",
          incarnation: "inc-1",
          holderKind: switchedToRemote ? "remote" : "human",
          controllerEpoch: switchedToRemote ? 2 : 1,
          stopSignal: null,
        };
      },
      async write(_l, data) {
        writeCount += 1;
        if (writeCount === 1) return firstWriteBlocked;
        writes.push(data);
      },
      async resize(_l, cols, rows) {
        resizes.push({ cols, rows });
      },
      close() {},
    };

    const view = createSessionView({
      sessionId: "h2a-lh05-sv",
      stdout: stdout as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      delay: async () => {},
      tty: "/dev/pts/1",
      remoteObserver: true,
      statusBar: {
        ...noopStatusBar(stdout),
        setObserverBanner: (b) => {
          banners.push(b);
          return true;
        },
      },
    });

    await view.connectAndAcquire(async () => client);
    expect(view.observing).toBe(false);
    // Queue 3 blocks: first in flight, two queued; split UTF-8 prefix before switch
    view.enqueueInput(Buffer.from([0xe2, 0x82]));
    view.enqueueInput(Buffer.from("queued-1"));
    view.enqueueInput(Buffer.from("queued-2"));
    switchedToRemote = true;
    expect(view.handleRemoteSwitchState({
      ...running("h2a-lh05-sv", true),
      generation: "gen-1",
      incarnation: "inc-1",
      holderKind: "remote",
      controllerEpoch: 2,
      stopSignal: null,
    })).toBe(true);
    expect(view.observing).toBe(true);
    expect(view.pendingInputBytes).toBe(0);
    expect(releaseCalls).toEqual([]);
    expect(banners).toEqual(["remote control active — remote.sent-tech.ca — type to take back"]);

    // Resize while observing must not issue client resize
    resizes.length = 0;
    view.sendChildResize();
    expect(resizes).toEqual([]);

    rejectFirstWrite(new Error("aborted"));
    await view.drainInputPump();
    expect(view.pendingInputBytes).toBe(0);

    // Output split CSI c across two replays is filtered
    view.feedReplay(replay("h2a-lh05-sv", 2, "A\x1b["));
    view.feedReplay(replay("h2a-lh05-sv", 3, "cB"));
    expect(stdout.chunks.join("")).toBe("AB");

    // Report is ignored; keystroke takes back and is discarded, UTF-8 decoder was reset
    view.enqueueInput(Buffer.from("\x1b[I"));
    expect(acquireCalls.length).toBe(1);
    view.enqueueInput(Buffer.from("x"));
    await vi.waitFor(() => expect(view.observing).toBe(false));
    expect(acquireCalls.at(-1)).toMatchObject({ takeover: true });
    view.enqueueInput(Buffer.from("y"));
    await view.drainInputPump();
    expect(writes).toEqual(["y"]);
    expect(banners.at(-1)).toBeUndefined();
    view.dispose();
  });

  it("LH-05 handles concurrent stale-lease write/resize, 25ms pending timer, bracketed paste discard, and launch/reconnect modes", async () => {
    const { NativeTerminalRemoteError } = await import("./protocol.js");

    // 1. Concurrent write rejection with keystroke vs report-only, plus bracketed paste discard
    const stdout1 = new FakeOutput();
    const writes1: string[] = [];
    const acquireCalls1: Array<Record<string, unknown>> = [];
    const lease1: NativeTerminalControllerLease = {
      role: "controller",
      id: "h2a-lh05-c",
      generation: "gen-1",
      incarnation: "inc-1",
      controllerId: "ctrl-1",
      epoch: 1,
    };
    const lease2: NativeTerminalControllerLease = { ...lease1, epoch: 3 };
    let holderKind1: "human" | "remote" = "human";
    let rejectWrite1!: (err: Error) => void;
    let writeCall1 = 0;
    let rejectNextResize1 = false;

    const client1: AttachClient = {
      async acquireController(_id, _cid, _act, opts) {
        acquireCalls1.push(opts as Record<string, unknown>);
        if ((opts as { takeover?: boolean }).takeover) holderKind1 = "human";
        return acquireCalls1.length === 1 ? lease1 : lease2;
      },
      async releaseController(l) {
        return { id: "h2a-lh05-c", generation: "gen-1", incarnation: "inc-1", controllerEpoch: l.epoch };
      },
      async readOutput() {
        return replay("h2a-lh05-c", 1, "");
      },
      async state() {
        return {
          ...running("h2a-lh05-c", true),
          generation: "gen-1",
          incarnation: "inc-1",
          holderKind: holderKind1,
          controllerEpoch: holderKind1 === "remote" ? 2 : 1,
          stopSignal: null,
        };
      },
      async write(_l, data) {
        writeCall1 += 1;
        if (writeCall1 === 1) {
          return new Promise<void>((_, reject) => {
            rejectWrite1 = reject;
          });
        }
        writes1.push(data);
      },
      async resize() {
        if (rejectNextResize1) {
          throw new NativeTerminalRemoteError("operation-failed", "stale terminal controller lease");
        }
      },
      close() {},
    };

    const view1 = createSessionView({
      sessionId: "h2a-lh05-c",
      stdout: stdout1 as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      delay: async () => {},
      tty: "/dev/pts/1",
      remoteObserver: true,
      statusBar: noopStatusBar(stdout1),
    });
    await view1.connectAndAcquire(async () => client1);
    // Report rejected on stale lease while remote holds -> observer without takeback
    holderKind1 = "remote";
    view1.enqueueInput(Buffer.from("\x1b[I"));
    rejectWrite1(new NativeTerminalRemoteError("operation-failed", "stale terminal controller lease"));
    await view1.drainInputPump();
    await vi.waitFor(() => expect(view1.observing).toBe(true));
    expect(acquireCalls1.length).toBe(1);
    expect(stdout1.chunks.join("")).toContain("[h2a] remote control active");

    // Bracketed paste across 3 chunks: none of paste written, block after close is written
    view1.enqueueInput(Buffer.from("\x1b[200~part1"));
    view1.enqueueInput(Buffer.from("part2"));
    view1.enqueueInput(Buffer.from("part3\x1b[201~"));
    await vi.waitFor(() => expect(view1.observing).toBe(false));
    view1.enqueueInput(Buffer.from("after"));
    await view1.drainInputPump();
    expect(writes1).toEqual(["after"]);
    view1.dispose();

    // 2. Concurrent resize stale-lease + remote -> enters observer without takeback; 25ms ESC timer
    const stdout2 = new FakeOutput();
    let releaseDelay!: () => void;
    let timerArmed = 0;
    const view2 = createSessionView({
      sessionId: "h2a-lh05-t",
      stdout: stdout2 as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      delay: () => {
        timerArmed += 1;
        return new Promise<void>((resolve) => {
          releaseDelay = resolve;
        });
      },
      tty: "/dev/pts/1",
      remoteObserver: true,
      statusBar: noopStatusBar(stdout2),
    });
    holderKind1 = "human";
    writeCall1 = 0;
    rejectNextResize1 = false;
    await view2.connectAndAcquire(async () => client1);
    const acquireCountBeforeResize = acquireCalls1.length;
    holderKind1 = "remote";
    rejectNextResize1 = true;
    view2.sendChildResize();
    await vi.waitFor(() => expect(view2.observing).toBe(true));
    rejectNextResize1 = false;
    expect(acquireCalls1.length).toBe(acquireCountBeforeResize);

    // ESC followed by focus report cancels timer -> zero takeback
    view2.enqueueInput(Buffer.from([0x1b]));
    expect(timerArmed).toBe(1);
    view2.enqueueInput(Buffer.from("[I"));
    releaseDelay();
    await Promise.resolve();
    await Promise.resolve();
    expect(view2.observing).toBe(true);

    // Bare ESC expires at 25ms -> triggers takeback
    view2.enqueueInput(Buffer.from([0x1b]));
    expect(timerArmed).toBe(2);
    releaseDelay();
    await vi.waitFor(() => expect(view2.observing).toBe(false));
    view2.dispose();

    // 3. Launch under remote, launch race, --takeover, and passive reconnect
    const stdout3 = new FakeOutput();
    const calls3: Array<Record<string, unknown>> = [];
    let launchPhase: "remote" | "race-none-then-remote" | "none" = "remote";
    let closeCalls3 = 0;
    const client3: AttachClient = {
      async acquireController(_id, _cid, _act, opts) {
        calls3.push(opts as Record<string, unknown>);
        if (launchPhase === "race-none-then-remote" && !(opts as { takeover?: boolean }).takeover) {
          launchPhase = "remote";
          throw new NativeTerminalRemoteError("operation-failed", "terminal session already has a controller");
        }
        return { ...lease1, epoch: 5 };
      },
      async releaseController(l) {
        return { id: "h2a-lh05-l", generation: "gen-1", incarnation: "inc-1", controllerEpoch: l.epoch };
      },
      async readOutput() {
        return replay("h2a-lh05-l", 1, "");
      },
      async state() {
        return {
          ...running("h2a-lh05-l", launchPhase !== "none"),
          generation: "gen-1",
          incarnation: "inc-1",
          holderKind: launchPhase === "remote" ? "remote" : "none",
          controllerEpoch: 4,
          stopSignal: null,
        };
      },
      async write() {},
      async resize() {},
      close() {
        closeCalls3 += 1;
      },
    };

    const view3 = createSessionView({
      sessionId: "h2a-lh05-l",
      stdout: stdout3 as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      delay: async () => {},
      tty: "/dev/pts/1",
      remoteObserver: true,
      statusBar: noopStatusBar(stdout3),
    });
    await view3.connectAndAcquire(async () => client3);
    expect(view3.observing).toBe(true);
    expect(calls3.length).toBe(0);
    // clearObserverForExit closes observerClient before clearing reference
    view3.clearObserverForExit();
    expect(closeCalls3).toBe(1);
    expect(view3.observerClient).toBeUndefined();

    // Launch race: state=none -> acquire throws already has a controller -> reread=remote -> observer
    launchPhase = "race-none-then-remote";
    const viewRace = createSessionView({
      sessionId: "h2a-lh05-l",
      stdout: stdout3 as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      delay: async () => {},
      tty: "/dev/pts/1",
      remoteObserver: true,
      statusBar: noopStatusBar(stdout3),
    });
    await viewRace.connectAndAcquire(async () => client3);
    expect(viewRace.observing).toBe(true);
    viewRace.markObserverTransportFailure(client3, new Error("socket closed"));
    expect(viewRace.wasObservingBeforeReconnect).toBe(true);
    // Reconnect when holder became none uses passive: true
    launchPhase = "none";
    await viewRace.connectAndAcquire(async () => client3);
    expect(viewRace.observing).toBe(false);
    expect(calls3.at(-1)).toMatchObject({ passive: true });
    viewRace.dispose();

    // --takeover under remote takes immediately without banner
    launchPhase = "remote";
    const stdoutTakeover = new FakeOutput();
    const viewTakeover = createSessionView({
      sessionId: "h2a-lh05-l",
      stdout: stdoutTakeover as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      delay: async () => {},
      tty: "/dev/pts/1",
      takeover: true,
      remoteObserver: true,
      statusBar: noopStatusBar(stdoutTakeover),
    });
    await viewTakeover.connectAndAcquire(async () => client3);
    expect(viewTakeover.observing).toBe(false);
    expect(stdoutTakeover.chunks.join("")).not.toContain("remote control active");
    viewTakeover.dispose();

    // remoteObserver: false keeps existing controllerChanged detach behavior
    const stdoutOff = new FakeOutput();
    const viewOff = createSessionView({
      sessionId: "h2a-lh05-off",
      stdout: stdoutOff as unknown as NodeJS.WriteStream,
      now: () => 1_000,
      tty: "/dev/pts/1",
      remoteObserver: false,
      statusBar: noopStatusBar(stdoutOff),
    });
    expect(viewOff.controllerChanged({ ...running("h2a-lh05-off", true), holderKind: "remote", controllerEpoch: 2 }, lease1)).toBe(true);
    expect(viewOff.terminalEnded).toBe(true);
    viewOff.dispose();
  });
});
