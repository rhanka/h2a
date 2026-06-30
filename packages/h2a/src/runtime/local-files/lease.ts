/**
 * Cross-host lease lock for the local-files store (DEC-065).
 *
 * The advisory lock in `locks.ts` (DEC-036) recovers stale locks via
 * `process.kill(pid, 0)` — which only works **same-machine**. A store shared
 * across Pods on a ReadWriteMany volume (Scenario B of DEC-056) has holders on
 * different nodes that cannot probe each other's PIDs, so the PID model is
 * unsafe there.
 *
 * This module replaces PID-liveness with a **time-based lease**:
 *
 * - The lock file carries `{ holder, nonce, acquiredAt, renewedAt, leaseMs,
 *   fencingToken }`.
 * - A lease is *expired* when `now - renewedAt > leaseMs`. Any contender may
 *   then steal it. Staleness is decided purely by wall-clock time, so it works
 *   regardless of which host or Pod held it.
 * - The atomic gate is `openSync(path, "wx")` (`O_CREAT | O_EXCL`): only one
 *   contender wins the create, even across hosts on a POSIX-compliant shared
 *   filesystem.
 * - `nonce` is a random per-acquisition id; release only unlinks the file if
 *   the on-disk nonce still matches ours (so a holder that overran its lease
 *   and was stolen from does not delete the new holder's lease).
 * - `fencingToken` is incremented on every steal (best-effort monotonic) and
 *   returned to the caller for observability / downstream fencing.
 *
 * Clock-skew caveat: `leaseMs` must comfortably exceed (a) the longest
 * critical section plus (b) the maximum clock skew between hosts. The store's
 * read-then-write sections are sub-second, so the default 30s lease leaves a
 * wide margin. This is documented in DEC-065.
 */

import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

import { LockTimeoutError, type WithLockOptions } from "./locks.js";

export interface LeaseRecord {
  readonly holder: string;
  readonly nonce: string;
  readonly acquiredAt: string;
  readonly renewedAt: string;
  readonly leaseMs: number;
  readonly fencingToken: number;
}

export interface WithLeaseOptions extends WithLockOptions {
  /** Lease duration in ms. A lease older than this is stealable. Default 30000. */
  readonly leaseMs?: number;
  /** Holder label (host + pid by default). Informational. */
  readonly holder?: string;
}

export interface LeaseHandle {
  readonly nonce: string;
  readonly fencingToken: number;
}

const DEFAULT_LEASE_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 50;

function nowMs(): number {
  return Date.now();
}

function parseLease(raw: string): LeaseRecord | undefined {
  try {
    const p = JSON.parse(raw) as Partial<LeaseRecord>;
    if (
      p &&
      typeof p.holder === "string" &&
      typeof p.nonce === "string" &&
      typeof p.renewedAt === "string" &&
      typeof p.leaseMs === "number" &&
      typeof p.fencingToken === "number"
    ) {
      return {
        holder: p.holder,
        nonce: p.nonce,
        acquiredAt: typeof p.acquiredAt === "string" ? p.acquiredAt : p.renewedAt,
        renewedAt: p.renewedAt,
        leaseMs: p.leaseMs,
        fencingToken: p.fencingToken
      };
    }
  } catch {
    /* malformed — treat as absent */
  }
  return undefined;
}

function isExpired(lease: LeaseRecord, at: number): boolean {
  const renewed = Date.parse(lease.renewedAt);
  if (Number.isNaN(renewed)) return true;
  return at - renewed > lease.leaseMs;
}

