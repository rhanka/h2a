/**
 * Cross-process serialization of the refresh_token grant.
 *
 * The sentropic AS rotates refresh tokens and treats a second presentation of a rotated one as
 * reuse: it revokes the whole family (refresh-handler `revokeFamily('reuse_detected')`). Two h2a
 * processes refreshing the same stored pair at once would therefore end the session long
 * before its 15-day cap. The token store's compare-and-set keeps the FILE consistent, but only a
 * lock held across the HTTP call keeps the second process from presenting the token at all.
 *
 * The lock is `<auth file>.refresh.lock`, created O_CREAT|O_EXCL with its owner (`pid:uuid`)
 * inside, next to the store's own writer lock (which is held for milliseconds, never across the
 * network). A waiter polls for a bounded time; the caller then re-reads the store, so a pair the
 * holder rotated meanwhile is used without any request. A lock older than any refresh can last
 * (discovery + token request, each bounded by the 30 s HTTP timeout) was left by a dead process
 * and is broken, one breaker at a time (`<lock>.break`, under which the lock is checked again);
 * release removes the lock only while it is still ours.
 */

import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

/** How long a refresh waits for another process's refresh by default. */
export const REFRESH_LOCK_WAIT_MS = 45_000;
/** Older than this, a refresh lock was left by a dead or stuck process. */
export const REFRESH_LOCK_STALE_MS = 120_000;
const POLL_MS = 50;

/** The wait ran out while another process held the lock. */
export const REFRESH_LOCK_BUSY: unique symbol = Symbol("sentropic-refresh-lock-busy");

export function refreshLockPath(authPath: string): string {
  return `${authPath}.refresh.lock`;
}

function tryCreate(path: string, owner: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, owner);
  } catch (error) {
    closeSync(fd);
    rmSync(path, { force: true }); // created exclusively above: ours to remove
    throw error;
  }
  closeSync(fd);
  return true;
}

/** `path` exists and is older than any refresh can last. */
function isStale(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > REFRESH_LOCK_STALE_MS;
  } catch {
    return false; // gone meanwhile: the next attempt decides
  }
}

/**
 * True when a stale lock was removed (the caller tries again at once).
 *
 * Breaking is serialized by `<lock>.break`, created O_EXCL: two waiters that both saw the same
 * stale lock would otherwise each remove it — the second removing the fresh lock the first had
 * just taken — and both hold it. Under `.break` the lock is checked again before it is removed,
 * so a lock broken and taken meanwhile is left to its new holder. A `.break` that is itself
 * older than the stale age was left by a breaker that died, and is removed.
 */
function breakStale(path: string, owner: string): boolean {
  if (!isStale(path)) return false;
  const breaker = `${path}.break`;
  if (!tryCreate(breaker, owner)) {
    try {
      if (isStale(breaker)) rmSync(breaker, { force: true });
    } catch {
      // removed meanwhile, or not removable: the next attempt decides
    }
    return false; // another waiter is breaking it: the next attempt decides
  }
  try {
    if (!isStale(path)) return false; // released, or broken and taken again, meanwhile
    rmSync(path);
    return true;
  } catch {
    return false;
  } finally {
    release(breaker, owner);
  }
}

function release(path: string, owner: string): void {
  try {
    if (readFileSync(path, "utf8") !== owner) return; // broken as stale: no longer ours
    rmSync(path, { force: true });
  } catch {
    // already gone, or left behind to go stale
  }
}

/**
 * Run `fn` holding the refresh lock of the store at `authPath`, waiting at most `waitMs` for it;
 * REFRESH_LOCK_BUSY when another live process kept it that long (`fn` did not run).
 */
export async function withRefreshLock<T>(authPath: string, waitMs: number, fn: () => Promise<T>): Promise<T | typeof REFRESH_LOCK_BUSY> {
  const path = refreshLockPath(authPath);
  const owner = `${process.pid}:${randomUUID()}`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = performance.now() + waitMs;
  while (!tryCreate(path, owner)) {
    if (breakStale(path, owner)) continue;
    if (performance.now() >= deadline) return REFRESH_LOCK_BUSY;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    release(path, owner);
  }
}
