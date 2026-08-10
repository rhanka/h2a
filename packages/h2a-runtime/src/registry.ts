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
  localSessionName,
  managedSessionCandidates,
  parseManagedSessionName,
  listLocalSessions,
  tmuxAvailable,
  type LocalSession,
} from "./tmux.js";
import type { SessionClass } from "./session-class.js";
import { nativeSessionLiveness } from "./native-host.js";

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
   * The process-GROUP-LEADER's own start-time (Linux `/proc/<pgid>/stat`
   * field 22), captured at the SAME moment as `pgid` above (leader pid ==
   * pgid — see `PtyHandle.pgid`'s doc comment in pty.ts). This is the
   * pid-recycling-proof discriminant for the GROUP itself, exactly as
   * `ownerHostStartTime` is for the HOST: a reaper must re-read this pid's
   * CURRENT start-time immediately before `kill(-pgid, sig)` and compare —
   * a match proves the group is still the one this row was written for; a
   * mismatch means the OS recycled `pgid` to an unrelated group since this
   * row was written. See `#killGroupAndConfirmDead` in native-terminal/host.ts,
   * the sole consumer.
   */
  pgidLeaderStartTime?: number;
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
  /**
   * Injectable native-PTY-host session probe (kind:"local-native"). 3-state
   * (F2): "unknown" is a PROBE FAILURE, never proof of death — isLive treats
   * it as possibly-live so an unprovable session is never pruned/hidden.
   */
  nativeSessionLiveness?: (name: string) => true | false | "unknown";
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

/**
 * 3-state registry READ (F2), extended by the rebase reconciliation (2026-08)
 * to carry PER-ROW unreadable rows instead of silently dropping them. The lie
 * this type removes: a corrupt/unreadable registry FILE used to flatten into
 * `[]` — indistinguishable from "no rows" — which let destructive acts
 * (stop/kill/relaunch) treat an UNPROVABLE local state as PROVEN ABSENCE and
 * fall through to a remote homonym. A SINGLE unreadable ROW inside an
 * otherwise-valid file used to be silently filtered out of "ok" the same
 * way — the same lie, at row granularity: a valid row plus an unreadable
 * TWIN of the same name resolved as if only the valid row existed. The read
 * now says which of the three it is, and the compiler enumerates every
 * caller:
 *  - "ok": the FILE was read and validated ("ok" with entries:[] includes the
 *    PROVABLY-empty ENOENT case — rows cannot exist without a file).
 *    `unreadable` carries every row that failed `isRegistryEntry` verbatim
 *    (raw, defensively typed) — absence must be provable BY IDENTITY, so a
 *    destructive caller resolving target X must check whether an unreadable
 *    row COULD be X, not merely whether the array is non-empty. A rotten
 *    legacy row must not disable the WHOLE tool — that would trade a lie for
 *    an outage — so a per-row failure never flips the file to "unknown".
 *  - "unknown": the FILE itself could not be read/parsed (ENOENT excluded —
 *    see "ok" above). Destructive callers MUST refuse; views may degrade but
 *    must never assert absence.
 * The unknown branch deliberately carries NO `entries`/`unreadable` fields,
 * so a caller cannot mechanically re-flatten it into an empty collection.
 */
export type RegistryReadResult =
  | {
      readonly state: "ok";
      readonly entries: RegistryEntry[];
      /** Raw rows that failed `isRegistryEntry`, preserved verbatim (never dropped). */
      readonly unreadable: readonly RawRow[];
    }
  | { readonly state: "unknown"; readonly reason: string };

/** A raw, unvalidated registry row — read DEFENSIVELY (it failed validation). */
export type RawRow = Record<string, unknown>;

// Returns the 3-state RegistryReadResult above
// ({state:"ok",entries,unreadable} | {state:"unknown",reason}), NOT a plain
// array — a bare `.map()`/`.find()`/`.some()`/`.every()` on the return value
// is a bug. tsc does NOT type-check `.js` files, so a signature change here
// is invisible to JS callers (e.g. packages/h2a/test/*.js) even though every
// `.ts` caller gets a compile error. Anyone widening/changing this return
// type MUST grep repo-wide for BOTH extensions before trusting the compiler
// to be exhaustive:
//   git grep -nE 'loadRegistry\b' -- '**/*.js' '**/*.ts' | grep -v loadRegistryWithDiagnostics
export function loadRegistry(
  path: string = resolveRegistryPath(),
): RegistryReadResult {
  const raw = rawRegistryRead(path);
  if (raw.state === "unknown") return raw;
  // B2 — WHOLE-FILE trace, same logic as the per-identity `unreadable` check
  // applied to the WHOLE file: this file was REBUILT from a registry the
  // write path could not read (rawRegistryEntriesForWrite moved the
  // unreadable bytes aside to a sibling registry.corrupt-*.json and rebuilt
  // from `[]`). Rows that lived in the corrupt bytes are NOT provably absent
  // from THIS read — a destructive caller must never treat "missing here"
  // as "no local session existed" while this trace is present. Every reader
  // (not just this one) must see "unknown", so this is checked on the READ
  // path (loadRegistry), never on rawRegistryRead itself — the write path
  // (rawRegistryEntriesForWrite) deliberately ignores this field so a
  // rebuilt-but-now-valid file keeps accepting new enrolments (REBUILDING is
  // allowed); only the "was something silently lost?" READ verdict is
  // poisoned, and only until the next successful write clears the trace.
  if (raw.rebuiltFromCorruptAt !== undefined) {
    return {
      state: "unknown",
      reason:
        `registry was rebuilt from an unreadable file at ${raw.rebuiltFromCorruptAt} ` +
        `(see registry.corrupt-*.json next to the registry) — rows from before the ` +
        `rebuild are not provably absent`,
    };
  }
  const entries: RegistryEntry[] = [];
  const unreadable: RawRow[] = [];
  for (const row of raw.rows) {
    if (isRegistryEntry(row)) {
      entries.push(row);
    } else if (row && typeof row === "object") {
      // Counter-mutant guard (PART-A producer): a row that fails
      // `isRegistryEntry` is TRANSPORTED, never dropped — dropping it here
      // is exactly the per-row lie this type exists to remove.
      unreadable.push(row as RawRow);
    }
    // A non-object row (string/number/null/etc.) cannot address any target
    // by identity (no id/label/tmuxSession to match against) — it is
    // discarded rather than carried as a formless "unreadable" row.
  }
  return { state: "ok", entries, unreadable };
}

type RawRegistryRead =
  | {
      readonly state: "ok";
      readonly rows: unknown[];
      /** Set when this FILE carries the B2 rebuilt-from-corrupt trace (the
       * top-level `rebuiltFromCorruptAt` field `saveRegistry` stamps on a
       * write that rebuilt from an unreadable file). Passed through as data
       * only — `rawRegistryRead` itself stays state:"ok" so the WRITE path
       * (rawRegistryEntriesForWrite) keeps treating a rebuilt-but-valid file
       * as writable; only `loadRegistry` (the READ path) turns this into an
       * "unknown" verdict for destructive callers. */
      readonly rebuiltFromCorruptAt?: string;
    }
  | { readonly state: "unknown"; readonly reason: string };

/** Raw `entries` array of the registry FILE, with the read state preserved. */
function rawRegistryRead(path: string): RawRegistryRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    // An ABSENT file is provable emptiness (rows cannot exist without a
    // file); every other read failure (EACCES, EIO, …) is UNKNOWN.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "ok", rows: [] };
    }
    return {
      state: "unknown",
      reason: `registry file is unreadable (${(error as NodeJS.ErrnoException).code ?? "read error"})`,
    };
  }
  try {
    const parsed = JSON.parse(text);
    const entries = (parsed as { entries?: unknown })?.entries;
    if (!Array.isArray(entries)) {
      return { state: "unknown", reason: "registry has no entries array" };
    }
    const rebuiltFromCorruptAt = (parsed as { rebuiltFromCorruptAt?: unknown })
      ?.rebuiltFromCorruptAt;
    return {
      state: "ok",
      rows: entries,
      ...(typeof rebuiltFromCorruptAt === "string" ? { rebuiltFromCorruptAt } : {}),
    };
  } catch {
    return { state: "unknown", reason: "registry is corrupt (not valid JSON)" };
  }
}

