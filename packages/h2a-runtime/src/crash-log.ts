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
 * at MAX_CRASH_LOG_BYTES (current + one `.1` generation, both read by
 * `readRecentCrashLogs`). Structured rows never carry secrets in the clear:
 * values are redacted before serialization (see `redactCrashText`, which
 * stands on its own even when the secret is absent from the writer's
 * environment). (The raw `mcp-central.log` server dump is verbatim child
 * output and stays unredacted at rest; `h2a logs` redacts it on display.)
 * Exit codes and signals are only ever observed values: either field is
 * omitted when unknown, never defaulted. Appends take one lock attempt plus
 * one provably-dead orphan reclaim (stale age AND dead owner PID); contention
 * drops the row (counted via `getCrashLogDrops` and surfaced as a `dropped`
 * row on the next successful append in the same process).
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { guardTestStateWrite } from "./test-state-guard.js";

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
  | "exit"
  | "dropped";

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
  /**
   * Signal name (or signo) when the fatal path is a signal. Omit the field —
   * never invent a code — when the signal is unknown.
   */
  readonly signal?: string | number | undefined;
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
  // Lot L0: launcher/attestation infrastructure paths, not credentials.
  "H2A_TEST_STATE_ROOT",
  "H2A_TEST_STATE_ATTESTATION",
  "H2A_TEST_STATE_BARRIER",
  "H2A_TEST_OWNER_HOME",
]);

/**
 * Redact secret values and credential patterns; never throws. Pattern
 * redaction stands on its own: it must hold even when the secret value is
 * absent from the writer's environment (tokens in child stderr, config JSON,
 * CLI flags). Fail closed — an unrecognized `name=value` shape that names a
 * credential is redacted, never passed through.
 */
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
  // Fail closed over shapes, not an enumeration of names: dash/underscore
  // cross in every motif, header names match quoted/JSON/`=` forms, values
  // keep commas (passwords) but stop at `&`/`;`/whitespace (query chains).
  return result
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+\S+/gi, "[REDACTED]")
    .replace(/["']?(?:authorization|cookie|set-cookie)["']?\s*[:=]\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s;&"']+)/gi, "[REDACTED]")
    .replace(
      /["']?[\w.-]*?(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|id[_-]?token|auth[_-]?token|private[_-]?key|api[_-]?key|token|secret|passwd|passphrase|password|credential|pass|pwd|auth|session|key)["']?\s*[:=]\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s;&"']+)/gi,
      "[REDACTED]",
    )
    .replace(
      /(--?(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|id[_-]?token|auth[_-]?token|private[_-]?key|api[_-]?key|token|secret|password|passwd|passphrase|pass|pwd|auth|session|credential|key))\b\s+("[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+)/gi,
      "$1 [REDACTED]",
    )
    .replace(/:\/\/[^/\s]*@/g, "://[REDACTED]@");
}

const CRASH_SIGNAL_NUMBERS: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  4: "SIGILL",
  5: "SIGTRAP",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  9: "SIGKILL",
  10: "SIGUSR1",
  11: "SIGSEGV",
  12: "SIGUSR2",
  13: "SIGPIPE",
  14: "SIGALRM",
  15: "SIGTERM",
  16: "SIGSTKFLT",
  17: "SIGCHLD",
  18: "SIGCONT",
  19: "SIGSTOP",
  20: "SIGTSTP",
  21: "SIGTTIN",
  22: "SIGTTOU",
  23: "SIGURG",
  24: "SIGXCPU",
  25: "SIGXFSZ",
  26: "SIGVTALRM",
  27: "SIGPROF",
  28: "SIGWINCH",
  29: "SIGIO",
  30: "SIGPWR",
  31: "SIGSYS",
};

/**
 * Normalize a signal (name, signo, or numeric string) to a log-safe name.
 * Unknown names become `"unknown"`; unknown numbers become `"SIG<n>"` so the
 * signo survives. `undefined` stays `undefined` — callers omit the field
 * instead of inventing a signal.
 */
export function crashSignalName(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === "number" ? String(value) : value.trim();
  if (/^\d+$/.test(text)) {
    const signo = Number.parseInt(text, 10);
    if (Number.isSafeInteger(signo)) return CRASH_SIGNAL_NUMBERS[signo] ?? `SIG${signo}`;
  }
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]{1,15}$/.test(value)) return value;
  return "unknown";
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
    "dropped",
  ];
  return known.includes(event) ? event : "exit";
}

