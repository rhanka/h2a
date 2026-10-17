/**
 * Crash logs: one documented, rotated, bounded JSONL log per component.
 *
 * Components:
 * - `native-host` → the existing life journal
 *   (`native-terminal/journal.ts`, `native-host.log`) — read-only here,
 *   owned by the native host process. Documented, not duplicated.
 * - `cli` → launcher/op failures (`native-host.ts` runOp/admission refusals).
 * - `attach` → attach-client detach/give-up reasons (remote `attach.ts` and
 *   the native `op.ts attach` bridge).
 * - `mcp-server` → central MCP spawn/readiness failures (`central-mcp.ts`).
 *
 * Every row carries timestamp, component, version, pid, session/instance id
 * when known, and a structured fatal record (uncaught exception, refusal with
 * reason, child exit with code/signal). Files live under
 * `${XDG_STATE_HOME:-$HOME/.local/state}/h2a/`, mode 0600, dir 0700, rotated
 * at MAX_CRASH_LOG_BYTES (current + one `.1` generation). Secrets are never
 * logged: values are redacted before serialization (see `redactCrashText`).
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export const CRASH_LOG_COMPONENTS = ["cli", "attach", "mcp-server"] as const;
export type CrashLogComponent = (typeof CRASH_LOG_COMPONENTS)[number];
export const NATIVE_HOST_LOG_COMPONENT = "native-host" as const;
export type CrashLogAnyComponent = CrashLogComponent | typeof NATIVE_HOST_LOG_COMPONENT;

export const MAX_CRASH_LOG_BYTES = 512 * 1024;

export type CrashLogEvent =
  | "start"
  | "uncaughtException"
  | "unhandledRejection"
  | "startupError"
  | "refusal"
  | "childExit"
  | "sessionExit"
  | "signal"
  | "stop"
  | "exit";

export interface CrashLogEntry {
  readonly event: CrashLogEvent;
  /** Session slug/id when the record belongs to one session; omitted otherwise. */
  readonly sessionId?: string | undefined;
  /** Host generation / MCP generation / launch id when known. */
  readonly instanceId?: string | undefined;
  /** Machine-readable reason code (refusal code, errno, op name). */
  readonly reason?: string | undefined;
  /** Human detail; redacted before write. */
  readonly detail?: string | undefined;
  /** Child/session exit code when known. */
  readonly exitCode?: number | undefined;
  /** Signal name when the fatal path is a signal. */
  readonly signal?: string | undefined;
}

export interface CrashLogRow {
  readonly timestamp: string;
  readonly component: string;
  readonly version: string;
  readonly pid: number;
  readonly event: CrashLogEvent;
  readonly sessionId?: string | undefined;
  readonly instanceId?: string | undefined;
  readonly reason?: string | undefined;
  readonly detail?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly signal?: string | undefined;
}

const CRASH_LOG_FILES: Record<CrashLogComponent, string> = {
  cli: "cli.log",
  attach: "attach.log",
  "mcp-server": "mcp-server.log",
};

export function resolveCrashLogPath(
  component: CrashLogComponent,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const state = env["XDG_STATE_HOME"];
  const base =
    state && isAbsolute(state)
      ? join(state, "h2a")
      : join(env["HOME"] || homedir(), ".local", "state", "h2a");
  return join(base, CRASH_LOG_FILES[component]);
}

/** State dir shared by all crash logs (and the native host journal). */
export function resolveCrashLogDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const state = env["XDG_STATE_HOME"];
  if (state && isAbsolute(state)) return join(state, "h2a");
  return join(env["HOME"] || homedir(), ".local", "state", "h2a");
}

let cachedVersion: string | undefined;
export function getCrashLogVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

/** Test-only: reset the cached version. */
export function resetCrashLogVersionForTests(): void {
  cachedVersion = undefined;
}

const PATH_ENV_KEYS = new Set([
  "HOME",
  "PATH",
  "PWD",
  "OLDPWD",
  "TMPDIR",
  "NODE_PATH",
  "TERM",
  "LANG",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
]);

