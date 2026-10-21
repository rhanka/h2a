/**
 * Velocity L1 measured-reference types.
 *
 * Metrics stay separate (D1); milestones stay separate (D2: mergedAt vs
 * installedAt unknown until target proof). Units: seconds; instants: UTC.
 */
export type VelocityMetric = "pr_open_to_merge";
export interface CohortQuantiles {
    n: number;
    p50Seconds: number | null;
    p80Seconds: number | null;
    p95Seconds: number | null;
    maxSeconds?: number;
    quantileMethod: "nearest-rank/1";
    support: "descriptive";
    calibrated: false;
}
export interface ScenarioQuantiles {
    kind: "scenario";
    combinations: number;
    independentObservations: number;
    quantiles: {
        p50Seconds: number;
        p80Seconds: number;
        p95Seconds: number;
    };
}
export interface TimingRecord {
    repo: string;
    number: number;
    url?: string;
    createdAt: string;
    mergedAt: string | null;
    openToMergeSeconds: number | null;
    ciSeconds: null;
    installedAt: "unknown";
    installationTarget: "unknown";
    reviewRoundsActual: null;
    reviewMissingReason: string;
}
export interface CiMetrics {
    serviceSumSeconds: number;
    longestJobSeconds: number;
    envelopeSeconds: number;
    workflowSpanSeconds: number;
}
/** Bounded L2 extension: explicit run roles and round identity (no inference). */
export type VelocityRunRole = "author" | "reviewer" | "correction";
export interface VelocityLotSlot {
    repo: string;
    prNumber: number | string;
    lotOccurrence: string;
    slotKey: string;
}
//# sourceMappingURL=types.d.ts.map