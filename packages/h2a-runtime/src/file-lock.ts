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
 * Acquire the lockfile guarding `path` (exclusive create). Returns the fd on
 * success, or undefined if it could not be acquired within LOCK_MAX_WAIT_MS (the
 * caller then proceeds best-effort). Breaks a STALE lock (holder crashed) by age.
 */
export function acquireFileLock(path: string): number | undefined {
  const lp = lockPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lp, "wx"); // O_CREAT|O_EXCL|O_WRONLY
      return fd;
    } catch {
      // Held — break it if it is stale (a crashed holder left it behind).
      try {
        const age = Date.now() - statSync(lp).mtimeMs;
        if (age > LOCK_STALE_MS) {
          rmSync(lp, { force: true });
          continue; // retry the exclusive create immediately
        }
      } catch {
        // raced with the holder releasing it → just retry the create
      }
      if (Date.now() >= deadline) return undefined; // give up, proceed best-effort
      spinSleep(LOCK_SPIN_MS);
    }
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
