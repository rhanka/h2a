/**
 * Velocity L2 join: identity-safe lot slots (pure).
 */
export function lotSlotKey(repo, prNumber, lotOccurrence) {
    return `${repo}#${String(prNumber)}@${lotOccurrence}`;
}
//# sourceMappingURL=join.js.map