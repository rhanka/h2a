/**
 * Pure read-only Claude Code purge deadline & session archive alert reader.
 *
 * Intentionally limited to Node built-ins (`node:fs`, `node:os`, `node:path`)
 * so `@sentropic/h2a` can lazily load `@sentropic/h2a-runtime/session-archive-alerts`
 * for `h2a status` without pulling `node-pty`, `@aws-sdk/client-s3`, or tmux.
 * Never mutates source conversations or archive state.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const ARCHIVE_SCHEMA_VERSION = 1;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CLAUDE_CLEANUP_DAYS = 30;
export const DEFAULT_ALERT_WINDOW_DAYS = 14;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ArchiveCliKind = "claude";

export interface ArchiveFileSnapshot {
  readonly relPath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mtimeNs: string;
  readonly inode: string;
  readonly mode: number;
}

export interface ArchiveFileManifestEntry {
  readonly relPath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mtimeNs: string;
  readonly mode: number;
  readonly sha256: string;
}

export interface ArchiveVersionRecord {
  readonly archiveId: string;
  readonly version: number;
  readonly status: "committed";
  readonly archiveRelPath: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly createdAt: string;
  readonly createdAtMs: number;
  readonly originCwd: string;
  readonly claudeConfigDir: string;
  readonly claudeProjectDirName: string;
  readonly cleanupPeriodDays: number;
  readonly transcriptMtimeMs: number;
  readonly purgeAt: string;
  readonly copyNotes: ReadonlyArray<string>;
  readonly sourceSnapshot: ReadonlyArray<ArchiveFileSnapshot>;
  readonly filesManifest: ReadonlyArray<ArchiveFileManifestEntry>;
}

export interface SessionArchiveIndexEntry {
  readonly sessionId: string;
  readonly cli: ArchiveCliKind;
  readonly claudeConfigDir: string;
  readonly claudeProjectDirName: string;
  readonly originCwd: string;
  readonly restoredAt?: string;
  readonly restoredFromArchiveId?: string;
  readonly versions: ReadonlyArray<ArchiveVersionRecord>;
}

export interface SessionArchiveIndex {
  readonly schemaVersion: 1;
  readonly cli: ArchiveCliKind;
  readonly updatedAt: string;
  readonly sessions: Readonly<Record<string, SessionArchiveIndexEntry>>;
}

export type ArchiveAlertSeverity = "warning" | "error";

export type ArchiveAlertKind =
  | "purge-imminent"
  | "disk-space-low"
  | "pid-namespace-guard"
  | "archive-run-failed";

export interface ArchiveAlert {
  readonly id: string;
  readonly kind: ArchiveAlertKind;
  readonly severity: ArchiveAlertSeverity;
  readonly cli: ArchiveCliKind;
  readonly sessionId?: string;
  readonly originCwd?: string;
  readonly purgeAt?: string;
  readonly daysRemaining?: number;
  readonly unarchivedReason?: "never-archived" | "modified-since-archive" | "archive-missing-on-disk";
  readonly message: string;
  readonly updatedAt: string;
}

export interface PersistedAlertsFile {
  readonly schemaVersion: 1;
  readonly updatedAt: string;
  readonly alerts: ReadonlyArray<ArchiveAlert>;
}

export interface ArchiveLastRunWitness {
  readonly schemaVersion: 1;
  readonly cli: ArchiveCliKind;
  readonly status: "ok" | "skipped" | "partial" | "error";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly reason?: string;
  readonly scanned: number;
  readonly archived: number;
  readonly skippedIdempotent: number;
  readonly skippedLiveOrRecent: number;
  readonly skippedBlocked: number;
  readonly alertsCount: number;
  readonly error?: string;
}

export interface ArchivePaths {
  readonly root: string;
  readonly lockTargetPath: string;
  readonly lockPath: string;
  readonly stagingDir: string;
  readonly lastRunPath: string;
  readonly alertsPath: string;
  readonly cliRoot: string;
  readonly indexPath: string;
}

export interface ClaudeCleanupPolicy {
  readonly cleanupPeriodDays: number;
  readonly source: "settings.local.json" | "settings.json" | "default";
}

export interface ArchivePathOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly archiveRoot?: string;
  readonly claudeConfigDirs?: ReadonlyArray<string>;
}

export function isUuidFileStem(value: string): boolean {
  return UUID_RE.test(value);
}

export function resolveArchivePaths(options: ArchivePathOptions = {}): ArchivePaths {
  const env = options.env ?? process.env;
  const home = options.home ?? (env.HOME && env.HOME.trim() ? resolve(env.HOME) : homedir());
  const xdgData =
    env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim()
      ? resolve(env.XDG_DATA_HOME)
      : join(home, ".local", "share");
  const root = options.archiveRoot
    ? resolve(options.archiveRoot)
    : join(xdgData, "h2a", "session-archives");
  const cliRoot = join(root, "claude");
  const lockTargetPath = join(root, "archive");
  return {
    root,
    lockTargetPath,
    lockPath: `${lockTargetPath}.lock`,
    stagingDir: join(root, ".staging"),
    lastRunPath: join(root, "last-run.json"),
    alertsPath: join(root, "alerts.json"),
    cliRoot,
    indexPath: join(cliRoot, "index.json"),
  };
}

export function resolveClaudeConfigDirs(options: ArchivePathOptions = {}): string[] {
  if (options.claudeConfigDirs && options.claudeConfigDirs.length > 0) {
    return [...new Set(options.claudeConfigDirs.map((dir) => resolve(dir)))];
  }
  const env = options.env ?? process.env;
  const home = options.home ?? (env.HOME && env.HOME.trim() ? resolve(env.HOME) : homedir());
  const envConfig = env.CLAUDE_CONFIG_DIR?.trim();
  if (envConfig) {
    return [resolve(envConfig)];
  }
  return [join(home, ".claude")];
}

function parseCleanupPeriodDays(filePath: string): number | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = parsed.cleanupPeriodDays;
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const floored = Math.floor(value);
    if (floored < 1) return undefined;
    return floored;
  } catch {
    return undefined;
  }
}

/**
 * Resolve effective Claude retention period.
 * Takes conservative minimum across `settings.json` and `settings.local.json`;
 * falls back to Claude Code's documented 30-day default when missing or invalid.
 */
