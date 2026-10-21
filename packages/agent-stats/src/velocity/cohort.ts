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

export function buildCohort(input: CohortInput): CohortResult {
  const same = JSON.stringify(input.fingerprint) === JSON.stringify(input.currentFingerprint);
  return {
    cohortKey: input.cohortKey,
    memberCount: input.members.length,
    applicability: same ? "applicable" : "conditional-historical",
    historyPreserved: true,
  };
}
