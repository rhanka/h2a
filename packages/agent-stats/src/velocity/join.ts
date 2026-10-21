/**
 * Velocity L2 join: identity-safe lot slots (pure).
 */

export function lotSlotKey(repo: string, prNumber: number | string, lotOccurrence: string): string {
  return `${repo}#${String(prNumber)}@${lotOccurrence}`;
}
