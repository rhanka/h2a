/**
 * Advisory file locking for the local-files store (DEC-036).
 *
 * The store layout (DEC-031) was originally written under the assumption that
 * a single CLI/MCP process owned the `<root>/.h2a/` tree at any given time.
 * In practice, multiple `h2a` invocations and an `h2a mcp-serve` process can
 * race on the same root. Append-only JSONL files (`registry/instances.jsonl`,
 * `negotiations/<id>/journal.jsonl`) survive this via the `PIPE_BUF`
 * atomicity of `appendFileSync` for sub-4KB lines, but every read-then-write
 * critical section (dup detection on `registerInstance`, hash-chain link on
 * `appendNegotiationEvent`, the whole `stabilizeNegotiation` transaction)
 * remains a race.
 *
 * This module publishes complete, synced owner records with an exclusive hard
 * link from a private same-directory file. No empty sentinel is ever visible.
 * Where the filesystem cannot link, publication falls back to exclusive-create
 * (`O_EXCL`), which still never replaces an owner.
 * It is intentionally limited to **same-machine** coordination: a lock file
 * holding a foreign-host PID would be treated as live (we cannot
 * `process.kill(pid, 0)` across hosts). Cross-machine sharing of a store
 * remains out of scope (V2).
 *
 * Recovery requires a death proof on qualified local storage. Opaque legacy
 * files additionally require inode timestamps before a coherent current boot.
 * Reclaimers serialize, sync a private quarantine copy before removal, and
 * revalidate the generation; releases also verify their own generation.
 */

import { constants, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readlinkSync, statfsSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname } from "node:path";
import { classifyLiveness, makeLockRec, me, parseLockRec, type LockRec } from "./succession-lock.js";
import { syncDirectory } from "../identity/durable.js";

/**
 * A passive observation of a lock critical section, for the L0 phase trace.
 * `lock` is a LOGICAL id (the lock's parent directory name, e.g. `registry` /
 * `identity`) — never the lock owner payload or any binding content. Emitting
 * an observation never changes the lock's timeout, poll or reclaim policy, and
 * a throwing observer can never break the critical section.
 */
export interface LockObservation {
  readonly lock: string;
  readonly event: "wait" | "acquired" | "released" | "timeout";
  readonly waitMs?: number;
  readonly holdMs?: number;
  readonly attempts?: number;
}

const lockObserver = new AsyncLocalStorage<(event: LockObservation) => void>();
/** Scope worker progress to this resolution, including possession's registry wait. */
export function observeLocks<T>(observe: (event: LockObservation) => void, fn: () => T): T {
  return lockObserver.run(observe, fn);
}

export function logicalLockId(lockPath: string): string {
  try {
    const label = basename(dirname(lockPath)) || basename(lockPath);
    return label.length > 64 ? label.slice(0, 64) : label;
  } catch {
    return "lock";
  }
}

export function notifyObserver(
  observe: ((event: LockObservation) => void) | undefined,
  event: LockObservation
): void {
  for (const callback of [observe, lockObserver.getStore()]) {
    try { callback?.(event); } catch { /* passive observations cannot affect locking */ }
  }
}

export interface LockOwner {
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: string;
  /** Optional protocol marker for a lock with a stronger caller invariant. */
  readonly protocol?: string;
  /** Caller-issued generation for a fenced critical section. */
  readonly fenceEpoch?: string;
  /** Boot, namespace and process-start provenance for new advisory locks. */
  readonly provenance?: LockRec;
}

export interface WithLockOptions {
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  /**
   * Extra immutable identity carried by the lock owner record.  Callers that
   * need a structural fence use this to bind the lock to a protocol + epoch.
   */
  readonly ownerMetadata?: Readonly<Pick<LockOwner, "protocol" | "fenceEpoch">>;
  /**
   * Whether a dead same-host holder may be reclaimed.  Destructive protocols
   * deliberately disable this: an ambiguous fence is a refusal, never a
   * reason to silently continue.
   */
  readonly reclaimStale?: boolean;
  /**
   * Passive instrumentation hook (L0). Called on `wait` (once, when the first
   * acquire attempt actually fails by contention — never before an uncontended
   * acquisition), `acquired` (with `waitMs`/`attempts`), `released` (with
   * `holdMs`) and `timeout` (with `waitMs`). It cannot change locking behaviour.
   */
  readonly observe?: (event: LockObservation) => void;
  /**
   * L2 cooperative cancellation (async `withLock` only). When aborted while
   * WAITING for the lock, the wait stops and `withLock` rejects with a
   * `LockCancelledError` — the worker then stops before entering a new critical
   * section. Once the lock is HELD, `fn` runs to completion (a transaction
   * already entered finishes cleanly); the signal never interrupts a held
   * section, so no half-written state is left behind.
   */
  readonly signal?: AbortSignal;
}

