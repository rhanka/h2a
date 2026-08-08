/**
 * Live-session registry — the source of truth for `remote ls` / `remote
 * restore`, so they stop GUESSING sessions from filesystem mtimes.
 *
 * Entries land here from:
 *  - `remote run`        (source "run"  — local tmux sessions),
 *  - Claude Code hooks   (source "hook" — `remote enroll --hook claude-*`),
 *  - the restore scanner (source "scan" — legacy fallback),
 *  - the control-plane   (source "remote" — reconciled by the caller).
 *
 * The file is `<configDir>/registry.json`, written atomically (tmp + rename).
 * Every function takes an optional explicit path so tests never touch the real
 * config dir (default path honors REMOTE_CLI_CONFIG_HOME like config.ts).
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { uptime } from "node:os";
import { dirname, join } from "node:path";

import { getLayoutConfig, resolveConfigPath } from "./config.js";
import { acquireFileLock, releaseFileLock } from "./file-lock.js";
import {
  managedSessionCandidates,
  parseManagedSessionName,
  listLocalSessions,
  type LocalSession,
} from "./tmux.js";
import type { SessionClass } from "./session-class.js";
import { nativeSessionAlive } from "./native-host.js";

export type RegistryTool = "claude" | "codex" | "agy";
export type RegistryKind = "local-tmux" | "local-native" | "local" | "remote";

/** Managed local interactive session hosted by tmux OR the native PTY host. */
export function isManagedLocalKind(kind: RegistryKind): kind is "local-tmux" | "local-native" {
  return kind === "local-tmux" || kind === "local-native";
}
export type RegistrySource = "run" | "hook" | "scan" | "remote";

/**
 * Delegated-job extension (P1 of cross-type agent delegation). A job IS a
 * RegistryEntry with `role: "job"` — same atomic-write, same liveness guards,
 * same `listLive`. These fields are OPTIONAL so every existing entry stays a
 * valid RegistryEntry (back-compat).
 */
export type RegistryRole = "job";
export type JobState = "pending" | "running" | "throttled" | "done" | "failed";
/**
 * Durable restore eligibility. Every newly-enrolled entry MUST carry one:
 * restore accepts only `human`; `background` is retained but never eligible.
 * Legacy rows may lack it and deliberately fail closed at restore time.
 */
export type RegistrySessionClass = SessionClass;
/** Provenance admitted to the owner-scoped status projection. */
export type DelegationOrigin = "mcp:h2a_run" | "cli:h2a-delegate";

/**
 * Rate-limit ("throttled") bookkeeping for a HEADLESS LOCAL job whose agent CLI
 * hit a TRANSIENT provider rate-limit (reliability slice 1). A throttled job
 * KEEPS its concurrency slot (the limit is account-wide; admitting a replacement
 * just burns the same quota) and is auto-resumed by the conductor on
 * `nextRetryAt` with exponential backoff, up to a hard attempt cap. All fields
 * are written under `withRegistryLock`; the whole object is optional so every
 * existing entry stays a valid RegistryEntry (back-compat).
 */
export type ThrottleInfo = {
  /** How many times this job has entered `throttled` (drives the backoff). */
  attempts: number;
  /** ISO ts of the FIRST throttle (for age / history windows). */
  firstAt: string;
  /** ISO ts the conductor may resume the job at (now + jitteredDelay(attempts)). */
  nextRetryAt: string;
  /** The signature tag that classified the last throttle (e.g. claude:rate-limited). */
  lastSignature?: string;
};

export type RegistryEntry = {
  /** Stable key: claude session uuid / codex rollout id / remoteId / tmux slug. */
  id: string;
  tool: RegistryTool;
  kind: RegistryKind;
  cwd: string;
  label?: string;
  /** Conversation id usable with the CLI's --resume. */
  convId?: string;
  /** Control-plane session id (kind "remote"). */
  remoteId?: string;
  /** Full tmux session name (kind "local-tmux"), e.g. `h2a-surch`. */
  tmuxSession?: string;
  /** Local process id (kind "local"); liveness = process.kill(pid, 0). */
  pid?: number;
  /**
   * Process-group id of a native-terminal PTY session (see
   * native-terminal/host.ts's `persistNativeTerminalPgid`). Persisted at
   * session CREATION time so a host that never knew the session (e.g. a fresh
   * host started after the owning host was killed) can still reap the whole
   * process tree from this durable record — "known at creation" must survive
   * to "known at kill time", which only a durable store (not host memory)
   * can guarantee.
   */
  pgid?: number;
  /**
   * Owning host attribution for a native-terminal-pty row (see `pgid` above).
   * `ownerHostPid` is the pid of the host process that created this PTY and
   * durably persisted its pgid; `ownerHostStartTime` is that host's own
   * process start-time (Linux `/proc/<pid>/stat` field 22, clock ticks since
   * boot) at the moment of persistence — the discriminant that survives pid
   * recycling. A reaper must prove the HOST is dead (pid gone, or a live pid
   * whose start-time no longer matches — i.e. reused) before touching this
   * row's pgid; a merely-unreachable-but-alive host (e.g. overloaded, a
   * paused process) is NOT proof of death and must never be reaped. See
   * `reconcileDeadHostOrphans` in native-terminal/host.ts, the sole consumer.
   */
  ownerHostPid?: number;
  ownerHostStartTime?: number;
  enrolledAt: string;
  lastSeenAt: string;
  endedAt?: string;
  source: RegistrySource;
  /** Required on every new enrollment; absent only on legacy rows (fail closed). */
  sessionClass?: RegistrySessionClass;
  /**
   * Durable delegation provenance.  A background session alone is deliberately
   * not treated as delegated work: it must say which trusted launch surface
   * created it and which owner session requested it.
   */
  delegationOrigin?: DelegationOrigin;
  /** Exact h2a identity of the delegating MCP sidecar or delegate callback. */
  delegatorInstance?: string;
  /** Exact tmux session that hosted the delegator when the launch was made. */
  delegatorTmuxSession?: string;
  /** "job" marks a delegated agent (see `delegate.ts`); absent = a session. */
  role?: RegistryRole;
  /** Lifecycle of a delegated job (role "job" only). */
  jobState?: JobState;
  /** Parent job/session id that delegated this job. */
  parent?: string;
  /** The task the delegated agent was primed with. */
  task?: string;
  /** h2a instance to address the `job.done` callback to (P3); the delegating
   * parent/master. Absent = no callback recipient (best-effort, no-op). */
  callbackTo?: string;
  /**
   * P4 — queued-launch spec. A job over the concurrency cap is enrolled
   * `pending` WITHOUT being launched; the conductor launches it later. These
   * fields carry everything `startJob` needs to launch it from the queue (they
   * are also set on an immediately-launched job, harmlessly). All optional so
   * every existing entry stays a valid RegistryEntry (back-compat).
   */
  /** Run the job in a Pod (the remote control-plane URL), else a local tmux session. */
  remoteTarget?: string;
  /** Run-once-exit headless mode (claude -p / codex exec). */
  headless?: boolean;
  /** The cwd the delegate was invoked from (origin for the per-job worktree/logs). */
  originCwd?: string;
  /** Explicit `--cwd` override (local; used as-is, no worktree). */
  explicitCwd?: string;
  /** Remaining spawn-depth budget this job may spend if it re-delegates (P4 depth clamp). */
  depthBudget?: number;
  /** Track workpackage id to mirror this job under (`track item new --parent`). */
  trackWp?: string;
  /** Rate-limit backoff/resume bookkeeping (HEADLESS LOCAL only; reliability slice 1). */
  throttle?: ThrottleInfo;
  /** Model override passed to the CLI binary (--model for claude, -m for codex). */
  model?: string;
  /** Effort/reasoning override (claude --effort; codex model_reasoning_effort). */
  effort?: string;
  /** Force a specific account from the pool (bypass selectAccountWithFallback). */
  accountId?: string;
  /**
   * Pinned llm-mesh gateway choice, captured at launch from an EXPLICIT
   * --gw/--no-gw. Re-emitted verbatim by `remote restore` so each instance
   * keeps its own gateway posture instead of falling back to the global
   * default. Absent = launched in "auto" mode (follows the default).
   */
  gatewayMode?: "gateway" | "direct";
  /**
   * Durable restore pin: local-tmux/run/human rows with UUID convId and no
   * endedAt are retained by prune across long offline windows.
   */
  restorePinned?: boolean;
};

