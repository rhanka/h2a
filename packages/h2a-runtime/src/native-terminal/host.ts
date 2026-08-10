import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import type { PtyHandle, PtySpawner } from "../pty.js";
// Durable session identity (incl. pgid) lives in the single registry store by
// design — one local store per the owner's durable-state direction (see the
// longer rationale on `persistNativeTerminalPgid`/`readNativeTerminalPgid` in
// registry.ts). This is NOT a layer leak; do not remove this coupling. The
// PTY host stays otherwise decoupled from the registry — this import exists
// ONLY for pgid durability across a host crash, nothing else here reads or
// writes registry state.
import {
  listNativeTerminalPgidEntries,
  persistNativeTerminalPgid,
  pruneNativeTerminalPgidEntry,
  readNativeTerminalPgid,
  type NativeTerminalPgidOwner,
} from "../registry.js";
import {
  TerminalReplayBuffer,
  type TerminalOutputChunk,
  type TerminalReplayGap,
} from "./replay-buffer.js";
import {
  NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS,
  NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS,
  NATIVE_TERMINAL_MAX_SESSIONS,
  type NativeTerminalStopSignal,
} from "./protocol.js";

/**
 * Emits the FORCE signal to a whole process group from the PARENT (the host
 * process) and can prove whether the group is actually dead — the two halves
 * of the fix: FORCE_KILL_MUST_NOT_DEPEND_ON_THE_TARGET_EXECUTING_CODE and
 * FORCE_STOP_ALL_MUST_PROVE_THE_PTY_TREE_IS_DEAD_NOT_JUST_SIGNAL_IT. Injectable
 * so tests never send real signals at fabricated pgids (see host.test.ts).
 */
export type NativeTerminalProcessGroupReaper = {
  /** Ask the OS to signal the whole group. Must not throw on ESRCH (already gone). */
  killGroup(pgid: number, signal: NativeTerminalStopSignal): void;
  /** True iff the OS still reports at least one process in this group. */
  isGroupAlive(pgid: number): boolean;
  /** Best-effort human-readable list of survivors, for a timeout diagnostic. */
  describeGroup(pgid: number): string;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Real POSIX implementation: `process.kill(-pgid, signal)` signals every
 * process in the group in one syscall, regardless of whether any of them is
 * stuck, in D-state, or has overwritten its own trap handlers — it asks
 * nothing of the target. `kill(-pgid, 0)` is the standard "is anything still
 * in this group" probe (ESRCH = empty). Not meaningful on win32 (no POSIX
 * process groups); callers on that platform fall back to per-process kill.
 */
export const posixProcessGroupReaper: NativeTerminalProcessGroupReaper = {
  killGroup(pgid, signal) {
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ESRCH") return;
      throw error;
    }
  },
  isGroupAlive(pgid) {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === "ESRCH") return false;
      // EPERM or anything else: we cannot prove death — stay conservative.
      return true;
    }
  },
  describeGroup(pgid) {
    if (process.platform !== "linux") {
      return "diagnostic unavailable on this platform";
    }
    try {
      const members: string[] = [];
      for (const name of readdirSync("/proc")) {
        if (!/^\d+$/.test(name)) continue;
        try {
          const raw = readFileSync(`/proc/${name}/stat`, "utf8");
          const commandEnd = raw.lastIndexOf(")");
          const fields = raw.slice(commandEnd + 2).split(" ");
          if (Number(fields[2]) === pgid) {
            members.push(`${name}(state=${fields[0]})`);
          }
        } catch {
          // The process exited mid-scan; skip it.
        }
      }
      return members.length > 0
        ? members.join(", ")
        : "no /proc members found (race with exit?)";
    } catch (error) {
      return `diagnostic scan failed: ${String(error)}`;
    }
  },
};

function supportsProcessGroupSignals(): boolean {
  return process.platform !== "win32";
}

/**
 * Read a process's start-time — Linux `/proc/<pid>/stat` field 22
 * ("starttime", clock ticks since boot) — the pid-recycling-proof
 * discriminant used for owning-host attribution
 * (`RegistryEntry.ownerHostPid`/`ownerHostStartTime`). An immutable property
 * of a process for its entire lifetime: two DIFFERENT processes that ever
 * held the same pid cannot both report the same start-time (barring a read
 * error), which is what makes "pid matches AND start-time matches" a safe
 * proof of "still the same process", not just "some process now owns this
 * pid".
 *
 * Parsing anchors on the LAST occurrence of the two-character sequence ") "
 * rather than a naive whitespace split: field 2 (`comm`, the executable
 * name) is parenthesized and CAN itself contain spaces and parentheses
 * (e.g. a process named "node (pty host)"), which would shift every
 * subsequent field under a plain split — silently reading the wrong number
 * "most of the time" and breaking on the one process with a weird name. That
 * would be a confident wrong answer, worse than no discriminant.
 *
 * After locating the split point, man(5) proc's field 3 ("state") is
 * `rest[0]`; field 22 ("starttime") is therefore `rest[19]`.
 *
 * A mandatory sanity check follows: `starttime` (in clock ticks, USER_HZ=100
 * on Linux) divided by 100 must not exceed the system's current uptime — a
 * process cannot have started in the future relative to boot. If that check
 * fails, the parse is treated as shifted/malformed and this function returns
 * undefined (never answers from a mis-parsed field) rather than guessing.
 *
 * Returns undefined — never throws — on any read/parse failure or on a
 * non-Linux platform (no /proc); callers must treat "unavailable" the same
 * conservative way `posixProcessGroupReaper.isGroupAlive` treats EPERM: as
 * "cannot prove", never as "prove me dead".
 */
