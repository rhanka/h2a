/**
 * Velocity L1 observations: frozen-fixture replay only (read-only).
 *
 * No network, no Git/Track mutation. Live collection lives in github.ts
 * behind an explicitly injected runner; this module only derives samples
 * from explicitly supplied fixture objects.
 */
import { getContract } from "./contract.js";
function secondsBetween(start, end) {
    const contract = getContract();
    const sample = contract.openToMergeSample({ createdAt: start, mergedAt: end });
    return sample;
}
export function openToMergeOrNull(input) {
    if (input.mergedAt === null)
        return null;
    return secondsBetween(input.createdAt, input.mergedAt);
}
export function loadGithubCohortSeconds(raw, cohortKey) {
    const ids = raw.cohorts[cohortKey];
    if (!ids)
        throw new Error(`missing cohort: ${cohortKey}`);
    const byNumber = new Map(raw.pullRequests.map((pr) => [String(pr.number), pr]));
    const values = [];
    for (const id of ids) {
        const pr = byNumber.get(String(id));
        if (!pr)
            throw new Error(`missing PR ${String(id)} in cohort ${cohortKey}`);
        const sample = pr.mergedAt === null ? null : secondsBetween(pr.createdAt, pr.mergedAt);
        if (sample !== null)
            values.push(sample);
    }
    return values;
}
export function loadEngramCohortSeconds(raw) {
    const values = [];
    for (const pr of raw.pullRequests) {
        if (pr.mergedAt === null)
            continue;
        const sample = secondsBetween(pr.createdAt, pr.mergedAt);
        if (sample !== null)
            values.push(sample);
    }
    return values;
}
export function computeCohortQuantiles(values) {
    const contract = getContract();
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) {
        return {
            n: 0,
            p50Seconds: null,
            p80Seconds: null,
            p95Seconds: null,
            quantileMethod: "nearest-rank/1",
            support: "descriptive",
            calibrated: false,
        };
    }
    return {
        n: sorted.length,
        p50Seconds: contract.nearestRank(sorted, 0.5),
        p80Seconds: contract.nearestRank(sorted, 0.8),
        p95Seconds: contract.nearestRank(sorted, 0.95),
        maxSeconds: sorted[sorted.length - 1],
        quantileMethod: "nearest-rank/1",
        support: "descriptive",
        calibrated: false,
    };
}
/** Displayed, rounded start-to-open proxies in seconds (§3.4). */
export const START_TO_OPEN_PROXIES_SECONDS = [243.6, 595.8, 1024.2];
export function buildScenarioQuantiles(baseOpenToMerge) {
    const contract = getContract();
    const sums = [];
    for (const base of baseOpenToMerge) {
        for (const proxy of START_TO_OPEN_PROXIES_SECONDS)
            sums.push(base + proxy);
    }
    sums.sort((a, b) => a - b);
    return {
        kind: "scenario",
        combinations: sums.length,
        independentObservations: baseOpenToMerge.length,
        quantiles: {
            p50Seconds: contract.nearestRank(sums, 0.5),
            p80Seconds: contract.nearestRank(sums, 0.8),
            p95Seconds: contract.nearestRank(sums, 0.95),
        },
    };
}
//# sourceMappingURL=observations.js.map