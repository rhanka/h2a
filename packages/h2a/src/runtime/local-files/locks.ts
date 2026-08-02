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
 * This module implements **advisory** file locking via exclusive-create
 * sentinel files (`O_CREAT | O_EXCL` semantics through `openSync(path, "wx")`).
 * It is intentionally limited to **same-machine** coordination: a lock file
 * holding a foreign-host PID would be treated as live (we cannot
 * `process.kill(pid, 0)` across hosts). Cross-machine sharing of a store
 * remains out of scope (V2).
 *
 * Stale-lock recovery: if the lock file already exists, we parse its JSON
 * payload `{pid, hostname, startedAt}`. If `hostname` matches and the PID is
 * gone (`process.kill(pid, 0)` throws `ESRCH`), we reclaim the lock by
 * unlinking and retrying. Otherwise we poll up to `timeoutMs` and throw
 * `LockTimeoutError`.
 */

import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

export interface LockOwner {
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: string;
  /** Optional protocol marker for a lock with a stronger caller invariant. */
  readonly protocol?: string;
  /** Caller-issued generation for a fenced critical section. */
  readonly fenceEpoch?: string;
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

function tryParseOwner(raw: string): LockOwner | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<LockOwner>;
    if (
      parsed &&
      typeof parsed.pid === "number" &&
      typeof parsed.hostname === "string" &&
      typeof parsed.startedAt === "string"
    ) {
      return {
        pid: parsed.pid,
        hostname: parsed.hostname,
        startedAt: parsed.startedAt,
        ...(typeof parsed.protocol === "string" ? { protocol: parsed.protocol } : {}),
        ...(typeof parsed.fenceEpoch === "string" ? { fenceEpoch: parsed.fenceEpoch } : {})
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

function acquire(
  lockPath: string,
  selfHostname: string,
  options: Pick<WithLockOptions, "ownerMetadata" | "reclaimStale">
): { ok: true } | { ok: false; lastSeen?: LockOwner } {
  const ownerPayload: LockOwner = {
    pid: process.pid,
    hostname: selfHostname,
    startedAt: new Date().toISOString(),
    ...options.ownerMetadata
  };
  try {
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, JSON.stringify(ownerPayload));
    } finally {
      closeSync(fd);
    }
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
  }

  // Lock exists — inspect the owner record for staleness.
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    // The lock was released between EEXIST and our read. Caller should retry.
    return { ok: false };
  }
  const owner = tryParseOwner(raw);
  if (options.reclaimStale !== false && owner && !pidIsAliveOnSameHost(owner, selfHostname)) {
    // Stale: reclaim by unlinking. The next loop iteration retries the create.
    try {
      unlinkSync(lockPath);
    } catch {
      /* concurrent reclaim — fine */
    }
    return { ok: false };
  }
  return { ok: false, lastSeen: owner };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function busyWaitSync(ms: number): void {
  // Synchronous wait without blocking event-loop indefinitely. Used by
  // `withLockSync` only — most store methods are sync today and we don't
  // want to ripple `async` through them just for locking (DEC-036).
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

  const deadline = Date.now() + timeoutMs;
  let lastSeen: LockOwner | undefined;
  while (true) {
    const attempt = acquire(lockPath, selfHostname, options);
    if (attempt.ok) break;
    lastSeen = attempt.lastSeen ?? lastSeen;
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(lockPath, lastSeen, timeoutMs);
    }
    await delay(pollMs);
  }

  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
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

  const deadline = Date.now() + timeoutMs;
  let lastSeen: LockOwner | undefined;
  while (true) {
    const attempt = acquire(lockPath, selfHostname, options);
    if (attempt.ok) break;
    lastSeen = attempt.lastSeen ?? lastSeen;
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(lockPath, lastSeen, timeoutMs);
    }
    busyWaitSync(pollMs);
  }

  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      /* lock file already gone — fine */
    }
  }
}