export function readProcessStartTime(pid: number): number | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const splitAt = raw.lastIndexOf(") ");
    if (splitAt < 0) return undefined;
    const rest = raw.slice(splitAt + 2).split(" ");
    const starttime = Number(rest[19]);
    if (!Number.isFinite(starttime) || starttime < 0) return undefined;
    const uptimeRaw = readFileSync("/proc/uptime", "utf8");
    const uptimeSeconds = Number(uptimeRaw.trim().split(/\s+/)[0]);
    if (!Number.isFinite(uptimeSeconds) || starttime / 100 > uptimeSeconds) {
      // Sanity check failed: refuse rather than answer from a shifted parse.
      return undefined;
    }
    return starttime;
  } catch {
    return undefined;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ESRCH") return false;
    // EPERM or anything else: the process DOES exist (we simply may not
    // signal it) — conservative: existing, never gone.
    return true;
  }
}

/** Liveness verdict for a native-terminal PTY session's OWNING HOST. */
export type NativeTerminalOwnerHostStatus = "alive" | "dead" | "unresolvable";

/**
 * Injectable probe: given the (pid, start-time) recorded at PTY-creation
 * time, decide whether that owning host is PROVEN dead. Tests inject fakes;
 * `defaultOwnerHostProbe` below is the real /proc-backed implementation used
 * in production.
 */
export type NativeTerminalOwnerHostProbe = (
  owner: NativeTerminalPgidOwner,
) => NativeTerminalOwnerHostStatus;

/**
 * The real owner-host liveness probe. Two necessary conditions before
 * declaring a host PROVEN DEAD (mirrors reapOrphan's own "prove death, don't
 * just signal" conservatism one level up — see `reconcileDeadHostOrphans`):
 *
 *  - the owner pid no longer exists at all -> DEAD (no ambiguity possible),
 *  - OR the pid exists but its CURRENT start-time differs from the one
 *    recorded at persistence time -> DEAD (the pid was recycled: a different
 *    process now holds it).
 *
 * Every other outcome is conservative-ALIVE: a pid that exists with a
 * matching start-time is alive (possibly just unreachable — NOT proof of
 * death); a pid that exists but whose start-time cannot be read/parsed right
 * now is unresolvable (never guess); a pid that exists with NO recorded
 * start-time (legacy row, or a write-time read failure) cannot be checked
 * for recycling at all, so it stays alive rather than manufacture a "dead"
 * verdict from missing data.
 *
 * This asymmetry is deliberate: the DANGEROUS error (reaping a live host)
 * would require a live process's immutable start-time to change — which
 * cannot happen barring a read error, itself already routed to
 * "unresolvable". The BENIGN error (a recycled pid that coincidentally
 * shares a start-time, or a legacy row with no recorded start-time)
 * concludes "alive" and merely leaves an orphan uncollected — the pre-fix
 * status quo, not a regression.
 */
