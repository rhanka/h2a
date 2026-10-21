import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { qualifyTargetInstallation } from "../src/velocity/install.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l7-inst-"));
  tempDirs.push(dir);
  return dir;
}

function qual() {
  return {
    expectedTargetKind: "ci-runner",
    expectedPlatform: "linux",
    expectedInstallationScope: "ci",
    expectedVersion: "0.98.7",
    expectedTuple: "h2a-0.98.7.tgz",
    expectedIntegrity: "sha256:" + "a".repeat(64),
    expectedMergeSha: "a".repeat(40),
    expectedReleaseSourceSha: "b".repeat(40),
    ancestryProven: true,
  };
}

function receipt() {
  return {
    schema: "engram.time-reference/installation-receipt/1",
    repo: "rhanka/h2a",
    lotOccurrence: "L1",
    mergeSha: "a".repeat(40),
    releaseSourceSha: "b".repeat(40),
    ancestryEvidence: "ancestry-ok",
    targetId: "ci",
    targetKind: "ci-runner",
    platform: "linux",
    installationScope: "ci",
    expectedVersion: "0.98.7",
    observedVersion: "0.98.7",
    expectedTuple: "h2a-0.98.7.tgz",
    observedTuple: "h2a-0.98.7.tgz",
    artifactIntegrity: "sha256:" + "a".repeat(64),
    resolvedExecutable: "/tmp/prefix/bin/h2a",
    installStartedAt: "2026-10-18T10:05:00Z",
    installCompletedAt: "2026-10-18T10:05:00Z",
    smokeCompletedAt: "2026-10-18T10:06:00Z",
    installOutcome: "success",
    smokeOutcome: "success",
    clockSource: "injected",
    producerIdentity: "test-producer",
    evidenceDigests: [],
  };
}

describe("velocity T-V39 target installation milestone", () => {
  it("yields installedAt 10:06 and 360 s merge_to_installed on matching proof", () => {
    tempRoot();
    const result = qualifyTargetInstallation({
      mergedAt: "2026-10-18T10:00:00Z",
      targetId: "ci",
      forecastAt: null,
      receipt: receipt(),
      qual: qual(),
      scope: { repo: "rhanka/h2a", lotOccurrence: "L1" },
    });
    expect(result.installedAt).toBe("2026-10-18T10:06:00Z");
    expect(result.mergeToInstalledSeconds).toBe(360);
    expect(result.verdict).toBe("held");
  });

  it("leaves unknown with a reason on publication alone, failed smoke, wrong artifact or missing ancestry", () => {
    tempRoot();
    const noReceipt = qualifyTargetInstallation({
      mergedAt: "2026-10-18T10:00:00Z",
      targetId: "ci",
      forecastAt: null,
      receipt: null,
      qual: qual(),
      scope: { repo: "rhanka/h2a", lotOccurrence: "L1" },
    });
    expect(noReceipt.installedAt).toBe("unknown");
    expect(noReceipt.reason).toBeTruthy();
    const badSmoke = qualifyTargetInstallation({
      mergedAt: "2026-10-18T10:00:00Z",
      targetId: "ci",
      forecastAt: null,
      receipt: { ...receipt(), smokeOutcome: "failure" },
      qual: qual(),
      scope: { repo: "rhanka/h2a", lotOccurrence: "L1" },
    });
    expect(badSmoke.installedAt).toBe("unknown");
    expect(badSmoke.mergeToInstalledSeconds).toBeNull();
  });

  it("keeps the workstation target unknown on a valid CI-runner receipt", () => {
    tempRoot();
    const result = qualifyTargetInstallation({
      mergedAt: "2026-10-18T10:00:00Z",
      targetId: "workstation",
      forecastAt: null,
      receipt: receipt(),
      qual: { ...qual(), expectedTargetKind: "delivery-environment" },
      scope: { repo: "rhanka/h2a", lotOccurrence: "L1" },
    });
    expect(result.installedAt).toBe("unknown");
  });
});
