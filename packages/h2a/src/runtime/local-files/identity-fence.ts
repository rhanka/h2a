/**
 * Identity binding fence (0.98.6) — `identity/.lock` with provable provenance
 * and AUTOMATIC recovery when the holder is provably dead.
 *
 * The 0.98.5 lock was a plain O_EXCL sentinel carrying only
 * `{pid, hostname, startedAt}`: with `reclaimStale:false` no acquisition could
 * ever prove the holder dead, so an abandoned lock blocked every session until
 * a human ran `h2a identity unlock` (incident 2026-10-11: 24 h of
 * identity_timeout across two reboots).
 *
 * This module implements the 0.98.6 spec v4 core for the identity path:
 *  - R2: records are `recordVersion:2` of protocol `identity-binding-fence-v1`
 *    with machine/boot/pid-namespace/start provenance, published through a
 *    byte-count-checked tmp + fsync + `link(2)` + directory fsync (0600), with
 *    a qualified O_EXCL fallback that is never recovered automatically. No
 *    `hostname`/`startedAt`/`acquiredAt` field is ever written (an old parser's
 *    ESRCH + hostname recovery must stay impossible).
 *  - R3: classification and recovery authorization are distinct; the verdict
 *    comes from the single classifier (`classifyLiveness`, identity protocol).
 *    Non-recoverable blockers are re-read until the deadline.
 *  - R4: recovery rides the existing succession election (one implementation,
 *    `succeedDeadToken`/`retireDeadToken`), removing exactly the dead
 *    generation and republishing exclusively.
 *  - R5: non-destructive tail neutralization for `bindings.jsonl` (a single
 *    O_APPEND `\n` behind an unterminated suffix), never concatenating a new
 *    line onto a fragment.
 *  - R7: a bounded, structured, expurgated timeout error (no raw machine-id,
 *    no absolute path).
 *
 * Non-goals kept on purpose (spec D1): legacy locks are never recovered
 * automatically; recovery is Linux + qualified-filesystem + link-publication
 * only; no CAS slot store is introduced.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statfsSync,
  statSync,
  fstatSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname } from "node:path";

import {
  LockCancelledError,
  LockTimeoutError,
  busyWaitSync,
  logicalLockId,
  notifyObserver,
  type LockObservation
} from "./locks.js";
import {
  classifyLiveness,
  errnoOf,
  makeLease,
  parseLegacyLockHolder,
  parseLockRec,
  procStartInfo,
  publishLockRecord,
  readBootId,
  readHostId,
  readPidNs,
  readTimeNs,
  succPathFor,
  succeedDeadToken,
  type FenceElectionIo,
  type HostKind,
  type LegacyLockHolder,
  type LockRec,
  type PrefixLockLease,
  type PublishStatus,
  type SelfIdent
} from "./succession-lock.js";

/** The one identity fence protocol (also carried by every v2 record). */
export const IDENTITY_BINDING_FENCE_PROTOCOL = "identity-binding-fence-v1";

/** New lock records are 0600 (R2). */
const LOCK_RECORD_MODE = 0o600;
/** Filesystems eligible for automatic recovery (R1); compared as f_type >>> 0. */
const QUALIFIED_FS_TYPES: ReadonlySet<number> = new Set([
  0xef53, // ext2/3/4
  0x58465342, // XFS
  0x9123683e, // Btrfs
  0xf2f52010 // F2FS
]);
/** `link(2)` failure codes that authorize the exclusive-create fallback (R2). */
const LINK_FALLBACK_CODES: ReadonlySet<string> = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);
/** Read errors that are genuine storage failures (the wait aborts; R3). */
const STORAGE_READ_CODES: ReadonlySet<string> = new Set(["EACCES", "EPERM", "EROFS", "EIO", "ENOSPC", "ENOTDIR", "EISDIR"]);

const MACHINE_ID_RE = /^[0-9a-f]{32}$/;
const PLATFORM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PID_NS_RE = /^pid:\[\d+\]$/;
const TIME_NS_RE = /^time:\[\d+\]$/;
const PROC_START_RE = /^proc:[0-9]+$/;
const GEN_RE = /^[A-Za-z0-9_-]{12,128}$/;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 50;
/** Suggested bounded retry delay for `interval` refusals (R7). */
const RETRY_AFTER_MS = 1000;

type RecordPlatform = "linux" | "darwin" | "win32" | "other";
type RecordPublication = "link" | "o-excl";

/** The v2 identity lock record (R2 contract). Strictly validated; never mixed
 *  with `hostname`/`startedAt`/`acquiredAt` or any unknown field. */
export interface IdentityLockRec {
  readonly recordVersion: 2;
  readonly protocol: typeof IDENTITY_BINDING_FENCE_PROTOCOL;
  readonly platform: RecordPlatform;
  readonly publication: RecordPublication;
  readonly hostKind: HostKind;
  readonly host: string | null;
  readonly boot: string | null;
  readonly ns: string | null;
  readonly timeNs: string | null;
  readonly pid: number;
  readonly start: string | null;
  readonly token: string;
  readonly fenceEpoch: string;
  readonly at: number;
  readonly target?: string;
  readonly operator?: true;
}

const V2_KEYS: ReadonlySet<string> = new Set([
  "recordVersion", "protocol", "platform", "publication", "hostKind", "host",
  "boot", "ns", "timeNs", "pid", "start", "token", "fenceEpoch", "at",
  "target", "operator"
]);

function recordPlatform(): RecordPlatform {
  const p = process.platform;
  return p === "linux" || p === "darwin" || p === "win32" ? p : "other";
}