export type EnrollInput = {
  id: string;
  tool: RegistryTool;
  kind: RegistryKind;
  cwd: string;
  source: RegistrySource;
  /** Required so every new durable record is restore-classified at creation. */
  sessionClass: RegistrySessionClass;
  delegationOrigin?: DelegationOrigin;
  delegatorInstance?: string;
  delegatorTmuxSession?: string;
  label?: string;
  convId?: string;
  remoteId?: string;
  tmuxSession?: string;
  pid?: number;
  role?: RegistryRole;
  jobState?: JobState;
  parent?: string;
  task?: string;
  callbackTo?: string;
  remoteTarget?: string;
  headless?: boolean;
  originCwd?: string;
  explicitCwd?: string;
  depthBudget?: number;
  trackWp?: string;
  throttle?: ThrottleInfo;
  model?: string;
  effort?: string;
  accountId?: string;
  gatewayMode?: "gateway" | "direct";
  /** Explicit override for restore pinning (internal only). */
  restorePinned?: boolean;
};

/** Injectable liveness probes (tests stay deterministic, no tmux/pid needed). */
export type LivenessOpts = {
  tmuxHasSession?: (name: string) => boolean;
  /** Injectable native-PTY-host session probe (kind:"local-native"). */
  nativeSessionAlive?: (name: string) => boolean;
  pidAlive?: (pid: number) => boolean;
  /** System boot time (ms epoch). A `kind:"local"` entry last seen before this
   * is dead — its process died in the reboot, so its PID must not be trusted
   * (PID reuse would falsely resurrect it). Injectable for tests. */
  bootTimeMs?: number;
  /** cmdline of a pid (to detect PID reuse after a crash). Injectable for tests. */
  processCmdline?: (pid: number) => string | undefined;
};

/** System boot time in ms epoch (now minus uptime). */
function defaultBootTimeMs(): number {
  return Date.now() - uptime() * 1000;
}

type RegistryOpts = LivenessOpts & { path?: string };

export function resolveRegistryPath(): string {
  return join(dirname(resolveConfigPath()), "registry.json");
}

/**
 * Canonical shape of a real agent CONVERSATION id (claude session uuid / codex
 * rollout uuid). A `source:"run"` local-tmux entry that never learned the real
 * conversation writes its LABEL as `convId` (e.g. `convId:"llm-mesh"`), which is
 * NOT resumable (`claude --resume llm-mesh` fails). This predicate is how
 * `restore` tells a real, resumable conversation id apart from a label/slug that
 * only masquerades as one. Pure, exported for the reconciliation logic + tests.
 */
const CONVERSATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeConversationUuid(value: string | undefined): boolean {
  return value !== undefined && CONVERSATION_UUID_RE.test(value);
}

function isRestorePinnedCandidate(entry: RegistryEntry): boolean {
  return (
    entry.kind === "local-tmux" &&
    entry.source === "run" &&
    entry.sessionClass === "human" &&
    !entry.endedAt &&
    looksLikeConversationUuid(entry.convId)
  );
}

function shouldPreserveByRestorePin(entry: RegistryEntry): boolean {
  if (entry.restorePinned === false) return false;
  if (isRestorePinnedCandidate(entry)) return true;
  // Invariant: restore pin never preserves positively non-human rows (no implicit pin by absence).
  // As of 2026-08-08 this affects 0 lines — the 29 role=job rows with absent sessionClass are all kind=remote, already outside the perimeter by the kind/source gates; role==='job' is added by SYMMETRY with sessionClass==='background' so a positively non-human row is never pinned even when classless.
  if (entry.endedAt || entry.sessionClass === "background" || entry.role === "job") return false;
  return (
    entry.kind === "local-tmux" &&
    entry.source === "run" &&
    // Invariant: "unknown protects" inside the local-tmux/run restore-pin perimeter.
    // Restore-pin covers durable human local-tmux/run rows, while remote sessions
    // are deliberately out of the restore-pin perimeter.
    // As of 2026-08-08, the architect measured 29 sessionClass-absent lines; all were kind=remote, so this guard currently has no observed effect.
    (entry.sessionClass === "human" || entry.sessionClass === undefined)
  );
}

export function loadRegistry(
  path: string = resolveRegistryPath(),
): RegistryEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const entries = (parsed as { entries?: unknown })?.entries;
    if (!Array.isArray(entries)) return [];
    return entries.filter(isRegistryEntry);
  } catch {
    // missing or corrupt file -> empty registry (it is rebuilt by enrolment)
    return [];
  }
}

/**
 * Read the registry without collapsing a missing/corrupt file into an empty
 * collection.  Operational commands may rebuild their registry; the status
 * bar must instead render UNKNOWN rather than claim a truthful zero.
 */
