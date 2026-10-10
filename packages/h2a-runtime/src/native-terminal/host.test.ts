// @ts-ignore Shared JS test isolation helper.
import { setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import {
  persistNativeTerminalPgid,
  pruneNativeTerminalPgidEntry,
  readNativeTerminalPgid,
} from "../registry.js";
import {
  groupIsOnlyZombies,
  NativeTerminalHost,
  posixProcessGroupReaper,
  reconcileDeadHostOrphans,
  type NativeTerminalProcFrame,
  type NativeTerminalProcessGroupReaper,
} from "./host.js";
import type { NativeTerminalStopSignal } from "./protocol.js";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Find a REAL, currently-alive process group this test process does not own
 * (a root-owned daemon on a typical Linux host) so that
 * `process.kill(-pgid, 0)` genuinely raises EPERM ("the group exists, I may
 * not signal it") — the exact non-ESRCH condition
 * posixProcessGroupReaper.isGroupAlive's catch branch must treat as ALIVE,
 * never dead. Scans /proc directly (mirrors the parsing
 * posixProcessGroupReaper.describeGroup already does). Returns null if no
 * such candidate exists in this environment (e.g. running as root, where
 * every kill(-pgid,0) succeeds instead of EPERM-ing, or no /proc at all).
 */
function findEpermProbeCandidatePgid(): number | null {
  if (process.platform !== "linux") return null;
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    let ruid: string | undefined;
    try {
      const status = readFileSync(`/proc/${name}/status`, "utf8");
      const uidLine = status
        .split("\n")
        .find((line) => line.startsWith("Uid:"));
      ruid = uidLine?.split(/\s+/)[1];
    } catch {
      continue;
    }
    if (ruid !== "0") continue; // only interested in groups we do NOT own
    let pgrp: number;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      const fields = stat.slice(commandEnd + 2).split(" ");
      pgrp = Number(fields[2]);
    } catch {
      continue;
    }
    // pgrp 0: unmappable across this process's pid-namespace view. pgrp 1:
    // kill(-1, sig) has special broadcast semantics in POSIX, not a group
    // target — never usable as a probe candidate.
    if (!Number.isInteger(pgrp) || pgrp <= 1) continue;
    try {
      process.kill(-pgrp, 0);
      // No throw: we DO have permission (e.g. running as root) — not usable
      // to exercise the EPERM branch; keep looking.
      continue;
    } catch (error) {
      if (isErrnoException(error) && error.code === "EPERM") return pgrp;
      // ESRCH (group gone mid-scan) or anything else: try the next one.
      continue;
    }
  }
  return null;
}

// Scratch dir inside the package (never /tmp), like the other test suites.
const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".test-scratch",
  "native-terminal-host",
);

let scratch: string;
let registryPath: string;
// Real processes a test starts to observe real /proc states. They outlive the
// assertions, so this suite owns their cleanup even when one aborts the test.
const strayProcesses = new Set<ChildProcess>();

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "h-"));
  registryPath = join(scratch, "registry.json");
});

afterEach(() => {
  for (const child of strayProcesses) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Not a group leader, or already gone.
      }
    }
    child.kill("SIGKILL");
  }
  strayProcesses.clear();
  rmSync(scratch, { recursive: true, force: true });
});

/** Is a C compiler available? Gates the one real multithreaded-zombie case. */
const HAS_CC =
  process.platform === "linux" &&
  spawnSync("cc", ["--version"], { stdio: "ignore" }).status === 0;

/**
 * One `/proc/<pid>/stat` line, in the REAL kernel layout the census parses:
 * field 1 pid, field 2 `comm` (parenthesized, may contain spaces), field 3
 * state, field 4 ppid, field 5 pgrp, then filler. The `comm` below deliberately
 * carries a space and a paren so a fixture exercises the same "anchor on the
 * LAST ') '" rule the real reader documents.
 */
function statLine(pid: number, state: string, pgrp: number): string {
  const filler = Array.from({ length: 30 }, () => "0").join(" ");
  return `${pid} (node (pty) host) ${state} 1 ${pgrp} ${filler}\n`;
}

/**
 * Build a `/proc`-shaped fixture tree the census can be pointed at, so the
 * multithreaded-zombie shape (`Zl`: leader task exited, another task still
 * running) is testable WITHOUT a compiler — the real-process case below is
 * gated on `cc` and skipped where there is none.
 *
 * Every process gets a `task/` directory: with no explicit `tasks`, a single
 * task whose state is the process state (an ordinary single-threaded process).
 * `self/mountinfo` is always written because the census refuses to answer at
 * all when it cannot check the proc mount for `hidepid`.
 */
function procFixture(spec: {
  hidepid?: string;
  mountinfo?: string;
  processes: ReadonlyArray<{
    pid: number;
    pgrp: number;
    state: string;
    tasks?: ReadonlyArray<{ tid: number; state: string }>;
  }>;
}): string {
  const root = mkdtempSync(join(scratch, "proc-"));
  mkdirSync(join(root, "self"), { recursive: true });
  writeFileSync(
    join(root, "self", "mountinfo"),
    spec.mountinfo ??
      `54 46 0:25 / ${root} rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw${
        spec.hidepid === undefined ? "" : `,hidepid=${spec.hidepid}`
      }\n`,
  );
  for (const entry of spec.processes) {
    const dir = join(root, String(entry.pid));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stat"), statLine(entry.pid, entry.state, entry.pgrp));
    const tasks = entry.tasks ?? [{ tid: entry.pid, state: entry.state }];
    for (const task of tasks) {
      const taskDir = join(dir, "task", String(task.tid));
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(
        join(taskDir, "stat"),
        statLine(task.tid, task.state, entry.pgrp),
      );
    }
  }
  return root;
}

/** `/proc/<pid>/stat` field 3 (state), or undefined when unreadable. */
function processState(pid: number): string | undefined {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    return raw.slice(raw.lastIndexOf(") ") + 2).split(" ")[0];
  } catch {
    return undefined;
  }
}

/** States of every /proc member of `pgid` (field 5 is the pgrp). */
function processGroupStates(pgid: number): string[] {
  const states: string[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const raw = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = raw.slice(raw.lastIndexOf(") ") + 2).split(" ");
      if (Number(fields[2]) === pgid) states.push(fields[0]!);
    } catch {
      // Exited mid-scan.
    }
  }
  return states;
}

async function eventuallyTrue(read: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition did not become true within 2s");
}