/**
 * Move the unreadable bytes at `path` aside VERBATIM to a sibling
 * `registry.corrupt-<ts>-<pid>.json` (best-effort: a truly unreadable file,
 * e.g. EACCES, has nothing left to move — the rebuild still proceeds and is
 * still flagged by the caller). B2 — "REBUILDING is allowed. DESTROYING is
 * not.": called by `withRegistryLock` ONLY immediately before a write that
 * is actually about to REBUILD the file from `[]`, never on a mere read or a
 * `save:false` no-op (e.g. `prune` finding nothing to change on a corrupt
 * file) — otherwise a corrupt registry nothing ever mutates would spam a
 * fresh sibling file on every poll (`remote ls` calls `prune` every time).
 * Returns the rebuild timestamp to stamp on the save (the WHOLE-FILE trace
 * `loadRegistry` turns into "unknown" for every destructive reader).
 */
function moveAsideUnreadableRegistry(path: string): string {
  const at = new Date().toISOString();
  try {
    const original = readFileSync(path, "utf8");
    const corruptPath = join(
      dirname(path),
      `registry.corrupt-${at.replace(/[:.]/g, "-")}-${process.pid}.json`,
    );
    writeFileSync(corruptPath, original, "utf8");
  } catch {
    // Nothing readable to move aside (EACCES/EIO/ENOENT/…) — the rebuild
    // still proceeds and is still flagged so destructive readers stay
    // fail-closed.
  }
  return at;
}

