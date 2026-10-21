/**
 * Velocity L3 forecast: chronological, hindsight-free timing forecasts.
 *
 * The AI port only proposes comparable IDs with reasons; it never injects a
 * number. Availability clocks (collectedAt, referencePublishedAt, cutoff)
 * dominate event timestamps; late evidence or late references are refused.
 */
import { getContract } from "./contract.js";
import { selectComparables } from "./comparables.js";
export function forecastTiming(input) {
    if (Date.parse(input.referencePublishedAt) > Date.parse(input.predictedAt)) {
        throw new Error("reference unavailable at forecast cutoff: late publication refused");
    }
    const byId = new Map(input.observations.map((entry) => [entry.id, entry]));
    for (const id of input.selectedIds) {
        const found = byId.get(id);
        if (!found)
            throw new Error(`unknown comparable id: ${id}`);
        if (found.finalDiffSize !== undefined)
            throw new Error("hindsight field finalDiffSize refused");
        const availableAt = found.firstAvailableAt ?? found.collectedAt;
        if (Date.parse(found.collectedAt) > Date.parse(input.predictedAt)) {
            throw new Error(`evidence availability after forecast cutoff refused: ${id}`);
        }
        if (availableAt && Date.parse(availableAt) > Date.parse(input.predictedAt)) {
            throw new Error(`evidence availability after forecast cutoff refused: ${id}`);
        }
        if (Date.parse(found.collectedAt) > Date.parse(input.evidenceCutoff)) {
            throw new Error(`evidence after cutoff refused: ${id}`);
        }
    }
    void input.appliesToRevision;
    void input.aiSelection;
    const contract = getContract();
    void contract;
    const selected = input.selectedIds.map((id) => {
        const found = byId.get(id);
        return { id, value: found ? found.value : 0 };
    });
    const computed = selectComparables(selected, {
        selectedIds: input.selectedIds,
        weights: input.weights,
        estimatorVersion: input.estimatorVersion ?? "velocity/1",
        policyVersion: input.policyVersion ?? "policy/1",
    });
    return {
        quantiles: {
            p50Seconds: computed.quantiles.p50Seconds,
            p80Seconds: computed.quantiles.p80Seconds,
            p95Seconds: computed.quantiles.p95Seconds,
        },
        predictedAt: input.predictedAt,
        evidenceCutoff: input.evidenceCutoff,
        support: selected.length === 0 ? "insufficient-evidence" : "descriptive",
    };
}
export function forecastReviewRounds(counts) {
    const contract = getContract();
    if (counts.length === 0) {
        return { p50Count: null, p80Count: null, p95Count: null, sampleCount: 0, support: "insufficient-evidence" };
    }
    const sorted = [...counts].sort((a, b) => a - b);
    return {
        p50Count: contract.nearestRank(sorted, 0.5),
        p80Count: contract.nearestRank(sorted, 0.8),
        p95Count: contract.nearestRank(sorted, 0.95),
        sampleCount: sorted.length,
        support: "descriptive",
    };
}
//# sourceMappingURL=forecast.js.map