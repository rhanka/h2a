/**
 * Claude Code CLI lifecycle: owner/account lease management,
 * process-tree supervision, TTL admission, and startup orphan sweeps.
 */
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePrivateRuntimeRoot } from "./claude-code-cli-isolation.js";

export const DEFAULT_LEASE_TIMEOUT_MS = 30_000; // 30 seconds
export const DEFAULT_ORPHAN_STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MIN_REMAINING_TTL_MS = 60_000; // 1 minute
export const DEFAULT_MAX_REMAINING_TTL_MS = 86_400_000; // 24 hours

export interface ClaudeAccountLease {
  readonly ownerScope: string;
  readonly accountId: string;
  readonly acquiredAt: number;
  release(): Promise<void>;
}

// In-process lock registry: one promise queue per ownerScope:accountId
const inProcessLocks = new Map<string, Promise<void>>();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function resolveLockDirectory(customDir?: string): string {
  const dir = customDir ?? join(resolvePrivateRuntimeRoot(), ".locks");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Acquire exclusive in-process and cross-process lock for ownerScope:accountId.
 * Timeout after 30 seconds with a static busy error if cannot be acquired.
 */
export async function acquireClaudeAccountLease(
  ownerScope: string,
  accountId: string,
  options: {
    readonly timeoutMs?: number;
    readonly lockDir?: string;
    readonly now?: () => number;
  } = {},
): Promise<ClaudeAccountLease> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;
  const nowFn = options.now ?? Date.now;
  const startTime = nowFn();
  const leaseKey = `${ownerScope}:${accountId}`;
  const lockDir = resolveLockDirectory(options.lockDir);
  const lockFile = join(lockDir, `${hashKey(leaseKey)}.lock`);

  // 1. In-process mutex queue
  let releaseInProcess: () => void = () => {};
  const currentLock = inProcessLocks.get(leaseKey) ?? Promise.resolve();

  let acquiredInProcess = false;
  const inProcessPromise = new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        reject(new Error("Claude account busy: lease acquisition timed out (30s)"));
      }, timeoutMs);
    }

    currentLock.then(() => {
      if (timer) clearTimeout(timer);
      acquiredInProcess = true;
      resolve();
    }).catch(reject);
  });

  const nextLock = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });
  inProcessLocks.set(leaseKey, nextLock);

  try {
    await inProcessPromise;
  } catch (err) {
    releaseInProcess();
    if (inProcessLocks.get(leaseKey) === nextLock) {
      inProcessLocks.delete(leaseKey);
    }
    throw err;
  }

  // 2. Cross-process file lock with remaining timeout budget
  let fd: number | null = null;
  while (true) {
    const elapsed = nowFn() - startTime;
    if (elapsed >= timeoutMs) {
      releaseInProcess();
      if (inProcessLocks.get(leaseKey) === nextLock) {
        inProcessLocks.delete(leaseKey);
      }
      throw new Error("Claude account busy: lease acquisition timed out (30s)");
    }

    try {
      fd = openSync(
        lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
        0o600,
      );
      // Write lock metadata (PID and acquisition timestamp)
      const lockPayload = JSON.stringify({
        pid: process.pid,
        ownerScope,
        accountId,
        acquiredAt: nowFn(),
      });
      writeFileSync(fd, lockPayload);
      break;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // Lockfile exists, check if holder process is dead
        try {
          const content = readFileSync(lockFile, "utf8");
          const holder = JSON.parse(content);
          if (holder && typeof holder.pid === "number") {
            try {
              process.kill(holder.pid, 0); // Check if process is alive
            } catch (killErr: unknown) {
              const killCode = (killErr as NodeJS.ErrnoException).code;
              if (killCode === "ESRCH") {
                // Holder is dead, reclaim lockfile
                unlinkSync(lockFile);
                continue;
              }
            }
          }
        } catch {
          // If unreadable or corrupted, retry shortly
        }

        // Wait 100ms before retrying
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      releaseInProcess();
      if (inProcessLocks.get(leaseKey) === nextLock) {
        inProcessLocks.delete(leaseKey);
      }
      throw err;
    }
  }

  let released = false;
  return {
    ownerScope,
    accountId,
    acquiredAt: nowFn(),
    async release() {
      if (released) return;
      released = true;
      try {
        if (fd !== null) {
          closeSync(fd);
          fd = null;
        }
      } catch {
        // Best effort
      }
      try {
        if (existsSync(lockFile)) {
          unlinkSync(lockFile);
        }
      } catch {
        // Best effort
      }
      releaseInProcess();
      if (inProcessLocks.get(leaseKey) === nextLock) {
        inProcessLocks.delete(leaseKey);
      }
    },
  };
}