/**
 * Pure identity match: does raw row `raw` (already known to have FAILED
 * `isRegistryEntry`) plausibly address `target` under the SAME identity rules
 * used to match a VALID row (id / label / exact tmuxSession / managed-name
 * candidates)? Shared by `unreadableRowsForTarget` (A2's per-identity poison
 * check inside `resolveManagedHost`) and the legacy path-based helper below.
 * Defensive: an unreadable row is read WITHOUT presuming a well-formed shape.
 */
function rawRowMatchesTarget(target: string, raw: RawRow): boolean {
  const requested = parseManagedSessionName(target);
  const candidates = requested ? [target] : managedSessionCandidates(target);
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const label = typeof raw.label === "string" ? raw.label : undefined;
  const tmuxSession =
    typeof raw.tmuxSession === "string" ? raw.tmuxSession : undefined;
  if (requested) {
    return (
      tmuxSession === target ||
      (tmuxSession === undefined && id === requested.slug)
    );
  }
  return (
    id === target ||
    label === target ||
    (tmuxSession !== undefined && candidates.includes(tmuxSession))
  );
}

/**
 * Unreadable rows (from an ALREADY-READ `loadRegistry()` snapshot) that
 * plausibly address `target` under the resolver's identity rules. Pure — no
 * fs — so every caller consults the SAME snapshot instead of re-reading the
 * file (this is what `resolveManagedHost` calls for its per-identity poison
 * check, A2). THE RULE: absence must be provable BY IDENTITY — an unknown by
 * identity for X, never a global unknown that disables every OTHER identity.
 */
export function unreadableRowsForTarget(
  target: string,
  unreadable: readonly RawRow[],
): RawRow[] {
  return unreadable.filter((raw) => rawRowMatchesTarget(target, raw));
}

/**
 * Path-based convenience wrapper: performs its OWN registry read (a second
 * read when the caller already has one — prefer `unreadableRowsForTarget`
 * with an existing `loadRegistry()` snapshot when one is available, e.g.
 * inside `resolveManagedHost`). Raw rows in the registry FILE that FAIL
 * validation (e.g. `kind` absent or unreadable) but plausibly address
 * `target`. `loadRegistry()` cannot return them as `entries` — but a
 * DESTRUCTIVE caller must know the identity exists in an unreadable state:
 * such a row makes local host state UNKNOWN (fail closed, sol-2), never "no
 * local session" — which would let the act fall through to a REMOTE homonym.
 *
 * B3 — this is itself a RE-READ on a destructive path (a TOCTOU window: the
 * caller's own earlier read may have succeeded, then the registry became
 * unreadable strictly BETWEEN the two reads — another writer, a partial
 * write, disk pressure). A re-read inherits the SAME 3-state contract as the
 * first: a whole-file "unknown" here used to flatten to `[]` — "no
 * unreadable row for this identity" — which is indistinguishable from "the
 * row is fine" and let the caller fall through past this guard. Returns
 * `"unknown"` instead so the caller refuses exactly like any other unknown
 * registry read, never silently re-simplified into an empty collection.
 */
