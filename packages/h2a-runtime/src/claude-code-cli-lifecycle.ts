/**
 * Claude Code CLI lifecycle: process-tree supervision, TTL admission,
 * and startup orphan sweeps. Account locking lives in the mesh account
 * directory (common seat model) — never here.
 */
import {
  closeSync,
  constants,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolvePrivateRuntimeRoot } from "./claude-code-cli-isolation.js";
import { readBootId, readMachineId, readPidNamespaceId, readProcessStartTime } from "./proc-identity.js";

export const DEFAULT_ORPHAN_STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MIN_REMAINING_TTL_MS = 60_000; // 1 minute
export const DEFAULT_MAX_REMAINING_TTL_MS = 86_400_000; // 24 hours

/**
 * Account locking lives in the mesh account directory, like every other
 * seat: h2a holds no per-account lease here. The holder record below only
 * describes sweep/identity metadata (run-meta.json and the sweep lock),
 * never a lock claim.
 */
export interface ClaudeSweepHolderRecord {
  readonly pid?: unknown;
  readonly startTime?: unknown;
  readonly bootId?: unknown;
  readonly pidNamespace?: unknown;
  readonly machineId?: unknown;
  readonly token?: unknown;
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
function isRecordedHolderProvenDead(holder: ClaudeSweepHolderRecord): boolean {
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
 * Positively prove that a live child process is the exact process spawned by this sandbox.
 * Fails closed: never signals on PID presence alone, across reboot, across PID namespace
 * boundary, across PID reuse, or when start-time was unrecorded or mismatched.
 */
export function isRecordedChildProvenTarget(
  childPid: number,
  rawMeta: {
    readonly childStartTime?: unknown;
    readonly childBootId?: unknown;
    readonly childPidNamespace?: unknown;
    readonly childCwd?: unknown;
    readonly runId?: unknown;
  },
  parentMeta: ClaudeSweepHolderRecord,
  runDir: string,
): { proven: boolean; reason?: string } {
  if (typeof childPid !== "number" || !Number.isInteger(childPid) || childPid <= 0) {
    return { proven: false, reason: "invalid_pid" };
  }

  // Must be alive to prove
  try {
    process.kill(childPid, 0);
  } catch {
    return { proven: false, reason: "process_dead" };
  }

  // Linux-specific identity proofs: start-time, boot-id, pid-namespace
  if (process.platform === "linux") {
    const liveBootId = readBootId();
    const recordedChildBoot =
      (typeof rawMeta.childBootId === "string" && rawMeta.childBootId) ||
      parentMeta.bootId;
    if (
      typeof recordedChildBoot !== "string" ||
      !recordedChildBoot ||
      liveBootId === undefined ||
      liveBootId !== recordedChildBoot
    ) {
      return { proven: false, reason: "boot_id_mismatch_or_unrecorded" };
    }

    const liveNamespace = readPidNamespaceId();
    const recordedChildNs =
      (typeof rawMeta.childPidNamespace === "string" && rawMeta.childPidNamespace) ||
      parentMeta.pidNamespace;
    if (
      typeof recordedChildNs !== "string" ||
      !recordedChildNs ||
      liveNamespace === undefined ||
      liveNamespace !== recordedChildNs
    ) {
      return { proven: false, reason: "pid_namespace_mismatch_or_unrecorded" };
    }

    const liveMachine = readMachineId();
    if (
      typeof parentMeta.machineId === "string" &&
      (liveMachine === undefined || liveMachine !== parentMeta.machineId)
    ) {
      return { proven: false, reason: "machine_id_mismatch" };
    }

    if (
      typeof rawMeta.childStartTime !== "number" ||
      !Number.isFinite(rawMeta.childStartTime) ||
      rawMeta.childStartTime <= 0
    ) {
      return { proven: false, reason: "child_start_time_unrecorded" };
    }

    const liveStartTime = readProcessStartTime(childPid);
    if (liveStartTime === undefined || liveStartTime !== rawMeta.childStartTime) {
      return { proven: false, reason: "child_start_time_mismatched" };
    }

    // Optional cwd/marker ownership check if recorded
    if (typeof rawMeta.childCwd === "string") {
      try {
        const liveCwd = readlinkSync(`/proc/${childPid}/cwd`);
        const normalizedRunDir = runDir.endsWith("/") ? runDir : `${runDir}/`;
        if (liveCwd !== rawMeta.childCwd && liveCwd !== runDir && !liveCwd.startsWith(normalizedRunDir)) {
          return { proven: false, reason: "child_cwd_mismatched" };
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ESRCH") {
          return { proven: false, reason: "process_dead" };
        }
        return { proven: false, reason: "child_cwd_unreadable" };
      }
    }
  } else {
    // Non-Linux platforms: without /proc start-time and boot-id, cannot positively
    // prove process identity to avoid PID reuse hazard. Fail closed: never signal.
    return { proven: false, reason: "non_linux_process_identity_unprovable" };
  }

  return { proven: true };
}

/**
 * Account locking lives in the mesh account directory for every seat
 * (owner decision 2026-10-13, realign on the common seat model): h2a holds
 * no per-account lease. `acquireClaudeAccountLease` and
 * `reclaimDeadAccountLock` were removed without replacement — the mesh route
 * planner serializes acquisition and refresh. What follows is TTL admission,
 * process reaping, and the orphan sweep (proven-dead sandboxes only).
 */

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
  readonly skippedUnprovenChild?: number;
}

export interface SweepOrphanSandboxesOptions {
  readonly maxAgeMs?: number;
  readonly now?: () => number;
  readonly reapProcessTreeFn?: (pid: number, signal?: NodeJS.Signals, gracePeriodMs?: number) => Promise<void>;
  readonly onUnprovenChild?: (info: { runDir: string; childPid: number; reason: string }) => void;
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
  options: SweepOrphanSandboxesOptions = {},
): Promise<SweepResult> {
  const root = resolvePrivateRuntimeRoot(rootDir);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_ORPHAN_STALE_AFTER_MS;
  const now = (options.now ?? Date.now)();

  let swept = 0;
  let retained = 0;
  let skippedAlive = 0;
  let skippedUnprovenChild = 0;

  if (!existsSync(root)) {
    return { swept, retained, skippedAlive };
  }

  // Sweep mutual exclusion: one active sweeper per root.
  const sweepLockFile = join(root, CLAUDE_SWEEP_LOCK_FILENAME);
  const sweepToken = randomUUID();
  const readSweepHolder = (): ClaudeSweepHolderRecord | null => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(sweepLockFile, "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as ClaudeSweepHolderRecord;
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

      let meta: (ClaudeSweepHolderRecord & { createdAt?: unknown }) | null = null;
      try {
        const parsed: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
        if (parsed && typeof parsed === "object") {
          meta = parsed as ClaudeSweepHolderRecord & { createdAt?: unknown };
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

      // Holder proven dead and age > maxAgeMs: reap detached child ONLY if positive identity is proven, then delete
      const rawMeta = meta as {
        childPid?: unknown;
        childStartTime?: unknown;
        childCwd?: unknown;
        runId?: unknown;
      };
      if (typeof rawMeta.childPid === "number" && rawMeta.childPid > 0) {
        let childAlive = false;
        try {
          process.kill(rawMeta.childPid, 0);
          childAlive = true;
        } catch {
          childAlive = false;
        }

        if (childAlive) {
          const proof = isRecordedChildProvenTarget(rawMeta.childPid, rawMeta, meta, runDir);
          if (proof.proven) {
            // Re-verify start-time immediately prior to signal to minimize
            // the proof-to-signal window (c-m3). The window cannot be closed
            // from Node: pidfd_open/pidfd_send_signal have no stdlib binding
            // and a native addon is out of scope, so the re-read plus
            // fail-closed retain on any divergence is the mitigation.
            let raceDiverged = false;
            if (process.platform === "linux") {
              const liveNow = readProcessStartTime(rawMeta.childPid);
              if (liveNow === undefined || liveNow !== rawMeta.childStartTime) {
                raceDiverged = true;
              }
            }
            if (raceDiverged) {
              skippedUnprovenChild++;
              if (options.onUnprovenChild) {
                options.onUnprovenChild({
                  runDir,
                  childPid: rawMeta.childPid,
                  reason: "child_start_time_mismatched",
                });
              }
            } else {
              try {
                const reaper = options.reapProcessTreeFn ?? reapProcessTree;
                await reaper(rawMeta.childPid, "SIGKILL", 50);
              } catch {
                // Best effort
              }
            }
          } else {
            // Identity not positively proven: NEVER signal! Skip child reap and report.
            skippedUnprovenChild++;
            if (options.onUnprovenChild) {
              options.onUnprovenChild({
                runDir,
                childPid: rawMeta.childPid,
                reason: proof.reason ?? "unproven_identity",
              });
            }
            // Retain sandbox when the child might still be the legitimate seat process running
            // (e.g. unrecorded start-time, non-Linux unprovable, pid namespace unprovable, cwd unreadable).
            // Only sweep when identity proves it is definitely a different process (mismatched start-time, mismatched boot-id).
            if (
              proof.reason === "child_start_time_unrecorded" ||
              proof.reason === "non_linux_process_identity_unprovable" ||
              proof.reason === "pid_namespace_mismatch_or_unrecorded" ||
              proof.reason === "child_cwd_unreadable"
            ) {
              retained++;
              continue;
            }
          }
        }
      }

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

  return skippedUnprovenChild > 0
    ? { swept, retained, skippedAlive, skippedUnprovenChild }
    : { swept, retained, skippedAlive };
}
