export interface InstallQual {
    expectedTargetKind: string;
    expectedPlatform: string;
    expectedInstallationScope: string;
    expectedVersion: string;
    expectedTuple: string;
    expectedIntegrity: string;
    expectedMergeSha: string;
    expectedReleaseSourceSha: string;
    ancestryProven: boolean;
}
export interface InstallReceiptInput {
    repo: string;
    lotOccurrence: string;
    mergeSha: string;
    releaseSourceSha: string;
    targetId: string;
    targetKind: string;
    platform: string;
    installationScope: string;
    expectedVersion: string;
    observedVersion: string;
    expectedTuple: string;
    observedTuple: string;
    artifactIntegrity: string;
    resolvedExecutable: string;
    installStartedAt: string;
    installCompletedAt: string;
    smokeCompletedAt: string;
    installOutcome: string;
    smokeOutcome: string;
}
export interface QualifyInput {
    mergedAt: string | null;
    targetId: string;
    forecastAt: string | null;
    receipt: InstallReceiptInput | null;
    qual: InstallQual;
    scope: {
        repo: string;
        lotOccurrence: string;
    };
}
export interface QualifyResult {
    installedAt: string;
    verdict: "held" | "missed" | "unknown";
    reason?: string;
    mergeToInstalledSeconds: number | null;
}
export declare function qualifyTargetInstallation(input: QualifyInput): QualifyResult;
//# sourceMappingURL=install.d.ts.map