export function unreadableRegistryRowsForTarget(
  target: string,
  path: string = resolveRegistryPath(),
): RawRow[] | "unknown" {
  const read = loadRegistry(path);
  if (read.state === "unknown") return "unknown";
  return unreadableRowsForTarget(target, read.unreadable);
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
  leaderStartTime?: number,
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
      ...(leaderStartTime !== undefined ? { pgidLeaderStartTime: leaderStartTime } : {}),
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
  | { status: "resolved"; pgid: number; leaderStartTime?: number }
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
  return {
    status: "resolved",
    pgid: entry.pgid,
    ...(typeof entry.pgidLeaderStartTime === "number"
      ? { leaderStartTime: entry.pgidLeaderStartTime }
      : {}),
  };
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
    (e.pgidLeaderStartTime === undefined ||
      (typeof e.pgidLeaderStartTime === "number" &&
        Number.isInteger(e.pgidLeaderStartTime) &&
        e.pgidLeaderStartTime >= 0)) &&
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

/**
 * Atomic write: tmp file in the same dir, then rename. `preserved` carries
 * raw rows that FAIL validation (e.g. `kind` unreadable): they are written
 * back verbatim so a load-mutate-save cycle never silently ERASES an
 * unreadable row from the file (sol-2 — an erased row turns "host state
 * unknown" into "no local session", re-routing destructive acts).
 *
 * `rebuiltFromCorruptAt` (B2) stamps the WHOLE-FILE trace when this save is
 * the rebuild that followed a whole-file-unknown read: `loadRegistry` turns
 * its presence into an "unknown" verdict for every subsequent READ, until a
 * later `saveRegistry` call (one that did NOT rebuild from corrupt) omits it
 * again and the trace clears.
 */
function saveRegistry(
  entries: RegistryEntry[],
  path: string,
  preserved: unknown[] = [],
  rebuiltFromCorruptAt?: string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  const body: { version: 1; entries: unknown[]; rebuiltFromCorruptAt?: string } = {
    version: 1,
    entries: [...entries, ...preserved],
  };
  if (rebuiltFromCorruptAt !== undefined) {
    body.rebuiltFromCorruptAt = rebuiltFromCorruptAt;
  }
  writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
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
    // WRITE-path raw read: enrolment deliberately REBUILDS a missing/corrupt
    // registry (a hiccup must not brick every future enrolment), so an
    // unknown state flattens to `[]` for `fn`'s input — but see below: the
    // corrupt BYTES are moved aside (never overwritten in place) before any
    // write that actually rebuilds from that `[]`.
    const raw = rawRegistryRead(path);
    const rows = raw.state === "ok" ? raw.rows : [];
    const { entries, result, save } = fn(rows.filter(isRegistryEntry));
    if (save !== false) {
      // B2 — "REBUILDING is allowed. DESTROYING is not.": only reached when
      // a write is ACTUALLY about to rebuild the file, never on a read-only
      // `save:false` no-op (prune finding nothing to change on a corrupt
      // file must not spam a fresh registry.corrupt-*.json on every poll).
      const rebuiltFromCorruptAt =
        raw.state === "unknown" ? moveAsideUnreadableRegistry(path) : undefined;
      // Unreadable rows are preserved verbatim: a mutation of the VALID
      // entries must never erase what it could not read (sol-2).
      saveRegistry(
        entries,
        path,
        rows.filter((row) => !isRegistryEntry(row)),
        rebuiltFromCorruptAt,
      );
    }
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
  const read = loadRegistry(path);
  // Unknown read → EMPTY VIEW, deliberately: this list feeds supervision
  // views and job launch planning (acts that only ever START work); no
  // kill/stop keys off it. Callers that must PROVE local absence go through
  // resolveManagedHost, which transports the unknown read as a refusal.
  return read.state === "ok"
    ? read.entries.filter((e) => e.role === "job")
    : [];
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

function defaultNativeSessionLiveness(name: string): true | false | "unknown" {
  try {
    return nativeSessionLiveness(name);
  } catch {
    // The producer already maps its own failures to "unknown"; this belt
    // keeps an unexpected throw from ever reading as death.
    return "unknown";
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
    const liveness = opts.nativeSessionLiveness ?? defaultNativeSessionLiveness;
    // "unknown" deliberately counts as possibly-live here (`!== false`):
    // isLive feeds views AND prune — erasing the host pin of an unprovable
    // session would re-route later destructive acts (F2). Only a POSITIVE
    // "false" reads as death.
    return (e.tmuxSession
      ? [e.tmuxSession]
      : managedSessionCandidates(e.id)
    ).some((name) => liveness(name) !== false);
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
  const read = loadRegistry(path);
  // Unknown read → EMPTY VIEW: `ls`-style projections degrade to showing no
  // registry rows (the status bar has its own UNKNOWN rendering via
  // loadRegistryWithDiagnostics). Guards that must prove the ABSENCE of a
  // writer must not consume this list — convOwners reads the registry itself
  // and refuses on an unknown read.
  return read.state === "ok" ? read.entries.filter((e) => isLive(e, opts)) : [];
}

/**
 * Drop DEAD entries whose last activity (endedAt, else lastSeenAt) is older
 * than maxAgeHours. Live entries always stay; recently-dead ones stay too so
 * `restore` can still resume them after a reboot via the scan fallback.
 * Returns the number of removed entries.
 *
 * RECONCILIATION DECISION (2026-08, #199 rebase — restore-pin x FILE-level
 * unknown; architect to re-measure): `shouldPreserveByRestorePin` never
 * observes `loadRegistry()`'s 3-state read directly — it runs INSIDE
 * `withRegistryLock`, over the already-validated `entries` array only. Two
 * unprovable cases both resolve CONSERVATIVE-PRESERVE by construction,
 * neither newly added here:
 *  - whole-FILE unknown (corrupt/unreadable registry.json):
 *    `withRegistryLock`'s own raw read flattens to `[]` for its write-path
 *    contract, so `kept.length === entries.length` (0 === 0) and this prune
 *    is a NO-OP (`save:false`, see below) — nothing is read, so nothing a
 *    restore pin could have kept is ever written over or lost.
 *  - a single restore-pinned row that fails `isRegistryEntry` (per-row
 *    unreadable, PART A): it never reaches `entries` here at all (excluded
 *    before this callback runs), but `withRegistryLock`/`saveRegistry`
 *    re-append every such raw row VERBATIM on every write (sol-2) —
 *    `shouldPreserveByRestorePin` cannot prune what it never sees, and the
 *    row survives regardless of what this function decides.
 * Neither case is exercised through an explicit `state:"unknown"` branch
 * here (there isn't one to write) — REPORTED, not silently assumed settled.
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
  /**
   * Which local host ACTUALLY runs the session terminal. REQUIRED: the write
   * boundary refuses to guess — an implicit "local-tmux" default mislabeled
   * native sessions and re-routed later destructive acts (F2 family). A
   * missing row is recoverable by discovery; a wrongly-hosted row is not.
   */
  hostKind: "local-tmux" | "local-native";
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
  // Runtime twin of the required-parameter type: an untyped caller that omits
  // the host gets NO row rather than a row on a guessed host. Never default.
  if (args.hostKind !== "local-tmux" && args.hostKind !== "local-native") {
    process.stderr.write(
      `[h2a] registry enrolment refused for ${args.slug}: caller did not name the terminal host\n`,
    );
    return;
  }
  try {
    enroll({
      id: args.slug,
      tool,
      kind: args.hostKind,
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
  // No default read: the caller owns the registry READ STATE (an unknown
  // read must refuse upstream, never flatten into "no rows" here).
  entries: readonly RegistryEntry[],
): RegistryEntry[] {
  return registryEntriesForManagedKind("local-native", target, entries);
}

/**
 * The SAME exact-identity filter scoped to persisted `kind:"local-tmux"` rows.
 * It exists so host resolution can consult BOTH persisted kinds symmetrically
 * (`resolveManagedHost`): recognizing only one kind before falling back to a
 * probe was the measured F2 defect — a persisted tmux row plus a homonymous
 * live native process re-routed destructive acts to the wrong host.
 * (The broader index.ts local-tmux target filter stays separate on purpose:
 * it also matches LIVE tmux state for the relaunch planner.)
 */
export function registryEntriesForLocalTmuxTarget(
  target: string,
  // No default read: the caller owns the registry READ STATE (an unknown
  // read must refuse upstream, never flatten into "no rows" here).
  entries: readonly RegistryEntry[],
): RegistryEntry[] {
  return registryEntriesForManagedKind("local-tmux", target, entries);
}

function registryEntriesForManagedKind(
  kind: "local-native" | "local-tmux",
  target: string,
  entries: readonly RegistryEntry[],
): RegistryEntry[] {
  const requested = parseManagedSessionName(target);
  const candidates = requested ? [target] : managedSessionCandidates(target);
  return entries.filter((e) => {
    if (e.kind !== kind) return false;
    // A positively-ENDED session no longer pins a host: only current rows
    // take part in host resolution (mirrors isLive's endedAt short-circuit).
    if (e.endedAt !== undefined) return false;
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
 * Three-state host probe result. "unknown" is a PROBE FAILURE — it is never
 * proof of death, and destructive callers must fail closed on it.
 */
export type ManagedHostProbeResult = "live" | "dead" | "unknown";

/** Native probe: an op failure is UNKNOWN, never dead (producer is 3-state). */
export function probeNativeSession(name: string): ManagedHostProbeResult {
  try {
    const alive = nativeSessionLiveness(name);
    if (alive === true) return "live";
    if (alive === false) return "dead";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Tmux probe. No tmux binary/server means no tmux session CAN exist (a tmux
 * session cannot outlive its server), so that is provable death — only a
 * spawn-level failure of an installed tmux is UNKNOWN.
 */
export function probeTmuxSession(name: string): ManagedHostProbeResult {
  if (!tmuxAvailable()) return "dead";
  try {
    // "=" prefix forces an exact session-name match (no prefix matching).
    const r = spawnSync("tmux", ["has-session", "-t", `=${name}`], {
      stdio: "ignore",
    });
    if (r.error) return "unknown";
    return r.status === 0 ? "live" : "dead";
  } catch {
    return "unknown";
  }
}

/**
 * Symmetric managed-host resolution for acts on a local session
 * (attach/stop/resume, and restore consumes the same result).
 *
 * Rules (the F1/F2 remedy):
 *  1. The exact managed identity is matched against BOTH persisted kinds.
 *  2. Exactly one persisted kind wins for acts on the existing process,
 *     REGARDLESS of the other host's liveness — liveness gates whether the
 *     act can run, never which host serves it.
 *  3. Persisted rows of both kinds for one identity are AMBIGUOUS and the
 *     caller must fail closed.
 *  4. Only when no persisted row exists may probes DISCOVER a host (a live
 *     session whose registry row was lost). Exactly one positive probe wins;
 *     two positives are ambiguous; a probe failure makes the resolution
 *     UNKNOWN (fail closed), never "dead on that host".
 */
export type ManagedHostResolution =
  | {
      readonly state: "recorded";
      readonly kind: "local-native" | "local-tmux";
      readonly name: string;
    }
  | {
      readonly state: "discovered";
      readonly kind: "local-native" | "local-tmux";
      readonly name: string;
    }
  | {
      readonly state: "ambiguous";
      readonly candidates: ReadonlyArray<"local-native" | "local-tmux">;
    }
  | { readonly state: "missing" }
  | { readonly state: "unknown"; readonly reason: string };

function isRegistryReadResult(
  value: readonly RegistryEntry[] | RegistryReadResult,
): value is RegistryReadResult {
  return !Array.isArray(value);
}

export function resolveManagedHost(
  target: string,
  entries: readonly RegistryEntry[] | RegistryReadResult = loadRegistry(),
  probes: {
    readonly native?: (name: string) => ManagedHostProbeResult;
    readonly tmux?: (name: string) => ManagedHostProbeResult;
  } = {},
): ManagedHostResolution {
  // The registry READ STATE is part of the resolution (F2): an unreadable
  // registry means the persisted host cannot be proven — transported as
  // "unknown" so every destructive caller refuses instead of treating the
  // unprovable rows as absent and probing/guessing a host.
  const read: RegistryReadResult = isRegistryReadResult(entries)
    ? entries
    // A plain-array caller carries NO unreadable-row information (it never
    // had a snapshot to draw one from) — `unreadable:[]` here is a neutral
    // "none known", not a claim that none exist. Callers that hold a real
    // `loadRegistry()` snapshot MUST pass it whole (not `.entries`) for the
    // per-identity poison check below to see the unreadable rows at all.
    : { state: "ok", entries: [...entries], unreadable: [] };
  if (read.state === "unknown") {
    return {
      state: "unknown",
      reason: `registry read failed: ${read.reason}`,
    };
  }
  // A2 (PART A — resolver per-identity unreadable check, sol-2): for target
  // identity X, ask "is there an unreadable row that COULD be X?" — a
  // same-name/same-form TWIN — never "are there any unreadable rows at all?".
  // A hit poisons the resolution for X ONLY; every OTHER identity in this
  // same registry stays fully resolvable. This runs BEFORE the recorded/
  // discovered/missing branches below (A3 — the kill must not precede the
  // check): a valid row for X plus an unreadable twin of X must never reach
  // "recorded" and hand a caller a name to kill.
  const unreadableForTarget = unreadableRowsForTarget(target, read.unreadable);
  if (unreadableForTarget.length > 0) {
    const ids = unreadableForTarget
      .map((row) => (typeof row.id === "string" ? row.id : "<no id>"))
      .join(", ");
    return {
      state: "unknown",
      reason: `unreadable registry row(s) for this identity (row id: ${ids})`,
    };
  }
  const rows = read.entries;
  const nativeRows = registryEntriesForNativeTarget(target, rows);
  const tmuxRows = registryEntriesForLocalTmuxTarget(target, rows);
  const exactName = (rows: readonly RegistryEntry[]): string =>
    rows[0]?.tmuxSession ??
    (parseManagedSessionName(target)
      ? target
      : localSessionName(rows[0]?.id ?? target));
  if (nativeRows.length > 0 && tmuxRows.length > 0) {
    return { state: "ambiguous", candidates: ["local-native", "local-tmux"] };
  }
  if (nativeRows.length > 0) {
    return { state: "recorded", kind: "local-native", name: exactName(nativeRows) };
  }
  if (tmuxRows.length > 0) {
    return { state: "recorded", kind: "local-tmux", name: exactName(tmuxRows) };
  }
  // Discovery: probes may only run when NO persisted row exists.
  const probedName = parseManagedSessionName(target)
    ? target
    : localSessionName(target);
  const native = (probes.native ?? probeNativeSession)(probedName);
  const tmux = (probes.tmux ?? probeTmuxSession)(probedName);
  if (native === "unknown" || tmux === "unknown") {
    const failed = [
      ...(native === "unknown" ? ["native"] : []),
      ...(tmux === "unknown" ? ["tmux"] : []),
    ].join("+");
    return {
      state: "unknown",
      reason: `${failed} host probe failed for ${probedName}`,
    };
  }
  if (native === "live" && tmux === "live") {
    return { state: "ambiguous", candidates: ["local-native", "local-tmux"] };
  }
  if (native === "live") {
    return { state: "discovered", kind: "local-native", name: probedName };
  }
  if (tmux === "live") {
    return { state: "discovered", kind: "local-tmux", name: probedName };
  }
  return { state: "missing" };
}
