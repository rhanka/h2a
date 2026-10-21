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
  quantiles: { p50Seconds: number | null; p80Seconds: number | null; p95Seconds: number | null };
  mergedAt: string | null;
}

export interface ForecastCard extends ForecastCardInput {
  kind: "forecast-card";
  support: "descriptive";
  installedAt: "unknown";
}

export function buildForecastCard(input: ForecastCardInput): ForecastCard {
  return {
    ...input,
    kind: "forecast-card",
    support: "descriptive",
    installedAt: "unknown",
  };
}

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

export function renderReport(input: RenderInput): RenderResult {
  const sections = input.sections ?? ["goal", "progress", "decisions", "next"];
  const prose = input.catalogue?.[input.card.metric] ?? input.card.metric;
  const text = `${prose}: p50=${String(input.card.quantiles.p50Seconds)}s merged=${input.card.mergedAt ?? "unknown"}`;
  return { sections, wpLink: input.wpLink, period: input.period, offline: true, text };
}

export interface ReportPlanInput {
  card: ForecastCard | null;
  knowledgeLock: { digest: string } | null;
  existingPlan: Record<string, unknown>;
  capacity?: Record<string, number>;
}

export interface ReportPlanResult {
  forecastCard: ForecastCard | null;
  plan: Record<string, unknown>;
  usedReportSet: false;
  dates: { conditional: boolean };
  abstention?: boolean;
}

export function planForecast(input: ReportPlanInput): ReportPlanResult {
  const plan = { ...input.existingPlan, forecastCard: input.card, knowledgeLock: input.knowledgeLock };
  if (input.card === null || input.knowledgeLock === null) {
    return { forecastCard: null, plan, usedReportSet: false, dates: { conditional: false }, abstention: true };
  }
  const conditional = (input.capacity?.reviewer ?? 0) >= 1 || Object.keys(input.capacity ?? {}).length === 0;
  return { forecastCard: input.card, plan, usedReportSet: false, dates: { conditional } };
}
