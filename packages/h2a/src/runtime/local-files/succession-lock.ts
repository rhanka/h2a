/**
 * Succession lock (v4) — single-machine succession protocol.
 *
 * Extracted from `runtime/upgrade/index.ts` (Lot 4, step 1: neutral
 * intra-package move). Lot 4 §2 adds fail-closed host and boot provenance before
 * any death proof. This is the shared lock primitive
 * used by the auto-upgrade prefix lock today, and (later lots) by the identity
 * binding lock. It is a LEAF: it imports only `node:fs/os/crypto/child_process`
 * and nothing from the store, so `upgrade/index.ts` and `local-files/locks.ts`
 * import it directly by file, never via `local-files/index.js`.
 *
 * The full protocol proof-sketch (I1–I7, Lemmas A–C) lives with the code below,
 * moved unchanged from its original location.
 */

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";

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
  /** Fresh token check; false after release or any uncertain read. */
  stillHeld(): boolean;
  release(): void;
  readonly reason?: PrefixLockReason;
  /** Winning token; present only when acquired. Never republished (I2). */
  readonly token?: string;
}

/** @deprecated Compatibility type only; production never invokes test hooks. */
export type PrefixLockHookContext = {
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

/** @deprecated Compatibility type only; the legacy argument is ignored at runtime. */
export type PrefixLockHooks = {
  readonly afterReadFirst?: (ctx: PrefixLockHookContext) => void;
  /** Just BEFORE the initial publish(LOCK) (round 0) — initial race window. */
  readonly beforePublishLock?: (ctx: PrefixLockHookContext) => void;
  /** Just AFTER a publish(SUCC(t)) success, BEFORE retire — unique successor elected. */
  readonly afterPublishSucc?: (ctx: PrefixLockHookContext) => void;
  /** In retire(), around the targeted unlink(LOCK) (removal-to-republish window). */
  readonly beforeRetireUnlink?: (ctx: PrefixLockHookContext) => void;
  readonly afterRetireUnlink?: (ctx: PrefixLockHookContext) => void;
}

/** Advisory acquisition control. No identity injection or hooks in production. */
export interface AcquirePrefixLockOptions {
  readonly readFirst?: boolean;
}

interface LockIdent {
  readonly host: string;
  /** Missing only on records written before host provenance was recorded. */
  readonly hostKind?: HostKind;
  readonly boot: string | null;
  readonly ns: string | null;
  /** Reader's time namespace; gates proc-sourced start comparisons (B2). */
  readonly timeNs: string | null;
  readonly pid: number;
  readonly start: string | null;
}

interface LockRec extends LockIdent {
  /** v4 records never carry a discriminator; legacy views use `kind: "legacy"`. */
  readonly kind?: never;
  readonly token: string;
  readonly target?: string;
  /** Explicit operator assertion; the succession target remains unchanged. */
  readonly operator?: true;
  /** Diagnostic only, never decides (I7). */
  readonly at: number;
}

/**
 * Read-only view of the pre-v4 lock written by `local-files/locks.ts`. Its
 * optional metadata is used by identity binding, but it remains deliberately
 * distinct from a v4 `LockRec`: legacy data lacks the machine, boot, namespace,
 * and process-start proof needed to decide death. Its token fingerprints the
 * exact bytes read so a later operator-only break can fence the observed record
 * without rewriting it.
 */
export interface LegacyLockHolder {
  readonly kind: "legacy";
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: string;
  readonly protocol?: string;
  readonly fenceEpoch?: string;
}

/** A readable v4 record or the separate, always-undecidable legacy view. */
export type LockHolder = LockRec | LegacyLockHolder;

/** Tokens are hex (plus -/_ tolerance); anything else in a record is corruption. */
const LOCK_TOKEN_RE = /^[A-Za-z0-9_-]{12,128}$/;

export function lockPathFor(prefix: string): string {
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

export function errnoOf(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.length > 0 ? code : "EIO";
}

// N3: `at` is validated only as a finite number (parseLockRec), so it may be out of
// Date's representable range; `new Date(at).toISOString()` would throw a RangeError.
// Never let a diagnostic string crash the caller (at boot the exception would swallow
// the whole M-2 alarm; `h2a upgrade` would abort). Fall back to the raw number.
export function safeAtIso(at: number): string {
  const ms = Number(at);
  if (Number.isFinite(ms) && Math.abs(ms) <= 8.64e15) {
    try {
      return new Date(ms).toISOString();
    } catch {
      // fall through
    }
  }
  return `epoch-ms:${at}`;
}

export type HostKind = "machine-id" | "weak";

interface HostIdentity {
  readonly host: string;
  readonly hostKind: HostKind;
}

interface HostIdentityDeps {
  readonly platform?: NodeJS.Platform;
  readonly readFile?: (path: string) => string;
  readonly hostname?: () => string;
  readonly ioreg?: () => { readonly status: number | null; readonly stdout: string | null };
  readonly spawn?: typeof spawnSync;
}

const MACHINE_ID_RE = /^[0-9a-f]{32}$/;
const IO_PLATFORM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATIC_COMMAND_ENV = { LC_ALL: "C", TZ: "UTC0" };

function isNullMachineId(value: string): boolean {
  return /^0+$/.test(value.replaceAll("-", ""));
}

function sysctlPath(platform: NodeJS.Platform): string {
  return platform === "darwin"
    ? "/usr/sbin/sysctl"
    : platform === "freebsd" || platform === "openbsd"
      ? "/sbin/sysctl"
      : "/usr/sbin/sysctl";
}

function weakHost(hostnameReader: () => string): HostIdentity {
  try {
    const host = hostnameReader().trim();
    if (host) return { host, hostKind: "weak" };
  } catch {
    // fall through to sentinel
  }
  return { host: "unknown-host", hostKind: "weak" };
}

function parseIoPlatformUuid(output: string): string | undefined {
  const matches = output
    .split("\n")
    .map((line) => line.trim().match(/^"IOPlatformUUID"\s*=\s*"([0-9a-f-]+)"$/i)?.[1])
    .filter((value): value is string => value !== undefined);
  if (matches.length !== 1 || !IO_PLATFORM_UUID_RE.test(matches[0]) || isNullMachineId(matches[0])) return undefined;
  return matches[0].toLowerCase();
}

/**
 * Reads a machine-scoped host identity. The injected readers make source selection
 * deterministic in tests without consulting process environment variables.
 */
export function readHostId(deps: HostIdentityDeps = {}): HostIdentity {
  const platform = deps.platform ?? process.platform;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const hostnameReader = deps.hostname ?? hostname;
  if (platform === "linux") {
    try {
      const host = readFile("/etc/machine-id").trim();
      if (MACHINE_ID_RE.test(host) && !isNullMachineId(host)) return { host, hostKind: "machine-id" };
    } catch {
      // fall through to a weak hostname
    }
  } else if (platform === "darwin") {
    try {
      const ioreg = deps.ioreg ?? (() => {
        const r = (deps.spawn ?? spawnSync)("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
          encoding: "utf8",
          timeout: 2000,
          env: STATIC_COMMAND_ENV
        });
        return { status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : null };
      });
      const result = ioreg();
      const host = result.status === 0 && typeof result.stdout === "string"
        ? parseIoPlatformUuid(result.stdout)
        : undefined;
      if (host !== undefined) return { host, hostKind: "machine-id" };
    } catch {
      // fall through to a weak hostname
    }
  }
  return weakHost(hostnameReader);
}

interface BootIdentityDeps {
  readonly platform?: NodeJS.Platform;
  readonly readFile?: (path: string) => string;
  readonly spawn?: typeof spawnSync;
}

/** Reads the current boot identity; readers are injectable for platform simulations. */
export function readBootId(deps: BootIdentityDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const spawn = deps.spawn ?? spawnSync;
  try {
    const v = readFile("/proc/sys/kernel/random/boot_id").trim();
    if (v) return v;
  } catch {
    // not Linux: fall through to sysctl below
  }
  // Outside Linux prefer the stable session UUID (TZ-independent) when present.
  try {
    const r = spawn(sysctlPath(platform), ["-n", "kern.bootsessionuuid"], {
      encoding: "utf8",
      timeout: 2000,
      env: STATIC_COMMAND_ENV
    });
    const v = (r.stdout ?? "").trim();
    if (r.status === 0 && v) return v;
  } catch {
    // best-effort
  }
  try {
    const r = spawn(sysctlPath(platform), ["-n", "kern.boottime"], {
      encoding: "utf8",
      timeout: 2000,
      env: STATIC_COMMAND_ENV
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
// unknown). Only the latter is null; the former is the sentinel "host". Lot 4 §2
// permits that no-namespace liveness proof only on darwin; Windows and BSD still fail
// closed as undecidable. `platform`/`readLink` are injected only by tests
// (macOS/Windows/no-/proc sims); production passes none.
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
// `platform`/`mapsToSelf`/`spawn` are injected only by tests (mis-mapped-/proc /
// non-Linux sims); production passes none.
export function procStartInfo(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  mapsToSelf: () => boolean = procMapsToSelf,
  spawn: typeof spawnSync = spawnSync
): { state?: string; start?: string } | undefined {
  // A start time is only trusted from a source whose value is STABLE for the life of the
  // process (never moving under a wall-clock step), else a clock jump while the lock is held
  // could make a live holder's start "differ" ⇒ a false death ⇒ two holders (I3).
  // - Linux: /proc field 22 (proc:) is the only trusted source.
  //   - B3: a mis-mapped /proc (unshare --pid without --mount-proc) makes both /proc AND
  //     `ps` (procps reads /proc/<pid>) describe another namespace's process ⇒ undatable.
  //   - N5: `ps` lstart under Linux derives from btime + starttime and moves on a clock step,
  //     so it is not stable either. So under Linux: /proc when it maps to us, else undefined.
  // - darwin: `ps lstart` is the ABSOLUTE fork wall-clock time (p_starttime), stable ⇒ trusted.
  // - R-BSD: on FreeBSD/OpenBSD `ps` start is boot-relative and its boot time is re-derived on
  //   a clock step, so it is NOT stable. Every other non-Linux platform (incl. Windows, no ps)
  //   ⇒ undefined. Lock liveness on those platforms is already undecidable under Lot 4 §2.
  //   In doubt, never dead.
  if (platform === "linux") {
    if (!mapsToSelf()) return undefined;
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
      // no readable /proc for this pid: undatable
    }
    return undefined;
  }
  if (platform !== "darwin") return undefined; // only darwin ps is a stable source
  try {
    const r = spawn("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5000,
      env: STATIC_COMMAND_ENV
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
  readonly hostKind: HostKind;
  readonly pid: number;
}

let ME_CACHE: SelfIdent | undefined;

/** This process's identity, computed once and memoized. */
export function me(): SelfIdent {
  ME_CACHE ??= (() => {
    const host = readHostId();
    return {
      host: host.host,
      hostKind: host.hostKind,
      boot: readBootId(),
      ns: readPidNs(),
      timeNs: readTimeNs(),
      pid: process.pid,
      start: procStartInfo(process.pid)?.start ?? null
    };
  })();
  return ME_CACHE;
}

/** Fresh random token, >= 96 bits, never republished (H3). */
function newToken(): string {
  return randomBytes(16).toString("hex");
}

function makeLockRecFor(self: SelfIdent, token: string, target?: string): LockRec {
  return {
    host: self.host,
    hostKind: self.hostKind,
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

export function makeLockRec(token: string, target?: string): LockRec {
  return makeLockRecFor(me(), token, target);
}

export function parseLockRec(raw: unknown): LockRec {
  if (typeof raw !== "object" || raw === null) throw new Error("bad lock record");
  const o = raw as Record<string, unknown>;
  const { host, hostKind, boot, ns, timeNs, pid, start, token, target, operator, at } = o;
  // timeNs is a required field like host/boot/ns/pid/start: an absent field is a
  // malformed record → corrupt → fail-closed. No back-compat exception is carved
  // for a "v4 without timeNs" — the redesign was never published, so no such lock
  // exists outside fixtures (kept in step with makeLockRec). The VALUE may be null
  // (genuine unknown time namespace); the liveness guard then treats the proc start
  // as undatable ⇒ "live" (never reclaim, never a false death), not undecidable.
  if (typeof host !== "string" || host.length === 0) throw new Error("bad host");
  // A missing provenance was written by versions <= 0.97.9. It is valid legacy
  // state, but classifyLiveness treats it as unknown and therefore undecidable.
  // Unknown values are corrupt and fail closed. Lot 5 must carry an instance UUID in
  // a separate field rather than extending this persisted hostKind enum.
  if (hostKind !== undefined && hostKind !== "machine-id" && hostKind !== "weak") throw new Error("bad hostKind");
  if (boot !== null && typeof boot !== "string") throw new Error("bad boot");
  if (ns !== null && typeof ns !== "string") throw new Error("bad ns");
  if (timeNs !== null && typeof timeNs !== "string") throw new Error("bad timeNs");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) throw new Error("bad pid");
  if (start !== null && typeof start !== "string") throw new Error("bad start");
  if (typeof token !== "string" || token.startsWith("legacy-") || !LOCK_TOKEN_RE.test(token)) throw new Error("bad token");
  if (target !== undefined && typeof target !== "string") throw new Error("bad target");
  if (operator !== undefined && (operator !== true || target === undefined)) throw new Error("bad operator");
  if (typeof at !== "number" || !Number.isFinite(at)) throw new Error("bad at");
  return {
    host,
    ...(hostKind !== undefined ? { hostKind } : {}),
    boot,
    ns,
    timeNs,
    pid,
    start,
    token,
    ...(target !== undefined ? { target } : {}),
    ...(operator === true ? { operator } : {}),
    at
  };
}

function parseLegacyLockHolder(raw: unknown, bytes: Buffer): LegacyLockHolder {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("bad legacy lock record");
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (
    !keys.includes("pid")
    || !keys.includes("hostname")
    || !keys.includes("startedAt")
    || !keys.every((key) => key === "pid" || key === "hostname" || key === "startedAt" || key === "protocol" || key === "fenceEpoch")
  ) {
    throw new Error("bad legacy lock fields");
  }
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) throw new Error("bad legacy pid");
  if (typeof o.hostname !== "string") throw new Error("bad legacy hostname");
  if (typeof o.startedAt !== "string") throw new Error("bad legacy startedAt");
  if (o.protocol !== undefined && typeof o.protocol !== "string") throw new Error("bad legacy protocol");
  if (o.fenceEpoch !== undefined && typeof o.fenceEpoch !== "string") throw new Error("bad legacy fenceEpoch");
  return {
    kind: "legacy",
    // Do not trim, decode/re-encode, or JSON.stringify the input: a final `\n`
    // is part of this fencing token by design and is covered by T-legacy.
    token: `legacy-${createHash("sha256").update(bytes).digest("hex")}`,
    pid: o.pid,
    hostname: o.hostname,
    startedAt: o.startedAt,
    ...(o.protocol !== undefined ? { protocol: o.protocol } : {}),
    ...(o.fenceEpoch !== undefined ? { fenceEpoch: o.fenceEpoch } : {})
  };
}

interface LockHolderReadError {
  readonly kind: "io-error";
  readonly code: string;
}

/** Advisory reader: distinguish failed reads from malformed file content. */
function readLockHolderDetailed(path: string): LockHolder | "absent" | "corrupt" | LockHolderReadError {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    return errnoOf(e) === "ENOENT" ? "absent" : { kind: "io-error", code: errnoOf(e) };
  }
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    try {
      return parseLockRec(parsed);
    } catch {
      return parseLegacyLockHolder(parsed, bytes);
    }
  } catch {
    return "corrupt";
  }
}

/** Legacy tokens fingerprint the exact raw bytes; read errors remain corrupt. */
export function readLockHolder(path: string): LockHolder | "absent" | "corrupt" {
  const holder = readLockHolderDetailed(path);
  return typeof holder === "object" && holder.kind === "io-error" ? "corrupt" : holder;
}

/**
 * v4-only reader retained for existing protocol callers. A readable legacy holder
 * remains `corrupt` here so a caller that was not explicitly upgraded to the
 * distinct legacy view continues to fail closed.
 */
export function readLockRecord(path: string): LockRec | "absent" | "corrupt" {
  const holder = readLockHolder(path);
  return holder !== "absent" && holder !== "corrupt" && holder.kind === "legacy"
    ? "corrupt"
    : holder;
}

type PublishStatus = { status: "ok" } | { status: "exists" } | { status: "retry" } | { status: "error"; code: string };

/**
 * opus `publish` (I1): a name appears only with complete, durable content.
 * Write tmp (wx + byte-count-checked write + fsync + close), then `link(2)`;
 * EEXIST -> "exists", ENOENT at link -> "retry" (tmp reaped before link),
 * any other failure -> "error" with the errno (no hard links -> fail closed).
 * The tmp never contains `.succ.` (C2).
 */
export function publishLockRecord(path: string, rec: LockRec): PublishStatus {
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
export function classifyLiveness(r: LockHolder, self: SelfIdent, deps: LivenessDeps = {}): LivenessInfo {
  // Legacy records have no machine/boot/namespace/start provenance. In particular,
  // even a same-host ESRCH PID may have been reused, so never probe it and never
  // promote the holder to dead. The operator escape hatch consumes this token later.
  if (r.kind === "legacy") return { verdict: "undecidable", datable: false };
  const platform = deps.platform ?? process.platform;
  const probe = deps.probe ?? procStartInfo;
  // Lot 4 §2 permits a death proof only for a strong machine identity on Linux or
  // darwin, with the same known host and boot. Check this before every PID/start probe:
  // cloned images can share a machine-id and an initial pid namespace inode.
  if (platform !== "linux" && platform !== "darwin") return { verdict: "undecidable", datable: false };
  if (r.hostKind !== "machine-id" || self.hostKind !== "machine-id") return { verdict: "undecidable", datable: false };
  if (r.host !== self.host) return { verdict: "undecidable", datable: false };
  if (r.boot === null || self.boot === null || r.boot !== self.boot) return { verdict: "undecidable", datable: false };
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
    // A ps: start now arises ONLY on darwin (procStartInfo trusts ps only there), where
    // lstart is the absolute fork wall-clock (TZ-normalised), stable ⇒ it needs no time gate.
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

export function livenessOf(r: LockHolder, self: SelfIdent, deps: LivenessDeps = {}): Liveness {
  return classifyLiveness(r, self, deps).verdict;
}

/** No false positive: true implies certainly dead; any doubt is alive (I3). */
export function isCertainlyDead(r: LockRec): boolean {
  return classifyLiveness(r, me()).verdict === "dead";
}

export interface BreakLockAsOperatorOptions {
  readonly expectToken: string;
  /** Explicit assertion for an undecidable holder; never authorizes a live one. */
  readonly assertDead?: boolean;
}

export type OperatorBreakReason = "invalid-token" | "absent" | "corrupt" | "token-mismatch"
  | "live" | "assert-dead-required" | "busy" | "dead-undecidable" | `error:${string}`;

export interface OperatorBreakResult {
  readonly broken: boolean;
  readonly reason?: OperatorBreakReason;
  readonly token?: string;
  readonly pid?: number;
  /** Number of legacy records encountered in this operation. */
  readonly legacyRecords: 0 | 1;
  readonly diagnostic?: { readonly code: "legacy-record"; readonly command: string };
}

/**
 * Token-fenced escape hatch, using the same one-shot SUCC election as acquisition.
 * It never owns or republishes LOCK and never sends a destructive process signal.
 * An automatic successor already elected for g excludes the operator. After g is
 * removed, a pending automatic retire sees absence and may publish a fresh LOCK.
 */
export function breakLockAsOperator(lockPath: string, options: BreakLockAsOperatorOptions): OperatorBreakResult {
  const g = options?.expectToken;
  if (typeof g !== "string" || !LOCK_TOKEN_RE.test(g)
    || (g.startsWith("legacy-") && !/^legacy-[a-f0-9]{64}$/.test(g))) {
    return { broken: false, reason: "invalid-token", legacyRecords: 0 };
  }
  const holder = readLockHolder(lockPath);
  if (holder === "absent" || holder === "corrupt") {
    return { broken: false, reason: holder, legacyRecords: 0 };
  }
  const legacyRecords = holder.kind === "legacy" ? 1 : 0;
  const context = {
    token: holder.token, pid: holder.pid, legacyRecords,
    ...(legacyRecords === 1 ? { diagnostic: {
      code: "legacy-record" as const,
      command: `h2a identity unlock --token ${holder.token} --assert-dead`
    } } : {})
  } as const;
  const refused = (reason: OperatorBreakReason): OperatorBreakResult => ({ broken: false, reason, ...context });
  if (holder.token !== g) return refused("token-mismatch");
  const operatorSelf = me();
  const verdict = classifyLiveness(holder, operatorSelf).verdict;
  if (verdict === "live") return refused("live");
  if (verdict === "undecidable" && options.assertDead !== true) return refused("assert-dead-required");

  let t = g;
  for (let depth = 0; depth < PREFIX_LOCK_MAX_CHAIN; depth++) {
    // A retry never silently changes the requested target to a replacement owner.
    const current = readLockHolder(lockPath);
    if (current === "corrupt") return refused("corrupt");
    if (current === "absent" || current.token !== g) return refused("token-mismatch");
    const successor = {
      ...makeLockRecFor(operatorSelf, newToken(), g),
      ...(verdict === "undecidable" ? { operator: true as const } : {})
    };
    const published = publishLockRecord(succPathFor(lockPath, t), successor);
    if (published.status === "error") return refused(`error:${published.code}`);
    if (published.status === "retry") return refused("busy");
    if (published.status === "exists") {
      const link = readLockRecord(succPathFor(lockPath, t));
      if (link === "absent") return refused("busy");
      if (link === "corrupt" || link.target !== g) return refused("dead-undecidable");
      const linkVerdict = classifyLiveness(link, operatorSelf).verdict;
      if (linkVerdict !== "dead") return refused(linkVerdict === "live" ? "busy" : "dead-undecidable");
      t = link.token;
      continue;
    }
    // Election makes this the sole successor. Re-read as the last action before
    // unlink, including the raw-byte legacy token, so a winning LOCK survives.
    const confirmed = readLockHolder(lockPath);
    if (confirmed === "corrupt") return refused("corrupt");
    if (confirmed === "absent" || confirmed.token !== g) {
      purgeSuccession(dirname(lockPath), lockPath, g);
      return refused("token-mismatch");
    }
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") return refused(`error:${errnoOf(error)}`);
    }
    purgeSuccession(dirname(lockPath), lockPath, g);
    return { broken: true, ...context };
  }
  return refused("dead-undecidable");
}

function lockDenied(reason: PrefixLockReason): PrefixLockLease {
  return { acquired: false, stillHeld: () => false, release: () => {}, reason };
}

/** Production acquisition. Extra JavaScript arguments cannot inject dependencies. */
export function acquirePrefixLock(
  prefix: string,
  options: AcquirePrefixLockOptions = {}
): PrefixLockLease {
  const lockPath = lockPathFor(prefix);
  try {
    mkdirSync(prefix, { recursive: true });
  } catch (e) {
    return lockDenied(`error:${errnoOf(e)}`);
  }
  const self = me();
  for (let round = 0; round < PREFIX_LOCK_MAX_ROUNDS; round++) {
    if (options?.readFirst) {
      const first = readLockHolderDetailed(lockPath);
      // An I/O failure says nothing about presence; retain ordinary errno handling.
      if (typeof first === "object" && first.kind === "io-error") {
        // Fall through to ordinary publication.
      } else if (first !== "absent") {
        if (first === "corrupt") return lockDenied("dead-undecidable");
        const firstLiveness = classifyLiveness(first, self).verdict;
        if (firstLiveness !== "dead") {
          return lockDenied(firstLiveness === "live" ? "busy" : "dead-undecidable");
        }
      }
      // A preliminary death authorizes nothing: publish, then read/classify afresh.
    }
    const tok = newToken();
    const pub = publishLockRecord(lockPath, makeLockRecFor(self, tok));
    if (pub.status === "ok") return makeLease(prefix, lockPath, tok);
    if (pub.status === "error") return lockDenied(`error:${pub.code}`);
    if (pub.status === "retry") continue;
    const cur = readLockRecord(lockPath); // fresh after EEXIST; sole entry to succession
    if (cur === "absent") continue; // released meanwhile
    if (cur === "corrupt") return lockDenied("dead-undecidable"); // fail closed
    const live = classifyLiveness(cur, self).verdict;
    if (live !== "dead") return lockDenied(live === "live" ? "busy" : "dead-undecidable");
    const next = succeedDeadToken(prefix, lockPath, cur.token, self);
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
  self: SelfIdent
): PrefixLockLease | "retry" {
  let t = g;
  for (let depth = 0; depth < PREFIX_LOCK_MAX_CHAIN; depth++) {
    const tok = newToken();
    const pub = publishLockRecord(succPathFor(lockPath, t), makeLockRecFor(self, tok, g));
    if (pub.status === "ok") {
      return retireDeadToken(prefix, lockPath, g, self);
    }
    if (pub.status === "error") return lockDenied(`error:${pub.code}`);
    if (pub.status === "retry") return "retry";
    const s = readLockRecord(succPathFor(lockPath, t));
    if (s === "absent") return "retry"; // chain already settled
    if (s === "corrupt" || s.target !== g) return lockDenied("dead-undecidable");
    const live = classifyLiveness(s, self).verdict;
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
  self: SelfIdent
): PrefixLockLease | "retry" {
  const cur = readLockRecord(lockPath);
  if (cur === "corrupt") return lockDenied("dead-undecidable"); // keep our SUCC: fail closed
  if (cur !== "absent" && cur.token === g) {
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
  const pub = publishLockRecord(lockPath, makeLockRecFor(self, tok));
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
  const stillHeld = (): boolean => {
    if (done) return false;
    const cur = readLockRecord(lockPath);
    return cur !== "absent" && cur !== "corrupt" && cur.token === token;
  };
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
  return { acquired: true, stillHeld, release, token };
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
export function isOlderThan(path: string, now: number, maxAgeMs: number): boolean {
  try {
    return now - statSync(path).mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
}
