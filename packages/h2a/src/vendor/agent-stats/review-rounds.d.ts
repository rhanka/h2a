/**
 * Velocity L2 review rounds: wave lifecycle (pure, no coverage invention).
 *
 * One manifest is one round; parallel reviewers of one submission are multiple
 * reviewer runs inside one manifest and one round. Without a coverage manifest
 * totals stay null with a reason — never zero. An open wave stays open.
 */
export interface WaveInput {
    roundId: string;
    candidateRevision: string;
    reviewerRuns: Array<{
        runId: string;
    }>;
    closed?: boolean;
    coverageManifestRef?: string | null;
}
export interface WaveSummary {
    completedCount: number | null;
    openRoundIds: string[];
    reviewerRunCount: number | null;
    roundIds: string[];
    missingReason?: string;
}
export declare function summarizeWaves(input: {
    repo: string;
    lotOccurrence: string;
    waves: WaveInput[];
    coverageManifestRef: string | null;
}): WaveSummary;
export declare function joinWaveManifest(manifest: {
    repo: string;
    lotOccurrence: string;
    roundId: string;
    candidateRevision: string;
    reviewerRuns: Array<{
        runId: string;
    }>;
}, receipts: Array<{
    runId: string;
}>): {
    roundId: string;
    reviewerRunCount: number;
};
export declare function refuseIncompleteClosure(input: {
    roundId: string;
    reconciliationRef: string | null;
    resultRefs: string[];
}): void;
//# sourceMappingURL=review-rounds.d.ts.map