/**
 * Validate token remaining TTL against admission boundaries.
 * Preserves real provider expiry without rewriting or fabricating timestamps.
 */
export function checkTokenTtlAdmission(
  expiresAt: number,
  now = Date.now(),
  minTtlMs = DEFAULT_MIN_REMAINING_TTL_MS,
  maxTtlMs = DEFAULT_MAX_REMAINING_TTL_MS,
): { admitted: boolean; reason?: string } {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return { admitted: false, reason: "invalid_token_expiry" };
  }
  const remaining = expiresAt - now;
  if (remaining < minTtlMs) {
    return { admitted: false, reason: "insufficient_remaining_ttl" };
  }
  if (remaining > maxTtlMs) {
    return { admitted: false, reason: "excessive_remaining_ttl" };
  }
  return { admitted: true };
}

/**
 * Supervise process tree and guarantee reaping of child and all descendants.
 */
export async function reapProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  gracePeriodMs = 500,
): Promise<void> {
  if (pid <= 0) return;

  const sendSignal = (sig: NodeJS.Signals) => {
    try {
      // Kill process group (negative PID)
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // Process might already be dead
      }
    }
  };

  sendSignal(signal);

  // Await grace period
  await new Promise((r) => setTimeout(r, gracePeriodMs));

  // Escalate to SIGKILL if still running
  try {
    process.kill(pid, 0);
    sendSignal("SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
  } catch {
    // Process exited successfully
  }
}

export interface SweepResult {
  readonly swept: number;
  readonly retained: number;
  readonly skippedAlive: number;
}

/**
 * Content-blind orphan sweep at host boot and runner start.
 * Sweeps runs whose PID is proven dead and age > orphanStaleAfterMs.
 * Retains young orphans and skips live processes.
 */
export async function sweepOrphanSandboxes(
  rootDir?: string,
  options: {
    readonly maxAgeMs?: number;
    readonly now?: () => number;
    readonly isProcessAlive?: (pid: number) => boolean;
  } = {},
): Promise<SweepResult> {
  const root = resolvePrivateRuntimeRoot(rootDir);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_ORPHAN_STALE_AFTER_MS;
  const now = (options.now ?? Date.now)();
  const isProcessAlive =
    options.isProcessAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  let swept = 0;
  let retained = 0;
  let skippedAlive = 0;

  if (!existsSync(root)) {
    return { swept, retained, skippedAlive };
  }

  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const runDir = join(root, entry.name);
    const metaPath = join(runDir, "run-meta.json");

    let pid: number | null = null;
    let createdAt: number = 0;

    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        pid = typeof meta.pid === "number" ? meta.pid : null;
        createdAt = typeof meta.createdAt === "number" ? meta.createdAt : 0;
      } catch {
        // Unreadable metadata
      }
    }

    if (!createdAt) {
      try {
        createdAt = statSync(runDir).ctimeMs;
      } catch {
        continue;
      }
    }

    const age = now - createdAt;

    if (pid !== null && isProcessAlive(pid)) {
      skippedAlive++;
      continue;
    }

    // Young orphan retry: do NOT delete if younger than stale threshold
    if (age < maxAgeMs) {
      retained++;
      continue;
    }

    // Process is proven dead and age > maxAgeMs: delete content-blindly
    try {
      rmSync(runDir, { recursive: true, force: true });
      swept++;
    } catch {
      retained++;
    }
  }

  return { swept, retained, skippedAlive };
}
