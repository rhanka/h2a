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
export const DEFAULT_PASS_STALE_HOURS = 48;

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
  | "archive-run-failed"
  | "archive-index-unreadable"
  | "archive-pass-overdue"
  | "archive-disabled";

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
  readonly status: "ok" | "skipped" | "partial" | "error" | "locked";
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

export type ArchiveIndexReadResult =
  | { readonly state: "absent"; readonly index: SessionArchiveIndex }
  | { readonly state: "ok"; readonly index: SessionArchiveIndex }
  | {
      readonly state: "unreadable";
      readonly reason: "io-error" | "invalid-json" | "unknown-schema" | "malformed";
      readonly detail: string;
      readonly foundSchemaVersion?: unknown;
    };

export function createEmptyArchiveIndex(): SessionArchiveIndex {
  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    cli: "claude",
    updatedAt: new Date(0).toISOString(),
    sessions: {},
  };
}

export function isArchiveKillSwitchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.H2A_ARCHIVE_OFF?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function readArchiveIndexState(indexPath: string): ArchiveIndexReadResult {
  let lst;
  try {
    lst = lstatSync(indexPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return { state: "absent", index: createEmptyArchiveIndex() };
    }
    return {
      state: "unreadable",
      reason: "io-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (lst.isSymbolicLink() || !lst.isFile()) {
    return {
      state: "unreadable",
      reason: "malformed",
      detail: "archive index is not a regular file",
    };
  }

  let raw: string;
  try {
    raw = readFileSync(indexPath, "utf8");
  } catch (error) {
    return {
      state: "unreadable",
      reason: "io-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      state: "unreadable",
      reason: "invalid-json",
      detail: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      state: "unreadable",
      reason: "malformed",
      detail: "archive index root must be a JSON object",
    };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    return {
      state: "unreadable",
      reason: "unknown-schema",
      detail: `unsupported archive index schemaVersion ${String(obj.schemaVersion)} (expected ${ARCHIVE_SCHEMA_VERSION})`,
      foundSchemaVersion: obj.schemaVersion,
    };
  }
  if (obj.cli !== "claude") {
    return {
      state: "unreadable",
      reason: "unknown-schema",
      detail: `unsupported archive index cli ${String(obj.cli)}`,
    };
  }
  if (!obj.sessions || typeof obj.sessions !== "object" || Array.isArray(obj.sessions)) {
    return {
      state: "unreadable",
      reason: "malformed",
      detail: "archive index missing valid sessions map",
    };
  }
  for (const [key, entry] of Object.entries(obj.sessions as Record<string, unknown>)) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !Array.isArray((entry as { versions?: unknown }).versions)
    ) {
      return {
        state: "unreadable",
        reason: "malformed",
        detail: `archive index entry "${key}" is malformed`,
      };
    }
  }

  return { state: "ok", index: parsed as SessionArchiveIndex };
}

export function loadArchiveIndex(indexPath: string): SessionArchiveIndex {
  const result = readArchiveIndexState(indexPath);
  if (result.state === "unreadable") {
    throw new Error(`archive index at ${indexPath} is unreadable (${result.detail})`);
  }
  return result.index;
}

export function loadPersistedAlerts(alertsPath: string): ArchiveAlert[] {
  return readPersistedAlertsFile(alertsPath)?.alerts ? [...readPersistedAlertsFile(alertsPath)!.alerts] : [];
}

function readPersistedAlertsFile(alertsPath: string): PersistedAlertsFile | undefined {
  try {
    if (!existsSync(alertsPath)) return undefined;
    const parsed = JSON.parse(readFileSync(alertsPath, "utf8")) as PersistedAlertsFile;
    if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.alerts)) {
      return parsed;
    }
  } catch {
    // Ignore malformed alert cache; deadline alerts are recomputed on the fly.
  }
  return undefined;
}

export type LastRunWitnessReadResult =
  | { readonly state: "absent" }
  | { readonly state: "ok"; readonly witness: ArchiveLastRunWitness }
  | { readonly state: "unreadable"; readonly detail: string };

