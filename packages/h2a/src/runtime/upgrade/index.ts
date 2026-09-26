/**
 * DEC-107 — EVO-8: CLI auto-upgrade. Three levels:
 *  (1) `h2a upgrade [--check]` — explicit, user-invoked;
 *  (2) `mcp-serve` boot version-check notice — non-blocking, cached, opt-out;
 *  (3) `mcp-serve --auto-upgrade` — self-install `@latest` at boot (the new
 *      version applies on the NEXT launch — a running Node process cannot
 *      replace its own binary in flight).
 *
 * Pure version logic + an injectable `UpgradeRuntime` (network/exec/clock/cache)
 * so everything is testable without npm or the network.
 *
 * Staged auto-upgrade path (no in-place `npm i -g`): fetch tarball to a staging
 * area under the global prefix (zero global mutation), install self-contained
 * under a staging prefix with `npm i -g --prefix` (nested deps + bin), probe
 * the staged binary version, load the staged native module, then atomic rename
 * swap with same-filesystem gate, rollback, and repairable marker. All side
 * effects go through `UpgradeRuntime`.
 *
 * The installed layout is NESTED and self-contained: an installed version
 * brings its own deps under
 * `<prefix>/lib/node_modules/@sentropic/h2a/node_modules/` (node-pty included).
 * The top level only holds other global packages. There is no dep-range gate:
 * the prepared autonomous folder is always switched.
 *
 * Prefix lock (v4): single-machine succession protocol. At most one holder:
 * atomic publication via `link(2)` (I1), a no-false-positive liveness predicate
 * (I3), a one-shot `SUCC(t)` succession chain (Lemmas B/C), token monotonicity
 * (I2). No age or mtime ever decides acquisition — `at` is diagnostic only
 * (I7). See the lock section below.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  fsyncSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export const H2A_CLI_PACKAGE = "@sentropic/h2a";
/** Re-check at most once per this window for the passive `--upgrade-check` notice. */
export const H2A_UPGRADE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Shorter throttle for `--auto-upgrade`: it is opt-in to *stay current*, so a
 * 24h notice cache must not make it lag a same-day release (the bug that left
 * agents on 0.39.0 after a restart). 1h still dedups a mass restart through the
 * shared per-root cache (only the first booting host hits the network).
 */