export function readClaudeCleanupPeriodDays(claudeConfigDir: string): ClaudeCleanupPolicy {
  const baseDays = parseCleanupPeriodDays(join(claudeConfigDir, "settings.json"));
  const localDays = parseCleanupPeriodDays(join(claudeConfigDir, "settings.local.json"));
  if (baseDays !== undefined && localDays !== undefined) {
    return localDays <= baseDays
      ? { cleanupPeriodDays: localDays, source: "settings.local.json" }
      : { cleanupPeriodDays: baseDays, source: "settings.json" };
  }
  if (localDays !== undefined) {
    return { cleanupPeriodDays: localDays, source: "settings.local.json" };
  }
  if (baseDays !== undefined) {
    return { cleanupPeriodDays: baseDays, source: "settings.json" };
  }
  return { cleanupPeriodDays: DEFAULT_CLAUDE_CLEANUP_DAYS, source: "default" };
}

export function loadArchiveIndex(indexPath: string): SessionArchiveIndex {
  try {
    if (!existsSync(indexPath)) {
      return {
        schemaVersion: 1,
        cli: "claude",
        updatedAt: new Date(0).toISOString(),
        sessions: {},
      };
    }
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as SessionArchiveIndex;
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      parsed.sessions &&
      typeof parsed.sessions === "object"
    ) {
      return parsed;
    }
  } catch {
    // Callers see empty/missing index on unreadable/corrupt file and handle verification safely.
  }
  return {
    schemaVersion: 1,
    cli: "claude",
    updatedAt: new Date(0).toISOString(),
    sessions: {},
  };
}

export function loadPersistedAlerts(alertsPath: string): ArchiveAlert[] {
  try {
    if (!existsSync(alertsPath)) return [];
    const parsed = JSON.parse(readFileSync(alertsPath, "utf8")) as PersistedAlertsFile;
    if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.alerts)) {
      return [...parsed.alerts];
    }
  } catch {
    // Ignore malformed alert cache; deadline alerts are recomputed on the fly.
  }
  return [];
}