/** Redact secret values and credential patterns; never throws. */
export function redactCrashText(value: string): string {
  let result = value.slice(0, 4096);
  try {
    for (const [key, secret] of Object.entries(process.env)) {
      if (!PATH_ENV_KEYS.has(key) && secret && secret.length >= 4) {
        result = result.split(secret).join("[REDACTED]");
      }
    }
  } catch {
    /* redaction best-effort */
  }
  return result
    .replace(/\b(?:authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, "[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+\S+/gi, "[REDACTED]")
    .replace(/\b(?:token|key|secret|password|credential|api_?key)\w*\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/:\/\/[^/\s]*@/g, "://[REDACTED]@");
}

function sanitizeField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const clean = redactCrashText(value).slice(0, 1024);
  return clean.length > 0 ? clean : undefined;
}

function sanitizeEvent(event: CrashLogEvent): CrashLogEvent {
  const known: readonly CrashLogEvent[] = [
    "start",
    "uncaughtException",
    "unhandledRejection",
    "startupError",
    "refusal",
    "childExit",
    "sessionExit",
    "signal",
    "stop",
    "exit",
  ];
  return known.includes(event) ? event : "exit";
}

function sanitizeSignal(signal: string | undefined): string | undefined {
  if (signal === undefined) return undefined;
  return /^[A-Z][A-Z0-9_]{1,15}$/.test(signal) ? signal : "unknown";
}

export function toCrashLogRow(
  component: CrashLogComponent,
  entry: CrashLogEntry,
): CrashLogRow {
  const row: CrashLogRow = {
    timestamp: new Date().toISOString(),
    component,
    version: getCrashLogVersion(),
    pid: process.pid,
    event: sanitizeEvent(entry.event),
  };
  const sessionId = sanitizeField(entry.sessionId);
  const instanceId = sanitizeField(entry.instanceId);
  const reason = sanitizeField(entry.reason);
  const detail = sanitizeField(entry.detail);
  const signal = sanitizeSignal(entry.signal);
  return {
    ...row,
    ...(sessionId ? { sessionId } : {}),
    ...(instanceId ? { instanceId } : {}),
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    ...(Number.isSafeInteger(entry.exitCode) ? { exitCode: entry.exitCode } : {}),
    ...(signal ? { signal } : {}),
  };
}

function privateFile(fd: number): void {
  const info = fstatSync(fd);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error("unsafe crash log file");
  }
  fchmodSync(fd, 0o600);
}

function writeAll(fd: number, text: string): void {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; ) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("crash log write made no progress");
    offset += written;
  }
}

/**
 * Best-effort bounded append. One lock attempt, no wait, no stale-lock
 * reclamation: contention drops the row (returns false) instead of blocking
 * the fatal path it documents. Never throws.
 */
export function appendCrashLog(
  component: CrashLogComponent,
  entry: CrashLogEntry,
  logPath: string = resolveCrashLogPath(component),
): boolean {
  let lockFd: number | undefined;
  const lockPath = `${logPath}.lock`;
  const token = `${process.pid}:${randomUUID()}`;
  try {
    const text = `${JSON.stringify(toCrashLogRow(component, entry))}\n`;
    const dir = dirname(logPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const directory = lstatSync(dir);
    if (
      !directory.isDirectory() ||
      (typeof process.getuid === "function" &&
        directory.uid !== process.getuid()) ||
      (directory.mode & 0o077) !== 0
    ) {
      throw new Error("unsafe crash log directory");
    }
    lockFd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeAll(lockFd, token);
    try {
      const fd = openSync(
        logPath,
        constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        privateFile(fd);
        if (fstatSync(fd).size >= MAX_CRASH_LOG_BYTES) {
          try {
            unlinkSync(`${logPath}.1`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          renameSync(logPath, `${logPath}.1`);
        }
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const fd = openSync(
      logPath,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      privateFile(fd);
      writeAll(fd, text);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  } finally {
    if (lockFd !== undefined) {
      try {
        const owned = fstatSync(lockFd);
        const current = lstatSync(lockPath);
        if (
          owned.dev === current.dev &&
          owned.ino === current.ino &&
          readFileSync(lockPath, "utf8") === token
        ) {
          unlinkSync(lockPath);
        }
      } catch {
        /* Never remove an unproven lock incarnation. */
      }
      try {
        closeSync(lockFd);
      } catch {
        /* Crash-log failures never escape. */
      }
    }
  }
}

/** Read and parse one crash log; corrupt lines are skipped, never thrown. */
export function readCrashLog(
  component: CrashLogComponent,
  logPath: string = resolveCrashLogPath(component),
): CrashLogRow[] {
  try {
    if (!lstatSync(logPath).isFile()) return [];
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const row = JSON.parse(line) as CrashLogRow;
          if (typeof row !== "object" || row === null) return [];
          return [row];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Last `lines` rows across components, oldest first. */
export function readRecentCrashLogs(
  components: readonly CrashLogComponent[] = CRASH_LOG_COMPONENTS,
  lines = 50,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CrashLogRow[] {
  const rows = components.flatMap((component) =>
    readCrashLog(component, resolveCrashLogPath(component, env)),
  );
  rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return rows.slice(Math.max(0, rows.length - Math.max(1, lines)));
}
