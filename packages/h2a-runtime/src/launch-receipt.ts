import { mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync, rmSync, existsSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { sleepSync } from "./prompt-delivery.js";

export type LaunchReceipt = Record<string, unknown> & { token?: string; submitAttempted?: boolean };

export function launchAttemptDetails(receipt: LaunchReceipt | undefined, missingProof: string): Record<string, unknown> {
  const ownership = receipt?.ownership as { sessions?: Array<{ incarnation?: string; generation?: string; socketPath?: string }> } | undefined;
  const session = ownership?.sessions?.[0];
  return { ageMs: typeof receipt?.requestedAt === "number" ? Math.max(0, Date.now() - receipt.requestedAt) : null,
    phase: receipt?.phase ?? "unknown", missingProof, conversationId: receipt?.conversationId ?? null,
    incarnation: session?.incarnation ?? null, generation: session?.generation ?? null, socketPath: session?.socketPath ?? null,
    actions: ["attach", "inspect", "explicit-stop"] };
}

export function launchAttemptDetailsFromFile(path: string, missingProof: string): Record<string, unknown> {
  try { return launchAttemptDetails(JSON.parse(readFileSync(path, "utf8")), missingProof); }
  catch { return launchAttemptDetails(undefined, missingProof); }
}

function processStart(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}
function deadLockOwner(lock: string, namespace: string | undefined): boolean {
  if (namespace === undefined) return false;
  try {
    const owner = JSON.parse(readFileSync(`${lock}/owner`, "utf8"));
    if (owner.namespace !== namespace || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.start !== "string") return false;
    try { return processStart(owner.pid) !== owner.start; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
  } catch { return false; } // Legacy, foreign and incomplete identities remain unknown.
}

/** All receipt writers and cleanup decisions use this same inter-process lock. */
export function withLaunchReceipt<T>(path: string, token: string | undefined, action: (receipt: LaunchReceipt | undefined, save: (next: LaunchReceipt) => void) => T): T {
  const lock = `${path}.lock`;
  let namespace: string | undefined, start: string | undefined;
  try { namespace = readlinkSync("/proc/self/ns/pid"); start = processStart(process.pid); }
  catch { namespace = undefined; start = undefined; }
  // Fresh locks work without procfs. Recovery still requires a provable birth
  // in the same PID namespace; an unavailable identity never permits stealing.
  const owner = JSON.stringify({ pid: process.pid, start, namespace, nonce: randomUUID() });
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(`${lock}/owner`, owner, { mode: 0o600 });
      break;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
      try {
        // Serialize stale-lock recovery too: two observers must not remove a
        // newly acquired replacement lock after inspecting the same dead PID.
        if (deadLockOwner(lock, namespace)) {
          const reclaim = `${lock}.reclaim`;
          mkdirSync(reclaim, { mode: 0o700 });
          try { if (deadLockOwner(lock, namespace)) rmSync(lock, { recursive: true }); }
          finally { rmSync(reclaim, { recursive: true }); }
          continue;
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
        ...((typeof previous?.inputEpoch === "number" || typeof next.inputEpoch === "number")
          ? { inputEpoch: Math.max(Number(previous?.inputEpoch ?? 0), Number(next.inputEpoch ?? 0)) } : {}),
        submitAttempted: previous?.submitAttempted === true || next.submitAttempted === true };
      const temporary = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
      const file = openSync(temporary, "r");
      try { fsyncSync(file); } finally { closeSync(file); }
      renameSync(temporary, path);
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    });
  } finally {
    if (readFileSync(`${lock}/owner`, "utf8") === owner) rmSync(lock, { recursive: true });
  }
}

export function updateLaunchReceipt(path: string, token: string | undefined, next: LaunchReceipt): void {
  withLaunchReceipt(path, token, (_receipt, save) => save(next));
}