/**
 * This process's fresh identity context (R2: renewed at every decision; the
 * machine-id falls back to /var/lib/dbus/machine-id when /etc/machine-id is
 * absent). Never memoized, unlike the upgrade path's `me()`.
 */
export function identitySelf(): SelfIdent {
  const host = readHostId({ machineIdPaths: ["/etc/machine-id", "/var/lib/dbus/machine-id"] });
  return {
    host: host.host,
    hostKind: host.hostKind,
    boot: readBootId(),
    ns: readPidNs(),
    timeNs: readTimeNs(),
    pid: process.pid,
    start: procStartInfo(process.pid)?.start ?? null
  };
}

/** Fresh 128-bit token; `token === fenceEpoch` (R2). */
function newIdentityToken(): string {
  return randomBytes(16).toString("hex");
}

function makeIdentityRecord(
  self: SelfIdent,
  token: string,
  target?: string,
  publication: RecordPublication = "link"
): IdentityLockRec {
  const platform = recordPlatform();
  // Outside Linux no anchor is given an artificial Linux format (R2): boot,
  // namespace, time namespace and start stay null there.
  return {
    recordVersion: 2,
    protocol: IDENTITY_BINDING_FENCE_PROTOCOL,
    platform,
    publication,
    hostKind: self.hostKind,
    host: self.hostKind === "machine-id" ? self.host : null,
    boot: platform === "linux" ? self.boot : null,
    ns: platform === "linux" ? self.ns : null,
    timeNs: platform === "linux" ? self.timeNs : null,
    pid: self.pid,
    start: platform === "linux" ? self.start : null,
    token,
    fenceEpoch: token,
    at: Date.now(),
    ...(target !== undefined ? { target } : {})
  };
}

function parseIdentityRecord(raw: unknown): IdentityLockRec | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (!Object.keys(o).every((key) => V2_KEYS.has(key))) return undefined;
  if (o.recordVersion !== 2 || o.protocol !== IDENTITY_BINDING_FENCE_PROTOCOL) return undefined;
  const platform = o.platform;
  if (platform !== "linux" && platform !== "darwin" && platform !== "win32" && platform !== "other") return undefined;
  const publication = o.publication;
  if (publication !== "link" && publication !== "o-excl") return undefined;
  const hostKind = o.hostKind;
  if (hostKind !== "machine-id" && hostKind !== "weak") return undefined;
  if (hostKind === "machine-id") {
    if (typeof o.host !== "string") return undefined;
    if (platform === "linux" ? !MACHINE_ID_RE.test(o.host) : !PLATFORM_UUID_RE.test(o.host)) return undefined;
    if (platform === "linux" && /^0+$/.test(o.host)) return undefined;
  } else if (o.host !== null) return undefined;
  if (o.boot !== null && (typeof o.boot !== "string" || !BOOT_ID_RE.test(o.boot))) return undefined;
  if (o.ns !== null && (typeof o.ns !== "string" || !PID_NS_RE.test(o.ns))) return undefined;
  if (o.timeNs !== null && (typeof o.timeNs !== "string" || !TIME_NS_RE.test(o.timeNs))) return undefined;
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return undefined;
  if (o.start !== null && (typeof o.start !== "string" || !PROC_START_RE.test(o.start))) return undefined;
  if (typeof o.token !== "string" || !/^[0-9a-f]{32}$/.test(o.token)) return undefined;
  if (o.fenceEpoch !== o.token) return undefined;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return undefined;
  if (o.target !== undefined && (typeof o.target !== "string" || !GEN_RE.test(o.target))) return undefined;
  if (o.operator !== undefined && (o.operator !== true || o.target === undefined)) return undefined;
  return {
    recordVersion: 2,
    protocol: IDENTITY_BINDING_FENCE_PROTOCOL,
    platform,
    publication,
    hostKind,
    host: o.host as string | null,
    boot: o.boot as string | null,
    ns: o.ns as string | null,
    timeNs: o.timeNs as string | null,
    pid: o.pid,
    start: o.start as string | null,
    token: o.token,
    fenceEpoch: o.token,
    at: o.at,
    ...(o.target !== undefined ? { target: o.target as string } : {}),
    ...(o.operator === true ? { operator: true } : {})
  };
}

/** Diagnostic view of what blocks an identity acquisition (never a raw machine-id). */
export type IdentityLockRead =
  | "absent"
  | "corrupt"
  | "unknown"
  | { kind: "io-error"; code: string }
  | { kind: "v2"; rec: IdentityLockRec; bytes: Buffer }
  | { kind: "adapter"; rec: LockRec; bytes: Buffer }
  | { kind: "legacy"; holder: LegacyLockHolder; bytes: Buffer }
  | { kind: "cull"; bytes: Buffer };

const CULL_KEYS: ReadonlySet<string> = new Set(["protocol", "fenceEpoch", "pid", "acquiredAt"]);

/**
 * Reader for `identity/.lock` and its SUCC chain. Distinguishes (R6): the v2
 * record, the 0.98.5 succession format (adapter — publication link is
 * recognized, anchors are used as-is, never completed), the legacy binding
 * record, the historical cull fence, an explicit unknown version/protocol
 * (never downgraded), corruption, absence and I/O errors.
 */