/** Thrown by the async `withLock` when its signal aborts DURING the wait. */
export class LockCancelledError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string, reason?: string) {
    super(`LockCancelledError: acquisition of ${lockPath} was cancelled${reason ? ` (${reason})` : ""}`);
    this.name = "LockCancelledError";
    this.lockPath = lockPath;
  }
}

export class LockTimeoutError extends Error {
  readonly lockPath: string;
  readonly lastSeenOwner?: LockOwner;

  constructor(lockPath: string, lastSeenOwner: LockOwner | undefined, timeoutMs: number) {
    const ownerSuffix = lastSeenOwner
      ? ` held by ${JSON.stringify(lastSeenOwner)}`
      : "";
    super(
      `LockTimeoutError: could not acquire ${lockPath} within ${timeoutMs}ms${ownerSuffix}`
    );
    this.name = "LockTimeoutError";
    this.lockPath = lockPath;
    this.lastSeenOwner = lastSeenOwner;
  }
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 50;

/**
 * `link(2)` failure codes that authorize the exclusive-create fallback: the
 * same hardlink-unavailable set as `identity-fence.ts` (`LINK_FALLBACK_CODES`
 * there). Any other error (EEXIST contention, EACCES/EIO/ENOSPC storage
 * failures) is rethrown, never masked by the fallback. Kept local (not
 * imported) because `identity-fence.ts` imports this module.
 */
const LINK_FALLBACK_CODES: ReadonlySet<string> = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

function tryParseOwner(raw: string): LockOwner | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<LockOwner>;
    if (
      parsed &&
      Number.isSafeInteger(parsed.pid) && (parsed.pid ?? 0) > 0 &&
      typeof parsed.hostname === "string" &&
      typeof parsed.startedAt === "string"
    ) {
      return {
        pid: parsed.pid!,
        hostname: parsed.hostname,
        startedAt: parsed.startedAt,
        ...(typeof parsed.protocol === "string" ? { protocol: parsed.protocol } : {}),
        ...(typeof parsed.fenceEpoch === "string" ? { fenceEpoch: parsed.fenceEpoch } : {}),
        ...(parsed.provenance ? { provenance: parseLockRec(parsed.provenance) } : {})
      };
    }
  } catch {
    /* malformed — fall through */
  }
  return undefined;
}

function pidIsAliveOnSameHost(owner: LockOwner, selfHostname: string): boolean {
  if (owner.hostname !== selfHostname) {
    // Cross-host owner: we cannot probe its liveness. Treat as live to err on
    // the side of safety (the caller will then time out, which is the
    // expected behaviour — cross-machine store sharing is out of scope V1).
    return true;
  }
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM means the process exists but is owned by another user — still
    // live for our purposes.
    return true;
  }
}

interface LockCapture { stat: Stats; raw: Buffer; }
function capture(lockPath: string): LockCapture | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) return undefined;
    const raw = readFileSync(fd);
    const result = { stat, raw };
    return unchanged(lockPath, result) ? result : undefined;
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function unchanged(lockPath: string, previous: LockCapture): boolean {
  try {
    const st = lstatSync(lockPath), old = previous.stat;
    return st.isFile() && st.dev === old.dev && st.ino === old.ino && st.size === old.size
      && st.mtimeMs === old.mtimeMs && st.ctimeMs === old.ctimeMs && st.nlink === old.nlink
      && st.uid === old.uid && st.mode === old.mode && readFileSync(lockPath).equals(previous.raw);
  } catch { return false; }
}

function qualified(lockPath: string): boolean {
  try { return process.platform === "linux" && new Set([0xef53, 0x58465342, 0x9123683e, 0xf2f52010]).has(statfsSync(dirname(lockPath)).type >>> 0); }
  catch { return false; }
}

/** No age-only recovery: both inode timestamps must precede a coherent boot.
 * ctime prevents a live holder's backdated payload/mtime from qualifying. */
function predatesBoot(st: Stats): boolean {
  try {
    if (readlinkSync('/proc/self/ns/time') !== 'time:[4026531834]') return false;
    const lines = readFileSync('/proc/stat', 'utf8').split('\n').filter(line => line.startsWith('btime '));
    if (lines.length !== 1 || !/^btime [0-9]+$/.test(lines[0])) return false;
    const before = Date.now(), up = readFileSync('/proc/uptime', 'utf8'), after = Date.now();
    const match = /^([0-9]+(?:\.[0-9]+)?)\s+[0-9]+(?:\.[0-9]+)?\s*$/.exec(up);
    if (!match || after < before || after - before > 2000) return false;
    const boot = Number(lines[0].slice(6)) * 1000, uptime = Number(match[1]) * 1000;
    const low = before - uptime, high = after - uptime;
    return Number.isFinite(boot) && Number.isFinite(uptime) && Math.max(low - boot, boot - high, 0) <= 2000
      && Math.max(st.mtimeMs, st.ctimeMs) < Math.min(boot, low) - 2000;
  } catch { return false; }
}

