/**
 * Keep-only verified transactional session archive engine for Claude Code (Lot 1).
 *
 * Implements steps 1–6 of DESIGN-r4:
 *   - Discovery of `<uuid>.jsonl` + optional companion `<uuid>/` under configured Claude config dirs
 *   - Copy barriers (grace window, inactivity threshold, exact live h2a/Claude locks, non-blocking ambiguity notes)
 *   - Free-space guard: min(10 GiB, 5%) + estimated raw session size
 *   - Linux host PID namespace guard (mutating `run` refused in sandboxes/containers)
 *   - Single-writer lock (`file-lock.ts` with periodic liveness touch)
 *   - `.staging/` tarball build (`tar -czf`, chmod `0600`, `fsync`), tarball + per-file SHA-256 verification,
 *     pre/post source stability check, atomic rename, parent-dir `fsync`, and atomic `index.json` commit
 *   - Two-tier idempotence (stat pre-filter + content SHA-256 check preserving existing versions)
 *   - Manual & automatic verified restore (updates `mtime` to now, leaves archives intact)
 *   - External-scheduler one-shot entrypoint (`H2A_ARCHIVE_OFF=1`, versioned `last-run.json`, lock)
 *
 * Originals in `~/.claude/projects` are NEVER deleted or quarantined in Lot 1.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  futimesSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync as fsReadSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { convOwners } from "./conv-guard.js";
import { encodeCwd } from "./convsync.js";
import { LOCK_STALE_MS, releaseFileLock, tryAcquireFileLock } from "./file-lock.js";
import { loadRegistry } from "./registry.js";
import { isSessionLeaseAlive, SessionLeaseStore } from "./session-lease.js";
import { readFleetProcView } from "./tmux.js";
import type { ProcView } from "./proc-cpu.js";
import {
  ARCHIVE_SCHEMA_VERSION,
  contentMatchesManifest,
  computePurgeDeadline,
  DAY_MS,
  DEFAULT_ALERT_WINDOW_DAYS,
  extractOriginCwdHint,
  formatArchiveAlertLine,
  isUuidFileStem,
  loadArchiveIndex,
  loadLastRunWitness,
  loadPersistedAlerts,
  readClaudeArchiveAlerts,
  readClaudeCleanupPeriodDays,
  resolveArchivePaths,
  resolveClaudeConfigDirs,
  statSnapshotMatches,
  type ArchiveAlert,
  type ArchiveCliKind,
  type ArchiveFileManifestEntry,
  type ArchiveFileSnapshot,
  type ArchiveLastRunWitness,
  type ArchivePathOptions,
  type ArchivePaths,
  type ArchiveVersionRecord,
  type PersistedAlertsFile,
  type SessionArchiveIndex,
  type SessionArchiveIndexEntry,
} from "./session-archive-alerts.js";

export * from "./session-archive-alerts.js";

export const DEFAULT_OLDER_THAN_DAYS = 14;
export const DEFAULT_GRACE_HOURS = 24;
export const DISK_RESERVE_CAP_BYTES = 10_000_000_000;
export const DISK_RESERVE_FRACTION = 0.05;
const HOST_INIT_PID_NS = "pid:[4026531836]";
const CONTAINER_CGROUP_RE = /(?:user\.slice|docker|containerd|kubepods|lxc|podman|bwrap)/i;
const LOCK_TOUCH_INTERVAL_MS = Math.max(1_000, Math.floor(LOCK_STALE_MS / 3));

export type ArchiveErrorCode =
  | "PID_NAMESPACE_GUARD"
  | "DISK_SPACE_LOW"
  | "ARCHIVE_LOCKED"
  | "ARCHIVE_NOT_FOUND"
  | "ARCHIVE_CORRUPTED"
  | "RESTORE_TARGET_EXISTS"
  | "SESSION_LIVE"
  | "TAR_FAILED";

export class SessionArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  readonly exitCode: number;

  constructor(code: ArchiveErrorCode, message: string, exitCode = 2) {
    super(message);
    this.name = "SessionArchiveError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export interface HostPidNamespaceProbeResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly detail?: string;
}

export interface StatfsLike {
  readonly bsize: number;
  readonly blocks: number;
  readonly bavail: number;
}

export interface DiskSpaceCheck {
  readonly ok: boolean;
  readonly checkedPath: string;
  readonly totalBytes: number;
  readonly availBytes: number;
  readonly reserveBytes: number;
  readonly estimatedRawBytes: number;
  readonly requiredBytes: number;
  readonly marginBytes: number;
}

export interface ClaudeLiveSessionFile {
  readonly pid: number;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly startedAt?: number;
  readonly verifiedAlive: boolean;
}

export interface ArchiveDeps {
  readonly nowMs?: () => number;
  readonly probeHostPidNamespace?: () => HostPidNamespaceProbeResult;
  readonly statfs?: (path: string) => StatfsLike;
  readonly registryPath?: string;
  readonly leasesPath?: string;
  readonly readProcView?: () => ProcView;
  readonly isPidAlive?: (pid: number, startedAtMs?: number) => boolean;
  readonly tmuxHasSession?: (name: string) => boolean;
  readonly nativeSessionLiveness?: (name: string) => true | false | "unknown";
  readonly onBeforeCommit?: (sessionId: string) => void;
}

export interface ArchiveManifest {
  readonly schemaVersion: 1;
  readonly archiveId: string;
  readonly cli: ArchiveCliKind;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly originCwd: string;
  readonly claudeConfigDir: string;
  readonly claudeProjectDirName: string;
  readonly cleanupPeriodDays: number;
  readonly purgeAt: string;
  readonly files: ReadonlyArray<ArchiveFileManifestEntry>;
}

export type CandidateArchiveState =
  | "needed-new"
  | "needed-modified"
  | "needed-missing-tarball"
  | "up-to-date-stat"
  | "up-to-date-content";

export interface ScannedClaudeSession {
  readonly sessionId: string;
  readonly claudeConfigDir: string;
  readonly projectDir: string;
  readonly claudeProjectDirName: string;
  readonly originCwd: string;
  readonly cleanupPeriodDays: number;
  readonly totalBytes: number;
  readonly transcriptMtimeMs: number;
  readonly lastActivityMs: number;
  readonly purgeAt: string;
  readonly purgeAtMs: number;
  readonly daysUntilPurge: number;
  readonly withinAlertWindow: boolean;
  readonly archiveState: CandidateArchiveState;
  readonly blockers: ReadonlyArray<string>;
  readonly copyNotes: ReadonlyArray<string>;
  readonly eligibleForArchive: boolean;
  readonly snapshots: ReadonlyArray<ArchiveFileSnapshot>;
  readonly computedManifestFiles?: ReadonlyArray<ArchiveFileManifestEntry>;
  readonly latestArchive?: ArchiveVersionRecord;
}

export interface OrphanCompanionDir {
  readonly sessionId: string;
  readonly claudeConfigDir: string;
  readonly claudeProjectDirName: string;
  readonly path: string;
}

export interface ArchiveScanResult {
  readonly cli: ArchiveCliKind;
  readonly scannedAt: string;
  readonly paths: ArchivePaths;
  readonly olderThanDays: number;
  readonly graceHours: number;
  readonly disk: DiskSpaceCheck;
  readonly pidGuard: HostPidNamespaceProbeResult;
  readonly archiveRepoBytes: number;
  readonly sessions: ReadonlyArray<ScannedClaudeSession>;
  readonly orphanCompanionDirs: ReadonlyArray<OrphanCompanionDir>;
  readonly alerts: ReadonlyArray<ArchiveAlert>;
}

export interface ArchiveScanOptions extends ArchivePathOptions {
  readonly olderThanDays?: number;
  readonly graceHours?: number;
  readonly alertWindowDays?: number;
  readonly deps?: ArchiveDeps;
}

export interface ArchiveRunOptions extends ArchiveScanOptions {
  readonly dryRun?: boolean;
  readonly sessionId?: string;
}

export interface ArchivedSessionOutcome {
  readonly sessionId: string;
  readonly archiveId: string;
  readonly archiveRelPath: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly version: number;
  readonly originCwd: string;
  readonly copyNotes: ReadonlyArray<string>;
}

export interface ArchiveRunResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly cli: ArchiveCliKind;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly stoppedForDiskGuard: boolean;
  readonly errorCode?: ArchiveErrorCode;
  readonly errorMessage?: string;
  readonly disk: DiskSpaceCheck;
  readonly pidGuard: HostPidNamespaceProbeResult;
  readonly scannedCount: number;
  readonly archived: ReadonlyArray<ArchivedSessionOutcome>;
  readonly wouldArchive: ReadonlyArray<string>;
  readonly skippedIdempotent: ReadonlyArray<string>;
  readonly refreshedIndexStats: ReadonlyArray<string>;
  readonly skippedBlocked: ReadonlyArray<{ readonly sessionId: string; readonly reasons: ReadonlyArray<string> }>;
  readonly alerts: ReadonlyArray<ArchiveAlert>;
}

export interface ArchiveListRow {
  readonly sessionId: string;
  readonly cli: ArchiveCliKind;
  readonly archiveId: string;
  readonly version: number;
  readonly originCwd: string;
  readonly claudeConfigDir: string;
  readonly claudeProjectDirName: string;
  readonly createdAt: string;
  readonly purgeAt: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly archiveRelPath: string;
  readonly archiveAbsPath: string;
  readonly archiveExists: boolean;
  readonly filesCount: number;
  readonly restoredAt?: string;
  readonly restoredFromArchiveId?: string;
  readonly copyNotes: ReadonlyArray<string>;
}

export interface ArchiveVerifyEntry {
  readonly sessionId: string;
  readonly archiveId: string;
  readonly version: number;
  readonly archiveAbsPath: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ArchiveVerifyResult {
  readonly ok: boolean;
  readonly checkedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly results: ReadonlyArray<ArchiveVerifyEntry>;
}

export interface RestoreArchiveOptions extends ArchivePathOptions {
  readonly id: string;
  readonly version?: string;
  readonly onConflict?: "refuse" | "backup";
  readonly claudeConfigDir?: string;
  readonly deps?: ArchiveDeps;
}

export interface RestoreArchiveResult {
  readonly ok: true;
  readonly sessionId: string;
  readonly archiveId: string;
  readonly originCwd: string;
  readonly targetProjectDir: string;
  readonly restoredFiles: ReadonlyArray<string>;
  readonly backedUpPaths: ReadonlyArray<string>;
  readonly restoredAt: string;
  readonly alerts: ReadonlyArray<ArchiveAlert>;
}

export interface EnsureResumeRestoreOptions extends ArchivePathOptions {
  readonly convId: string;
  readonly cwd?: string;
  readonly deps?: ArchiveDeps;
}

export interface EnsureResumeRestoreResult {
  readonly status: "already-on-disk" | "restored" | "not-archived";
  readonly transcriptPath?: string;
  readonly originCwd?: string;
  readonly archiveId?: string;
  readonly alerts: ReadonlyArray<ArchiveAlert>;
}

export interface PassOnceResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly witness: ArchiveLastRunWitness;
  readonly runResult?: ArchiveRunResult;
}

// ---------------------------------------------------------------------------
// Low-level filesystem & crypto helpers
// ---------------------------------------------------------------------------

function ensurePrivateDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirPath, 0o700);
  } catch {
    // Best effort on virtual filesystems that restrict chmod after creation.
  }
}

function fsyncFile(filePath: string): void {
  const fd = openSync(filePath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirBestEffort(dirPath: string): void {
  try {
    const fd = openSync(dirPath, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Some filesystems do not support fsync on a directory descriptor.
  }
}

function writeAtomicPrivateJson(targetPath: string, payload: unknown, stagingDir: string): void {
  const parent = dirname(targetPath);
  ensurePrivateDir(parent);
  ensurePrivateDir(stagingDir);
  const nonce = randomBytes(6).toString("hex");
  const partName = `.tmp-${basename(targetPath)}-${process.pid}-${nonce}`;
  // Stage atomic replacement inside target's own directory (never /tmp) so rename is same-FS.
  const tmpPath = join(parent, partName);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(tmpPath, serialized, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
    fsyncFile(tmpPath);
    renameSync(tmpPath, targetPath);
    fsyncDirBestEffort(parent);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup error on failure unwind.
    }
    throw err;
  }
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = readSyncChunk(fd, buf)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function readSyncChunk(fd: number, buf: Buffer): number {
  return fsReadSync(fd, buf, 0, buf.length, null);
}

function cleanTarEnv(stagingDir: string, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    TMPDIR: stagingDir,
    TMP: stagingDir,
    TEMP: stagingDir,
    LC_ALL: "C",
  };
}

function startLockHeartbeat(lockTargetPath: string): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(`${lockTargetPath}.lock`, now, now);
    } catch {
      // Best-effort heartbeat; main lock release handles cleanup.
    }
  }, LOCK_TOUCH_INTERVAL_MS);
  timer.unref();
  return timer;
}

function withArchiveLock<T>(
  paths: ArchivePaths,
  fn: () => T,
): T {
  ensurePrivateDir(paths.root);
  const lockFd = tryAcquireFileLock(paths.lockTargetPath);
  if (lockFd === undefined) {
    throw new SessionArchiveError(
      "ARCHIVE_LOCKED",
      `another h2a archive process holds ${paths.lockPath}; refusing overlapping write`,
      2,
    );
  }
  const timer = startLockHeartbeat(paths.lockTargetPath);
  try {
    return fn();
  } finally {
    clearInterval(timer);
    releaseFileLock(lockFd, paths.lockTargetPath);
  }
}

// ---------------------------------------------------------------------------
// Host PID namespace guard & Disk space guard
// ---------------------------------------------------------------------------

/**
 * Positive Linux host PID namespace verification (`DESIGN-r4` & `PILOT-r1` NB-8e).
 * Mutating `archive run` refuses to execute inside containers or sandboxed namespaces.
 */
