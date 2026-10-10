export function acquireLaunchSlot(_id: string): { acquired: boolean; reason?: string } {
  return { acquired: false, reason: "not implemented" };
}

export function releaseLaunchSlot(_id: string, _state: string): void {}

export function getActiveSlots(): number {
  return 0;
}
