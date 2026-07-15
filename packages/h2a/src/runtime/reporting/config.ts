import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TRACK_REPORT_AI_CONFIG = {
  argv: [
    "h2a",
    "report-ai",
    "--model",
    "claude-opus-4-8",
    "--effort",
    "xhigh",
    "--gateway",
    "required"
  ],
  timeoutMs: 600_000
} as const;

export const TRACK_REPORT_AI_CONFIG_TEXT = `${JSON.stringify(TRACK_REPORT_AI_CONFIG)}\n`;

export interface TrackReportAiConfigInstallOptions {
  readonly force?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
}

export interface TrackReportAiConfigInstallResult {
  readonly path: string;
  readonly status: "installed" | "unchanged" | "replaced";
}

export class TrackReportAiConfigConflictError extends Error {
  constructor(readonly path: string) {
    super(`preserving differing user config at ${path}; rerun with --force to replace it`);
    this.name = "TrackReportAiConfigConflictError";
  }
}

export function trackReportAiConfigPath(
  options: Pick<TrackReportAiConfigInstallOptions, "env" | "home"> = {}
): string {
  const env = options.env ?? process.env;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const home = (options.home ?? env.HOME?.trim()) || homedir();
  return join(xdg || join(home, ".config"), "track", "report-ai.json");
}

function atomicWrite0600(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    closeSync(fd);
    fd = undefined;
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export function installTrackReportAiConfig(
  options: TrackReportAiConfigInstallOptions = {}
): TrackReportAiConfigInstallResult {
  const path = trackReportAiConfigPath(options);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TrackReportAiConfigConflictError(path);
    }
    const current = readFileSync(path, "utf8");
    if (current === TRACK_REPORT_AI_CONFIG_TEXT) {
      chmodSync(path, 0o600);
      return { path, status: "unchanged" };
    }
    if (!options.force) throw new TrackReportAiConfigConflictError(path);
    atomicWrite0600(path, TRACK_REPORT_AI_CONFIG_TEXT);
    return { path, status: "replaced" };
  }
  atomicWrite0600(path, TRACK_REPORT_AI_CONFIG_TEXT);
  return { path, status: "installed" };
}