export function probeHostPidNamespace(): HostPidNamespaceProbeResult {
  if (process.platform !== "linux") {
    return {
      ok: false,
      reason: "non-linux-platform",
      detail: `platform ${process.platform} is not a verified Linux systemd/init host`,
    };
  }
  try {
    const pidNs = readlinkSync("/proc/self/ns/pid");
    if (pidNs !== HOST_INIT_PID_NS) {
      return {
        ok: false,
        reason: "pid-namespace-isolated",
        detail: `/proc/self/ns/pid=${pidNs} (expected ${HOST_INIT_PID_NS})`,
      };
    }
    const initStat = statSync("/proc/1");
    if (initStat.uid !== 0) {
      return {
        ok: false,
        reason: "pid1-not-root",
        detail: `/proc/1 uid=${initStat.uid} (expected 0)`,
      };
    }
    const comm = readFileSync("/proc/1/comm", "utf8").trim();
    if (comm !== "systemd" && comm !== "init") {
      return {
        ok: false,
        reason: "pid1-not-init",
        detail: `/proc/1/comm=${comm} (expected systemd or init)`,
      };
    }
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    if (CONTAINER_CGROUP_RE.test(cgroup)) {
      return {
        ok: false,
        reason: "pid1-sandbox-cgroup",
        detail: `/proc/1/cgroup indicates container/user slice`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "proc-probe-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function nearestExistingPath(targetPath: string): string {
  let current = resolve(targetPath);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function checkDiskSpaceGuard(
  archiveRoot: string,
  estimatedRawBytes = 0,
  deps: ArchiveDeps = {},
): DiskSpaceCheck {
  const checkedPath = nearestExistingPath(archiveRoot);
  const stat = (deps.statfs ?? ((p) => statfsSync(p)))(checkedPath);
  const totalBytes = Math.max(0, Number(stat.bsize) * Number(stat.blocks));
  const availBytes = Math.max(0, Number(stat.bsize) * Number(stat.bavail));
  const reserveBytes = Math.min(
    DISK_RESERVE_CAP_BYTES,
    Math.floor(totalBytes * DISK_RESERVE_FRACTION),
  );
  const safeEstimated = Math.max(0, estimatedRawBytes);
  const requiredBytes = reserveBytes + safeEstimated;
  return {
    ok: availBytes >= requiredBytes,
    checkedPath,
    totalBytes,
    availBytes,
    reserveBytes,
    estimatedRawBytes: safeEstimated,
    requiredBytes,
    marginBytes: availBytes - requiredBytes,
  };
}

// ---------------------------------------------------------------------------
// State file & live process inspection
// ---------------------------------------------------------------------------

function resolveSentropicConfigFile(
  fileName: string,
  options: ArchivePathOptions = {},
): string {
  const env = options.env ?? process.env;
  const configRoot =
    options.home ??
    (env.REMOTE_CLI_CONFIG_HOME && env.REMOTE_CLI_CONFIG_HOME.trim()
      ? resolve(env.REMOTE_CLI_CONFIG_HOME)
      : env.HOME && env.HOME.trim()
        ? resolve(env.HOME)
        : homedir());
  const sentropicDir = join(configRoot, ".config", "sentropic");
  const canonical = join(sentropicDir, "h2a");
  const legacy = join(sentropicDir, "remote-cli");
  const chosenDir = existsSync(canonical) || !existsSync(legacy) ? canonical : legacy;
  return join(chosenDir, fileName);
}

function defaultIsPidAlive(pid: number, startedAtMs?: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 2) return false;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`);
    // Kernel threads have empty /proc/<pid>/cmdline.
    if (cmdline.length === 0) return false;
    const statContent = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = statContent.lastIndexOf(")");
    if (close < 0) return false;
    // Ignore zombies ('Z') or dead ('X') processes.
    const stateChar = statContent.slice(close + 1).trimStart()[0];
    if (stateChar === "Z" || stateChar === "X") return false;
    if (startedAtMs !== undefined && Number.isFinite(startedAtMs)) {
      // Sanity check against gross PID reuse if /proc/uptime & boot time available.
      const uptimeRaw = readFileSync("/proc/uptime", "utf8");
      const uptimeSec = Number.parseFloat(uptimeRaw.split(/\s+/)[0] ?? "");
      const fields = statContent.slice(close + 1).trim().split(/\s+/);
      const startTicks = Number.parseInt(fields[19] ?? "", 10);
      if (Number.isFinite(uptimeSec) && Number.isFinite(startTicks)) {
        const bootMs = Date.now() - uptimeSec * 1000;
        const procStartMs = bootMs + (startTicks / 100) * 1000;
        // If reported session startedAt differs from kernel process start by >12 hours, treat as stale PID reuse.
        if (Math.abs(procStartMs - startedAtMs) > 12 * 3600 * 1000) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readClaudeSessionsFiles(
  claudeConfigDir: string,
  deps: ArchiveDeps,
): ClaudeLiveSessionFile[] {
  const sessionsDir = join(claudeConfigDir, "sessions");
  if (!existsSync(sessionsDir)) return [];
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const isAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const out: ClaudeLiveSessionFile[] = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const pid = Number.parseInt(basename(name, ".json"), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(sessionsDir, name), "utf8")) as {
        pid?: unknown;
        sessionId?: unknown;
        cwd?: unknown;
        startedAt?: unknown;
      };
      const filePid = typeof parsed.pid === "number" ? parsed.pid : pid;
      const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : undefined;
      const cwd = typeof parsed.cwd === "string" ? parsed.cwd : undefined;
      const startedAt = typeof parsed.startedAt === "number" ? parsed.startedAt : undefined;
      out.push({
        pid: filePid,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(startedAt !== undefined ? { startedAt } : {}),
        verifiedAlive: isAlive(filePid, startedAt),
      });
    } catch {
      // Malformed <pid>.json does not crash scanning; treated as unverified if encountered.
    }
  }
  return out;
}

interface H2aLivenessState {
  readonly registryKnown: boolean;
  readonly registryPath: string;
  readonly registryEntriesByConv: ReadonlyMap<string, string>;
  readonly registryLiveCwds: ReadonlySet<string>;
  readonly leasesKnown: boolean;
  readonly activeLeaseConvs: ReadonlySet<string>;
  readonly livenessOpts: {
    readonly pidAlive: (pid: number) => boolean;
    readonly bootTimeMs?: number;
    readonly tmuxHasSession?: (name: string) => boolean;
    readonly nativeSessionLiveness?: (name: string) => true | false | "unknown";
  };
}

function loadH2aLivenessState(
  options: ArchivePathOptions,
  nowMs: number,
  deps: ArchiveDeps,
): H2aLivenessState {
  const registryPath =
    deps.registryPath ?? resolveSentropicConfigFile("registry.json", options);
  const leasesPath =
    deps.leasesPath ?? resolveSentropicConfigFile("session-leases.json", options);

  let procViewCache: ProcView | undefined;
  const getProcView = (): ProcView => {
    if (!procViewCache) {
      procViewCache = deps.readProcView ? deps.readProcView() : readFleetProcView();
    }
    return procViewCache;
  };
  const isAlive = deps.isPidAlive ?? ((pid) => defaultIsPidAlive(pid));

  const livenessOpts = {
    pidAlive: (pid: number) => isAlive(pid),
    ...(deps.isPidAlive ? { bootTimeMs: 0 } : {}),
    ...(deps.tmuxHasSession ? { tmuxHasSession: deps.tmuxHasSession } : {}),
    ...(deps.nativeSessionLiveness ? { nativeSessionLiveness: deps.nativeSessionLiveness } : {}),
  };

  const registryEntriesByConv = new Map<string, string>();
  const registryIdToConv = new Map<string, string>();
  const registryLiveCwds = new Set<string>();
  const regRead = loadRegistry(registryPath);
  const registryKnown = regRead.state === "ok";
  if (regRead.state === "ok") {
    for (const entry of regRead.entries) {
      if (entry.convId) {
        registryIdToConv.set(entry.id, entry.convId);
        if (entry.cwd && !registryEntriesByConv.has(entry.convId)) {
          registryEntriesByConv.set(entry.convId, entry.cwd);
        }
      }
      if (entry.cwd && typeof entry.pid === "number" && isAlive(entry.pid)) {
        registryLiveCwds.add(resolve(entry.cwd));
      }
    }
  }

  let leasesKnown = true;
  const activeLeaseConvs = new Set<string>();
  if (existsSync(leasesPath)) {
    try {
      const rawLeases = JSON.parse(readFileSync(leasesPath, "utf8")) as unknown;
      if (!rawLeases || typeof rawLeases !== "object") {
        leasesKnown = false;
      } else {
        const store = new SessionLeaseStore(leasesPath, {
          now: () => new Date(nowMs).toISOString(),
        });
        const leases = store.readAll();
        const procView = getProcView();
        const nowIso = new Date(nowMs).toISOString();
        for (const lease of leases) {
          if (isSessionLeaseAlive(lease, procView, nowIso)) {
            activeLeaseConvs.add(lease.sessionId);
            const mappedConv = registryIdToConv.get(lease.sessionId);
            if (mappedConv) activeLeaseConvs.add(mappedConv);
          }
        }
      }
    } catch {
      leasesKnown = false;
    }
  }

  return {
    registryKnown,
    registryPath,
    registryEntriesByConv,
    registryLiveCwds,
    leasesKnown,
    activeLeaseConvs,
    livenessOpts,
  };
}

function inspectSessionLiveness(
  sessionId: string,
  originCwd: string,
  h2aState: H2aLivenessState,
  claudeLiveFiles: ReadonlyArray<ClaudeLiveSessionFile>,
): { readonly blockers: string[]; readonly copyNotes: string[] } {
  const blockers: string[] = [];
  const copyNotes: string[] = [];

  if (!h2aState.registryKnown) {
    blockers.push("h2a-registry-unreadable");
  } else {
    const owners = convOwners(sessionId, {
      registryPath: h2aState.registryPath,
      ...h2aState.livenessOpts,
      // Intentionally omit `cwd`: another unrelated session in the same cwd is a non-blocking ambiguity note.
    });
    if (owners === "unknown") {
      blockers.push("h2a-registry-unreadable");
    } else if (owners.length > 0) {
      blockers.push(`h2a-live-owner:${owners.map((o) => `${o.where}:${o.label}`).join(",")}`);
    }
  }

  if (!h2aState.leasesKnown) {
    blockers.push("h2a-leases-unreadable");
  } else if (h2aState.activeLeaseConvs.has(sessionId)) {
    blockers.push("h2a-live-lease");
  }

  const normalizedOrigin = resolve(originCwd);
  if (h2aState.registryLiveCwds.has(normalizedOrigin) && blockers.length === 0) {
    copyNotes.push(`unrelated-h2a-session-live-in-cwd:${originCwd}`);
  }

  for (const lf of claudeLiveFiles) {
    if (lf.sessionId === sessionId) {
      if (lf.verifiedAlive) {
        blockers.push(`claude-live-pid:${lf.pid}`);
      } else {
        copyNotes.push(`ignored-unverified-claude-pid:${lf.pid}`);
      }
    } else if (lf.cwd && resolve(lf.cwd) === normalizedOrigin) {
      if (lf.verifiedAlive) {
        copyNotes.push(`unrelated-claude-live-in-cwd:${lf.pid}`);
      } else {
        copyNotes.push(`ignored-stale-claude-pid-in-cwd:${lf.pid}`);
      }
    }
  }

  return { blockers, copyNotes };
}

// ---------------------------------------------------------------------------
// Source file tree discovery & verification
// ---------------------------------------------------------------------------

interface DetailedSourceCollection {
  readonly snapshots: ArchiveFileSnapshot[];
  readonly transcriptMtimeMs: number;
  readonly lastActivityMs: number;
  readonly totalBytes: number;
  readonly hasSymlink: boolean;
}

function walkCompanionChecked(
  absDir: string,
  relPrefix: string,
  snapshots: ArchiveFileSnapshot[],
  state: { lastActivityMs: number; totalBytes: number; hasSymlink: boolean },
): void {
  const dirStat = lstatSync(absDir);
  if (dirStat.isSymbolicLink()) {
    state.hasSymlink = true;
    return;
  }
  const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    const relPath = `${relPrefix}/${entry.name}`;
    const lst = lstatSync(absPath);
    if (lst.isSymbolicLink()) {
      state.hasSymlink = true;
      continue;
    }
    if (lst.isDirectory()) {
      walkCompanionChecked(absPath, relPath, snapshots, state);
    } else if (lst.isFile()) {
      const big = statSync(absPath, { bigint: true });
      state.lastActivityMs = Math.max(state.lastActivityMs, Math.floor(lst.mtimeMs));
      state.totalBytes += lst.size;
      snapshots.push({
        relPath,
        size: lst.size,
        mtimeMs: Math.floor(lst.mtimeMs),
        mtimeNs: big.mtimeNs.toString(),
        inode: big.ino.toString(),
        mode: lst.mode & 0o777,
      });
    }
  }
}

function collectDetailedSessionFiles(
  projectDir: string,
  sessionId: string,
): DetailedSourceCollection | undefined {
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) return undefined;
  const lst = lstatSync(jsonlPath);
  if (lst.isSymbolicLink()) {
    return {
      snapshots: [],
      transcriptMtimeMs: Math.floor(lst.mtimeMs),
      lastActivityMs: Math.floor(lst.mtimeMs),
      totalBytes: 0,
      hasSymlink: true,
    };
  }
  if (!lst.isFile()) return undefined;
  const big = statSync(jsonlPath, { bigint: true });
  const snapshots: ArchiveFileSnapshot[] = [
    {
      relPath: `${sessionId}.jsonl`,
      size: lst.size,
      mtimeMs: Math.floor(lst.mtimeMs),
      mtimeNs: big.mtimeNs.toString(),
      inode: big.ino.toString(),
      mode: lst.mode & 0o777,
    },
  ];
  const state = {
    lastActivityMs: Math.floor(lst.mtimeMs),
    totalBytes: lst.size,
    hasSymlink: false,
  };
  const companionDir = join(projectDir, sessionId);
  if (existsSync(companionDir)) {
    const compStat = lstatSync(companionDir);
    if (compStat.isSymbolicLink()) {
      state.hasSymlink = true;
    } else if (compStat.isDirectory()) {
      walkCompanionChecked(companionDir, sessionId, snapshots, state);
    }
  }
  snapshots.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return {
    snapshots,
    transcriptMtimeMs: Math.floor(lst.mtimeMs),
    lastActivityMs: state.lastActivityMs,
    totalBytes: state.totalBytes,
    hasSymlink: state.hasSymlink,
  };
}

function dirSizeRecursive(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const abs = join(dirPath, entry.name);
    if (entry.isDirectory()) total += dirSizeRecursive(abs);
    else if (entry.isFile()) {
      try {
        total += statSync(abs).size;
      } catch {
        // Ignore concurrent cleanup of transient staging files outside lock.
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Scan (read-only)
// ---------------------------------------------------------------------------

export function scanClaudeSessions(options: ArchiveScanOptions = {}): ArchiveScanResult {
  const deps = options.deps ?? {};
  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const graceHours =
    options.graceHours !== undefined
      ? options.graceHours
      : olderThanDays < 1
        ? 0
        : DEFAULT_GRACE_HOURS;
  const alertWindowDays = options.alertWindowDays ?? DEFAULT_ALERT_WINDOW_DAYS;

  const paths = resolveArchivePaths(options);
  const configDirs = resolveClaudeConfigDirs(options);
  const index = loadArchiveIndex(paths.indexPath);
  const pidGuard = (deps.probeHostPidNamespace ?? probeHostPidNamespace)();
  const disk = checkDiskSpaceGuard(paths.root, 0, deps);
  const h2aState = loadH2aLivenessState(options, nowMs, deps);

  const sessions: ScannedClaudeSession[] = [];
  const orphanCompanionDirs: OrphanCompanionDir[] = [];

  for (const configDir of configDirs) {
    const projectsRoot = join(configDir, "projects");
    if (!existsSync(projectsRoot)) continue;
    const { cleanupPeriodDays } = readClaudeCleanupPeriodDays(configDir);
    const claudeLiveFiles = readClaudeSessionsFiles(configDir, deps);

    const projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.isSymbolicLink())
      .map((d) => d.name)
      .sort();

    for (const projectDirName of projectDirs) {
      const projectDir = join(projectsRoot, projectDirName);
      const entries = readdirSync(projectDir, { withFileTypes: true });
      const jsonlStems = new Set<string>();

      for (const entry of entries) {
        if (entry.name.endsWith(".jsonl")) {
          const stem = basename(entry.name, ".jsonl");
          if (isUuidFileStem(stem)) jsonlStems.add(stem);
        }
      }

      // Detect orphan UUID companion dirs (have no `<uuid>.jsonl`); leave untouched.
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && isUuidFileStem(entry.name)) {
          if (!jsonlStems.has(entry.name)) {
            orphanCompanionDirs.push({
              sessionId: entry.name,
              claudeConfigDir: configDir,
              claudeProjectDirName: projectDirName,
              path: join(projectDir, entry.name),
            });
          }
        }
      }

      for (const sessionId of [...jsonlStems].sort()) {
        const collected = collectDetailedSessionFiles(projectDir, sessionId);
        if (!collected) continue;

        const indexed = index.sessions[sessionId];
        const originCwd =
          h2aState.registryEntriesByConv.get(sessionId) ??
          indexed?.originCwd ??
          extractOriginCwdHint(join(projectDir, `${sessionId}.jsonl`), projectDirName);

        const deadline = computePurgeDeadline(
          collected.transcriptMtimeMs,
          cleanupPeriodDays,
          nowMs,
          alertWindowDays,
        );

        const blockers: string[] = [];
        const copyNotes: string[] = [];

        if (collected.hasSymlink) {
          blockers.push("symlink-unsupported");
        }

        const graceMs = Math.max(0, graceHours) * 3600 * 1000;
        if (graceMs > 0 && nowMs - collected.lastActivityMs < graceMs) {
          blockers.push(`recent-activity-grace-${graceHours}h`);
        }

        const olderThanMs = Math.max(0, olderThanDays) * DAY_MS;
        if (olderThanMs > 0 && nowMs - collected.lastActivityMs < olderThanMs) {
          blockers.push(`within-older-than-${olderThanDays}d`);
        }

        const live = inspectSessionLiveness(sessionId, originCwd, h2aState, claudeLiveFiles);
        blockers.push(...live.blockers);
        copyNotes.push(...live.copyNotes);

        const latest = indexed?.versions[indexed.versions.length - 1];
        let archiveState: CandidateArchiveState;
        let computedManifestFiles: ArchiveFileManifestEntry[] | undefined;

        if (!latest || latest.status !== "committed") {
          archiveState = "needed-new";
        } else if (!existsSync(join(paths.cliRoot, latest.archiveRelPath))) {
          archiveState = "needed-missing-tarball";
        } else if (statSnapshotMatches(collected.snapshots, latest.sourceSnapshot)) {
          archiveState = "up-to-date-stat";
        } else if (contentMatchesManifest(projectDir, collected.snapshots, latest.filesManifest)) {
          archiveState = "up-to-date-content";
        } else {
          archiveState = "needed-modified";
        }

        const needsArchive =
          archiveState === "needed-new" ||
          archiveState === "needed-modified" ||
          archiveState === "needed-missing-tarball";

        sessions.push({
          sessionId,
          claudeConfigDir: configDir,
          projectDir,
          claudeProjectDirName: projectDirName,
          originCwd,
          cleanupPeriodDays,
          totalBytes: collected.totalBytes,
          transcriptMtimeMs: collected.transcriptMtimeMs,
          lastActivityMs: collected.lastActivityMs,
          purgeAt: deadline.purgeAt,
          purgeAtMs: deadline.purgeAtMs,
          daysUntilPurge: deadline.daysRemaining,
          withinAlertWindow: deadline.withinAlertWindow,
          archiveState,
          blockers,
          copyNotes,
          eligibleForArchive: needsArchive && blockers.length === 0,
          snapshots: collected.snapshots,
          ...(computedManifestFiles ? { computedManifestFiles } : {}),
          ...(latest ? { latestArchive: latest } : {}),
        });
      }
    }
  }

  return {
    cli: "claude",
    scannedAt: new Date(nowMs).toISOString(),
    paths,
    olderThanDays,
    graceHours,
    disk,
    pidGuard,
    archiveRepoBytes: dirSizeRecursive(paths.cliRoot),
    sessions,
    orphanCompanionDirs,
    alerts: readClaudeArchiveAlerts({
      ...options,
      nowMs,
      alertWindowDays,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tarball packaging & verification inside `.staging/`
// ---------------------------------------------------------------------------

function checkTarListingSafe(archivePath: string, stagingDir: string, expectedFiles?: Set<string>): void {
  const verboseRes = spawnSync("tar", ["-tvzf", archivePath], {
    encoding: "utf8",
    env: cleanTarEnv(stagingDir),
  });
  if (verboseRes.status !== 0) {
    throw new SessionArchiveError(
      "ARCHIVE_CORRUPTED",
      `tar listing failed for ${archivePath}: ${verboseRes.stderr || verboseRes.stdout}`,
      2,
    );
  }
  for (const rawLine of (verboseRes.stdout ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const typeChar = line[0];
    if (typeChar !== "-" && typeChar !== "d") {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `tar entry has unsupported type (${typeChar}) in ${archivePath}: ${line}`,
        2,
      );
    }
  }

  const listRes = spawnSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    env: cleanTarEnv(stagingDir),
  });
  if (listRes.status !== 0) {
    throw new SessionArchiveError(
      "ARCHIVE_CORRUPTED",
      `tar path listing failed for ${archivePath}: ${listRes.stderr || listRes.stdout}`,
      2,
    );
  }
  const seenEntries = new Set<string>();
  for (const rawLine of (listRes.stdout ?? "").split("\n")) {
    const rawEntryPath = rawLine.replace(/\r$/, "");
    if (!rawEntryPath) continue;
    if (
      rawEntryPath.startsWith("/") ||
      rawEntryPath.includes("\0") ||
      rawEntryPath.split("/").some((seg) => seg === "..")
    ) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `unsafe path in archive ${archivePath}: ${rawEntryPath}`,
        2,
      );
    }
    const normalized = rawEntryPath.replace(/^\.\//, "").replace(/\/+$/, "");
    if (normalized) seenEntries.add(normalized);
  }
  if (expectedFiles) {
    for (const expected of expectedFiles) {
      if (!seenEntries.has(expected)) {
        throw new SessionArchiveError(
          "ARCHIVE_CORRUPTED",
          `missing expected entry ${expected} inside ${archivePath}`,
          2,
        );
      }
    }
    for (const seen of seenEntries) {
      const isDirPrefix = [...expectedFiles].some((f) => f.startsWith(`${seen}/`));
      if (!expectedFiles.has(seen) && !isDirPrefix) {
        throw new SessionArchiveError(
          "ARCHIVE_CORRUPTED",
          `unexpected extra entry ${seen} inside ${archivePath}`,
          2,
        );
      }
    }
  }
}

function collectRegularFilesRelative(
  absDir: string,
  relPrefix: string,
  out: Map<string, number>,
): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const lst = lstatSync(abs);
    if (lst.isSymbolicLink()) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `extracted archive contains unexpected symlink at ${rel}`,
        2,
      );
    }
    if (lst.isDirectory()) {
      collectRegularFilesRelative(abs, rel, out);
    } else if (lst.isFile()) {
      out.set(rel, lst.size);
    } else {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `extracted archive contains non-regular file at ${rel}`,
        2,
      );
    }
  }
}

function verifyTarballAgainstIndex(
  archiveAbsPath: string,
  stagingDir: string,
  expectedSessionId: string,
  expectedRecord?: ArchiveVersionRecord,
): ArchiveManifest {
  if (!existsSync(archiveAbsPath)) {
    throw new SessionArchiveError(
      "ARCHIVE_CORRUPTED",
      `archive file does not exist: ${archiveAbsPath}`,
      2,
    );
  }
  if (expectedRecord) {
    const actualBytes = statSync(archiveAbsPath).size;
    if (actualBytes !== expectedRecord.archiveBytes) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `archive byte length mismatch for ${expectedRecord.archiveId}: expected ${expectedRecord.archiveBytes}, got ${actualBytes}`,
        2,
      );
    }
    const actualArchiveSha = sha256File(archiveAbsPath);
    if (actualArchiveSha !== expectedRecord.archiveSha256) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `archive SHA-256 mismatch for ${expectedRecord.archiveId}: expected ${expectedRecord.archiveSha256}, got ${actualArchiveSha}`,
        2,
      );
    }
  }

  ensurePrivateDir(stagingDir);
  const nonce = randomBytes(6).toString("hex");
  const extractDir = join(stagingDir, `verify-${expectedSessionId}-${process.pid}-${nonce}`);
  ensurePrivateDir(extractDir);
  try {
    const expectedSet = expectedRecord
      ? new Set<string>(["manifest.json", ...expectedRecord.filesManifest.map((f) => f.relPath)])
      : undefined;
    checkTarListingSafe(archiveAbsPath, stagingDir, expectedSet);

    const extractRes = spawnSync(
      "tar",
      ["--no-same-owner", "--no-same-permissions", "-xzf", archiveAbsPath, "-C", extractDir],
      { encoding: "utf8", env: cleanTarEnv(stagingDir) },
    );
    if (extractRes.status !== 0) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `tar extraction verification failed for ${archiveAbsPath}: ${extractRes.stderr}`,
        2,
      );
    }

    const manifestPath = join(extractDir, "manifest.json");
    if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `manifest.json missing inside ${archiveAbsPath}`,
        2,
      );
    }

    let manifest: ArchiveManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ArchiveManifest;
    } catch {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `manifest.json is invalid JSON inside ${archiveAbsPath}`,
        2,
      );
    }

    if (
      manifest.schemaVersion !== ARCHIVE_SCHEMA_VERSION ||
      manifest.sessionId !== expectedSessionId ||
      manifest.cli !== "claude" ||
      !Array.isArray(manifest.files)
    ) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `manifest metadata invalid inside ${archiveAbsPath}`,
        2,
      );
    }

    if (expectedRecord && manifest.archiveId !== expectedRecord.archiveId) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `manifest archiveId mismatch (${manifest.archiveId} !== ${expectedRecord.archiveId})`,
        2,
      );
    }

    const extractedFiles = new Map<string, number>();
    collectRegularFilesRelative(extractDir, "", extractedFiles);

    const expectedManifestSet = new Set<string>([
      "manifest.json",
      ...manifest.files.map((f) => f.relPath),
    ]);
    if (extractedFiles.size !== expectedManifestSet.size) {
      throw new SessionArchiveError(
        "ARCHIVE_CORRUPTED",
        `extracted file count (${extractedFiles.size}) does not match manifest (${expectedManifestSet.size})`,
        2,
      );
    }

    for (const fileEntry of manifest.files) {
      const actualSize = extractedFiles.get(fileEntry.relPath);
      if (actualSize === undefined || actualSize !== fileEntry.size) {
        throw new SessionArchiveError(
          "ARCHIVE_CORRUPTED",
          `size mismatch for ${fileEntry.relPath} in ${archiveAbsPath}`,
          2,
        );
      }
      const actualSha = sha256File(join(extractDir, fileEntry.relPath));
      if (actualSha !== fileEntry.sha256) {
        throw new SessionArchiveError(
          "ARCHIVE_CORRUPTED",
          `SHA-256 mismatch for ${fileEntry.relPath} inside ${archiveAbsPath}: expected ${fileEntry.sha256}, got ${actualSha}`,
          2,
        );
      }
    }

    return manifest;
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of staging extraction folder.
    }
  }
}

function chooseUniqueArchiveId(
  sessionId: string,
  nowMs: number,
  monthDir: string,
  existingVersions: ReadonlyArray<ArchiveVersionRecord>,
): string {
  const existingIds = new Set(existingVersions.map((v) => v.archiveId));
  const epochSec = Math.floor(nowMs / 1000);
  const candidate = `${sessionId}.${epochSec}`;
  if (!existingIds.has(candidate) && !existsSync(join(monthDir, `${candidate}.tar.gz`))) {
    return candidate;
  }
  const candidateMs = `${sessionId}.${nowMs}`;
  if (!existingIds.has(candidateMs) && !existsSync(join(monthDir, `${candidateMs}.tar.gz`))) {
    return candidateMs;
  }
  for (let seq = 2; seq < 1000; seq++) {
    const next = `${sessionId}.${nowMs}-${seq}`;
    if (!existingIds.has(next) && !existsSync(join(monthDir, `${next}.tar.gz`))) {
      return next;
    }
  }
  return `${sessionId}.${nowMs}-${randomBytes(3).toString("hex")}`;
}

function buildVerifiedArchiveVersion(
  session: ScannedClaudeSession,
  paths: ArchivePaths,
  nowMs: number,
  existingVersions: ReadonlyArray<ArchiveVersionRecord>,
  deps: ArchiveDeps = {},
): ArchiveVersionRecord {
  const createdAt = new Date(nowMs).toISOString();
  const yyyyMm = createdAt.slice(0, 7);
  const monthDir = join(paths.cliRoot, yyyyMm);
  ensurePrivateDir(monthDir);
  ensurePrivateDir(paths.stagingDir);

  const archiveId = chooseUniqueArchiveId(session.sessionId, nowMs, monthDir, existingVersions);
  const archiveRelPath = `${yyyyMm}/${archiveId}.tar.gz`;
  const finalArchivePath = join(paths.cliRoot, archiveRelPath);
  const nonce = randomBytes(6).toString("hex");
  const buildDir = join(paths.stagingDir, `build-${archiveId}-${process.pid}-${nonce}`);
  const partPath = join(paths.stagingDir, `${archiveId}.${process.pid}.${nonce}.tar.gz.part`);

  ensurePrivateDir(buildDir);
  try {
    const manifestFiles: ArchiveFileManifestEntry[] = [];
    for (const snap of session.snapshots) {
      const srcPath = join(session.projectDir, snap.relPath);
      const dstPath = join(buildDir, snap.relPath);
      ensurePrivateDir(dirname(dstPath));
      copyFileSync(srcPath, dstPath);
      const copiedStat = statSync(dstPath);
      if (copiedStat.size !== snap.size) {
        throw new Error(`concurrent-source-modification:${snap.relPath}:size`);
      }
      chmodSync(dstPath, snap.mode || 0o600);
      manifestFiles.push({
        relPath: snap.relPath,
        size: snap.size,
        mtimeMs: snap.mtimeMs,
        mtimeNs: snap.mtimeNs,
        mode: snap.mode,
        sha256: sha256File(dstPath),
      });
    }

    // Post-copy source stability check before packing tarball.
    const midCollected = collectDetailedSessionFiles(session.projectDir, session.sessionId);
    if (
      !midCollected ||
      midCollected.hasSymlink ||
      !statSnapshotMatches(midCollected.snapshots, session.snapshots)
    ) {
      throw new Error("concurrent-source-modification:post-copy");
    }

    const manifest: ArchiveManifest = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      archiveId,
      cli: "claude",
      sessionId: session.sessionId,
      createdAt,
      originCwd: session.originCwd,
      claudeConfigDir: session.claudeConfigDir,
      claudeProjectDirName: session.claudeProjectDirName,
      cleanupPeriodDays: session.cleanupPeriodDays,
      purgeAt: session.purgeAt,
      files: manifestFiles,
    };
    const manifestPath = join(buildDir, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    const topEntries = ["manifest.json", `${session.sessionId}.jsonl`];
    if (existsSync(join(buildDir, session.sessionId))) {
      topEntries.push(session.sessionId);
    }

    const tarRes = spawnSync(
      "tar",
      ["--numeric-owner", "-czf", partPath, "-C", buildDir, ...topEntries],
      { encoding: "utf8", env: cleanTarEnv(paths.stagingDir) },
    );
    if (tarRes.status !== 0) {
      throw new SessionArchiveError(
        "TAR_FAILED",
        `tar creation failed for ${session.sessionId}: ${tarRes.stderr || tarRes.stdout}`,
        3,
      );
    }

    chmodSync(partPath, 0o600);
    fsyncFile(partPath);

    // Build expected record shape and run full unpack + per-file SHA-256 verification on `.part`.
    const archiveBytes = statSync(partPath).size;
    const archiveSha256 = sha256File(partPath);
    const record: ArchiveVersionRecord = {
      archiveId,
      version: existingVersions.length + 1,
      status: "committed",
      archiveRelPath,
      archiveBytes,
      archiveSha256,
      createdAt,
      createdAtMs: nowMs,
      originCwd: session.originCwd,
      claudeConfigDir: session.claudeConfigDir,
      claudeProjectDirName: session.claudeProjectDirName,
      cleanupPeriodDays: session.cleanupPeriodDays,
      transcriptMtimeMs: session.transcriptMtimeMs,
      purgeAt: session.purgeAt,
      copyNotes: session.copyNotes,
      sourceSnapshot: session.snapshots,
      filesManifest: manifestFiles,
    };

    verifyTarballAgainstIndex(partPath, paths.stagingDir, session.sessionId, record);

    deps.onBeforeCommit?.(session.sessionId);

    // Final stability check right before atomic commit so live concurrent writes never commit stale state.
    const postTarCollected = collectDetailedSessionFiles(session.projectDir, session.sessionId);
    if (
      !postTarCollected ||
      postTarCollected.hasSymlink ||
      !statSnapshotMatches(postTarCollected.snapshots, session.snapshots)
    ) {
      throw new Error("concurrent-source-modification:post-tar");
    }

    renameSync(partPath, finalArchivePath);
    chmodSync(finalArchivePath, 0o600);
    fsyncDirBestEffort(monthDir);

    return record;
  } finally {
    try {
      rmSync(buildDir, { recursive: true, force: true });
    } catch {
      // Ignore staging cleanup error.
    }
    try {
      rmSync(partPath, { force: true });
    } catch {
      // If renamed to finalArchivePath, rmSync(force:true) is a no-op; on error removes `.part`.
    }
  }
}

// ---------------------------------------------------------------------------
// Alert persistence helpers
// ---------------------------------------------------------------------------

function persistOperationalAlerts(
  paths: ArchivePaths,
  nowIso: string,
  updates: {
    readonly pidGuard?: HostPidNamespaceProbeResult;
    readonly diskAlert?: ArchiveAlert;
    readonly clearDiskAlert?: boolean;
    readonly runErrorAlert?: ArchiveAlert;
    readonly clearRunError?: boolean;
  },
): void {
  const existing = loadPersistedAlerts(paths.alertsPath);
  const byKind = new Map<string, ArchiveAlert>();
  for (const a of existing) {
    if (a.kind !== "purge-imminent") byKind.set(a.id, a);
  }
  if (updates.pidGuard) {
    if (!updates.pidGuard.ok) {
      byKind.set("guard:pid-namespace", {
        id: "guard:pid-namespace",
        kind: "pid-namespace-guard",
        severity: "error",
        cli: "claude",
        message: `Archive run blocked by host PID namespace guard (${updates.pidGuard.reason}: ${updates.pidGuard.detail ?? "isolated"})`,
        updatedAt: nowIso,
      });
    } else {
      byKind.delete("guard:pid-namespace");
    }
  }
  if (updates.diskAlert) {
    byKind.set("guard:disk-space", updates.diskAlert);
  } else if (updates.clearDiskAlert) {
    byKind.delete("guard:disk-space");
  }
  if (updates.runErrorAlert) {
    byKind.set("guard:last-run", updates.runErrorAlert);
  } else if (updates.clearRunError) {
    byKind.delete("guard:last-run");
  }
  const payload: PersistedAlertsFile = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    updatedAt: nowIso,
    alerts: [...byKind.values()],
  };
  writeAtomicPrivateJson(paths.alertsPath, payload, paths.stagingDir);
}

// ---------------------------------------------------------------------------
// Run (`h2a archive run`)
// ---------------------------------------------------------------------------

function executeArchiveRunUnlocked(options: ArchiveRunOptions): ArchiveRunResult {
  const deps = options.deps ?? {};
  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const startedAt = new Date(nowMs).toISOString();
  const dryRun = options.dryRun === true;
  const paths = resolveArchivePaths(options);

  const pidGuard = (deps.probeHostPidNamespace ?? probeHostPidNamespace)();
  const initialDisk = checkDiskSpaceGuard(paths.root, 0, deps);

  if (!dryRun && !pidGuard.ok) {
    persistOperationalAlerts(paths, startedAt, { pidGuard });
    const finishedMs = deps.nowMs ? deps.nowMs() : Date.now();
    return {
      ok: false,
      dryRun,
      cli: "claude",
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: Math.max(0, finishedMs - nowMs),
      stoppedForDiskGuard: false,
      errorCode: "PID_NAMESPACE_GUARD",
      errorMessage: `refusing mutating archive run outside host init PID namespace (${pidGuard.reason}: ${pidGuard.detail ?? ""})`,
      disk: initialDisk,
      pidGuard,
      scannedCount: 0,
      archived: [],
      wouldArchive: [],
      skippedIdempotent: [],
      refreshedIndexStats: [],
      skippedBlocked: [],
      alerts: readClaudeArchiveAlerts({ ...options, nowMs }),
    };
  }

  if (!initialDisk.ok) {
    const diskAlert: ArchiveAlert = {
      id: "guard:disk-space",
      kind: "disk-space-low",
      severity: "error",
      cli: "claude",
      message: `Free disk space below reserve guard (${initialDisk.availBytes}B free < ${initialDisk.requiredBytes}B required on ${initialDisk.checkedPath}).`,
      updatedAt: startedAt,
    };
    if (!dryRun) {
      persistOperationalAlerts(paths, startedAt, { pidGuard, diskAlert });
    }
    const finishedMs = deps.nowMs ? deps.nowMs() : Date.now();
    return {
      ok: false,
      dryRun,
      cli: "claude",
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: Math.max(0, finishedMs - nowMs),
      stoppedForDiskGuard: true,
      errorCode: "DISK_SPACE_LOW",
      errorMessage: diskAlert.message,
      disk: initialDisk,
      pidGuard,
      scannedCount: 0,
      archived: [],
      wouldArchive: [],
      skippedIdempotent: [],
      refreshedIndexStats: [],
      skippedBlocked: [],
      alerts: readClaudeArchiveAlerts({ ...options, nowMs }),
    };
  }

  const scan = scanClaudeSessions(options);
  const candidates = options.sessionId
    ? scan.sessions.filter((s) => s.sessionId === options.sessionId)
    : scan.sessions;

  const archived: ArchivedSessionOutcome[] = [];
  const wouldArchive: string[] = [];
  const skippedIdempotent: string[] = [];
  const refreshedIndexStats: string[] = [];
  const skippedBlocked: Array<{ readonly sessionId: string; readonly reasons: ReadonlyArray<string> }> = [];
  let stoppedForDiskGuard = false;
  let diskGuardError: string | undefined;
  let lastDiskCheck = scan.disk;

  const index = loadArchiveIndex(paths.indexPath);
  const mutableSessions: Record<string, SessionArchiveIndexEntry> = { ...index.sessions };
  let indexDirty = false;

  for (const session of candidates) {
    if (session.archiveState === "up-to-date-stat") {
      skippedIdempotent.push(session.sessionId);
      continue;
    }
    if (session.archiveState === "up-to-date-content") {
      skippedIdempotent.push(session.sessionId);
      if (!dryRun && session.latestArchive) {
        const entry = mutableSessions[session.sessionId];
        if (entry && entry.versions.length > 0) {
          const versions = [...entry.versions];
          const lastIdx = versions.length - 1;
          versions[lastIdx] = {
            ...versions[lastIdx]!,
            sourceSnapshot: session.snapshots,
          };
          mutableSessions[session.sessionId] = { ...entry, versions };
          refreshedIndexStats.push(session.sessionId);
          indexDirty = true;
        }
      }
      continue;
    }

    if (session.blockers.length > 0) {
      skippedBlocked.push({ sessionId: session.sessionId, reasons: session.blockers });
      continue;
    }

    const sessionDisk = checkDiskSpaceGuard(paths.root, session.totalBytes, deps);
    lastDiskCheck = sessionDisk;
    if (!sessionDisk.ok) {
      stoppedForDiskGuard = true;
      diskGuardError = `stopping before ${session.sessionId}: free space (${sessionDisk.availBytes}B) below reserve+session threshold (${sessionDisk.requiredBytes}B)`;
      if (!dryRun) {
        persistOperationalAlerts(paths, new Date(nowMs).toISOString(), {
          pidGuard,
          diskAlert: {
            id: "guard:disk-space",
            kind: "disk-space-low",
            severity: "error",
            cli: "claude",
            sessionId: session.sessionId,
            message: diskGuardError,
            updatedAt: new Date(nowMs).toISOString(),
          },
        });
      }
      break;
    }

    if (dryRun) {
      wouldArchive.push(session.sessionId);
      continue;
    }

    const existingEntry = mutableSessions[session.sessionId];
    const existingVersions = existingEntry?.versions ?? [];

    try {
      const commitMs = deps.nowMs ? deps.nowMs() : Date.now();
      const record = buildVerifiedArchiveVersion(session, paths, commitMs, existingVersions, deps);
      mutableSessions[session.sessionId] = {
        sessionId: session.sessionId,
        cli: "claude",
        claudeConfigDir: session.claudeConfigDir,
        claudeProjectDirName: session.claudeProjectDirName,
        originCwd: session.originCwd,
        ...(existingEntry?.restoredAt ? { restoredAt: existingEntry.restoredAt } : {}),
        ...(existingEntry?.restoredFromArchiveId
          ? { restoredFromArchiveId: existingEntry.restoredFromArchiveId }
          : {}),
        versions: [...existingVersions, record],
      };
      indexDirty = true;
      // Flush index after every committed tarball so crash between sessions never orphans a tarball.
      writeAtomicPrivateJson(
        paths.indexPath,
        {
          schemaVersion: ARCHIVE_SCHEMA_VERSION,
          cli: "claude",
          updatedAt: new Date(commitMs).toISOString(),
          sessions: mutableSessions,
        } satisfies SessionArchiveIndex,
        paths.stagingDir,
      );
      indexDirty = false;
      archived.push({
        sessionId: session.sessionId,
        archiveId: record.archiveId,
        archiveRelPath: record.archiveRelPath,
        archiveBytes: record.archiveBytes,
        archiveSha256: record.archiveSha256,
        version: record.version,
        originCwd: record.originCwd,
        copyNotes: record.copyNotes,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith("concurrent-source-modification")) {
        skippedBlocked.push({
          sessionId: session.sessionId,
          reasons: [msg],
        });
        continue;
      }
      throw error;
    }
  }

  if (!dryRun) {
    const updateMs = deps.nowMs ? deps.nowMs() : Date.now();
    if (indexDirty) {
      writeAtomicPrivateJson(
        paths.indexPath,
        {
          schemaVersion: ARCHIVE_SCHEMA_VERSION,
          cli: "claude",
          updatedAt: new Date(updateMs).toISOString(),
          sessions: mutableSessions,
        } satisfies SessionArchiveIndex,
        paths.stagingDir,
      );
    }
    if (!stoppedForDiskGuard) {
      persistOperationalAlerts(paths, new Date(updateMs).toISOString(), {
        pidGuard,
        clearDiskAlert: true,
        clearRunError: true,
      });
    }
  }

  const finishedMs = deps.nowMs ? deps.nowMs() : Date.now();
  return {
    ok: !stoppedForDiskGuard,
    dryRun,
    cli: "claude",
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - nowMs),
    stoppedForDiskGuard,
    ...(stoppedForDiskGuard && diskGuardError !== undefined
      ? { errorCode: "DISK_SPACE_LOW" as const, errorMessage: diskGuardError }
      : {}),
    disk: lastDiskCheck,
    pidGuard,
    scannedCount: candidates.length,
    archived,
    wouldArchive,
    skippedIdempotent,
    refreshedIndexStats,
    skippedBlocked,
    alerts: readClaudeArchiveAlerts({ ...options, nowMs: finishedMs }),
  };
}

export function runSessionArchive(options: ArchiveRunOptions = {}): ArchiveRunResult {
  if (options.dryRun) {
    return executeArchiveRunUnlocked(options);
  }
  const paths = resolveArchivePaths(options);
  return withArchiveLock(paths, () => executeArchiveRunUnlocked(options));
}

// ---------------------------------------------------------------------------
// List & Verify (`h2a archive list`, `h2a archive verify`)
// ---------------------------------------------------------------------------

export function listSessionArchives(options: ArchivePathOptions = {}): ArchiveListRow[] {
  const paths = resolveArchivePaths(options);
  const index = loadArchiveIndex(paths.indexPath);
  const rows: ArchiveListRow[] = [];

  for (const sessionId of Object.keys(index.sessions).sort()) {
    const entry = index.sessions[sessionId];
    if (!entry) continue;
    for (const v of entry.versions) {
      const archiveAbsPath = join(paths.cliRoot, v.archiveRelPath);
      rows.push({
        sessionId: entry.sessionId,
        cli: entry.cli,
        archiveId: v.archiveId,
        version: v.version,
        originCwd: v.originCwd || entry.originCwd,
        claudeConfigDir: v.claudeConfigDir || entry.claudeConfigDir,
        claudeProjectDirName: v.claudeProjectDirName || entry.claudeProjectDirName,
        createdAt: v.createdAt,
        purgeAt: v.purgeAt,
        archiveBytes: v.archiveBytes,
        archiveSha256: v.archiveSha256,
        archiveRelPath: v.archiveRelPath,
        archiveAbsPath,
        archiveExists: existsSync(archiveAbsPath),
        filesCount: v.filesManifest.length,
        ...(entry.restoredAt ? { restoredAt: entry.restoredAt } : {}),
        ...(entry.restoredFromArchiveId ? { restoredFromArchiveId: entry.restoredFromArchiveId } : {}),
        copyNotes: v.copyNotes,
      });
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
  return rows;
}

function resolveTargetVersions(
  index: SessionArchiveIndex,
  id?: string,
): ReadonlyArray<{ readonly session: SessionArchiveIndexEntry; readonly version: ArchiveVersionRecord }> {
  const targets: Array<{ readonly session: SessionArchiveIndexEntry; readonly version: ArchiveVersionRecord }> = [];
  if (!id) {
    for (const key of Object.keys(index.sessions).sort()) {
      const entry = index.sessions[key];
      if (!entry) continue;
      for (const v of entry.versions) {
        targets.push({ session: entry, version: v });
      }
    }
    return targets;
  }

  const direct = index.sessions[id];
  if (direct) {
    for (const v of direct.versions) {
      targets.push({ session: direct, version: v });
    }
    return targets;
  }

  for (const entry of Object.values(index.sessions)) {
    for (const v of entry.versions) {
      if (v.archiveId === id) {
        targets.push({ session: entry, version: v });
      }
    }
  }
  return targets;
}

export function verifySessionArchives(
  options: ArchivePathOptions & { readonly id?: string } = {},
): ArchiveVerifyResult {
  const paths = resolveArchivePaths(options);
  const index = loadArchiveIndex(paths.indexPath);
  const targets = resolveTargetVersions(index, options.id);

  if (options.id && targets.length === 0) {
    return {
      ok: false,
      checkedCount: 0,
      passedCount: 0,
      failedCount: 1,
      results: [
        {
          sessionId: options.id,
          archiveId: options.id,
          version: 0,
          archiveAbsPath: "",
          ok: false,
          error: `no archived version found matching "${options.id}"`,
        },
      ],
    };
  }

  const results: ArchiveVerifyEntry[] = [];
  for (const { session, version } of targets) {
    const absPath = join(paths.cliRoot, version.archiveRelPath);
    try {
      verifyTarballAgainstIndex(absPath, paths.stagingDir, session.sessionId, version);
      results.push({
        sessionId: session.sessionId,
        archiveId: version.archiveId,
        version: version.version,
        archiveAbsPath: absPath,
        ok: true,
      });
    } catch (error) {
      results.push({
        sessionId: session.sessionId,
        archiveId: version.archiveId,
        version: version.version,
        archiveAbsPath: absPath,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const passedCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - passedCount;
  return {
    ok: failedCount === 0,
    checkedCount: results.length,
    passedCount,
    failedCount,
    results,
  };
}

// ---------------------------------------------------------------------------
// Restore (`h2a archive restore <id>` + auto-restore on resume)
// ---------------------------------------------------------------------------

function touchTreeMtime(absPath: string, atDate: Date): void {
  const lst = lstatSync(absPath);
  if (lst.isSymbolicLink()) return;
  if (lst.isDirectory()) {
    for (const entry of readdirSync(absPath, { withFileTypes: true })) {
      touchTreeMtime(join(absPath, entry.name), atDate);
    }
  }
  utimesSync(absPath, atDate, atDate);
}

export function restoreSessionArchive(options: RestoreArchiveOptions): RestoreArchiveResult {
  const deps = options.deps ?? {};
  const paths = resolveArchivePaths(options);

  return withArchiveLock(paths, () => {
    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
    const nowDate = new Date(nowMs);
    const onConflict = options.onConflict ?? "refuse";
    const index = loadArchiveIndex(paths.indexPath);

    let entry = index.sessions[options.id];
    let targetVersion: ArchiveVersionRecord | undefined;

    if (entry) {
      if (options.version) {
        targetVersion = entry.versions.find((v) => v.archiveId === options.version);
      } else {
        targetVersion = entry.versions[entry.versions.length - 1];
      }
    } else {
      for (const candidate of Object.values(index.sessions)) {
        const match = candidate.versions.find(
          (v) => v.archiveId === (options.version ?? options.id),
        );
        if (match) {
          entry = candidate;
          targetVersion = match;
          break;
        }
      }
    }

    if (!entry || !targetVersion) {
      throw new SessionArchiveError(
        "ARCHIVE_NOT_FOUND",
        `no archived Claude session found for "${options.id}"${options.version ? ` (version ${options.version})` : ""}`,
        2,
      );
    }

    const archiveAbsPath = join(paths.cliRoot, targetVersion.archiveRelPath);
    // Cryptographic & structural verification inside `.staging/` BEFORE touching destination.
    const manifest = verifyTarballAgainstIndex(
      archiveAbsPath,
      paths.stagingDir,
      entry.sessionId,
      targetVersion,
    );

    const activeConfigDir =
      options.claudeConfigDir
        ? resolve(options.claudeConfigDir)
        : resolveClaudeConfigDirs(options)[0]!;
    const projectDirName =
      targetVersion.claudeProjectDirName || entry.claudeProjectDirName || encodeCwd(entry.originCwd);
    const targetProjectDir = join(activeConfigDir, "projects", projectDirName);

    const h2aState = loadH2aLivenessState(options, nowMs, deps);
    const claudeLiveFiles = readClaudeSessionsFiles(activeConfigDir, deps);
    const live = inspectSessionLiveness(
      entry.sessionId,
      entry.originCwd,
      h2aState,
      claudeLiveFiles,
    );
    if (live.blockers.length > 0) {
      throw new SessionArchiveError(
        "SESSION_LIVE",
        `refusing restore for ${entry.sessionId}: active blocker(s) [${live.blockers.join(", ")}]`,
        2,
      );
    }

    const epochTag = Math.floor(nowMs / 1000);
    const existingTargets = [
      join(targetProjectDir, `${entry.sessionId}.jsonl`),
      join(targetProjectDir, entry.sessionId),
    ].filter((p) => existsSync(p));

    if (existingTargets.length > 0 && onConflict !== "backup") {
      throw new SessionArchiveError(
        "RESTORE_TARGET_EXISTS",
        `restore target already exists on disk (${existingTargets.join(", ")}); rerun with --on-conflict backup`,
        2,
      );
    }

    const backedUpPaths: string[] = [];
    if (onConflict === "backup") {
      for (const existing of existingTargets) {
        let backupPath = `${existing}.bak-${epochTag}`;
        if (existsSync(backupPath)) {
          backupPath = `${existing}.bak-${nowMs}-${randomBytes(2).toString("hex")}`;
        }
        renameSync(existing, backupPath);
        backedUpPaths.push(backupPath);
      }
    }

    ensurePrivateDir(targetProjectDir);
    ensurePrivateDir(paths.stagingDir);
    const nonce = randomBytes(6).toString("hex");
    const unpackDir = join(paths.stagingDir, `restore-${entry.sessionId}-${process.pid}-${nonce}`);
    ensurePrivateDir(unpackDir);

    const restoredFiles: string[] = [];
    try {
      const extractRes = spawnSync(
        "tar",
        ["--no-same-owner", "--no-same-permissions", "-xzf", archiveAbsPath, "-C", unpackDir],
        { encoding: "utf8", env: cleanTarEnv(paths.stagingDir) },
      );
      if (extractRes.status !== 0) {
        throw new SessionArchiveError(
          "ARCHIVE_CORRUPTED",
          `tar extraction failed during restore: ${extractRes.stderr}`,
          2,
        );
      }

      const companionRoot = join(targetProjectDir, entry.sessionId);
      for (const fileMeta of manifest.files) {
        const src = join(unpackDir, fileMeta.relPath);
        const dest = join(targetProjectDir, fileMeta.relPath);
        ensurePrivateDir(dirname(dest));
        const tmpDest = join(
          dirname(dest),
          `.restore-${basename(dest)}-${process.pid}-${nonce}`,
        );
        copyFileSync(src, tmpDest);
        chmodSync(tmpDest, 0o600);
        // Set mtime to current time so Claude Code cleanup does not immediately purge restored session.
        utimesSync(tmpDest, nowDate, nowDate);
        renameSync(tmpDest, dest);
        restoredFiles.push(dest);
      }
      if (existsSync(companionRoot)) {
        touchTreeMtime(companionRoot, nowDate);
      }
      fsyncDirBestEffort(targetProjectDir);
    } finally {
      try {
        rmSync(unpackDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of restore staging folder.
      }
    }

    const restoredAt = nowDate.toISOString();
    const updatedSessions: Record<string, SessionArchiveIndexEntry> = {
      ...index.sessions,
      [entry.sessionId]: {
        ...entry,
        restoredAt,
        restoredFromArchiveId: targetVersion.archiveId,
      },
    };
    writeAtomicPrivateJson(
      paths.indexPath,
      {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        cli: "claude",
        updatedAt: restoredAt,
        sessions: updatedSessions,
      } satisfies SessionArchiveIndex,
      paths.stagingDir,
    );

    return {
      ok: true,
      sessionId: entry.sessionId,
      archiveId: targetVersion.archiveId,
      originCwd: targetVersion.originCwd || entry.originCwd,
      targetProjectDir,
      restoredFiles,
      backedUpPaths,
      restoredAt,
      alerts: readClaudeArchiveAlerts({ ...options, nowMs }),
    };
  });
}

// ---------------------------------------------------------------------------
// Auto-restore on resume (Q2-A)
// ---------------------------------------------------------------------------

function findClaudeTranscriptOnDisk(
  convId: string,
  configDirs: ReadonlyArray<string>,
): string | undefined {
  for (const configDir of configDirs) {
    const projectsRoot = join(configDir, "projects");
    if (!existsSync(projectsRoot)) continue;
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.isSymbolicLink())
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const dirName of projectDirs) {
      const candidate = join(projectsRoot, dirName, `${convId}.jsonl`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Q2-A resume hook: if Claude session `convId` is absent from disk but exists
 * in local verified archives, verify SHA-256 and restore it before launching Claude.
 * Also reads current `<14d` archive alerts on the fly so callers can surface them.
 */
export function ensureClaudeSessionRestoredForResume(
  options: EnsureResumeRestoreOptions,
): EnsureResumeRestoreResult {
  const deps = options.deps ?? {};
  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const configDirs = resolveClaudeConfigDirs(options);
  const onDisk = findClaudeTranscriptOnDisk(options.convId, configDirs);
  if (onDisk) {
    return {
      status: "already-on-disk",
      transcriptPath: onDisk,
      alerts: readClaudeArchiveAlerts({ ...options, nowMs }),
    };
  }

  const paths = resolveArchivePaths(options);
  const index = loadArchiveIndex(paths.indexPath);
  if (!index.sessions[options.convId] || index.sessions[options.convId]!.versions.length === 0) {
    return {
      status: "not-archived",
      alerts: readClaudeArchiveAlerts({ ...options, nowMs }),
    };
  }

  const restored = restoreSessionArchive({
    ...options,
    id: options.convId,
    onConflict: "refuse",
  });
  return {
    status: "restored",
    transcriptPath: join(restored.targetProjectDir, `${restored.sessionId}.jsonl`),
    originCwd: restored.originCwd,
    archiveId: restored.archiveId,
    alerts: restored.alerts,
  };
}

export function emitResumeArchiveNotices(
  result: EnsureResumeRestoreResult,
  stderr: NodeJS.WritableStream = process.stderr,
): void {
  if (result.status === "restored") {
    stderr.write(
      `h2a resume: restored archived Claude session ${basename(result.transcriptPath ?? "", ".jsonl")} (${result.archiveId}) to ${dirname(result.transcriptPath ?? "")}\n`,
    );
  }
  for (const alert of result.alerts) {
    stderr.write(`h2a resume: ${formatArchiveAlertLine(alert)}\n`);
  }
}

// ---------------------------------------------------------------------------
// External-scheduler one-shot entrypoint (`runArchivePassOnce`)
// ---------------------------------------------------------------------------

function isKillSwitchEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.H2A_ARCHIVE_OFF?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function runArchivePassOnce(options: ArchiveRunOptions = {}): PassOnceResult {
  const deps = options.deps ?? {};
  const env = options.env ?? process.env;
  const startMs = deps.nowMs ? deps.nowMs() : Date.now();
  const startedAt = new Date(startMs).toISOString();
  const paths = resolveArchivePaths(options);

  if (isKillSwitchEnabled(env)) {
    const finishedMs = deps.nowMs ? deps.nowMs() : Date.now();
    const witness: ArchiveLastRunWitness = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      cli: "claude",
      status: "skipped",
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: Math.max(0, finishedMs - startMs),
      reason: "disabled-by-env:H2A_ARCHIVE_OFF",
      scanned: 0,
      archived: 0,
      skippedIdempotent: 0,
      skippedLiveOrRecent: 0,
      skippedBlocked: 0,
      alertsCount: readClaudeArchiveAlerts({ ...options, nowMs: finishedMs }).length,
    };
    writeAtomicPrivateJson(paths.lastRunPath, witness, paths.stagingDir);
    return { ok: true, exitCode: 0, witness };
  }

  return withArchiveLock(paths, () => {
    try {
      const runResult = executeArchiveRunUnlocked(options);
      const finishedMs = deps.nowMs ? deps.nowMs() : Date.now();
      const status: ArchiveLastRunWitness["status"] =
        runResult.ok
          ? "ok"
          : runResult.archived.length > 0 && runResult.stoppedForDiskGuard
            ? "partial"
            : "error";
      const witness: ArchiveLastRunWitness = {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        cli: "claude",
        status,
        startedAt,
        finishedAt: runResult.finishedAt,
        durationMs: Math.max(0, finishedMs - startMs),
        ...(runResult.errorCode ? { reason: runResult.errorCode } : {}),
        ...(runResult.errorMessage ? { error: runResult.errorMessage } : {}),
        scanned: runResult.scannedCount,
        archived: runResult.archived.length,
        skippedIdempotent: runResult.skippedIdempotent.length,
        skippedLiveOrRecent: runResult.skippedBlocked.filter((b) =>
          b.reasons.some(
            (r) =>
              r.startsWith("recent-activity-grace") ||
              r.startsWith("within-older-than") ||
              r.includes("live"),
          ),
        ).length,
        skippedBlocked: runResult.skippedBlocked.length,
        alertsCount: runResult.alerts.length,
      };
      writeAtomicPrivateJson(paths.lastRunPath, witness, paths.stagingDir);
      return {
        ok: runResult.ok,
        exitCode: runResult.ok ? 0 : 2,
        witness,
        runResult,
      };
    } catch (error) {
      const finishedMs = deps.nowMs ? deps.nowMs() : Date.now();
      const msg = error instanceof Error ? error.message : String(error);
      const witness: ArchiveLastRunWitness = {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        cli: "claude",
        status: "error",
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: Math.max(0, finishedMs - startMs),
        reason: error instanceof SessionArchiveError ? error.code : "UNEXPECTED_ERROR",
        error: msg,
        scanned: 0,
        archived: 0,
        skippedIdempotent: 0,
        skippedLiveOrRecent: 0,
        skippedBlocked: 0,
        alertsCount: readClaudeArchiveAlerts({ ...options, nowMs: finishedMs }).length,
      };
      writeAtomicPrivateJson(paths.lastRunPath, witness, paths.stagingDir);
      return {
        ok: false,
        exitCode: error instanceof SessionArchiveError ? error.exitCode : 2,
        witness,
      };
    }
  });
}

export { loadLastRunWitness };
