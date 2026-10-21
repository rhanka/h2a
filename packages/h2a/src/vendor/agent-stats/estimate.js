/**
 * Velocity L3 estimate: selected cohort plus unselected local baseline.
 */
import { selectComparables } from "./comparables.js";
export function buildEstimate(input) {
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
    let baseline = null;
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
//# sourceMappingURL=estimate.js.map