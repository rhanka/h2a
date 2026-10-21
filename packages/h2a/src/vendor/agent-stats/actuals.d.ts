/**
 * Velocity L6 actuals: immutable chronological feedback (pure).
 *
 * A forecast record is frozen before work. Actuals reuse the same events and
 * join idempotently on (repo, lot occurrence, forecast revision, merge SHA).
 * Corrections and reforecasts reference prior records without rewriting them.
 */
export interface ForecastRecord {
    forecastId: string;
    revision: string;
    lotRef: string;
    predictedAt: string;
    evidenceCutoff: string;
    inputRevision: string;
    referenceDigest: string;
    quantiles: {
        p50Seconds: number | null;
        p80Seconds: number | null;
        p95Seconds: number | null;
    };
}
export interface DeliveryInput {
    repo: string;
    number: number | string;
    mergeSha: string | null;
    mergedAt: string | null;
    status?: "merged" | "open" | "abandoned";
    collectedAt?: string | null;
    reworkOf?: number | string | null;
}
export interface ActualRecord {
    status: "delivered" | "censored" | "abandoned";
    repo: string;
    number: number | string;
    mergeSha: string | null;
    mergedAt: string | null;
    elapsedSeconds: number | null;
    reworkOf?: number | string | null;
}
export interface IngestResult {
    forecast: ForecastRecord;
    actual: ActualRecord;
}
export declare function ingestActual(input: {
    forecast: ForecastRecord;
    delivery: DeliveryInput;
}): IngestResult;
export interface JoinStore {
    actuals: ActualRecord[];
    seen: Set<string>;
}
export declare function joinActuals(existing: ActualRecord[], input: {
    forecast: ForecastRecord;
    delivery: DeliveryInput;
}): {
    actuals: ActualRecord[];
    duplicates: number;
};
//# sourceMappingURL=actuals.d.ts.map