import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

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
  type NativeTerminalPgidEntry,
  type NativeTerminalPgidOwner,
} from "../registry.js";
// The pid-namespace/boot/machine anchor a durable row is only re-provable
// within — the SAME definition the row was written with (see proc-identity.ts).
import { readBootId, readMachineId, readPidNamespaceId } from "../proc-identity.js";
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

/** Env var name the spawned tree's session token travels under (see `create()`). */
export const H2A_SESSION_TOKEN_ENV_VAR = "H2A_SESSION_TOKEN";

/**
 * Enumerate every process currently in Linux process group `pgid` — the
 * pid-recycling-proof discriminant of last resort when the group LEADER
 * itself (pid==pgid) is gone and there is therefore no start-time left to
 * re-read at all (see `#verifyGroupLeaderIdentity`'s leader-absent branch,
 * and the ORDINARY orphan it exists for: a shell that exits normally
 * leaving a backgrounded descendant — leader gone, group alive, no
 * containment ever triggered). Scans `/proc` directly, matching
 * `posixProcessGroupReaper.describeGroup`'s own parsing (field 3, the pgrp,
 * via the same "last ')'" split `readProcessStartTime` above documents at
 * length — a `comm` field can itself contain parens/spaces). Best-effort: a
 * process that exits mid-scan is silently skipped, never treated as a parse
 * failure.
 */
function listProcessGroupMemberPids(pgid: number): number[] {
  if (process.platform !== "linux") return [];
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return [];
  }
  const members: number[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const raw = readFileSync(`/proc/${name}/stat`, "utf8");
      const commandEnd = raw.lastIndexOf(")");
      const fields = raw.slice(commandEnd + 2).split(" ");
      if (Number(fields[2]) === pgid) members.push(Number(name));
    } catch {
      // Exited mid-scan; not a member we can act on either way.
    }
  }
  return members;
}

/**
 * Read the session token a single process currently carries in its own
 * environment (`H2A_SESSION_TOKEN`), by parsing `/proc/<pid>/environ`
 * (NUL-separated `KEY=VALUE` entries — never a shell-quoted string, so no
 * escaping to worry about). Returns undefined on ANY read/parse failure or
 * a non-Linux platform — same "never guess" contract as `readProcessStartTime`.
 */