function sanitizeSignal(signal: string | number | undefined): string | undefined {
  return crashSignalName(signal);
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
 * A lock older than this was left by a dead writer: its owner can never come
 * back to release it, so the next writer reclaims it instead of letting the
 * component's log go silent forever. A live lock still drops (returns false).
 */
export const CRASH_LOG_LOCK_STALE_MS = 10_000;

let droppedCrashLogs = 0;
const pendingCrashLogDrops = new Map<string, number>();

function dropCrashLog(logPath: string, count = 1): void {
  droppedCrashLogs += count;
  pendingCrashLogDrops.set(logPath, (pendingCrashLogDrops.get(logPath) ?? 0) + count);
}

/** Process-lifetime count of crash-log rows dropped instead of appended. */
export function getCrashLogDrops(): number {
  return droppedCrashLogs;
}

function acquireCrashLogLock(lockPath: string, token: string): number | undefined {
  try {
    const fd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeAll(fd, token);
    return fd;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Contended. Reclaim only a provably-dead orphan: age alone never proves
  // death (a live writer blocked in the filesystem never refreshes its
  // mtime), so the owner PID in the lock token must be dead too. A live lock,
  // an unreadable token, or a lock that changed under us drops the row
  // instead of blocking the fatal path.
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (!Number.isFinite(ageMs) || ageMs < CRASH_LOG_LOCK_STALE_MS) return undefined;
    let owner = NaN;
    try {
      owner = Number.parseInt(String(readFileSync(lockPath, "utf8")).split(":")[0] ?? "", 10);
    } catch {
      return undefined;
    }
    if (!Number.isSafeInteger(owner) || owner <= 0) return undefined;
    try {
      process.kill(owner, 0);
      return undefined;
    } catch (error) {
      // ESRCH = no such process (reclaimable); anything else (EPERM = alive
      // but unowned, or an exotic failure) keeps the lock.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return undefined;
    }
    // Re-verify after the liveness probe: a fresh lock that appeared under us
    // (or a token swap) aborts the reclaim instead of unlinking live state.
    try {
      const freshAgeMs = Date.now() - statSync(lockPath).mtimeMs;
      if (!Number.isFinite(freshAgeMs) || freshAgeMs < CRASH_LOG_LOCK_STALE_MS) return undefined;
      if (String(readFileSync(lockPath, "utf8")).split(":")[0] !== String(owner)) return undefined;
    } catch {
      return undefined;
    }
    unlinkSync(lockPath);
    const fd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeAll(fd, token);
    return fd;
  } catch {
    return undefined;
  }
}

function ensurePrivateCrashLogDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let directory = lstatSync(dir);
  // Self-heal a pre-existing group/other-readable state dir we own (tighter
  // is strictly safer); anything else stays a counted drop, never a repair
  // of somebody else's directory.
  if (
    directory.isDirectory() &&
    (typeof process.getuid !== "function" || directory.uid === process.getuid()) &&
    (directory.mode & 0o077) !== 0
  ) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* fall through to the safety check below */
    }
    directory = lstatSync(dir);
  }
  if (
    !directory.isDirectory() ||
    (typeof process.getuid === "function" &&
      directory.uid !== process.getuid()) ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error("unsafe crash log directory");
  }
}

/**
 * Best-effort bounded append. One lock attempt plus one stale-orphan reclaim,
 * no wait: contention drops the row (returns false, counted and surfaced as a
 * `dropped` row on the next successful append) instead of blocking the fatal
 * path it documents. Never throws.
 */