export const defaultOwnerHostProbe: NativeTerminalOwnerHostProbe = (owner) => {
  if (!processExists(owner.pid)) return "dead";
  if (owner.startTime === undefined) return "alive";
  const currentStartTime = readProcessStartTime(owner.pid);
  if (currentStartTime === undefined) return "unresolvable";
  return currentStartTime === owner.startTime ? "alive" : "dead";
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const NATIVE_TERMINAL_FORCE_KILL_TIMEOUT_MS = 30_000;
const NATIVE_TERMINAL_FORCE_KILL_POLL_INTERVAL_MS = 50;

export type NativeTerminalExit = Readonly<{
  exitCode: number;
  signal?: number;
}>;

export type NativeTerminalSessionStatus = "running" | "stopping" | "exited";

export type NativeTerminalSessionState = Readonly<{
  id: string;
  generation: string;
  incarnation: string;
  pid: number;
  status: NativeTerminalSessionStatus;
  latestSeq: number;
  exit: NativeTerminalExit | null;
  stopSignal: string | null;
  /**
   * Whether a controller currently holds this session's exclusive input lease.
   * Deliberately a BOOLEAN: consumers (restore visibility) only need to know
   * that a controlling terminal exists, never who it is — the controller id
   * stays private to the host.
   */
  controlled: boolean;
}>;

export type NativeTerminalReplay = Readonly<{
  generation: string;
  incarnation: string;
  chunks: ReadonlyArray<TerminalOutputChunk>;
  gap: TerminalReplayGap | null;
  latestSeq: number;
}>;

export type NativeTerminalObserverAttachment = Readonly<{
  role: "observer";
  id: string;
  generation: string;
  incarnation: string;
  controllerEpoch: number;
}>;

export type NativeTerminalControllerLease = Readonly<{
  role: "controller";
  id: string;
  generation: string;
  incarnation: string;
  controllerId: string;
  epoch: number;
}>;

export type NativeTerminalControllerState = Readonly<{
  id: string;
  generation: string;
  incarnation: string;
  controllerEpoch: number;
}>;

export type NativeTerminalCreateOptions = Readonly<{
  id: string;
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
}>;

/**
 * Outcome of asking a host to reap a session BY ID from its persisted pgid —
 * the case where the host asking has no in-memory record of the session at
 * all (a fresh host after the owning host was killed). `"refused"` means
 * either the pgid could not be resolved at all, OR it resolved but the
 * group-leader identity guard (see `#verifyGroupLeaderIdentity`) would not
 * positively re-prove the group at kill-time: NOTHING was signalled (never
 * guess a pgid — killing the wrong process group is irreversible), and a
 * loud diagnostic was logged, because a silent refusal here recreates the
 * invisible-orphan bug. `cause` is present only for the leader-identity
 * refusal and DISCERNS its two distinct roots — `"recycled"` (the pgid was
 * reused by an unrelated process: a correct, defensive refusal) from
 * `"leader-absent"` (the leader is simply unreadable right now: possibly our
 * own orphan, a conservative refuse-and-leak) — collapsing them into one
 * verdict would hide whether this guard is protecting us or making us leak.
 *
 * `verified`, present on `"reaped"` only when the identity guard actually
 * ran, DISCERNS a PROVEN kill (`true` — current and persisted leader
 * start-times matched) from an UNPROVEN one (`false` — a legacy row with no
 * persisted baseline at all: `#verifyGroupLeaderIdentity` fails OPEN there
 * by design — see its doc comment — but that must never look identical to a
 * proven match in logs or outcomes). Absent entirely when no identity check
 * ran at all (e.g. `forceStopAll`, or the group was already confirmed empty
 * before any check).
 */
export type NativeTerminalReapOutcome = Readonly<
  | {
      sessionId: string;
      status: "refused";
      reason: string;
      cause?: "recycled" | "leader-absent";
    }
  | {
      sessionId: string;
      status: "reaped";
      pgid: number;
      elapsedMs: number;
      verified?: boolean;
    }
  | { sessionId: string; status: "reap-timed-out"; pgid: number; elapsedMs: number }
>;

type SessionRecord = {
  readonly id: string;
  readonly incarnation: string;
  readonly pty: PtyHandle;
  readonly replay: TerminalReplayBuffer;
  status: NativeTerminalSessionStatus;
  exit: NativeTerminalExit | null;
  stopSignal: string | null;
  controllerId: string | null;
  controllerEpoch: number;
  dataSubscription?: { dispose(): void };
  exitSubscription?: { dispose(): void };
};

export class NativeTerminalHost {
  readonly #generation: string;
  readonly #replayBytesPerSession: number;
  readonly #maxSessions: number;
  readonly #spawner: PtySpawner;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #registryPath: string | undefined;
  readonly #reaper: NativeTerminalProcessGroupReaper;
  readonly #log: (line: string) => void;
  readonly #forceKillTimeoutMs: number;
  readonly #forceKillPollIntervalMs: number;
  readonly #readLeaderStartTime: (pid: number) => number | undefined;
  readonly #pgidGuardCounters = { recycled: 0, leaderAbsent: 0, unverifiedLegacy: 0 };

  constructor(options: {
    generation: string;
    replayBytesPerSession: number;
    maxSessions?: number;
    spawner: PtySpawner;
    /** Durable store for pgid persistence; defaults to the real registry path. */
    registryPath?: string;
    /** Injectable so tests never send real signals at fabricated pgids. */
    reaper?: NativeTerminalProcessGroupReaper;
    /** Diagnostic sink for the force-kill chain; defaults to prefixed stderr. */
    log?: (line: string) => void;
    forceKillTimeoutMs?: number;
    forceKillPollIntervalMs?: number;
    /** Injectable so tests never touch a real /proc for fabricated pgids;
     * defaults to the real `readProcessStartTime`. Used BOTH to capture the
     * group-leader's start-time at spawn AND to re-read it at kill-time (see
     * `#verifyGroupLeaderIdentity`) — the same probe, applied twice. */
    readLeaderStartTime?: (pid: number) => number | undefined;
  }) {
    if (
      options.generation.trim().length === 0 ||
      options.generation.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ) {
      throw new RangeError(
        `terminal host generation must contain 1-${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
      );
    }
    // Validate the budget once, before the first process is spawned.
    new TerminalReplayBuffer(options.replayBytesPerSession);
    const maxSessions =
      options.maxSessions ?? NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS;
    if (
      !Number.isSafeInteger(maxSessions) ||
      maxSessions <= 0 ||
      maxSessions > NATIVE_TERMINAL_MAX_SESSIONS
    ) {
      throw new RangeError(
        `maxSessions must be between 1 and ${NATIVE_TERMINAL_MAX_SESSIONS}`,
      );
    }
    this.#generation = options.generation;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#maxSessions = maxSessions;
    this.#spawner = options.spawner;
    this.#registryPath = options.registryPath;
    this.#reaper = options.reaper ?? posixProcessGroupReaper;
    this.#log =
      options.log ??
      ((line) => {
        process.stderr.write(`[h2a-pty-host] ${line}\n`);
      });
    this.#forceKillTimeoutMs =
      options.forceKillTimeoutMs ?? NATIVE_TERMINAL_FORCE_KILL_TIMEOUT_MS;
    this.#forceKillPollIntervalMs =
      options.forceKillPollIntervalMs ??
      NATIVE_TERMINAL_FORCE_KILL_POLL_INTERVAL_MS;
    this.#readLeaderStartTime =
      options.readLeaderStartTime ?? readProcessStartTime;
  }

  get generation(): string {
    return this.#generation;
  }

  /**
   * COUNTABLE per arch condition 1/2: the three DISCERNIBLE outcomes of the
   * group-leader-identity guard, so "has this guard ever refused (and why),
   * or ever proceeded WITHOUT proof" is answerable later without
   * re-deriving it from raw logs. `recycled`/`leaderAbsent` are refusals
   * (the kill was NOT emitted); `unverifiedLegacy` is a PROCEED (the kill
   * WAS emitted) on a legacy row with no persisted baseline to check against
   * — the fail-open branch of `#verifyGroupLeaderIdentity`. Never collapsed:
   * a proven kill and an unproven one must never look alike here, exactly as
   * a refusal and a proceed must never look alike — see
   * `NativeTerminalReapOutcome`'s `cause`/`verified`.
   */
  get pgidGuardCounters(): Readonly<{
    recycled: number;
    leaderAbsent: number;
    unverifiedLegacy: number;
  }> {
    return { ...this.#pgidGuardCounters };
  }

  create(options: NativeTerminalCreateOptions): NativeTerminalSessionState {
    if (
      options.id.trim().length === 0 ||
      options.id.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ) {
      throw new RangeError(
        `terminal session id must contain 1-${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
      );
    }
    const existing = this.#sessions.get(options.id);
    if (existing?.status === "exited") {
      this.#forget(existing);
    } else if (existing) {
      throw new Error(`terminal session already exists: ${options.id}`);
    }
    this.#reapExitedUntilBelowLimit();
    if (this.#sessions.size >= this.#maxSessions) {
      throw new Error(
        `terminal host session limit reached: ${this.#maxSessions}`,
      );
    }

    const pty = this.#spawner(options);
    try {
      // Persist BEFORE this session is usable: "known at creation" must
      // survive to "known at kill time" (a fresh host after this one is
      // killed has no other way to learn this session's pgid). A session
      // whose pgid did not durably persist would be unreapable after a host
      // crash — refuse to create it rather than leave an untracked child.
      // The OWNER attribution (this host's own pid + start-time) rides along
      // on the same durable write: it is what lets a LATER reconcile pass
      // prove THIS host is dead (not just unreachable) before ever reaping
      // this row — see `reconcileDeadHostOrphans`. The GROUP-LEADER's own
      // start-time (leader pid == pgid) rides along the same write for the
      // SAME reason one level down: it is what lets a LATER kill re-prove
      // the group itself is still the one this row was written for, not a
      // recycled pgid — see `#verifyGroupLeaderIdentity`.
      const ownStartTime = readProcessStartTime(process.pid);
      const leaderStartTime = this.#readLeaderStartTime(pty.pgid);
      persistNativeTerminalPgid(
        options.id,
        pty.pgid,
        this.#registryPath,
        {
          pid: process.pid,
          ...(ownStartTime === undefined ? {} : { startTime: ownStartTime }),
        },
        leaderStartTime,
      );
    } catch (error) {
      try {
        pty.kill("SIGKILL");
      } catch {
        // Best-effort cleanup of the untracked child we are about to refuse.
      }
      throw new Error(
        `refusing to create terminal session ${options.id}: failed to durably persist its pgid (${String(error)})`,
      );
    }

    const record: SessionRecord = {
      id: options.id,
      incarnation: randomUUID(),
      pty,
      replay: new TerminalReplayBuffer(this.#replayBytesPerSession),
      status: "running",
      exit: null,
      stopSignal: null,
      controllerId: null,
      controllerEpoch: 0,
    };
    this.#sessions.set(record.id, record);

    record.dataSubscription = record.pty.onData((data) => {
      if (record.exit !== null || data.length === 0) return;
      record.replay.append(data);
    });
    record.exitSubscription = record.pty.onExit((event) => {
      if (record.exit !== null) return;
      const exit: { exitCode: number; signal?: number } = {
        exitCode: event.exitCode,
      };
      if (event.signal !== undefined) exit.signal = event.signal;
      record.exit = Object.freeze(exit);
      record.status = "exited";
      this.#invalidateController(record);
      record.dataSubscription?.dispose();
      record.exitSubscription?.dispose();
    });

    return this.#snapshot(record);
  }

  list(): ReadonlyArray<NativeTerminalSessionState> {
    return Object.freeze(
      [...this.#sessions.values()].map((record) => this.#snapshot(record)),
    );
  }

  state(id: string): NativeTerminalSessionState {
    return this.#snapshot(this.#requireSession(id));
  }

  readOutput(id: string, afterSeq: number): NativeTerminalReplay {
    const record = this.#requireSession(id);
    const replay = record.replay.readAfter(afterSeq);
    return Object.freeze({
      generation: this.#generation,
      incarnation: record.incarnation,
      ...replay,
    });
  }

  attachObserver(id: string): NativeTerminalObserverAttachment {
    const record = this.#requireSession(id);
    return Object.freeze({
      role: "observer",
      id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerEpoch: record.controllerEpoch,
    });
  }

  acquireController(
    id: string,
    controllerId: string,
  ): NativeTerminalControllerLease {
    const record = this.#requireControllableSession(id);
    if (
      controllerId.trim().length === 0 ||
      controllerId.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ) {
      throw new RangeError(
        `terminal controller id must contain 1-${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
      );
    }
    if (record.controllerId !== null) {
      throw new Error(`terminal session already has a controller: ${id}`);
    }
    record.controllerEpoch += 1;
    record.controllerId = controllerId;
    return Object.freeze({
      role: "controller",
      id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerId,
      epoch: record.controllerEpoch,
    });
  }

  releaseController(
    lease: NativeTerminalControllerLease,
  ): NativeTerminalControllerState {
    const record = this.#requireMatchingController(lease);
    this.#invalidateController(record);
    return Object.freeze({
      id: record.id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerEpoch: record.controllerEpoch,
    });
  }

  write(lease: NativeTerminalControllerLease, data: string): void {
    if (data.length === 0) {
      throw new RangeError("terminal input must not be empty");
    }
    this.#requireController(lease).pty.write(data);
  }

  resize(
    lease: NativeTerminalControllerLease,
    cols: number,
    rows: number,
  ): void {
    if (
      !Number.isSafeInteger(cols) ||
      cols <= 0 ||
      !Number.isSafeInteger(rows) ||
      rows <= 0
    ) {
      throw new RangeError("terminal dimensions must be positive safe integers");
    }
    this.#requireController(lease).pty.resize(cols, rows);
  }

  stop(
    lease: NativeTerminalControllerLease,
    signal: NativeTerminalStopSignal = "SIGTERM",
  ): NativeTerminalSessionState {
    const record = this.#requireMatchingController(lease);
    const previousStatus = record.status;
    const previousSignal = record.stopSignal;
    record.status = "stopping";
    record.stopSignal = signal;
    try {
      record.pty.kill(signal);
    } catch (error) {
      record.status = previousStatus;
      record.stopSignal = previousSignal;
      throw error;
    }
    return this.#snapshot(record);
  }

  stopAll(
    signal: NativeTerminalStopSignal = "SIGTERM",
  ): ReadonlyArray<NativeTerminalSessionState> {
    for (const record of this.#sessions.values()) {
      if (record.status !== "running") continue;
      record.status = "stopping";
      record.stopSignal = signal;
      this.#invalidateController(record);
      try {
        record.pty.kill(signal);
      } catch (error) {
        record.status = "running";
        record.stopSignal = null;
        throw error;
      }
    }
    return this.list();
  }

  /**
   * Force-stop every non-exited session this host currently knows about — the
   * FORCE path. Unlike `stop()`/`stopAll()` (which go through the pty's own
   * kill(), i.e. the SIGUSR1->trap escalation on Linux — still fine for a
   * graceful, cooperative stop), this emits the group SIGKILL itself, from
   * the PARENT, and WAITS to PROVE the whole group is dead before returning —
   * it does not return "done" on the strength of having merely signalled it.
   * A poll timeout is reported as an error (an absence of information, not a
   * claimed success), never silently swallowed.
   */
  async forceStopAll(
    signal: NativeTerminalStopSignal = "SIGKILL",
  ): Promise<ReadonlyArray<NativeTerminalSessionState>> {
    const errors: unknown[] = [];
    for (const record of this.#sessions.values()) {
      if (record.status === "exited") continue;
      if (record.status === "running") {
        record.status = "stopping";
        this.#invalidateController(record);
      }
      record.stopSignal = signal;
      try {
        const outcome = await this.#killGroupAndConfirmDead(
          record.pty.pgid,
          signal,
          `session ${record.id}`,
        );
        if (outcome.status !== "dead") {
          errors.push(
            new Error(
              `terminal session ${record.id} pgid=${record.pty.pgid} did not confirm dead within ${this.#forceKillTimeoutMs}ms`,
            ),
          );
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "failed to force-stop one or more terminal sessions");
    }
    return this.list();
  }

  /**
   * Reap a session BY ID from its durably persisted pgid, even though THIS
   * host has no in-memory record of it — the case a fresh host faces after
   * the host that created the session was killed. Never guesses a pgid: if
   * it cannot be resolved (registry unreadable, or genuinely never recorded),
   * this signals NOTHING and returns `"refused"` after logging a LOUD
   * diagnostic — a silent no-op here would recreate the exact
   * invisible-orphan bug this mechanism exists to close.
   */
  async reapOrphan(
    sessionId: string,
    signal: NativeTerminalStopSignal = "SIGKILL",
  ): Promise<NativeTerminalReapOutcome> {
    const lookup = readNativeTerminalPgid(sessionId, this.#registryPath);
    if (lookup.status === "unresolved") {
      this.#log(
        `REFUSING to reap terminal session ${sessionId}: pgid could not be resolved (${lookup.reason}). PROCESSES MAY HAVE SURVIVED — no group kill was issued.`,
      );
      return { sessionId, status: "refused", reason: lookup.reason };
    }
    const outcome = await this.#killGroupAndConfirmDead(
      lookup.pgid,
      signal,
      `orphan ${sessionId}`,
      { sessionId, persistedLeaderStartTime: lookup.leaderStartTime },
    );
    if (outcome.status === "dead") {
      return {
        sessionId,
        status: "reaped",
        pgid: lookup.pgid,
        elapsedMs: outcome.elapsedMs,
        ...(outcome.verified !== undefined ? { verified: outcome.verified } : {}),
      };
    }
    if (outcome.status === "timed-out") {
      return { sessionId, status: "reap-timed-out", pgid: lookup.pgid, elapsedMs: outcome.elapsedMs };
    }
    return {
      sessionId,
      status: "refused",
      reason: `group-leader identity could not be re-proven at kill-time (${outcome.cause}) for pgid=${lookup.pgid}`,
      cause: outcome.cause,
    };
  }

  /**
   * INV-4 applied to the GROUP (mirrors the owning-host doctrine one level
   * up — see `defaultOwnerHostProbe`): "known at creation" (the persisted
   * `pgidLeaderStartTime`) must be RE-PROVEN at the moment of acting, never
   * merely inherited. POSITIVE proof only (INV-1) — ambiguity always
   * REFUSES, never kills:
   *
   *  - current leader start-time unreadable (leader gone from /proc right
   *    now) -> cannot positively re-prove the group -> REFUSE, cause
   *    `"leader-absent"` (conservative refuse-and-leak: this may well be our
   *    OWN orphan, already fully dead, but we cannot tell that apart from a
   *    live unrelated leader we simply failed to read).
   *  - current leader start-time read AND a baseline was persisted AND they
   *    DIFFER -> the OS reused `pgid` for an unrelated process since this
   *    row was written -> REFUSE, cause `"recycled"` (the defensive save:
   *    without this check, `killGroup` below would have signalled an
   *    innocent third party).
   *  - no baseline was ever persisted (a legacy row written before this
   *    guard existed, or a write-time read failure) -> nothing to compare
   *    against -> cannot be checked for recycling at all, so this PROCEEDS
   *    rather than manufacture a refusal from missing data — the exact same
   *    asymmetry `defaultOwnerHostProbe` applies to a missing
   *    `ownerHostStartTime` (pre-fix status quo, not a regression). This is
   *    a DELIBERATE fail-OPEN, the opposite decision from the leader-absent
   *    branch above despite both starting from "nothing positively proves
   *    it" — refusing legacy rows would leak every pre-existing session, so
   *    proceeding is correct. But a kill taken on this branch carries the
   *    SAME residual risk a "recycled" refusal exists to prevent, just
   *    un-checked; it must never be silently indistinguishable from a
   *    PROVEN match — counted and logged under its own cause,
   *    `"unverified-legacy"`, and surfaced on the RETURN value (`verified:
   *    false`), not just in a log line.
   *  - current and persisted start-times MATCH -> the group is provably the
   *    one this row was written for -> PROCEED, `verified: true`.
   */
  #verifyGroupLeaderIdentity(
    pgid: number,
    persistedLeaderStartTime: number | undefined,
    sessionId: string,
  ):
    | { proceed: true; verified: true }
    | { proceed: true; verified: false; cause: "unverified-legacy" }
    | { proceed: false; cause: "recycled" | "leader-absent" } {
    const currentStartTime = this.#readLeaderStartTime(pgid);
    if (currentStartTime === undefined) {
      this.#pgidGuardCounters.leaderAbsent += 1;
      this.#log(
        `REFUSING to kill process group pgid=${pgid} for session ${sessionId}: the group leader's start-time is UNREADABLE right now (leader-absent) — cannot positively re-prove this is still the group this row was written for. PROCESSES MAY SURVIVE UNCOLLECTED. cause=leader-absent sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: false, cause: "leader-absent" };
    }
    if (persistedLeaderStartTime === undefined) {
      this.#pgidGuardCounters.unverifiedLegacy += 1;
      this.#log(
        `PROCEEDING to kill process group pgid=${pgid} for session ${sessionId} WITHOUT identity proof: no leader start-time baseline was ever persisted for this row (legacy) — cannot be checked for recycling at all. This kill is UNVERIFIED, not a proven match. cause=unverified-legacy sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: true, verified: false, cause: "unverified-legacy" };
    }
    if (currentStartTime !== persistedLeaderStartTime) {
      this.#pgidGuardCounters.recycled += 1;
      this.#log(
        `REFUSING to kill process group pgid=${pgid} for session ${sessionId}: current leader start-time (${currentStartTime}) DIFFERS from the persisted start-time (${persistedLeaderStartTime}) — pgid was RECYCLED to an unrelated process since this row was written. PROCESSES MAY SURVIVE UNCOLLECTED. cause=recycled sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: false, cause: "recycled" };
    }
    return { proceed: true, verified: true };
  }

  /**
   * Core of both `forceStopAll` and `reapOrphan`: emit the group signal from
   * the parent, then poll `isGroupAlive` (never a fixed sleep-and-hope) until
   * it reports the group empty or `#forceKillTimeoutMs` elapses. On timeout,
   * capture a best-effort survivor list so the caller's diagnostic names
   * exactly what is still alive instead of just "it didn't work".
   *
   * `verify`, when supplied (only `reapOrphan` supplies it — see INV-4 doc on
   * `#verifyGroupLeaderIdentity`), re-proves the group's identity BEFORE the
   * signal is ever emitted. `forceStopAll` never supplies it: it kills a
   * session THIS host is still holding a live in-memory handle to, spawned
   * in this very process — there is no "was this pgid recycled since we last
   * looked" window to close there.
   */
  async #killGroupAndConfirmDead(
    pgid: number,
    signal: NativeTerminalStopSignal,
    label: string,
    verify?: { sessionId: string; persistedLeaderStartTime: number | undefined },
  ): Promise<
    | { status: "dead"; elapsedMs: number; verified?: boolean }
    | { status: "timed-out"; elapsedMs: number }
    | { status: "refused"; cause: "recycled" | "leader-absent" }
  > {
    if (!supportsProcessGroupSignals()) {
      // No POSIX process groups on this platform; nothing more this host can
      // prove. Documented gap, not a silent claim of success.
      this.#log(
        `skipping group-kill proof for pgid=${pgid} (${label}): process groups are not supported on ${process.platform}`,
      );
      return { status: "dead", elapsedMs: 0 };
    }
    if (!this.#reaper.isGroupAlive(pgid)) {
      // The group-leader-identity guard exists to protect a LIVE process
      // about to be signalled from an innocent kill. A group the OS already
      // positively reports empty (ESRCH — the same proof-of-death this
      // method's own poll loop below relies on) has no such live process:
      // kill(-pgid, sig) against zero members signals nobody, recycled pgid
      // or not. Short-circuit BEFORE the guard (and before ever emitting a
      // signal) rather than manufacture a refusal from a target that is not
      // there to protect — this is a positive OS-confirmed fact, not a
      // guess, so it does not weaken INV-1.
      this.#log(
        `pgid=${pgid} already confirmed empty before any signal was emitted (${label})`,
      );
      return { status: "dead", elapsedMs: 0 };
    }
    let verified: boolean | undefined;
    if (verify) {
      const verdict = this.#verifyGroupLeaderIdentity(
        pgid,
        verify.persistedLeaderStartTime,
        verify.sessionId,
      );
      if (!verdict.proceed) {
        return { status: "refused", cause: verdict.cause };
      }
      verified = verdict.verified;
    }
    const start = Date.now();
    try {
      this.#reaper.killGroup(pgid, signal);
      this.#log(`emitted group ${signal} pgid=${pgid} (${label})`);
    } catch (error) {
      this.#log(
        `failed to emit group ${signal} pgid=${pgid} (${label}): ${String(error)}`,
      );
      throw error;
    }
    for (;;) {
      if (!this.#reaper.isGroupAlive(pgid)) {
        const elapsedMs = Date.now() - start;
        this.#log(`confirmed pgid=${pgid} reaped at ${elapsedMs}ms (${label})`);
        return {
          status: "dead",
          elapsedMs,
          ...(verified !== undefined ? { verified } : {}),
        };
      }
      const elapsedMs = Date.now() - start;
      if (elapsedMs >= this.#forceKillTimeoutMs) {
        const survivors = this.#reaper.describeGroup(pgid);
        this.#log(
          `pgid=${pgid} STILL ALIVE at ${elapsedMs}ms (${label}): ${survivors}`,
        );
        return { status: "timed-out", elapsedMs };
      }
      await delay(this.#forceKillPollIntervalMs);
    }
  }

  #requireSession(id: string): SessionRecord {
    const record = this.#sessions.get(id);
    if (!record) throw new Error(`unknown terminal session: ${id}`);
    return record;
  }

  #requireControllableSession(id: string): SessionRecord {
    const record = this.#requireSession(id);
    if (record.status === "exited") {
      throw new Error(`terminal session is already exited: ${id}`);
    }
    return record;
  }

  #requireController(lease: NativeTerminalControllerLease): SessionRecord {
    const record = this.#requireMatchingController(lease);
    if (record.status !== "running") {
      throw new Error("stale terminal controller lease");
    }
    return record;
  }

  #requireMatchingController(
    lease: NativeTerminalControllerLease,
  ): SessionRecord {
    const record = this.#sessions.get(lease.id);
    if (
      lease.generation !== this.#generation ||
      !record ||
      lease.incarnation !== record.incarnation ||
      record.status === "exited" ||
      record.controllerId !== lease.controllerId ||
      record.controllerEpoch !== lease.epoch
    ) {
      throw new Error("stale terminal controller lease");
    }
    return record;
  }

  #reapExitedUntilBelowLimit(): void {
    if (this.#sessions.size < this.#maxSessions) return;
    for (const record of this.#sessions.values()) {
      if (record.status !== "exited") continue;
      this.#forget(record);
      if (this.#sessions.size < this.#maxSessions) return;
    }
  }

  #forget(record: SessionRecord): void {
    record.dataSubscription?.dispose();
    record.exitSubscription?.dispose();
    delete record.dataSubscription;
    delete record.exitSubscription;
    this.#sessions.delete(record.id);
  }

  #invalidateController(record: SessionRecord): void {
    if (record.controllerId === null) return;
    record.controllerId = null;
    record.controllerEpoch += 1;
  }

  #snapshot(record: SessionRecord): NativeTerminalSessionState {
    return Object.freeze({
      id: record.id,
      generation: this.#generation,
      incarnation: record.incarnation,
      pid: record.pty.pid,
      status: record.status,
      latestSeq: record.replay.latestSeq,
      exit: record.exit,
      stopSignal: record.stopSignal,
      controlled: record.controllerId !== null,
    });
  }
}

