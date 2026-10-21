/**
 * Velocity L5 report: offline, neutral forecast cards beside the plan.
 *
 * Track stays record-only; reports stay offline and unchanged in shape.
 * Metric/status IDs stay neutral; user-language catalogues supply prose.
 * Planning writes only forecast cards plus the knowledge-lock beside the lot
 * plan — never a full-replacement report-set that drops non-velocity metadata.
 */
export function buildForecastCard(input) {
    return {
        ...input,
        kind: "forecast-card",
        support: "descriptive",
        installedAt: "unknown",
    };
}
export function renderReport(input) {
    const sections = input.sections ?? ["goal", "progress", "decisions", "next"];
    const prose = input.catalogue?.[input.card.metric] ?? input.card.metric;
    const text = `${prose}: p50=${String(input.card.quantiles.p50Seconds)}s merged=${input.card.mergedAt ?? "unknown"}`;
    return { sections, wpLink: input.wpLink, period: input.period, offline: true, text };
}
export function planForecast(input) {
    const plan = { ...input.existingPlan, forecastCard: input.card, knowledgeLock: input.knowledgeLock };
    if (input.card === null || input.knowledgeLock === null) {
        return { forecastCard: null, plan, usedReportSet: false, dates: { conditional: false }, abstention: true };
    }
    const conditional = (input.capacity?.reviewer ?? 0) >= 1 || Object.keys(input.capacity ?? {}).length === 0;
    return { forecastCard: input.card, plan, usedReportSet: false, dates: { conditional } };
}
//# sourceMappingURL=report.js.map