/**
 * Velocity L7 install: target-specific merge_to_installed actuals (pure).
 *
 * Validates the installation plan and evidence, resolves merge/release
 * ancestry through an injected Git port (here: explicit ancestryProven flag),
 * and computes the target-specific merge_to_installed actual. Reuses the
 * idempotent join semantics of actuals.ts.
 */
import { getContract } from "./contract.js";
export function qualifyTargetInstallation(input) {
    const contract = getContract();
    const qualified = contract.qualifyInstallation({ targetId: input.targetId, forecastAt: input.forecastAt, receipt: input.receipt }, {
        expectedTargetKind: input.qual.expectedTargetKind,
        expectedPlatform: input.qual.expectedPlatform,
        expectedInstallationScope: input.qual.expectedInstallationScope,
        expectedVersion: input.qual.expectedVersion,
        expectedTuple: input.qual.expectedTuple,
        expectedIntegrity: input.qual.expectedIntegrity,
        expectedMergeSha: input.qual.expectedMergeSha,
        expectedReleaseSourceSha: input.qual.expectedReleaseSourceSha,
        ancestryProven: input.qual.ancestryProven,
    });
    if (input.receipt) {
        if (input.receipt.repo !== input.scope.repo || input.receipt.lotOccurrence !== input.scope.lotOccurrence) {
            return { installedAt: "unknown", verdict: "unknown", reason: "receipt bound to another repo/lot", mergeToInstalledSeconds: null };
        }
        if (input.receipt.targetId !== input.targetId) {
            return { installedAt: "unknown", verdict: "unknown", reason: "receipt targets another target", mergeToInstalledSeconds: null };
        }
    }
    if (qualified.installedAt === "unknown") {
        return { installedAt: "unknown", verdict: "unknown", reason: qualified.reason ?? "unqualified target", mergeToInstalledSeconds: null };
    }
    return {
        installedAt: qualified.installedAt,
        verdict: "held",
        mergeToInstalledSeconds: contract.mergeToInstalledSample(input.mergedAt, qualified.installedAt),
    };
}
//# sourceMappingURL=install.js.map