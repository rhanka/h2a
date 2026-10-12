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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolvePrivateRuntimeRoot } from "./claude-code-cli-isolation.js";
import { readBootId, readMachineId, readPidNamespaceId, readProcessStartTime } from "./proc-identity.js";

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

export interface ClaudeLockHolderRecord {
  readonly pid?: unknown;
  readonly startTime?: unknown;
  readonly bootId?: unknown;
  readonly pidNamespace?: unknown;
  readonly machineId?: unknown;
}

/**
 * Prove a recorded holder dead. PID presence alone proves nothing across
 * PID reuse: a live pid with a mismatched start-time is a different process
 * (reclaim), a mismatched boot id means a reboot happened (reclaim), and an
 * ESRCH signal check means the process is gone (reclaim). Anything
 * unprovable — EPERM liveness, unreadable identity, foreign namespace or
 * machine sharing this directory — fails closed as alive (wait, never
 * reclaim), so a live holder can never lose its lock to a waiter.
 */
function isRecordedHolderProvenDead(holder: ClaudeLockHolderRecord): boolean {
  if (!holder || typeof holder !== "object") return false;
  if (typeof holder.pid !== "number" || !Number.isInteger(holder.pid) || holder.pid <= 0) {
    return false;
  }
  const liveNamespace = readPidNamespaceId();
  if (
    typeof holder.pidNamespace === "string" &&
    liveNamespace !== undefined &&
    holder.pidNamespace !== liveNamespace
  ) {
    return false;
  }
  const liveMachine = readMachineId();
  if (
    typeof holder.machineId === "string" &&
    liveMachine !== undefined &&
    holder.machineId !== liveMachine
  ) {
    return false;
  }
  try {
    process.kill(holder.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return true;
    return false;
  }
  const liveStartTime = readProcessStartTime(holder.pid);
  if (
    typeof holder.startTime === "number" &&
    liveStartTime !== undefined &&
    liveStartTime !== holder.startTime
  ) {
    return true;
  }
  const liveBootId = readBootId();
  if (
    typeof holder.bootId === "string" &&
    liveBootId !== undefined &&
    liveBootId !== holder.bootId
  ) {
    return true;
  }
  return false;
}

/**
 * Acquire exclusive in-process and cross-process lock for ownerScope:accountId.
 * Timeout after 30 seconds with a static busy error if cannot be acquired.
 * The lock file carries a random claim token plus pid/start-time/boot
 * identity: a waiter reclaims only a holder proven dead (never a live one,
 * never on PID reuse), verifies it still owns the file after creation, and
 * release deletes only its own claim.
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
  const claimToken = randomUUID();
  const readHolder = (): ClaudeLockHolderRecord | null => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(lockFile, "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as ClaudeLockHolderRecord;
    } catch {
      return null;
    }
  };
  const writeClaim = (targetFd: number) => {
    const lockPayload = JSON.stringify({
      pid: process.pid,
      startTime: readProcessStartTime(process.pid) ?? null,
      bootId: readBootId() ?? null,
      pidNamespace: readPidNamespaceId() ?? null,
      machineId: readMachineId() ?? null,
      ownerScope,
      accountId,
      acquiredAt: nowFn(),
      token: claimToken,
    });
    writeFileSync(targetFd, lockPayload);
  };

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
      writeClaim(fd);
      // Read-back: prove this waiter still owns the file it just created.
      // A concurrent reclaimer that replaced the file between creation and
      // this read owns it instead; back off and wait on its live claim.
      const back = readHolder() as { token?: unknown } | null;
      if (!back || back.token !== claimToken) {
        try {
          if (fd !== null) {
            closeSync(fd);
            fd = null;
          }
        } catch {
          // Best effort
        }
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      break;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        const holder = readHolder();
        if (holder && isRecordedHolderProvenDead(holder)) {
          // Re-read before unlink: never delete a file that changed under
          // this waiter (a fresh claim may have landed since the first read).
          const fresh = readHolder();
          if (
            fresh &&
            JSON.stringify(fresh) === JSON.stringify(holder)
          ) {
            try {
              unlinkSync(lockFile);
            } catch {
              // Lost the race; the loop re-reads.
            }
          }
          continue;
        }

        // Live holder, unprovable holder, or unreadable file: wait.
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
        // Delete only our own claim: a successor's fresh lock is never ours.
        const current = readHolder() as { token?: unknown } | null;
        if (current && current.token === claimToken && existsSync(lockFile)) {
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

/** Sweep mutual-exclusion file inside the runtime root. */
export const CLAUDE_SWEEP_LOCK_FILENAME = ".sweep.lock";

/**
 * Content-blind orphan sweep at host boot and runner start.
 * A run is swept only when its run-meta.json carries a valid pid plus
 * createdAt AND the holder is proven dead by pid/start-time/boot identity
 * AND its age exceeds the stale threshold. Runs without valid metadata are
 * always retained (never deleted blindly); live holders are skipped; a
 * concurrent active sweeper makes this call a no-op.
 */
export async function sweepOrphanSandboxes(
  rootDir?: string,
  options: {
    readonly maxAgeMs?: number;
    readonly now?: () => number;
  } = {},
): Promise<SweepResult> {
  const root = resolvePrivateRuntimeRoot(rootDir);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_ORPHAN_STALE_AFTER_MS;
  const now = (options.now ?? Date.now)();

  let swept = 0;
  let retained = 0;
  let skippedAlive = 0;

  if (!existsSync(root)) {
    return { swept, retained, skippedAlive };
  }

  // Sweep mutual exclusion: one active sweeper per root.
  const sweepLockFile = join(root, CLAUDE_SWEEP_LOCK_FILENAME);
  const sweepToken = randomUUID();
  const readSweepHolder = (): ClaudeLockHolderRecord | null => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(sweepLockFile, "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as ClaudeLockHolderRecord;
    } catch {
      return null;
    }
  };
  let sweepFd: number | null = null;
  try {
    sweepFd = openSync(sweepLockFile, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    writeFileSync(
      sweepFd,
      JSON.stringify({
        pid: process.pid,
        startTime: readProcessStartTime(process.pid) ?? null,
        bootId: readBootId() ?? null,
        pidNamespace: readPidNamespaceId() ?? null,
        machineId: readMachineId() ?? null,
        acquiredAt: now,
        token: sweepToken,
      }),
    );
  } catch {
    const holder = readSweepHolder();
    const holderAge =
      holder && typeof (holder as { acquiredAt?: unknown }).acquiredAt === "number"
        ? now - ((holder as { acquiredAt: number }).acquiredAt)
        : 0;
    if (holder && (isRecordedHolderProvenDead(holder) || holderAge > 2 * maxAgeMs)) {
      try {
        unlinkSync(sweepLockFile);
      } catch {
        // Lost the race; skip this round.
        return { swept, retained, skippedAlive };
      }
      try {
        sweepFd = openSync(sweepLockFile, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
        writeFileSync(sweepFd, JSON.stringify({ pid: process.pid, acquiredAt: now, token: sweepToken }));
      } catch {
        return { swept, retained, skippedAlive };
      }
    } else {
      return { swept, retained, skippedAlive };
    }
  }

  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const runDir = join(root, entry.name);
      const metaPath = join(runDir, "run-meta.json");

      let meta: (ClaudeLockHolderRecord & { createdAt?: unknown }) | null = null;
      try {
        const parsed: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
        if (parsed && typeof parsed === "object") {
          meta = parsed as ClaudeLockHolderRecord & { createdAt?: unknown };
        }
      } catch {
        meta = null;
      }

      // No valid identity metadata: retain, never delete blindly.
      if (!meta || typeof meta.pid !== "number" || typeof meta.createdAt !== "number") {
        retained++;
        continue;
      }

      if (!isRecordedHolderProvenDead(meta)) {
        skippedAlive++;
        continue;
      }

      // Young orphan retry: do NOT delete if younger than stale threshold
      if (now - meta.createdAt < maxAgeMs) {
        retained++;
        continue;
      }

      // Holder proven dead and age > maxAgeMs: delete content-blindly
      try {
        rmSync(runDir, { recursive: true, force: true });
        swept++;
      } catch {
        retained++;
      }
    }
  } finally {
    try {
      if (sweepFd !== null) {
        closeSync(sweepFd);
        sweepFd = null;
      }
    } catch {
      // Best effort
    }
    try {
      const current = readSweepHolder() as { token?: unknown } | null;
      if (current && current.token === sweepToken) {
        unlinkSync(sweepLockFile);
      }
    } catch {
      // Best effort
    }
  }

  return { swept, retained, skippedAlive };
}
