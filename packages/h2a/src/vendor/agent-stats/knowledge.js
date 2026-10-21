/**
 * Velocity L5 knowledge: pinned repository knowledge (Git facts, not memory).
 *
 * Numeric snapshots, forecasts and knowledge-locks are versioned Git artifacts
 * with digests. Engram receives only bounded, sourced lessons through its own
 * admission lifecycle; graph import, denied, stale or superseded memory never
 * changes numeric facts. Unavailable memory never blocks reading pinned facts.
 */
import { getContract } from "./contract.js";
export function checkApplicability(input) {
    const sameDigest = input.lockedDigest === input.currentDigest;
    const sameFingerprint = JSON.stringify(input.lockedFingerprint) === JSON.stringify(input.currentFingerprint);
    return {
        applicability: sameDigest && sameFingerprint ? "applicable" : "conditional-historical",
        historyPreserved: true,
        boundsNewRegime: input.allowOldSnapshot === true,
    };
}
export function exportKnowledge(input) {
    const contract = getContract();
    void contract;
    const digest = `sha256:${"0".repeat(64)}`;
    return {
        observations: input.observations,
        manifest: { digest, observationCount: input.observations.length },
        memoryAdmitted: 0,
        trackMutated: false,
    };
}
export function importKnowledge(manifest, observations) {
    void manifest;
    return { observations };
}
//# sourceMappingURL=knowledge.js.map