function readProcessSessionToken(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
    const prefix = `${H2A_SESSION_TOKEN_ENV_VAR}=`;
    for (const entry of raw.split("\0")) {
      if (entry.startsWith(prefix)) return entry.slice(prefix.length);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * The group-MEMBERSHIP anchor of last resort: true iff AT LEAST ONE process
 * currently in group `pgid` carries `expectedToken` in its own environment
 * (see `RegistryEntry.pgidGroupToken`'s doc comment for the full rationale).
 * Used ONLY when the group leader itself is unreadable — the rare path —
 * never as a substitute for the fast leader-start-time check above it.
 *
 * DECLARED LIMITS (do not let a reviewer discover these):
 *  - `/proc/<pid>/environ` is only readable for processes owned by the SAME
 *    uid as this host process — true here (the host and every PTY tree it
 *    spawns share a uid).
 *  - A process can freely rewrite its own environ after exec; this is
 *    therefore a NON-adversarial membership proof. That is sufficient here:
 *    the threat this guards against is the CHANCE of the OS recycling a
 *    pgid to an unrelated process, not an adversary actively forging a
 *    token — an actual attacker with same-uid code execution already has
 *    far more direct ways to interfere than faking this one env var.
 *  - This enumeration runs ONLY on the leader-absent path (never on every
 *    reap), keeping it rare in practice — the fast leader-start-time check
 *    above it covers the common case.
 */
export function groupCarriesSessionToken(pgid: number, expectedToken: string): boolean {
  for (const pid of listProcessGroupMemberPids(pgid)) {
    if (readProcessSessionToken(pid) === expectedToken) return true;
  }
  return false;
}

/** Only these two errno values mean "this pid is gone", never "unreadable". */
function isGoneErrno(error: unknown): boolean {
  return (
    isErrnoException(error) && (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

/**
 * State (field 3) and process-group id (field 5) of one `/proc/.../stat` line.
 * Anchors on the LAST `") "` for the reason `readProcessStartTime` documents at
 * length (a `comm` field can itself contain spaces and parentheses). Returns
 * undefined when the line cannot be parsed — the caller must treat that as
 * "unknown", never as a state.
 */
function parseStatStateAndPgrp(
  raw: string,
): { state: string; pgrp: number } | undefined {
  const splitAt = raw.lastIndexOf(") ");
  if (splitAt < 0) return undefined;
  const fields = raw.slice(splitAt + 2).split(" ");
  const state = fields[0];
  const pgrp = Number(fields[2]);
  if (state === undefined || state.length === 0) return undefined;
  if (!Number.isInteger(pgrp)) return undefined;
  return { state, pgrp };
}

/**
 * Whether the proc filesystem mounted at `procRoot` HIDES other processes
 * (`hidepid=1`/`2`/`invisible`, i.e. systemd's `ProtectProc=`). Under
 * `hidepid=2` a live process owned by another uid is not even listed by
 * `readdir`, so a census cannot detect it by reading anything: only the mount
 * option itself reveals that the view is partial.
 *
 * Three-valued on purpose: `true` = positively hidden, `false` = positively NOT
 * hidden, `undefined` = the mount table could not be read OR describes no proc
 * mount at `procRoot` at all, neither of which is evidence of a complete view.
 * Callers requiring a complete view must accept `false` only.
 */
function procMountHidesProcesses(procRoot: string): boolean | undefined {
  let raw: string;
  try {
    raw = readFileSync(`${procRoot}/self/mountinfo`, "utf8");
  } catch {
    return undefined;
  }
  // `false` is a POSITIVE claim ("this mount does not hide processes"), so it
  // may only be returned once a line actually describing this proc mount was
  // seen. A mount table that names no such mount (a fixture tree, a reader
  // pointed at a copy, an unexpected layout) leaves the frame unknown — the
  // same epistemic state as a table that could not be read.
  let sawProcMountAtRoot = false;
  for (const line of raw.split("\n")) {
    // mountinfo: `id parent major:minor root mountPoint options... - fstype source superOptions`.
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    if (line.split(" ")[4] !== procRoot) continue;
    const post = line.slice(separator + 3).split(" ");
    if (post[0] !== "proc") continue;
    sawProcMountAtRoot = true;
    const option = (post[2] ?? "")
      .split(",")
      .find((candidate) => candidate.startsWith("hidepid="));
    if (option === undefined) continue;
    const value = option.slice("hidepid=".length);
    if (value !== "0" && value !== "off") return true;
  }
  return sawProcMountAtRoot ? false : undefined;
}

/**
 * The EFFECTIVE state of a thread group (`/proc/<tgid>/task/*`): `"Z"` only
 * when EVERY task is a zombie, otherwise the state of the first task that is
 * not. Undefined when the task list, or any task's `stat`, could not be read —
 * including a task that vanished mid-read, which does NOT prove the process
 * gone (a surviving sibling thread keeps it alive).
 *
 * This exists because `/proc/<tgid>/stat` reports the state of the thread-group
 * LEADER task alone. A process whose main thread called `pthread_exit()` while
 * another thread keeps running is a DELAYED zombie: the leader is `Z`, the
 * process is ALIVE, executes code and can fork (`ps` shows `Zl <defunct>`).
 * Reading the leader's `Z` as "this member is dead" is a false death verdict.
 */
function threadGroupState(
  pid: number,
  procRoot: string,
): string | undefined {
  let tids: string[];
  try {
    tids = readdirSync(`${procRoot}/${pid}/task`);
  } catch {
    return undefined;
  }
  let seen = 0;
  for (const tid of tids) {
    if (!/^\d+$/.test(tid)) continue;
    let raw: string;
    try {
      raw = readFileSync(`${procRoot}/${pid}/task/${tid}/stat`, "utf8");
    } catch {
      return undefined;
    }
    const parsed = parseStatStateAndPgrp(raw);
    if (parsed === undefined) return undefined;
    seen += 1;
    if (parsed.state !== "Z") return parsed.state;
  }
  return seen === 0 ? undefined : "Z";
}

/**
 * One census of process group `pgid`: pid -> EFFECTIVE state, for every process
 * the scan could see. Undefined means the census could not be taken COMPLETELY
 * — distinct from an empty map, which means "the scan ran and showed no
 * member". Refuses to answer at all unless:
 *
 *  - the platform is Linux and the proc mount positively does NOT hide
 *    processes (see `procMountHidesProcesses`);
 *  - every `stat` it needed either read successfully or failed with
 *    ENOENT/ESRCH, the ONLY two errors that mean "this pid exited mid-scan".
 *    EACCES, EIO or anything else means a member exists that we cannot see, so
 *    the whole census is unknown;
 *  - every zombie member's own task list confirmed all its threads are zombies
 *    (see `threadGroupState`).
 */
function censusProcessGroup(
  pgid: number,
  procRoot: string,
): Map<number, string> | undefined {
  if (process.platform !== "linux") return undefined;
  if (procMountHidesProcesses(procRoot) !== false) return undefined;
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return undefined;
  }
  const members = new Map<number, string>();
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let raw: string;
    try {
      raw = readFileSync(`${procRoot}/${name}/stat`, "utf8");
    } catch (error) {
      if (isGoneErrno(error)) continue; // exited mid-scan: not a member
      return undefined; // unreadable: a member may exist that we cannot see
    }
    const parsed = parseStatStateAndPgrp(raw);
    if (parsed === undefined) return undefined;
    if (parsed.pgrp !== pgid) continue;
    const pid = Number(name);
    if (parsed.state !== "Z") {
      members.set(pid, parsed.state);
      continue;
    }
    // A `Z` leader task proves nothing about the process: check every thread.
    const effective = threadGroupState(pid, procRoot);
    if (effective === undefined) return undefined;
    members.set(pid, effective);
  }
  return members;
}

/**
 * True iff two CONSECUTIVE censuses of `pgid` both positively show the SAME,
 * non-empty set of members and every one of them is a ZOMBIE down to its last
 * thread — a group that is DEAD for containment: a zombie is an exit status
 * waiting to be collected by its parent, it executes nothing, and no terminal
 * work can ever resume in it.
 *
 * Why this needs its own probe: `kill(-pgid, 0)` answers ALIVE for such a
 * group (a zombie is still attached to its pgid), and a zombie's
 * `/proc/<pid>/environ` is empty, so it can carry no session token either.
 * Without this re-check, the leader-absent branch of
 * `#verifyGroupLeaderIdentity` classifies the group as
 * `membership-unprovable` — an unidentifiable SURVIVOR — and a socket is then
 * contained on account of processes that are already dead. Emitting
 * `kill(-pgid, SIGKILL)` there would not help either: a zombie cannot be
 * killed again, so the confirmation poll would run to its timeout.
 *
 * What this DOES fail closed on (answer `false`, i.e. "not proven dead"):
 * non-Linux; a proc mount that hides processes or whose mount table could not
 * be read; any member `stat` unreadable for a reason other than "it exited";
 * any zombie member whose thread list could not be fully read; a group with no
 * member at all (which contradicts the liveness probe that led here and is
 * therefore not evidence of anything); and two censuses that disagree.
 *
 * DECLARED LIMIT, not closed by this: a census is not atomic. A live member can
 * fork a child that inherits the pgid and exit before its own `stat` is read;
 * the second census is what makes that shape answer `false` (the child is
 * listed, or the member set changed), which NARROWS the race rather than
 * eliminating it. The residual requires a member to fork and exit inside both
 * censuses while leaving an identical, all-zombie pid set behind — and the
 * consequence of the residual is bounded by what a caller does with a `true`:
 * nothing is ever signalled on this path.
 *
 * `procRoot` is injected ONLY by tests (a `/proc`-shaped fixture tree, and a
 * function form so a test can make the two censuses see different trees);
 * production always reads the real `/proc`.
 */
export function groupIsOnlyZombies(
  pgid: number,
  procRoot: string | (() => string) = "/proc",
): boolean {
  const root = () => (typeof procRoot === "function" ? procRoot() : procRoot);
  const first = censusProcessGroup(pgid, root());
  if (first === undefined || first.size === 0) return false;
  for (const state of first.values()) if (state !== "Z") return false;
  const second = censusProcessGroup(pgid, root());
  if (second === undefined || second.size !== first.size) return false;
  for (const [pid, state] of second) {
    if (state !== "Z" || !first.has(pid)) return false;
  }
  return true;
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
/** Deferred pty-exit prune: retry spacing and attempt budget (hygiene only —
 * see `#schedulePruneOfExitedSession`). 8 x 25 ms bounds how long a contended
 * registry keeps one exited session's timer alive. */
const NATIVE_TERMINAL_PRUNE_RETRY_DELAY_MS = 25;
const NATIVE_TERMINAL_PRUNE_MAX_ATTEMPTS = 8;

export type NativeTerminalExit = Readonly<{
  exitCode: number;
  signal?: number;
}>;

export type NativeTerminalSessionStatus = "running" | "stopping" | "exited";

/** The provenance of an exclusive controller, used only for human-input safety. */
export type NativeTerminalControllerActivity = "human" | "automation";

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
  /**
   * Most recent human controller/input activity, in epoch milliseconds. A
   * missing value means an older host did not provide the safety signal and
   * callers that inject input must fail closed; null means no human activity
   * has been observed since this host created the session.
   */
  lastHumanActivityAt?: number | null;
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
 * either the pgid could not be resolved at all, it differed from the
 * immutable PGID snapshotted by reconciliation, process groups are
 * unsupported, OR the group-leader identity guard (see
 * `#verifyGroupLeaderIdentity`) would not positively re-prove the group at
 * kill-time: NOTHING was signalled (never guess a pgid — killing the wrong
 * process group is irreversible), and a loud diagnostic was logged, because
 * a silent refusal here recreates the invisible-orphan bug. `cause` discerns
 * these fail-closed roots; the leader-identity causes remain distinct so a
 * recycled group is never collapsed with an unprovable one.
 *
 * `verified`, present on `"reaped"` only when the identity guard actually
 * ran, DISCERNS a PROVEN kill (`true` — either the current and persisted
 * leader start-times matched, OR the leader was gone but a surviving member
 * carried the persisted session token) from an UNPROVEN one (`false` — a
 * legacy row with no persisted baseline at all to check against, neither a
 * leader start-time nor a group token: `#verifyGroupLeaderIdentity` fails
 * OPEN there by design — see its doc comment — but that must never look
 * identical to a proven match in logs or outcomes). Absent entirely when no
 * identity check ran at all (e.g. `forceStopAll`, or the group was already
 * confirmed empty before any check).
 */
export type NativeTerminalReapRefusalCause =
  | "pgid-mismatch"
  | "unsupported-process-groups"
  | "recycled"
  /**
   * The row records a boot id different from this reader's, in this reader's
   * OWN pid namespace ON THIS SAME MACHINE: every process it describes ended
   * when that boot did. A refusal like `recycled` — nothing was signalled —
   * but a POSITIVE proof that the original group is gone, never evidence of a
   * survivor.
   */
  | "stale-boot"
  /**
   * The row was written in a frame this reader cannot prove is its own:
   * another or an unknown pid namespace, or another boot of a machine not
   * proven to be this one (see proc-identity.ts). Every pid and start-time on
   * it names something else here, so nothing about its group can be decided
   * from this reader — not that it survived, not that it is gone. Nothing was
   * signalled. Kept apart from `membership-unprovable` because a local
   * inspection of the pgid proves nothing either: it describes this reader's
   * process space, not the one that wrote the row.
   */
  | "foreign-frame"
  | "membership-unprovable";

/** The frame a durable row's pids and start-times are valid in (see
 * proc-identity.ts), recorded by the writer and re-read by the reader. */
export type NativeTerminalProcFrame = Readonly<{
  pidNamespace?: string;
  bootId?: string;
  machineId?: string;
}>;

function readCurrentProcFrame(): NativeTerminalProcFrame {
  const pidNamespace = readPidNamespaceId();
  const bootId = readBootId();
  const machineId = readMachineId();
  return {
    ...(pidNamespace !== undefined ? { pidNamespace } : {}),
    ...(bootId !== undefined ? { bootId } : {}),
    ...(machineId !== undefined ? { machineId } : {}),
  };
}

export type NativeTerminalReapOutcome = Readonly<
  | {
      sessionId: string;
      status: "refused";
      reason: string;
      cause?: NativeTerminalReapRefusalCause;
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
  /**
   * The group-membership token persisted on this session's durable row (see
   * `RegistryEntry.pgidGroupToken`). Kept in memory so a prune can COMPARE-AND-
   * DELETE on the row's own identity — pgid AND token — instead of on a session
   * id another host may legitimately be using by now.
   */
  readonly groupToken: string;
  readonly replay: TerminalReplayBuffer;
  status: NativeTerminalSessionStatus;
  exit: NativeTerminalExit | null;
  stopSignal: string | null;
  controllerId: string | null;
  controllerActivity: NativeTerminalControllerActivity | null;
  controllerEpoch: number;
  lastHumanActivityAt: number | null;
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
  readonly #socketPath: string | undefined;
  readonly #reaper: NativeTerminalProcessGroupReaper;
  readonly #log: (line: string) => void;
  readonly #forceKillTimeoutMs: number;
  readonly #forceKillPollIntervalMs: number;
  readonly #readLeaderStartTime: (pid: number) => number | undefined;
  readonly #findGroupMemberToken: (pgid: number, expectedToken: string) => boolean;
  readonly #groupIsOnlyZombies: (pgid: number) => boolean;
  readonly #readFrame: () => NativeTerminalProcFrame;
  readonly #pgidGuardCounters = {
    recycled: 0,
    staleBoot: 0,
    foreignFrame: 0,
    membershipUnprovable: 0,
    unverifiedLegacy: 0,
    tokenVerified: 0,
    zombieGroup: 0,
    groupDrained: 0,
  };

  constructor(options: {
    generation: string;
    replayBytesPerSession: number;
    maxSessions?: number;
    spawner: PtySpawner;
    /** Durable store for pgid persistence; defaults to the real registry path. */
    registryPath?: string;
    /**
     * The socket this host serves, recorded on every durable row it writes
     * (see `RegistryEntry.ownerHostSocketPath`). Optional: a host constructed
     * without it (the reconcile-only throwaway below, and unit tests that
     * never publish a socket) simply writes rows with no socket attribution.
     */
    socketPath?: string;
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
    /** Injectable so tests never touch a real /proc for fabricated pgids;
     * defaults to the real `groupCarriesSessionToken`. Consulted ONLY when
     * the leader is absent — see `#verifyGroupLeaderIdentity`. */
    findGroupMemberToken?: (pgid: number, expectedToken: string) => boolean;
    /** Injectable so tests never touch a real /proc for fabricated pgids;
     * defaults to the real `groupIsOnlyZombies`. Consulted ONLY when the
     * leader is absent AND no member carries the token, as the last re-check
     * before refusing — see `#verifyGroupLeaderIdentity`. */
    groupIsOnlyZombies?: (pgid: number) => boolean;
    /** Injectable so tests can stand in for another machine, boot or pid
     * namespace without root; defaults to the real proc-identity readers.
     * The READER's frame, compared with the one a durable row records before
     * any pid-based proof is derived from that row — see
     * `#verifyGroupLeaderIdentity`. */
    readFrame?: () => NativeTerminalProcFrame;
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
    // NORMALIZED before it is ever recorded: this string is the socket
    // ATTRIBUTION a supervisor's socket-scoped containment decision is derived
    // from (see `RegistryEntry.ownerHostSocketPath`), and two spellings of the
    // same socket — a doubled separator, a "." segment, a relative path —
    // would compare unequal and fail OPEN. The supervisor normalizes its own
    // socket path the same way, and normalizes the row's value at comparison
    // time so rows written before this still match.
    this.#socketPath =
      options.socketPath === undefined ? undefined : resolve(options.socketPath);
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
    this.#findGroupMemberToken =
      options.findGroupMemberToken ?? groupCarriesSessionToken;
    this.#groupIsOnlyZombies = options.groupIsOnlyZombies ?? groupIsOnlyZombies;
    this.#readFrame = options.readFrame ?? readCurrentProcFrame;
  }

  get generation(): string {
    return this.#generation;
  }

  /**
   * COUNTABLE per arch condition 1/2: the five DISCERNIBLE outcomes of the
   * group-leader-identity guard, so "has this guard ever refused (and why),
   * or ever proceeded WITHOUT the fast leader-start-time proof" is
   * answerable later without re-deriving it from raw logs.
   * `recycled`/`membershipUnprovable` are refusals (the kill was NOT
   * emitted). `tokenVerified` is a PROVEN proceed via the group-membership
   * token (the leader was absent, but a surviving member carried it) —
   * distinct from the ordinary start-time-matched proceed, which is not
   * counted at all (it is the expected common case). `unverifiedLegacy` is
   * an UNPROVEN proceed (the kill WAS emitted) on a row with no baseline —
   * neither a leader-start-time nor a group-token — to check against at
   * all, the fail-open branch of `#verifyGroupLeaderIdentity`.
   * `zombieGroup` is neither a refusal nor a kill: the group was found
   * reduced to zombies, i.e. already dead, so NOTHING was emitted and the
   * reap is reported confirmed. `groupDrained` is its sibling: the group was
   * still there when the checks began and the OS positively reported it EMPTY
   * when they ended. `staleBoot` is a refusal that PROVES the group gone (the
   * row predates this boot), counted apart from `recycled` because the two
   * rest on different facts. `foreignFrame` is a refusal that proves NOTHING
   * because the row was written in a frame this reader cannot prove is its
   * own, counted apart from `membershipUnprovable`, which judged a group in
   * this reader's own process space. Never collapsed: a proven kill, an
   * unproven one, a refusal that proves death, a refusal that proves nothing,
   * and an already-dead group must never look alike here — see
   * `NativeTerminalReapOutcome`'s `cause`/`verified`.
   */
  get pgidGuardCounters(): Readonly<{
    recycled: number;
    staleBoot: number;
    foreignFrame: number;
    membershipUnprovable: number;
    unverifiedLegacy: number;
    tokenVerified: number;
    zombieGroup: number;
    groupDrained: number;
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

    // A per-session token, injected into the spawned tree's OWN environment
    // so every descendant inherits it — the group-MEMBERSHIP anchor for the
    // case the leader's start-time cannot cover: the leader (pid==pgid)
    // simply gone, group still alive, no containment ever triggered (an
    // ordinary shell that exits normally leaving a backgrounded descendant).
    // See `groupCarriesSessionToken`/`#verifyGroupLeaderIdentity`.
    const groupToken = randomUUID();
    const pty = this.#spawner({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: { ...options.env, [H2A_SESSION_TOKEN_ENV_VAR]: groupToken },
      cols: options.cols,
      rows: options.rows,
    });
    // Known pre-existing narrow window: a host SIGKILL after this synchronous
    // spawn and before the following synchronous persist leaves no durable
    // row for the survivor. Persisting first is impossible: spawn allocates
    // the pgid.
    try {
      // Persist BEFORE this session is usable: "known at creation" must
      // survive to "known at kill time" (a fresh host after this one is
      // killed has no other way to learn this session's pgid). A session
      // whose pgid did not durably persist would be unreapable after a host
      // crash — refuse to create it rather than leave an untracked child.
      // The OWNER attribution (this host's own pid + start-time, plus the
      // socket it serves) rides along on the same durable write: the pid and
      // start-time are what let a LATER reconcile pass prove THIS host is
      // dead (not just unreachable) before ever reaping this row, and the
      // socket is what keeps a fail-closed containment decision SCOPED to the
      // supervisor that owns it — see `reconcileDeadHostOrphans`. The
      // GROUP-LEADER's own start-time (leader pid == pgid) and the GROUP
      // token both ride along the same write for the SAME reason one level
      // down: they are what let a LATER kill re-prove the group itself is
      // still the one this row was written for, not a recycled pgid — see
      // `#verifyGroupLeaderIdentity`.
      const ownStartTime = readProcessStartTime(process.pid);
      const leaderStartTime = this.#readLeaderStartTime(pty.pgid);
      persistNativeTerminalPgid(
        options.id,
        pty.pgid,
        this.#registryPath,
        {
          pid: process.pid,
          ...(ownStartTime === undefined ? {} : { startTime: ownStartTime }),
          ...(this.#socketPath === undefined ? {} : { socketPath: this.#socketPath }),
        },
        leaderStartTime,
        groupToken,
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
      groupToken,
      replay: new TerminalReplayBuffer(this.#replayBytesPerSession),
      status: "running",
      exit: null,
      stopSignal: null,
      controllerId: null,
      controllerActivity: null,
      controllerEpoch: 0,
      lastHumanActivityAt: null,
    };
    this.#sessions.set(record.id, record);

    // Carry of the previous chunk so a DSR split across chunks is still seen.
    // At most 3 chars: a full 4-char query can never hide entirely in it.
    let dsrTail = "";
    record.dataSubscription = record.pty.onData((data) => {
      if (record.exit !== null || data.length === 0) return;
      record.replay.append(data);
      // Answer Device Status Report cursor queries (ESC[6n) like a real
      // terminal/tmux: TUIs that require a cursor-position report (muse
      // aborts with "cursor position could not be read" without it).
      const window = dsrTail + data;
      dsrTail = window.slice(-3);
      const queries = window.split("\x1b[6n").length - 1;
      for (let i = 0; i < queries; i++) {
        try {
          record.pty.write("\x1b[1;1R");
        } catch {
          // Child already gone; nothing left to answer.
          break;
        }
      }
    });
    record.exitSubscription = record.pty.onExit((event) => {
      if (record.exit !== null) return;
      // A durable row exists to make this session reapable after THIS host
      // dies. Once the group is confirmed empty the row can no longer make
      // anything reapable — it is a stale record that a later host death would
      // re-examine against whatever holds that pgid NUMBER by then. Drop it
      // on POSITIVE proof only (see `#pruneDurableRowIfGroupEmpty`), and OFF
      // this callback: this is node-pty's own synchronous exit callback on the
      // host's event loop (see `#schedulePruneOfExitedSession`).
      this.#schedulePruneOfExitedSession(record, "its pty exited");
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
    activity: NativeTerminalControllerActivity = "human",
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
    if (activity !== "human" && activity !== "automation") {
      throw new TypeError("terminal controller activity must be human or automation");
    }
    record.controllerEpoch += 1;
    record.controllerId = controllerId;
    record.controllerActivity = activity;
    if (activity === "human") record.lastHumanActivityAt = Date.now();
    return Object.freeze({
      role: "controller",
      id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerId,
      epoch: record.controllerEpoch,
    });
  }

  /**
   * Atomically acquire automation input only when no human activity is recent.
   * This runs entirely in the host's serialized request handler: a human
   * controller cannot appear between the safety decision and the lease grant.
   */
  acquireAutomationControllerIfNoRecentHuman(
    id: string,
    controllerId: string,
    activityWindowMs: number,
  ): NativeTerminalControllerLease {
    if (!Number.isSafeInteger(activityWindowMs) || activityWindowMs < 0) {
      throw new RangeError("terminal human activity window must be a non-negative safe integer");
    }
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
    const activityAt = record.lastHumanActivityAt;
    if (
      activityAt !== null &&
      (!Number.isSafeInteger(activityAt) || activityAt < 0 || Date.now() < activityAt ||
        (activityWindowMs > 0 && Date.now() - activityAt < activityWindowMs))
    ) {
      throw new Error(`terminal session has recent human activity: ${id}`);
    }
    return this.acquireController(id, controllerId, "automation");
  }

  releaseController(
    lease: NativeTerminalControllerLease,
  ): NativeTerminalControllerState {
    const record = this.#requireMatchingController(lease);
    if (record.controllerActivity === "human") record.lastHumanActivityAt = Date.now();
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
    const record = this.#requireController(lease);
    if (record.controllerActivity === "human") record.lastHumanActivityAt = Date.now();
    record.pty.write(data);
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

  /**
   * Owner-only destructive stop for an explicitly requested CLI restart.
   *
   * Unlike `stop()`, this operation deliberately does not acquire a second
   * input controller: an attached terminal already owns that lease. The host
   * instead fences the act with the generation + incarnation observed during
   * restart preflight. Both comparisons and the signal happen in this one
   * serialized host request, so a same-name session recreated in between can
   * never be killed by a stale restart command.
   */
  stopIfIncarnation(
    id: string,
    expectedGeneration: string,
    expectedIncarnation: string,
    signal: NativeTerminalStopSignal = "SIGTERM",
  ): NativeTerminalSessionState {
    if (expectedGeneration !== this.#generation) {
      throw new Error("stale terminal host generation");
    }
    const record = this.#requireControllableSession(id);
    if (record.incarnation !== expectedIncarnation) {
      throw new Error("stale terminal session incarnation");
    }
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
    // Invalidate an attached controller only after the fenced signal was
    // accepted. A failed signal leaves the live session and its controller
    // exactly as they were.
    this.#invalidateController(record);
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
        } else {
          // PROVEN empty by the call above, so the durable row cannot make
          // anything reapable any more — the same staleness the pty-exit path
          // prunes, reached through the shutdown path instead. This one DOES
          // wait for the lock: `forceStopAll` is the graceful-shutdown path, it
          // is already asynchronous, and the row should be gone before the host
          // exits rather than left to a timer that may never fire.
          this.#pruneDurableRowIfGroupEmpty(
            record,
            "forceStopAll proved its group dead",
            { waitForLock: true },
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
   *
   * `expectedPgid` and `expected.groupToken` are the caller's IMMUTABLE
   * snapshot of the row, and BOTH are re-compared against the row as it reads
   * NOW — the same compare-and-delete identity `pruneNativeTerminalPgidEntry`
   * uses, applied to the kill side. Comparing the pgid NUMBER alone is not
   * enough: session ids are caller-chosen, so a live host can recreate the
   * same id within one reconcile pass, and its new PTY leader can be handed
   * back the pid number the snapshotted group just freed. The re-read then
   * matches, every identity check below verifies against the NEW row's own
   * baselines, and a LIVE group is killed. The token is a per-session
   * `randomUUID`, so a successor never matches it. A caller that omits the
   * token (a legacy row carries none) does not constrain it.
   */
  async reapOrphan(
    sessionId: string,
    signal: NativeTerminalStopSignal = "SIGKILL",
    expectedPgid?: number,
    expected?: { groupToken?: string },
  ): Promise<NativeTerminalReapOutcome> {
    const lookup = readNativeTerminalPgid(sessionId, this.#registryPath);
    if (lookup.status === "unresolved") {
      this.#log(
        `REFUSING to reap terminal session ${sessionId}: pgid could not be resolved (${lookup.reason}). PROCESSES MAY HAVE SURVIVED — no group kill was issued.`,
      );
      return { sessionId, status: "refused", reason: lookup.reason };
    }
    if (expectedPgid !== undefined && lookup.pgid !== expectedPgid) {
      this.#log(
        `REFUSING to reap terminal session ${sessionId}: immutable snapshot pgid=${expectedPgid}, but the registry now resolves pgid=${lookup.pgid}. PROCESSES MAY HAVE SURVIVED — no group kill was issued. cause=pgid-mismatch sessionId=${sessionId} snapshotPgid=${expectedPgid} resolvedPgid=${lookup.pgid}`,
      );
      return {
        sessionId,
        status: "refused",
        reason: `immutable snapshot pgid=${expectedPgid} differs from re-resolved pgid=${lookup.pgid}`,
        cause: "pgid-mismatch",
      };
    }
    // Checked AFTER the pgid, so the common rewrite keeps the diagnostic that
    // names both pgid numbers. This one catches what that check cannot see: the
    // row was rewritten for a DIFFERENT group that happens to carry the same
    // pgid number — the successor's PTY leader was handed back the pid number
    // the snapshotted group had just freed.
    if (
      expected?.groupToken !== undefined &&
      lookup.groupToken !== expected.groupToken
    ) {
      this.#log(
        `REFUSING to reap terminal session ${sessionId}: pgid=${lookup.pgid} still matches the immutable snapshot, but the registry row now carries a DIFFERENT group token — it describes another group under the same session id, reachable at the same pid number. PROCESSES MAY HAVE SURVIVED — no group kill was issued. cause=pgid-mismatch sessionId=${sessionId} resolvedPgid=${lookup.pgid}`,
      );
      return {
        sessionId,
        status: "refused",
        reason: `the re-resolved row carries a different group token than the immutable snapshot (pgid=${lookup.pgid})`,
        cause: "pgid-mismatch",
      };
    }
    const outcome = await this.#killGroupAndConfirmDead(
      lookup.pgid,
      signal,
      `orphan ${sessionId}`,
      {
        sessionId,
        persistedLeaderStartTime: lookup.leaderStartTime,
        persistedGroupToken: lookup.groupToken,
        persistedFrame: {
          ...(lookup.pidNamespace !== undefined ? { pidNamespace: lookup.pidNamespace } : {}),
          ...(lookup.bootId !== undefined ? { bootId: lookup.bootId } : {}),
          ...(lookup.machineId !== undefined ? { machineId: lookup.machineId } : {}),
        },
      },
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
      reason: `orphan process group could not be safely reaped (${outcome.cause}) for pgid=${lookup.pgid}`,
      cause: outcome.cause,
    };
  }

  /**
   * INV-4 applied to the GROUP (mirrors the owning-host doctrine one level
   * up — see `defaultOwnerHostProbe`): "known at creation" (the persisted
   * `pgidLeaderStartTime`/`pgidGroupToken`) must be RE-PROVEN at the moment
   * of acting, never merely inherited. POSITIVE proof only (INV-1) —
   * ambiguity always REFUSES, never kills. In order:
   *
   *  0. The row's FRAME (`pgidPidNamespace`/`pgidBootId`/`pgidMachineId`,
   *     see proc-identity.ts) is checked FIRST, because every comparison below
   *     is between a number persisted then and a number read now, and that is
   *     meaningless across a pid namespace, a reboot or a machine. Three cases:
   *     - SAME, KNOWN pid namespace, DIFFERENT boot id, SAME, KNOWN machine id
   *       -> the row is from a previous boot of this very pid space on this
   *       very machine, and a reboot ends every process of the boot before
   *       it. That is POSITIVE proof that every process this row describes
   *       has ended — the strongest form of the `recycled` proof, not an
   *       absence of one. REFUSE (nothing is ever signalled: the pgid NUMBER
   *       may well be held by an unrelated live group now, and it must not be
   *       touched) with cause `"stale-boot"`, which reconcile reads as proof
   *       and prunes the row on. The machine id is what makes this a proof:
   *       the init pid namespace has the SAME inode on every kernel and a boot
   *       id is random per boot, so without it the very same two fields are
   *       also what a row written by ANOTHER machine sharing this registry
   *       (a networked `$HOME`) looks like — and that machine's group may be
   *       alive. DECLARED EXCEPTIONS, out of model: a process checkpointed
   *       before the reboot and restored after it (CRIU) can carry its pid
   *       across boots, and two machines cloned from one image without
   *       regenerating machine-id(5) are indistinguishable. h2a never
   *       checkpoints a PTY host, and a deployment that restores one, or that
   *       shares one registry between machines with duplicated machine ids,
   *       must not rely on this proof.
   *     - Any other mismatch — including an UNKNOWN namespace, boot id or
   *       (for the boot proof) machine id on either side -> REFUSE, cause
   *       `"foreign-frame"` (a start-time mismatch would otherwise be read as
   *       `recycled` and prune the row; a coincidental MATCH would authorize a
   *       kill at a group this row never described). A pid number means
   *       nothing outside the frame it was resolved in, so neither proof is
   *       available there, and neither is any local inspection: blocking.
   *     - A row that records NO pid-space frame is not refused here — that
   *       would strand every row written before the field existed — but it
   *       cannot earn the `recycled` PROOF either (see branch 2).
   *     DECLARED LIMIT, outside this guard: the already-empty short-circuit in
   *     `#killGroupAndConfirmDead` answers BEFORE this frame check, so a row
   *     whose pgid number is empty in this reader's process space is reported
   *     reaped (and pruned) whatever frame it records. Within one machine that
   *     is the pre-existing behaviour every row has always had; across
   *     machines sharing one registry it is NOT a proof, and that deployment
   *     shape is not covered.
   *  1. Leader **readable**, no start-time baseline was ever persisted (a
   *     legacy row, or a write-time read failure) -> nothing to compare
   *     against -> cannot be checked for recycling at all, so this PROCEEDS
   *     rather than manufacture a refusal from missing data — the exact
   *     same asymmetry `defaultOwnerHostProbe` applies to a missing
   *     `ownerHostStartTime` (pre-fix status quo, not a regression).
   *     Cause `"unverified-legacy"`, `verified: false` — a kill taken here
   *     carries the SAME residual risk a `"recycled"` refusal exists to
   *     prevent, just un-checked; it must never be silently
   *     indistinguishable from a PROVEN match.
   *  2. Leader **readable**, start-time **DIFFERENT** from the persisted
   *     baseline -> the OS reused `pgid` for an unrelated process since
   *     this row was written -> REFUSE, cause `"recycled"` (the defensive
   *     save: without this check, `killGroup` below would have signalled
   *     an innocent third party). `"recycled"` is also a POSITIVE proof that
   *     the original group is gone — reconcile prunes the row on it — so it
   *     requires the row to carry BOTH frame fields (matched in step 0). A row
   *     with no frame takes the blocking `"membership-unprovable"` instead: the
   *     mismatch is real, but it cannot prove anything about this reader's pid
   *     space.
   *  3. Leader **readable**, start-time **MATCHES** -> the group is
   *     provably the one this row was written for -> PROCEED,
   *     `verified: true`.
   *  4. Leader **absent** (unreadable right now) -> there is no start-time
   *     left to compare at all — the ORDINARY orphan this whole mechanism
   *     exists for (a shell that exits normally leaving a backgrounded
   *     descendant: leader gone, group alive, no containment ever
   *     triggered). Falls to the group-MEMBERSHIP token instead:
   *     - no token baseline was ever persisted either (same "nothing to
   *       compare" asymmetry as branch 1) -> PROCEED, cause
   *       `"unverified-legacy"`, `verified: false`.
   *     - a persisted token exists AND `groupCarriesSessionToken` finds it
   *       on a surviving member -> POSITIVE proof of membership,
   *       independent of the leader -> PROCEED, `verified: true`, cause
   *       `"token-verified"`.
   *     - a persisted token exists and NO surviving member carries it ->
   *       ONE re-check before refusing: a group the OS reports alive whose
   *       every member is a ZOMBIE is already dead (see
   *       `groupIsOnlyZombies` — a zombie is attached to its pgid, executes
   *       nothing, and its environ is empty so it could never have carried
   *       the token). That is `alreadyDead`, cause `"zombie-group"`:
   *       NOTHING is signalled and the reap is reported CONFIRMED, because
   *       a group with no live member cannot resume terminal work and a
   *       group-kill would only poll to its timeout.
   *     - the census did not prove the group all-zombie -> ONE last probe
   *       before refusing: the liveness check that admitted this group ran
   *       BEFORE every check above, and those checks take real time (two full
   *       `/proc` censuses among them). A group whose last members were
   *       collected meanwhile is EMPTY now, and the OS says so. `isGroupAlive`
   *       answering ESRCH is the same positive proof of death the
   *       short-circuit in `#killGroupAndConfirmDead` and its confirmation
   *       poll already act on, so this cannot manufacture a death verdict —
   *       a live group, leaderless or `Zl`, still answers ALIVE and is still
   *       refused. That is `alreadyDead`, cause `"group-drained"`.
   *     - otherwise -> cannot positively prove this group's identity by any
   *       means -> REFUSE, cause `"membership-unprovable"` (conservative
   *       refuse-and-leak: this may well be our OWN orphan, already fully
   *       dead, but we cannot tell that apart from a live unrelated group
   *       we simply cannot identify). DISTINCT from `"recycled"` in the
   *       union, its own counter, its own log — "positively someone
   *       else's" and "cannot prove it is ours" are different epistemic
   *       states.
   */
  #verifyGroupLeaderIdentity(
    pgid: number,
    persistedLeaderStartTime: number | undefined,
    persistedGroupToken: string | undefined,
    sessionId: string,
    frame: NativeTerminalProcFrame = {},
  ):
    | { proceed: true; verified: true; cause?: "token-verified" }
    | { proceed: true; verified: false; cause: "unverified-legacy" }
    | { proceed: false; alreadyDead: true; cause: "zombie-group" | "group-drained" }
    | {
        proceed: false;
        alreadyDead?: false;
        cause: "recycled" | "stale-boot" | "foreign-frame" | "membership-unprovable";
      } {
    // FRAME CHECK, before any pid-based comparison. Every proof below compares a
    // number persisted earlier with a number read now, and that is meaningful
    // only while both were taken in the same pid namespace and after the same
    // boot (see proc-identity.ts). A row that records a frame which does not
    // match this reader's is unusable in BOTH directions: a start-time mismatch
    // would be read as "recycled" (pruning the row and releasing the socket on a
    // proof that does not hold), and a coincidental MATCH would authorize a
    // group SIGKILL at a group this row never described. Refuse, blocking, which
    // is the behaviour that predates the `recycled` outcome.
    //
    // ONE mismatch is different, and is separated out below: same pid namespace,
    // different BOOT, same MACHINE. That is not an absence of proof, it is the
    // strongest proof available — a reboot ends every process of the boot
    // before it — so it prunes instead of blocking. It is still a refusal:
    // nothing is signalled, because an unrelated live group may hold the pgid
    // number by now.
    const anchoredFrame =
      frame.pidNamespace !== undefined && frame.bootId !== undefined;
    if (frame.pidNamespace !== undefined || frame.bootId !== undefined) {
      const current = this.#readFrame();
      // The boot proof is admissible only inside ONE pid space, KNOWN on both
      // sides: a pid resolved in another namespace is a different process, and
      // an unknown namespace on either side is no statement at all.
      const sameKnownPidNamespace =
        frame.pidNamespace !== undefined &&
        current.pidNamespace !== undefined &&
        frame.pidNamespace === current.pidNamespace;
      // ...and only on ONE machine, KNOWN on both sides. The init pid
      // namespace has the same inode on every kernel and boot ids are random
      // per boot, so "same namespace, different boot" is ALSO what a row written
      // by another machine sharing this registry looks like — a machine whose
      // group may be alive right now. Only the machine id tells the two apart.
      const sameKnownMachine =
        frame.machineId !== undefined &&
        current.machineId !== undefined &&
        frame.machineId === current.machineId;
      const differentKnownBoot =
        frame.bootId !== undefined &&
        current.bootId !== undefined &&
        frame.bootId !== current.bootId;
      if (sameKnownPidNamespace && sameKnownMachine && differentKnownBoot) {
        // PROOF, not an absence of one: a reboot ends every process of the
        // boot before it, so every process this row describes has ended. The
        // pgid NUMBER may be held by an unrelated live group now, which is
        // exactly why nothing is signalled here and why no diagnostic may
        // point anyone at it.
        this.#pgidGuardCounters.staleBoot += 1;
        this.#log(
          `NOT signalling process group pgid=${pgid} for session ${sessionId}: this row was written at boot ${String(frame.bootId)} and this reader is at boot ${String(current.bootId)}, in the same pid namespace ${String(current.pidNamespace)} on the same machine ${String(current.machineId)} — the reboot ENDED every process this row describes, so its group is PROVEN gone. The number pgid=${pgid} may belong to an unrelated live group now and must NOT be killed. cause=stale-boot sessionId=${sessionId} pgid=${pgid}`,
        );
        return { proceed: false, cause: "stale-boot" };
      }
      if (
        frame.pidNamespace !== current.pidNamespace ||
        frame.bootId !== current.bootId
      ) {
        // Says WHY nothing could be proven, because the two shapes call for
        // different checks by whoever reads this: a boot change that only lacks
        // the machine proof is either a reboot of this machine or another
        // machine; anything else is another (or an unknown) pid space.
        const why = sameKnownPidNamespace && differentKnownBoot
          ? `a different boot in the same pid namespace inode is what a previous boot of THIS machine looks like, but also what ANOTHER machine sharing this registry looks like, and the machine ids that would tell them apart are ${frame.machineId === undefined || current.machineId === undefined ? "not known on both sides" : "DIFFERENT"}`
          : "no pid or start-time on it can be re-proven here";
        this.#pgidGuardCounters.foreignFrame += 1;
        this.#log(
          `REFUSING to act on process group pgid=${pgid} for session ${sessionId}: this row records pid namespace ${String(frame.pidNamespace)}, boot ${String(frame.bootId)} and machine ${String(frame.machineId)}, but this reader is in pid namespace ${String(current.pidNamespace)} at boot ${String(current.bootId)} on machine ${String(current.machineId)} — ${why}. Inspecting pgid=${pgid} HERE proves nothing about this row. PROCESSES MAY SURVIVE UNCOLLECTED. cause=foreign-frame sessionId=${sessionId} pgid=${pgid}`,
        );
        return { proceed: false, cause: "foreign-frame" };
      }
    }
    const currentStartTime = this.#readLeaderStartTime(pgid);
    if (currentStartTime !== undefined) {
      if (persistedLeaderStartTime === undefined) {
        this.#pgidGuardCounters.unverifiedLegacy += 1;
        this.#log(
          `PROCEEDING to kill process group pgid=${pgid} for session ${sessionId} WITHOUT identity proof: no leader start-time baseline was ever persisted for this row (legacy) — cannot be checked for recycling at all. This kill is UNVERIFIED, not a proven match. cause=unverified-legacy sessionId=${sessionId} pgid=${pgid}`,
        );
        return { proceed: true, verified: false, cause: "unverified-legacy" };
      }
      if (currentStartTime !== persistedLeaderStartTime) {
        if (!anchoredFrame) {
          // The mismatch is real, but "the pgid was RECYCLED, so the original
          // group is gone" is a claim about ONE pid namespace and ONE boot, and
          // this row cannot pin either (written before the anchor existed). Keep
          // refusing — blocking, row kept — instead of pruning on a proof this
          // row cannot support.
          this.#pgidGuardCounters.membershipUnprovable += 1;
          this.#log(
            `REFUSING to kill process group pgid=${pgid} for session ${sessionId}: current leader start-time (${currentStartTime}) DIFFERS from the persisted start-time (${persistedLeaderStartTime}), but this row records no pid-namespace/boot anchor, so that mismatch cannot PROVE the original group is gone. PROCESSES MAY SURVIVE UNCOLLECTED. cause=membership-unprovable sessionId=${sessionId} pgid=${pgid}`,
          );
          return { proceed: false, cause: "membership-unprovable" };
        }
        this.#pgidGuardCounters.recycled += 1;
        this.#log(
          `REFUSING to kill process group pgid=${pgid} for session ${sessionId}: current leader start-time (${currentStartTime}) DIFFERS from the persisted start-time (${persistedLeaderStartTime}) — pgid was RECYCLED to an unrelated process since this row was written. PROCESSES MAY SURVIVE UNCOLLECTED. cause=recycled sessionId=${sessionId} pgid=${pgid}`,
        );
        return { proceed: false, cause: "recycled" };
      }
      return { proceed: true, verified: true };
    }
    // Leader absent: fall to the group-carried session token — the net for
    // an ordinary orphan whose leader is simply gone.
    if (persistedGroupToken === undefined) {
      this.#pgidGuardCounters.unverifiedLegacy += 1;
      this.#log(
        `PROCEEDING to kill process group pgid=${pgid} for session ${sessionId} WITHOUT identity proof: the leader is unreadable AND no group-token baseline was ever persisted for this row (legacy) — cannot be checked for membership at all. This kill is UNVERIFIED, not a proven match. cause=unverified-legacy sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: true, verified: false, cause: "unverified-legacy" };
    }
    if (this.#findGroupMemberToken(pgid, persistedGroupToken)) {
      this.#pgidGuardCounters.tokenVerified += 1;
      this.#log(
        `PROCEEDING to kill process group pgid=${pgid} for session ${sessionId}: the leader is unreadable, but a surviving GROUP MEMBER carries the persisted session token — positive proof of membership. cause=token-verified sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: true, verified: true, cause: "token-verified" };
    }
    // Last re-check before a refusal that would contain a whole socket: a
    // group whose every remaining member is a ZOMBIE is already dead. This is
    // the shape a host SIGKILL leaves behind when the guardian's parent-death
    // broadcast lands, the leader is reaped first, and some member's exit
    // status has not been collected yet — the leader is unreadable and a
    // zombie's environ is empty, so neither anchor above could answer.
    if (this.#groupIsOnlyZombies(pgid)) {
      this.#pgidGuardCounters.zombieGroup += 1;
      this.#log(
        `NOT signalling process group pgid=${pgid} for session ${sessionId}: the leader is UNREADABLE and every remaining member of the group is a ZOMBIE — the group is already dead (a zombie executes nothing and cannot be killed again), so this reap is CONFIRMED without emitting any signal. cause=zombie-group sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: false, alreadyDead: true, cause: "zombie-group" };
    }
    // The liveness probe that admitted this group ran BEFORE the frame read,
    // the leader read, the token scan and two full /proc censuses. A group
    // that finished draining across that work is empty NOW — ask the OS once
    // more rather than block a socket on a group it answers ESRCH for. This is
    // the same positive proof the short-circuit above this guard acts on: a
    // live group still answers ALIVE and still falls through to the refusal.
    if (!this.#reaper.isGroupAlive(pgid)) {
      this.#pgidGuardCounters.groupDrained += 1;
      this.#log(
        `NOT signalling process group pgid=${pgid} for session ${sessionId}: the leader is UNREADABLE and no member carried the token, but the group is now confirmed EMPTY by the OS — it finished draining while this reap was identifying it, so the reap is CONFIRMED without emitting any signal. cause=group-drained sessionId=${sessionId} pgid=${pgid}`,
      );
      return { proceed: false, alreadyDead: true, cause: "group-drained" };
    }
    this.#pgidGuardCounters.membershipUnprovable += 1;
    this.#log(
      `REFUSING to kill process group pgid=${pgid} for session ${sessionId}: the group leader is UNREADABLE and no surviving member carries the persisted session token — cannot positively prove this group's identity. PROCESSES MAY SURVIVE UNCOLLECTED. cause=membership-unprovable sessionId=${sessionId} pgid=${pgid}`,
    );
    return { proceed: false, cause: "membership-unprovable" };
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
    verify?: {
      sessionId: string;
      persistedLeaderStartTime: number | undefined;
      persistedGroupToken: string | undefined;
      persistedFrame: NativeTerminalProcFrame;
    },
  ): Promise<
    | { status: "dead"; elapsedMs: number; verified?: boolean }
    | { status: "timed-out"; elapsedMs: number }
    | {
        status: "refused";
        cause:
          | "unsupported-process-groups"
          | "recycled"
          | "stale-boot"
          | "foreign-frame"
          | "membership-unprovable";
      }
  > {
    if (!supportsProcessGroupSignals()) {
      if (verify) {
        // `reapOrphan` is a durable/reconcile path. On a platform without
        // POSIX group signals, neither a group kill nor a group-empty proof
        // exists, so reporting "dead" would be a false containment claim.
        this.#log(
          `REFUSING to reap pgid=${pgid} (${label}): process groups are not supported on ${process.platform}. PROCESSES MAY HAVE SURVIVED — no group kill or proof was issued. cause=unsupported-process-groups sessionId=${verify.sessionId} pgid=${pgid}`,
        );
        return { status: "refused", cause: "unsupported-process-groups" };
      }
      // No POSIX process groups on this platform; nothing more this host can
      // prove. Direct in-memory force-stop retains its existing behavior.
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
        verify.persistedGroupToken,
        verify.sessionId,
        verify.persistedFrame,
      );
      if (!verdict.proceed) {
        if (verdict.alreadyDead) {
          // The group was found reduced to zombies, or confirmed empty by the
          // OS after the checks: dead, with no signal emitted and nothing left
          // to wait for. Reported exactly like the already-empty short-circuit
          // above — no `verified` flag, because this proves the group's STATE,
          // not its identity.
          return { status: "dead", elapsedMs: 0 };
        }
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

  /**
   * Drop a session's durable pgid row, but ONLY on the OS's positive proof
   * that its process group is empty — the same asymmetry every other decision
   * here applies, one step further: a row is the ONLY way a later pass can
   * reach a group that outlived its session leader (the ordinary orphan: a
   * shell that exits normally leaving a backgrounded descendant), so an
   * ambiguous probe must KEEP the row. `isGroupAlive` answers "alive" for
   * EPERM and for anything it cannot decide, which is exactly the fail-safe
   * direction here.
   *
   * Best-effort and never throws: pruning is hygiene, and a registry that
   * cannot be written must not turn a pty exit or a host shutdown into a
   * failure. A row left behind is the pre-existing behaviour, not a new risk.
   */
  #pruneDurableRowIfGroupEmpty(
    record: SessionRecord,
    because: string,
    options: { waitForLock: boolean },
  ): "settled" | "lock-unavailable" {
    try {
      // Rows are keyed by session id alone, so a same-id session created
      // elsewhere owns this key now. Prune only a row that still points at THIS
      // session's group — never someone else's durable record. The cheap read
      // below skips the lock entirely for the common "group still alive" case;
      // the delete itself re-verifies the row UNDER the lock (compare-and-
      // delete), because this read and that delete are not one critical section.
      const row = readNativeTerminalPgid(record.id, this.#registryPath);
      if (row.status !== "resolved" || row.pgid !== record.pty.pgid) return "settled";
      if (this.#reaper.isGroupAlive(record.pty.pgid)) return "settled";
      const outcome = pruneNativeTerminalPgidEntry(
        record.id,
        this.#registryPath,
        { pgid: record.pty.pgid, groupToken: record.groupToken },
        { waitForLock: options.waitForLock },
      );
      if (outcome === "lock-unavailable") return "lock-unavailable";
      if (outcome === "pruned") {
        this.#log(
          `pruned the durable pgid row of terminal session ${record.id} (pgid=${record.pty.pgid}): ${because} and the OS reports the group empty`,
        );
      }
      return "settled";
    } catch (error) {
      this.#log(
        `could not prune the durable pgid row of terminal session ${record.id} (pgid=${record.pty.pgid}): ${String(error)}`,
      );
      return "settled";
    }
  }

  /**
   * Run the pty-exit prune OFF node-pty's synchronous `onExit` callback, and
   * never waiting for the registry lock.
   *
   * Why both: `onExit` runs on this host's event loop, the loop that serves
   * every other session's I/O, and taking the registry lock costs up to
   * LOCK_MAX_WAIT_MS (4 s) of BUSY-WAIT when another process holds it (see
   * file-lock.ts). Paying that inline freezes the whole host for seconds for
   * what is only row hygiene. So each attempt asks for the lock ONCE and, when
   * it is held, retries on a timer for a bounded number of attempts before
   * giving up and leaving the row (a stale row is the pre-existing behaviour,
   * and any later pass re-derives its verdict from the group itself).
   *
   * This opens NO window in which a live tree loses its row: the decision is
   * made entirely at prune time, from a fresh row read, a fresh `isGroupAlive`
   * proof and a compare-and-delete — never from the fact that an exit was once
   * observed.
   */
  #schedulePruneOfExitedSession(
    record: SessionRecord,
    because: string,
    attempt = 1,
  ): void {
    setTimeout(
      () => {
        const outcome = this.#pruneDurableRowIfGroupEmpty(record, because, {
          waitForLock: false,
        });
        if (outcome !== "lock-unavailable") return;
        if (attempt >= NATIVE_TERMINAL_PRUNE_MAX_ATTEMPTS) {
          this.#log(
            `giving up on pruning the durable pgid row of terminal session ${record.id} (pgid=${record.pty.pgid}) after ${attempt} attempts: the registry lock stayed held. The stale row is left for a later pass.`,
          );
          return;
        }
        this.#schedulePruneOfExitedSession(record, because, attempt + 1);
      },
      attempt === 1 ? 0 : NATIVE_TERMINAL_PRUNE_RETRY_DELAY_MS,
    );
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
    record.controllerActivity = null;
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
      lastHumanActivityAt: record.lastHumanActivityAt,
    });
  }
}

