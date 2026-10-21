export interface ForecastObservation {
    id: string;
    value: number;
    collectedAt: string;
    firstAvailableAt?: string | null;
    finalDiffSize?: number;
}
export interface ForecastInput {
    predictedAt: string;
    evidenceCutoff: string;
    observations: ForecastObservation[];
    selectedIds: string[];
    weights?: Record<string, string>;
    referencePublishedAt: string;
    appliesToRevision: string;
    estimatorVersion?: string;
    policyVersion?: string;
    aiSelection?: {
        selectedIds: string[];
        reasons: Record<string, string>;
        numericAdjustment?: number;
    };
}
export interface ForecastResult {
    quantiles: {
        p50Seconds: number | null;
        p80Seconds: number | null;
        p95Seconds: number | null;
    };
    predictedAt: string;
    evidenceCutoff: string;
    support: "descriptive" | "insufficient-evidence";
}
export declare function forecastTiming(input: ForecastInput): ForecastResult;
export interface RoundForecast {
    p50Count: number | null;
    p80Count: number | null;
    p95Count: number | null;
    sampleCount: number;
    support: "descriptive" | "insufficient-evidence";
}
export declare function forecastReviewRounds(counts: number[]): RoundForecast;
//# sourceMappingURL=forecast.d.ts.map