export function loadRegistryWithDiagnostics(
  path: string = resolveRegistryPath(),
): { entries: RegistryEntry[]; known: boolean; reason?: string } {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const entries = (parsed as { entries?: unknown })?.entries;
    if (!Array.isArray(entries)) {
      return { entries: [], known: false, reason: "registry has no entries array" };
    }
    if (entries.some((entry) => !isRegistryEntry(entry))) {
      return { entries: [], known: false, reason: "registry contains an invalid entry" };
    }
    return { entries, known: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      entries: [],
      known: false,
      reason: code === "ENOENT" ? "registry is absent" : "registry is unreadable or malformed",
    };
  }
}

// ---------------------------------------------------------------------------
// Native-terminal PTY pgid persistence.
//
// Durable session identity (incl. pgid) lives in the single registry store BY
// DESIGN — h2a keeps ONE durable local store (the owner's SQLite direction);
// a separate native-terminal store would be exactly the heterogeneity being
// eliminated. This is NOT a layer leak from native-terminal/host.ts into the
// registry; do not remove this coupling. The pgid is stored on a real
// `RegistryEntry` row (same file, same lock, same atomic write as every other
// registry mutation) keyed by a namespaced id so it can never collide with a
// real claude/codex/agy session row. `tool`/`source`/`cwd` on that row are
// syntactically-required placeholders (RegistryTool/RegistrySource are closed
// enums built around CLI sessions, not arbitrary PTY commands) — the only
// consumer of this row is `readNativeTerminalPgid` below, which reads `.pgid`
// and ignores the rest. `kind: "local"` keeps the row OUT of `remote ls`
// (`localLsRows` only surfaces `kind: "local-tmux"`) and out of delegate's
// concurrency accounting (`role` is left unset, so `tryClaimSlot`/`listJobs`
// never see it).
// ---------------------------------------------------------------------------

const NATIVE_TERMINAL_PGID_ENTRY_ID_PREFIX = "native-terminal-pty:";

function nativeTerminalPgidEntryId(sessionId: string): string {
  return `${NATIVE_TERMINAL_PGID_ENTRY_ID_PREFIX}${sessionId}`;
}

/**
 * Persist a native-terminal PTY session's process-group id, durably, at
 * session CREATION time (see native-terminal/host.ts `create()`). Synchronous
 * (the registry write is sync) so a caller can treat a thrown error as "this
 * session's pgid did NOT get durably recorded" and refuse to create an
 * untracked, unreapable session.
 */
/** Owning-host attribution captured at PTY-creation time (see `RegistryEntry.ownerHostPid`). */
export type NativeTerminalPgidOwner = { pid: number; startTime?: number };

export function persistNativeTerminalPgid(
  sessionId: string,
  pgid: number,
  path: string = resolveRegistryPath(),
  owner?: NativeTerminalPgidOwner,
): void {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) {
    throw new RangeError("pgid must be a positive safe integer");
  }
  const id = nativeTerminalPgidEntryId(sessionId);
  withRegistryLock(path, (entries) => {
    const now = new Date().toISOString();
    const idx = entries.findIndex((e) => e.id === id);
    const entry: RegistryEntry = {
      id,
      tool: "claude",
      kind: "local",
      cwd: "",
      source: "scan",
      enrolledAt: idx >= 0 ? entries[idx]!.enrolledAt : now,
      lastSeenAt: now,
      pgid,
      ...(owner !== undefined ? { ownerHostPid: owner.pid } : {}),
      ...(owner?.startTime !== undefined ? { ownerHostStartTime: owner.startTime } : {}),
    };
    const next =
      idx >= 0
        ? entries.map((e, i) => (i === idx ? entry : e))
        : [...entries, entry];
    return { entries: next, result: undefined };
  });
}

/** Result of resolving a native-terminal session's durable pgid. */
export type NativeTerminalPgidLookup =
  | { status: "resolved"; pgid: number }
  | { status: "unresolved"; reason: string };

/**
 * Resolve a native-terminal PTY session's durable pgid, for a reap that may
 * come from a host that never knew the session (e.g. a fresh host started
 * after the owning host was killed).
 *
 * Reads via `loadRegistryWithDiagnostics`, NEVER via the plain `loadRegistry`
 * array reader: `loadRegistry` silently flattens a corrupt/unreadable
 * registry to `[]`, which would conflate two very different situations —
 * "this session genuinely has no recorded pgid" vs. "the registry could not
 * be read at all". A reaper must tell those apart: an unreadable registry
 * must NEVER be treated as "nothing to reap" (that recreates the exact
 * invisible-orphan bug this mechanism exists to close), so it is reported as
 * `unresolved` with a diagnostic reason, loudly, by the caller (see
 * `NativeTerminalHost#reapOrphan`), which must never guess a pgid or kill
 * silently on either branch below.
 *
 * (If/when a future 3-state `loadRegistry` lands — `state: "ok" | "unknown"`
 * — the migration is a refinement of the condition below, not a new branch:
 * map `state: "unknown"` to the same `unresolved` result.)
 */
export function readNativeTerminalPgid(
  sessionId: string,
  path: string = resolveRegistryPath(),
): NativeTerminalPgidLookup {
  const diagnostics = loadRegistryWithDiagnostics(path);
  if (!diagnostics.known) {
    return {
      status: "unresolved",
      reason: `registry unreadable: ${diagnostics.reason ?? "unknown reason"}`,
    };
  }
  const id = nativeTerminalPgidEntryId(sessionId);
  const entry = diagnostics.entries.find((e) => e.id === id);
  if (!entry || typeof entry.pgid !== "number") {
    return {
      status: "unresolved",
      reason: `no pgid recorded for terminal session ${sessionId}`,
    };
  }
  return { status: "resolved", pgid: entry.pgid };
}

/** One native-terminal-pty row, decoded from its namespaced registry id. */
export type NativeTerminalPgidEntry = Readonly<{
  sessionId: string;
  pgid: number;
  owner?: NativeTerminalPgidOwner;
}>;

/** Outcome of enumerating every native-terminal-pty row in the registry. */
export type NativeTerminalPgidSnapshot =
  | { known: true; entries: ReadonlyArray<NativeTerminalPgidEntry> }
  | { known: false; reason: string };

/**
 * Enumerate every durably-persisted native-terminal PTY session, for a
 * reconcile pass that must decide, PER ENTRY, whether its owning host is
 * proven dead (see `reconcileDeadHostOrphans` in native-terminal/host.ts, the
 * sole consumer). Reads via `loadRegistryWithDiagnostics` for the same reason
 * `readNativeTerminalPgid` does: an unreadable registry must never collapse
 * to "zero entries" — that would silently make a reconcile pass reap
 * (or skip) NOTHING while believing it saw the whole truth.
 */
