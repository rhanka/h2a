/**
 * Claude Code CLI isolation: private filesystem root, clean environment,
 * and exclusive credential creation.
 */
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { readBootId, readPidNamespaceId, readProcessStartTime } from "./proc-identity.js";
import type { ClaudeCodeAccessProjection } from "./claude-seat-mesh-contract.js";

export interface ClaudeRunSandbox {
  readonly runId: string;
  readonly runDir: string;
  readonly homeDir: string;
  readonly configDir: string;
  readonly cwdDir: string;
  readonly tmpDir: string;
  readonly credentialPath: string;
  readonly settingsPath: string;
  readonly mcpConfigPath: string;
}

export const ALLOWED_ENV_VARS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "HOME",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "CLAUDE_CONFIG_DIR",
] as const;

/**
 * Verify a private directory: never a symlink, always a directory owned by
 * this user, always mode 0700. Pre-existing paths are tightened, never
 * trusted as found. Throws a static error on any refusal.
 */
function ensurePrivateDir(dir: string): string {
  let current;
  try {
    current = lstatSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Claude private runtime root refused");
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    current = lstatSync(dir);
  }
  if (current.isSymbolicLink()) {
    throw new Error("Claude private runtime root refused: symbolic link");
  }
  if (!current.isDirectory()) {
    throw new Error("Claude private runtime root refused: not a directory");
  }
  const euid = process.geteuid?.();
  if (typeof euid === "number" && current.uid !== euid) {
    throw new Error("Claude private runtime root refused: foreign owner");
  }
  try {
    chmodSync(dir, 0o700);
  } catch {
    throw new Error("Claude private runtime root refused");
  }
  const verified = lstatSync(dir);
  if (verified.isSymbolicLink() || !verified.isDirectory()) {
    throw new Error("Claude private runtime root refused");
  }
  if ((verified.mode & 0o777) !== 0o700) {
    throw new Error("Claude private runtime root refused: permissions");
  }
  if (typeof euid === "number" && verified.uid !== euid) {
    throw new Error("Claude private runtime root refused: foreign owner");
  }
  return dir;
}

function verifyUserBaseDir(dir: string): void {
  let current;
  try {
    current = lstatSync(dir);
  } catch {
    throw new Error("Claude private runtime root refused");
  }
  if (current.isSymbolicLink() || !current.isDirectory()) {
    throw new Error("Claude private runtime root refused");
  }
  const euid = process.geteuid?.();
  if (typeof euid === "number" && current.uid !== euid) {
    throw new Error("Claude private runtime root refused: foreign owner");
  }
}

/**
 * Resolve the dedicated private runtime root outside workspaces and backups.
 * Only per-user bases are candidates (XDG_RUNTIME_DIR, then /run/user/<euid>
 * on Linux). Shared temporary roots (/dev/shm, tmpdir()) are never used;
 * when no per-user base is available resolution fails closed.
 */
export function resolvePrivateRuntimeRoot(customRoot?: string): string {
  if (customRoot) {
    return ensurePrivateDir(customRoot);
  }
  const xdgBase = process.env.XDG_RUNTIME_DIR;
  if (xdgBase) {
    try {
      verifyUserBaseDir(xdgBase);
      return ensurePrivateDir(join(xdgBase, "h2a-claude-runtime"));
    } catch {
      // Fall through to the next per-user candidate.
    }
  }
  if (process.platform === "linux") {
    const euid = process.geteuid?.();
    if (typeof euid === "number") {
      try {
        const userBase = `/run/user/${euid}`;
        verifyUserBaseDir(userBase);
        return ensurePrivateDir(join(userBase, "h2a-claude-runtime"));
      } catch {
        // Fall through to fail-closed.
      }
    }
  }
  throw new Error("Claude private runtime root unavailable: no per-user runtime directory");
}

/**
 * Creates isolated 0700 run/config/home/cwd directories and an exclusive 0600 .credentials.json.
 * Writes access token only; real provider expiry preserved; NO refresh token.
 */