/**
 * Per-entry outcome of a `reconcileDeadHostOrphans` pass.
 *
 * `ownerSocketPath`, carried on the three PROVEN-DEAD outcomes, is the durable
 * socket attribution of the row (see `RegistryEntry.ownerHostSocketPath`). It
 * exists so a caller can answer "is this unconfirmed orphan MY socket's
 * containment problem" without guessing; it is absent on a legacy row that was
 * written before the attribution existed.
 *
 * `cause` forwards `reapOrphan`'s own refusal cause, and its ABSENCE is
 * meaningful. A cause-less refusal means only that the pgid could not be
 * resolved — the row was pruned by a concurrent reconcile that DID confirm the
 * reap, or the registry turned unreadable between the snapshot and the lookup.
 * That is an absence of information, not a surviving group, and a caller must
 * not treat the two alike.
 *
 * The causes that DO reach a caller are the two taken with the group observed
 * ALIVE and its identity unprovable — `membership-unprovable` and
 * `unsupported-process-groups` — `foreign-frame`, taken when the pgid number
 * answers ALIVE here but the row was written in a frame (pid namespace, boot,
 * machine) this reader cannot prove is its own, so nothing about the row's
 * own group is decidable — plus `pgid-mismatch`, which is taken BEFORE
 * any liveness probe and only after this pass has re-read the row once (see
 * the revalidation in `reconcileDeadHostOrphans`): it survives that re-read
 * only while the row keeps being rewritten under a proven-dead owner.
 * `recycled` and `stale-boot` never reach a caller as refusals at all — each is
 * positive proof that the original group is GONE, reported as
 * `"pruned-recycled-pgid"` and `"pruned-stale-boot-row"`, never as survivors.
 */