/** Per-entry outcome of a `reconcileDeadHostOrphans` pass. */
export type NativeTerminalReconcileOutcome = Readonly<
  | { sessionId: string; status: "reaped"; ownerPid: number; pgid: number }
  | { sessionId: string; status: "reap-timed-out"; ownerPid: number; pgid: number }
  | { sessionId: string; status: "reap-refused"; ownerPid: number; pgid: number; reason: string }
  | { sessionId: string; status: "skipped-alive"; ownerPid: number }
  | { sessionId: string; status: "skipped-unresolvable"; ownerPid: number }
  | { sessionId: string; status: "skipped-no-owner" }
>;

/** Summary of a `reconcileDeadHostOrphans` pass. */
export type NativeTerminalReconcileSummary = Readonly<
  | { status: "refused"; reason: string }
  | { status: "completed"; outcomes: ReadonlyArray<NativeTerminalReconcileOutcome> }
>;

/**
 * Reap orphan PTY groups left behind by a PROVEN-DEAD host — the ONE
 * production trigger for `NativeTerminalHost#reapOrphan`. Called at
 * supervisor takeover (see `NativeTerminalHostSupervisor`), the moment a
 * fresh host is about to be spawned because the previous one could not be
 * reached: exactly the moment a stale registry might exist, and exactly the
 * moment this must NOT be mistaken for "the old host is dead".
 *
 * This mirrors `reapOrphan`'s own conservatism one level up: a lost
 * connection to a host is the UNKNOWN, not proof of death. An
 * unreachable-but-alive host (overloaded, a saturated socket, a paused
 * process) is ALIVE and its sessions are live work — reaping there would be
 * a mass-kill dressed up as cleanup. So this function enumerates EVERY
 * durably-persisted native-terminal-pty row and, for EACH ONE
 * INDEPENDENTLY, proves whether ITS OWNING HOST (not "the host we were just
 * talking to") is dead before touching it:
 *
 *  - registry unresolvable (`listNativeTerminalPgidEntries` reports
 *    `known:false`) -> reap NOTHING, loud refusal, `status:"refused"`.
 *  - an entry with no owner attribution recorded (a legacy row written
 *    before this fix, or a write-time start-time-read failure) -> cannot
 *    prove death -> skip.
 *  - `ownerProbe` reports the owner "alive" or "unresolvable" -> skip
 *    (unresolvable is treated exactly like alive: never guess).
 *  - `ownerProbe` reports "dead" (pid gone, or recycled — a live pid whose
 *    start-time no longer matches) -> reap that entry's orphan process group
 *    via `reap`, then prune the entry once the reap is CONFIRMED (`"reaped"`
 *    only — a `"reap-timed-out"` leaves the row for a future pass instead of
 *    losing the only durable record of an unconfirmed pgid).
 *
 * Best-effort per entry: one entry's failure does not stop the pass over the
 * rest (each entry is an independent host/session; a single problem entry
 * must never mask the others).
 */