export function createClaudeRunSandbox(options: {
  readonly access: ClaudeCodeAccessProjection;
  readonly runId?: string;
  readonly rootDir?: string;
}): ClaudeRunSandbox {
  const runId = options.runId ?? `run_${randomUUID().replace(/-/g, "")}`;
  const root = resolvePrivateRuntimeRoot(options.rootDir);
  const runDir = join(root, runId);

  // 0700 private run directory
  mkdirSync(runDir, { recursive: true, mode: 0o700 });

  const homeDir = join(runDir, "home");
  const configDir = join(runDir, "config");
  const cwdDir = join(runDir, "cwd");
  const tmpDir = join(runDir, "tmp");

  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(cwdDir, { recursive: true, mode: 0o700 });
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  // Identity-anchored run metadata for orphan sweeps: pid plus start-time
  // and boot discriminants, so a later sweep can prove death instead of
  // guessing from pid presence or directory age.
  const runMeta = {
    pid: process.pid,
    startTime: readProcessStartTime(process.pid) ?? null,
    bootId: readBootId() ?? null,
    pidNamespace: readPidNamespaceId() ?? null,
    createdAt: Date.now(),
  };
  writeFileSync(join(runDir, "run-meta.json"), JSON.stringify(runMeta), { mode: 0o600 });

  const settingsPath = join(configDir, "settings.json");
  const mcpConfigPath = join(configDir, "mcp-config.json");
  writeFileSync(settingsPath, JSON.stringify({}), { mode: 0o600 });
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });

  const credentialPath = join(configDir, ".credentials.json");

  // Exclusive, no-follow creation (O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW)
  const openFlags =
    constants.O_CREAT |
    constants.O_EXCL |
    constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0);

  const fd = openSync(credentialPath, openFlags, 0o600);
  try {
    const credentialPayload = JSON.stringify({
      claudeAiOauth: {
        accessToken: options.access.accessToken,
        expiresAt: options.access.expiresAt,
        scopes: [...options.access.scopes],
      },
    });
    writeFileSync(fd, credentialPayload, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }

  // Verify ownership and permissions: must not be a symlink
  const lstat = lstatSync(credentialPath);
  if (lstat.isSymbolicLink()) {
    rmSync(runDir, { recursive: true, force: true });
    throw new Error("Credential file must not be a symbolic link");
  }

  return {
    runId,
    runDir,
    homeDir,
    configDir,
    cwdDir,
    tmpDir,
    credentialPath,
    settingsPath,
    mcpConfigPath,
  };
}

/**
 * Record child PID and start time in the run's run-meta.json so orphan sweeps
 * can identify and reap detached child process trees.
 */
export function recordChildPidInSandbox(sandbox: ClaudeRunSandbox, childPid: number): void {
  const metaPath = join(sandbox.runDir, "run-meta.json");
  try {
    const existing = JSON.parse(readFileSync(metaPath, "utf8"));
    const updated = {
      ...existing,
      childPid,
      childStartTime: readProcessStartTime(childPid) ?? null,
      childBootId: readBootId() ?? null,
      childPidNamespace: readPidNamespaceId() ?? null,
      childCwd: sandbox.cwdDir,
      runId: sandbox.runId,
    };
    writeFileSync(metaPath, JSON.stringify(updated), { mode: 0o600 });
  } catch {
    // Best effort
  }
}

/**
 * Construct an environment allowlist; strips all ambient auth, proxies, traces, and overrides.
 * PATH is never inherited: a fixed minimal value (plus the binary directory
 * when known) replaces whatever the parent carried.
 */
export function buildIsolatedEnvironment(
  sandbox: ClaudeRunSandbox,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: { readonly binaryPath?: string } = {},
): Record<string, string> {
  const fixedPath =
    options.binaryPath && isAbsolute(options.binaryPath)
      ? `${dirname(options.binaryPath)}:/usr/local/bin:/usr/bin:/bin`
      : "/usr/local/bin:/usr/bin:/bin";
  const safeEnv: Record<string, string> = {
    PATH: fixedPath,
    LANG: baseEnv.LANG ?? "C.UTF-8",
    LC_ALL: baseEnv.LC_ALL ?? "C.UTF-8",
    HOME: sandbox.homeDir,
    TMPDIR: sandbox.tmpDir,
    XDG_CONFIG_HOME: sandbox.configDir,
    CLAUDE_CONFIG_DIR: sandbox.configDir,
  };

  return safeEnv;
}

/**
 * Verify that the child process did not rewrite credentials, change auth, or write back a refresh token.
 */
export function verifyCredentialNotRewritten(
  sandbox: ClaudeRunSandbox,
  expectedAccess: ClaudeCodeAccessProjection,
): boolean {
  if (!existsSync(sandbox.credentialPath)) {
    return false;
  }
  const lstat = lstatSync(sandbox.credentialPath);
  if (lstat.isSymbolicLink()) {
    return false;
  }

  try {
    const raw = readFileSync(sandbox.credentialPath, "utf8");
    const parsed = JSON.parse(raw);
    const oauth = parsed?.claudeAiOauth;
    if (!oauth || typeof oauth !== "object") return false;

    // No refresh token allowed
    if ("refreshToken" in oauth || "refresh_token" in oauth) return false;

    // Must match expected access material
    if (oauth.accessToken !== expectedAccess.accessToken) return false;
    if (oauth.expiresAt !== expectedAccess.expiresAt) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Content-blind cleanup of the dedicated sandbox directory without following symlinks.
 * Throws a static error when the run directory persists: callers must block
 * any success terminal on cleanup failure (no success without custody release).
 */
export function cleanClaudeRunSandbox(sandbox: ClaudeRunSandbox): void {
  try {
    if (existsSync(sandbox.runDir)) {
      rmSync(sandbox.runDir, { recursive: true, force: true });
    }
  } catch {
    throw new Error("Claude run sandbox cleanup failed");
  }
  if (existsSync(sandbox.runDir)) {
    throw new Error("Claude run sandbox cleanup failed");
  }
}