export function readIdentityLock(path: string): IdentityLockRead {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    const code = errnoOf(e);
    if (code === "ENOENT") return "absent";
    return { kind: "io-error", code };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return "corrupt";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "corrupt";
  const o = parsed as Record<string, unknown>;
  const keys = Object.keys(o);
  if ("recordVersion" in o) {
    if (o.recordVersion === 2 && o.protocol === IDENTITY_BINDING_FENCE_PROTOCOL) {
      const rec = parseIdentityRecord(parsed);
      return rec ? { kind: "v2", rec, bytes } : "corrupt";
    }
    return "unknown";
  }
  const legacyKeys = new Set(["pid", "hostname", "startedAt", "protocol", "fenceEpoch"]);
  if (keys.includes("pid") && keys.includes("hostname") && keys.includes("startedAt")
    && keys.every((key) => legacyKeys.has(key))) {
    try {
      return { kind: "legacy", holder: parseLegacyLockHolder(parsed, bytes), bytes };
    } catch {
      return "corrupt";
    }
  }
  if (keys.length === CULL_KEYS.size && keys.every((key) => CULL_KEYS.has(key))) {
    return { kind: "cull", bytes };
  }
  try {
    return { kind: "adapter", rec: parseLockRec(parsed), bytes };
  } catch {
    return "corrupt";
  }
}

/** Chain-link view for the shared election engine; unknown formats fail closed. */
function identityChainView(path: string): LockRec | "absent" | "corrupt" {
  const read = readIdentityLock(path);
  if (read === "absent") return "absent";
  if (read === "unknown" || read === "corrupt" || read.kind === "io-error"
    || read.kind === "legacy" || read.kind === "cull") {
    return "corrupt";
  }
  if (read.kind === "adapter") return read.rec;
  return identityLockView(read.rec);
}

/** LockRec-shaped view of a v2 record for the classifier (host may be null: weak). */
function identityLockView(rec: IdentityLockRec): LockRec {
  return {
    host: rec.host ?? "",
    hostKind: rec.hostKind,
    boot: rec.boot,
    ns: rec.ns,
    timeNs: rec.timeNs,
    pid: rec.pid,
    start: rec.start,
    token: rec.token,
    ...(rec.target !== undefined ? { target: rec.target } : {}),
    ...(rec.operator === true ? { operator: true } : {}),
    at: rec.at
  };
}

function identityVerdict(read: Exclude<IdentityLockRead, "absent" | { kind: "io-error" }>, self: SelfIdent): "dead" | "live" | "undecidable" {
  if (read === "corrupt" || read === "unknown" || read.kind === "legacy" || read.kind === "cull") {
    return "undecidable";
  }
  const rec = read.kind === "v2" ? identityLockView(read.rec) : read.rec;
  return classifyLiveness(rec, self, { protocol: "identity" }).verdict;
}

/**
 * R1 filesystem guard: automatic recovery is authorized only when the REAL
 * identity directory sits on an explicitly whitelisted local filesystem.
 * tmpfs, NFS, SMB, FUSE, OverlayFS, virtiofs, 9p, ZFS and unknown types or a
 * statfs error all refuse it (wait for normal release instead).
 */
export function identityFsQualified(dir: string): boolean {
  try {
    return QUALIFIED_FS_TYPES.has(statfsSync(dir).type >>> 0);
  } catch {
    return false;
  }
}

