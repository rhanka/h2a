/**
 * Velocity L3 comparables: versioned deterministic selection (no LLM numbers).
 */
import { getContract } from "./contract.js";
export function selectComparables(observations, options) {
    const contract = getContract();
    const byId = new Map(observations.map((entry) => [entry.id, entry]));
    const entries = [];
    const weights = [];
    for (const id of options.selectedIds) {
        const found = byId.get(id);
        if (!found)
            throw new Error(`unknown comparable id: ${id}`);
        const weight = options.weights?.[id] ?? "1";
        contract.parseDecimalWeight(weight);
        entries.push({ id, value: found.value, weight });
        weights.push(weight);
    }
    if (entries.length === 0) {
        return {
            quantiles: {
                p50Seconds: null,
                p80Seconds: null,
                p95Seconds: null,
                sampleCount: 0,
                nEff: { numerator: "0", denominator: "1" },
            },
            estimatorVersion: options.estimatorVersion,
            policyVersion: options.policyVersion,
        };
    }
    const sorted = [...entries].sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
    void sorted;
    const weighted = [...entries].sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
    return {
        quantiles: {
            p50Seconds: contract.weightedEcdf(weighted, 0.5),
            p80Seconds: contract.weightedEcdf(weighted, 0.8),
            p95Seconds: contract.weightedEcdf(weighted, 0.95),
            sampleCount: entries.length,
            nEff: contract.effectiveSizeRatio(weights),
        },
        estimatorVersion: options.estimatorVersion,
        policyVersion: options.policyVersion,
    };
}
//# sourceMappingURL=comparables.js.map