export const H2A_AUTO_UPGRADE_CHECK_TTL_MS = 60 * 60 * 1000;

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Parse a strict X.Y.Z triple, or undefined if it is not one. */
export function parseSemver(
  v: string
): { major: number; minor: number; patch: number } | undefined {
  const m = STRICT_SEMVER.exec(v.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** True iff `latest` is a strictly higher X.Y.Z than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

/**
 * The version of the running `@sentropic/h2a` (from its package.json).
 * Robust to a renamed install folder: the primary dist-relative path is tried
 * first, then ancestor package.json files whose `name` matches, so a backup
 * copy (`.h2a-prev-*`) still reports its own version instead of `0.0.0`.
 */
export function currentCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // dist/runtime/upgrade
    const candidates: string[] = [resolvePath(here, "..", "..", "..", "package.json")];
    let dir = here;
    for (let i = 0; i < 6; i++) {
      dir = dirname(dir);
      const p = join(dir, "package.json");
      if (!candidates.includes(p)) candidates.push(p);
    }
    let fallback: string | undefined;
    for (const pkgPath of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
        if (typeof pkg.version !== "string" || !pkg.version) continue;
        if (pkg.name === H2A_CLI_PACKAGE) return pkg.version;
        fallback ??= pkg.version;
      } catch {
        continue;
      }
    }
    return fallback ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Last auto-upgrade attempt outcome, persisted for exponential backoff. */
export type UpgradeThrottleOutcome = "ok" | "deferred-propagation" | "failed";

/** Optional throttle fields stored inside the upgrade cache entry. */
export interface UpgradeThrottle {
  readonly lastAttemptAt?: number;
  readonly consecutiveFailures?: number;
  readonly lastAttemptVersion?: string;
  readonly lastOutcome?: UpgradeThrottleOutcome;
}

export interface UpgradeCacheEntry extends UpgradeThrottle {
  readonly checkedAt: number;
  readonly latest?: string;
}

/** Bounded diagnostics record written per auto-upgrade attempt. */
export interface UpgradeDiagnosticsRecord {
  readonly [key: string]: unknown;
  readonly at?: number;
  readonly durationMs?: number;
  readonly prefix?: string;
  readonly current?: string;
  readonly target?: string;
  readonly outcome?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly status?: number | null;
  readonly signal?: string | null;
  readonly timeout?: boolean;
  readonly npmVersion?: string;
  readonly error?: string;
}

/** I/O the upgrade flow needs — injected so tests supply fakes. */
export interface UpgradeRuntime {
  /** Latest published version of `pkg`, or undefined on any failure. */
  fetchLatest(pkg: string): string | undefined;
  /** `npm i -g pkg@latest`; true on success. */
  runInstall(pkg: string): boolean;
  now(): number;
  readCache(path: string): UpgradeCacheEntry | undefined;
  writeCache(path: string, entry: UpgradeCacheEntry): void;
  /** Resolved global npm prefix (`npm prefix -g`). */
  resolvePrefix?(): string;
  /** Download the tarball for `pkg@version` into `destDir`; zero global mutation. */
  fetchTarball?(pkg: string, version: string, destDir: string): { ok: boolean; file?: string; error?: string };
  /** `npm i -g --prefix <stagingPrefix>` from a local tarball file; bounded. */
  stageInstall?(tarballOrSpec: string, stagingPrefix: string): { ok: boolean; error?: string };
  /** Run the staged binary `--version` and return the observed version. */
  probeStagedVersion?(stagingPrefix: string): string | undefined;
  /**
   * Load the native module (node-pty) from the staged self-contained package
   * dir before swap. Must fail when the native binding cannot load.
   * Injectable so tests can fake the native load without real binaries.
   */
  verifyStagedNative?(stagingPkgDir: string): { ok: boolean; error?: string };
  /** Version of the package at the global root (not PATH resolution). */
  readGlobalPkgVersion?(prefix: string): string | undefined;
  /** Rename current -> unique prev, staging -> place, plus repairable marker. */
  swapPackageDir?(prefix: string, stagingPkgDir: string, version: string): { ok: boolean; repaired?: boolean; error?: string; prevDir?: string | null };
  /** At boot: finish or roll back an interrupted swap via the marker. */
  completeRepairIfPending?(prefix: string): boolean;
  /**
   * Prefix-scoped exclusive lock (link-based succession protocol, v4).
   * The optional `hooks` parameter is test-only (deterministic succession
   * windows); production calls with one argument. Never reads the environment.
   */
  acquirePrefixLock?(prefix: string, hooks?: PrefixLockHooks): PrefixLockLease;
  /** Bounded per-attempt diagnostics file. */
  writeDiagnostics?(path: string, record: UpgradeDiagnosticsRecord): void;
}

function globalPkgDir(prefix: string): string {
  return join(prefix, "lib", "node_modules", H2A_CLI_PACKAGE);
}

function globalPkgDirFallback(prefix: string): string {
  return join(prefix, "node_modules", H2A_CLI_PACKAGE);
}

function resolveGlobalPkgDir(prefix: string): string {
  try {
    if (existsSync(globalPkgDir(prefix))) return globalPkgDir(prefix);
    if (existsSync(globalPkgDirFallback(prefix))) return globalPkgDirFallback(prefix);
  } catch {
    // fall through to canonical layout
  }
  return globalPkgDir(prefix);
}

/** Self-contained staged package dir produced by `npm i -g --prefix <stagingPrefix>`. */
function stagedPkgDirFromPrefix(stagingPrefix: string): string {
  return join(stagingPrefix, "lib", "node_modules", H2A_CLI_PACKAGE);
}

function swapMarkerPath(prefix: string): string {
  return join(prefix, "lib", "node_modules", ".h2a-upgrade-swap.json");
}

function compareParsed(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function satisfiesOneComparator(version: string, comp: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const c = comp.trim();
  if (c === "" || c === "*" || c.toLowerCase() === "x" || c.toLowerCase() === "latest") return true;
  if (c.startsWith("npm:")) return false;
  // Caret and tilde ranges.
  if (c.startsWith("^") || c.startsWith("~")) {
    const base = parseSemver(c.slice(1).trim().replace(/^v/, ""));
    if (!base) return false;
    if (compareParsed(v, base) < 0) return false;
    if (c.startsWith("^")) {
      if (base.major > 0) return v.major === base.major;
      if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
      return v.major === 0 && v.minor === 0 && v.patch === base.patch;
    }
    return v.major === base.major && v.minor === base.minor;
  }
  const m = /^(>=|<=|>|<|=|==?)?\s*v?(\d+\.\d+\.\d+)\s*$/.exec(c);
  if (m) {
    const op = m[1] ?? "";
    const base = parseSemver(m[2]);
    if (!base) return false;
    const cmp = compareParsed(v, base);
    switch (op) {
      case "":
      case "=":
      case "==":
        return cmp === 0;
      case ">":
        return cmp > 0;
      case ">=":
        return cmp >= 0;
      case "<":
        return cmp < 0;
      case "<=":
        return cmp <= 0;
      default:
        return false;
    }
  }
  // Partial wildcards like 1.x / 1.2.x: prefix match on numeric parts.
  const wild = /^v?(\d+)(?:\.(\d+|x|X))?(?:\.(\d+|x|X))?$/.exec(c);
  if (wild) {
    if (wild[2] === undefined) return v.major === Number(wild[1]);
    if (/^[xX]$/.test(wild[2])) return v.major === Number(wild[1]);
    if (wild[3] === undefined) return v.major === Number(wild[1]) && v.minor === Number(wild[2]);
    if (/^[xX]$/.test(wild[3])) return v.major === Number(wild[1]) && v.minor === Number(wild[2]);
    return false;
  }
  return false;
}

function satisfiesRange(version: string, range: string): boolean {
  const r = range.trim();
  if (r === "" || r === "*" || r === "latest") return true;
  // OR groups: any group may satisfy.
  const orGroups = r.split("||").map((s) => s.trim()).filter((s) => s.length > 0);
  if (orGroups.length > 1) return orGroups.some((g) => satisfiesRange(version, g));
  // AND group: comma or space separated comparators must all hold.
  const parts = r.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  if (parts.length === 1) return satisfiesOneComparator(version, parts[0]);
  return parts.every((p) => satisfiesOneComparator(version, p));
}

function readJsonIfExists(path: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Prefix lock (v4): single-machine succession protocol.
//
// At most one holder (proof sketch in the design notes):
// - I1 (atomic publication): a name appears only with complete, durable
//   content — tmp file (wx + write + fsync + close) then `link(2)`; a reader
//   sees ENOENT or a full record, so unreadable content means corruption
//   (fail closed), never a torn write. A FS without hard links fails closed.
// - I2 (monotonicity): a retired token never reappears; LOCK != g is forever.
// - I3 (predicate): `isCertainlyDead` has no false positive; death is stable.
// - I4: only (R) the live owner releasing, or (S) a successor that created its
//   SUCC then re-read LOCK == g, can remove LOCK == g.
// - I5: no SUCC targeting g is removed while LOCK == g.
// - I6: SUCC(t) always targets the same g (created after t judged dead).
// - I7: no age or mtime in any acquisition decision; `at` is diagnostic only.
//   Ages below are used solely for debris GC, never to break a lock.
//
// Lemma A (stability): while live holder P holds p, LOCK == p — removing it
// would require SUCC(p), which requires P certainly dead. Lemma B (unique
// successor): while LOCK == g the chain g -> r0 -> r1 ... is linear, so only
// the last link can be live. Lemma C (targeted unlink): a successor that read
// LOCK == g removes g, since no other live successor exists (Lemma B) and any
// earlier one would already have made LOCK != g (I2).
//
// H1: the prefix is on a single machine's local FS; `link(2)` is atomic and
// returns EEXIST when the name exists. H2: the recorded process runs the
// shared mutation (swap) for the whole critical section; children (npm) only
// touch a per-token private staging dir. H3: tokens are random (>= 96 bits)
// and never republished.

/**
 * R2 staleness-alert threshold. An upgrade held under the lock completes in seconds to
 * a few minutes (bounded tarball fetch + stage + atomic swap), so a lock far older than
 * that whose holder reads "live" ONLY for want of a comparable start time is worth
 * surfacing (a reused PID may be masking a dead holder). Set well above any legitimate
 * hold. It NEVER triggers a reclaim — purely diagnostic (I7: `at` informs, never decides).
 */
export const STALE_LOCK_ALERT_MS = 30 * 60 * 1000;
/** Acquire rounds before giving up (a retry means a rival won meanwhile). */
export const PREFIX_LOCK_MAX_ROUNDS = 3;
/** Succession chain depth before failing closed with a diagnostic. */
export const PREFIX_LOCK_MAX_CHAIN = 8;
/** Holder-only GC age for abandoned TMP files (debris, never a decision). */
export const PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS = 60 * 60 * 1000;
/** Fallback age for the residue sweep when no owner can be identified. */
export const UPGRADE_RESIDUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Why acquisition failed: live holder, undecidable owner, or an OS error. */
export type PrefixLockReason = "busy" | "dead-undecidable" | `error:${string}`;

/** Lease on the global prefix. `token` is present only when acquired. */
export interface PrefixLockLease {
  readonly acquired: boolean;
  release(): void;
  readonly reason?: PrefixLockReason;
  /** Winning token; present only when acquired. Never republished (I2). */
  readonly token?: string;
}

/** Observation window for one deterministic-test hook invocation. */
export interface PrefixLockHookContext {
  readonly prefix: string;
  readonly lockPath: string;
  /** File the window is about: LOCK for publish/unlink, SUCC(t) after election. */
  readonly path: string;
  /** Our fresh token being published (or held). */
  readonly token?: string;
  /** Succession target g (afterPublishSucc / retire windows). */
  readonly target?: string;
  readonly round: number;
  readonly depth: number;
}

/**
 * Critical-section hooks for deterministic tests ONLY. Passed as the 2nd
 * argument of `acquirePrefixLock(prefix, hooks)` by the test; never enabled
 * via environment or configuration (there is no env/config reader for them),
 * and production calls without hooks so every hook is a no-op at zero cost.
 */
export interface PrefixLockHooks {
  /** Just BEFORE the initial publish(LOCK) (round 0) — initial race window. */
  readonly beforePublishLock?: (ctx: PrefixLockHookContext) => void;
  /** Just AFTER a publish(SUCC(t)) success, BEFORE retire — unique successor elected. */
  readonly afterPublishSucc?: (ctx: PrefixLockHookContext) => void;
  /** In retire(), around the targeted unlink(LOCK) (removal-to-republish window). */
  readonly beforeRetireUnlink?: (ctx: PrefixLockHookContext) => void;
  readonly afterRetireUnlink?: (ctx: PrefixLockHookContext) => void;
}

interface LockIdent {
  readonly host: string;
  readonly boot: string | null;
  readonly ns: string | null;
  /** Reader's time namespace; gates proc-sourced start comparisons (B2). */
  readonly timeNs: string | null;
  readonly pid: number;
  readonly start: string | null;
}

interface LockRec extends LockIdent {
  readonly token: string;
  readonly target?: string;
  /** Diagnostic only, never decides (I7). */
  readonly at: number;
}

/** Tokens are hex (plus -/_ tolerance); anything else in a record is corruption. */
const LOCK_TOKEN_RE = /^[A-Za-z0-9_-]{12,128}$/;

function lockPathFor(prefix: string): string {
  return join(prefix, ".h2a-upgrade.lock");
}

function succPathFor(lockPath: string, t: string): string {
  return `${lockPath}.succ.${t}`;
}

function tmpPathFor(path: string, t: string): string {
  // C2: the publish tmp must never live in the `.succ.` namespace, even when
  // publishing a SUCC record. Derive it from the LOCK base so sweeps that
  // match real SUCC records never collect a tmp before its link(2).
  const idx = path.indexOf(".succ.");
  const base = idx >= 0 ? path.slice(0, idx) : path;
  return `${base}.tmp.${t}`;
}

function errnoOf(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.length > 0 ? code : "EIO";
}

function readHostId(): string {
  try {
    const v = readFileSync("/etc/machine-id", "utf8").trim();
    if (v) return v;
  } catch {
    // fall through to hostname
  }
  try {
    const h = hostname().trim();
    if (h) return h;
  } catch {
    // fall through to sentinel
  }
  return "unknown-host";
}

function readBootId(): string | null {
  try {
    const v = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (v) return v;
  } catch {
    // not Linux: fall through to sysctl below
  }
  // Outside Linux prefer the stable session UUID (TZ-independent) when present.
  try {
    const r = spawnSync("sysctl", ["-n", "kern.bootsessionuuid"], {
      encoding: "utf8",
      timeout: 2000,
      env: { ...process.env, LC_ALL: "C", TZ: "UTC0" }
    });
    const v = (r.stdout ?? "").trim();
    if (r.status === 0 && v) return v;
  } catch {
    // best-effort
  }
  try {
    const r = spawnSync("sysctl", ["-n", "kern.boottime"], {
      encoding: "utf8",
      timeout: 2000,
      env: { ...process.env, LC_ALL: "C", TZ: "UTC0" }
    });
    const v = (r.stdout ?? "").trim();
    if (r.status === 0 && v) return v;
  } catch {
    // best-effort
  }
  return null;
}

// B2 decomposition: distinguish "this platform has no namespaces" (a KNOWN fact —
// one space per host) from "the namespace exists but is unreadable" (a genuine
// unknown). Only the latter is null; the former is the sentinel "host" so same-host
// liveness stays decidable (macOS/Windows/BSD). `platform`/`readLink` are injected
// only by tests (macOS/Windows/no-/proc sims); production passes none.
//
// readPidNs is the CONSERVATIVE gate that decides reclaim at all: an unknown (null)
// pid namespace makes even a PID-absent holder undecidable, because "absent" in an
// unknown namespace proves nothing. Any Linux /proc failure → null, never a false
// "host" that could match a foreign namespace.
export function readPidNs(
  platform: NodeJS.Platform = process.platform,
  readLink: (p: string) => string = readlinkSync
): string | null {
  if (platform !== "linux") return "host";
  try {
    return readLink("/proc/self/ns/pid");
  } catch {
    return null; // the namespace exists here but is unreadable: genuine unknown
  }
}

// The reader's time namespace (Linux): /proc/<pid>/stat starttime is expressed
// relative to it, so two lanes in different time namespaces read different values
// for the same live process. timeNs is consulted ONLY to gate the start-time
// COMPARISON (the PID-present branch of livenessOf); the PID-absent incident branch
// never needs it. So this reader is SYMMETRIC with readPidNs on purpose — no ENOENT
// special-case: a genuinely masked /proc (e.g. gVisor exposing ns/pid but not
// ns/time while time namespaces are in use) must yield null (⇒ "start not
// comparable ⇒ live"), never a false "host" that would compare across time bases
// and risk a false death (the B-1 class). null here is safe and quiet, not a wedge.
export function readTimeNs(
  platform: NodeJS.Platform = process.platform,
  readLink: (p: string) => string = readlinkSync
): string | null {
  if (platform !== "linux") return "host";
  try {
    return readLink("/proc/self/ns/time");
  } catch {
    return null; // no readable time namespace: start times are not comparable
  }
}

// Trust /proc for start/state only when it maps to THIS process's pid namespace.
// Under `unshare --pid` without `--mount-proc`, `kill` targets the right process
// but `/proc/<pid>` describes another — a false start mismatch or zombie.
function procMapsToSelf(): boolean {
  try {
    return readlinkSync("/proc/self") === String(process.pid);
  } catch {
    return false;
  }
}

/**
 * Process start identity, prefixed by its source ("proc:" from Linux /proc
 * field 22, "ps:" from `ps lstart`). The prefix is part of the stored value
 * so a reader using a different source never concludes "dead" from a
 * format/TZ-fragile comparison (C1).
 */
// `platform`/`mapsToSelf` are injected only by tests (mis-mapped-/proc / non-Linux
// sims); production passes none.
export function procStartInfo(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  mapsToSelf: () => boolean = procMapsToSelf
): { state?: string; start?: string } | undefined {
  // B3: under Linux a mis-mapped /proc (unshare --pid without --mount-proc) makes
  // BOTH /proc AND `ps` (procps also reads /proc/<pid>) describe a process from
  // another namespace — an untrusted start that can falsely differ and yield a false
  // death ⇒ two holders (I3). Treat it as undatable (⇒ live), never fall back to the
  // same bad /proc. Off Linux `ps` reads the real process table, so it stays valid.
  if (platform === "linux" && !mapsToSelf()) return undefined;
  if (mapsToSelf()) {
    try {
      const s = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = s.lastIndexOf(")");
      if (close >= 0) {
        const after = s.slice(close + 1).trim().split(/\s+/);
        // after[0] is state (field 3); after[19] is starttime (field 22).
        if (after.length >= 20 && after[0] && after[19]) {
          return { state: after[0], start: `proc:${after[19]}` };
        }
      }
    } catch {
      // no /proc for this pid: fall through to ps
    }
  }
  try {
    const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, LC_ALL: "C", TZ: "UTC0" }
    });
    const v = (r.stdout ?? "").trim();
    if (r.status === 0 && v) return { start: `ps:${v}` };
  } catch {
    // best-effort
  }
  return undefined;
}

