export interface EstimateInput {
    selected: Array<{
        id: string;
        value: number;
    }>;
    baseline: Array<{
        id: string;
        value: number;
    }>;
    exclusions: Array<{
        id: string;
        reason: string;
    }>;
    weights?: Record<string, string>;
    estimatorVersion: string;
    policyVersion: string;
}
export interface EstimateResult {
    quantiles: {
        p50Seconds: number | null;
        p80Seconds: number | null;
        p95Seconds: number | null;
    };
    baseline: {
        p50Seconds: number | null;
    } | null;
    exclusions: Array<{
        id: string;
        reason: string;
    }>;
    support: "descriptive" | "insufficient-evidence";
}
export declare function buildEstimate(input: EstimateInput): EstimateResult;
//# sourceMappingURL=estimate.d.ts.map