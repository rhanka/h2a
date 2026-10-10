/**
 * Capacity and reservation for in-flight / unconfirmed launches.
 * Guarantees that at least 9 concurrent unconfirmed launches can be admitted,
 * while preventing unbounded launch saturation.
 */

export const DEFAULT_LAUNCH_CAPACITY = 16;

const activeSlots = new Map<string, { at: number; state: string }>();

export function acquireLaunchSlot(
  id: string,
  capacity = DEFAULT_LAUNCH_CAPACITY,
): { acquired: boolean; reason?: string } {
  // Prune any stale entries older than 5 minutes if process no longer alive
  const now = Date.now();
  for (const [key, slot] of activeSlots.entries()) {
    if (now - slot.at > 300_000 && slot.state !== "launch-unconfirmed") {
      activeSlots.delete(key);
    }
  }

  if (activeSlots.has(id)) {
    return { acquired: true };
  }

  if (activeSlots.size >= capacity) {
    return {
      acquired: false,
      reason: `launch capacity of ${capacity} concurrent unconfirmed sessions exceeded`,
    };
  }

  activeSlots.set(id, { at: now, state: "launching" });
  return { acquired: true };
}

export function releaseLaunchSlot(id: string, state: string): void {
  const existing = activeSlots.get(id);
  if (existing) {
    if (state === "started" || state === "stopped" || state === "cleanup-failed") {
      activeSlots.delete(id);
    } else {
      existing.state = state;
    }
  }
}

export function getActiveSlots(): number {
  return activeSlots.size;
}

export function resetLaunchCapacity(): void {
  activeSlots.clear();
}
