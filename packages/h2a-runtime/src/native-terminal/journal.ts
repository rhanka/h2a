import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

export const MAX_HOST_JOURNAL_BYTES = 1024 * 1024;
type Identity = { pid: number; startTime: number | "unknown"; generation: string };
export type HostJournalEntry =
  | (Identity & { event: "start"; version: string; codePath: string; socket: string })
  | (Identity & { event: "signal"; signal: string })
  | (Identity & { event: "stop"; clean: boolean })
  | (Identity & { event: "uncaughtException" | "unhandledRejection" | "startupError"; error: string; stack?: string | undefined; codePath?: string })
  | (Identity & { event: "exit"; exitCode: number; cause: "unknown" | "clean-stop" | "signal" | "uncaughtException" | "unhandledRejection" | "startupError" })
  | { event: "dropped"; count: number };

export function resolveHostJournalPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const state = env["XDG_STATE_HOME"];
  if (state && isAbsolute(state)) return join(state, "h2a", "native-host.log");
  return join(env["HOME"] || homedir(), ".local", "state", "h2a", "native-host.log");
}

let cachedVersion: string | undefined;
export function getRuntimeVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch { cachedVersion = "unknown"; }
  return cachedVersion;
}

const runtimeDirectory = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pathEnvironment = new Set(["HOME", "PATH", "PWD", "OLDPWD", "TMPDIR", "NODE_PATH", "TERM", "LANG",
  "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "REMOTE_CLI_CONFIG_HOME", "H2A_SESSION_HOST"]);
function safeText(value: string): string {
  let result = value.slice(0, 4096);
  for (const [key, secret] of Object.entries(process.env)) {
    if (!pathEnvironment.has(key) && secret && secret.length >= 4) result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/\b(?:authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, "[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+\S+/gi, "[REDACTED]")
    .replace(/\b(?:token|key|secret|password|credential|api_?key)\w*\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/:\/\/[^/\s]*@/g, "://[REDACTED]@");
}

// Keep only verified code locations. Messages, function names, arbitrary paths,
// headers and environment objects are never diagnostic journal fields.
function safeStack(raw: string | undefined, codePath: string | undefined): string {
  const frames: string[] = [];
  for (const line of (raw ?? "").slice(0, 32_768).split("\n").slice(1, 33)) {
    const match = /^\s*at (?:.* \()?((?:file:\/\/\/|\/)[^()\r\n]+):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    try {
      const path = match[1]!.startsWith("file:") ? fileURLToPath(match[1]!) : match[1]!;
      const allowed = path === codePath || path.startsWith(`${runtimeDirectory}/`);
      if (allowed && existsSync(path)) frames.push(`at ${safeText(path)}:${match[2]}:${match[3]}`);
    } catch { /* An unverified location is redacted. */ }
  }
  return frames.join("\n") || "[REDACTED]";
}

function payload(entry: HostJournalEntry): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  if (entry.event === "dropped") return { timestamp, event: entry.event, count: entry.count };
  const common = { timestamp, event: entry.event, pid: entry.pid,
    startTime: Number.isSafeInteger(entry.startTime) ? entry.startTime : "unknown", generation: safeText(entry.generation) };
  switch (entry.event) {
    case "start": return { ...common, version: safeText(entry.version), codePath: safeText(entry.codePath), socket: safeText(entry.socket) };
    case "signal": return { ...common, signal: ["SIGTERM", "SIGINT", "SIGHUP"].includes(entry.signal) ? entry.signal : "unknown" };
    case "stop": return { ...common, clean: entry.clean === true };
    case "exit": return { ...common, exitCode: Number.isSafeInteger(entry.exitCode) ? entry.exitCode : "unknown",
      cause: ["unknown", "clean-stop", "signal", "uncaughtException", "unhandledRejection", "startupError"].includes(entry.cause) ? entry.cause : "unknown" };
    case "uncaughtException": case "unhandledRejection": case "startupError":
      return { ...common, error: "[REDACTED]", stack: safeStack(entry.stack, entry.codePath) };
  }
}

let dropped = 0;
const pendingDrops = new Map<string, number>();
function drop(logPath: string, count = 1): void {
  dropped += count;
  pendingDrops.set(logPath, (pendingDrops.get(logPath) ?? 0) + count);
}
export function getDroppedJournalEntriesCount(): number { return dropped; }

function privateFile(fd: number): void {
  const info = fstatSync(fd);
  if (!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) throw new Error("unsafe journal file");
  fchmodSync(fd, 0o600);
}
function writeAll(fd: number, text: string): void {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("journal write made no progress");
    offset += written;
  }
}

/** Best effort final-event/worker write. One lock attempt, no wait or stale-lock
 * reclamation. An orphan lock conservatively causes counted drops until removed
 * by its owner/operator; it never authorizes concurrent unlocked rotation. */
export function appendHostJournal(entry: HostJournalEntry, logPath = resolveHostJournalPath()): boolean {
  let lockFd: number | undefined;
  const lockPath = `${logPath}.lock`, token = `${process.pid}:${randomUUID()}`;
  try {
    const text = `${JSON.stringify(payload(entry))}\n`;
    const dir = dirname(logPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const directory = lstatSync(dir);
    if (!directory.isDirectory() || (process.getuid && directory.uid !== process.getuid()) || (directory.mode & 0o077) !== 0) throw new Error("unsafe journal directory");
    lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeAll(lockFd, token);
    // Inspect and rotate only while holding this writer's exclusive lock.
    try {
      const fd = openSync(logPath, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        privateFile(fd);
        if (fstatSync(fd).size >= MAX_HOST_JOURNAL_BYTES) {
          try { unlinkSync(`${logPath}.1`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          renameSync(logPath, `${logPath}.1`);
        }
      } finally { closeSync(fd); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const fd = openSync(logPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      privateFile(fd);
      const count = pendingDrops.get(logPath) ?? 0;
      if (count > 0) {
        writeAll(fd, `${JSON.stringify(payload({ event: "dropped", count }))}\n`);
        pendingDrops.delete(logPath);
      }
      writeAll(fd, text);
    } finally { closeSync(fd); }
    return true;
  } catch { drop(logPath); return false; }
  finally {
    if (lockFd !== undefined) {
      try {
        const owned = fstatSync(lockFd), current = lstatSync(lockPath);
        if (owned.dev === current.dev && owned.ino === current.ino && readFileSync(lockPath, "utf8") === token) unlinkSync(lockPath);
      } catch { /* Never remove an unproven lock incarnation. */ }
      try { closeSync(lockFd); } catch { /* Journal failures never escape. */ }
    }
  }
}

/** Ordinary lifecycle I/O runs off the host thread. The bounded mailbox drops
 * when full/unavailable. Only terminal exit/error observations write inline,
 * because Node cannot await I/O in its exit callback. No PID watcher exists. */
export function createHostJournalWriter(logPath = resolveHostJournalPath()): { write(entry: HostJournalEntry): void } {
  let worker: Worker | undefined, pending = 0;
  try {
    worker = new Worker(new URL(import.meta.url), { workerData: { nativeHostJournal: true, logPath } });
    worker.on("message", (written: boolean) => {
      if (!written) dropped += 1; // The worker retains its pending drop receipt.
      pending -= 1;
      if (pending === 0) worker?.unref();
    });
    worker.on("error", () => { drop(logPath, pending); pending = 0; worker = undefined; });
    worker.on("exit", () => { if (pending > 0) drop(logPath, pending); pending = 0; worker = undefined; });
    worker.unref();
  } catch { worker = undefined; }
  return { write(entry) {
    if (!worker || pending >= 64) { drop(logPath); return; }
    try { worker.ref(); worker.postMessage(entry); pending += 1; }
    catch { drop(logPath); if (pending === 0) worker.unref(); }
  } };
}

if (!isMainThread && workerData?.nativeHostJournal === true) {
  parentPort?.on("message", (entry: HostJournalEntry) => {
    const written = appendHostJournal(entry, workerData.logPath as string);
    parentPort?.postMessage(written);
  });
}

export function readHostJournal(logPath = resolveHostJournalPath()): HostJournalEntry[] {
  try {
    if (!lstatSync(logPath).isFile()) return [];
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line) as HostJournalEntry]; } catch { return []; }
    });
  } catch { return []; }
}