export function listNativeTerminalPgidEntries(
  path: string = resolveRegistryPath(),
): NativeTerminalPgidSnapshot {
  const diagnostics = loadRegistryWithDiagnostics(path);
  if (!diagnostics.known) {
    return { known: false, reason: diagnostics.reason ?? "unknown reason" };
  }
  const entries: NativeTerminalPgidEntry[] = [];
  for (const e of diagnostics.entries) {
    if (!e.id.startsWith(NATIVE_TERMINAL_PGID_ENTRY_ID_PREFIX)) continue;
    if (typeof e.pgid !== "number") continue;
    const sessionId = e.id.slice(NATIVE_TERMINAL_PGID_ENTRY_ID_PREFIX.length);
    const entry: { sessionId: string; pgid: number; owner?: NativeTerminalPgidOwner } = {
      sessionId,
      pgid: e.pgid,
    };
    if (typeof e.ownerHostPid === "number") {
      const owner: NativeTerminalPgidOwner = { pid: e.ownerHostPid };
      if (typeof e.ownerHostStartTime === "number") owner.startTime = e.ownerHostStartTime;
      entry.owner = owner;
    }
    entries.push(entry);
  }
  return { known: true, entries };
}

/**
 * Remove a single native-terminal-pty row once its orphan group has been
 * reaped (or it is otherwise confirmed handled). Returns false when the id
 * was not present (already pruned, or never existed) — a no-op, not an
 * error, since a reconcile pass may race a concurrent prune of the same row.
 */
export function pruneNativeTerminalPgidEntry(
  sessionId: string,
  path: string = resolveRegistryPath(),
): boolean {
  const id = nativeTerminalPgidEntryId(sessionId);
  return withRegistryLock(path, (entries) => {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return { entries, result: false, save: false };
    const next = entries.slice(0, idx).concat(entries.slice(idx + 1));
    return { entries: next, result: true };
  });
}

function isRegistryEntry(raw: unknown): raw is RegistryEntry {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    (e.tool === "claude" || e.tool === "codex" || e.tool === "agy") &&
    (e.kind === "local-tmux" || e.kind === "local-native" || e.kind === "local" || e.kind === "remote") &&
    typeof e.cwd === "string" &&
    typeof e.enrolledAt === "string" &&
    typeof e.lastSeenAt === "string" &&
    (e.source === "run" ||
      e.source === "hook" ||
      e.source === "scan" ||
      e.source === "remote") &&
    (e.sessionClass === undefined ||
      e.sessionClass === "human" ||
      e.sessionClass === "background") &&
    (e.role === undefined || e.role === "job") &&
    // A job marked human is an invalid/tampered record, never a restoreable
    // exception. Historical jobs without a class remain readable but fail closed.
    !(e.role === "job" && e.sessionClass === "human") &&
    (e.delegationOrigin === undefined ||
      e.delegationOrigin === "mcp:h2a_run" ||
      e.delegationOrigin === "cli:h2a-delegate") &&
    (e.pid === undefined || (typeof e.pid === "number" && Number.isInteger(e.pid) && e.pid > 0)) &&
    (e.pgid === undefined || (typeof e.pgid === "number" && Number.isInteger(e.pgid) && e.pgid > 0)) &&
    (e.ownerHostPid === undefined ||
      (typeof e.ownerHostPid === "number" && Number.isInteger(e.ownerHostPid) && e.ownerHostPid > 0)) &&
    (e.ownerHostStartTime === undefined ||
      (typeof e.ownerHostStartTime === "number" &&
        Number.isInteger(e.ownerHostStartTime) &&
        e.ownerHostStartTime >= 0)) &&
    (e.delegatorInstance === undefined || typeof e.delegatorInstance === "string") &&
    (e.delegatorTmuxSession === undefined || typeof e.delegatorTmuxSession === "string") &&
    (e.restorePinned === undefined || typeof e.restorePinned === "boolean")
  );
}

/** Atomic write: tmp file in the same dir, then rename. */
function saveRegistry(entries: RegistryEntry[], path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), "utf8");
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Cross-process lock for load-modify-save mutations (S2/S3 fix).
//
// The registry is read-modified-written by CONCURRENT processes — `delegate`,
// the conductor, and the claude SessionEnd hook can all mutate it at once.
// Without a lock, two writers each load the same snapshot, modify a disjoint
// entry, and the last `saveRegistry` wins → the other's enroll/advance is LOST.
// The same race makes the concurrency cap leaky: `delegate` checks
// `hasFreeSlot` then enrolls-as-running in two steps, so N delegations racing
// can all see a free slot and overshoot the cap.
//
// The registry is LOCAL ONLY (the CLI writes it; pods never touch it — they have
// no access to ~/.config/.../registry.json), so a LOCAL file lock is sufficient
// — there is no cross-host writer to coordinate with. The primitive itself lives
// in `file-lock.ts` (shared with the session-lease side-store); its bounded,
// best-effort contract is documented there.
// ---------------------------------------------------------------------------

/**
 * Run `fn` under the registry lock: load the current entries, let `fn` mutate
 * them (and compute a return value), then persist atomically — all inside ONE
 * critical section, so concurrent processes serialize and no enroll/advance is
 * lost. `fn` returns `{ entries, result, save? }`: `entries` is what to save
 * (return the same array you mutated), `result` is passed back to the caller, and
 * `save:false` skips the write entirely (a read-only no-op must not rewrite — nor
 * create — the file). If the lock can't be taken (a crashed holder, contention
 * storm), we proceed WITHOUT it rather than block a hook — best-effort,
 * last-writer-wins as before. Exported for tests.
 */
export function withRegistryLock<T>(
  path: string,
  fn: (entries: RegistryEntry[]) => {
    entries: RegistryEntry[];
    result: T;
    save?: boolean;
  },
): T {
  const fd = acquireFileLock(path);
  try {
    const { entries, result, save } = fn(loadRegistry(path));
    if (save !== false) saveRegistry(entries, path);
    return result;
  } finally {
    if (fd !== undefined) releaseFileLock(fd, path);
  }
}

/**
 * Upsert by id. A re-enroll refreshes lastSeenAt, merges the new fields over
 * the stored ones, and REVIVES an ended entry (endedAt is dropped) — e.g. a
 * claude SessionStart on a resumed conversation.
 */
export function enroll(
  input: EnrollInput,
  path: string = resolveRegistryPath(),
): RegistryEntry {
  return withRegistryLock(path, (entries) => {
    const entry = applyEnroll(entries, input);
    return { entries, result: entry };
  });
}

