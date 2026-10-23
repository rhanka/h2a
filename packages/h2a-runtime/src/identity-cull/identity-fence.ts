/**
 * Runtime-owned fail-closed identity fence for the cull staging path.
 *
 * Why this file exists: `identity-cull/cull.ts` verifies a held-descriptor
 * CAS while holding the canonical `identity/.lock`. That hold used to come
 * from `@sentropic/h2a` (`withIdentityFenceSync`), an undeclared
 * runtime→core edge that broke isolated installs of this package
 * (`ERR_MODULE_NOT_FOUND` before any verb ran). This module gives the
 * staging verification a runtime-owned hold instead: exclusive-create,
 * protocol-compatible v2 records, still-held checks, bounded wait.
 *
 * What this module is NOT: it is not the succession protocol. It never
 * elects a successor, never reaps legacy records, never retires anything.
 * Every uncertain outcome fails closed (wait, then `LockTimeoutError`, which
 * the caller maps to ABORTED) — never a takeover, never a silent pass.
 *
 * Interop contract with the core reader (pinned by
 * `packages/h2a/test/identity-lock-v6.test.js` R1/R2 and by the parity test
 * in `cull.test.ts`, which reads our held record through the core parser):
 * the held file carries EXACTLY the v2 key set, `recordVersion: 2`,
 * `protocol: "identity-binding-fence-v1"`, `publication: "link"`. A live
 * holder pid makes core wait; a crashed holder is recovered by core's own
 * dead-holder path. `hostKind: "weak"` with null anchors is deliberate:
 * staging holds assert nothing about machine identity, and the core parser
 * accepts weak records while treating them conservatively.
 *
 * Stale takeover is deliberately narrow: only a record that parses as valid
 * v2 AND names a pid that `kill(pid, 0)` proves absent (ESRCH) is unlinked.
 * EPERM (alive but unpermissioned), unparseable content, and non-positive
 * pids are hands-off: wait for the timeout, then fail closed.
 */

import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

export const IDENTITY_BINDING_FENCE_PROTOCOL = "identity-binding-fence-v1";
const LOCK_RECORD_MODE = 0o600;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 50;

export interface IdentityFenceLease {
  stillHeld(): boolean;
}

export interface IdentityFenceOptions {
  timeoutMs?: number;
  pollMs?: number;
}

/** Thrown when the hold cannot be acquired within the bounded budget. The
 * `name` matches the core fence timeout so callers mapping by name keep
 * working across the layering boundary. */
export class FenceTimeoutError extends Error {
  override name = "LockTimeoutError";
  constructor(lockPath: string, timeoutMs: number) {
    super(`identity fence unavailable: ${lockPath} stayed held for ${timeoutMs} ms`);
  }
}

function newToken(): string {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((word) => word.toString(16).padStart(8, "0")).join("");
}

interface HeldRecord {
  readonly token: string;
}

function readHeldToken(lockPath: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "recordVersion", "protocol", "platform", "publication", "hostKind", "host",
    "boot", "ns", "timeNs", "pid", "start", "token", "fenceEpoch", "at",
    "target", "operator",
  ]);
  if (!Object.keys(record).every((key) => allowed.has(key))) return undefined;
  if (record["recordVersion"] !== 2 || record["protocol"] !== IDENTITY_BINDING_FENCE_PROTOCOL) return undefined;
  if (record["publication"] !== "link" && record["publication"] !== "o-excl") return undefined;
  if (typeof record["token"] !== "string" || !/^[0-9a-f]{32}$/.test(record["token"])) return undefined;
  if (record["fenceEpoch"] !== record["token"]) return undefined;
  if (typeof record["pid"] !== "number" || !Number.isSafeInteger(record["pid"])) return undefined;
  return (record as unknown as HeldRecord).token;
}

function recordPid(lockPath: string): number | undefined {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const value = JSON.parse(raw) as { pid?: unknown };
    return typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0
      ? value.pid
      : undefined;
  } catch {
    return undefined;
  }
}

function holderProvenDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function platform(): string {
  const p = process.platform;
  return p === "linux" || p === "darwin" || p === "win32" ? p : "other";
}

function writeHoldRecord(lockPath: string, token: string): void {
  // Exactly the v2 key set — no extras (the core reader rejects unknown
  // fields), weak anchors (staging asserts no machine identity).
  const record = {
    recordVersion: 2,
    protocol: IDENTITY_BINDING_FENCE_PROTOCOL,
    platform: platform(),
    publication: "link",
    hostKind: "weak",
    host: null,
    boot: null,
    ns: null,
    timeNs: null,
    pid: process.pid,
    start: null,
    token,
    fenceEpoch: token,
    at: Date.now(),
  };
  const fd = openSync(lockPath, "wx", LOCK_RECORD_MODE);
  try {
    writeSync(fd, JSON.stringify(record));
    fsyncSync(fd);
  } catch (error) {
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* best-effort rollback */ }
    throw error;
  }
  closeSync(fd);
}

function pollSlice(pollMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
}

function acquire(lockPath: string, timeoutMs: number, pollMs: number): string {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const token = newToken();
    try {
      writeHoldRecord(lockPath, token);
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Held by someone: only an ESRCH-proven-dead valid record is taken over.
    // Anything else (live holder, unparseable content, foreign shape) waits.
    const pid = recordPid(lockPath);
    if (pid !== undefined && holderProvenDead(pid)) {
      try { unlinkSync(lockPath); } catch { /* raced a release; retry below */ }
      continue;
    }
    if (performance.now() >= deadline) throw new FenceTimeoutError(lockPath, timeoutMs);
    pollSlice(Math.min(pollMs, Math.max(0, deadline - performance.now())));
  }
}

function release(lockPath: string, token: string): void {
  // Remove only our own hold: never unlink a successor's record.
  try {
    if (readHeldToken(lockPath) !== token) return;
  } catch {
    return;
  }
  try { unlinkSync(lockPath); } catch { /* already gone */ }
}

export function withIdentityFenceSync<T>(
  lockPath: string,
  fn: (lease: IdentityFenceLease) => T,
  options: IdentityFenceOptions = {},
): T {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const token = acquire(lockPath, timeoutMs, pollMs);
  const lease: IdentityFenceLease = {
    stillHeld: () => {
      try {
        return readHeldToken(lockPath) === token;
      } catch {
        return false;
      }
    },
  };
  try {
    return fn(lease);
  } finally {
    release(lockPath, token);
  }
}