export function loadLastRunWitness(lastRunPath: string): ArchiveLastRunWitness | undefined {
  try {
    if (!existsSync(lastRunPath)) return undefined;
    const parsed = JSON.parse(readFileSync(lastRunPath, "utf8")) as ArchiveLastRunWitness;
    if (parsed && parsed.schemaVersion === 1 && typeof parsed.status === "string") {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function statSnapshotMatches(
  current: ReadonlyArray<ArchiveFileSnapshot>,
  recorded: ReadonlyArray<ArchiveFileSnapshot>,
): boolean {
  if (current.length !== recorded.length) return false;
  for (let i = 0; i < current.length; i++) {
    const a = current[i];
    const b = recorded[i];
    if (!a || !b) return false;
    if (
      a.relPath !== b.relPath ||
      a.size !== b.size ||
      a.mtimeNs !== b.mtimeNs ||
      a.inode !== b.inode
    ) {
      return false;
    }
  }
  return true;
}

function collectStatTreeForAlerts(
  absDir: string,
  relPrefix: string,
  out: ArchiveFileSnapshot[],
): void {
  const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    const relPath = `${relPrefix}/${entry.name}`;
    const lst = lstatSync(absPath);
    if (lst.isSymbolicLink()) continue;
    if (lst.isDirectory()) {
      collectStatTreeForAlerts(absPath, relPath, out);
    } else if (lst.isFile()) {
      const big = statSync(absPath, { bigint: true });
      out.push({
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

export function collectSessionSourceSnapshots(
  projectDir: string,
  sessionId: string,
): { readonly snapshots: ArchiveFileSnapshot[]; readonly transcriptMtimeMs: number } | undefined {
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
  try {
    const lst = lstatSync(jsonlPath);
    if (!lst.isFile() || lst.isSymbolicLink()) return undefined;
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
    const companionDir = join(projectDir, sessionId);
    if (existsSync(companionDir)) {
      const companionStat = lstatSync(companionDir);
      if (companionStat.isDirectory() && !companionStat.isSymbolicLink()) {
        collectStatTreeForAlerts(companionDir, sessionId, snapshots);
      }
    }
    snapshots.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return {
      snapshots,
      transcriptMtimeMs: Math.floor(lst.mtimeMs),
    };
  } catch {
    return undefined;
  }
}

export function extractOriginCwdHint(
  jsonlPath: string,
  claudeProjectDirName: string,
): string {
  try {
    const raw = readFileSync(jsonlPath, "utf8");
    const lines = raw.slice(0, 32 * 1024).split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { cwd?: unknown };
        if (typeof obj?.cwd === "string" && obj.cwd.length > 0) {
          return obj.cwd;
        }
      } catch {
        // Ignore truncated last line of 32 KiB prefix.
      }
    }
  } catch {
    // Fall back to project dir name decode below.
  }
  return decodeClaudeProjectDirBestEffort(claudeProjectDirName);
}

/**
 * Decode Claude's `-path-to-workspace` folder name back into a readable path
 * without inventing nonexistent separators when existing directories clarify hyphens.
 */
export function decodeClaudeProjectDirBestEffort(dirName: string): string {
  if (!dirName.startsWith("-")) return dirName;
  const parts = dirName.slice(1).split("-");
  const findExisting = (index: number, currentPath: string): string | undefined => {
    if (index >= parts.length) {
      return existsSync(currentPath) ? currentPath : undefined;
    }
    for (let end = parts.length; end > index; end--) {
      const segment = parts.slice(index, end).join("-");
      const next = currentPath === "/" ? `/${segment}` : `${currentPath}/${segment}`;
      if (existsSync(next)) {
        const resolved = findExisting(end, next);
        if (resolved) return resolved;
      }
    }
    return undefined;
  };
  return findExisting(0, "/") ?? `/${parts.join("/")}`;
}

export function computePurgeDeadline(
  transcriptMtimeMs: number,
  cleanupPeriodDays: number,
  nowMs: number,
  alertWindowDays = DEFAULT_ALERT_WINDOW_DAYS,
): {
  readonly purgeAtMs: number;
  readonly purgeAt: string;
  readonly msRemaining: number;
  readonly daysRemaining: number;
  readonly withinAlertWindow: boolean;
} {
  const purgeAtMs = transcriptMtimeMs + cleanupPeriodDays * DAY_MS;
  const msRemaining = purgeAtMs - nowMs;
  const daysRemaining = Math.floor(msRemaining / DAY_MS);
  const withinAlertWindow = msRemaining < alertWindowDays * DAY_MS;
  return {
    purgeAtMs,
    purgeAt: new Date(purgeAtMs).toISOString(),
    msRemaining,
    daysRemaining,
    withinAlertWindow,
  };
}

function sha256FileQuick(filePath: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

export function contentMatchesManifest(
  projectDir: string,
  snapshots: ReadonlyArray<ArchiveFileSnapshot>,
  manifestFiles: ReadonlyArray<ArchiveFileManifestEntry>,
): boolean {
  if (snapshots.length !== manifestFiles.length) return false;
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const rec = manifestFiles[i];
    if (!snap || !rec) return false;
    if (snap.relPath !== rec.relPath || snap.size !== rec.size) return false;
    const digest = sha256FileQuick(join(projectDir, snap.relPath));
    if (!digest || digest !== rec.sha256) return false;
  }
  return true;
}

export interface ReadAlertsOptions extends ArchivePathOptions {
  readonly nowMs?: number;
  readonly alertWindowDays?: number;
}

/**
 * Compute current `<14d` unarchived Claude session purge deadline alerts on the fly,
 * merged with persisted operational guard alerts (disk guard / PID guard / run error).
 */
export function readClaudeArchiveAlerts(options: ReadAlertsOptions = {}): ArchiveAlert[] {
  const nowMs = options.nowMs ?? Date.now();
  const alertWindowDays = options.alertWindowDays ?? DEFAULT_ALERT_WINDOW_DAYS;
  const paths = resolveArchivePaths(options);
  const configDirs = resolveClaudeConfigDirs(options);
  const index = loadArchiveIndex(paths.indexPath);
  const alerts: ArchiveAlert[] = [];

  for (const configDir of configDirs) {
    const projectsRoot = join(configDir, "projects");
    if (!existsSync(projectsRoot)) continue;
    const { cleanupPeriodDays } = readClaudeCleanupPeriodDays(configDir);
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.isSymbolicLink())
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }

    for (const projectDirName of projectDirs) {
      const projectDir = join(projectsRoot, projectDirName);
      let entries;
      try {
        entries = readdirSync(projectDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        if (!entry.name.endsWith(".jsonl")) continue;
        const sessionId = basename(entry.name, ".jsonl");
        if (!isUuidFileStem(sessionId)) continue;

        const collected = collectSessionSourceSnapshots(projectDir, sessionId);
        if (!collected) continue;

        const indexed = index.sessions[sessionId];
        const latest = indexed?.versions[indexed.versions.length - 1];
        const deadline = computePurgeDeadline(
          collected.transcriptMtimeMs,
          cleanupPeriodDays,
          nowMs,
          alertWindowDays,
        );
        if (!deadline.withinAlertWindow) continue;

        let unarchivedReason:
          | "never-archived"
          | "modified-since-archive"
          | "archive-missing-on-disk"
          | undefined;
        if (!latest || latest.status !== "committed") {
          unarchivedReason = "never-archived";
        } else if (!existsSync(join(paths.cliRoot, latest.archiveRelPath))) {
          unarchivedReason = "archive-missing-on-disk";
        } else if (
          !statSnapshotMatches(collected.snapshots, latest.sourceSnapshot) &&
          !contentMatchesManifest(projectDir, collected.snapshots, latest.filesManifest)
        ) {
          unarchivedReason = "modified-since-archive";
        }

        if (!unarchivedReason) continue;

        const originCwd =
          indexed?.originCwd ??
          extractOriginCwdHint(join(projectDir, entry.name), projectDirName);
        const timingText =
          deadline.msRemaining <= 0
            ? `Claude purge overdue (${Math.abs(deadline.daysRemaining)}d past ${cleanupPeriodDays}d deadline)`
            : `Claude purge in ${deadline.daysRemaining}d (${deadline.purgeAt.slice(0, 10)}, ${cleanupPeriodDays}d policy)`;
        const statusText =
          unarchivedReason === "never-archived"
            ? "not yet archived"
            : unarchivedReason === "archive-missing-on-disk"
              ? "archive tarball missing on disk"
              : "modified since last archive";

        alerts.push({
          id: `purge:${sessionId}`,
          kind: "purge-imminent",
          severity: deadline.daysRemaining <= 3 ? "error" : "warning",
          cli: "claude",
          sessionId,
          originCwd,
          purgeAt: deadline.purgeAt,
          daysRemaining: deadline.daysRemaining,
          unarchivedReason,
          message: `session ${sessionId} (${originCwd}): ${statusText}; ${timingText}. Run \`h2a archive run\`.`,
          updatedAt: new Date(nowMs).toISOString(),
        });
      }
    }
  }

  for (const persisted of loadPersistedAlerts(paths.alertsPath)) {
    if (persisted.kind !== "purge-imminent") {
      alerts.push(persisted);
    }
  }

  alerts.sort((a, b) => {
    const aDays = a.daysRemaining ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysRemaining ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return a.id.localeCompare(b.id);
  });

  return alerts;
}

export function formatArchiveAlertLine(alert: ArchiveAlert): string {
  const prefix = alert.severity === "error" ? "URGENT" : "WARN";
  return `[archive ${prefix}] ${alert.message}`;
}