/**
 * Persist the REAL conversation id back onto run entries whose `convId` had been
 * a stale label (the run↔hook reconciliation resolved it). `updates` maps an
 * entry id → the resolved conversation id. Only entries that still differ are
 * rewritten, so this is idempotent and a no-op once every session is resolved.
 * Nothing else on the entry is touched (no lastSeenAt bump — this is not
 * liveness activity, just a metadata correction). Returns the number rewritten.
 * Best-effort persistence so `restore` emits durable state instead of
 * re-deriving the mapping (an fs scan of the transcripts) on every run.
 */
export function persistReconciledConvIds(
  updates: ReadonlyMap<string, string>,
  path: string = resolveRegistryPath(),
): number {
  if (updates.size === 0) return 0;
  return withRegistryLock(path, (entries) => {
    let changed = 0;
    for (const [id, convId] of updates) {
      const entry = entries.find((e) => e.id === id);
      if (!entry || entry.convId === convId) continue;
      entry.convId = convId;
      changed += 1;
    }
    return changed === 0
      ? { entries, result: 0, save: false }
      : { entries, result: changed };
  });
}

/**
 * Reject an ambiguous row at the one mutation boundary shared by `enroll` and
 * `tryClaimSlot`; JavaScript callers cannot bypass the TypeScript requirement.
 */
function assertEnrollmentClass(input: EnrollInput): void {
  if (input.sessionClass !== "human" && input.sessionClass !== "background") {
    throw new Error("registry enrollment requires sessionClass: human or background");
  }
  if (input.role === "job" && input.sessionClass !== "background") {
    throw new Error("registry job enrollment requires sessionClass: background");
  }
}

/**
 * Upsert `input` into `entries` IN PLACE and return the resulting entry. Pure
 * over the array (no fs); shared by `enroll` (under the lock) and the atomic
 * check-cap-and-enroll helper. The lock is held by the caller.
 */
function applyEnroll(
  entries: RegistryEntry[],
  input: EnrollInput,
): RegistryEntry {
  assertEnrollmentClass(input);
  const now = new Date().toISOString();
  const idx = entries.findIndex((e) => e.id === input.id);
  const prev = idx >= 0 ? entries[idx] : undefined;
  const entry: RegistryEntry = {
    id: input.id,
    tool: input.tool,
    kind: input.kind,
    cwd: input.cwd,
    source: input.source,
    enrolledAt: prev?.enrolledAt ?? now,
    lastSeenAt: now,
  };
  const label = input.label ?? prev?.label;
  if (label !== undefined) entry.label = label;
  const convId = input.convId ?? prev?.convId;
  if (convId !== undefined) entry.convId = convId;
  const remoteId = input.remoteId ?? prev?.remoteId;
  if (remoteId !== undefined) entry.remoteId = remoteId;
  const tmuxSession = input.tmuxSession ?? prev?.tmuxSession;
  if (tmuxSession !== undefined) entry.tmuxSession = tmuxSession;
  const pid = input.pid ?? prev?.pid;
  if (pid !== undefined) entry.pid = pid;
  entry.sessionClass = input.sessionClass;
  const delegationOrigin = input.delegationOrigin ?? prev?.delegationOrigin;
  if (delegationOrigin !== undefined) entry.delegationOrigin = delegationOrigin;
  const delegatorInstance = input.delegatorInstance ?? prev?.delegatorInstance;
  if (delegatorInstance !== undefined) entry.delegatorInstance = delegatorInstance;
  const delegatorTmuxSession = input.delegatorTmuxSession ?? prev?.delegatorTmuxSession;
  if (delegatorTmuxSession !== undefined) entry.delegatorTmuxSession = delegatorTmuxSession;
  const role = input.role ?? prev?.role;
  if (role !== undefined) entry.role = role;
  const jobState = input.jobState ?? prev?.jobState;
  if (jobState !== undefined) entry.jobState = jobState;
  const parent = input.parent ?? prev?.parent;
  if (parent !== undefined) entry.parent = parent;
  const task = input.task ?? prev?.task;
  if (task !== undefined) entry.task = task;
  const callbackTo = input.callbackTo ?? prev?.callbackTo;
  if (callbackTo !== undefined) entry.callbackTo = callbackTo;
  const remoteTarget = input.remoteTarget ?? prev?.remoteTarget;
  if (remoteTarget !== undefined) entry.remoteTarget = remoteTarget;
  const headless = input.headless ?? prev?.headless;
  if (headless !== undefined) entry.headless = headless;
  const originCwd = input.originCwd ?? prev?.originCwd;
  if (originCwd !== undefined) entry.originCwd = originCwd;
  const explicitCwd = input.explicitCwd ?? prev?.explicitCwd;
  if (explicitCwd !== undefined) entry.explicitCwd = explicitCwd;
  const depthBudget = input.depthBudget ?? prev?.depthBudget;
  if (depthBudget !== undefined) entry.depthBudget = depthBudget;
  const trackWp = input.trackWp ?? prev?.trackWp;
  if (trackWp !== undefined) entry.trackWp = trackWp;
  const throttle = input.throttle ?? prev?.throttle;
  if (throttle !== undefined) entry.throttle = throttle;
  const model = input.model ?? prev?.model;
  if (model !== undefined) entry.model = model;
  const effort = input.effort ?? prev?.effort;
  if (effort !== undefined) entry.effort = effort;
  const gatewayMode = input.gatewayMode ?? prev?.gatewayMode;
  if (gatewayMode !== undefined) entry.gatewayMode = gatewayMode;
  if (input.restorePinned !== undefined) {
    entry.restorePinned = input.restorePinned;
  } else if (prev?.restorePinned !== undefined) {
    entry.restorePinned = prev.restorePinned;
  } else {
    entry.restorePinned = shouldPreserveByRestorePin(entry);
  }
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  return entry;
}

/**
 * ATOMIC "is there a free slot? → enroll-as-running" (S3 fix). The cap check and
 * the running-enroll happen in ONE locked critical section, so two concurrent
 * `delegate`s can never both see the same free slot and overshoot the cap.
 * `running` counts CURRENT `running` jobs (`role:"job"`); when `running < cap`
 * the `input` is upserted with `jobState:"running"` and the returned entry is
 * non-undefined. When the cap is full, NOTHING is written and `undefined` is
 * returned (the caller enqueues a `pending` entry instead). Exported for tests.
 */
