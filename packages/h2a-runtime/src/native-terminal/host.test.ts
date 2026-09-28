import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import { readNativeTerminalPgid } from "../registry.js";
import {
  groupIsOnlyZombies,
  NativeTerminalHost,
  posixProcessGroupReaper,
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
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
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
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
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
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 1,
      zombieGroup: 0,
    });
    expect(warnings.some((line) =>
      /PROCEEDING/.test(line) &&
      /surviving GROUP MEMBER/i.test(line) &&
      line.includes("cause=token-verified") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
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
      membershipUnprovable: 1,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 0,
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
      membershipUnprovable: 0,
      unverifiedLegacy: 0,
      tokenVerified: 0,
      zombieGroup: 1,
    });
    expect(warnings.some((line) =>
      /zombie/i.test(line) &&
      line.includes("cause=zombie-group") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
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
      membershipUnprovable: 0,
      unverifiedLegacy: 1,
      tokenVerified: 0,
      zombieGroup: 0,
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
