/**
 * The refresh lock (refresh-lock.ts) when two waiters break the same stale lock.
 *
 * Without serialization, both see the stale lock; the first removes it and takes the lock, then
 * the second removes that fresh lock and takes it too. Both then present the same refresh token,
 * and the AS revokes the whole family (reuse detection). Breaking is therefore done under
 * `<lock>.break` (O_EXCL), and the lock is checked again under it before it is removed.
 *
 * The other waiter is simulated inside a statSync hook: it acts exactly between this process's
 * look at the stale lock and the removal, the window two real processes can interleave in.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, type PathLike, type StatSyncOptions } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ afterStat: undefined as ((path: string) => void) | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: PathLike, options?: StatSyncOptions) => {
    const stats = actual.statSync(path, options);
    hooks.afterStat?.(String(path));
    return stats;
  }) as typeof actual.statSync;
  return { ...actual, statSync };
});

import { REFRESH_LOCK_BUSY, REFRESH_LOCK_STALE_MS, refreshLockPath, withRefreshLock } from "./refresh-lock.js";

const dirs: string[] = [];
afterEach(() => {
  hooks.afterStat = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function paths(): { authPath: string; lock: string; breaker: string } {
  const dir = mkdtempSync(join(tmpdir(), "h2a-refresh-lock-"));
  dirs.push(dir);
  const authPath = join(dir, "h2a-auth.json");
  const lock = refreshLockPath(authPath);
  return { authPath, lock, breaker: `${lock}.break` };
}

/** A file older than any refresh lasts: what a dead process leaves behind. */
function writeStale(path: string, owner: string): void {
  writeFileSync(path, owner, { mode: 0o600 });
  const old = new Date(Date.now() - REFRESH_LOCK_STALE_MS - 60_000);
  utimesSync(path, old, old);
}

describe("refresh lock: breaking a stale lock", () => {
  it("checks the lock again under the break lock: a stale lock another waiter broke and took meanwhile is left to it", async () => {
    const { authPath, lock, breaker } = paths();
    writeStale(lock, "4243:dead-process");
    let interleaved = false;
    hooks.afterStat = (path) => {
      if (interleaved || path !== lock) return;
      interleaved = true;
      // Right after this process saw the stale lock, another waiter that saw it too breaks it
      // and takes the lock.
      rmSync(lock);
      writeFileSync(lock, "4244:other-waiter", { mode: 0o600 });
    };
    let ran = false;
    const outcome = await withRefreshLock(authPath, 300, async () => {
      ran = true;
      return "ran";
    });
    expect(interleaved).toBe(true);
    expect(outcome).toBe(REFRESH_LOCK_BUSY);
    expect(ran).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe("4244:other-waiter");
    expect(existsSync(breaker)).toBe(false);
  });

  it("leaves a stale lock to the waiter already breaking it: a live break lock is not touched", async () => {
    const { authPath, lock, breaker } = paths();
    writeStale(lock, "4243:dead-process");
    writeFileSync(breaker, "4245:breaker", { mode: 0o600 });
    let ran = false;
    const outcome = await withRefreshLock(authPath, 300, async () => {
      ran = true;
      return "ran";
    });
    expect(outcome).toBe(REFRESH_LOCK_BUSY);
    expect(ran).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe("4243:dead-process");
    expect(readFileSync(breaker, "utf8")).toBe("4245:breaker");
  });

  it("breaks a break lock left by a dead breaker, then the stale lock, and leaves neither behind", async () => {
    const { authPath, lock, breaker } = paths();
    writeStale(lock, "4243:dead-process");
    writeStale(breaker, "4246:dead-breaker");
    let holder = "";
    const outcome = await withRefreshLock(authPath, 5000, async () => {
      holder = readFileSync(lock, "utf8");
      return "ran";
    });
    expect(outcome).toBe("ran");
    expect(holder.startsWith(`${process.pid}:`)).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(breaker)).toBe(false);
  });
});