export function tryClaimSlot(
  input: EnrollInput,
  cap: number,
  path: string = resolveRegistryPath(),
): RegistryEntry | undefined {
  return withRegistryLock(path, (entries) => {
    if (cap <= 0) return { entries, result: undefined, save: false };
    // A `throttled` job KEEPS its slot (the rate-limit is account-wide; admitting
    // a replacement just burns the same quota), so it counts toward the cap too.
    const running = entries.filter(
      (e) => e.role === "job" && occupiesSlot(e.jobState ?? "pending"),
    ).length;
    // The job being claimed may already exist as `pending` (delegate enrolled it
    // first); don't double-count it against itself.
    const self = entries.find((e) => e.id === input.id);
    const selfRunning =
      self?.role === "job" && occupiesSlot(self.jobState ?? "pending") ? 1 : 0;
    if (running - selfRunning >= cap) {
      return { entries, result: undefined, save: false };
    }
    const entry = applyEnroll(entries, { ...input, jobState: "running" });
    return { entries, result: entry };
  });
}

/**
 * The legal job lifecycle transitions (P1 keeps it linear; P4 adds the queue's
 * pending→running). A transition not listed here is rejected by `advanceJob`.
 * Pure, exported for tests.
 */
const JOB_TRANSITIONS: Readonly<Record<JobState, ReadonlyArray<JobState>>> = {
  pending: ["running", "failed"],
  // A HEADLESS LOCAL job that finished on a transient rate-limit goes
  // running→throttled (reliability slice 1); it is NOT terminal.
  running: ["throttled", "done", "failed"],
  // The conductor resumes a throttled job (→running) on its backoff schedule, or
  // gives up after the attempt cap (→failed). A reconcile that sees fresh success
  // before the resumed run is re-observed may also settle it →done directly.
  throttled: ["running", "done", "failed"],
  done: [],
  failed: [],
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/**
 * Does a job in `state` OCCUPY a concurrency slot? `running` does, and so does
 * `throttled` — a throttled job is mid-flight (it KEEPS its slot rather than
 * letting the conductor admit a replacement that would immediately throttle on
 * the same account-wide limit). `pending`/`done`/`failed` do not. Pure, exported
 * for the cap/admission logic in delegate.ts and its tests.
 */
export function occupiesSlot(state: JobState): boolean {
  return state === "running" || state === "throttled";
}

/**
 * Move a job to `to`, persisting the new state (and stamping endedAt for the
 * terminal states). Returns the updated entry, or undefined when the id is
 * unknown / not a job / the transition is illegal. Reuses the atomic write.
 */
export function advanceJob(
  id: string,
  to: JobState,
  path: string = resolveRegistryPath(),
): RegistryEntry | undefined {
  return withRegistryLock(path, (entries) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.role !== "job") {
      return { entries, result: undefined, save: false };
    }
    const from = entry.jobState ?? "pending";
    if (from !== to && !canTransitionJob(from, to)) {
      return { entries, result: undefined, save: false };
    }
    entry.jobState = to;
    entry.lastSeenAt = new Date().toISOString();
    if (to === "done" || to === "failed") {
      entry.endedAt = entry.endedAt ?? entry.lastSeenAt;
    }
    return { entries, result: entry };
  });
}

/** Live job entries (role "job"), liveness reconciled like any other entry. */
export function listJobs(opts: RegistryOpts = {}): RegistryEntry[] {
  const path = opts.path ?? resolveRegistryPath();
  return loadRegistry(path).filter((e) => e.role === "job");
}

/** Refresh lastSeenAt. Returns false when the id is unknown. */
export function touchEntry(
  id: string,
  path: string = resolveRegistryPath(),
): boolean {
  return withRegistryLock(path, (entries) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return { entries, result: false, save: false };
    entry.lastSeenAt = new Date().toISOString();
    return { entries, result: true };
  });
}

/** Record the session's end. Returns false when the id is unknown. */
export function markEnded(
  id: string,
  path: string = resolveRegistryPath(),
): boolean {
  return withRegistryLock(path, (entries) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return { entries, result: false, save: false };
    const now = new Date().toISOString();
    entry.endedAt = now;
    entry.lastSeenAt = now;
    return { entries, result: true };
  });
}

function defaultTmuxHasSession(name: string): boolean {
  try {
    // "=" prefix forces an exact session-name match (no prefix matching).
    return (
      spawnSync("tmux", ["has-session", "-t", `=${name}`], {
        stdio: "ignore",
      }).status === 0
    );
  } catch {
    return false;
  }
}

