import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, existsSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { sleepSync } from "./prompt-delivery.js";

export type LaunchReceipt = Record<string, unknown> & { token?: string; submitAttempted?: boolean };

/** All receipt writers and cleanup decisions use this same inter-process lock. */
export function withLaunchReceipt<T>(path: string, token: string | undefined, action: (receipt: LaunchReceipt | undefined, save: (next: LaunchReceipt) => void) => T): T {
  const lock = `${path}.lock`;
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(`${lock}/owner`, String(process.pid), { mode: 0o600 });
      break;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
      try {
        const owner = Number(readFileSync(`${lock}/owner`, "utf8"));
        if (Number.isSafeInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (failure) {
            if ((failure as NodeJS.ErrnoException).code === "ESRCH") { rmSync(lock, { recursive: true }); continue; }
          }
        }
      } catch { /* An incomplete lock has unknown ownership: never steal it. */ }
      sleepSync(10);
    }
  }
  try {
    const receipt = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as LaunchReceipt : undefined;
    if (receipt && receipt.token !== token) throw new Error("launch receipt belongs to another attempt");
    return action(receipt, next => {
      const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as LaunchReceipt : undefined;
      if (previous && previous.token !== token) throw new Error("launch receipt ownership changed");
      if (previous?.ownership && next.ownership) {
        const old = previous.ownership as { host: string; sessions: Array<Record<string, unknown>> };
        const current = next.ownership as typeof old;
        if (old.host !== current.host || old.sessions.some(session => !current.sessions.some(candidate => JSON.stringify(candidate) === JSON.stringify(session))))
          throw new Error("launch receipt incarnation changed");
      }
      const final = ["started", "stopped", "cleanup-failed", "launch-unconfirmed"].includes(String(previous?.state));
      const value = { ...previous, ...next, ...(final && next.state === "launching" ? { state: previous?.state } : {}), token,
        submitAttempted: previous?.submitAttempted === true || next.submitAttempted === true };
      const temporary = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
      const file = openSync(temporary, "r");
      try { fsyncSync(file); } finally { closeSync(file); }
      renameSync(temporary, path);
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    });
  } finally { rmSync(lock, { recursive: true }); }
}

export function updateLaunchReceipt(path: string, token: string | undefined, next: LaunchReceipt): void {
  withLaunchReceipt(path, token, (_receipt, save) => save(next));
}