function writeLease(lockPath: string, record: LeaseRecord): void {
  const fd = openSync(lockPath, "wx");
  try {
    writeFileSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
}

type AcquireResult =
  | { ok: true; handle: LeaseHandle }
  | { ok: false; lastSeen?: LeaseRecord };

function attemptAcquire(
  lockPath: string,
  holder: string,
  leaseMs: number
): AcquireResult {
  const at = nowMs();
  const iso = new Date(at).toISOString();
  const nonce = randomBytes(8).toString("hex");

  // Fresh create path — token starts at 1.
  const fresh: LeaseRecord = {
    holder,
    nonce,
    acquiredAt: iso,
    renewedAt: iso,
    leaseMs,
    fencingToken: 1
  };
  try {
    writeLease(lockPath, fresh);
    return { ok: true, handle: { nonce, fencingToken: 1 } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // Lock exists — read and decide.
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    // Released between EEXIST and read — caller retries.
    return { ok: false };
  }
  const existing = parseLease(raw);
  if (existing && !isExpired(existing, at)) {
    return { ok: false, lastSeen: existing };
  }

  // Expired (or malformed) — steal it. Unlink then re-create via O_EXCL so the
  // create remains the atomic gate; the create-winner writes oldToken+1.
  const nextToken = (existing?.fencingToken ?? 0) + 1;
  try {
    unlinkSync(lockPath);
  } catch {
    /* someone else reclaimed first — fall through to retry */
  }
  const stolen: LeaseRecord = {
    holder,
    nonce,
    acquiredAt: iso,
    renewedAt: iso,
    leaseMs,
    fencingToken: nextToken
  };
  try {
    writeLease(lockPath, stolen);
    return { ok: true, handle: { nonce, fencingToken: nextToken } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Another contender won the steal — retry from the top next loop.
      return { ok: false, lastSeen: existing };
    }
    throw err;
  }
}

function releaseLease(lockPath: string, handle: LeaseHandle): void {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    return; // already gone
  }
  const current = parseLease(raw);
  // Only unlink if WE still hold it (nonce match). If a contender stole the
  // lease after we overran it, leave their lease intact.
  if (current && current.nonce === handle.nonce) {
    try {
      unlinkSync(lockPath);
    } catch {
      /* concurrent release — fine */
    }
  }
}

function busyWaitSync(ms: number): void {
  const end = Date.now() + ms;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  while (Date.now() < end) {
    const remaining = end - Date.now();
    if (remaining <= 0) break;
    Atomics.wait(view, 0, 0, Math.min(remaining, 25));
  }
}

function defaultHolder(): string {
  return `${hostname()}:${process.pid}`;
}

/**
 * Synchronous lease-locked critical section. Mirrors `withLockSync` but uses
 * the time-based lease above, so it is safe for cross-host (cross-Pod) shared
 * stores. Returns `fn()`'s result. Throws `LockTimeoutError` if the lease
 * cannot be acquired within `timeoutMs`.
 *
 * The handle (nonce + fencingToken) is exposed to `fn` so callers that need
 * to fence a downstream side-effect can read the token.
 */
export function withLeaseSync<T>(
  lockPath: string,
  fn: (handle: LeaseHandle) => T,
  options: WithLeaseOptions = {}
): T {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const holder = options.holder ?? defaultHolder();

  const deadline = Date.now() + timeoutMs;
  let lastSeen: LeaseRecord | undefined;
  let handle: LeaseHandle | undefined;
  while (true) {
    const attempt = attemptAcquire(lockPath, holder, leaseMs);
    if (attempt.ok) {
      handle = attempt.handle;
      break;
    }
    lastSeen = attempt.lastSeen ?? lastSeen;
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(
        lockPath,
        lastSeen
          ? {
              pid: 0,
              hostname: lastSeen.holder,
              startedAt: lastSeen.acquiredAt
            }
          : undefined,
        timeoutMs
      );
    }
    busyWaitSync(pollMs);
  }

  try {
    return fn(handle);
  } finally {
    releaseLease(lockPath, handle);
  }
}

/** Async variant of {@link withLeaseSync}. */
export async function withLease<T>(
  lockPath: string,
  fn: (handle: LeaseHandle) => T | Promise<T>,
  options: WithLeaseOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const holder = options.holder ?? defaultHolder();

  const deadline = Date.now() + timeoutMs;
  let lastSeen: LeaseRecord | undefined;
  let handle: LeaseHandle | undefined;
  while (true) {
    const attempt = attemptAcquire(lockPath, holder, leaseMs);
    if (attempt.ok) {
      handle = attempt.handle;
      break;
    }
    lastSeen = attempt.lastSeen ?? lastSeen;
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(
        lockPath,
        lastSeen
          ? { pid: 0, hostname: lastSeen.holder, startedAt: lastSeen.acquiredAt }
          : undefined,
        timeoutMs
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  try {
    return await fn(handle);
  } finally {
    releaseLease(lockPath, handle);
  }
}
