/**
 * Velocity L3 comparables: versioned deterministic selection (no LLM numbers).
 */
export interface ComparableObservation {
    id: string;
    value: number;
}
export interface SelectionOptions {
    selectedIds: string[];
    weights?: Record<string, string>;
    estimatorVersion: string;
    policyVersion: string;
}
export interface SelectionResult {
    quantiles: {
        p50Seconds: number | null;
        p80Seconds: number | null;
        p95Seconds: number | null;
        sampleCount: number;
        nEff: {
            numerator: string;
            denominator: string;
        };
    };
    estimatorVersion: string;
    policyVersion: string;
}
export declare function selectComparables(observations: ComparableObservation[], options: SelectionOptions): SelectionResult;
//# sourceMappingURL=comparables.d.ts.map