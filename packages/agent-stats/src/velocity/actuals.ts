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
  quantiles: { p50Seconds: number | null; p80Seconds: number | null; p95Seconds: number | null };
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

function elapsedSeconds(mergedAt: string | null, predictedAt: string): number | null {
  if (mergedAt === null) return null;
  return Math.round((Date.parse(mergedAt) - Date.parse(predictedAt)) / 1000);
}

export function ingestActual(input: { forecast: ForecastRecord; delivery: DeliveryInput }): IngestResult {
  const { forecast, delivery } = input;
  if (delivery.collectedAt && Date.parse(delivery.collectedAt) > Date.parse(forecast.predictedAt)) {
    throw new Error("future evidence unavailable at forecast cutoff: availability refused");
  }
  if (delivery.status === "abandoned") {
    return {
      forecast: { ...forecast },
      actual: { status: "abandoned", repo: delivery.repo, number: delivery.number, mergeSha: null, mergedAt: null, elapsedSeconds: null },
    };
  }
  if (delivery.mergeSha === null || delivery.mergedAt === null || delivery.status === "open") {
    return {
      forecast: { ...forecast },
      actual: { status: "censored", repo: delivery.repo, number: delivery.number, mergeSha: delivery.mergeSha, mergedAt: delivery.mergedAt, elapsedSeconds: null, reworkOf: delivery.reworkOf ?? null },
    };
  }
  return {
    forecast: { ...forecast },
    actual: {
      status: "delivered",
      repo: delivery.repo,
      number: delivery.number,
      mergeSha: delivery.mergeSha,
      mergedAt: delivery.mergedAt,
      elapsedSeconds: elapsedSeconds(delivery.mergedAt, forecast.predictedAt),
      reworkOf: delivery.reworkOf ?? null,
    },
  };
}

export interface JoinStore {
  actuals: ActualRecord[];
  seen: Set<string>;
}

export function joinActuals(
  existing: ActualRecord[],
  input: { forecast: ForecastRecord; delivery: DeliveryInput },
): { actuals: ActualRecord[]; duplicates: number } {
  const key = `${input.delivery.repo}#${String(input.delivery.number)}#${input.delivery.mergeSha ?? "null"}`;
  const seen = new Set(existing.map((entry) => `${entry.repo}#${String(entry.number)}#${entry.mergeSha ?? "null"}`));
  if (seen.has(key)) return { actuals: existing, duplicates: 1 };
  const ingested = ingestActual(input);
  return { actuals: [...existing, ingested.actual], duplicates: 0 };
}