export function readLastRunWitnessState(lastRunPath: string): LastRunWitnessReadResult {
  let lst;
  try {
    lst = lstatSync(lastRunPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { state: "absent" };
    return {
      state: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (lst.isSymbolicLink() || !lst.isFile()) {
    return { state: "unreadable", detail: "last-run witness is not a regular file" };
  }
  try {
    const parsed = JSON.parse(readFileSync(lastRunPath, "utf8")) as ArchiveLastRunWitness;
    if (parsed && parsed.schemaVersion === 1 && typeof parsed.status === "string") {
      return { state: "ok", witness: parsed };
    }
    return { state: "unreadable", detail: "last-run witness has invalid schema or status" };
  } catch (error) {
    return {
      state: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function loadLastRunWitness(lastRunPath: string): ArchiveLastRunWitness | undefined {
  const result = readLastRunWitnessState(lastRunPath);
  return result.state === "ok" ? result.witness : undefined;
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
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    const relPath = `${relPrefix}/${entry.name}`;
    let lst;
    try {
      lst = lstatSync(absPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
      throw error;
    }
    if (lst.isSymbolicLink()) continue;
    if (lst.isDirectory()) {
      collectStatTreeForAlerts(absPath, relPath, out);
    } else if (lst.isFile()) {
      let big;
      try {
        big = statSync(absPath, { bigint: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
        throw error;
      }
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
  readonly maxPassAgeHours?: number;
  readonly lastRunOverride?: ArchiveLastRunWitness;
}

function resolvePassStaleHours(options: ReadAlertsOptions, env: NodeJS.ProcessEnv): number {
  if (
    typeof options.maxPassAgeHours === "number" &&
    Number.isFinite(options.maxPassAgeHours) &&
    options.maxPassAgeHours > 0
  ) {
    return options.maxPassAgeHours;
  }
  const envVal = Number.parseFloat(env.H2A_ARCHIVE_STALE_HOURS ?? "");
  if (Number.isFinite(envVal) && envVal > 0) {
    return envVal;
  }
  return DEFAULT_PASS_STALE_HOURS;
}

/**
 * Compute current `<14d` unarchived Claude session purge deadline alerts on the fly,
 * merged with index health, kill-switch/pass-delay state from `last-run.json`,
 * and persisted operational guard alerts (disk guard / PID guard / run error).
 */
export function readClaudeArchiveAlerts(options: ReadAlertsOptions = {}): ArchiveAlert[] {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const alertWindowDays = options.alertWindowDays ?? DEFAULT_ALERT_WINDOW_DAYS;
  const paths = resolveArchivePaths(options);
  const configDirs = resolveClaudeConfigDirs(options);
  const indexState = readArchiveIndexState(paths.indexPath);
  const index = indexState.state === "unreadable" ? createEmptyArchiveIndex() : indexState.index;
  const alertsById = new Map<string, ArchiveAlert>();

  if (indexState.state === "unreadable") {
    alertsById.set("guard:index-unreadable", {
      id: "guard:index-unreadable",
      kind: "archive-index-unreadable",
      severity: "error",
      cli: "claude",
      message: `Archive index unreadable (${paths.indexPath}): ${indexState.detail}. Run \`h2a archive rebuild-index\` after inspecting.`,
      updatedAt: nowIso,
    });
  }

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

        const indexed = Object.hasOwn(index.sessions, sessionId)
          ? index.sessions[sessionId]
          : undefined;
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

        const alertId = `purge:${sessionId}`;
        alertsById.set(alertId, {
          id: alertId,
          kind: "purge-imminent",
          severity: deadline.daysRemaining <= 3 ? "error" : "warning",
          cli: "claude",
          sessionId,
          originCwd,
          purgeAt: deadline.purgeAt,
          daysRemaining: deadline.daysRemaining,
          unarchivedReason,
          message: `session ${sessionId} (${originCwd}): ${statusText}; ${timingText}. Run \`h2a archive run\`.`,
          updatedAt: nowIso,
        });
      }
    }
  }

  const persistedFile = readPersistedAlertsFile(paths.alertsPath);
  const persistedUpdatedAtMs = persistedFile ? Date.parse(persistedFile.updatedAt) : Number.NaN;
  for (const persisted of persistedFile?.alerts ?? []) {
    if (persisted.kind === "purge-imminent") continue;
    if (persisted.id === "guard:index-unreadable" && indexState.state !== "unreadable") {
      continue;
    }
    if (!alertsById.has(persisted.id)) {
      alertsById.set(persisted.id, persisted);
    }
  }

  const killSwitchOn = isArchiveKillSwitchEnabled(env);
  const lastRunState: LastRunWitnessReadResult = options.lastRunOverride
    ? { state: "ok", witness: options.lastRunOverride }
    : readLastRunWitnessState(paths.lastRunPath);
  if (lastRunState.state === "unreadable") {
    alertsById.set("guard:last-run-witness", {
      id: "guard:last-run-witness",
      kind: "archive-run-failed",
      severity: "error",
      cli: "claude",
      message: `Archive last-run witness unreadable (${paths.lastRunPath}): ${lastRunState.detail}.`,
      updatedAt: nowIso,
    });
  } else if (lastRunState.state === "ok") {
    const w = lastRunState.witness;
    const witnessFinishedMs = Date.parse(w.finishedAt);
    const supersededByCleanRun =
      Number.isFinite(persistedUpdatedAtMs) &&
      Number.isFinite(witnessFinishedMs) &&
      persistedUpdatedAtMs > witnessFinishedMs &&
      !alertsById.has("guard:last-run");
    if (
      (w.status === "error" || w.status === "partial") &&
      !supersededByCleanRun &&
      !alertsById.has("guard:last-run") &&
      !alertsById.has("guard:disk-space") &&
      !alertsById.has("guard:pid-namespace") &&
      !alertsById.has("guard:index-unreadable")
    ) {
      alertsById.set("guard:last-run", {
        id: "guard:last-run",
        kind: "archive-run-failed",
        severity: "error",
        cli: "claude",
        message: `Last archive pass ended with status=${w.status}${w.reason ? ` (${w.reason})` : ""}${w.error ? `: ${w.error}` : ""}.`,
        updatedAt: w.finishedAt,
      });
    } else if (w.status === "locked" && !supersededByCleanRun) {
      alertsById.set("guard:last-run-locked", {
        id: "guard:last-run-locked",
        kind: "archive-run-failed",
        severity: "warning",
        cli: "claude",
        message: `Last archive pass was skipped due to active writer lock (${w.reason ?? "ARCHIVE_LOCKED"}).`,
        updatedAt: w.finishedAt,
      });
    }

    if (killSwitchOn || (w.status === "skipped" && w.reason?.startsWith("disabled-by-env"))) {
      alertsById.set("guard:archive-disabled", {
        id: "guard:archive-disabled",
        kind: "archive-disabled",
        severity: "warning",
        cli: "claude",
        message: killSwitchOn
          ? "Archive automatic passes disabled by H2A_ARCHIVE_OFF."
          : `Last archive pass was skipped because ${w.reason ?? "H2A_ARCHIVE_OFF"} was active.`,
        updatedAt: killSwitchOn ? nowIso : w.finishedAt,
      });
    }

    if (!killSwitchOn) {
      const staleHours = resolvePassStaleHours(options, env);
      const finishedMs = Date.parse(w.finishedAt);
      const ageMs = Number.isFinite(finishedMs) ? nowMs - finishedMs : Number.POSITIVE_INFINITY;
      if (ageMs > staleHours * 3600 * 1000) {
        const ageHoursText = Number.isFinite(ageMs)
          ? `${Math.floor(ageMs / (3600 * 1000))}h`
          : "unknown age";
        alertsById.set("guard:pass-overdue", {
          id: "guard:pass-overdue",
          kind: "archive-pass-overdue",
          severity: "warning",
          cli: "claude",
          message: `Last archive pass (${w.finishedAt}) is overdue (${ageHoursText} ago > ${staleHours}h threshold).`,
          updatedAt: nowIso,
        });
      }
    }
  } else if (killSwitchOn) {
    alertsById.set("guard:archive-disabled", {
      id: "guard:archive-disabled",
      kind: "archive-disabled",
      severity: "warning",
      cli: "claude",
      message: "Archive automatic passes disabled by H2A_ARCHIVE_OFF.",
      updatedAt: nowIso,
    });
  }

  const alerts = [...alertsById.values()];
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