export type NativeTerminalReconcileOutcome = Readonly<
  | { sessionId: string; status: "reaped"; ownerPid: number; ownerSocketPath?: string; pgid: number }
  | { sessionId: string; status: "reap-timed-out"; ownerPid: number; ownerSocketPath?: string; pgid: number }
  /**
   * This entry's evaluation FAILED — the owner probe threw, the reap threw, or
   * the durable store could not be re-read — so nothing was signalled and
   * NOTHING was proven about the group: neither that it survived nor that it is
   * gone. Reported per entry (the rest of the pass continues) and WITH the
   * row's attribution, because a caller whose socket owns this row must fail
   * closed on it: an absence of proof over a row whose owner is not known to be
   * alive is exactly the state in which starting a host would resume terminal
   * work over a group that may still be alive. The row is kept for a later
   * pass, which may then confirm it.
   *
   * `ownerDeathUnproven` marks the subset where the failure happened BEFORE the
   * owner's liveness was established (the owner probe itself threw). The
   * containment is identical — nothing is known about the group either way —
   * but no diagnostic may then call the owner a proven-dead host, because
   * nobody proved that. Absent means the owner WAS proven dead first.
   */
  | {
      sessionId: string;
      status: "reap-failed";
      ownerPid: number;
      ownerSocketPath?: string;
      pgid: number;
      reason: string;
      ownerDeathUnproven?: true;
    }
  | {
      sessionId: string;
      status: "reap-refused";
      ownerPid: number;
      ownerSocketPath?: string;
      pgid: number;
      reason: string;
      cause?: NativeTerminalReapRefusalCause;
    }
  /**
   * The reap refused with cause `recycled`: the pgid NUMBER this row carries
   * is now held by an unrelated live group leader of a different start-time.
   * A pid number stays allocated while ANY task still references it as pid,
   * tgid, PGID or sid, and a process group id is not reused before that
   * group's lifetime ends — so this PROVES every member of the original group
   * is gone. The stale row is pruned and reported here, distinctly from every
   * outcome that carries evidence of a SURVIVING group; nothing was signalled,
   * and the pgid must not be signalled by anyone acting on this outcome.
   */
  | {
      sessionId: string;
      status: "pruned-recycled-pgid";
      ownerPid: number;
      ownerSocketPath?: string;
      pgid: number;
      reason: string;
    }
  /**
   * The reap refused with cause `stale-boot`: the row records a boot id
   * different from this reader's, in this reader's OWN pid namespace, and the
   * same machine id as this reader's. A reboot ends every process of the boot
   * before it, so this PROVES every member of the original group is gone — the
   * strongest form of the `recycled` proof, not an absence of one. The stale row is pruned and reported here,
   * distinctly from every outcome that carries evidence of a SURVIVING group.
   * Nothing was signalled, and the pgid NUMBER must not be signalled by anyone
   * acting on this outcome: an unrelated live group may hold it now. The
   * declared exceptions, out of model, are a process checkpointed before the
   * reboot and restored after it (CRIU), and machines that share one registry
   * AND one duplicated machine id — see `#verifyGroupLeaderIdentity`.
   */
  | {
      sessionId: string;
      status: "pruned-stale-boot-row";
      ownerPid: number;
      ownerSocketPath?: string;
      pgid: number;
      reason: string;
    }
  /**
   * The row was REWRITTEN between this pass's snapshot and the reap's own
   * lookup, and the re-read row no longer describes a proven-dead owner's
   * orphan (it is gone, has lost its owner attribution, or its owner is now
   * alive under a different pgid). Nothing was signalled and nothing is owed:
   * a verdict about a row that no longer exists is not containment.
   */
  | { sessionId: string; status: "skipped-row-changed"; reason: string }
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
 *    via `reap`, then prune the entry once the reap is CONFIRMED (`"reaped"`)
 *    or once the refusal itself PROVED the original group gone
 *    (`cause: "recycled"` -> `"pruned-recycled-pgid"`; `cause: "stale-boot"`
 *    -> `"pruned-stale-boot-row"`). A `"reap-timed-out"`, or a refusal that
 *    leaves the group's fate unknown, keeps the row for a future pass instead
 *    of losing the only durable record of an unconfirmed pgid.
 *
 * Best-effort per entry, and this is a SAFETY property, not politeness: every
 * entry's evaluation (owner probe, reap, row re-read, prune) is wrapped, so one
 * entry's failure never stops the pass over the rest. Each entry is an
 * independent host/session, and the socket-scoped containment decision a caller
 * derives from this pass can only be right if the pass actually reached the row
 * that concerns it — an abort half-way through leaves every later row
 * unevaluated while the caller reads one failure as a cleanup hiccup. A failure
 * is reported as `"reap-failed"` for that entry, WITH its attribution, and its
 * row is kept.
 */