async function eventuallyNumber(read: () => number): Promise<number> {
  let last = Number.NaN;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    last = read();
    if (Number.isSafeInteger(last) && last > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no usable number was produced within 2s (last: ${last})`);
}

/**
 * A fake group reaper: NEVER sends real signals at StubPty's fabricated
 * pids/pgids (which are not real OS process groups). `killGroup` marks the
 * pgid dead immediately, matching how a real group-SIGKILL behaves once the
 * OS actually reaps it — fast and deterministic for a unit test.
 */
function fakeReaper(): {
  reaper: NativeTerminalProcessGroupReaper;
  killGroup: ReturnType<typeof vi.fn<(pgid: number, signal: NativeTerminalStopSignal) => void>>;
  alive: Set<number>;
} {
  const alive = new Set<number>();
  const killGroup = vi.fn((pgid: number, _signal: NativeTerminalStopSignal) => {
    alive.delete(pgid);
  });
  return {
    reaper: {
      killGroup,
      isGroupAlive: (pgid: number) => alive.has(pgid),
      describeGroup: () => "fake-reaper: no real /proc backing",
    },
    killGroup,
    alive,
  };
}

/**
 * A fake group-leader-start-time reader: NEVER touches real /proc for
 * StubPty's fabricated pgids. Returns `defaultValue` for any pid that hasn't
 * been explicitly overridden via `values`, so `host.create()` (which reads
 * this at spawn time, before the test can learn the fabricated pgid) gets a
 * deterministic baseline for free; the test then mutates `values` for that
 * pgid to simulate the CURRENT read differing (recycled) or failing
 * (leader-absent) at kill-time.
 */
function fakeLeaderStartTimeReader(defaultValue: number): {
  read: (pid: number) => number | undefined;
  values: Map<number, number | undefined>;
} {
  const values = new Map<number, number | undefined>();
  return {
    read: (pid) => (values.has(pid) ? values.get(pid) : defaultValue),
    values,
  };
}

/**
 * A fake group-member-token probe: NEVER touches real /proc for StubPty's
 * fabricated pgids. `carriedTokens` maps a pgid to the ONE token some
 * (unspecified) surviving member of that group currently carries — a test
 * sets it to the SAME value it persisted to simulate a real member found
 * carrying it, a DIFFERENT value (or leaves it unset) to simulate none
 * doing so.
 */
function fakeGroupMemberTokenProbe(): {
  find: (pgid: number, expectedToken: string) => boolean;
  carriedTokens: Map<number, string>;
} {
  const carriedTokens = new Map<number, string>();
  return {
    find: (pgid, expectedToken) => carriedTokens.get(pgid) === expectedToken,
    carriedTokens,
  };
}

class StubPty implements PtyHandle {
  static #nextPid = 41000;
  readonly pid = StubPty.#nextPid++;
  readonly pgid = this.pid;
  readonly cols = 80;
  readonly rows = 24;
  readonly #dataHandlers = new Set<(chunk: string) => void>();
  readonly #exitHandlers = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData(handler: (chunk: string) => void): { dispose(): void } {
    this.#dataHandlers.add(handler);
    return { dispose: () => this.#dataHandlers.delete(handler) };
  }

  onExit(
    handler: (event: { exitCode: number; signal?: number }) => void,
  ): { dispose(): void } {
    this.#exitHandlers.add(handler);
    return { dispose: () => this.#exitHandlers.delete(handler) };
  }

  emitData(chunk: string): void {
    for (const handler of this.#dataHandlers) handler(chunk);
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const handler of this.#exitHandlers) handler(event);
  }
}

function stubSpawner(): {
  spawner: PtySpawner;
  ptys: Map<string, StubPty>;
} {
  const ptys = new Map<string, StubPty>();
  return {
    ptys,
    spawner: (options) => {
      const pty = new StubPty();
      ptys.set(options.command, pty);
      return pty;
    },
  };
}

function createSession(host: NativeTerminalHost, id: string): void {
  host.create({
    id,
    command: id,
    args: [],
    cwd: `/workspace/${id}`,
    env: {},
    cols: 80,
    rows: 24,
  });
}

describe("NativeTerminalHost", () => {
  it("should use reserved launch ownership and reject a different host before spawning", () => {
    const { spawner } = stubSpawner();
    const spawn = vi.fn(spawner);
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath, spawner: spawn });
    const options = { id: "reserved", command: "reserved", args: [], cwd: "/workspace", env: {}, cols: 80, rows: 24,
      launchFence: { generation: "other", incarnation: "12345678-1234-1234-1234-123456789abc" } };
    expect(() => host.create(options)).toThrow("invalid native launch fence");
    expect(spawn).not.toHaveBeenCalled();
    const state = host.create({ ...options, launchFence: { ...options.launchFence, generation: "g" } });
    expect(state.incarnation).toBe(options.launchFence.incarnation);
    expect(state.generation).toBe("g");
  });
  it("should keep output and exit lifecycle independent across sessions", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-1",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });

    createSession(host, "alpha");
    createSession(host, "beta");
    ptys.get("alpha")!.emitData("alpha-output");
    ptys.get("beta")!.emitData("beta-output");
    ptys.get("alpha")!.emitExit({ exitCode: 7, signal: 15 });
    ptys.get("alpha")!.emitData("ignored-after-exit");
    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    ptys.get("beta")!.emitData("-still-running");

    expect(host.readOutput("alpha", 0)).toEqual({
      generation: "host-generation-1",
      incarnation: expect.any(String),
      chunks: [{ seq: 1, data: "alpha-output" }],
      gap: null,
      latestSeq: 1,
    });
    expect(host.readOutput("beta", 0)).toEqual({
      generation: "host-generation-1",
      incarnation: expect.any(String),
      chunks: [
        { seq: 1, data: "beta-output" },
        { seq: 2, data: "-still-running" },
      ],
      gap: null,
      latestSeq: 2,
    });
    expect(host.list()).toEqual([
      {
        id: "alpha",
        generation: "host-generation-1",
        incarnation: expect.any(String),
        pid: expect.any(Number),
        status: "exited",
        latestSeq: 1,
        exit: { exitCode: 7, signal: 15 },
        stopSignal: null,
        controlled: false,
        lastHumanActivityAt: null,
      },
      {
        id: "beta",
        generation: "host-generation-1",
        incarnation: expect.any(String),
        pid: expect.any(Number),
        status: "running",
        latestSeq: 2,
        exit: null,
        stopSignal: null,
        controlled: false,
        lastHumanActivityAt: null,
      },
    ]);
  });

  it("should answer DSR cursor queries with a cursor-position report", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-dsr",
      replayBytesPerSession: 4096,
      spawner,
      registryPath,
    });

    createSession(host, "tui");
    const pty = ptys.get("tui")!;
    pty.emitData("banner\x1b[6n");
    expect(pty.write).toHaveBeenCalledTimes(1);
    expect(pty.write).toHaveBeenLastCalledWith("\x1b[1;1R");

    // A query split across chunks is still answered exactly once.
    pty.emitData("pre\x1b[");
    expect(pty.write).toHaveBeenCalledTimes(1);
    pty.emitData("6npost");
    expect(pty.write).toHaveBeenCalledTimes(2);

    // Ordinary output (incl. a lone ESC) triggers no answer.
    pty.emitData("plain\x1b[row");
    expect(pty.write).toHaveBeenCalledTimes(2);

    // No answer after exit.
    pty.emitExit({ exitCode: 0 });
    pty.emitData("\x1b[6n");
    expect(pty.write).toHaveBeenCalledTimes(2);
  });

  it("should let the controller escalate one stopping session without affecting another", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-2",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });

    createSession(host, "alpha");
    createSession(host, "beta");
    const lease = host.acquireController("alpha", "stopper");

    expect(host.stop(lease, "SIGTERM")).toMatchObject({
      id: "alpha",
      status: "stopping",
      stopSignal: "SIGTERM",
    });
    expect(host.stop(lease, "SIGKILL")).toMatchObject({
      id: "alpha",
      status: "stopping",
      stopSignal: "SIGKILL",
    });
    expect(ptys.get("alpha")!.kill).toHaveBeenCalledTimes(2);
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(ptys.get("beta")!.kill).not.toHaveBeenCalled();

    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    ptys.get("beta")!.emitData("alive");

    expect(host.state("alpha")).toMatchObject({
      status: "exited",
      exit: { exitCode: 0 },
    });
    expect(host.state("beta")).toMatchObject({
      status: "running",
      latestSeq: 1,
    });
  });

  it("should force-stop every non-exited session during bounded host shutdown", async () => {
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const host = new NativeTerminalHost({
      generation: "host-generation-force",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
    });
    createSession(host, "alpha");
    createSession(host, "beta");
    alive.add(ptys.get("alpha")!.pgid);
    alive.add(ptys.get("beta")!.pgid);

    const lease = host.acquireController("alpha", "stopper");
    host.stop(lease, "SIGTERM");
    // forceStopAll is the FORCE path: it emits the group SIGKILL itself, from
    // the parent, via the injected reaper — it must NOT go through the pty's
    // own kill() (that would depend on the victim's own trap handler, the
    // bug this fix removes).
    expect(await host.forceStopAll("SIGKILL")).toEqual([
      expect.objectContaining({ id: "alpha", status: "stopping", stopSignal: "SIGKILL" }),
      expect.objectContaining({ id: "beta", status: "stopping", stopSignal: "SIGKILL" }),
    ]);
    // The single-session stop() above still used the pty's own kill() (SIGTERM) —
    // that graceful path is unchanged. forceStopAll must not have called it again.
    expect(ptys.get("alpha")!.kill).toHaveBeenCalledOnce();
    expect(ptys.get("alpha")!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(ptys.get("beta")!.kill).not.toHaveBeenCalled();
    // Instead, forceStopAll must have emitted a PARENT-side group kill for
    // both sessions' pgids, and waited for the reaper to confirm death.
    expect(killGroup).toHaveBeenCalledWith(ptys.get("alpha")!.pgid, "SIGKILL");
    expect(killGroup).toHaveBeenCalledWith(ptys.get("beta")!.pgid, "SIGKILL");
    expect(alive.size).toBe(0);
  });

  it("DURABLE_ROW_IS_PRUNED_WHEN_A_SESSIONS_PTY_EXITS_AND_ITS_GROUP_IS_CONFIRMED_EMPTY", async () => {
    // A durable row exists to make a session reapable AFTER its host died. A
    // row whose group the OS already reports empty makes no session reapable:
    // it is a stale record, and every one of them is re-examined at the next
    // host death, against whatever holds that pgid NUMBER by then. Prune it at
    // the moment it becomes stale instead of accumulating one row per session
    // a long-lived host ever created.
    const { spawner, ptys } = stubSpawner();
    const { reaper, alive } = fakeReaper();
    const host = new NativeTerminalHost({
      generation: "host-generation-prune-on-exit",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
    });
    createSession(host, "alpha");
    createSession(host, "beta");
    const alphaPgid = ptys.get("alpha")!.pgid;
    alive.add(ptys.get("beta")!.pgid); // beta's group stays alive
    expect(readNativeTerminalPgid("alpha", registryPath)).toMatchObject({
      status: "resolved",
      pgid: alphaPgid,
    });

    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    ptys.get("beta")!.emitExit({ exitCode: 0 });
    // The prune runs OFF node-pty's synchronous callback, on a timer (see
    // `#schedulePruneOfExitedSession`), so wait for the observable effect rather
    // than for a fixed delay.
    await eventuallyTrue(
      () => readNativeTerminalPgid("alpha", registryPath).status === "unresolved",
    );

    expect(readNativeTerminalPgid("alpha", registryPath)).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
    // beta's leader exited but its GROUP is still alive — the ordinary orphan
    // (a shell that exits leaving a backgrounded descendant). Its durable row
    // is the only way a later pass can reap that group: it must survive.
    expect(readNativeTerminalPgid("beta", registryPath)).toMatchObject({
      status: "resolved",
      pgid: ptys.get("beta")!.pgid,
    });
  });

  it("PTY_EXIT_PRUNE_NEVER_DELETES_A_ROW_REWRITTEN_UNDER_ITS_OWN_GROUP_CHECK", async () => {
    // The pgid comparison is not enough on its own if it is made OUTSIDE the
    // registry lock: the row can be rewritten between the read that matched and
    // the delete. The reaper's own liveness probe sits in that window, which is
    // what makes the race deterministic here. The delete must re-verify the
    // stored row under the lock and refuse to delete a row it no longer owns.
    const { spawner, ptys } = stubSpawner();
    const alive = new Set<number>();
    const logs: string[] = [];
    let livenessProbes = 0;
    const reaper: NativeTerminalProcessGroupReaper = {
      killGroup: vi.fn(),
      isGroupAlive: (pgid) => {
        livenessProbes += 1;
        // A LIVE host recreates session "alpha" under the same id, right after
        // this session's row was read and before its row would be deleted.
        persistNativeTerminalPgid("alpha", 32_999, registryPath, {
          pid: process.pid,
          startTime: 4_242,
          socketPath: "/sockets/live.sock",
        });
        return alive.has(pgid);
      },
      describeGroup: () => "fake-reaper: no real /proc backing",
    };
    const host = new NativeTerminalHost({
      generation: "host-generation-prune-toctou",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => logs.push(line),
    });
    createSession(host, "alpha");

    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    // The prune runs on a timer; its liveness probe is the signal that it ran.
    await eventuallyTrue(() => livenessProbes > 0);

    expect(readNativeTerminalPgid("alpha", registryPath)).toMatchObject({
      status: "resolved",
      pgid: 32_999,
    });
  });

  it("PTY_EXIT_NEVER_WAITS_FOR_THE_REGISTRY_LOCK_ON_NODE_PTYS_SYNCHRONOUS_CALLBACK", async () => {
    // `onExit` is node-pty's own synchronous callback, on this host's event loop
    // — the loop that serves every other session's I/O. The registry lock is a
    // bounded BUSY-WAIT (LOCK_MAX_WAIT_MS = 4 s, file-lock.ts), so taking it
    // inline makes a contended store freeze the whole host for seconds, for what
    // is only row hygiene. The prune must therefore never wait for the lock on
    // this path; it is retried off the callback instead.
    const { spawner, ptys } = stubSpawner();
    const { reaper } = fakeReaper(); // nothing marked alive: every group is empty
    const logs: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-prune-no-lock-wait",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => logs.push(line),
    });
    createSession(host, "alpha");
    // Another process holds the registry lock, freshly (so the staleness break
    // at 10 s cannot rescue the spin).
    const lockPath = `${registryPath}.lock`;
    writeFileSync(lockPath, "", { flag: "wx" });

    const before = Date.now();
    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    const elapsedInsideCallback = Date.now() - before;

    // 4 s of spin would be the failure; anything under a second proves the
    // callback did not wait for the lock at all.
    expect(elapsedInsideCallback).toBeLessThan(1_000);
    // The row is still there: nothing could be written while the lock is held.
    expect(readNativeTerminalPgid("alpha", registryPath)).toMatchObject({
      status: "resolved",
    });

    // The prune is retried off the callback, and — the lock never being released
    // here — eventually GIVES UP rather than block or spin. The row it leaves
    // behind is stale hygiene that any later pass re-derives from the group
    // itself, which is the deliberate trade.
    await eventuallyTrue(() => logs.some((line) => /giving up/i.test(line)));
    expect(readNativeTerminalPgid("alpha", registryPath)).toMatchObject({
      status: "resolved",
    });
    rmSync(lockPath, { force: true });
  });

  it("DURABLE_ROWS_ARE_PRUNED_FOR_EVERY_SESSION_FORCESTOPALL_PROVED_DEAD", async () => {
    // The graceful host-shutdown path ends in forceStopAll, which PROVES each
    // group empty before returning. A row kept past that proof is stale by
    // construction, so the host that proved it prunes it.
    const { spawner, ptys } = stubSpawner();
    const { reaper, alive } = fakeReaper();
    const host = new NativeTerminalHost({
      generation: "host-generation-prune-on-force-stop",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
    });
    createSession(host, "alpha");
    createSession(host, "beta");
    alive.add(ptys.get("alpha")!.pgid);
    alive.add(ptys.get("beta")!.pgid);

    await host.forceStopAll("SIGKILL");

    for (const id of ["alpha", "beta"]) {
      expect(readNativeTerminalPgid(id, registryPath)).toEqual({
        status: "unresolved",
        reason: expect.stringMatching(/no pgid recorded/i),
      });
    }
  });

  it("should WAIT for the reaper to confirm death, not resolve on the strength of merely emitting the signal (INV-1)", async () => {
    const { spawner, ptys } = stubSpawner();
    const alive = new Set<number>();
    // A reaper whose killGroup() emits the signal now but whose isGroupAlive()
    // only flips false a bit LATER (as a real OS group-kill does: the signal
    // is asynchronous, death is not instantaneous). If forceStopAll resolved
    // right after emitting the signal (INV-1 violated), this test would
    // observe BOTH a near-zero elapsed time AND the pgid still marked alive
    // at the moment forceStopAll resolves.
    const killGroup = vi.fn((pgid: number) => {
      setTimeout(() => alive.delete(pgid), 30);
    });
    const reaper: NativeTerminalProcessGroupReaper = {
      killGroup,
      isGroupAlive: (pgid) => alive.has(pgid),
      describeGroup: () => "fake-reaper: no real /proc backing",
    };
    const host = new NativeTerminalHost({
      generation: "host-generation-prove-death",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      forceKillPollIntervalMs: 5,
    });
    createSession(host, "alpha");
    alive.add(ptys.get("alpha")!.pgid);

    const before = Date.now();
    await host.forceStopAll("SIGKILL");
    const elapsedMs = Date.now() - before;

    expect(elapsedMs).toBeGreaterThanOrEqual(25);
    expect(alive.has(ptys.get("alpha")!.pgid)).toBe(false);
  });

  it("GROUP_LIVENESS_PROBE_TREATS_UNPROVABLE_AS_ALIVE_NEVER_DEAD", async () => {
    // WIRING guard (host-level): forceStopAll must not claim success when
    // the reaper's isGroupAlive() can never confirm the group dead — the
    // boolean-signal shape of "unprovable" that a conservative non-ESRCH
    // handler (e.g. EPERM) reports upstream. This test injects a fake
    // reaper and therefore does NOT exercise posixProcessGroupReaper's own
    // EPERM handling — see POSIX_GROUP_LIVENESS_PROBE_TREATS_EPERM_AS_ALIVE_NEVER_DEAD
    // below for the test that calls the real implementation directly. This
    // one proves the HOST's aggregation/timeout path treats "never reports
    // dead" as a failure, never a clean success — the ORIGINAL bug this fix
    // closes (an unprovable-but-alive group declared dead).
    const { spawner, ptys } = stubSpawner();
    const warnings: string[] = [];
    const killGroup = vi.fn();
    const reaper: NativeTerminalProcessGroupReaper = {
      killGroup,
      // Never resolves to dead, no matter how long we poll.
      isGroupAlive: () => true,
      describeGroup: () => "fake-reaper: group never confirmed dead",
    };
    const host = new NativeTerminalHost({
      generation: "host-generation-unprovable-wiring",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      forceKillTimeoutMs: 30,
      forceKillPollIntervalMs: 5,
    });
    createSession(host, "alpha");

    let caught: unknown;
    try {
      await host.forceStopAll("SIGKILL");
    } catch (error) {
      caught = error;
    }

    // Assert on the RESULT, not just the log: a clean "reaped" success here
    // would recreate the original bug.
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(1);
    expect(String(aggregate.errors[0])).toMatch(/did not confirm dead/i);
    expect(killGroup).toHaveBeenCalledWith(ptys.get("alpha")!.pgid, "SIGKILL");
    expect(warnings.some((line) => /STILL ALIVE/.test(line))).toBe(true);
    expect(
      warnings.some((line) => /confirmed pgid=.*reaped/i.test(line)),
    ).toBe(false);
  });

  it("POSIX_GROUP_LIVENESS_PROBE_TREATS_EPERM_AS_ALIVE_NEVER_DEAD", (ctx) => {
    // PROBE guard (real implementation): the wiring test above injects a
    // fake reaper and is therefore blind to a regression INSIDE
    // posixProcessGroupReaper.isGroupAlive's own non-ESRCH handling (an
    // injected fake never calls it — mutating it would not move that test).
    // This test exercises the REAL exported posixProcessGroupReaper against
    // a REAL non-ESRCH failure: a root-owned process group's pgid, probed
    // from this unprivileged test process, genuinely raises EPERM ("the
    // group exists, you may not signal it"). isGroupAlive must treat that
    // as ALIVE (return true), never as dead.
    const pgid = findEpermProbeCandidatePgid();
    if (pgid === null) {
      ctx.skip(
        "no root-owned process group produced EPERM on process.kill(-pgid,0) in this " +
          "environment (running as root, no /proc, or no qualifying process found) — " +
          "cannot exercise the real non-ESRCH branch here",
      );
    }
    // Re-confirm immediately before asserting: closes the race window
    // between discovery above and use here (the candidate must still be
    // alive-but-unsignallable right now, not just at discovery time).
    let stillEperm = false;
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      stillEperm = isErrnoException(error) && error.code === "EPERM";
    }
    if (!stillEperm) {
      ctx.skip(
        `candidate pgid=${pgid} no longer raises EPERM (process likely exited between discovery and use)`,
      );
    }

    expect(posixProcessGroupReaper.isGroupAlive(pgid)).toBe(true);
  });

  it("should refuse to reap and warn loudly when a session's pgid cannot be resolved from the registry, killing nothing", async () => {
    const { spawner } = stubSpawner();
    const { reaper, killGroup } = fakeReaper();
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-orphan-refuse",
      replayBytesPerSession: 32,
      spawner,
      // A registry path with NOTHING recorded for this session id — a fresh
      // host that never saw this session AND finds no durable pgid for it.
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
    });
    // Make the registry file exist and be VALID first (via an unrelated
    // session), so this test proves the "registry readable, no pgid for THIS
    // session" branch specifically — not the "file absent" branch, which
    // loadRegistryWithDiagnostics also reports as known:false and is covered
    // by the next test.
    createSession(host, "unrelated-session");

    const outcome = await host.reapOrphan("never-created-session");

    expect(outcome).toEqual({
      sessionId: "never-created-session",
      status: "refused",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
    // Never guess a pgid: killing the wrong process group is irreversible.
    expect(killGroup).not.toHaveBeenCalled();
    // But never silently refuse either: a silent return here recreates the
    // invisible-orphan bug. The refusal must be LOUD.
    expect(warnings.some((line) =>
      /REFUSING/.test(line) &&
      /pgid could not be resolved/i.test(line) &&
      /PROCESSES MAY HAVE SURVIVED/i.test(line)
    )).toBe(true);

    // Cross-check against the registry reader directly: this really is the
    // "registry readable, but no pgid on record" branch, not a fluke.
    const lookup = readNativeTerminalPgid("never-created-session", registryPath);
    expect(lookup).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
  });

  it("should refuse to reap and warn loudly when the registry itself is unreadable (corrupt), killing nothing", async () => {
    const { spawner } = stubSpawner();
    const { reaper, killGroup } = fakeReaper();
    const warnings: string[] = [];
    // Deliberately corrupt: valid JSON but no `entries` array. This must
    // resolve as UNREADABLE (known:false), never as "known: zero entries" —
    // silently treating a corrupt file as "nothing recorded" would refuse to
    // reap without ever saying WHY, recreating the invisible-orphan bug.
    const corruptRegistryPath = join(scratch, "corrupt-registry.json");
    writeFileSync(corruptRegistryPath, JSON.stringify({ version: 1 }), "utf8");
    const host = new NativeTerminalHost({
      generation: "host-generation-orphan-unreadable",
      replayBytesPerSession: 32,
      spawner,
      registryPath: corruptRegistryPath,
      reaper,
      log: (line) => warnings.push(line),
    });

    const outcome = await host.reapOrphan("some-session");

    expect(outcome).toEqual({
      sessionId: "some-session",
      status: "refused",
      reason: expect.stringMatching(/registry unreadable/i),
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(warnings.some((line) =>
      /REFUSING/.test(line) && /PROCESSES MAY HAVE SURVIVED/i.test(line)
    )).toBe(true);
  });

  it("should refuse orphan reaping when process groups are unsupported", async () => {
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-unsupported-process-groups",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: () => 1000,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);

    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (platform === undefined) throw new Error("expected process.platform descriptor");
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      const outcome = await host.reapOrphan("alpha");

      expect(outcome).toEqual({
        sessionId: "alpha",
        status: "refused",
        reason: expect.stringMatching(/unsupported-process-groups/i),
        cause: "unsupported-process-groups",
      });
      expect(killGroup).not.toHaveBeenCalled();
      expect(warnings.some((line) =>
        /REFUSING/.test(line) &&
        /not supported/.test(line) &&
        /PROCESSES MAY HAVE SURVIVED/.test(line) &&
        line.includes("cause=unsupported-process-groups")
      )).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("PGID_GUARD_PROCEEDS_WITH_THE_KILL_WHEN_THE_GROUP_LEADER_IDENTITY_MATCHES", async () => {
    // INV-4 positive path: the persisted leader-start-time anchor and the
    // re-read at kill-time agree — the group is provably the one this row
    // was written for — so the guard must NOT block a legitimate reap.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { read } = fakeLeaderStartTimeReader(1000);
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-match",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      readLeaderStartTime: read,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "reaped",
      pgid,
      elapsedMs: expect.any(Number),
      verified: true,
    });
    expect(killGroup).toHaveBeenCalledWith(pgid, "SIGKILL");
    expect(host.pgidGuardCounters).toEqual({
      recycled: 0,
      staleBoot: 0,
      foreignFrame: 0,
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
      groupDrained: 0,
    });
  });

  it("PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_WAS_RECYCLED", async () => {
    // recycled: a persisted leader-start-time baseline exists, but the
    // CURRENT read at kill-time differs — the OS reused this pgid for an
    // unrelated (still alive) process since the row was written. Must
    // REFUSE, with the "recycled" cause counted and logged DISTINCTLY from
    // "leader-absent" (arch condition 1: never collapse the two).
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { read, values } = fakeLeaderStartTimeReader(1000);
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-recycled",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: read,
    });
    createSession(host, "alpha"); // persists pgidLeaderStartTime=1000 (the default)
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid); // an unrelated group now occupies pgid — very much alive
    values.set(pgid, 2000); // ...but its leader start-time does not match

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "refused",
      reason: expect.stringMatching(/recycled/i),
      cause: "recycled",
    });
    // The wiring counter-mutant: if the guard CALL were ever removed from
    // reapOrphan/#killGroupAndConfirmDead, this line is what would flip —
    // killGroup would fire despite the proven mismatch. Verified by hand:
    // temporarily deleting the `#verifyGroupLeaderIdentity` call in
    // #killGroupAndConfirmDead reddens this assertion; restoring it passes
    // again (see pgid-BUILD-REPORT.md for the demonstration transcript).
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters).toEqual({
      recycled: 1,
      staleBoot: 0,
      foreignFrame: 0,
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
      groupDrained: 0,
    });
    expect(warnings.some((line) =>
      /REFUSING/.test(line) &&
      /RECYCLED/i.test(line) &&
      line.includes("cause=recycled") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  it("PGID_GUARD_PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN_WHEN_THE_LEADER_IS_ABSENT", async () => {
    // token-verified: the leader is gone (unreadable — the ORDINARY orphan
    // this whole mechanism exists for: a shell that exits normally leaving
    // a backgrounded descendant), so there is no start-time left to compare
    // at all. A surviving GROUP MEMBER still carries the persisted session
    // token in its own environment — POSITIVE, independent proof of
    // membership — so the guard must PROCEED, not refuse.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { find, carriedTokens } = fakeGroupMemberTokenProbe();
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-token-verified",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: () => undefined, // leader always absent
      findGroupMemberToken: find,
    });
    createSession(host, "alpha"); // persists a random pgidGroupToken
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);

    const lookup = readNativeTerminalPgid("alpha", registryPath);
    if (lookup.status !== "resolved" || lookup.groupToken === undefined) {
      throw new Error("expected a resolved lookup with a persisted groupToken");
    }
    // Simulate a surviving descendant whose /proc/<pid>/environ still
    // carries the SAME token create() injected at spawn.
    carriedTokens.set(pgid, lookup.groupToken);

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "reaped",
      pgid,
      elapsedMs: expect.any(Number),
      verified: true,
    });
    expect(killGroup).toHaveBeenCalledWith(pgid, "SIGKILL");
    expect(host.pgidGuardCounters).toEqual({
      recycled: 0,
      staleBoot: 0,
      foreignFrame: 0,
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 1,
      zombieGroup: 0,
      groupDrained: 0,
    });
    expect(warnings.some((line) =>
      /PROCEEDING/.test(line) &&
      /surviving GROUP MEMBER/i.test(line) &&
      line.includes("cause=token-verified") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  /** Mutate one durable native-terminal row in place (a legacy/foreign row). */
  function patchDurableRow(
    sessionId: string,
    patch: (row: Record<string, unknown>) => void,
  ): void {
    const store = JSON.parse(readFileSync(registryPath, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    const row = store.entries.find(
      (entry) => entry.id === `native-terminal-pty:${sessionId}`,
    );
    if (row === undefined) throw new Error(`no durable row for ${sessionId}`);
    patch(row);
    writeFileSync(registryPath, JSON.stringify(store, null, 2), "utf8");
  }

  it("PGID_GUARD_REFUSES_INSTEAD_OF_PROVING_RECYCLED_WHEN_THE_ROW_IS_FROM_ANOTHER_PID_NAMESPACE", async () => {
    // "This pgid is now held by a live leader of a DIFFERENT start-time, so the
    // original group is gone" is a kernel argument about ONE pid namespace and
    // ONE boot: a pid is resolved in the reader's pid namespace, and
    // `/proc/<pid>/stat`'s start-time is ticks since the reader's boot. A row
    // written on the other side of a namespace boundary (a container sharing the
    // config home) or before a reboot says nothing about the pid this reader
    // sees under the same number. Granting `recycled` there PRUNES the row and
    // releases the socket on a proof that does not hold; and a coincidental
    // start-time MATCH would authorize a group SIGKILL at an unrelated group.
    // Both must fail closed instead — under `foreign-frame`, not
    // `membership-unprovable`: a local inspection of that pgid describes this
    // reader's process space, not the one that wrote the row.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { read, values } = fakeLeaderStartTimeReader(1000);
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-foreign-namespace",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: read,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    // The row was written in a DIFFERENT pid namespace than this reader's.
    patchDurableRow("alpha", (row) => {
      row.pgidPidNamespace = "4026599999";
    });
    alive.add(pgid);
    values.set(pgid, 2000); // a live leader whose start-time differs

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "refused",
      reason: expect.stringMatching(/foreign-frame/i),
      cause: "foreign-frame",
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters).toEqual({
      recycled: 0,
      staleBoot: 0,
      foreignFrame: 1,
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
      groupDrained: 0,
    });
    expect(
      warnings.some(
        (line) =>
          /REFUSING/.test(line) &&
          /pid namespace|boot/i.test(line) &&
          line.includes("cause=foreign-frame") &&
          line.includes("sessionId=alpha"),
      ),
    ).toBe(true);
  });

  it("PGID_GUARD_GRANTS_NO_RECYCLED_PROOF_TO_A_ROW_WITH_NO_NAMESPACE_ANCHOR", async () => {
    // A row written before this anchor existed cannot be pinned to a namespace
    // or a boot at all, so the `recycled` PROOF is not available for it: the
    // refusal stays, but as the blocking `membership-unprovable` — the behaviour
    // that predates the `recycled` outcome — instead of pruning the row.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { read, values } = fakeLeaderStartTimeReader(1000);
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-legacy-anchor",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: read,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    patchDurableRow("alpha", (row) => {
      delete row.pgidPidNamespace;
      delete row.pgidBootId;
    });
    alive.add(pgid);
    values.set(pgid, 2000);

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toMatchObject({
      sessionId: "alpha",
      status: "refused",
      cause: "membership-unprovable",
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters.recycled).toBe(0);
    expect(host.pgidGuardCounters.membershipUnprovable).toBe(1);
    // The row is kept: nothing proved this group gone.
    expect(readNativeTerminalPgid("alpha", registryPath)).toMatchObject({
      status: "resolved",
      pgid,
    });
  });

  it("PGID_GUARD_REFUSES_A_KILL_WHEN_THE_LEADER_IS_ABSENT_AND_NO_MEMBER_CARRIES_THE_TOKEN", async () => {
    // membership-unprovable: the leader is gone AND no surviving member
    // carries the persisted session token — possibly our own already-dead
    // orphan, possibly not; either way there is no POSITIVE proof by any
    // means, so REFUSE (conservative refuse-and-leak), counted and logged
    // under a cause DISTINCT from "recycled" (arch condition 1: never
    // collapse "positively someone else's" with "cannot prove it is ours").
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { find } = fakeGroupMemberTokenProbe(); // empty map: nobody ever carries a matching token
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-membership-unprovable",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: () => undefined, // leader always absent
      findGroupMemberToken: find,
      // The group has at least one LIVE member, so the zombie re-check below
      // the token scan cannot rescue it: the refusal must stand.
      groupIsOnlyZombies: () => false,
    });
    createSession(host, "alpha"); // persists a groupToken, but nothing will ever carry it
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid); // something still reports alive under this pgid...

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "refused",
      reason: expect.stringMatching(/membership-unprovable/i),
      cause: "membership-unprovable",
    });
    // The wiring counter-mutant for the NEW token path: if the token
    // consultation were ever removed from #verifyGroupLeaderIdentity's
    // leader-absent branch (e.g. forced to a no-op), this is the assertion
    // that would flip — killGroup would fire despite no positive proof.
    // Verified by hand: forcing `this.#findGroupMemberToken` to a no-op
    // that always returns true reddens the OTHER new test above instead
    // (PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN would then wrongly
    // pass for the wrong reason); forcing it to always return false reddens
    // THIS one's sibling by turning a real proceed into a refusal — see
    // pgid-BUILD-REPORT.md for the demonstration transcript.
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters).toEqual({
      recycled: 0,
      staleBoot: 0,
      foreignFrame: 0,
      membershipUnprovable: 1,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
      groupDrained: 0,
    });
    expect(warnings.some((line) =>
      /REFUSING/.test(line) &&
      /no surviving member carries the persisted session token/i.test(line) &&
      line.includes("cause=membership-unprovable") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  it("PGID_GUARD_TREATS_A_GROUP_REDUCED_TO_ZOMBIES_AS_DEAD_INSTEAD_OF_UNPROVABLE", async () => {
    // The race the leader-absent refusal cannot tell apart on its own: a host
    // is SIGKILLed, its PTY guardian's parent-death trap broadcasts to the
    // group, the LEADER is already reaped, and the remaining members are
    // ZOMBIES. kill(-pgid, 0) still succeeds (a zombie is still attached to
    // its pgid), the leader is unreadable, and a zombie's environ is empty, so
    // no member can carry the session token. That refusal is
    // `membership-unprovable`, which now blocks the socket — for a group in
    // which nothing can execute any terminal work ever again.
    //
    // Re-check the group before refusing: a group reduced to zombies is DEAD
    // for containment. No signal is emitted (kill(-pgid) would only wait for
    // some other parent to reap them) and the row is confirmed reaped.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { find } = fakeGroupMemberTokenProbe(); // nobody carries the token
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-zombie-group",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: () => undefined, // leader already reaped
      findGroupMemberToken: find,
      groupIsOnlyZombies: (pgid) => pgid === ptys.get("alpha")?.pgid,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid); // the OS still reports the group alive: zombies are members

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "reaped",
      pgid,
      elapsedMs: expect.any(Number),
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters).toEqual({
      recycled: 0,
      staleBoot: 0,
      foreignFrame: 0,
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 1,
      groupDrained: 0,
    });
    expect(warnings.some((line) =>
      /zombie/i.test(line) &&
      line.includes("cause=zombie-group") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  it("PGID_GUARD_CONFIRMS_A_GROUP_THAT_DRAINED_DURING_THE_IDENTITY_CHECKS", async () => {
    // The liveness probe that admits a group to the identity checks runs ONCE,
    // before them. The checks that follow (frame, leader start-time, token
    // scan, two full /proc censuses) take real time, and a group whose last
    // zombies are collected meanwhile is EMPTY by the time they answer: the
    // census reports "not proven all-zombie" (its first scan is already empty,
    // or its two scans disagree), and the refusal below blocks a socket over a
    // group the OS would now answer ESRCH for.
    //
    // Re-probe the group before refusing. ESRCH is the same positive
    // proof-of-death the short-circuit above the guard and the confirmation
    // poll already rely on, so this cannot manufacture a death verdict: a live
    // group — leaderless or `Zl` — still answers ALIVE and is still refused.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { find } = fakeGroupMemberTokenProbe(); // nobody carries the token
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-drained",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: () => undefined, // leader already reaped
      findGroupMemberToken: find,
      // The census is exactly where the drain lands: the parent collects the
      // last zombies while it scans, so it answers `false` AND the group is
      // gone by the time it returns.
      groupIsOnlyZombies: (pgid) => {
        alive.delete(pgid);
        return false;
      },
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid); // alive when the reap starts: the checks are entered

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "reaped",
      pgid,
      elapsedMs: expect.any(Number),
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters).toMatchObject({
      membershipUnprovable: 0,
      zombieGroup: 0,
      groupDrained: 1,
    });
    expect(warnings.some((line) =>
      /NOT signalling/i.test(line) &&
      line.includes("cause=group-drained") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  it("PGID_GUARD_STILL_REFUSES_A_GROUP_THAT_IS_STILL_ALIVE_AFTER_THE_IDENTITY_CHECKS", async () => {
    // The counter-mutant of the case above: the re-probe must be a PROOF, not
    // a way out. A group that is still there when the checks end is still
    // unidentifiable, and still blocks.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { find } = fakeGroupMemberTokenProbe();
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-still-alive",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: () => {},
      readLeaderStartTime: () => undefined,
      findGroupMemberToken: find,
      groupIsOnlyZombies: () => false, // a LIVE leaderless group: nothing drained
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);

    expect(await host.reapOrphan("alpha")).toMatchObject({
      status: "refused",
      cause: "membership-unprovable",
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardCounters).toMatchObject({
      membershipUnprovable: 1,
      groupDrained: 0,
    });
  });

  it.skipIf(process.platform !== "linux")(
    "PGID_GUARD_PROVES_THE_GROUP_GONE_WHEN_THE_ROW_WAS_WRITTEN_BEFORE_THIS_BOOT",
    async () => {
      // A `pgidBootId` that differs from this reader's is POSITIVE proof that
      // every process the row describes has ended: a reboot ends every process
      // of the previous boot. It is therefore the strongest form of the
      // `recycled` proof, not an absence of one — and treating it as
      // `membership-unprovable` blocks the socket until an UNRELATED live
      // process that merely inherited the pgid NUMBER happens to exit.
      //
      // The proof is admissible only in the reader's own pid namespace: a pid
      // number means nothing across namespaces, so an unknown or different
      // namespace still proves nothing (see the case above this one).
      const { spawner, ptys } = stubSpawner();
      const { reaper, killGroup, alive } = fakeReaper();
      const { read, values } = fakeLeaderStartTimeReader(1000);
      const warnings: string[] = [];
      const host = new NativeTerminalHost({
        generation: "host-generation-pgid-stale-boot",
        replayBytesPerSession: 32,
        spawner,
        registryPath,
        reaper,
        log: (line) => warnings.push(line),
        readLeaderStartTime: read,
      });
      createSession(host, "alpha");
      const pgid = ptys.get("alpha")!.pgid;
      // The row keeps THIS reader's pid namespace AND machine id, and takes a
      // foreign boot id: a previous boot of this very machine.
      patchDurableRow("alpha", (row) => {
        expect(row.pgidPidNamespace).toBeTypeOf("string");
        expect(row.pgidBootId).toBeTypeOf("string");
        expect(row.pgidMachineId).toBeTypeOf("string");
        row.pgidBootId = "00000000-0000-4000-8000-000000000000";
      });
      // The pgid NUMBER is held by a live, unrelated group leader now.
      alive.add(pgid);
      values.set(pgid, 2000);

      const outcome = await host.reapOrphan("alpha");

      expect(outcome).toEqual({
        sessionId: "alpha",
        status: "refused",
        reason: expect.stringMatching(/stale-boot/i),
        cause: "stale-boot",
      });
      // The live group that now holds this number is NEVER signalled.
      expect(killGroup).not.toHaveBeenCalled();
      expect(host.pgidGuardCounters).toMatchObject({
        staleBoot: 1,
        foreignFrame: 0,
        membershipUnprovable: 0,
        recycled: 0,
      });
      expect(warnings.some((line) =>
        /NOT signalling/i.test(line) &&
        line.includes("cause=stale-boot") &&
        line.includes("sessionId=alpha") &&
        line.includes(`pgid=${pgid}`)
      )).toBe(true);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "PGID_GUARD_GRANTS_NO_STALE_BOOT_PROOF_ACROSS_A_PID_NAMESPACE",
    async () => {
      // Same foreign boot id, but the row also comes from another pid
      // namespace: the pid the row names is not the pid this reader resolves
      // under that number, so nothing about it can be proven either way. The
      // blocking refusal stands.
      const { spawner, ptys } = stubSpawner();
      const { reaper, killGroup, alive } = fakeReaper();
      const { read, values } = fakeLeaderStartTimeReader(1000);
      const host = new NativeTerminalHost({
        generation: "host-generation-pgid-stale-boot-foreign-ns",
        replayBytesPerSession: 32,
        spawner,
        registryPath,
        reaper,
        log: () => {},
        readLeaderStartTime: read,
      });
      createSession(host, "alpha");
      const pgid = ptys.get("alpha")!.pgid;
      patchDurableRow("alpha", (row) => {
        row.pgidPidNamespace = "4026599999";
        row.pgidBootId = "00000000-0000-4000-8000-000000000000";
      });
      alive.add(pgid);
      values.set(pgid, 2000);

      expect(await host.reapOrphan("alpha")).toMatchObject({
        status: "refused",
        cause: "foreign-frame",
      });
      expect(killGroup).not.toHaveBeenCalled();
      expect(host.pgidGuardCounters).toMatchObject({
        staleBoot: 0,
        foreignFrame: 1,
        membershipUnprovable: 0,
      });
    },
  );

  /**
   * A host whose leader start-time reader sees a LIVE, UNRELATED leader at the
   * row's pgid (a different start-time), for the frame cases below: every one
   * of them must refuse without signalling, and only the frame decides how.
   */
  function hostOverAnUnrelatedLiveLeader(
    generation: string,
    readFrame?: () => NativeTerminalProcFrame,
  ): {
    host: NativeTerminalHost;
    pgid: number;
    killGroup: ReturnType<typeof fakeReaper>["killGroup"];
    warnings: string[];
  } {
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { read, values } = fakeLeaderStartTimeReader(1000);
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation,
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: read,
      ...(readFrame !== undefined ? { readFrame } : {}),
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);
    values.set(pgid, 2000);
    return { host, pgid, killGroup, warnings };
  }

  /** The frame the writer recorded on the "alpha" row. */
  function recordedFrame(): { pidNamespace: string; bootId: string; machineId: string } {
    const lookup = readNativeTerminalPgid("alpha", registryPath);
    if (
      lookup.status !== "resolved" ||
      lookup.pidNamespace === undefined ||
      lookup.bootId === undefined ||
      lookup.machineId === undefined
    ) {
      throw new Error(`the writer recorded no complete frame: ${JSON.stringify(lookup)}`);
    }
    return {
      pidNamespace: lookup.pidNamespace,
      bootId: lookup.bootId,
      machineId: lookup.machineId,
    };
  }

  const FOREIGN_BOOT_ID = "00000000-0000-4000-8000-000000000000";
  const FOREIGN_MACHINE_ID = "0123456789abcdef0123456789abcdef";

  it.skipIf(process.platform !== "linux")(
    "PGID_GUARD_GRANTS_NO_STALE_BOOT_PROOF_TO_A_ROW_WRITTEN_BY_ANOTHER_MACHINE",
    async () => {
      // A registry shared by two machines (a networked `$HOME`): machine A's
      // row carries the init pid namespace inode — identical on EVERY kernel —
      // and A's boot id, which differs from this reader's. Without the machine
      // id that is byte-for-byte what a previous boot of THIS machine looks
      // like, and treating it as proof prunes the only durable record of a
      // group that may be alive on A right now. Nothing here can decide it:
      // refuse, blocking, and signal nothing.
      //
      // The REAL reader frame is used: only the row is foreign.
      const { host, pgid, killGroup, warnings } =
        hostOverAnUnrelatedLiveLeader("host-generation-pgid-other-machine");
      patchDurableRow("alpha", (row) => {
        expect(row.pgidPidNamespace).toBeTypeOf("string");
        row.pgidBootId = FOREIGN_BOOT_ID;
        row.pgidMachineId = FOREIGN_MACHINE_ID;
      });

      expect(await host.reapOrphan("alpha")).toEqual({
        sessionId: "alpha",
        status: "refused",
        reason: expect.stringMatching(/foreign-frame/i),
        cause: "foreign-frame",
      });
      expect(killGroup).not.toHaveBeenCalled();
      expect(host.pgidGuardCounters).toMatchObject({
        staleBoot: 0,
        foreignFrame: 1,
        recycled: 0,
      });
      expect(warnings.some((line) =>
        /ANOTHER machine/.test(line) &&
        line.includes("cause=foreign-frame") &&
        line.includes(`pgid=${pgid}`)
      )).toBe(true);
      // The row is kept for whoever can decide it.
      expect(readNativeTerminalPgid("alpha", registryPath)).toMatchObject({
        status: "resolved",
        pgid,
      });
    },
  );

  it.skipIf(process.platform !== "linux")(
    "PGID_GUARD_GRANTS_NO_STALE_BOOT_PROOF_WHEN_EITHER_SIDE_HAS_NO_MACHINE_ID",
    async () => {
      // "Same machine" must be KNOWN on both sides: a row written before the
      // machine id was recorded (or where it was unreadable), and a reader
      // that cannot read its own, are both no statement at all.
      const rowWithout = hostOverAnUnrelatedLiveLeader("host-generation-pgid-row-no-machine");
      patchDurableRow("alpha", (row) => {
        row.pgidBootId = FOREIGN_BOOT_ID;
        delete row.pgidMachineId;
      });
      expect(await rowWithout.host.reapOrphan("alpha")).toMatchObject({
        status: "refused",
        cause: "foreign-frame",
      });
      expect(rowWithout.killGroup).not.toHaveBeenCalled();
      expect(rowWithout.host.pgidGuardCounters).toMatchObject({
        staleBoot: 0,
        foreignFrame: 1,
      });
      expect(rowWithout.warnings.some((line) =>
        /not known on both sides/.test(line) && line.includes("cause=foreign-frame")
      )).toBe(true);

      let frame: ReturnType<typeof recordedFrame> | undefined;
      const readerWithout = hostOverAnUnrelatedLiveLeader(
        "host-generation-pgid-reader-no-machine",
        () => ({ pidNamespace: frame!.pidNamespace, bootId: "reader-boot" }),
      );
      frame = recordedFrame();
      expect(await readerWithout.host.reapOrphan("alpha")).toMatchObject({
        status: "refused",
        cause: "foreign-frame",
      });
      expect(readerWithout.killGroup).not.toHaveBeenCalled();
      expect(readerWithout.host.pgidGuardCounters).toMatchObject({
        staleBoot: 0,
        foreignFrame: 1,
      });
    },
  );

  it.skipIf(process.platform !== "linux")(
    "PGID_GUARD_GRANTS_NO_STALE_BOOT_PROOF_WITHOUT_A_KNOWN_BOOT_ID_ON_BOTH_SIDES",
    async () => {
      // The boot half of the same rule: a different boot is a proof only when
      // BOTH boot ids are known. Same namespace, same machine.
      //
      // The READER cannot read its boot id.
      let frame: ReturnType<typeof recordedFrame> | undefined;
      const readerWithout = hostOverAnUnrelatedLiveLeader(
        "host-generation-pgid-reader-no-boot",
        () => ({ pidNamespace: frame!.pidNamespace, machineId: frame!.machineId }),
      );
      frame = recordedFrame();
      expect(await readerWithout.host.reapOrphan("alpha")).toMatchObject({
        status: "refused",
        cause: "foreign-frame",
      });
      expect(readerWithout.killGroup).not.toHaveBeenCalled();
      expect(readerWithout.host.pgidGuardCounters).toMatchObject({
        staleBoot: 0,
        foreignFrame: 1,
      });

      // The ROW records no boot id (the reader's frame is the real one).
      const rowWithout = hostOverAnUnrelatedLiveLeader("host-generation-pgid-row-no-boot");
      patchDurableRow("alpha", (row) => {
        expect(row.pgidMachineId).toBeTypeOf("string");
        delete row.pgidBootId;
      });
      expect(await rowWithout.host.reapOrphan("alpha")).toMatchObject({
        status: "refused",
        cause: "foreign-frame",
      });
      expect(rowWithout.killGroup).not.toHaveBeenCalled();
      expect(rowWithout.host.pgidGuardCounters).toMatchObject({
        staleBoot: 0,
        foreignFrame: 1,
      });
    },
  );

  it.skipIf(process.platform !== "linux")(
    "PGID_GUARD_IGNORES_THE_MACHINE_ID_WITHIN_ONE_BOOT",
    async () => {
      // The machine id gates ONLY the boot proof. Within one boot id the kernel
      // is the same, so the pids are comparable whatever machine id either side
      // reads: a start-time mismatch there is still the `recycled` proof.
      let frame: ReturnType<typeof recordedFrame> | undefined;
      const { host, killGroup } = hostOverAnUnrelatedLiveLeader(
        "host-generation-pgid-same-boot",
        () => ({ pidNamespace: frame!.pidNamespace, bootId: frame!.bootId }),
      );
      frame = recordedFrame();
      expect(await host.reapOrphan("alpha")).toMatchObject({
        status: "refused",
        cause: "recycled",
      });
      expect(killGroup).not.toHaveBeenCalled();
      expect(host.pgidGuardCounters).toMatchObject({
        recycled: 1,
        foreignFrame: 0,
      });
    },
  );

  it("REAP_REFUSES_WHEN_THE_RE_READ_ROW_CARRIES_A_DIFFERENT_GROUP_TOKEN", async () => {
    // The immutable snapshot a reconcile pass acts on is (pgid, groupToken),
    // and every prune compares BOTH. The kill side compared the pgid number
    // alone: a session id recreated within one pass whose new PTY leader is
    // handed back the same, just-freed pid number re-reads as "same pgid" and
    // the LIVE group is killed. The token is a per-session UUID, so comparing
    // it closes that window.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-token-mismatch",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: () => 1000,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);

    const outcome = await host.reapOrphan("alpha", "SIGKILL", pgid, {
      groupToken: "the-token-the-caller-snapshotted",
    });

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "refused",
      reason: expect.stringMatching(/group token/i),
      cause: "pgid-mismatch",
    });
    expect(killGroup).not.toHaveBeenCalled();
    // The matching token still reaps: the check is the token and nothing else.
    const token = (
      readNativeTerminalPgid("alpha", registryPath) as { groupToken?: string }
    ).groupToken;
    expect(token).toBeTypeOf("string");
    expect(
      await host.reapOrphan("alpha", "SIGKILL", pgid, { groupToken: token }),
    ).toMatchObject({ status: "reaped" });
    expect(killGroup).toHaveBeenCalledWith(pgid, "SIGKILL");
  });

  it("REAL_PROC_ZOMBIE_CENSUS_ANSWERS_ONLY_FROM_POSITIVE_EVIDENCE", async () => {
    // The unit test above injects the census, so it is blind to a regression
    // inside the real /proc reader. This one drives the REAL exported helper
    // against REAL zombies, in both directions.
    //
    // A group whose ONLY member is a zombie: a Node parent spawns a detached
    // (setsid, so pgid == its own pid) child that exits at once, then blocks in
    // a busy loop — so it can never process SIGCHLD and the child stays a
    // zombie for the whole window.
    const zombieOnly = spawn(process.execPath, [
      "-e",
      "const c=require('child_process').spawn('/bin/true',[],{detached:true,stdio:'ignore'});" +
        "process.stdout.write(String(c.pid)+'\\n');" +
        "const end=Date.now()+8000;while(Date.now()<end){}",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    strayProcesses.add(zombieOnly);
    // A group with a zombie AND a live member: the leader execs into a long
    // sleep (so it never reaps) after backgrounding a short-lived child.
    const mixed = spawn("/bin/sh", ["-c", "sleep 0.05 & exec sleep 30"], {
      detached: true,
      stdio: "ignore",
    });
    strayProcesses.add(mixed);
    try {
      let zombieOnlyOut = "";
      zombieOnly.stdout!.setEncoding("utf8");
      zombieOnly.stdout!.on("data", (chunk: string) => {
        zombieOnlyOut += chunk;
      });
      const zombiePgid = await eventuallyNumber(() => Number(zombieOnlyOut.trim()));
      const mixedPgid = mixed.pid!;
      await eventuallyTrue(() => processState(zombiePgid) === "Z");
      await eventuallyTrue(
        () => processGroupStates(mixedPgid).some((state) => state === "Z"),
      );

      // Both groups are reported ALIVE by the standard probe — that is what
      // makes a zombie-only group block containment in the first place.
      expect(posixProcessGroupReaper.isGroupAlive(zombiePgid)).toBe(true);
      expect(posixProcessGroupReaper.isGroupAlive(mixedPgid)).toBe(true);

      expect(groupIsOnlyZombies(zombiePgid)).toBe(true);
      // A single live member is enough to keep failing closed, even next to a
      // real zombie.
      expect(groupIsOnlyZombies(mixedPgid)).toBe(false);
      // No positive evidence at all (nothing in that group): never "dead".
      expect(groupIsOnlyZombies(0x7fffffff)).toBe(false);
      expect(groupIsOnlyZombies(process.pid)).toBe(false);
    } finally {
      zombieOnly.kill("SIGKILL");
      try {
        process.kill(-mixed.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  it("ZOMBIE_CENSUS_REFUSES_A_PROCESS_WHOSE_LEADER_THREAD_EXITED_WHILE_ANOTHER_THREAD_RUNS", () => {
    // `/proc/<tgid>/stat` reports the state of the thread-group LEADER task, not
    // of the process. A process whose main thread called pthread_exit() while a
    // worker thread keeps running is a DELAYED zombie: the leader task reads `Z`
    // (`ps` shows `Zl <defunct>`), yet the process executes code and can fork.
    // Answering "the group is only zombies" there prunes the durable row of a
    // LIVE tree and unblocks the socket — the invisible orphan this mechanism
    // exists to prevent. Only a process whose EVERY task is `Z` is dead.
    const root = procFixture({
      processes: [
        {
          pid: 4_101,
          pgrp: 4_100,
          state: "Z", // the leader task exited...
          tasks: [
            { tid: 4_101, state: "Z" },
            { tid: 4_102, state: "S" }, // ...but this thread is still running
          ],
        },
      ],
    });

    expect(groupIsOnlyZombies(4_100, root)).toBe(false);
  });

  it("ZOMBIE_CENSUS_STILL_CLASSIFIES_A_GROUP_WHOSE_EVERY_TASK_IS_A_ZOMBIE_AS_DEAD", () => {
    // The other direction of the same rule, so the per-task check cannot be
    // "fixed" by refusing everything: a group whose members are zombies down to
    // the last task is still DEAD for containment (the round-3 benefit).
    const root = procFixture({
      processes: [
        { pid: 4_201, pgrp: 4_200, state: "Z", tasks: [{ tid: 4_201, state: "Z" }] },
        {
          pid: 4_202,
          pgrp: 4_200,
          state: "Z",
          tasks: [
            { tid: 4_202, state: "Z" },
            { tid: 4_203, state: "Z" },
          ],
        },
        { pid: 4_299, pgrp: 9_999, state: "S" }, // another group: irrelevant
      ],
    });

    expect(groupIsOnlyZombies(4_200, root)).toBe(true);
  });

  it("ZOMBIE_CENSUS_IS_UNKNOWN_WHENEVER_THE_SCAN_ITSELF_COULD_NOT_ANSWER", () => {
    // Three ways the census cannot see the whole group. Each must yield "not
    // proven dead", never a manufactured death verdict:
    //
    //  1. a member's `stat` is unreadable for a reason OTHER than "it exited"
    //     (EACCES — e.g. a member owned by another uid under `hidepid=1`);
    //  2. the proc mount hides other processes (`hidepid=2`,
    //     `ProtectProc=invisible`), where a live member is not even listed;
    //  3. the two consecutive censuses disagree — a member forked a child that
    //     the first readdir had not listed yet.
    const unreadable = procFixture({
      processes: [
        { pid: 4_301, pgrp: 4_300, state: "Z", tasks: [{ tid: 4_301, state: "Z" }] },
        { pid: 4_302, pgrp: 4_300, state: "S" },
      ],
    });
    chmodSync(join(unreadable, "4302", "stat"), 0o000);
    // Running as root would read it anyway: then this leg proves nothing and is
    // skipped rather than asserted wrongly.
    if (process.getuid?.() !== 0) {
      expect(groupIsOnlyZombies(4_300, unreadable)).toBe(false);
    }

    const hidden = procFixture({
      hidepid: "2",
      processes: [
        { pid: 4_401, pgrp: 4_400, state: "Z", tasks: [{ tid: 4_401, state: "Z" }] },
      ],
    });
    expect(groupIsOnlyZombies(4_400, hidden)).toBe(false);
    // ... and the same tree without the mount option is still classified dead,
    // so the check above is the hidepid option and nothing else.
    const visible = procFixture({
      processes: [
        { pid: 4_401, pgrp: 4_400, state: "Z", tasks: [{ tid: 4_401, state: "Z" }] },
      ],
    });
    expect(groupIsOnlyZombies(4_400, visible)).toBe(true);

    // A group that reads all-zombie on the first census and shows a live member
    // on the second: the census is not atomic, so agreement is required.
    const before = procFixture({
      processes: [
        { pid: 4_501, pgrp: 4_500, state: "Z", tasks: [{ tid: 4_501, state: "Z" }] },
      ],
    });
    const after = procFixture({
      processes: [
        { pid: 4_501, pgrp: 4_500, state: "Z", tasks: [{ tid: 4_501, state: "Z" }] },
        { pid: 4_502, pgrp: 4_500, state: "R" }, // the child the first scan missed
      ],
    });
    const roots = [before, after];
    let call = 0;
    expect(groupIsOnlyZombies(4_500, () => roots[call++] ?? after)).toBe(false);
    expect(call).toBe(2);
  });

  it("ZOMBIE_CENSUS_IS_UNKNOWN_WHEN_NO_MOUNT_LINE_DESCRIBES_THE_TREE_IT_READS", () => {
    // The census answers only when the mount table POSITIVELY shows the proc
    // mount it is about to read WITHOUT `hidepid`. A mount table that names no
    // such mount at all is not that evidence — it is an unreadable frame, the
    // same epistemic state as a mount table that could not be read — yet it
    // used to fall through to "not hidden", i.e. "complete view".
    const noProcLine = procFixture({
      mountinfo: "26 1 0:5 / /sys rw,nosuid,nodev,noexec,relatime - sysfs sysfs rw\n",
      processes: [
        { pid: 4_601, pgrp: 4_600, state: "Z", tasks: [{ tid: 4_601, state: "Z" }] },
      ],
    });
    expect(groupIsOnlyZombies(4_600, noProcLine)).toBe(false);

    // A mount line for a DIFFERENT tree is no evidence about this one either.
    const otherTree = procFixture({
      mountinfo: "54 46 0:25 / /proc rw,relatime shared:12 - proc proc rw\n",
      processes: [
        { pid: 4_701, pgrp: 4_700, state: "Z", tasks: [{ tid: 4_701, state: "Z" }] },
      ],
    });
    expect(groupIsOnlyZombies(4_700, otherTree)).toBe(false);
  });

  it.skipIf(!HAS_CC)(
    "REAL_PROC_CENSUS_REFUSES_A_REAL_MULTITHREADED_PROCESS_WHOSE_LEADER_THREAD_EXITED",
    async () => {
      // The fixture above pins the parsing rule; this one pins it against a REAL
      // `Zl` process, built here because no such binary exists in the tree.
      // Skipped where no C compiler is available (CI images without one) — the
      // fixture cases keep the rule covered there.
      const source = join(scratch, "zl.c");
      const binary = join(scratch, "zl");
      writeFileSync(
        source,
        [
          "#include <pthread.h>",
          "#include <unistd.h>",
          "static void *worker(void *arg) { (void)arg; for (;;) sleep(1); return 0; }",
          "int main(void) {",
          "  pthread_t t;",
          "  pthread_create(&t, 0, worker, 0);",
          "  pthread_exit(0); /* the leader task exits; the process lives on */",
          "}",
          "",
        ].join("\n"),
      );
      const compiled = spawnSync("cc", ["-pthread", "-o", binary, source], {
        stdio: "ignore",
      });
      expect(compiled.status).toBe(0);
      // `detached` puts it in its own session, so pgid == pid == tgid.
      const zl = spawn(binary, [], { detached: true, stdio: "ignore" });
      strayProcesses.add(zl);
      try {
        const pgid = zl.pid!;
        // The leader task now reads `Z` while the worker thread keeps running.
        await eventuallyTrue(() => processState(pgid) === "Z");
        await eventuallyTrue(
          () => readdirSync(`/proc/${pgid}/task`).some((tid) => {
            const state = processState(Number(tid));
            return state !== undefined && state !== "Z";
          }),
        );
        // The standard probe reports the group alive — correctly, it IS alive.
        expect(posixProcessGroupReaper.isGroupAlive(pgid)).toBe(true);
        expect(groupIsOnlyZombies(pgid)).toBe(false);
      } finally {
        try {
          process.kill(-zl.pid!, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    },
  );

  it("PGID_GUARD_PROCEEDS_BUT_FLAGS_UNVERIFIED_WHEN_A_LEGACY_ROW_HAS_NO_PERSISTED_LEADER_STARTTIME", async () => {
    // unverified-legacy: a row written with NO leader-start-time baseline at
    // all (the shape a pre-fix row would have) cannot be checked for
    // recycling — refusing it would leak every pre-existing session, so the
    // guard fails OPEN here (mirrors defaultOwnerHostProbe's identical
    // treatment of a missing ownerHostStartTime) and PROCEEDS. But a
    // proceed taken without proof must never look identical to a PROVEN
    // match: it gets its own counter, its own distinct log, and its own
    // `verified: false` on the returned outcome.
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const values = new Map<number, number | undefined>();
    // While true, the injected reader returns undefined for ANY pid — this
    // simulates create()'s spawn-time capture failing to record a baseline
    // (or predating this fix entirely), so persistNativeTerminalPgid omits
    // pgidLeaderStartTime, exactly like a real legacy row.
    let capturingBaseline = true;
    const read = (pid: number): number | undefined => {
      if (capturingBaseline) return undefined;
      return values.has(pid) ? values.get(pid) : 1000;
    };
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-unverified-legacy",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: read,
    });
    createSession(host, "alpha"); // no baseline persisted (capturingBaseline=true)
    capturingBaseline = false; // kill-time reads succeed normally from here on
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid);
    values.set(pgid, 1000); // the leader IS readable now — just nothing to compare it to

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "reaped",
      pgid,
      elapsedMs: expect.any(Number),
      verified: false,
    });
    // Legacy rows must NOT leak: the kill DOES proceed (unlike recycled/leader-absent).
    expect(killGroup).toHaveBeenCalledWith(pgid, "SIGKILL");
    expect(host.pgidGuardCounters).toEqual({
      recycled: 0,
      staleBoot: 0,
      foreignFrame: 0,
      membershipUnprovable: 0,
      unverifiedLegacy: 1,
      tokenVerified: 0,
      zombieGroup: 0,
      groupDrained: 0,
    });
    expect(warnings.some((line) =>
      /PROCEEDING/.test(line) &&
      /WITHOUT identity proof/i.test(line) &&
      line.includes("cause=unverified-legacy") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  it("should reject duplicate and unknown session identifiers", () => {
    const { spawner } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-3",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });

    createSession(host, "alpha");

    expect(() => createSession(host, "alpha")).toThrow(/already exists/i);
    expect(() => host.state("missing")).toThrow(/unknown terminal session/i);
    expect(() => host.readOutput("missing", 0)).toThrow(
      /unknown terminal session/i,
    );
  });

  it("should bound retained sessions and recycle exited identifiers", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-bounded",
      replayBytesPerSession: 32,
      maxSessions: 2,
      spawner,
      registryPath,
    });

    createSession(host, "alpha");
    createSession(host, "beta");
    expect(() => createSession(host, "gamma")).toThrow(/session limit/i);

    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    createSession(host, "gamma");
    expect(host.list().map((session) => session.id)).toEqual(["beta", "gamma"]);

    ptys.get("gamma")!.emitExit({ exitCode: 0 });
    createSession(host, "gamma");
    expect(host.state("gamma")).toMatchObject({
      status: "running",
      latestSeq: 0,
      exit: null,
    });
  });

  it("should allow one controller while observers remain read-only", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-4",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });
    createSession(host, "alpha");

    expect(host.attachObserver("alpha")).toEqual({
      role: "observer",
      id: "alpha",
      generation: "host-generation-4",
      incarnation: expect.any(String),
      controllerEpoch: 0,
    });
    const controller = host.acquireController("alpha", "focus-client");
    expect(controller).toEqual({
      role: "controller",
      id: "alpha",
      generation: "host-generation-4",
      incarnation: expect.any(String),
      controllerId: "focus-client",
      epoch: 1,
    });
    expect(host.attachObserver("alpha")).toMatchObject({
      role: "observer",
      controllerEpoch: 1,
    });
    expect(() => host.acquireController("alpha", "cli-client")).toThrow(
      /already has a controller/i,
    );

    host.write(controller, "pwd\r");
    host.resize(controller, 120, 40);

    expect(ptys.get("alpha")!.write).toHaveBeenCalledWith("pwd\r");
    expect(ptys.get("alpha")!.resize).toHaveBeenCalledWith(120, 40);
  });

  it("should expose controller PRESENCE as a boolean without ever exposing the controller id", () => {
    const { spawner } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-4b",
      replayBytesPerSession: 32,
      spawner,
    });
    createSession(host, "alpha");

    expect(host.state("alpha").controlled).toBe(false);
    const lease = host.acquireController("alpha", "focus-client");
    const controlledState = host.state("alpha");
    expect(controlledState.controlled).toBe(true);
    // The visibility bit must never leak the controller's identity.
    expect(JSON.stringify(controlledState)).not.toContain("focus-client");
    host.releaseController(lease);
    expect(host.state("alpha").controlled).toBe(false);
  });

  it("atomically refuses automation when human activity appears after an idle snapshot", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-drive-safety",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });
    createSession(host, "alpha");

    // This is the stale observation the former check-then-act drive path
    // could make before a human starts using the terminal.
    expect(host.state("alpha").lastHumanActivityAt).toBeNull();
    const human = host.acquireController("alpha", "keyboard", "human");
    host.write(human, "human-input\r");
    host.releaseController(human);

    // The new atomic host operation observes that intervening activity while
    // granting the lease, so no automation lease (and therefore no write) is
    // possible from the stale idle snapshot.
    expect(() =>
      host.acquireAutomationControllerIfNoRecentHuman("alpha", "drive", 4_000),
    ).toThrow(/recent human activity/i);
    expect(ptys.get("alpha")!.write).toHaveBeenCalledTimes(1);
    expect(ptys.get("alpha")!.write).toHaveBeenLastCalledWith("human-input\r");
  });

  it("should reject stale controller epochs after ownership changes", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-5",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });
    createSession(host, "alpha");

    const first = host.acquireController("alpha", "first-client");
    expect(host.releaseController(first)).toEqual({
      id: "alpha",
      generation: "host-generation-5",
      incarnation: first.incarnation,
      controllerEpoch: 2,
    });
    const second = host.acquireController("alpha", "second-client");

    expect(second.epoch).toBe(3);
    expect(() => host.write(first, "stale")).toThrow(
      /stale terminal controller lease/i,
    );
    expect(() => host.resize(first, 100, 30)).toThrow(
      /stale terminal controller lease/i,
    );
    expect(ptys.get("alpha")!.write).not.toHaveBeenCalled();
    expect(ptys.get("alpha")!.resize).not.toHaveBeenCalled();

    host.write(second, "current");
    expect(ptys.get("alpha")!.write).toHaveBeenCalledWith("current");
  });

  it("should fence the active controller when its session becomes terminal", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-6",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });
    createSession(host, "alpha");
    createSession(host, "beta");
    const stopped = host.acquireController("alpha", "alpha-client");
    const exited = host.acquireController("beta", "beta-client");

    host.stop(stopped);
    ptys.get("beta")!.emitExit({ exitCode: 0 });

    expect(() => host.write(stopped, "after-stop")).toThrow(
      /stale terminal controller lease/i,
    );
    expect(() => host.resize(exited, 90, 30)).toThrow(
      /stale terminal controller lease/i,
    );
  });

  /**
   * Make EVERY registry WRITE fail, immediately and without touching the read
   * path: a DIRECTORY squats the atomic write's temp name
   * (`<registry>.tmp.<pid>`, see `saveRegistry`), so `writeFileSync` raises
   * EISDIR. A stand-in for the EACCES/EROFS/ENOSPC a real store hits, without
   * a read-only directory (which would also make the lockfile unobtainable and
   * cost the lock's whole 4 s best-effort wait per attempt).
   */
  function breakEveryRegistryWrite(): void {
    mkdirSync(`${registryPath}.tmp.${process.pid}`, { recursive: true });
  }

  it("RECONCILE_KEEPS_EVERY_ENTRYS_VERDICT_WHEN_ONE_ENTRYS_PRUNE_CANNOT_BE_WRITTEN", async () => {
    // A pass walks EVERY durable row, and the socket-scoped containment rule is
    // derived from the outcomes it reports. A write failure while pruning an
    // UNRELATED row (another socket's, already confirmed reaped) must therefore
    // not abort the pass: the row that would have contained THIS socket would
    // never be evaluated, the caller would read the failure as a cleanup
    // hiccup, and a host would be spawned over a surviving PTY group.
    persistNativeTerminalPgid("other-socket-row", 30_001, registryPath, {
      pid: 4_242_401,
      startTime: 11,
      socketPath: "/sockets/other.sock",
    });
    persistNativeTerminalPgid("contained-row", 30_002, registryPath, {
      pid: 4_242_402,
      startTime: 12,
      socketPath: "/sockets/mine.sock",
    });
    breakEveryRegistryWrite();
    const logs: string[] = [];

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap: async (sessionId, pgid) =>
        sessionId === "other-socket-row"
          ? { sessionId, status: "reaped", pgid, elapsedMs: 0 }
          : {
              sessionId,
              status: "refused",
              reason: "no surviving member carries the persisted session token",
              cause: "membership-unprovable",
            },
      log: (line) => logs.push(line),
    });

    // The confirmed reap still reports `reaped`: the group is PROVEN gone, and
    // a row that could not be deleted is stale hygiene, not a survivor.
    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "other-socket-row",
          status: "reaped",
          ownerPid: 4_242_401,
          ownerSocketPath: "/sockets/other.sock",
          pgid: 30_001,
        },
        {
          sessionId: "contained-row",
          status: "reap-refused",
          ownerPid: 4_242_402,
          ownerSocketPath: "/sockets/mine.sock",
          pgid: 30_002,
          reason: expect.stringMatching(/session token/i),
          cause: "membership-unprovable",
        },
      ],
    });
    expect(
      logs.some(
        (line) => /could not prune/i.test(line) && line.includes("other-socket-row"),
      ),
    ).toBe(true);
  });

  it("RECONCILE_NEVER_PRUNES_A_ROW_REWRITTEN_FOR_THE_SAME_SESSION_ID_BY_ANOTHER_HOST", async () => {
    // Rows are keyed by session id ALONE, and session ids are caller-chosen
    // (`op.ts --id`), so the same id is legitimately reincarnated by a LIVE host
    // — an explicitly supported workflow. A prune that deletes "the row for this
    // id" therefore deletes whatever row holds that key AT PRUNE TIME, which
    // after a same-id rewrite is a live tree's only durable record: exactly the
    // invisible orphan this branch exists to close. The prune must delete only a
    // row that still matches what was proven gone.
    persistNativeTerminalPgid("reincarnated", 31_001, registryPath, {
      pid: 4_242_601,
      startTime: 31,
      socketPath: "/sockets/dead.sock",
    });
    const logs: string[] = [];

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap: async (sessionId, pgid) => {
        // Between this pass's snapshot and its prune, a LIVE host recreates a
        // session under the same id and persists its own group.
        persistNativeTerminalPgid(sessionId, 31_999, registryPath, {
          pid: process.pid,
          startTime: 4_242,
          socketPath: "/sockets/live.sock",
        });
        return { sessionId, status: "reaped", pgid, elapsedMs: 0 };
      },
      log: (line) => logs.push(line),
    });

    // The snapshot's group WAS confirmed dead, so the outcome stands...
    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "reincarnated",
          status: "reaped",
          ownerPid: 4_242_601,
          ownerSocketPath: "/sockets/dead.sock",
          pgid: 31_001,
        },
      ],
    });
    // ... but the LIVE host's row, written under the same id, survives.
    expect(readNativeTerminalPgid("reincarnated", registryPath)).toMatchObject({
      status: "resolved",
      pgid: 31_999,
    });
  });

  it("RECONCILE_REPORTS_A_THROWING_REAP_AS_REAP_FAILED_WITH_ITS_ATTRIBUTION", async () => {
    // A reap that THROWS proves nothing about the group: nothing was confirmed
    // dead, and the row keeps its socket attribution. It must be reported as a
    // per-entry failure that a caller can fail closed on — not swallowed, and
    // not allowed to abort the rest of the pass either.
    persistNativeTerminalPgid("throwing-row", 30_101, registryPath, {
      pid: 4_242_501,
      startTime: 21,
      socketPath: "/sockets/mine.sock",
    });
    persistNativeTerminalPgid("healthy-row", 30_102, registryPath, {
      pid: 4_242_502,
      startTime: 22,
      socketPath: "/sockets/other.sock",
    });
    const logs: string[] = [];

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap: async (sessionId, pgid) => {
        if (sessionId === "throwing-row") {
          throw new Error("registry became unreadable mid-reap");
        }
        return { sessionId, status: "reaped", pgid, elapsedMs: 0 };
      },
      log: (line) => logs.push(line),
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "throwing-row",
          status: "reap-failed",
          ownerPid: 4_242_501,
          ownerSocketPath: "/sockets/mine.sock",
          pgid: 30_101,
          reason: expect.stringMatching(/unreadable mid-reap/),
        },
        {
          sessionId: "healthy-row",
          status: "reaped",
          ownerPid: 4_242_502,
          ownerSocketPath: "/sockets/other.sock",
          pgid: 30_102,
        },
      ],
    });
    // Nothing was proven about the failed row's group, so its record survives.
    expect(readNativeTerminalPgid("throwing-row", registryPath)).toMatchObject({
      status: "resolved",
      pgid: 30_101,
    });
    expect(readNativeTerminalPgid("healthy-row", registryPath)).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
    expect(
      logs.some(
        (line) => /reap FAILED/i.test(line) && line.includes("throwing-row"),
      ),
    ).toBe(true);
  });

  it("RECONCILE_BLOCKS_WHEN_THE_STORE_IS_UNREADABLE_AFTER_A_PGID_MISMATCH", async () => {
    // The `pgid-mismatch` re-read exists to tell "the row this pass owed a
    // verdict for is gone" from "it is still owed". An UNREADABLE store answers
    // neither: it is an absence of information about a row whose owner is
    // proven dead and whose group was never probed. Reporting it as the
    // non-blocking `skipped-row-changed` lets a supervisor whose socket owns
    // that row start a host over a group whose fate was never decided.
    persistNativeTerminalPgid("mismatch-row", 30_401, registryPath, {
      pid: 4_242_801,
      startTime: 41,
      socketPath: "/sockets/mine.sock",
    });
    const logs: string[] = [];

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap: async (sessionId) => {
        // The store turns unreadable strictly BETWEEN the reap and the re-read
        // (EACCES, ENOSPC, a partial write by a concurrent rebuild).
        writeFileSync(registryPath, "{ this is not a registry", "utf8");
        return {
          sessionId,
          status: "refused",
          reason: "immutable snapshot pgid=30401 differs from re-resolved pgid=30999",
          cause: "pgid-mismatch",
        };
      },
      log: (line) => logs.push(line),
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "mismatch-row",
          status: "reap-failed",
          ownerPid: 4_242_801,
          ownerSocketPath: "/sockets/mine.sock",
          pgid: 30_401,
          reason: expect.stringMatching(/unreadable|malformed/i),
        },
      ],
    });
    expect(
      logs.some(
        (line) => /reap FAILED/i.test(line) && line.includes("mismatch-row"),
      ),
    ).toBe(true);
  });

  it("RECONCILE_STILL_SKIPS_A_PGID_MISMATCH_WHOSE_ROW_IS_READABLY_GONE", async () => {
    // The counter-mutant: a store that reads fine and no longer holds the row
    // is a POSITIVE answer — nothing is owed — and must stay non-blocking.
    persistNativeTerminalPgid("vanished-row", 30_402, registryPath, {
      pid: 4_242_802,
      startTime: 42,
      socketPath: "/sockets/mine.sock",
    });

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap: async (sessionId) => {
        pruneNativeTerminalPgidEntry(sessionId, registryPath);
        return {
          sessionId,
          status: "refused",
          reason: "immutable snapshot pgid=30402 differs from re-resolved pgid=30999",
          cause: "pgid-mismatch",
        };
      },
      log: () => {},
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "vanished-row",
          status: "skipped-row-changed",
          reason: expect.stringMatching(/gone/i),
        },
      ],
    });
  });

  it("RECONCILE_PRUNES_A_ROW_FROM_A_PREVIOUS_BOOT_AS_PROOF_ITS_GROUP_IS_GONE", async () => {
    // `stale-boot` is a PROOF that the original group ended, like `recycled`:
    // prune the row, report it as its own outcome, and never point anyone at
    // the pgid number — a live unrelated group may hold it now.
    persistNativeTerminalPgid("stale-boot-row", 30_301, registryPath, {
      pid: 4_242_701,
      startTime: 31,
      socketPath: "/sockets/mine.sock",
    });
    const logs: string[] = [];

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap: async (sessionId) => ({
        sessionId,
        status: "refused",
        reason: "this row was written before the current boot (stale-boot)",
        cause: "stale-boot",
      }),
      log: (line) => logs.push(line),
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "stale-boot-row",
          status: "pruned-stale-boot-row",
          ownerPid: 4_242_701,
          ownerSocketPath: "/sockets/mine.sock",
          pgid: 30_301,
          reason: expect.stringMatching(/stale-boot/i),
        },
      ],
    });
    expect(readNativeTerminalPgid("stale-boot-row", registryPath)).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
    expect(
      logs.some(
        (line) =>
          line.includes("stale-boot-row") &&
          /previous boot/i.test(line) &&
          /must NOT be killed/i.test(line),
      ),
    ).toBe(true);
  });

  it("RECONCILE_FORWARDS_EACH_ROWS_SNAPSHOT_TOKEN_TO_THE_REAP", async () => {
    // The kill side compares pgid AND group token against the immutable
    // snapshot (see REAP_REFUSES_WHEN_THE_RE_READ_ROW_CARRIES_A_DIFFERENT_GROUP_TOKEN),
    // but only if reconcile hands it the token it snapshotted. A pass that
    // dropped it would reach the reap with the pgid alone, reopening the
    // same-number successor kill. A legacy row carries no token and keeps its
    // exact pre-token call shape.
    persistNativeTerminalPgid(
      "tokened-row",
      30_501,
      registryPath,
      { pid: 4_242_901, startTime: 51, socketPath: "/sockets/mine.sock" },
      77,
      "tok-X",
    );
    persistNativeTerminalPgid("legacy-row", 30_502, registryPath, {
      pid: 4_242_902,
      startTime: 52,
      socketPath: "/sockets/mine.sock",
    });
    const reap = vi.fn(async (sessionId: string, pgid: number) => ({
      sessionId,
      status: "reaped" as const,
      pgid,
      elapsedMs: 0,
    }));

    await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => "dead",
      reap,
      log: () => {},
    });

    expect(reap.mock.calls).toStrictEqual([
      ["tokened-row", 30_501, "SIGKILL", { groupToken: "tok-X" }],
      ["legacy-row", 30_502, "SIGKILL"],
    ]);
  });

  it("RECONCILE_DOES_NOT_CLAIM_A_PROVEN_DEAD_OWNER_WHEN_THE_OWNER_PROBE_FAILED", async () => {
    // `reap-failed` covers every per-entry failure, including one taken BEFORE
    // the owner's death was established. The row must still block its socket —
    // nothing was proven about its group either — but the verdict must not
    // assert a death nobody proved.
    persistNativeTerminalPgid("probe-throws-row", 30_501, registryPath, {
      pid: 4_242_901,
      startTime: 51,
      socketPath: "/sockets/mine.sock",
    });
    const reap = vi.fn();

    const summary = await reconcileDeadHostOrphans({
      registryPath,
      ownerProbe: () => {
        throw new Error("owner probe failed: EIO");
      },
      reap: reap as never,
      log: () => {},
    });

    expect(summary).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "probe-throws-row",
          status: "reap-failed",
          ownerPid: 4_242_901,
          ownerSocketPath: "/sockets/mine.sock",
          pgid: 30_501,
          ownerDeathUnproven: true,
          reason: expect.stringMatching(/EIO/),
        },
      ],
    });
    expect(reap).not.toHaveBeenCalled();
    // A failure AFTER the owner was proven dead keeps the plain shape.
    expect(
      (
        await reconcileDeadHostOrphans({
          registryPath,
          ownerProbe: () => "dead",
          reap: async () => {
            throw new Error("reap failed after the owner was proven dead");
          },
          log: () => {},
        })
      ),
    ).toEqual({
      status: "completed",
      outcomes: [
        {
          sessionId: "probe-throws-row",
          status: "reap-failed",
          ownerPid: 4_242_901,
          ownerSocketPath: "/sockets/mine.sock",
          pgid: 30_501,
          reason: expect.stringMatching(/after the owner was proven dead/),
        },
      ],
    });
  });

  it("should never resurrect a lease when an exited session id is reused", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-reincarnation",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
    });
    createSession(host, "alpha");
    const stale = host.acquireController("alpha", "same-controller");
    ptys.get("alpha")!.emitExit({ exitCode: 0 });

    createSession(host, "alpha");
    const current = host.acquireController("alpha", "same-controller");
    expect(current).toMatchObject({
      id: stale.id,
      generation: stale.generation,
      controllerId: stale.controllerId,
      epoch: stale.epoch,
    });
    expect(current.incarnation).not.toBe(stale.incarnation);

    expect(() => host.write(stale, "stale")).toThrow(/stale/i);
    expect(() => host.resize(stale, 100, 30)).toThrow(/stale/i);
    expect(() => host.releaseController(stale)).toThrow(/stale/i);
    expect(() => host.stop(stale, "SIGKILL")).toThrow(/stale/i);
    expect(ptys.get("alpha")!.write).not.toHaveBeenCalled();
    expect(ptys.get("alpha")!.resize).not.toHaveBeenCalled();
    expect(ptys.get("alpha")!.kill).not.toHaveBeenCalled();

    host.write(current, "current");
    expect(ptys.get("alpha")!.write).toHaveBeenCalledWith("current");
  });
});
