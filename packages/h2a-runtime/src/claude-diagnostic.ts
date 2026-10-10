import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { constants, openSync, closeSync, readSync, readFileSync, writeSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { withLaunchReceipt } from "./launch-receipt.js";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { CLAUDE_DEBUG_MAX_BYTES } from "./claude-debug-adapter.js";

type Retained = { file: string; expires: number; ino: number; dev: number };
function processStart(pid: number): string | undefined {
  try { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]; }
  catch { return undefined; }
}
function retainDiagnostic(file: string): void {
  const directory = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "h2a", "diagnostic-retention");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "files.json"), stat = statSync(file);
  withLaunchReceipt(path, undefined, (receipt, save) => {
    const files = receipt?.files as Retained[] | undefined ?? [];
    files.push({ file, expires: Date.now() + 24 * 60 * 60 * 1000, ino: stat.ino, dev: stat.dev });
    const pid = receipt?.pid as number | undefined;
    let live = false;
    if (pid && receipt?.start && processStart(pid) === receipt.start) live = true;
    if (live) { save({ files }); return; }
    const child = spawn(process.execPath, [fileURLToPath(new URL("./claude-diagnostic.js", import.meta.url)), "--retention", path], { stdio: "ignore" });
    child.on("error", () => {}); child.unref();
    save({ files, pid: child.pid, start: child.pid ? processStart(child.pid) : undefined });
  });
}

async function expireDiagnostics(path: string): Promise<void> {
  for (;;) {
    const count = withLaunchReceipt(path, undefined, (receipt, save) => {
      if (receipt?.pid !== process.pid) return 0;
      const files = (receipt.files as Retained[]).filter(entry => {
        if (!existsSync(entry.file)) return false;
        const stat = statSync(entry.file);
        if (stat.ino !== entry.ino || stat.dev !== entry.dev) return false; // Never unlink a replacement.
        if (Date.now() >= entry.expires) { rmSync(entry.file); return false; }
        return true;
      });
      save({ files, ...(files.length ? {} : { pid: null }) });
      return files.length;
    });
    if (!count) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export function startClaudeDiagnostic(directory: string): { fifo: string; file: string; own: (pid: number) => void; stop: () => void } {
  const fifo = join(directory, "claude-debug.pipe"), file = join(directory, "claude-debug.log");
  const made = spawnSync("mkfifo", ["-m", "600", fifo], { encoding: "utf8" });
  if (made.status !== 0) throw new Error(`cannot create private Claude diagnostic pipe: ${made.stderr}`);
  writeFileSync(file, "", { mode: 0o600, flag: "wx" });
  retainDiagnostic(file);
  const worker: ChildProcess = spawn(process.execPath, [fileURLToPath(new URL("./claude-diagnostic.js", import.meta.url)), fifo, file],
    { stdio: ["pipe", "ignore", "ignore"] });
  worker.on("error", () => {});
  worker.stdin!.on("error", () => {});
  worker.unref();
  (worker.stdin as NodeJS.WritableStream & { unref?: () => void }).unref?.();
  return { fifo, file,
    own: pid => { worker.stdin!.end(`${pid}\n`); },
    stop: () => { if (worker.exitCode === null) worker.kill("SIGTERM"); },
  };
}

/** The provider writes a FIFO: retained storage is bounded without unlinking its open writer. */
async function collect(fifo: string, file: string): Promise<void> {
  const fd = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
  let retained: number | undefined = openSync(file, constants.O_WRONLY | constants.O_APPEND);
  const identity = statSync(file);
  const buffer = Buffer.alloc(65536);
  let bytes = 0, pid: number | undefined, birth: string | undefined, lastData = Date.now();
  let nextPidPoll = 0, dead = false;
  const started = Date.now(), retainUntil = started + 24 * 60 * 60 * 1000;
  createInterface({ input: process.stdin }).on("line", line => {
    const parsed = Number(line);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      pid = parsed;
      birth = processStart(pid);
    }
  });
  try {
    for (;;) {
      let read = 0;
      try { read = readSync(fd, buffer); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error; }
      if (read > 0) {
        lastData = Date.now();
        if (retained !== undefined && Date.now() < retainUntil && bytes < CLAUDE_DEBUG_MAX_BYTES) {
          const kept = Math.min(read, CLAUDE_DEBUG_MAX_BYTES - bytes);
          writeSync(retained, buffer.subarray(0, kept)); bytes += kept;
        }
      }
      if (Date.now() >= retainUntil && retained !== undefined) {
        closeSync(retained); retained = undefined;
        if (existsSync(file)) {
          const current = statSync(file);
          if (current.ino === identity.ino && current.dev === identity.dev) rmSync(file);
        }
      }
      if (pid && Date.now() >= nextPidPoll) {
        const actual = processStart(pid);
        dead = actual === undefined || (birth !== undefined && actual !== birth);
        nextPidPoll = Date.now() + 1000;
      }
      if (dead && Date.now() - lastData > 1000) break;
      // Before ownership is delivered, parent death is uncertain: drain rather than block a possible Claude writer.
      await new Promise(resolve => setTimeout(resolve, read > 0 ? 1 : 10));
    }
  } finally { closeSync(fd); if (retained !== undefined) closeSync(retained); rmSync(fifo, { force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [fifo, file] = process.argv.slice(2);
  if (!fifo || !file) throw new Error("diagnostic collector requires its private FIFO and retained file");
  if (fifo === "--retention") await expireDiagnostics(file);
  else await collect(fifo, file);
}