function startSource(s: string): "proc" | "ps" | "legacy" {
  if (s.startsWith("proc:")) return "proc";
  if (s.startsWith("ps:")) return "ps";
  return "legacy";
}

interface SelfIdent extends LockIdent {
  readonly pid: number;
}

let ME_CACHE: SelfIdent | undefined;

/** This process's identity, computed once and memoized. */
function me(): SelfIdent {
  ME_CACHE ??= {
    host: readHostId(),
    boot: readBootId(),
    ns: readPidNs(),
    timeNs: readTimeNs(),
    pid: process.pid,
    start: procStartInfo(process.pid)?.start ?? null
  };
  return ME_CACHE;
}

/** Fresh random token, >= 96 bits, never republished (H3). */
function newToken(): string {
  return randomBytes(16).toString("hex");
}

function makeLockRec(token: string, target?: string): LockRec {
  const self = me();
  return {
    host: self.host,
    boot: self.boot,
    ns: self.ns,
    timeNs: self.timeNs,
    pid: self.pid,
    start: self.start,
    token,
    ...(target !== undefined ? { target } : {}),
    at: Date.now()
  };
}

function parseLockRec(raw: unknown): LockRec {
  if (typeof raw !== "object" || raw === null) throw new Error("bad lock record");
  const o = raw as Record<string, unknown>;
  const { host, boot, ns, timeNs, pid, start, token, target, at } = o;
  // timeNs is a required field like host/boot/ns/pid/start: an absent field is a
  // malformed record → corrupt → fail-closed. No back-compat exception is carved
  // for a "v4 without timeNs" — the redesign was never published, so no such lock
  // exists outside fixtures (kept in step with makeLockRec). The VALUE may be null
  // (genuine unknown time namespace); the liveness guard then treats the proc start
  // as undatable ⇒ "live" (never reclaim, never a false death), not undecidable.
  if (typeof host !== "string" || host.length === 0) throw new Error("bad host");
  if (boot !== null && typeof boot !== "string") throw new Error("bad boot");
  if (ns !== null && typeof ns !== "string") throw new Error("bad ns");
  if (timeNs !== null && typeof timeNs !== "string") throw new Error("bad timeNs");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) throw new Error("bad pid");
  if (start !== null && typeof start !== "string") throw new Error("bad start");
  if (typeof token !== "string" || !LOCK_TOKEN_RE.test(token)) throw new Error("bad token");
  if (target !== undefined && typeof target !== "string") throw new Error("bad target");
  if (typeof at !== "number" || !Number.isFinite(at)) throw new Error("bad at");
  return {
    host,
    boot,
    ns,
    timeNs,
    pid,
    start,
    token,
    ...(target !== undefined ? { target } : {}),
    at
  };
}

/** opus `read`: ENOENT -> absent, anything else unreadable -> corrupt (I1). */
function readLockRecord(path: string): LockRec | "absent" | "corrupt" {
  try {
    return parseLockRec(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    return (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? "absent" : "corrupt";
  }
}

type PublishStatus = { status: "ok" } | { status: "exists" } | { status: "retry" } | { status: "error"; code: string };

/**
 * opus `publish` (I1): a name appears only with complete, durable content.
 * Write tmp (wx + byte-count-checked write + fsync + close), then `link(2)`;
 * EEXIST -> "exists", ENOENT at link -> "retry" (tmp reaped before link),
 * any other failure -> "error" with the errno (no hard links -> fail closed).
 * The tmp never contains `.succ.` (C2).
 */
function publishLockRecord(path: string, rec: LockRec): PublishStatus {
  const tmp = tmpPathFor(path, rec.token);
  try {
    const data = JSON.stringify(rec);
    const fd = openSync(tmp, "wx", 0o644);
    let truncated = false;
    try {
      const written = writeSync(fd, data);
      if (written !== Buffer.byteLength(data)) {
        truncated = true;
      } else {
        fsyncSync(fd);
      }
    } finally {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
    if (truncated) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort
      }
      return { status: "error", code: "ENOSPC" };
    }
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort
    }
    return { status: "error", code: errnoOf(e) };
  }
  try {
    linkSync(tmp, path);
    return { status: "ok" };
  } catch (e) {
    const code = errnoOf(e);
    if (code === "EEXIST") return { status: "exists" };
    if (code === "ENOENT") return { status: "retry" };
    return { status: "error", code };
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort
    }
  }
}

type Liveness = "dead" | "live" | "undecidable";

/** Injected only by tests (platform / start-probe sims); production passes none. */
interface LivenessDeps {
  readonly platform?: NodeJS.Platform;
  readonly probe?: (pid: number) => { state?: string; start?: string } | undefined;
}

/**
 * A "live" verdict is `datable` when it came from a CONFIRMED, comparable start
 * (same source, known equal time namespace) — the holder is provably the recorded
 * process. It is NOT datable when "live" was reached only because the start was
 * undatable (source mismatch, unknown/differing time namespace, or no start) — there
 * a reused PID could be masking a dead holder. This bit is used solely to target the
 * staleness alert (R2); it must never influence a reclaim decision.
 */
interface LivenessInfo {
  readonly verdict: Liveness;
  readonly datable: boolean;
}

/**
 * Single liveness classifier. `livenessOf` and `isCertainlyDead` are exactly its
 * "verdict"/"dead" arm, and the R2 staleness alert reads its `datable` bit, so none
 * of them can drift from this one decision. Never derives "dead" from a fragile
 * comparison: a source mismatch or an unknown/differing time namespace both yield a
 * safe "live" (undatable), and a corrupt "legacy" start yields "undecidable" (C1).
 */
function classifyLiveness(r: LockRec, self: SelfIdent, deps: LivenessDeps = {}): LivenessInfo {
  const platform = deps.platform ?? process.platform;
  const probe = deps.probe ?? procStartInfo;
  if (r.host !== self.host) return { verdict: "undecidable", datable: false }; // other machine
  // B1: only a Linux boot_id is a stable, trustworthy boot identity, so a difference
  // there is a previous boot ⇒ dead. Off Linux a boot difference must NOT short-circuit
  // to undecidable (that wedged a Mac rebooted mid-lock forever); fall through to
  // kill(0) + the start comparison, which decide the incident class on any platform.
  if (r.boot && self.boot && r.boot !== self.boot && platform === "linux") {
    return { verdict: "dead", datable: false };
  }
  // An unreadable namespace on EITHER side is a genuine unknown — two records with a
  // null namespace must never be treated as co-located (null-equality).
  if (r.ns === null || self.ns === null) return { verdict: "undecidable", datable: false };
  if (r.ns !== self.ns) return { verdict: "undecidable", datable: false }; // other, known ns
  // From here the namespace is known AND shared, so a PID's absence is conclusive.
  let exists = false;
  try {
    process.kill(r.pid, 0);
    exists = true;
  } catch (e) {
    const code = errnoOf(e);
    // PID absent in a known, shared namespace ⇒ dead, with certainty, no start time.
    if (code === "ESRCH") return { verdict: "dead", datable: false };
    if (code === "EPERM") exists = true; // exists, no permission: keep checking
    else return { verdict: "undecidable", datable: false };
  }
  const p = probe(r.pid); // undefined when unknown
  if (p?.state === "Z") return { verdict: "dead", datable: false }; // zombie never runs again
  if (r.start !== null && p?.start !== undefined) {
    const rSrc = startSource(r.start);
    const pSrc = startSource(p.start);
    // A "legacy" (malformed, pre-source-prefix) start is not a trustworthy value ⇒
    // undecidable (fail closed). Any other source mismatch (proc vs ps) is simply not
    // comparable ⇒ undatable ⇒ live.
    if (rSrc === "legacy" || pSrc === "legacy") return { verdict: "undecidable", datable: false };
    if (rSrc !== pSrc) return { verdict: "live", datable: false };
    // proc starttime is expressed relative to the reader's time namespace, so a
    // proc-sourced comparison is only meaningful when both time namespaces are KNOWN and
    // EQUAL. Otherwise the recorded start is UNDATABLE ⇒ "live" — never reclaim, never a
    // false death, never a false M-2 alarm. This never wedges an incident: the PID-absent
    // branch concluded "dead" without a start. The only cost is a genuinely-reused PID
    // left alive until it exits — rare, bounded, and surfaced by the R2 staleness alert.
    // ps starttime is absolute wall-clock (TZ-normalised) and needs no gate.
    if (rSrc === "proc" && (r.timeNs === null || self.timeNs === null || r.timeNs !== self.timeNs)) {
      return { verdict: "live", datable: false };
    }
    return p.start !== r.start
      ? { verdict: "dead", datable: true } // PID reused (a confirmed different start)
      : { verdict: "live", datable: true }; // same, confirmed process
  }
  // Present but with an undatable start ⇒ live: never reclaim a live-or-unknown holder.
  return { verdict: exists ? "live" : "undecidable", datable: false };
}

