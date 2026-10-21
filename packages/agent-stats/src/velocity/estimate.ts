/**
 * Velocity L3 estimate: selected cohort plus unselected local baseline.
 */
import { selectComparables } from "./comparables.js";

export interface EstimateInput {
  selected: Array<{ id: string; value: number }>;
  baseline: Array<{ id: string; value: number }>;
  exclusions: Array<{ id: string; reason: string }>;
  weights?: Record<string, string>;
  estimatorVersion: string;
  policyVersion: string;
}

export interface EstimateResult {
  quantiles: { p50Seconds: number | null; p80Seconds: number | null; p95Seconds: number | null };
  baseline: { p50Seconds: number | null } | null;
  exclusions: Array<{ id: string; reason: string }>;
  support: "descriptive" | "insufficient-evidence";
}

export function buildEstimate(input: EstimateInput): EstimateResult {
  if (input.selected.length === 0) {
    return { quantiles: { p50Seconds: null, p80Seconds: null, p95Seconds: null }, baseline: null, exclusions: input.exclusions, support: "insufficient-evidence" };
  }
  const selectedIds = input.selected.map((entry) => entry.id);
  const computed = selectComparables(input.selected, {
    selectedIds,
    weights: input.weights,
    estimatorVersion: input.estimatorVersion,
    policyVersion: input.policyVersion,
  });
  let baseline: { p50Seconds: number | null } | null = null;
  if (input.baseline.length > 0) {
    const baselineIds = input.baseline.map((entry) => entry.id);
    const baselineComputed = selectComparables(input.baseline, {
      selectedIds: baselineIds,
      estimatorVersion: input.estimatorVersion,
      policyVersion: input.policyVersion,
    });
    baseline = { p50Seconds: baselineComputed.quantiles.p50Seconds };
  }
  return {
    quantiles: {
      p50Seconds: computed.quantiles.p50Seconds,
      p80Seconds: computed.quantiles.p80Seconds,
      p95Seconds: computed.quantiles.p95Seconds,
    },
    baseline,
    exclusions: input.exclusions,
    support: "descriptive",
  };
}
