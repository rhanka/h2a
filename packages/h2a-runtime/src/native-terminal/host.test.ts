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

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "h-"));
  registryPath = join(scratch, "registry.json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

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
      },
    ]);
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
    });
    expect(killGroup).toHaveBeenCalledWith(pgid, "SIGKILL");
    expect(host.pgidGuardRefusalCounters).toEqual({ recycled: 0, leaderAbsent: 0 });
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
    expect(host.pgidGuardRefusalCounters).toEqual({ recycled: 1, leaderAbsent: 0 });
    expect(warnings.some((line) =>
      /REFUSING/.test(line) &&
      /RECYCLED/i.test(line) &&
      line.includes("cause=recycled") &&
      line.includes("sessionId=alpha") &&
      line.includes(`pgid=${pgid}`)
    )).toBe(true);
  });

  it("PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_IS_UNREADABLE", async () => {
    // leader-absent: the group is still alive (something survives under
    // this pgid) but the LEADER's own current start-time cannot be read —
    // possibly our own already-dead orphan, possibly not; either way there
    // is no POSITIVE proof, so REFUSE (conservative refuse-and-leak),
    // counted and logged under a cause DISTINCT from "recycled".
    const { spawner, ptys } = stubSpawner();
    const { reaper, killGroup, alive } = fakeReaper();
    const { read, values } = fakeLeaderStartTimeReader(1000);
    const warnings: string[] = [];
    const host = new NativeTerminalHost({
      generation: "host-generation-pgid-leader-absent",
      replayBytesPerSession: 32,
      spawner,
      registryPath,
      reaper,
      log: (line) => warnings.push(line),
      readLeaderStartTime: read,
    });
    createSession(host, "alpha");
    const pgid = ptys.get("alpha")!.pgid;
    alive.add(pgid); // something still reports alive under this pgid...
    values.set(pgid, undefined); // ...but the leader's start-time is unreadable

    const outcome = await host.reapOrphan("alpha");

    expect(outcome).toEqual({
      sessionId: "alpha",
      status: "refused",
      reason: expect.stringMatching(/leader-absent/i),
      cause: "leader-absent",
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(host.pgidGuardRefusalCounters).toEqual({ recycled: 0, leaderAbsent: 1 });
    expect(warnings.some((line) =>
      /REFUSING/.test(line) &&
      /UNREADABLE/.test(line) &&
      line.includes("cause=leader-absent") &&
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