export function livenessOf(r: LockRec, self: SelfIdent, deps: LivenessDeps = {}): Liveness {
  return classifyLiveness(r, self, deps).verdict;
}

/** No false positive: true implies certainly dead; any doubt is alive (I3). */
function isCertainlyDead(r: LockRec): boolean {
  return classifyLiveness(r, me()).verdict === "dead";
}

function lockDenied(reason: PrefixLockReason): PrefixLockLease {
  return { acquired: false, release: () => {}, reason };
}

function invokeLockHook(
  fn: ((ctx: PrefixLockHookContext) => void) | undefined,
  ctx: PrefixLockHookContext
): void {
  if (!fn) return;
  try {
    fn(ctx);
  } catch {
    // Observation-only: a test hook must never break the protocol.
  }
}

/** opus `acquirePrefixLock`, plus M5 reasons and test-only critical hooks. */
export function acquirePrefixLock(prefix: string, hooks: PrefixLockHooks = {}): PrefixLockLease {
  const lockPath = lockPathFor(prefix);
  try {
    mkdirSync(prefix, { recursive: true });
  } catch (e) {
    return lockDenied(`error:${errnoOf(e)}`);
  }
  const self = me();
  for (let round = 0; round < PREFIX_LOCK_MAX_ROUNDS; round++) {
    if (round === 0) {
      invokeLockHook(hooks.beforePublishLock, { prefix, lockPath, path: lockPath, round, depth: 0 });
    }
    const tok = newToken();
    const pub = publishLockRecord(lockPath, makeLockRec(tok));
    if (pub.status === "ok") return makeLease(prefix, lockPath, tok);
    if (pub.status === "error") return lockDenied(`error:${pub.code}`);
    if (pub.status === "retry") continue;
    const cur = readLockRecord(lockPath);
    if (cur === "absent") continue; // released meanwhile
    if (cur === "corrupt") return lockDenied("dead-undecidable"); // fail closed
    const live = livenessOf(cur, self);
    if (live !== "dead") return lockDenied(live === "live" ? "busy" : "dead-undecidable");
    const next = succeedDeadToken(prefix, lockPath, cur.token, hooks, round);
    if (next !== "retry") return next;
  }
  return lockDenied("busy");
}

/**
 * opus `succeed`: the owner of g is certainly dead. Walk the one-shot chain
 * SUCC(g) -> SUCC(r0) -> ...; publishing a link elects the sole live
 * successor (Lemma B). "retry" means the chain settled meanwhile (re-read).
 */
function succeedDeadToken(
  prefix: string,
  lockPath: string,
  g: string,
  hooks: PrefixLockHooks,
  round: number
): PrefixLockLease | "retry" {
  const self = me();
  let t = g;
  for (let depth = 0; depth < PREFIX_LOCK_MAX_CHAIN; depth++) {
    const tok = newToken();
    const pub = publishLockRecord(succPathFor(lockPath, t), makeLockRec(tok, g));
    if (pub.status === "ok") {
      invokeLockHook(hooks.afterPublishSucc, {
        prefix,
        lockPath,
        path: succPathFor(lockPath, t),
        token: tok,
        target: g,
        round,
        depth
      });
      return retireDeadToken(prefix, lockPath, g, hooks, round, depth);
    }
    if (pub.status === "error") return lockDenied(`error:${pub.code}`);
    if (pub.status === "retry") return "retry";
    const s = readLockRecord(succPathFor(lockPath, t));
    if (s === "absent") return "retry"; // chain already settled
    if (s === "corrupt" || s.target !== g) return lockDenied("dead-undecidable");
    const live = livenessOf(s, self);
    if (live !== "dead") return lockDenied(live === "live" ? "busy" : "dead-undecidable");
    t = s.token; // it died: succeed it
  }
  // Chain too deep: fail closed (diagnostic-only; no sink at this layer).
  return lockDenied("dead-undecidable");
}

/**
 * opus `retire`: targeted removal (S) of exactly g (Lemma C), then purge the
 * now-inert SUCC files targeting g (I5), then publish a fresh token.
 */
function retireDeadToken(
  prefix: string,
  lockPath: string,
  g: string,
  hooks: PrefixLockHooks,
  round: number,
  depth: number
): PrefixLockLease | "retry" {
  const cur = readLockRecord(lockPath);
  if (cur === "corrupt") return lockDenied("dead-undecidable"); // keep our SUCC: fail closed
  if (cur !== "absent" && cur.token === g) {
    invokeLockHook(hooks.beforeRetireUnlink, {
      prefix,
      lockPath,
      path: lockPath,
      target: g,
      round,
      depth
    });
    // Lemma C (targeted removal), hardened: re-read LOCK as the LAST step before the
    // unlink and remove it ONLY while it is STILL exactly g. Successor uniqueness
    // (Lemma B) + monotonicity (I2) prove LOCK cannot legally change from g under this
    // sole successor, so in production this re-read always confirms g. It is the
    // defense-in-depth that also holds under manual intervention / a fresh owner /
    // corruption appearing in this window: such a LOCK bears a different token (or is
    // corrupt) and is NEVER deleted — we only ever unlink a lock we still own.
    const now = readLockRecord(lockPath);
    if (now === "corrupt") return lockDenied("dead-undecidable"); // keep our SUCC: fail closed
    if (now !== "absent" && now.token !== g) {
      // A different owner appeared in the window: our SUCC(g) is inert. Purge it and
      // retry against the new LOCK — never delete a lock we do not own.
      purgeSuccession(prefix, lockPath, g);
      return "retry";
    }
    if (now !== "absent") {
      // now.token === g: safe to remove exactly g.
      let unlinkCode: string | undefined;
      try {
        unlinkSync(lockPath); // (S) removes exactly g (Lemma C)
      } catch (e) {
        unlinkCode = errnoOf(e);
      }
      invokeLockHook(hooks.afterRetireUnlink, {
        prefix,
        lockPath,
        path: lockPath,
        target: g,
        round,
        depth
      });
      // LOCK != g not established: keep our SUCC file, fail closed.
      if (unlinkCode !== undefined && unlinkCode !== "ENOENT") {
        return lockDenied(`error:${unlinkCode}`);
      }
    }
    // now === "absent": g already removed by someone else; fall through to publish.
  }
  // From here LOCK != g forever (I2): every SUCC targeting g is inert.
  purgeSuccession(prefix, lockPath, g); // unlink SUCC files whose target === g
  const tok = newToken();
  const pub = publishLockRecord(lockPath, makeLockRec(tok));
  if (pub.status === "ok") return makeLease(prefix, lockPath, tok);
  if (pub.status === "exists" || pub.status === "retry") return "retry";
  return lockDenied(`error:${pub.code}`);
}

/**
 * opus `lease`: conditional release — unlink only when LOCK == tok (I2/Lemma
 * A: while we live, LOCK == tok is stable). Runs on process exit too.
 */
function makeLease(prefix: string, lockPath: string, token: string): PrefixLockLease {
  let done = false;
  const release = (): void => {
    if (done) return;
    done = true;
    try {
      process.off("exit", release);
    } catch {
      // best-effort
    }
    const cur = readLockRecord(lockPath);
    if (cur !== "absent" && cur !== "corrupt" && cur.token === token) {
      try {
        unlinkSync(lockPath); // (R) safe: LOCK == tok stable while we live
      } catch {
        // best-effort
      }
    }
    // else: lock lost — unreachable under the invariants (Lemma A).
  };
  try {
    process.on("exit", release);
  } catch {
    // best-effort
  }
  collectLockDebris(prefix, lockPath, token); // holder-only GC (I5-safe)
  return { acquired: true, release, token };
}

