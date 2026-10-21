/**
 * Velocity L7 install: target-specific merge_to_installed actuals (pure).
 *
 * Validates the installation plan and evidence, resolves merge/release
 * ancestry through an injected Git port (here: explicit ancestryProven flag),
 * and computes the target-specific merge_to_installed actual. Reuses the
 * idempotent join semantics of actuals.ts.
 */
import { getContract } from "./contract.js";

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
  scope: { repo: string; lotOccurrence: string };
}

export interface QualifyResult {
  installedAt: string;
  verdict: "held" | "missed" | "unknown";
  reason?: string;
  mergeToInstalledSeconds: number | null;
}

export function qualifyTargetInstallation(input: QualifyInput): QualifyResult {
  const contract = getContract();
  const qualified = contract.qualifyInstallation(
    { targetId: input.targetId, forecastAt: input.forecastAt, receipt: input.receipt as never },
    {
      expectedTargetKind: input.qual.expectedTargetKind,
      expectedPlatform: input.qual.expectedPlatform,
      expectedInstallationScope: input.qual.expectedInstallationScope,
      expectedVersion: input.qual.expectedVersion,
      expectedTuple: input.qual.expectedTuple,
      expectedIntegrity: input.qual.expectedIntegrity,
      expectedMergeSha: input.qual.expectedMergeSha,
      expectedReleaseSourceSha: input.qual.expectedReleaseSourceSha,
      ancestryProven: input.qual.ancestryProven,
    },
  );
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