function defaultNativeSessionAlive(name: string): boolean {
  try {
    return nativeSessionAlive(name);
  } catch {
    return false;
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The cmdline of a live pid (NUL-separated args joined with spaces), or
 * undefined when it can't be read. Used to detect PID REUSE: after a crash the
 * CLI's pid may be reassigned to an unrelated process, which `kill(pid,0)`
 * still reports as alive. /proc is Linux-only; elsewhere this returns undefined
 * and the caller stays conservative (treats the pid as still ours).
 */
function defaultProcessCmdline(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replace(/\0/g, " ")
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * Does the process at `pid` look like the `tool` CLI? Reads its cmdline and
 * checks for the tool name. CONSERVATIVE on doubt: if the cmdline can't be read
 * (non-Linux, permissions) we return true (assume it is still ours) so the
 * single-writer guard never DROPS a real writer (which would risk two CLIs
 * corrupting one .jsonl). Only a readable cmdline that clearly isn't the tool
 * (a reused pid) returns false.
 */
function processIsTool(
  pid: number,
  tool: RegistryTool,
  read: (pid: number) => string | undefined,
): boolean {
  const cmd = read(pid);
  if (cmd === undefined) return true; // can't tell → assume still ours
  return cmd.includes(tool);
}

/**
 * Liveness:
 *  - local-tmux -> the tmux session exists,
 *  - local      -> pid alive (when recorded) AND not endedAt; without a pid
 *                  (hook-enrolled: the hook's parent pid is a throwaway shell)
 *                  we trust SessionEnd + prune,
 *  - remote     -> always "live" here; the CALLER reconciles against
 *                  listRemoteSessions (the registry cannot probe the cluster).
 */
export function isLive(e: RegistryEntry, opts: LivenessOpts = {}): boolean {
  if (e.endedAt) return false;
  if (e.kind === "local-native") {
    const alive = opts.nativeSessionAlive ?? defaultNativeSessionAlive;
    return (e.tmuxSession
      ? [e.tmuxSession]
      : managedSessionCandidates(e.id)
    ).some((name) => alive(name));
  }
  if (e.kind === "local-tmux") {
    const has = opts.tmuxHasSession ?? defaultTmuxHasSession;
    return (e.tmuxSession
      ? [e.tmuxSession]
      : managedSessionCandidates(e.id)
    ).some((name) => has(name));
  }
  if (e.kind === "local") {
    // A process cannot survive a reboot: an entry last seen BEFORE the machine
    // booted is dead, whether or not it carries a pid.
    const bootMs = opts.bootTimeMs ?? defaultBootTimeMs();
    if (Date.parse(e.lastSeenAt) < bootMs) return false;
    // No pid (the claude SessionStart hook can't reliably capture claude's pid):
    // unverifiable. Treat as live here, but convOwners demotes a no-pid local
    // entry to a SUSPECT (warn), not a hard block — so a stale hook entry left
    // by a crash never refuses a relaunch.
    if (e.pid === undefined) return true;
    if (!(opts.pidAlive ?? defaultPidAlive)(e.pid)) return false;
    // pid alive — but is it STILL our CLI? After a crash the dead CLI's pid can
    // be reassigned to an unrelated process that kill(pid,0) reports as alive;
    // verify the process identity to avoid a false live-writer.
    return processIsTool(
      e.pid,
      e.tool,
      opts.processCmdline ?? defaultProcessCmdline,
    );
  }
  return true;
}

/** Entries considered live right now (see isLive for the per-kind rules). */
export function listLive(opts: RegistryOpts = {}): RegistryEntry[] {
  const path = opts.path ?? resolveRegistryPath();
  return loadRegistry(path).filter((e) => isLive(e, opts));
}

/**
 * Drop DEAD entries whose last activity (endedAt, else lastSeenAt) is older
 * than maxAgeHours. Live entries always stay; recently-dead ones stay too so
 * `restore` can still resume them after a reboot via the scan fallback.
 * Returns the number of removed entries.
 */
export function prune(maxAgeHours: number, opts: RegistryOpts = {}): number {
  const path = opts.path ?? resolveRegistryPath();
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  return withRegistryLock(path, (entries) => {
    const kept = entries.filter((e) => {
      if (isLive(e, opts)) return true;
      if (shouldPreserveByRestorePin(e)) return true;
      const last = Date.parse(e.endedAt ?? e.lastSeenAt);
      return Number.isFinite(last) && last >= cutoff;
    });
    if (kept.length === entries.length)
      return { entries, result: 0, save: false };
    return { entries: kept, result: entries.length - kept.length };
  });
}

/** Map a CLI profile name to a registry tool (undefined for shell/opencode/…). */
export function coerceRegistryTool(profile: string): RegistryTool | undefined {
  switch (profile) {
    case "claude":
    case "claude-code":
      return "claude";
    case "codex":
      return "codex";
    case "agy":
    case "antigravity":
      return "agy";
    default:
      return undefined;
  }
}

/**
 * Auto-enrolment after `remote run` started a local tmux session. Best-effort
 * plumbing: never throws (a registry hiccup must not break the run).
 */
export function enrollFromRun(args: {
  profile: string;
  slug: string;
  tmuxSession: string;
  /** Which local host runs the session terminal (default: tmux). */
  hostKind?: "local-tmux" | "local-native";
  /** Pane pid observed by the structured launcher, if available. */
  pid?: number;
  cwd: string;
  convId?: string;
  gatewayMode?: "gateway" | "direct";
  sessionClass: RegistrySessionClass;
  delegationOrigin?: DelegationOrigin;
  delegatorInstance?: string;
  delegatorTmuxSession?: string;
}): void {
  const tool = coerceRegistryTool(args.profile);
  if (!tool) return; // shell/opencode/… sessions stay tmux-only
  try {
    enroll({
      id: args.slug,
      tool,
      kind: args.hostKind ?? "local-tmux",
      cwd: args.cwd,
      source: "run",
      label: args.slug,
      tmuxSession: args.tmuxSession,
      sessionClass: args.sessionClass,
      ...(args.pid !== undefined ? { pid: args.pid } : {}),
      ...(args.delegationOrigin !== undefined
        ? { delegationOrigin: args.delegationOrigin }
        : {}),
      ...(args.delegatorInstance !== undefined
        ? { delegatorInstance: args.delegatorInstance }
        : {}),
      ...(args.delegatorTmuxSession !== undefined
        ? { delegatorTmuxSession: args.delegatorTmuxSession }
        : {}),
      ...(args.convId !== undefined ? { convId: args.convId } : {}),
      ...(args.gatewayMode !== undefined ? { gatewayMode: args.gatewayMode } : {}),
    });
  } catch {
    // best-effort: the tmux session is up regardless
  }
}

export type LocalLsRow = {
  slug: string;
  /** Exact managed tmux name when this row came from a live tmux session. */
  tmuxSession?: string;
  profile: string;
  state: "attached" | "detached" | "live";
  path: string;
  /** "registry" = enrolled (reliable cwd/convId); "guess" = tmux-only. */
  badge: "registry" | "guess";
  /** custom display name set via `remote rename`, shown in PROJECT column */
  displayName?: string;
};

/** Pure join used by `listLocalForLs` and its compatibility tests. */
export function localLsRows(
  sessions: readonly LocalSession[],
  live: readonly RegistryEntry[],
): LocalLsRow[] {
  const rows: LocalLsRow[] = [];
  const matched = new Set<string>();
  for (const s of sessions) {
    const explicit = live.find((e) => e.tmuxSession === s.name);
    const historical = live.filter(
      (e) =>
        e.kind === "local-tmux" &&
        e.tmuxSession === undefined &&
        e.id === s.slug,
    );
    const entry =
      explicit ??
      (historical.length === 1 &&
      sessions.filter((candidate) => candidate.slug === s.slug).length === 1
        ? historical[0]
        : undefined);
    if (entry) matched.add(entry.id);
    rows.push({
      slug: s.slug,
      tmuxSession: s.name,
      profile: s.profile,
      state: s.attached ? "attached" : "detached",
      path: s.path,
      badge: entry ? "registry" : "guess",
      ...(s.displayName !== undefined ? { displayName: s.displayName } : {}),
    });
  }
  // Only surface local-tmux entries that were NOT matched above — these are
  // orphaned registry records for tmux sessions remote itself created.
  // kind:"local" entries are Claude Code conversation sessions (UUID ids,
  // no tmuxSession) — they are internal CC state, not user-facing sessions.
  for (const e of live) {
    if (!isManagedLocalKind(e.kind) || matched.has(e.id)) continue;
    // A historical record without an exact tmux name cannot authoritatively
    // claim either member of a live h2a-/remote- collision. It already remains
    // visible as two tmux rows above; adding it here would invent a third,
    // registry-only session for the same ambiguous slug.
    if (
      e.tmuxSession === undefined &&
      sessions.filter((session) => session.slug === e.id).length > 1
    ) {
      continue;
    }
    rows.push({
      slug: e.label ?? e.id.slice(0, 12),
      ...(e.tmuxSession !== undefined ? { tmuxSession: e.tmuxSession } : {}),
      profile: e.tool,
      state: "live",
      path: e.cwd,
      badge: "registry",
    });
  }
  return rows;
}

/**
 * LOCAL rows for `remote ls`: live tmux sessions joined with the registry
 * ([registry] vs [guess] badge), plus live registry-only sessions (e.g. a
 * hook-enrolled claude running in a plain terminal). Dead registry entries are
 * pruned on the way (layout maxAgeHours).
 */
export function listLocalForLs(opts: RegistryOpts = {}): LocalLsRow[] {
  const path = opts.path ?? resolveRegistryPath();
  try {
    prune(getLayoutConfig().maxAgeHours, { ...opts, path });
  } catch {
    // a config/registry hiccup must not break `remote ls`
  }
  const live = listLive({ ...opts, path });
  const sessions = listLocalSessions();
  return localLsRows(sessions, live);
}

/**
 * Resolve a LOCAL session (kind:"local-tmux") recorded in the registry by
 * slug/id, custom label, or full tmux session name, regardless of current tmux
 * liveness. Historical rows without a persisted tmux name retain both prefix
 * candidates so callers can refuse an unsafe bare-slug choice.
 *
 * Why not tmux-only: `attach` used to decide local-vs-remote purely from a live
 * `tmux list-sessions` (findLocalSession). A transient tmux miss right after
 * `remote run` then mis-routed a purely LOCAL session to a k8s Pod
 * (`kubectl exec … session-<name>` → NotFound → reconnect loop) whenever a
 * tunnel is configured. `remote ls` already trusts the durable registry record;
 * this lets `attach` be just as reliable. Pure over the passed entries — the
 * caller supplies `loadRegistry()`, so it stays trivially testable.
 */
export type LocalTmuxSessionResolution =
  | { kind: "found"; name: string }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "missing" };

/**
 * Resolve a registry-backed local tmux target without manufacturing a legacy
 * name for historical rows that did not persist `tmuxSession`.
 */
export function resolveLocalTmuxSessionForName(
  target: string,
  entries: readonly RegistryEntry[],
): LocalTmuxSessionResolution {
  const requested = parseManagedSessionName(target);
  const matches = entries.filter(
    (e) => {
      if (e.role !== undefined || !isManagedLocalKind(e.kind) || e.endedAt) {
        return false;
      }
      // A full managed name is an exact selector, never a slug/label alias.
      // In particular an historical id that happens to start with `h2a-`
      // must not redirect `h2a-x` to some different persisted session.
      if (requested) {
        return (
          e.tmuxSession === target ||
          (e.tmuxSession === undefined && requested.slug === e.id)
        );
      }
      return e.id === target || e.label === target || e.tmuxSession === target;
    },
  );
  const ids = new Set(matches.map((e) => e.id));
  if (ids.size !== 1) {
    if (ids.size === 0) return { kind: "missing" };
    return {
      kind: "ambiguous",
      names: matches
        .flatMap((entry) =>
          entry.tmuxSession
            ? [entry.tmuxSession]
            : managedSessionCandidates(entry.id),
        )
        .sort(),
    };
  }
  const chosen = matches
    .slice()
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]!;
  if (chosen.tmuxSession) return { kind: "found", name: chosen.tmuxSession };
  if (requested) return { kind: "found", name: target };
  return { kind: "ambiguous", names: managedSessionCandidates(chosen.id) };
}

/**
 * Compatibility helper for callers that only need a uniquely known local
 * target. New command wiring should inspect `resolveLocalTmuxSessionForName`
 * so it can report prefix collisions instead of falling through remotely.
 */
export function localTmuxSessionForName(
  target: string,
  entries: readonly RegistryEntry[],
): string | undefined {
  const resolution = resolveLocalTmuxSessionForName(target, entries);
  return resolution.kind === "found" ? resolution.name : undefined;
}

/**
 * DEDICATED resolver for `kind:"local-native"` registry entries — the native
 * twin of the local-tmux target filter in index.ts. That filter stays
 * tmux-scoped on purpose: its second caller iterates LIVE tmux sessions by
 * name inside the destructive relaunch planner, where a broadened match would
 * be a category error. The two resolvers coexist so neither lies about its
 * name.
 *
 * A native entry's PERSISTED identity, as measured on every native write path
 * (`enroll` in startJob and `enrollFromRun` on run/resume/relaunch): `id` and
 * `label` carry the slug, and `tmuxSession` — despite its tmux-era name —
 * carries the native host session name `localSessionName(slug)`, the
 * h2a-<slug> naming contract shared across hosts (native-host.ts). Historical
 * rows without a persisted session name fall back to the managed-name
 * candidates of their id, exactly like `isLive`.
 *
 * NO liveness input exists here by construction: which host a recorded
 * session belongs to is decided by its persisted kind alone — a dead native
 * session stays native. Whether an ACT on it can proceed is the caller's
 * separate liveness gate.
 * (0 local-native entries in the fleet registry as of 2026-08-08; this
 * resolver prepares the re-use paths for the sessions #178 will produce.)
 */
export function registryEntriesForNativeTarget(
  target: string,
  entries: readonly RegistryEntry[] = loadRegistry(),
): RegistryEntry[] {
  const requested = parseManagedSessionName(target);
  const candidates = requested ? [target] : managedSessionCandidates(target);
  return entries.filter((e) => {
    if (e.kind !== "local-native") return false;
    // A full managed name is an exact selector, never a slug/label alias
    // (same rule as the tmux filter and resolveLocalTmuxSessionForName).
    if (requested) {
      return (
        e.tmuxSession === target ||
        (e.tmuxSession === undefined && e.id === requested.slug)
      );
    }
    return (
      e.id === target ||
      e.label === target ||
      (e.tmuxSession !== undefined && candidates.includes(e.tmuxSession))
    );
  });
}

/**
 * WHICH local host serves an act (attach/stop) on a resolved session name:
 * the PERSISTED kind, never liveness. A recorded native session is served
 * natively even while dead — the caller's liveness probe result is only
 * (a) discovery for a LIVE native session whose registry row was lost
 * (pre-native validators dropped kind:"local-native" rows on rewrite) and
 * (b) the caller's own gate on whether the act can proceed.
 */
export function persistedLocalHostKind(
  target: string,
  entries: readonly RegistryEntry[],
  nativeAlive: boolean,
): "local-native" | "local-tmux" {
  if (registryEntriesForNativeTarget(target, entries).length > 0) {
    return "local-native";
  }
  return nativeAlive ? "local-native" : "local-tmux";
}