function reclaimable(lockPath: string, seen: LockCapture, selfHostname: string): boolean {
  if (!qualified(lockPath) || seen.stat.uid !== process.geteuid?.()) return false;
  const owner = tryParseOwner(seen.raw.toString('utf8'));
  if (owner?.provenance) return owner.pid === owner.provenance.pid
    && classifyLiveness(owner.provenance, me(), { protocol: "identity" }).verdict === "dead";
  if (owner) return !pidIsAliveOnSameHost(owner, selfHostname);
  return seen.stat.nlink === 1 && predatesBoot(seen.stat);
}

/** Never unlink a replacement, including when a caller lost ownership. */
function release(lockPath: string, owned: LockCapture): void {
  if (unchanged(lockPath, owned)) unlinkSync(lockPath);
}

function acquire(
  lockPath: string,
  selfHostname: string,
  options: Pick<WithLockOptions, "ownerMetadata" | "reclaimStale">,
  depth = 0
): { ok: true; owned: LockCapture } | { ok: false; lastSeen?: LockOwner } {
  const ownerPayload: LockOwner = {
    pid: process.pid,
    hostname: selfHostname,
    startedAt: new Date().toISOString(),
    ...options.ownerMetadata,
    provenance: makeLockRec(randomBytes(16).toString("hex"))
  };
  const raw = Buffer.from(JSON.stringify(ownerPayload));
  const temporary = `${lockPath}.tmp-${ownerPayload.provenance!.token}`;
  let published = false;
  let owned: LockCapture | undefined;
  try {
    // Contended polls need no staging write or fsync. linkSync below remains
    // the exclusive publication decision if this preliminary read races.
    if (existsSync(lockPath)) throw Object.assign(new Error("lock exists"), { code: "EEXIST" });
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
      owned = { stat: fstatSync(fd), raw };
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, lockPath); // atomic, complete, and never replaces an owner
    } catch (linkErr) {
      const linkCode = (linkErr as NodeJS.ErrnoException).code;
      // EEXIST is contention (another owner won); any code outside the
      // hardlink-unavailable set is a genuine storage failure — rethrow it
      // instead of masking it behind the exclusive-create fallback.
      if (linkCode === "EEXIST" || !LINK_FALLBACK_CODES.has(linkCode ?? "")) throw linkErr;
      // The filesystem cannot publish through a same-directory link: fall back
      // to exclusive-create publication, which still never replaces an owner.
      // Only the legacy create/write window remains on such filesystems, and a
      // post-reboot quarantine still recovers it.
      const stagingOwned = owned;
      const fallbackFd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(fallbackFd, raw);
        fsyncSync(fallbackFd);
        owned = { stat: fstatSync(fallbackFd), raw };
      } catch (fallbackErr) {
        // The fallback file is ours alone (O_EXCL just created it): remove it
        // so no empty or truncated lock is left behind, then propagate.
        owned = stagingOwned;
        try { unlinkSync(lockPath); } catch { /* best-effort residue removal */ }
        throw fallbackErr;
      } finally {
        closeSync(fallbackFd);
      }
      published = true;
      syncDirectory(dirname(lockPath));
      // Never overwrite `owned` before the ownership check: on a verification
      // failure the outer handler must still release our own generation.
      const verified = capture(lockPath);
      if (!verified || !verified.raw.equals(raw)) throw new Error("published lock ownership changed");
      owned = verified;
      return { ok: true, owned };
    }
    published = true;
    unlinkSync(temporary);
    // Same no-overwrite-before-check hardening as the fallback path above.
    const linked = capture(lockPath);
    if (!linked || !linked.raw.equals(raw)) throw new Error("published lock ownership changed");
    owned = linked;
    syncDirectory(dirname(lockPath));
    return { ok: true, owned };
  } catch (err) {
    if (published && owned) release(lockPath, owned);
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
  } finally {
    try { unlinkSync(temporary); } catch { /* unpublished private staging file */ }
  }

  const seen = capture(lockPath);
  if (!seen) return { ok: false };
  const owner = tryParseOwner(seen.raw.toString('utf8'));
  if (options.reclaimStale !== false && depth < 8 && reclaimable(lockPath, seen, selfHostname)) {
    // Serialize reclaimers. The guard uses the same atomic publication and
    // death proof, so a crashed reclaimer is recoverable too. Bound nesting.
    const guardPath = `${lockPath}.recovery`;
    const guard = acquire(guardPath, selfHostname, {}, depth + 1);
    if (!guard.ok) return { ok: false, lastSeen: owner };
    try {
      if (!unchanged(lockPath, seen) || !reclaimable(lockPath, seen, selfHostname)) return { ok: false };
      const backup = `${lockPath}.quarantine-${randomBytes(16).toString("hex")}`;
      const fd = openSync(backup, "wx", 0o600);
      try { writeFileSync(fd, seen.raw); fsyncSync(fd); } finally { closeSync(fd); }
      syncDirectory(dirname(lockPath)); // backup durable BEFORE removal
      if (!unchanged(lockPath, seen)) return { ok: false };
      unlinkSync(lockPath);
      syncDirectory(dirname(lockPath));
    } finally { release(guardPath, guard.owned); }
    return { ok: false };
  }
  return { ok: false, lastSeen: owner };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function busyWaitSync(ms: number): void {
  // Synchronous wait without blocking event-loop indefinitely. Used by
  // `withLockSync` and the synchronous identity fence — most store methods are
  // sync today and we don't want to ripple `async` through them just for
  // locking (DEC-036).
  const end = Date.now() + ms;
  // `Atomics.wait` on a private SharedArrayBuffer is the standard
  // "sleep without spinning" primitive in modern Node.
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  while (Date.now() < end) {
    const remaining = end - Date.now();
    if (remaining <= 0) break;
    Atomics.wait(view, 0, 0, Math.min(remaining, 25));
  }
}

