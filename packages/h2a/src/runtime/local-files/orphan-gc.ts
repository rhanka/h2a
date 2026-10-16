import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// These are historical publication debris, never the active identity fence
// or its succession/journal files. Age alone never authorizes deletion.
const SAFE_AGE_MS = 24 * 60 * 60 * 1000;

function definitelyDead(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

/** Best-effort, conservative collection; live/unknown writers are retained. */
export function sweepOrphanFiles(dir: string, kind: "presence" | "identity", now = Date.now()): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const temp = kind === "presence" ? /^.+\.json\.tmp-(\d+)-(\d+)(?:-[a-f0-9]+)?$/.exec(name) : null;
    const archive = kind === "identity" && name.startsWith(".lock.stale-") && name !== ".lock.stale-";
    if (!temp && !archive) continue;
    const file = join(dir, name);
    let fd: number | undefined;
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || now - before.mtimeMs < SAFE_AGE_MS) continue;
      let pid: number;
      if (temp) {
        if (now - Number(temp[2]) < SAFE_AGE_MS) continue;
        pid = Number(temp[1]);
      } else {
        if (before.size > 65536) continue;
        const record = JSON.parse(readFileSync(fd, "utf8"));
        pid = record?.pid;
      }
      if (!definitelyDead(pid)) continue;
      const current = lstatSync(file);
      if (current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1 ||
          current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) continue;
      unlinkSync(file);
    } catch { /* unreadable, unknown owner or concurrent cleanup: retain */ }
    finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* best-effort */ } } }
  }
}