export function appendCrashLog(
  component: CrashLogComponent,
  entry: CrashLogEntry,
  logPath: string = resolveCrashLogPath(component),
): boolean {
  // Lot L0: mutation-point guard — refused before any directory, lock or
  // file is created, even for caller-supplied explicit paths. Inert outside
  // a marked test run. Never throws: contention-style false, counted by
  // the caller as a drop.
  try {
    guardTestStateWrite(logPath);
  } catch {
    return false;
  }
  let lockFd: number | undefined;
  const lockPath = `${logPath}.lock`;
  const token = `${process.pid}:${randomUUID()}`;
  try {
    const text = `${JSON.stringify(toCrashLogRow(component, entry))}\n`;
    ensurePrivateCrashLogDir(dirname(logPath));
    lockFd = acquireCrashLogLock(lockPath, token);
    if (lockFd === undefined) throw new Error("crash log lock contended");
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
      // One write for receipt + row, receipt cleared only after it lands: a
      // failed replay keeps the earlier drops instead of losing them.
      const missed = pendingCrashLogDrops.get(logPath) ?? 0;
      const receipt =
        missed > 0
          ? `${JSON.stringify(toCrashLogRow(component, { event: "dropped", detail: `${missed} crash-log rows dropped (lock contention or unsafe state)` }))}\n`
          : "";
      writeAll(fd, `${receipt}${text}`);
      if (missed > 0) pendingCrashLogDrops.delete(logPath);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    dropCrashLog(logPath);
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

/** Last `lines` rows across components, oldest first, rotations included. */
export function readRecentCrashLogs(
  components: readonly CrashLogComponent[] = CRASH_LOG_COMPONENTS,
  lines = 50,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CrashLogRow[] {
  const rows = components.flatMap((component) => {
    const primary = resolveCrashLogPath(component, env);
    return [...readCrashLog(component, `${primary}.1`), ...readCrashLog(component, primary)];
  });
  rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return rows.slice(Math.max(0, rows.length - Math.max(1, lines)));
}

/** Max chars of `detail`/`error` shown on one human `h2a logs` line. */
export const CRASH_LOG_HUMAN_DETAIL_MAX = 300;

function singleLine(text: string, max = CRASH_LOG_HUMAN_DETAIL_MAX): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * One human `h2a logs` line: what (event/reason/code/kind/errno), when
 * (timestamp), where (component/session/pid/generation), why
 * (detail/error, single-line and bounded). Detail is safe to show: rows are
 * redacted before serialization.
 */
export function formatCrashLogHumanRow(record: Record<string, unknown>): string {
  const parts = [
    String(record["timestamp"] ?? "unknown"),
    String(record["component"] ?? "?"),
    String(record["event"] ?? "?"),
  ];
  for (const key of ["sessionId", "instanceId", "reason", "exitCode", "signal", "cause", "code", "kind", "errno", "generation", "version", "pid"]) {
    if (record[key] !== undefined) parts.push(`${key}=${String(record[key])}`);
  }
  if (typeof record["detail"] === "string" && record["detail"].length > 0) {
    parts.push(`detail=${singleLine(record["detail"])}`);
  }
  if (typeof record["error"] === "string" && record["error"].length > 0) {
    parts.push(`error=${singleLine(record["error"])}`);
  }
  return parts.join(" ");
}

/** Max bytes scanned from the end of a raw log for the viewer. */
export const CRASH_LOG_TAIL_MAX_BYTES = 256 * 1024;

/**
 * Last `maxLines` of a text file for the viewer; missing/unreadable → [].
 * Scans a bounded window from the end with positional reads — a multi-MB
 * server dump is never loaded whole. Lines past the window are dropped whole
 * (the leading, possibly partial, line is never shown truncated).
 */
export function readFileTailLines(path: string, maxLines: number): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return [];
    const size = fstatSync(fd).size;
    if (size === 0) return [];
    const want = Math.min(size, CRASH_LOG_TAIL_MAX_BYTES);
    const start = size - want;
    const buffer = Buffer.alloc(want);
    let bytesRead = 0;
    while (bytesRead < want) {
      const read = readSync(fd, buffer, bytesRead, want - bytesRead, start + bytesRead);
      if (read <= 0) break;
      bytesRead += read;
    }
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (start > 0) lines.shift();
    return lines.slice(Math.max(0, lines.length - Math.max(1, maxLines)));
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* A tail read never escapes. */
      }
    }
  }
}

/**
 * Passive fatal-path witness for short-lived launcher-side processes (the CLI
 * launcher, the op child). `uncaughtExceptionMonitor` observes without
 * altering Node's default crash/exit behavior: it only leaves a row behind in
 * `component`.log so `h2a logs` can explain the crash. Never throws.
 */
export function installCrashHandlers(component: CrashLogComponent): void {
  process.on("uncaughtExceptionMonitor", (error: unknown, origin: string) => {
    try {
      appendCrashLog(component, {
        event: origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException",
        detail: error instanceof Error ? error.message : String(error),
      });
    } catch {
      /* A witness never breaks the fatal path it documents. */
    }
  });
}

let cliWitnessInstalled = false;
/**
 * Idempotent CLI fatal-path witness. The owner binary (core `bin.ts`) reaches
 * the runtime through lazy `dispatchRuntime()` → `main()`, never with the
 * runtime file as `argv[1]` — so an `isEntryPoint()` gate alone never fires
 * on the real path. Installing here covers every dispatch; the once-guard
 * keeps repeated `main()` calls (and tests) to a single listener.
 */
export function installCliWitnessOnce(): void {
  if (cliWitnessInstalled) return;
  cliWitnessInstalled = true;
  installCrashHandlers("cli");
}