export async function reconcileDeadHostOrphans(options: {
  registryPath?: string;
  signal?: NativeTerminalStopSignal;
  /** Injectable so tests never touch a real /proc; defaults to the real probe. */
  ownerProbe?: NativeTerminalOwnerHostProbe;
  /** Injectable so tests never send real signals; defaults to a throwaway
   * `NativeTerminalHost` (never spawns a pty) calling the real `reapOrphan`.
   * The persisted pgid AND group token form an immutable snapshot: the real
   * reap re-resolves only to verify the row still says both, and refuses
   * without signalling on any mismatch. `expected` is passed only for a row
   * that carries a token, so a legacy row's call shape is unchanged. */
  reap?: (
    sessionId: string,
    pgid: number,
    signal: NativeTerminalStopSignal,
    expected?: { groupToken?: string },
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
      return (
        sessionId: string,
        pgid: number,
        sig: NativeTerminalStopSignal,
        expected?: { groupToken?: string },
      ) => reconcileHost.reapOrphan(sessionId, sig, pgid, expected);
    })();

  const snapshot = listNativeTerminalPgidEntries(options.registryPath);
  if (!snapshot.known) {
    log(
      `REFUSING to reconcile native-terminal orphans: registry unreadable (${snapshot.reason}). NOTHING was reaped.`,
    );
    return { status: "refused", reason: snapshot.reason };
  }

  /**
   * Re-read ONE row from the durable store, for the `pgid-mismatch` path
   * below: the reap resolved a pgid different from this pass's snapshot, so
   * the row was rewritten (a same-id session recreated) in between.
   *
   * THREE-STATE, and the three must never be collapsed. "The store reads fine
   * and holds no such row" is a POSITIVE answer — nothing is owed — while "the
   * store could not be read at all" is an absence of information about a row
   * whose owner is not known to be alive and whose group was never probed.
   * Flattening the second into the first downgrades a blocking verdict to a
   * non-blocking `skipped-row-changed` and lets a caller start a host over a
   * group whose fate was never decided.
   */
  const rereadEntry = (
    sessionId: string,
  ):
    | { known: true; entry: NativeTerminalPgidEntry | undefined }
    | { known: false; reason: string } => {
    const fresh = listNativeTerminalPgidEntries(options.registryPath);
    if (!fresh.known) return { known: false, reason: fresh.reason };
    return {
      known: true,
      entry: fresh.entries.find((candidate) => candidate.sessionId === sessionId),
    };
  };

  /**
   * Drop one row whose group this pass PROVED gone. Never throws: at this point
   * the proof already holds, so a registry that cannot be written must not turn
   * a confirmed containment into a failure — it leaves a stale row a later pass
   * re-derives the same verdict from, which is the pre-existing behaviour, not a
   * surviving group. Compare-and-delete (see `pruneNativeTerminalPgidEntry`): a
   * row rewritten for the same session id by a LIVE host is never deleted.
   */
  const pruneProvenGoneRow = (entry: {
    sessionId: string;
    pgid: number;
    groupToken?: string;
  }): void => {
    const { sessionId } = entry;
    try {
      const outcome = pruneNativeTerminalPgidEntry(
        sessionId,
        options.registryPath,
        {
          pgid: entry.pgid,
          ...(entry.groupToken !== undefined ? { groupToken: entry.groupToken } : {}),
        },
      );
      if (outcome === "kept") {
        log(
          `native-terminal session ${sessionId}: nothing was pruned — the durable row is either already gone (a concurrent pass pruned it) or no longer describes the group this pass proved gone (pgid=${entry.pgid}), i.e. a live host owns that session id now. Either way it is not ours to delete.`,
        );
      }
    } catch (error) {
      log(
        `native-terminal session ${sessionId}: could not prune the durable row of a group this pass PROVED gone (${String(error)}) — the containment verdict stands; the stale row is left for a later pass.`,
      );
    }
  };

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
    // From here on, EVERY failure is contained to THIS entry: each entry is an
    // independent host/session, and a pass that aborts half-way never evaluates
    // the rows it had not reached — including the one that would have contained
    // the caller's own socket. A caller reading such a failure as a cleanup
    // hiccup then starts a host over a PTY group whose fate was never decided.
    const attribution = {
      ownerPid: owner.pid,
      ...(owner.socketPath !== undefined ? { ownerSocketPath: owner.socketPath } : {}),
      pgid: entry.pgid,
    };
    // Whether THIS entry's owner was positively proven dead before anything
    // else was attempted. A failure below is contained either way, but a
    // diagnostic must not assert a death the probe never returned (see
    // `ownerDeathUnproven`).
    let ownerProvenDead = false;
    try {
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
      ownerProvenDead = true;
      log(
        `native-terminal session ${entry.sessionId}: owning host pid=${owner.pid} is PROVEN DEAD — reaping its orphan process group pgid=${entry.pgid}.`,
      );
      // A row that carries a token constrains the reap on pgid AND token; a
      // legacy row carries none and is called exactly as before.
      const outcome =
        entry.groupToken === undefined
          ? await reap(entry.sessionId, entry.pgid, signal)
          : await reap(entry.sessionId, entry.pgid, signal, {
              groupToken: entry.groupToken,
            });
      if (outcome.status === "refused" && outcome.cause === "pgid-mismatch") {
        // The row was REWRITTEN between this pass's snapshot and the reap's own
        // lookup, so `reapOrphan` refused BEFORE probing any group — the one
        // refusal cause that never observed liveness at all. Blocking a caller
        // on it would be a verdict derived from a row that no longer exists, so
        // re-read the row once and decide from what it says NOW.
        //
        // RE-READ, NEVER RE-TARGET: the re-read is used only to decide whether
        // anything is still owed, never as the pgid to act on. Killing the group
        // a rewritten row now points at is exactly the TOCTOU the immutable
        // snapshot exists to prevent (`reapOrphan`'s `expectedPgid`), and the
        // functional regression "should refuse reconciliation when the fresh
        // PGID lookup differs from its immutable snapshot" holds that line. A
        // row that still names a proven-dead owner therefore keeps the caused
        // refusal — fail closed — and the NEXT pass snapshots the new pgid and
        // reaps it properly.
        const reread = rereadEntry(entry.sessionId);
        if (!reread.known) {
          // NOT "the row is gone": the store answered nothing at all, about a
          // row whose owner is proven dead and whose group was never probed.
          // Fail closed on this entry's own attribution, like every other
          // per-entry failure.
          throw new Error(
            `the durable store could not be re-read after a pgid-mismatch refusal (${reread.reason})`,
          );
        }
        const fresh = reread.entry;
        if (fresh?.owner === undefined) {
          const reason = fresh === undefined
            ? "the row is gone"
            : "the row lost its owning-host attribution";
          log(
            `native-terminal session ${entry.sessionId}: the durable row changed under this pass (${reason}) — nothing was signalled, reaping nothing.`,
          );
          outcomes.push({
            sessionId: entry.sessionId,
            status: "skipped-row-changed",
            reason,
          });
          continue;
        }
        const freshVerdict = ownerProbe(fresh.owner);
        if (freshVerdict !== "dead") {
          log(
            `native-terminal session ${entry.sessionId}: the durable row was rewritten under this pass and now names owning host pid=${fresh.owner.pid}, whose liveness is "${freshVerdict}" — reaping nothing.`,
          );
          outcomes.push({
            sessionId: entry.sessionId,
            status: freshVerdict === "alive" ? "skipped-alive" : "skipped-unresolvable",
            ownerPid: fresh.owner.pid,
          });
          continue;
        }
        log(
          `native-terminal session ${entry.sessionId}: the durable row was rewritten under this pass (snapshot pgid=${entry.pgid}, now pgid=${fresh.pgid}) and still names a PROVEN DEAD owner pid=${fresh.owner.pid} — keeping the refusal; NOTHING was signalled, and the next pass will act on the row it snapshots itself.`,
        );
      }
      if (outcome.status === "refused" && outcome.cause === "recycled") {
        // POSITIVE proof that the original group is GONE, not that one
        // survived: the pgid number is held by an unrelated live leader of a
        // different start-time, which the kernel could not have issued while any
        // member of the original group still referenced that number. Prune the
        // stale row — leaving it would re-derive this same verdict on every
        // later pass — and never point an operator at that pgid.
        pruneProvenGoneRow(entry);
        log(
          `native-terminal session ${entry.sessionId}: pgid=${entry.pgid} is now held by an UNRELATED live process group leader, which PROVES the original process group of this session is gone — pruning the stale durable row. NOTHING was signalled; pgid=${entry.pgid} must NOT be killed, it does not belong to this session.`,
        );
        outcomes.push({
          sessionId: entry.sessionId,
          status: "pruned-recycled-pgid",
          ...attribution,
          reason: outcome.reason,
        });
      } else if (outcome.status === "refused" && outcome.cause === "stale-boot") {
        // POSITIVE proof that the original group is GONE, exactly like
        // `recycled` and for a stronger reason: the row was written before this
        // boot, in this reader's own pid namespace on this same machine (the
        // machine id is what rules out another machine sharing this registry
        // — see `#verifyGroupLeaderIdentity`), and a reboot ends every
        // process of the boot before it. Prune the stale row — leaving it would
        // re-derive this same verdict on every later pass, holding the socket
        // until whatever unrelated process inherited the pgid NUMBER exits —
        // and never point an operator at that number.
        pruneProvenGoneRow(entry);
        log(
          `native-terminal session ${entry.sessionId}: this durable row was written under a PREVIOUS boot, which ENDED every process it describes — pruning the stale durable row. NOTHING was signalled; pgid=${entry.pgid} must NOT be killed, a live unrelated group may hold that number now.`,
        );
        outcomes.push({
          sessionId: entry.sessionId,
          status: "pruned-stale-boot-row",
          ...attribution,
          reason: outcome.reason,
        });
      } else if (outcome.status === "reaped") {
        pruneProvenGoneRow(entry);
        outcomes.push({
          sessionId: entry.sessionId,
          status: "reaped",
          ...attribution,
        });
      } else if (outcome.status === "reap-timed-out") {
        log(
          `native-terminal session ${entry.sessionId}: reap did not confirm dead within the timeout — leaving the record for a future pass.`,
        );
        outcomes.push({
          sessionId: entry.sessionId,
          status: "reap-timed-out",
          ...attribution,
        });
      } else {
        log(`native-terminal session ${entry.sessionId}: reap refused (${outcome.reason}).`);
        outcomes.push({
          sessionId: entry.sessionId,
          status: "reap-refused",
          ...attribution,
          reason: outcome.reason,
          ...(outcome.cause !== undefined ? { cause: outcome.cause } : {}),
        });
      }
    } catch (error) {
      // Nothing was PROVEN about this row's group: the probe, the reap or the
      // re-read failed. The durable row is kept, nothing was signalled, and the
      // failure is reported WITH this row's attribution so a socket-scoped
      // caller can fail closed on exactly the socket it belongs to. When the
      // OWNER PROBE is what failed, the owner's own liveness is unknown too —
      // the containment is the same, but it is flagged so no diagnostic calls
      // that owner proven dead.
      log(
        `native-terminal session ${entry.sessionId}: reap FAILED before proving anything about pgid=${entry.pgid} (${String(error)})${ownerProvenDead ? "" : " — the OWNING HOST's own liveness was never proven either"} — NOTHING was signalled or confirmed, and the durable row is kept for a later pass.`,
      );
      outcomes.push({
        sessionId: entry.sessionId,
        status: "reap-failed",
        ...attribution,
        reason: String(error),
        ...(ownerProvenDead ? {} : { ownerDeathUnproven: true as const }),
      });
    }
  }
  return { status: "completed", outcomes };
}
