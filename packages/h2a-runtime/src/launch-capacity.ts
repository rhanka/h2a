import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { withLaunchReceipt } from "./launch-receipt.js";
import { nativeSessionState, type NativeLaunchOwnership } from "./native-host.js";
export const DEFAULT_LAUNCH_CAPACITY = 16;
export const DEFAULT_RESIDENT_BYTES = 600 * 1024 * 1024;
type Slot = { at: number; state: string; residentBytes: number; token?: string; ownership?: NativeLaunchOwnership[] };
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
export function acquireLaunchSlot(id: string, capacity = DEFAULT_LAUNCH_CAPACITY, residentBytes = DEFAULT_RESIDENT_BYTES): { acquired: boolean; reason?: string } {
  return withLaunchReceipt(path(), undefined, (receipt, save) => {
    const slots = receipt?.slots as Record<string, Slot> | undefined ?? {};
    for (const [key, slot] of Object.entries(slots)) {
      if (!slot.ownership?.length) continue; // Launcher death without ownership is not proof of session death.
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
    slots[id] = { at: Date.now(), state: "launching", residentBytes, ...(process.env.H2A_RUN_LAUNCH_TOKEN ? { token: process.env.H2A_RUN_LAUNCH_TOKEN } : {}) };
    save({ slots }); return { acquired: true };
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