function fsyncDirectory(dir: string): void {
  // Windows: no directory open/fsync is required or possible (R2 matrix).
  if (process.platform === "win32") return;
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (e) {
    const code = errnoOf(e);
    // Darwin: a documented incapacity is tolerated, never a masked failure.
    if (process.platform === "darwin" && (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP")) return;
    throw e;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
  }
}

function ensureIdentityDir(dir: string): void {
  if (existsSync(dir)) return;
  const parent = dirname(dir);
  mkdirSync(dir, { recursive: true });
  if (process.platform === "linux" || process.platform === "darwin") {
    try {
      fsyncDirectory(dir);
      fsyncDirectory(parent);
    } catch {
      // A best-effort durability of the directory itself: the fence record's
      // own publication fsync below is the load-bearing barrier.
    }
  }
}

/**
 * Publication (R2): tmp (wx, byte-count-checked write, fsync, close) then
 * `link(2)`, then a directory fsync. On a qualified link incapacity the
 * exclusive-create fallback registers `publication:"o-excl"` — such records
 * are never recovered automatically. EEXIST stays a contention signal; real
 * storage errors are never masked.
 */
export type IdentityPublishStatus = PublishStatus & { publication?: RecordPublication };

export function publishIdentityRecord(path: string, rec: IdentityLockRec): IdentityPublishStatus {
  const pub = publishLockRecord(path, rec as unknown as LockRec, LOCK_RECORD_MODE);
  if (pub.status === "ok") {
    fsyncDirectory(dirname(path));
    return { ...pub, publication: "link" };
  }
  if (pub.status !== "error" || !LINK_FALLBACK_CODES.has(pub.code)) return pub;
  const fallback = { ...rec, publication: "o-excl" as const };
  const data = JSON.stringify(fallback);
  let fd: number | undefined;
  try {
    fd = openSync(path, "wx", LOCK_RECORD_MODE);
    let truncated = false;
    try {
      const written = writeSync(fd, data);
      truncated = written !== Buffer.byteLength(data);
      if (!truncated) fsyncSync(fd);
    } finally {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
      fd = undefined;
    }
    if (truncated) {
      try {
        unlinkSync(path);
      } catch {
        // best-effort
      }
      return { status: "error", code: "ENOSPC" };
    }
    fsyncDirectory(dirname(path));
    return { status: "ok", publication: "o-excl" };
  } catch (e) {
    const code = errnoOf(e);
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
    if (code === "EEXIST") return { status: "exists" };
    return { status: "error", code };
  }
}

// ---------------------------------------------------------------------------
// Diagnostics (R7): structured, bounded, expurgated. No raw machine-id and no
// absolute path ever reach a session surface.
// ---------------------------------------------------------------------------

let DIAGNOSTIC_KEY: Buffer | undefined;

/** Ephemeral per-process fingerprint key (R7; a standalone CLI uses its own). */
function diagnosticFingerprint(machineId: string): string {
  DIAGNOSTIC_KEY ??= randomBytes(32);
  return createHmac("sha256", DIAGNOSTIC_KEY)
    .update(`h2a-identity-diagnostic-v1\0${machineId}`)
    .digest("hex")
    .slice(0, 16);
}

export interface IdentityBlockerInfo {
  readonly blockerType: "LOCK" | "SUCC" | "unknown";
  readonly pid: number | "unknown";
  readonly machineClass: "local" | "other" | "unknown";
  readonly machineFingerprint?: string;
  readonly bootClass: "current" | "other" | "unknown";
  readonly ns: string | "unknown";
  readonly start: string | "unknown";
  readonly generation: string;
  readonly target: string | "unknown";
  readonly reasonCode: string;
  readonly reason: string;
  readonly retryCondition: "interval" | "blocker-change";
}

export interface IdentityLockDiagnostic extends IdentityBlockerInfo {
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly lock: string;
  readonly stable: boolean;
  readonly retryAfterMs?: number;
  /** R6 conditional literal, present only for a stable legacy blocker. */
  readonly legacyNote?: string;
  /** Operator command with a root placeholder, never an absolute path. */
  readonly command?: string;
}

const LEGACY_NOTE =
  "The same legacy lock was observed throughout this attempt. If its owner is active, "
  + "normal release will allow acquisition. If its owner has stopped, this format lacks "
  + "the provenance required for automatic recovery; retrying without a relevant change "
  + "cannot establish it.";

/**
 * Why an undecidable v2/adapter holder cannot be recovered. This mirrors the
 * classifier's gates (the verdict itself is never decided here) to name the
 * first missing/malformed/mismatched anchor precisely.
 */
function identityUndecidableReason(rec: LockRec, self: SelfIdent): { reasonCode: string; reason: string } {
  if (rec.hostKind !== "machine-id" || self.hostKind !== "machine-id") {
    return { reasonCode: "undecidable-weak-host", reason: "no strong machine identity (machine-id) is known on both sides" };
  }
  if (typeof rec.host !== "string" || !MACHINE_ID_RE.test(rec.host) || !MACHINE_ID_RE.test(self.host)) {
    return { reasonCode: "undecidable-machine", reason: "the machine identity is absent or malformed on one side" };
  }
  if (rec.host !== self.host) {
    return { reasonCode: "foreign-machine", reason: "the holder record belongs to a different machine" };
  }
  if (rec.ns === null || self.ns === null || !PID_NS_RE.test(rec.ns) || !PID_NS_RE.test(self.ns)) {
    return { reasonCode: "undecidable-namespace", reason: "the pid namespace is absent or malformed on one side" };
  }
  if (rec.ns !== self.ns) {
    return { reasonCode: "foreign-namespace", reason: "the holder record was written in a different pid namespace" };
  }
  if (rec.boot === null || self.boot === null || !BOOT_ID_RE.test(rec.boot) || !BOOT_ID_RE.test(self.boot)) {
    return { reasonCode: "undecidable-boot", reason: "the boot identity is absent or malformed on one side" };
  }
  // Same frame, live probe inconclusive: distinguish the start/zombie cases.
  if (rec.start === null) {
    return { reasonCode: "undecidable-start", reason: "the recorded process start time is unknown, so a live PID cannot be attributed" };
  }
  return { reasonCode: "undecidable-probe", reason: "the recorded process could not be proven alive or dead from this frame" };
}

function blockerFromRead(
  read: Exclude<IdentityLockRead, "absent" | { kind: "io-error" }>,
  self: SelfIdent,
  blockerType: "LOCK" | "SUCC"
): IdentityBlockerInfo {
  const unknown: IdentityBlockerInfo = {
    blockerType,
    pid: "unknown",
    machineClass: "unknown",
    bootClass: "unknown",
    ns: "unknown",
    start: "unknown",
    generation: "unknown",
    target: "unknown",
    reasonCode: "corrupt-lock-record",
    reason: "the holder record is empty, unreadable or corrupted",
    retryCondition: "blocker-change"
  };
  if (read === "corrupt") return unknown;
  if (read === "unknown") {
    return { ...unknown, reasonCode: "unknown-record-version", reason: "the holder record carries an unknown version or protocol and is never downgraded" };
  }
  if (read.kind === "cull") {
    return { ...unknown, reasonCode: "cull-legacy-record", reason: "a historical cull fence has no recovery provenance and no break command" };
  }
  if (read.kind === "legacy") {
    return {
      ...unknown,
      pid: read.holder.pid,
      generation: read.holder.token,
      reasonCode: "legacy-record",
      reason: "a lock written by h2a <= 0.98.5 lacks the provenance required for automatic recovery",
      retryCondition: "blocker-change"
    };
  }
  const isV2 = read.kind === "v2";
  const v2 = isV2 ? (read as { rec: IdentityLockRec }).rec : undefined;
  const view = isV2 ? identityLockView(v2 as IdentityLockRec) : (read as { rec: LockRec }).rec;
  const verdict = classifyLiveness(view, self, { protocol: "identity" }).verdict;
  const machineClass: "local" | "other" | "unknown" =
    view.hostKind === "machine-id" && self.hostKind === "machine-id" && typeof view.host === "string" && MACHINE_ID_RE.test(view.host)
      ? view.host === self.host ? "local" : "other"
      : "unknown";
  const bootClass: "current" | "other" | "unknown" =
    view.boot !== null && self.boot !== null && BOOT_ID_RE.test(view.boot) && BOOT_ID_RE.test(self.boot)
      ? view.boot === self.boot ? "current" : "other"
      : "unknown";
  const base = {
    blockerType,
    pid: view.pid,
    machineClass,
    ...(machineClass !== "unknown" && typeof view.host === "string"
      ? { machineFingerprint: diagnosticFingerprint(view.host) }
      : {}),
    bootClass,
    ns: view.ns ?? "unknown",
    start: view.start ?? "unknown",
    generation: view.token,
    target: view.target ?? "unknown"
  };
  if (verdict === "live") {
    return {
      ...base,
      reasonCode: "holder-live",
      reason: "the recorded holder process is alive; its normal release will allow acquisition",
      retryCondition: "interval" as const
    };
  }
  if (verdict === "dead") {
    if (isV2 && v2 && v2.publication === "o-excl") {
      return {
        ...base,
        reasonCode: "publication-o-excl",
        reason: "the holder record was published without atomic link publication and is never recovered automatically",
        retryCondition: "blocker-change" as const
      };
    }
    if (process.platform !== "linux" || (isV2 && v2 && v2.platform !== "linux")) {
      return {
        ...base,
        reasonCode: "platform-unsupported",
        reason: "automatic recovery is authorized on Linux only",
        retryCondition: "blocker-change" as const
      };
    }
    return {
      ...base,
      reasonCode: "fs-not-qualified",
      reason: "the identity directory's filesystem does not qualify for automatic recovery",
      retryCondition: "blocker-change" as const
    };
  }
  const { reasonCode, reason } = identityUndecidableReason(view, self);
  const foreign = reasonCode.startsWith("foreign-");
  return {
    ...base,
    reasonCode,
    reason,
    retryCondition: foreign ? "blocker-change" as const : "interval" as const
  };
}

/** R7 common literal; absent values render as "unknown". */
function diagnosticMessage(d: IdentityLockDiagnostic): string {
  const unknown = "unknown";
  let text =
    `Identity unavailable after ${d.elapsedMs} ms; budget ${d.budgetMs} ms. `
    + `Lock: ${d.lock}. `
    + `Last observed blocker: ${d.blockerType}, pid=${d.pid === "unknown" ? unknown : d.pid}, `
    + `machine=${d.machineClass}${d.machineFingerprint ? `/${d.machineFingerprint}` : ""}, `
    + `boot=${d.bootClass}, namespace=${d.ns}, start=${d.start}, `
    + `generation=${d.generation}, target=${d.target}. `
    + `Automatic recovery is not authorized: ${d.reasonCode} — ${d.reason}.`;
  if (d.retryCondition === "interval" && d.retryAfterMs !== undefined) {
    text += ` Retry is possible after about ${d.retryAfterMs} ms.`;
  }
  if (d.legacyNote !== undefined) text += ` ${d.legacyNote}`;
  return text;
}

export class IdentityLockTimeoutError extends LockTimeoutError {
  readonly diagnostic: IdentityLockDiagnostic;

  constructor(lockPath: string, diagnostic: IdentityLockDiagnostic) {
    super(lockPath, undefined, diagnostic.budgetMs);
    this.name = "LockTimeoutError";
    this.diagnostic = diagnostic;
    this.message = diagnosticMessage(diagnostic);
  }
}

// ---------------------------------------------------------------------------
// Acquisition.
// ---------------------------------------------------------------------------

export interface IdentityFenceOptions {
  /** Monotone budget bounding the whole wait (default 5000 ms). */
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  /** L0 passive observation, same contract as the store locks. */
  readonly observe?: (event: LockObservation) => void;
  /** Cooperative cancellation while WAITING (async variant only). */
  readonly signal?: AbortSignal;
  /** Diagnostic label (default: the lock path relative to the store root). */
  readonly relativeLockPath?: string;
}

export interface IdentityFenceLease extends PrefixLockLease {
  /** Publication actually used for this fence (o-excl is never recovered). */
  readonly publication: RecordPublication;
  /** True when acquisition recovered a provably dead previous holder. */
  readonly recovered: boolean;
}

interface BlockerObservation {
  readonly info: IdentityBlockerInfo;
  /** Stability key (token for records; bytes+dev/ino for opaque formats). */
  readonly key: string;
}

function blockerKey(read: Exclude<IdentityLockRead, "absent" | { kind: "io-error" }>, lockPath: string): string {
  if (read === "corrupt" || read === "unknown") {
    return `${read}:${sha256Bytes(readBytesOf(lockPath))}`;
  }
  if (read.kind === "legacy" || read.kind === "cull") {
    const st = statOf(lockPath);
    return `${read.kind}:${sha256Bytes(read.bytes)}:${st ? `${st.dev}/${st.ino}` : "unknown"}`;
  }
  return `${read.kind}:${read.rec.token}`;
}

function readBytesOf(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch {
    return Buffer.alloc(0);
  }
}

function statOf(path: string): { dev: number; ino: number } | undefined {
  try {
    const st = statSync(path);
    return { dev: st.dev, ino: st.ino };
  } catch {
    return undefined;
  }
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type IdentityBlockerRead = Exclude<IdentityLockRead, "absent" | { kind: "io-error" }>;

interface SuccessionScan {
  /** The LOCK holder that blocks (dead or not). */
  readonly lock: IdentityBlockerRead;
  /**
   * The SUCC link effectively blocking succession recovery, when the LOCK
   * holder is dead but a link of the chain is not (R4): the link is the real
   * blocker and is named in the diagnostic. "unknown" marks a chain that
   * failed (corrupt link, or depth 8 reached).
   */
  readonly blockingLink?: IdentityLockRead | "unknown";
}

/** Read the chain up to the SUCC effectively blocking (R4 readFirst). */
function scanSuccession(lockPath: string, self: SelfIdent, first: IdentityBlockerRead): SuccessionScan {
  if (first === "corrupt" || first === "unknown" || first.kind === "legacy" || first.kind === "cull") {
    return { lock: first };
  }
  if (identityVerdict(first, self) !== "dead") return { lock: first };
  // The LOCK holder is provably dead: walk the SUCC chain one link at a time.
  let t = first.rec.token;
  for (let depth = 0; depth < 8; depth++) {
    const link = readIdentityLock(succPathFor(lockPath, t));
    if (link === "absent") return { lock: first };
    if (link === "corrupt" || link === "unknown" || link.kind === "io-error"
      || link.kind === "legacy" || link.kind === "cull") {
      return { lock: first, blockingLink: link };
    }
    if (identityVerdict(link, self) !== "dead") return { lock: first, blockingLink: link };
    t = link.rec.token;
  }
  return { lock: first, blockingLink: "unknown" };
}

function identityElectionIo(self: SelfIdent): FenceElectionIo {
  return {
    makeRec: (s, token, target) => makeIdentityRecord(s, token, target) as unknown as LockRec,
    readRecord: identityChainView,
    classify: (r, s) => classifyLiveness(r, s, { protocol: "identity" }).verdict,
    publish: (path, rec) => publishIdentityRecord(path, rec as unknown as IdentityLockRec)
  };
}

function recoveryAuthorized(first: { kind: "v2"; rec: IdentityLockRec } | { kind: "adapter"; rec: LockRec }, dir: string): boolean {
  if (process.platform !== "linux") return false;
  if (first.kind === "v2" && (first.rec.platform !== "linux" || first.rec.publication !== "link")) return false;
  // The 0.98.5 succession format publishes by synchronized tmp + link (R2
  // adapter): recognized as link, anchors used as-is.
  return identityFsQualified(dir);
}

function identityLease(lease: PrefixLockLease, publication: RecordPublication, recovered: boolean): IdentityFenceLease {
  return {
    ...lease,
    publication,
    recovered
  };
}

interface AcquireOutcome {
  readonly lease?: IdentityFenceLease;
  readonly blocker?: BlockerObservation;
  readonly retry?: boolean;
}

function unreadableBlocker(code: string): BlockerObservation {
  return {
    key: `io-error:${code}`,
    info: {
      blockerType: "unknown",
      pid: "unknown",
      machineClass: "unknown",
      bootClass: "unknown",
      ns: "unknown",
      start: "unknown",
      generation: "unknown",
      target: "unknown",
      reasonCode: "holder-unreadable",
      reason: "the holder record could not be read",
      retryCondition: "interval"
    }
  };
}

/**
 * One acquisition attempt round. Returns a lease, the blocker observation to
 * wait on, or a retry signal. Never throws for contention; storage errors
 * propagate (errno preserved for the worker's cause classification).
 */
function acquireIdentityRound(lockPath: string, dir: string, self: SelfIdent): AcquireOutcome {
  const read = readIdentityLock(lockPath);
  if (typeof read === "object" && read.kind === "io-error") {
    if (STORAGE_READ_CODES.has(read.code)) {
      const err = new Error(`identity fence read failed: ${read.code}`);
      (err as NodeJS.ErrnoException).code = read.code;
      throw err;
    }
    // Transient read failure: treat as a blocker we cannot name yet.
    return { blocker: unreadableBlocker(read.code) };
  }
  if (read === "absent") {
    const tok = newIdentityToken();
    const rec = makeIdentityRecord(self, tok);
    const pub = publishIdentityRecord(lockPath, rec);
    if (pub.status === "ok") {
      return { lease: identityLease(makeLease(dir, lockPath, tok, identityElectionIo(self)), pub.publication ?? "link", false) };
    }
    if (pub.status === "exists" || pub.status === "retry") return { retry: true };
    const err = new Error(`identity fence publish failed: ${pub.code}`);
    (err as NodeJS.ErrnoException).code = pub.code;
    throw err;
  }
  // A blocker exists: classify fresh, then decide recovery or wait (R3/R4).
  const scan = scanSuccession(lockPath, self, read);
  if (scan.blockingLink === undefined) {
    // The LOCK itself is the effective blocker. Dead + authorized ⇒ recovery.
    if (typeof read === "object" && (read.kind === "v2" || read.kind === "adapter")
      && identityVerdict(read, self) === "dead" && recoveryAuthorized(read, dir)) {
      const g = read.rec.token;
      const next = succeedDeadToken(dir, lockPath, g, self, identityElectionIo(self));
      if (next === "retry") return { retry: true };
      if (next.acquired) {
        return { lease: identityLease(next, "link", true) };
      }
      if (next.reason !== undefined && next.reason.startsWith("error:")) {
        const code = next.reason.slice("error:".length);
        const err = new Error(`identity fence recovery failed: ${code}`);
        (err as NodeJS.ErrnoException).code = code;
        throw err;
      }
      // busy: a rival live successor won the election; dead-undecidable: the
      // chain is not walkable. Both wait for a relevant change (R4).
      return {
        blocker: {
          key: blockerKey(read, lockPath),
          info: {
            ...blockerFromRead(read, self, "LOCK"),
            reasonCode: "succession-contested",
            reason: "another live successor won the election for the dead holder",
            retryCondition: "interval"
          }
        }
      };
    }
    return {
      blocker: {
        key: blockerKey(read, lockPath),
        info: blockerFromRead(read, self, "LOCK")
      }
    };
  }
  if (scan.blockingLink === "unknown") {
    // Chain exhausted at depth 8 (R4): bounded wait, no blind purge.
    return {
      blocker: {
        key: "chain-exhausted",
        info: {
          ...blockerFromRead(read, self, "LOCK"),
          blockerType: "SUCC",
          reasonCode: "succ-chain-exhausted",
          reason: "the succession chain reached its depth limit; no blind purge is performed",
          retryCondition: "blocker-change"
        }
      }
    };
  }
  if (scan.blockingLink === "absent") {
    // Settled between the scan and here: re-evaluate from scratch.
    return { retry: true };
  }
  const link = scan.blockingLink;
  if (link === "corrupt" || (typeof link === "object" && link.kind !== "io-error")) {
    return {
      blocker: {
        key: `SUCC@${blockerKey(link, lockPath)}`,
        info: blockerFromRead(link, self, "SUCC")
      }
    };
  }
  const code = typeof link === "object" && link.kind === "io-error" ? link.code : "EIO";
  return { blocker: { key: `SUCC@link-io:${code}`, info: unreadableBlocker(code).info } };
}

function defaultRelativeLockPath(lockPath: string): string {
  return `${basename(dirname(lockPath))}/${basename(lockPath)}`;
}

interface WaitState {
  firstKey?: string;
  lastKey?: string;
  stable: boolean;
  firstInfo?: IdentityBlockerInfo;
  lastInfo?: IdentityBlockerInfo;
}

function observeBlocker(state: WaitState, blocker: BlockerObservation): void {
  if (state.firstKey === undefined) {
    state.firstKey = blocker.key;
    state.firstInfo = blocker.info;
  }
  if (state.lastKey !== undefined && state.lastKey !== blocker.key) {
    state.stable = false;
  }
  state.lastKey = blocker.key;
  state.lastInfo = blocker.info;
}

function timeoutDiagnostic(
  lockPath: string,
  state: WaitState,
  startedAt: number,
  budgetMs: number,
  relative: string
): IdentityLockTimeoutError {
  const info = state.lastInfo ?? state.firstInfo;
  const stable = state.stable && state.lastKey !== undefined;
  const isStableLegacy = stable && info?.reasonCode === "legacy-record";
  const diagnostic: IdentityLockDiagnostic = {
    elapsedMs: Date.now() - startedAt,
    budgetMs,
    lock: relative,
    stable,
    ...(info
      ? info
      : {
        blockerType: "unknown" as const,
        pid: "unknown" as const,
        machineClass: "unknown" as const,
        bootClass: "unknown" as const,
        ns: "unknown" as const,
        start: "unknown" as const,
        generation: "unknown",
        target: "unknown" as const,
        reasonCode: "no-observation",
        reason: "no holder record could be observed during this attempt",
        retryCondition: "interval" as const
      }),
    ...(info && info.retryCondition === "interval" ? { retryAfterMs: RETRY_AFTER_MS } : {}),
    ...(isStableLegacy
      ? {
        legacyNote: LEGACY_NOTE,
        command: `h2a identity unlock --root <validated-store-root> --token ${info.generation} --assert-dead`
      }
      : {})
  };
  return new IdentityLockTimeoutError(lockPath, diagnostic);
}

/** Common per-round state shared by the sync and async acquisition loops. */
interface FenceLoopContext {
  readonly lockPath: string;
  readonly dir: string;
  readonly relative: string;
  readonly lock: string;
  readonly observe?: (event: LockObservation) => void;
  readonly startedAt: number;
  readonly deadline: number;
  readonly state: WaitState;
  attempts: number;
}

function newLoopContext(lockPath: string, options: IdentityFenceOptions): FenceLoopContext {
  const dir = dirname(lockPath);
  ensureIdentityDir(dir);
  const observe = options.observe;
  return {
    lockPath,
    dir,
    relative: options.relativeLockPath ?? defaultRelativeLockPath(lockPath),
    lock: observe ? logicalLockId(lockPath) : "",
    ...(observe ? { observe } : {}),
    startedAt: Date.now(),
    deadline: Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    state: { stable: true },
    attempts: 0
  };
}

/** Throw the bounded R7 diagnostic when the budget is spent; else return. */
function fenceTimedOut(ctx: FenceLoopContext): void {
  if (Date.now() < ctx.deadline) return;
  notifyObserver(ctx.observe, {
    lock: ctx.lock,
    event: "timeout",
    waitMs: Date.now() - ctx.startedAt,
    attempts: ctx.attempts
  });
  throw timeoutDiagnostic(
    ctx.lockPath,
    ctx.state,
    ctx.startedAt,
    ctx.deadline - ctx.startedAt,
    ctx.relative
  );
}

/** Synchronous identity fence (CLI / sync binding writer). */
export function withIdentityFenceSync<T>(
  lockPath: string,
  fn: (lease: IdentityFenceLease) => T,
  options: IdentityFenceOptions = {}
): T {
  const ctx = newLoopContext(lockPath, options);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  notifyObserver(ctx.observe, { lock: ctx.lock, event: "wait" });
  let lease: IdentityFenceLease | undefined;
  for (;;) {
    const outcome = acquireIdentityRoundOnce(ctx);
    if (outcome !== undefined) {
      lease = outcome;
      break;
    }
    fenceTimedOut(ctx);
    busyWaitSync(pollMs);
  }
  const acquiredAt = Date.now();
  try {
    return fn(lease);
  } finally {
    lease.release();
    notifyObserver(ctx.observe, {
      lock: ctx.lock,
      event: "released",
      holdMs: Date.now() - acquiredAt
    });
  }
}

/** Asynchronous identity fence (the identity worker's binding transaction). */
export async function withIdentityFence<T>(
  lockPath: string,
  fn: (lease: IdentityFenceLease) => T | Promise<T>,
  options: IdentityFenceOptions = {}
): Promise<T> {
  const ctx = newLoopContext(lockPath, options);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const signal = options.signal;
  notifyObserver(ctx.observe, { lock: ctx.lock, event: "wait" });
  let lease: IdentityFenceLease | undefined;
  for (;;) {
    if (signal?.aborted) {
      notifyObserver(ctx.observe, {
        lock: ctx.lock,
        event: "timeout",
        waitMs: Date.now() - ctx.startedAt,
        attempts: ctx.attempts
      });
      throw new LockCancelledError(lockPath, String(signal.reason ?? "aborted"));
    }
    const outcome = acquireIdentityRoundOnce(ctx);
    if (outcome !== undefined) {
      lease = outcome;
      break;
    }
    fenceTimedOut(ctx);
    // Cooperative cancellation between poll attempts only; a transaction
    // already entered under the fence finishes (released in the finally).
    if (signal !== undefined) {
      if (signal.aborted) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
  }
  const acquiredAt = Date.now();
  try {
    return await fn(lease);
  } finally {
    lease.release();
    notifyObserver(ctx.observe, {
      lock: ctx.lock,
      event: "released",
      holdMs: Date.now() - acquiredAt
    });
  }
}

/**
 * One acquisition round inside a loop context: the lease on success, undefined
 * when the round must wait (blocker observed) or immediately re-run (retry).
 */
function acquireIdentityRoundOnce(ctx: FenceLoopContext): IdentityFenceLease | undefined {
  ctx.attempts += 1;
  const self = identitySelf();
  const outcome = acquireIdentityRound(ctx.lockPath, ctx.dir, self);
  if (outcome.lease !== undefined) {
    notifyObserver(ctx.observe, {
      lock: ctx.lock,
      event: "acquired",
      waitMs: Date.now() - ctx.startedAt,
      attempts: ctx.attempts
    });
    return outcome.lease;
  }
  if (outcome.blocker !== undefined) observeBlocker(ctx.state, outcome.blocker);
  return undefined;
}

// ---------------------------------------------------------------------------
// R5 — non-destructive tail neutralization for the shared binding journal.
// ---------------------------------------------------------------------------

export interface TailNeutralized {
  readonly offset: number;
  readonly length: number;
  readonly sha256: string;
}

const TAIL_CHUNK = 64 * 1024;

function readRange(fd: number, start: number, end: number): Buffer {
  const buffer = Buffer.alloc(end - start);
  let read = 0;
  while (read < buffer.length) {
    const n = readSync(fd, buffer, read, buffer.length - read, start + read);
    if (n === 0) throw new Error("binding journal changed during read");
    read += n;
  }
  return buffer;
}

/**
 * Terminate an unterminated final suffix of the journal with exactly one
 * appended `\n` (R5). No byte before the suffix is ever rewritten or removed;
 * the operation is idempotent. `offset`/`length` are in bytes, `sha256` covers
 * the ORIGINAL suffix without the added separator; no content is exposed.
 */
export function neutralizeBindingsTail(file: string): TailNeutralized | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r+");
  } catch (e) {
    if (errnoOf(e) === "ENOENT") return undefined;
    throw e;
  }
  try {
    const before = fstatSync(fd);
    if (before.size === 0) return undefined;
    // Locate the last line feed (bounded reverse scan).
    let lastNl = -1;
    for (let probe = before.size; probe > 0 && lastNl === -1;) {
      const start = Math.max(0, probe - TAIL_CHUNK);
      const chunk = readRange(fd, start, probe);
      const idx = chunk.lastIndexOf(10);
      if (idx !== -1) lastNl = start + idx;
      probe = start;
    }
    const suffixStart = lastNl === -1 ? 0 : lastNl + 1;
    const st1 = fstatSync(fd);
    if (st1.dev !== before.dev || st1.ino !== before.ino || st1.size !== before.size) {
      // Possession/inode changed under us: re-read fresh, apply nothing stale.
      return neutralizeBindingsTail(file);
    }
    if (suffixStart >= st1.size) return undefined; // already terminated: no-op
    const suffix = readRange(fd, suffixStart, st1.size);
    const st2 = fstatSync(fd);
    if (st2.dev !== st1.dev || st2.ino !== st1.ino || st2.size !== st1.size) {
      return neutralizeBindingsTail(file);
    }
    // Append exactly one separator, byte-count checked, then fsync file + dir.
    const appendFd = openSync(file, "a");
    try {
      const written = writeSync(appendFd, "\n");
      if (written !== 1) {
        const err = new Error("binding journal separator short write");
        (err as NodeJS.ErrnoException).code = "ENOSPC";
        throw err;
      }
      fsyncSync(appendFd);
    } finally {
      try {
        closeSync(appendFd);
      } catch {
        // best-effort
      }
    }
    fsyncDirectory(dirname(file));
    return {
      offset: suffixStart,
      length: st2.size - suffixStart,
      sha256: sha256Bytes(suffix)
    };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Attest the journal's durability after a recovery (R5 idempotence): a visible
 * separator whose previous fsync is unattested is fsynced now, content-free.
 */
export function attestBindingsTailDurable(file: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r+");
    fsyncSync(fd);
  } catch (e) {
    if (errnoOf(e) === "ENOENT") return;
    throw e;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
  }
  if (process.platform !== "win32") {
    try {
      fsyncDirectory(dirname(file));
    } catch {
      // best-effort: the file fsync above is the load-bearing barrier
    }
  }
}
