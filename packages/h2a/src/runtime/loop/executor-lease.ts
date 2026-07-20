/**
 * Per-loop executor lease (L1 Lot 0).
 *
 * Establishes a SINGLE-WRITER guarantee for the durable objective-loop
 * executor: at most one holder may execute a given loop's tick at a time, even
 * across the many per-agent `mcp-serve` processes on one host (measured: up to
 * a dozen). Leadership is a time-based, fenced lease — NOT the conductor claim
 * (which has no epoch/TTL and can be released by anyone). This is the plumbing
 * the supervisor (Lot 1+) acquires before it may tick+execute a loop.
 *
 * Design (double-opus consensus, tmp/L1-decision-reconciled.md):
 *  - Key = `loopId` (already unique/opaque). No workspace field is needed; a
 *    loop can span repos, so the executor is scoped to the loop, not a workspace.
 *  - Lock file = `<root>/loops/<loopId>/exec.lock`, alongside the loop's own
 *    state, reusing the store's existing time-based lease primitive
 *    (`tryAcquireLease` / `releaseLeaseHandle`, O_EXCL + steal-after-TTL +
 *    monotonic fencing token).
 *  - This module is INERT: it grants/releases the lease and nothing else. No
 *    ticker, no relaunch, no runtime behaviour change until a later lot uses it.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  localStorePaths,
  safePathSegment
} from "../local-files/paths.js";
import {
  tryAcquireLease,
  releaseLeaseHandle,
  type LeaseHandle
} from "../local-files/lease.js";

/** Default executor-lease duration. Comfortably exceeds a tick's work + skew. */
export const DEFAULT_LOOP_EXECUTOR_LEASE_MS = 30000;

/** Absolute path of a loop's executor lock file. */
export function loopExecutorLockPath(root: string, loopId: string): string {
  return join(
    localStorePaths(root).root,
    "loops",
    safePathSegment(loopId),
    "exec.lock"
  );
}

/** A held executor lease: the monotonic fencing token + an explicit release. */
export interface LoopExecutorLease {
  /** Monotonic fencing token; increments on every steal. Use to fence effects. */
  readonly token: number;
  /** Release the lease. Idempotent; a no-op if the lease was already stolen. */
  readonly release: () => void;
}

/**
 * Try to become the single executor for `loopId`. Returns a held lease
 * (`{ token, release }`) if acquired, or `null` if another live holder owns it.
 * An EXPIRED lease (crashed/overrun holder) is stolen with a bumped token.
 *
 * The lease is HELD until `release()` — it does NOT auto-release around a
 * function call, because a tick's execution outlives a single call.
 */
export function acquireLoopExecutorLease(
  root: string,
  loopId: string,
  options: { readonly leaseMs?: number; readonly holder?: string } = {}
): LoopExecutorLease | null {
  const lockPath = loopExecutorLockPath(root, loopId);
  // The loop dir must exist for the O_EXCL create; a loop we execute normally
  // already has one, but ensure it so acquisition never fails with ENOENT.
  mkdirSync(join(localStorePaths(root).root, "loops", safePathSegment(loopId)), {
    recursive: true
  });
  const handle: LeaseHandle | null = tryAcquireLease(lockPath, {
    leaseMs: options.leaseMs ?? DEFAULT_LOOP_EXECUTOR_LEASE_MS,
    ...(options.holder !== undefined ? { holder: options.holder } : {})
  });
  if (!handle) return null;
  let released = false;
  return {
    token: handle.fencingToken,
    release: (): void => {
      if (released) return;
      released = true;
      releaseLeaseHandle(lockPath, handle);
    }
  };
}
