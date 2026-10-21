/**
 * Velocity L5 report: offline, neutral forecast cards beside the plan.
 *
 * Track stays record-only; reports stay offline and unchanged in shape.
 * Metric/status IDs stay neutral; user-language catalogues supply prose.
 * Planning writes only forecast cards plus the knowledge-lock beside the lot
 * plan — never a full-replacement report-set that drops non-velocity metadata.
 */
export interface ForecastCardInput {
    lotRef: string;
    metric: string;
    quantiles: {
        p50Seconds: number | null;
        p80Seconds: number | null;
        p95Seconds: number | null;
    };
    mergedAt: string | null;
}
export interface ForecastCard extends ForecastCardInput {
    kind: "forecast-card";
    support: "descriptive";
    installedAt: "unknown";
}
export declare function buildForecastCard(input: ForecastCardInput): ForecastCard;
export interface RenderInput {
    card: ForecastCard;
    sections?: string[];
    wpLink?: string;
    period?: string;
    handles?: string[];
    catalogue?: Record<string, string>;
}
export interface RenderResult {
    sections: string[];
    wpLink?: string;
    period?: string;
    offline: true;
    text: string;
}
export declare function renderReport(input: RenderInput): RenderResult;
export interface ReportPlanInput {
    card: ForecastCard | null;
    knowledgeLock: {
        digest: string;
    } | null;
    existingPlan: Record<string, unknown>;
    capacity?: Record<string, number>;
}
export interface ReportPlanResult {
    forecastCard: ForecastCard | null;
    plan: Record<string, unknown>;
    usedReportSet: false;
    dates: {
        conditional: boolean;
    };
    abstention?: boolean;
}
export declare function planForecast(input: ReportPlanInput): ReportPlanResult;
//# sourceMappingURL=report.d.ts.map