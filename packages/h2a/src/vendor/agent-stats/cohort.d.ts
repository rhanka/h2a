/**
 * Velocity L3 cohort: regime fingerprints and applicability (history preserved).
 */
export interface CohortInput {
    cohortKey: string;
    members: Array<string | number>;
    fingerprint: Record<string, unknown>;
    currentFingerprint: Record<string, unknown>;
}
export interface CohortResult {
    cohortKey: string;
    memberCount: number;
    applicability: "applicable" | "conditional-historical" | "incomplete";
    historyPreserved: true;
}
export declare function buildCohort(input: CohortInput): CohortResult;
//# sourceMappingURL=cohort.d.ts.map