export async function reconcileDeadHostOrphans(options: {
  registryPath?: string;
  signal?: NativeTerminalStopSignal;
  /** Injectable so tests never touch a real /proc; defaults to the real probe. */
  ownerProbe?: NativeTerminalOwnerHostProbe;
  /** Injectable so tests never send real signals; defaults to a throwaway
   * `NativeTerminalHost` (never spawns a pty) calling the real `reapOrphan`.
   * The persisted pgid is passed through for observability/assertions even
   * though the real reap re-resolves it itself from the SAME registry row —
   * they always agree by construction. */
  reap?: (
    sessionId: string,
    pgid: number,
    signal: NativeTerminalStopSignal,
  ) => Promise<NativeTerminalReapOutcome>;
  log?: (line: string) => void;
} = {}): Promise<NativeTerminalReconcileSummary> {
  const signal = options.signal ?? "SIGKILL";
  const ownerProbe = options.ownerProbe ?? defaultOwnerHostProbe;
  const log =
    options.log ??
    ((line: string) => {
      process.stderr.write(`[h2a-pty-reconcile] ${line}\n`);
    });
  const reap =
    options.reap ??
    (() => {
      const reconcileHost = new NativeTerminalHost({
        generation: `reconcile-${randomUUID()}`,
        replayBytesPerSession: 1,
        spawner: () => {
          throw new Error("reconcile host must never spawn a pty");
        },
        ...(options.registryPath !== undefined ? { registryPath: options.registryPath } : {}),
        log,
      });
      return (sessionId: string, _pgid: number, sig: NativeTerminalStopSignal) =>
        reconcileHost.reapOrphan(sessionId, sig);
    })();

  const snapshot = listNativeTerminalPgidEntries(options.registryPath);
  if (!snapshot.known) {
    log(
      `REFUSING to reconcile native-terminal orphans: registry unreadable (${snapshot.reason}). NOTHING was reaped.`,
    );
    return { status: "refused", reason: snapshot.reason };
  }

  const outcomes: NativeTerminalReconcileOutcome[] = [];
  for (const entry of snapshot.entries) {
    if (!entry.owner) {
      log(
        `skipping native-terminal session ${entry.sessionId}: no owning-host attribution recorded (legacy row) — cannot prove death, reaping nothing.`,
      );
      outcomes.push({ sessionId: entry.sessionId, status: "skipped-no-owner" });
      continue;
    }
    const owner = entry.owner;
    const verdict = ownerProbe(owner);
    if (verdict === "alive") {
      log(
        `skipping native-terminal session ${entry.sessionId}: owning host pid=${owner.pid} is still alive — reaping nothing.`,
      );
      outcomes.push({ sessionId: entry.sessionId, status: "skipped-alive", ownerPid: owner.pid });
      continue;
    }
    if (verdict === "unresolvable") {
      log(
        `skipping native-terminal session ${entry.sessionId}: owning host pid=${owner.pid} liveness is unresolvable — treating conservatively as alive, reaping nothing.`,
      );
      outcomes.push({
        sessionId: entry.sessionId,
        status: "skipped-unresolvable",
        ownerPid: owner.pid,
      });
      continue;
    }
    // verdict === "dead": PROVEN — the owner pid is gone, or was recycled.
    log(
      `native-terminal session ${entry.sessionId}: owning host pid=${owner.pid} is PROVEN DEAD — reaping its orphan process group pgid=${entry.pgid}.`,
    );
    const outcome = await reap(entry.sessionId, entry.pgid, signal);
    if (outcome.status === "reaped") {
      pruneNativeTerminalPgidEntry(entry.sessionId, options.registryPath);
      outcomes.push({
        sessionId: entry.sessionId,
        status: "reaped",
        ownerPid: owner.pid,
        pgid: entry.pgid,
      });
    } else if (outcome.status === "reap-timed-out") {
      log(
        `native-terminal session ${entry.sessionId}: reap did not confirm dead within the timeout — leaving the record for a future pass.`,
      );
      outcomes.push({
        sessionId: entry.sessionId,
        status: "reap-timed-out",
        ownerPid: owner.pid,
        pgid: entry.pgid,
      });
    } else {
      log(`native-terminal session ${entry.sessionId}: reap refused (${outcome.reason}).`);
      outcomes.push({
        sessionId: entry.sessionId,
        status: "reap-refused",
        ownerPid: owner.pid,
        pgid: entry.pgid,
        reason: outcome.reason,
      });
    }
  }
  return { status: "completed", outcomes };
}
