/**
 * Velocity L3 cohort: regime fingerprints and applicability (history preserved).
 */
export function buildCohort(input) {
    const same = JSON.stringify(input.fingerprint) === JSON.stringify(input.currentFingerprint);
    return {
        cohortKey: input.cohortKey,
        memberCount: input.members.length,
        applicability: same ? "applicable" : "conditional-historical",
        historyPreserved: true,
    };
}
//# sourceMappingURL=cohort.js.map