export async function withLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options: WithLockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const selfHostname = hostname();
  const observe = options.observe;
  const lock = logicalLockId(lockPath);

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastSeen: LockOwner | undefined;
  let attempts = 0;
  let owned: LockCapture;
  // `wait` fires only on real contention (first failed attempt), never before
  // an uncontended acquisition, so phase diagnostics cannot mistake the sync
  // staging fsync of a free lock for a wait.
  let waited = false;
  while (true) {
    if (options.signal?.aborted) {
      notifyObserver(observe, { lock, event: "timeout", waitMs: Date.now() - startedAt, attempts });
      throw new LockCancelledError(lockPath, String(options.signal.reason ?? "aborted"));
    }
    attempts++;
    const attempt = acquire(lockPath, selfHostname, options);
    if (attempt.ok) { owned = attempt.owned; break; }
    if (!waited) { waited = true; notifyObserver(observe, { lock, event: "wait" }); }
    lastSeen = attempt.lastSeen ?? lastSeen;
    if (Date.now() >= deadline) {
      notifyObserver(observe, { lock, event: "timeout", waitMs: Date.now() - startedAt, attempts });
      throw new LockTimeoutError(lockPath, lastSeen, timeoutMs);
    }
    await delay(pollMs);
  }
  const acquiredAt = Date.now();
  notifyObserver(observe, { lock, event: "acquired", waitMs: acquiredAt - startedAt, attempts });

  try {
    return await fn();
  } finally {
    notifyObserver(observe, { lock, event: "released", holdMs: Date.now() - acquiredAt });
    try {
      release(lockPath, owned);
    } catch {
      /* lock file already gone — fine */
    }
  }
}

export function withLockSync<T>(
  lockPath: string,
  fn: () => T,
  options: WithLockOptions = {}
): T {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const selfHostname = hostname();
  const observe = options.observe;
  const lock = logicalLockId(lockPath);

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastSeen: LockOwner | undefined;
  let attempts = 0;
  let owned: LockCapture;
  // Same lazy `wait` as the async variant above: real contention only.
  let waited = false;
  while (true) {
    attempts++;
    const attempt = acquire(lockPath, selfHostname, options);
    if (attempt.ok) { owned = attempt.owned; break; }
    if (!waited) { waited = true; notifyObserver(observe, { lock, event: "wait" }); }
    lastSeen = attempt.lastSeen ?? lastSeen;
    if (Date.now() >= deadline) {
      notifyObserver(observe, { lock, event: "timeout", waitMs: Date.now() - startedAt, attempts });
      throw new LockTimeoutError(lockPath, lastSeen, timeoutMs);
    }
    busyWaitSync(pollMs);
  }
  const acquiredAt = Date.now();
  notifyObserver(observe, { lock, event: "acquired", waitMs: acquiredAt - startedAt, attempts });

  try {
    return fn();
  } finally {
    notifyObserver(observe, { lock, event: "released", holdMs: Date.now() - acquiredAt });
    try {
      release(lockPath, owned);
    } catch {
      /* lock file already gone — fine */
    }
  }
}
