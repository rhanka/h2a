import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { constants, openSync, closeSync, readSync, writeFileSync, appendFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { CLAUDE_DEBUG_MAX_BYTES } from "./claude-debug-adapter.js";

export function startClaudeDiagnostic(directory: string): { fifo: string; file: string; own: (pid: number) => void; stop: () => void } {
  const fifo = join(directory, "claude-debug.pipe"), file = join(directory, "claude-debug.log");
  const made = spawnSync("mkfifo", ["-m", "600", fifo], { encoding: "utf8" });
  if (made.status !== 0) throw new Error(`cannot create private Claude diagnostic pipe: ${made.stderr}`);
  writeFileSync(file, "", { mode: 0o600, flag: "wx" });
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
  const buffer = Buffer.alloc(65536);
  let bytes = 0, pid: number | undefined, birth: number | undefined, lastData = Date.now();
  const started = Date.now(), retainUntil = started + 24 * 60 * 60 * 1000;
  createInterface({ input: process.stdin }).on("line", line => {
    const parsed = Number(line);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      pid = parsed;
      try { birth = statSync(`/proc/${pid}`).birthtimeMs; } catch { /* No process is not positive live evidence. */ }
    }
  });
  try {
    for (;;) {
      let read = 0;
      try { read = readSync(fd, buffer); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error; }
      if (read > 0) {
        lastData = Date.now();
        if (Date.now() < retainUntil && bytes < CLAUDE_DEBUG_MAX_BYTES) {
          const kept = Math.min(read, CLAUDE_DEBUG_MAX_BYTES - bytes);
          appendFileSync(file, buffer.subarray(0, kept)); bytes += kept;
        }
      }
      if (Date.now() >= retainUntil && existsSync(file)) rmSync(file);
      if (pid && (!existsSync(`/proc/${pid}`) || (birth !== undefined && statSync(`/proc/${pid}`).birthtimeMs !== birth)) && Date.now() - lastData > 1000) break;
      // Before ownership is delivered, parent death is uncertain: drain rather than block a possible Claude writer.
      await new Promise(resolve => setTimeout(resolve, read > 0 ? 1 : 10));
    }
  } finally { closeSync(fd); rmSync(fifo, { force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [fifo, file] = process.argv.slice(2);
  if (!fifo || !file) throw new Error("diagnostic collector requires its private FIFO and retained file");
  await collect(fifo, file);
}
