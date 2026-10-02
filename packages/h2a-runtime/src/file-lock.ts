/**
 * Cross-process lockfile for load-modify-save mutations of a LOCAL json file.
 *
 * Extracted verbatim from `registry.ts` (which still uses it) so a second
 * machine-scoped side-store — the session leases — serializes its writers with
 * the SAME proven primitive instead of a second copy of a subtle algorithm.
 *
 * We use an exclusive lockfile (`<path>.lock`, O_CREAT|O_EXCL) with a bounded
 * spin and stale-lock takeover, NOT a real OS flock(2): exclusive-create on the
 * same local filesystem is the portable primitive here (Node has no flock), and
 * a crashed holder is recovered by the staleness break below.
 *
 * The lock is BEST-EFFORT ON PURPOSE: when it cannot be taken within the wait
 * budget the caller proceeds anyway (last-writer-wins), because a contended lock
 * must never hang a claude hook. That bound is why this is a serialization aid,
 * not mutual exclusion you may build a safety property on.
 */

import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Spin parameters for the lockfile (bounded — a deadlock must never hang a hook). */
export const LOCK_STALE_MS = 10_000; // a lockfile older than this is assumed orphaned
const LOCK_SPIN_MS = 5; // busy-wait granularity between acquire attempts
const LOCK_MAX_WAIT_MS = 4_000; // give up waiting after this (then proceed best-effort)

function lockPath(path: string): string {
  return `${path}.lock`;
}

/** Busy-wait `ms` without a timer (we are holding a process-wide critical section). */
function spinSleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // tight spin — ms is tiny (LOCK_SPIN_MS); a side-store mutation is sub-ms.
  }
}

/**
 * ONE attempt at the lockfile guarding `path` (exclusive create), with the same
 * stale-lock takeover as `acquireFileLock` but NO waiting at all: returns the fd,
 * or undefined when someone else holds it right now.
 *
 * For callers that must not block the event loop for the wait budget below —
 * hygiene-only mutations that are better retried later than spun on (see the
 * PTY-exit prune in native-terminal/host.ts). A caller that needs the mutation
 * to happen must use `acquireFileLock`/`withFileLock` instead: this one reports
 * "not now", which is not the same as "done".
 */
export function tryAcquireFileLock(path: string): number | undefined {
  const lp = lockPath(path);
  mkdirSync(dirname(path), { recursive: true });
  // Two attempts at most: the second exists only for the case the first found a
  // STALE lockfile (or raced the holder releasing one) and cleared the way.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return openSync(lp, "wx"); // O_CREAT|O_EXCL|O_WRONLY
    } catch {
      if (attempt > 0) return undefined; // someone else won it: not now
      try {
        const age = Date.now() - statSync(lp).mtimeMs;
        if (age <= LOCK_STALE_MS) return undefined; // genuinely held: not now
        rmSync(lp, { force: true }); // crashed holder: break it and retry once
      } catch {
        // Raced with the holder releasing it → retry the create once.
      }
    }
  }
  return undefined;
}

/**
 * Acquire the lockfile guarding `path` (exclusive create). Returns the fd on
 * success, or undefined if it could not be acquired within LOCK_MAX_WAIT_MS (the
 * caller then proceeds best-effort). Breaks a STALE lock (holder crashed) by age.
 */
export function acquireFileLock(path: string): number | undefined {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  for (;;) {
    const fd = tryAcquireFileLock(path);
    if (fd !== undefined) return fd;
    if (Date.now() >= deadline) return undefined; // give up, proceed best-effort
    spinSleep(LOCK_SPIN_MS);
  }
}

/** Release a lock taken by `acquireFileLock` (idempotent — a double release is a no-op). */
export function releaseFileLock(fd: number, path: string): void {
  try {
    closeSync(fd);
  } catch {
    // already closed
  }
  try {
    rmSync(lockPath(path), { force: true });
  } catch {
    // already gone
  }
}

/**
 * Run `fn` while holding the lockfile for `path`. The lock is released even when
 * `fn` throws. When the lock cannot be taken, `fn` runs ANYWAY (best-effort — see
 * the module header).
 */
export function withFileLock<T>(path: string, fn: () => T): T {
  const fd = acquireFileLock(path);
  try {
    return fn();
  } finally {
    if (fd !== undefined) releaseFileLock(fd, path);
  }
}
