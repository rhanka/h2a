import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { withLaunchReceipt } from "./launch-receipt.js";
import { nativeSessionState, type NativeLaunchOwnership } from "./native-host.js";
export const DEFAULT_LAUNCH_CAPACITY = 16;
export const DEFAULT_RESIDENT_BYTES = 600 * 1024 * 1024;
type Slot = { at: number; state: string; residentBytes: number; token?: string; ownership?: NativeLaunchOwnership[]; pid?: number; start?: string };
function path(): string {
  const directory = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "h2a", "launch-capacity");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, "reservations.json");
}
function memoryBudget(): number {
  const total = Number(readFileSync("/proc/meminfo", "utf8").match(/^MemTotal:\s+(\d+)/m)?.[1]) * 1024;
  const scope = readFileSync("/proc/self/cgroup", "utf8").trim().split("::")[1];
  let limit = total;
  try { const value = Number(readFileSync(join("/sys/fs/cgroup", scope ?? "", "memory.max"), "utf8")); if (Number.isFinite(value)) limit = Math.min(limit, value); } catch { /* Machine limit remains conservative. */ }
  return Math.floor(Math.min(limit, 8 * 1024 ** 3) * 0.85);
}
function start(pid: number): string | undefined {
  try { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]; } catch { return undefined; }
}
function resident(slot: Slot): number {
  if (!slot.pid || !slot.start || start(slot.pid) !== slot.start) return 0;
  const seen = new Set<number>();
  const visit = (pid: number): number => {
    if (seen.has(pid) || seen.size >= 128) return 0;
    seen.add(pid);
    try {
      const rss = Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
      return rss + readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).reduce((sum, child) => sum + (Number(child) ? visit(Number(child)) : 0), 0);
    } catch { return 0; }
  };
  return visit(slot.pid);
}
function headroom(): number {
  const available = Number(readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
  try {
    const scope = readFileSync("/proc/self/cgroup", "utf8").trim().split("::")[1];
    const base = join("/sys/fs/cgroup", scope ?? "");
    const limit = Number(readFileSync(join(base, "memory.max"), "utf8"));
    const current = Number(readFileSync(join(base, "memory.current"), "utf8"));
    if (Number.isFinite(limit)) return Math.max(0, Math.min(available, limit * 0.85 - current));
  } catch { /* The machine available-memory bound still applies. */ }
  return available * 0.85;
}
export function acquireLaunchSlot(id: string, capacity = DEFAULT_LAUNCH_CAPACITY, residentBytes = DEFAULT_RESIDENT_BYTES): { acquired: boolean; reason?: string } {
  return withLaunchReceipt(path(), undefined, (receipt, save) => {
    const slots = receipt?.slots as Record<string, Slot> | undefined ?? {};
    for (const [key, slot] of Object.entries(slots)) {
      if (!slot.ownership?.length) continue; // Launcher death without ownership is not proof of session death.
      if (slot.pid && slot.start && start(slot.pid) === slot.start) continue;
      const dead = slot.ownership.every(owner => {
        const probe = nativeSessionState(owner.name, owner.socketPath);
        return probe.state === "absent" || (probe.state === "found" &&
          (probe.session.generation !== owner.generation || probe.session.incarnation !== owner.incarnation || probe.session.status === "exited"));
      });
      if (dead) delete slots[key];
    }
    if (slots[id]) return { acquired: false, reason: "launch name already has a durable reservation" };
    if (Object.values(slots).filter(s => s.state !== "started").length >= capacity) return { acquired: false, reason: "unconfirmed launch capacity exceeded" };
    if (Object.values(slots).reduce((sum, s) => sum + s.residentBytes, residentBytes) > memoryBudget()) return { acquired: false, reason: "resident launch memory budget exceeded" };
    const promised = Object.values(slots).reduce((sum, s) => sum + Math.max(0, s.residentBytes - resident(s)), residentBytes);
    if (promised > headroom()) return { acquired: false, reason: "insufficient memory headroom for reserved resident profiles" };
    slots[id] = { at: Date.now(), state: "launching", residentBytes, ...(process.env.H2A_RUN_LAUNCH_TOKEN ? { token: process.env.H2A_RUN_LAUNCH_TOKEN } : {}) };
    save({ slots }); return { acquired: true };
  });
}
export function accountLaunchProcess(id: string, pid: number): void {
  withLaunchReceipt(path(), undefined, (receipt, save) => {
    const slots = receipt?.slots as Record<string, Slot> | undefined ?? {}, slot = slots[id];
    if (slot && slot.token === process.env.H2A_RUN_LAUNCH_TOKEN) { slot.pid = pid; const birth = start(pid); if (birth) slot.start = birth; }
    save({ slots });
  });
}
export function ownLaunchSlot(id: string, ownership: NativeLaunchOwnership[]): void {
  withLaunchReceipt(path(), undefined, (receipt, save) => {
    const slots = receipt?.slots as Record<string, Slot> | undefined ?? {};
    if (slots[id] && slots[id]!.token === process.env.H2A_RUN_LAUNCH_TOKEN) slots[id]!.ownership = ownership;
    save({ slots });
  });
}
/** Only a positively stopped incarnation releases its resident memory charge. */
export function releaseLaunchSlot(id: string, state: string): void {
  withLaunchReceipt(path(), undefined, (receipt, save) => {
    const slots = receipt?.slots as Record<string, Slot> | undefined ?? {}, slot = slots[id];
    if (!slot || slot.token !== process.env.H2A_RUN_LAUNCH_TOKEN) return;
    if (state === "stopped") delete slots[id]; else slot.state = state;
    save({ slots });
  });
}
export function getActiveSlots(): number {
  return withLaunchReceipt(path(), undefined, receipt => Object.values(receipt?.slots as Record<string, Slot> ?? {}).filter(s => s.state !== "started").length);
}
export function resetLaunchCapacity(): void {
  if (!process.env.XDG_STATE_HOME?.includes(".qual-tmp")) throw new Error("capacity reset requires isolated qualification state");
  withLaunchReceipt(path(), undefined, (_receipt, save) => save({ slots: {} }));
}