/** Unlink SUCC files whose target === g (called only when LOCK != g can hold). */
function purgeSuccession(prefix: string, lockPath: string, g: string): void {
  let names: string[];
  try {
    names = readdirSync(prefix);
  } catch {
    return;
  }
  const base = basename(lockPath);
  for (const n of names) {
    if (!n.startsWith(`${base}.succ.`)) continue;
    if (n.includes(".tmp.")) continue; // C2: never treat a tmp as a SUCC record
    const full = join(prefix, n);
    const rec = readLockRecord(full);
    if (rec !== "absent" && rec !== "corrupt" && rec.target === g) {
      try {
        unlinkSync(full);
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Holder-only GC (I5-safe: our token is the current LOCK value, so SUCC files
 * targeting anything else are inert; TMP files are never lock state).
 */
function collectLockDebris(prefix: string, lockPath: string, token: string): void {
  let names: string[];
  try {
    names = readdirSync(prefix);
  } catch {
    return;
  }
  const base = basename(lockPath);
  const now = Date.now();
  for (const n of names) {
    const full = join(prefix, n);
    if (n.startsWith(`${base}.succ.`) && !n.includes(".tmp.")) {
      const rec = readLockRecord(full);
      if (rec !== "absent" && rec !== "corrupt" && rec.target !== token) {
        try {
          unlinkSync(full);
        } catch {
          // best-effort
        }
      }
    } else if (n.startsWith(base) && n.includes(".tmp.")) {
      // TMP debris (including legacy `.succ.*.tmp.*` names), never lock state.
      try {
        const age = now - statSync(full).mtimeMs;
        if (age > PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS) {
          try {
            unlinkSync(full);
          } catch {
            // best-effort
          }
        }
      } catch {
        // best-effort: leave what cannot be stated
      }
    }
  }
}

/** True when the path is older than the threshold; false when unstated. */
function isOlderThan(path: string, now: number, maxAgeMs: number): boolean {
  try {
    return now - statSync(path).mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
}

function pidFromAttemptName(name: string): number | undefined {
  const m = /^\.h2a-upgrade-(?:staging|tarball)-(\d+)-/.exec(name);
  if (!m) return undefined;
  const pid = Number(m[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function pidFromPrevName(name: string): number | undefined {
  // h2a.h2a-prev-<version>-<pid>-<rand>
  const parts = name.split("-");
  if (parts.length < 2) return undefined;
  const pid = Number(parts[parts.length - 2]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * Residue removal rule (debris only, never a lock decision): a live owner is
 * never touched; a certainly-dead owner (ESRCH) is removed; otherwise only
 * entries older than the threshold go.
 */
function shouldRemoveResidue(path: string, pid: number | undefined, now: number): boolean {
  if (pid !== undefined) {
    try {
      process.kill(pid, 0);
      return false; // alive (or un-signalable but present): keep
    } catch (e) {
      const code = errnoOf(e);
      if (code === "ESRCH") return true; // certainly dead
      if (code === "EPERM") return false; // exists: keep
    }
  }
  return isOlderThan(path, now, UPGRADE_RESIDUE_MAX_AGE_MS);
}

/**
 * M4 accumulation sweep, run UNDER the prefix lock after a verified swap:
 * attempt staging and tarball dirs, previous-version backups, orphaned LOCK
 * succ and tmp files, and the no-cachePath prefix log. Never touches a live
 * attempt's staging.
 */
function sweepUpgradeResidues(prefix: string, lockToken?: string): void {
  const now = Date.now();
  const lockPath = lockPathFor(prefix);
  const base = basename(lockPath);
  let lockTok = lockToken;
  if (lockTok === undefined) {
    const cur = readLockRecord(lockPath);
    if (cur !== "absent" && cur !== "corrupt") lockTok = cur.token;
  }
  try {
    for (const n of readdirSync(prefix)) {
      const full = join(prefix, n);
      try {
        if (n.startsWith(".h2a-upgrade-staging-") || n.startsWith(".h2a-upgrade-tarball-")) {
          if (shouldRemoveResidue(full, pidFromAttemptName(n), now)) rmSyncSafe(full);
        } else if (n.startsWith(base) && n.includes(".tmp.")) {
          if (isOlderThan(full, now, PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS)) {
            try {
              unlinkSync(full);
            } catch {
              // best-effort
            }
          }
        } else if (n.startsWith(`${base}.succ.`) && !n.includes(".tmp.")) {
          const rec = readLockRecord(full);
          if (rec !== "absent" && rec !== "corrupt" && rec.target !== lockTok) {
            try {
              unlinkSync(full);
            } catch {
              // best-effort
            }
          }
        }
      } catch {
        // best-effort per entry
      }
    }
  } catch {
    // best-effort
  }
  // No-cachePath boot log lives under the prefix: sweep it like other residues.
  try {
    const prefixLog = join(prefix, "h2a-upgrade.log");
    if (isOlderThan(prefixLog, now, UPGRADE_RESIDUE_MAX_AGE_MS)) {
      try {
        unlinkSync(prefixLog);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
  try {
    const parent = dirname(resolveGlobalPkgDir(prefix));
    for (const n of readdirSync(parent)) {
      if (!n.startsWith("h2a.h2a-prev-")) continue;
      const full = join(parent, n);
      try {
        if (shouldRemoveResidue(full, pidFromPrevName(n), now)) rmSyncSafe(full);
      } catch {
        // best-effort per entry
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Human-readable lock failure for `h2a upgrade` / boot diagnostics, so a
 * permission error is never reported as "another installation in progress".
 */
export function describeLockReason(reason: PrefixLockLease["reason"]): string {
  if (reason === undefined || reason === "busy") return "another installation in progress";
  if (reason === "dead-undecidable") {
    return "lock held by an owner whose liveness cannot be decided; manual intervention required (if PID absent on this host, remove the lock and its .succ. files)";
  }
  const code = reason.slice("error:".length);
  // Error-specific hint: only permission-class codes warrant the "check permissions"
  // advice; other codes get an accurate, non-misleading message.
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return `cannot access the global prefix (${code}); check directory permissions`;
  }
  if (code === "ENOSPC") {
    return "cannot write to the global prefix (ENOSPC); no space left on device";
  }
  return `cannot access the global prefix (${code})`;
}

export const defaultUpgradeRuntime: UpgradeRuntime = {
  fetchLatest(pkg) {
    try {
      // Bounded, but realistic: `npm view` routinely takes ~5s, so the old 4s
      // timeout fired every time and SILENTLY broke every upgrade check (the
      // global + all hosts stayed pinned — DEC-114). 15s covers a slow registry;
      // the boot check is cached (24h TTL) so this network call is rare.
      const r = spawnSync("npm", ["view", pkg, "version"], { encoding: "utf8", timeout: 15_000 });
      if (r.status !== 0) return undefined;
      const v = r.stdout.trim();
      return parseSemver(v) ? v : undefined;
    } catch {
      return undefined;
    }
  },
  runInstall(pkg) {
    try {
      const r = spawnSync("npm", ["i", "-g", `${pkg}@latest`], { stdio: "ignore", timeout: 120_000 });
      return r.status === 0;
    } catch {
      return false;
    }
  },
  now() {
    return Date.now();
  },
  readCache(path) {
    try {
      if (!existsSync(path)) return undefined;
      return JSON.parse(readFileSync(path, "utf8")) as UpgradeCacheEntry;
    } catch {
      return undefined;
    }
  },
  writeCache(path, entry) {
    // Atomic replace: write a sibling temp then rename, so a concurrent reader (or a
    // crash mid-write) never observes a half-written, unparseable cache file.
    const tmp = `${path}.tmp.${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      renameSync(tmp, path);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort
      }
    }
  },
  resolvePrefix() {
    try {
      const r = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", timeout: 10_000 });
      if (r.status === 0) {
        const p = r.stdout.trim();
        if (p) return p;
      }
    } catch {
      // fall through to fallback
    }
    return "/usr/local";
  },
  fetchTarball(pkg, version, destDir) {
    try {
      mkdirSync(destDir, { recursive: true });
      const spec = `${pkg}@${version}`;
      const r = spawnSync("npm", ["pack", spec, "--pack-destination", destDir], {
        encoding: "utf8",
        timeout: 60_000
      });
      if (r.status !== 0) {
        const err = (r.stderr || r.stdout || "npm pack failed").trim().slice(0, 500);
        return { ok: false, error: `npm pack failed: ${err}` };
      }
      let files: string[] = [];
      try {
        files = readdirSync(destDir).filter((f) => f.endsWith(".tgz"));
      } catch {
        return { ok: false, error: "tarball dir unreadable" };
      }
      if (files.length === 0) return { ok: false, error: "tarball not found" };
      const pick = files.find((f) => f.includes(version)) ?? files.sort().pop()!;
      return { ok: true, file: join(destDir, pick) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  stageInstall(tarballOrSpec, stagingPrefix) {
    try {
      mkdirSync(stagingPrefix, { recursive: true });
      // Self-contained global-style staging: produces
      // <stagingPrefix>/lib/node_modules/@sentropic/h2a with nested deps + bin.
      const r = spawnSync("npm", ["i", "-g", "--prefix", stagingPrefix, tarballOrSpec], {
        encoding: "utf8",
        timeout: 180_000
      });
      if (r.status === 0) return { ok: true };
      const err = (r.stderr || r.stdout || "npm install failed").trim().slice(0, 1000);
      return { ok: false, error: `npm install failed: ${err}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  probeStagedVersion(stagingPrefix) {
    try {
      const stagedPkgDir = stagedPkgDirFromPrefix(stagingPrefix);
      const candidates: Array<{ file: string; js: boolean }> = [
        { file: join(stagingPrefix, "bin", "h2a"), js: false },
        { file: join(stagedPkgDir, "dist", "bin.js"), js: true },
        // Legacy flat staging layout — best-effort fallback only.
        { file: join(stagingPrefix, "node_modules", ".bin", "h2a"), js: false },
        { file: join(stagingPrefix, "node_modules", H2A_CLI_PACKAGE, "dist", "bin.js"), js: true }
      ];
      for (const c of candidates) {
        try {
          if (!existsSync(c.file)) continue;
          const r = c.js
            ? spawnSync(process.execPath, [c.file, "--version"], { encoding: "utf8", timeout: 15_000 })
            : spawnSync(c.file, ["--version"], { encoding: "utf8", timeout: 15_000 });
          if (r.status === 0) {
            const v = (r.stdout || "").trim();
            if (parseSemver(v)) return v;
          }
        } catch {
          continue;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  },
  verifyStagedNative(stagingPkgDir) {
    try {
      const nativePath = join(stagingPkgDir, "node_modules", "node-pty");
      // `h2a --version` does NOT load node-pty, so a staged dir can report the
      // right version yet break `h2a run` later. Load the staged native module
      // before swap and fail closed when it cannot load.
      const r = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(nativePath)})`], {
        encoding: "utf8",
        timeout: 15_000
      });
      if (r.status === 0) return { ok: true };
      const err = (r.stderr || r.stdout || "native module load failed").trim().slice(0, 500);
      return { ok: false, error: `node-pty load failed: ${err}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  readGlobalPkgVersion(prefix) {
    const candidates = [
      join(prefix, "lib", "node_modules", H2A_CLI_PACKAGE, "package.json"),
      join(prefix, "node_modules", H2A_CLI_PACKAGE, "package.json")
    ];
    for (const p of candidates) {
      try {
        if (!existsSync(p)) continue;
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
        if (typeof pkg.version === "string" && pkg.version) return pkg.version;
      } catch {
        continue;
      }
    }
    return undefined;
  },
  swapPackageDir(prefix, stagingPkgDir, version) {
    try {
      const currentDir = resolveGlobalPkgDir(prefix);
      const marker = swapMarkerPath(prefix);
      let currentVersion = "unknown";
      try {
        const pkg = readJsonIfExists(join(currentDir, "package.json"));
        if (pkg && typeof pkg["version"] === "string") currentVersion = pkg["version"] as string;
      } catch {
        // keep unknown suffix
      }
      if (!existsSync(stagingPkgDir)) return { ok: false, error: "staging package dir missing" };
      // Same-filesystem gate BEFORE the first rename: both parents must share st_dev.
      try {
        mkdirSync(dirname(currentDir), { recursive: true });
      } catch {
        // best-effort; stat below decides
      }
      try {
        const currentParentDev = statSync(dirname(currentDir)).dev;
        const stagingParentDev = statSync(dirname(stagingPkgDir)).dev;
        if (currentParentDev !== stagingParentDev) return { ok: false, error: "cross-device" };
      } catch {
        return { ok: false, error: "cross-device" };
      }
      if (!existsSync(currentDir)) {
        // Nothing to back up: direct move into place.
        try {
          mkdirSync(dirname(currentDir), { recursive: true });
          writeFileSync(
            marker,
            `${JSON.stringify({ phase: "started", prefix, currentDir, prevDir: null, stagingPkgDir, version, at: Date.now(), pid: process.pid }, null, 2)}\n`,
            "utf8"
          );
          renameSync(stagingPkgDir, currentDir);
          try {
            unlinkSync(marker);
          } catch {
            // best-effort
          }
          return { ok: true, repaired: false, prevDir: null };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      // Unique prev dir per attempt so concurrent lanes never share one artifact.
      const prevDir = `${currentDir}.h2a-prev-${currentVersion}-${process.pid}-${randomUUID().slice(0, 8)}`;
      let backedUp = false;
      try {
        mkdirSync(dirname(currentDir), { recursive: true });
        writeFileSync(
          marker,
          `${JSON.stringify({ phase: "started", prefix, currentDir, prevDir, stagingPkgDir, version, at: Date.now(), pid: process.pid }, null, 2)}\n`,
          "utf8"
        );
        if (existsSync(prevDir)) rmSyncSafe(prevDir);
        renameSync(currentDir, prevDir);
        backedUp = true;
        writeFileSync(
          marker,
          `${JSON.stringify({ phase: "backed-up", prefix, currentDir, prevDir, stagingPkgDir, version, at: Date.now(), pid: process.pid }, null, 2)}\n`,
          "utf8"
        );
        renameSync(stagingPkgDir, currentDir);
        // Swap complete: remove the marker so a crash AFTER success cannot be
        // mistaken for an interrupted swap on the next boot.
        try {
          unlinkSync(marker);
        } catch {
          // best-effort
        }
        return { ok: true, repaired: false, prevDir };
      } catch (e) {
        if (backedUp) {
          // Roll back the first rename so the install is never left broken.
          try {
            renameSync(prevDir, currentDir);
            try {
              unlinkSync(marker);
            } catch {
              // best-effort
            }
          } catch {
            // Rollback failed: keep the marker so repair can finish it.
          }
        }
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  completeRepairIfPending(prefix) {
    // LIMIT: when `current` is missing, this repair code (module worker +
    // bin/h2a) lives inside the missing folder, so this function is reachable
    // only while `current` exists. It is NOT a safety mechanism; PREVENTION
    // (same-filesystem gate, rollback, exclusive lock) protects the install.
    // Repair only finishes a marker left by a crashed swap.
    try {
      const marker = swapMarkerPath(prefix);
      if (!existsSync(marker)) return false;
      let state: Record<string, unknown>;
      try {
        state = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
      } catch {
        return false;
      }
      const currentDir = typeof state["currentDir"] === "string" ? (state["currentDir"] as string) : resolveGlobalPkgDir(prefix);
      const prevDir = typeof state["prevDir"] === "string" ? (state["prevDir"] as string) : null;
      const stagingPkgDir = typeof state["stagingPkgDir"] === "string" ? (state["stagingPkgDir"] as string) : null;
      const phase = typeof state["phase"] === "string" ? (state["phase"] as string) : "";
      const currentExists = existsSync(currentDir);
      const prevExists = prevDir ? existsSync(prevDir) : false;
      const stagingExists = stagingPkgDir ? existsSync(stagingPkgDir) : false;
      // Interrupted before any rename: nothing to finish.
      if (phase === "started" && currentExists) {
        try {
          unlinkSync(marker);
        } catch {
          // best-effort
        }
        return true;
      }
      // Missing live dir: finish the pending move or roll back the backup.
      if (!currentExists && prevExists) {
        try {
          if (stagingExists && stagingPkgDir) {
            renameSync(stagingPkgDir, currentDir);
          } else if (prevDir) {
            renameSync(prevDir, currentDir);
          }
          try {
            unlinkSync(marker);
          } catch {
            // best-effort
          }
          return true;
        } catch {
          return false;
        }
      }
      // Live dir present: swap already completed or backup is stale.
      try {
        unlinkSync(marker);
      } catch {
        // best-effort
      }
      return true;
    } catch {
      return false;
    }
  },
  // Faithful proxy of the standalone. Production callers pass no hooks, so every
  // hook is a no-op at zero cost; a test may inject hooks via this same argument.
  acquirePrefixLock(prefix, hooks) {
    return acquirePrefixLock(prefix, hooks);
  },
  writeDiagnostics(path, record) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const s = JSON.stringify(record);
      const bounded = s.length > 65_536 ? s.slice(0, 65_536) : s;
      writeFileSync(path, `${bounded}\n`, "utf8");
    } catch {
      // best-effort
    }
  }
};

function rmSyncSafe(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export interface UpgradeCheckResult {
  readonly current: string;
  readonly latest?: string;
  readonly upgradeAvailable: boolean;
  /** True if the latest came from a fresh cache hit (no network this call). */
  readonly fromCache: boolean;
}

export interface CheckUpgradeOptions {
  readonly runtime?: UpgradeRuntime;
  /** Cache file path; when set, a fresh entry within TTL skips the network. */
  readonly cachePath?: string;
  readonly ttlMs?: number;
  /** Skip the cache entirely (always hit the network). */
  readonly force?: boolean;
}

/**
 * Determine whether a newer CLI is published. Cached + throttled when a
 * `cachePath` is given (level-2 boot notice); always-fresh otherwise. Never
 * throws — a network failure yields `{ latest: undefined, upgradeAvailable:false }`.
 */
export function checkUpgrade(
  current: string,
  options: CheckUpgradeOptions = {}
): UpgradeCheckResult {
  const runtime = options.runtime ?? defaultUpgradeRuntime;
  const ttlMs = options.ttlMs ?? H2A_UPGRADE_CHECK_TTL_MS;
  const now = runtime.now();

  if (options.cachePath && !options.force) {
    const cached = runtime.readCache(options.cachePath);
    if (cached && now - cached.checkedAt < ttlMs) {
      return {
        current,
        ...(cached.latest ? { latest: cached.latest } : {}),
        upgradeAvailable: cached.latest ? isNewerVersion(cached.latest, current) : false,
        fromCache: true
      };
    }
  }

  const latest = runtime.fetchLatest(H2A_CLI_PACKAGE);
  if (options.cachePath) {
    // Preserve throttle fields across version-check writes (C4: keep
    // lastAttemptVersion so the version-indexed backoff keeps climbing).
    let throttle: UpgradeThrottle = {};
    try {
      const prev = runtime.readCache(options.cachePath);
      if (prev) {
        if (prev.lastAttemptAt !== undefined) throttle = { ...throttle, lastAttemptAt: prev.lastAttemptAt };
        if (prev.consecutiveFailures !== undefined) throttle = { ...throttle, consecutiveFailures: prev.consecutiveFailures };
        if (prev.lastAttemptVersion !== undefined) throttle = { ...throttle, lastAttemptVersion: prev.lastAttemptVersion };
        if (prev.lastOutcome !== undefined && (prev.lastOutcome === "ok" || prev.lastOutcome === "deferred-propagation" || prev.lastOutcome === "failed")) {
          throttle = { ...throttle, lastOutcome: prev.lastOutcome };
        }
      }
    } catch {
      // best-effort
    }
    runtime.writeCache(options.cachePath, { checkedAt: now, ...(latest ? { latest } : {}), ...throttle });
  }
  return {
    current,
    ...(latest ? { latest } : {}),
    upgradeAvailable: latest ? isNewerVersion(latest, current) : false,
    fromCache: false
  };
}

/**
 * @deprecated Kept for compatibility (`h2a upgrade` explicit path). New boot
 * and command flows use `performAutoUpgrade` (staged swap, never in-place).
 * Run the global install of `@latest`. Returns true on success.
 */
export function performUpgrade(runtime: UpgradeRuntime = defaultUpgradeRuntime): boolean {
  return runtime.runInstall(H2A_CLI_PACKAGE);
}

/** Default cache path for the boot check, under the store root. */
export function upgradeCachePath(root: string): string {
  return join(root, "upgrade-check.json");
}

/**
 * Env flag set across an in-place re-exec so the freshly-exec'd process does
 * NOT auto-upgrade + re-exec again this boot (breaks any pathological loop if
 * an install reports success without changing the on-disk version).
 */
export const H2A_REEXEC_GUARD_ENV = "H2A_UPGRADE_REEXECED";

export interface ReexecOptions {
  /** Injectable for tests; defaults to `process.execve` when present. */
  readonly execve?: (file: string, args: readonly string[], env: Record<string, string | undefined>) => never;
  readonly execPath?: string;
  readonly argv?: readonly string[];
  readonly env?: Record<string, string | undefined>;
}

/** True when an in-place re-exec is possible (POSIX `process.execve`, Node ≥ 23.10). */
export function canReexec(): boolean {
  return typeof (process as unknown as { execve?: unknown }).execve === "function";
}

/**
 * Re-exec the current process into the (just-upgraded) binary at the SAME path,
 * preserving PID + stdio fds — so a host-spawned `mcp-serve` picks up the new
 * version immediately without the host seeing a disconnect. On success the
 * process image is replaced and this never returns; returns `false` if re-exec
 * is unavailable or failed (caller falls back to "applies next launch"). The
 * `H2A_REEXEC_GUARD_ENV` flag is set so the new image does not re-upgrade.
 */
export function reexecSelf(options: ReexecOptions = {}): boolean {
  const execve =
    options.execve ??
    (process as unknown as { execve?: ReexecOptions["execve"] }).execve;
  if (typeof execve !== "function") return false;
  const execPath = options.execPath ?? process.execPath;
  // CRITICAL: a failing `process.execve` (e.g. a bad path) aborts the process
  // *natively* — it is NOT a catchable throw — so we must not call it on a
  // target that might fail. Guard on existence first; the real boot path uses
  // `process.execPath` (the running node), which is always valid.
  if (!existsSync(execPath)) return false;
  const argv = options.argv ?? process.argv.slice(1);
  const env = { ...(options.env ?? process.env), [H2A_REEXEC_GUARD_ENV]: "1" };
  try {
    execve(execPath, [execPath, ...argv], env);
    return true; // unreachable when execve truly replaces the image
  } catch {
    return false;
  }
}

export interface AutoUpgradeResult {
  readonly current: string;
  readonly target?: string;
  readonly outcome:
    | "upgraded"
    | "already-current"
    | "deferred-propagation"
    | "failed"
    | "skipped-locked"
    | "skipped-throttled"
    // M-2: an UNDECIDABLE lock owner (dead-or-unknown, manual intervention) is a
    // distinct, boot-VISIBLE outcome — never folded into the quiet skipped-locked
    // (a live installer in progress), so the wedge class surfaces at boot.
    | "blocked-undecidable";
  readonly verifiedVersion?: string;
  readonly message: string;
  readonly logPath?: string;
}

export interface AutoUpgradeOptions {
  readonly runtime?: UpgradeRuntime;
  readonly cachePath?: string;
  readonly ttlMs?: number;
  readonly prefix?: string;
}

/** Exponential backoff for consecutive failures, based on the auto-upgrade TTL. */
function upgradeThrottleBackoffMs(consecutiveFailures: number): number {
  const base = H2A_AUTO_UPGRADE_CHECK_TTL_MS;
  const exp = Math.pow(2, Math.max(0, consecutiveFailures - 1));
  const capped = Math.min(exp, 24);
  return base * capped;
}

/**
 * Single staged auto-upgrade orchestration used by both the injected-seam path
 * and the worker path. Every bounded side effect goes through `UpgradeRuntime`;
 * this function never spawns or touches the network directly.
 *
 * Fail-safe seam: when an injected runtime is provided, a missing method throws
 * `missing runtime method X` instead of falling back to the real implementation.
 * Only the default path (no runtime provided) uses `defaultUpgradeRuntime`.
 */
export function performAutoUpgrade(
  current: string,
  options: { readonly runtime?: UpgradeRuntime; readonly cachePath?: string; readonly ttlMs?: number; readonly prefix?: string } = {}
): AutoUpgradeResult {
  const injected = options.runtime;
  const need = <K extends keyof UpgradeRuntime>(name: K): NonNullable<UpgradeRuntime[K]> => {
    if (!injected) {
      const fn = defaultUpgradeRuntime[name];
      if (fn == null) throw new Error(`missing runtime method ${String(name)}`);
      return fn as NonNullable<UpgradeRuntime[K]>;
    }
    const fn = injected[name];
    if (fn == null) throw new Error(`missing runtime method ${String(name)}`);
    return fn as NonNullable<UpgradeRuntime[K]>;
  };

  // Fail fast before any side effect when an injected runtime is incomplete.
  const fetchLatestFn = need("fetchLatest") as UpgradeRuntime["fetchLatest"];
  const nowFn = need("now") as UpgradeRuntime["now"];
  const readCacheFn = need("readCache") as UpgradeRuntime["readCache"];
  const writeCacheFn = need("writeCache") as UpgradeRuntime["writeCache"];
  const doResolvePrefix = need("resolvePrefix") as NonNullable<UpgradeRuntime["resolvePrefix"]>;
  const completeRepair = need("completeRepairIfPending") as NonNullable<UpgradeRuntime["completeRepairIfPending"]>;
  const acquireLock = need("acquirePrefixLock") as NonNullable<UpgradeRuntime["acquirePrefixLock"]>;
  const doFetchTarball = need("fetchTarball") as NonNullable<UpgradeRuntime["fetchTarball"]>;
  const doStageInstall = need("stageInstall") as NonNullable<UpgradeRuntime["stageInstall"]>;
  const doProbeStaged = need("probeStagedVersion") as NonNullable<UpgradeRuntime["probeStagedVersion"]>;
  const doVerifyNative = need("verifyStagedNative") as NonNullable<UpgradeRuntime["verifyStagedNative"]>;
  const doSwap = need("swapPackageDir") as NonNullable<UpgradeRuntime["swapPackageDir"]>;
  const doReadGlobal = need("readGlobalPkgVersion") as NonNullable<UpgradeRuntime["readGlobalPkgVersion"]>;
  const doWriteDiag = need("writeDiagnostics") as NonNullable<UpgradeRuntime["writeDiagnostics"]>;

  const runtime: UpgradeRuntime = injected ?? defaultUpgradeRuntime;
  void fetchLatestFn;

  let prefix = options.prefix;
  if (!prefix) {
    try {
      prefix = doResolvePrefix();
    } catch {
      prefix = "/usr/local";
    }
  }
  if (!prefix) prefix = "/usr/local";
  const resolvedPrefix = prefix;
  const cachePath = options.cachePath;
  const ttlMs = options.ttlMs ?? H2A_AUTO_UPGRADE_CHECK_TTL_MS;
  const logPath = cachePath ? `${cachePath}.log` : join(resolvedPrefix, "h2a-upgrade.log");

  const readEntry = (): UpgradeCacheEntry | undefined => {
    if (!cachePath) return undefined;
    try {
      return readCacheFn(cachePath);
    } catch {
      return undefined;
    }
  };
  const writeEntry = (entry: UpgradeCacheEntry): void => {
    if (!cachePath) return;
    try {
      writeCacheFn(cachePath, entry);
    } catch {
      // best-effort
    }
  };
  const diag = (record: UpgradeDiagnosticsRecord): void => {
    try {
      doWriteDiag(logPath, record);
    } catch {
      // best-effort
    }
  };

  // Freshness check (cached + throttled when cachePath is set).
  let check: UpgradeCheckResult;
  try {
    check = checkUpgrade(current, { runtime, ...(cachePath ? { cachePath } : {}), ttlMs });
  } catch (e) {
    const at = nowFn();
    diag({ at, durationMs: 0, prefix: resolvedPrefix, current, outcome: "failed", error: e instanceof Error ? e.message : String(e) });
    return {
      current,
      outcome: "failed",
      message: `auto-upgrade check failed (see ${logPath})`,
      logPath
    };
  }
  if (!check.upgradeAvailable || !check.latest) {
    if (cachePath) {
      try {
        const prev = readEntry();
        writeEntry({
          checkedAt: prev?.checkedAt ?? nowFn(),
          ...(check.latest ?? prev?.latest ? { latest: (check.latest ?? prev?.latest) as string } : {}),
          lastAttemptAt: nowFn(),
          consecutiveFailures: 0,
          lastAttemptVersion: current,
          lastOutcome: "ok"
        });
      } catch {
        // best-effort
      }
    }
    return {
      current,
      outcome: "already-current",
      message: `already current (${current})`
    };
  }

  // Pin the target version for this attempt.
  const target = check.latest as string;
  const startedAt = nowFn();

  const recordFailure = (outcome: "failed" | "deferred-propagation"): void => {
    if (!cachePath) return;
    try {
      const prev = readEntry();
      const sameVersion = prev?.lastAttemptVersion === target;
      const failures = sameVersion ? (prev?.consecutiveFailures ?? 0) + 1 : 1;
      writeEntry({
        checkedAt: prev?.checkedAt ?? startedAt,
        latest: target,
        lastAttemptAt: nowFn(),
        consecutiveFailures: failures,
        lastAttemptVersion: target,
        lastOutcome: outcome
      });
    } catch {
      // best-effort
    }
  };

  // Version-indexed backoff BEFORE any heavy work: the same target that failed
  // or deferred recently must not replay `npm pack` + stage (~130 MB) every boot.
  // A new target resets the counter.
  try {
    const cached = readEntry();
    if (
      cached &&
      (cached.lastOutcome === "failed" || cached.lastOutcome === "deferred-propagation") &&
      cached.lastAttemptVersion === target &&
      (cached.consecutiveFailures ?? 0) > 0 &&
      typeof cached.lastAttemptAt === "number"
    ) {
      const failures = cached.consecutiveFailures as number;
      if (nowFn() - (cached.lastAttemptAt as number) < upgradeThrottleBackoffMs(failures)) {
        return {
          current,
          target,
          outcome: "skipped-throttled",
          message: `auto-upgrade to ${target} throttled after ${failures} attempt(s), retry later`
        };
      }
    }
  } catch {
    // best-effort: continue without throttle
  }

  // Serialize concurrent installers on the global prefix. Production calls
  // without hooks (test-only critical-section windows stay no-op, zero cost).
  let lock: PrefixLockLease;
  let lockThrew: unknown;
  let lockThrewFlag = false;
  try {
    lock = acquireLock(resolvedPrefix);
  } catch (e) {
    lockThrew = e;
    lockThrewFlag = true;
    lock = { acquired: false, release: () => {}, reason: "dead-undecidable" };
  }
  if (!lock.acquired) {
    const reason = lock.reason ?? "busy";
    if (reason.startsWith("error:")) {
      const code = reason.slice("error:".length);
      // R5: use the error-specific hint (permissions advice only for EACCES/EPERM/EROFS,
      // an ENOSPC message, or a plain code) instead of always blaming permissions.
      const hint = describeLockReason(reason);
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: `prefix lock unavailable (${code}): ${hint} on ${resolvedPrefix}`
      });
      recordFailure("failed");
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: cannot lock prefix ${resolvedPrefix}: ${hint} (see ${logPath})`,
        logPath
      };
    }
    if (reason === "dead-undecidable") {
      // R4: show the RECORDED holder identity and the reader's namespace, and advise
      // removal ONLY after confirming that holder is truly gone in ITS OWN namespace —
      // a live holder in another container/namespace (nsenter -p) or another machine
      // must never be broken on the strength of "PID absent in MY namespace".
      const lockFile = lockPathFor(resolvedPrefix);
      const rec = readLockRecord(lockFile);
      const readerNs = me().ns ?? "unknown";
      const holder =
        rec === "absent" || rec === "corrupt"
          ? `LOCK unreadable (${rec})`
          : `holder host=${rec.host} ns=${rec.ns ?? "unknown"} pid=${rec.pid} acquiredAt=${new Date(rec.at).toISOString()}`;
      const advice =
        rec === "absent" || rec === "corrupt"
          ? `Inspect ${lockFile} and its ${lockFile}.succ.* files before any removal.`
          : `Remove ${lockFile} (and its ${lockFile}.succ.* files) ONLY after confirming pid ${rec.pid} on host ${rec.host} is truly gone in ITS OWN namespace — never remove a holder merely absent from yours (a live holder in another container/namespace or machine must not be broken).`;
      const thrown = lockThrewFlag
        ? `lock acquisition threw (${lockThrew instanceof Error ? lockThrew.message : String(lockThrew)}); `
        : "";
      const fullError =
        `${thrown}prefix lock owner liveness undecidable (a different/unreadable PID namespace, another machine, a corrupt LOCK, or succession depth exceeded); manual intervention required. ${holder}; this reader ns=${readerNs}. ${advice}`;
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "blocked-undecidable",
        reason,
        error: fullError
      });
      return {
        current,
        target,
        outcome: "blocked-undecidable",
        message: `auto-upgrade blocked: ${fullError} (see ${logPath})`,
        logPath
      };
    }
    // reason === "busy": a live holder. R2 staleness alert (DIAGNOSTIC ONLY, never a
    // reclaim): if this lock is far older than any legitimate upgrade AND its holder
    // reads "live" ONLY because its start time is not comparable on this kernel (so a
    // reused PID could be masking a dead holder), surface it. `at` informs; it never
    // decides (I7). No removal is advised — an operator killing a live holder on the
    // strength of a message is a hand-made double-holder (the R4 lesson).
    try {
      const rec = readLockRecord(lockPathFor(resolvedPrefix));
      if (rec !== "absent" && rec !== "corrupt") {
        const info = classifyLiveness(rec, me());
        const ageMs = nowFn() - rec.at;
        if (info.verdict === "live" && !info.datable && ageMs > STALE_LOCK_ALERT_MS) {
          diag({
            at: startedAt,
            durationMs: nowFn() - startedAt,
            prefix: resolvedPrefix,
            current,
            target,
            outcome: "skipped-locked",
            reason,
            error:
              `prefix lock held ~${Math.round(ageMs / 60000)} min by pid ${rec.pid} (host ${rec.host}); ` +
              `its identity is not confirmable on this kernel (start time not comparable), so a reused PID may be masking a dead holder. ` +
              `Informational only — no action is taken and none is advised automatically; investigate whether pid ${rec.pid} is genuinely the running upgrade.`
          });
        }
      }
    } catch {
      // best-effort: the staleness alert must never affect the outcome
    }
    const detail = describeLockReason(reason);
    return {
      current,
      target,
      outcome: "skipped-locked",
      message: `auto-upgrade skipped: ${detail} (${reason})`
    };
  }

  try {
    // Repair under the lock so one lane never repairs while another swaps.
    try {
      completeRepair(resolvedPrefix);
    } catch {
      // best-effort
    }

    // Idempotence under the lock: the version check ran BEFORE acquiring the lock,
    // so a peer lane may have installed `target` while we waited. Re-read the live
    // global version now that we hold the lock; if it already IS target AND its native
    // module actually loads, do not re-stage ~130 MB — report already-current. The lock
    // releases in `finally`. A version-correct install whose native module fails to load
    // is NOT up to date, it is broken (e.g. a manual `npm i -g` interrupted mid-write):
    // we must fall through and re-stage to repair it, never declare it current.
    let installed: string | undefined;
    try {
      installed = doReadGlobal(resolvedPrefix);
    } catch {
      installed = undefined;
    }
    let installedNativeOk = false;
    if (installed === target) {
      try {
        installedNativeOk = doVerifyNative(stagedPkgDirFromPrefix(resolvedPrefix)).ok;
      } catch {
        installedNativeOk = false;
      }
    }
    if (installed === target && installedNativeOk) {
      if (cachePath) {
        try {
          const prev = readEntry();
          writeEntry({
            checkedAt: prev?.checkedAt ?? startedAt,
            latest: target,
            lastAttemptAt: nowFn(),
            consecutiveFailures: 0,
            lastAttemptVersion: target,
            lastOutcome: "ok"
          });
        } catch {
          // best-effort
        }
      }
      return {
        current: installed,
        target,
        outcome: "already-current",
        message: `already current (${installed}); another lane installed ${target} before this one acquired the lock`
      };
    }

    // Sibling staging dirs under the global prefix (same filesystem, never /tmp).
    // Unique per attempt so lanes never share one artifact.
    const attemptId = `${process.pid}-${startedAt.toString(36)}-${randomUUID().slice(0, 8)}`;
    const stagingTarballDir = join(resolvedPrefix, `.h2a-upgrade-tarball-${attemptId}`);
    const stagingPrefix = join(resolvedPrefix, `.h2a-upgrade-staging-${attemptId}`);
    const stagingPkgDir = stagedPkgDirFromPrefix(stagingPrefix);
    const cleanupAttempt = (): void => {
      try {
        rmSyncSafe(stagingPrefix);
      } catch {
        // best-effort
      }
      try {
        rmSyncSafe(stagingTarballDir);
      } catch {
        // best-effort
      }
    };

    // Bounded, killable tarball fetch with zero global mutation.
    let tarball: { ok: boolean; file?: string; error?: string };
    try {
      tarball = doFetchTarball(H2A_CLI_PACKAGE, target, stagingTarballDir);
    } catch (e) {
      tarball = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!tarball.ok || !tarball.file) {
      const err = tarball.error ?? "fetch failed";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "deferred-propagation",
        error: err
      });
      recordFailure("deferred-propagation");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "deferred-propagation",
        message: `Update ${target} available but not installable right now, retry on next boot`,
        logPath
      };
    }
    const tarballFile = tarball.file as string;

    // Stage self-contained locally, then verify the staged binary reports the target.
    let staged: { ok: boolean; error?: string };
    try {
      staged = doStageInstall(tarballFile, stagingPrefix);
    } catch (e) {
      staged = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!staged.ok) {
      const err = staged.error ?? "stage failed";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    let probed: string | undefined;
    try {
      probed = doProbeStaged(stagingPrefix);
    } catch {
      probed = undefined;
    }
    if (probed !== target) {
      const err = `staged version mismatch: expected ${target}, got ${probed ?? "unknown"}`;
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    // Native validation before swap: `h2a --version` never loads node-pty, so a
    // staged dir can pass the probe yet break `h2a run`. Fail closed here.
    let native: { ok: boolean; error?: string };
    try {
      native = doVerifyNative(stagingPkgDir);
    } catch (e) {
      native = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!native.ok) {
      const err = native.error ?? "staged native module failed to load";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    // Atomic rename swap, then verify the global root reports the target.
    // Always switch the prepared autonomous folder (no dep-range gate: a
    // self-contained version brings its own nested deps).
    let swapped: { ok: boolean; repaired?: boolean; error?: string; prevDir?: string | null };
    try {
      swapped = doSwap(resolvedPrefix, stagingPkgDir, target);
    } catch (e) {
      swapped = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!swapped.ok) {
      const err = swapped.error ?? "swap failed";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    let verified: string | undefined;
    try {
      verified = doReadGlobal(resolvedPrefix);
    } catch {
      verified = undefined;
    }
    diag({
      at: startedAt,
      durationMs: nowFn() - startedAt,
      prefix: resolvedPrefix,
      current,
      target,
      outcome: verified === target ? "upgraded" : "failed",
      verifiedVersion: verified
    });
    if (verified === target) {
      // M4: drop the backup and sweep residues UNDER the lock. Inodes stay
      // valid for already-launched processes; the sweep never touches a live
      // attempt's staging (live owner => keep, no age shortcut).
      if (typeof swapped.prevDir === "string" && swapped.prevDir) {
        try {
          rmSyncSafe(swapped.prevDir);
        } catch {
          // best-effort: the next sweep retries
        }
      }
      try {
        sweepUpgradeResidues(resolvedPrefix, lock.token);
      } catch {
        // best-effort
      }
      if (cachePath) {
        try {
          const prev = readEntry();
          writeEntry({
            checkedAt: prev?.checkedAt ?? startedAt,
            latest: target,
            lastAttemptAt: nowFn(),
            consecutiveFailures: 0,
            lastAttemptVersion: target,
            lastOutcome: "ok"
          });
        } catch {
          // best-effort
        }
      }
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "upgraded",
        verifiedVersion: verified,
        message: `auto-upgraded ${current} → ${target} (applies on next launch) [verified]`,
        logPath
      };
    }
    recordFailure("failed");
    cleanupAttempt();
    return {
      current,
      target,
      outcome: "failed",
      ...(verified ? { verifiedVersion: verified } : {}),
      message: `auto-upgrade to ${target} failed: verification mismatch (got ${verified ?? "unknown"}) (see ${logPath})`,
      logPath
    };
  } finally {
    try {
      lock.release();
    } catch {
      // best-effort
    }
  }
}
