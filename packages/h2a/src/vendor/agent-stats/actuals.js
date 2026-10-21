/**
 * Velocity L6 actuals: immutable chronological feedback (pure).
 *
 * A forecast record is frozen before work. Actuals reuse the same events and
 * join idempotently on (repo, lot occurrence, forecast revision, merge SHA).
 * Corrections and reforecasts reference prior records without rewriting them.
 */
function elapsedSeconds(mergedAt, predictedAt) {
    if (mergedAt === null)
        return null;
    return Math.round((Date.parse(mergedAt) - Date.parse(predictedAt)) / 1000);
}
export function ingestActual(input) {
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
export function joinActuals(existing, input) {
    const key = `${input.delivery.repo}#${String(input.delivery.number)}#${input.delivery.mergeSha ?? "null"}`;
    const seen = new Set(existing.map((entry) => `${entry.repo}#${String(entry.number)}#${entry.mergeSha ?? "null"}`));
    if (seen.has(key))
        return { actuals: existing, duplicates: 1 };
    const ingested = ingestActual(input);
    return { actuals: [...existing, ingested.actual], duplicates: 0 };
}
//# sourceMappingURL=actuals.js.map