import { describe, expect, it } from "vitest";

import {
  ENGRAM_GIT_HEAD,
  ENGRAM_INTEGRITY,
  ENGRAM_VERSION,
  getContract,
} from "../src/velocity/contract.js";

describe("velocity contract T-V00-C (engram 0.21.0 time-reference, offline)", () => {
  it("pins the exact published version, integrity and git head", () => {
    expect(ENGRAM_VERSION).toBe("0.21.0");
    expect(ENGRAM_INTEGRITY).toBe(
      "sha512-CrHVxemSzxfrnotl1ZNrSzIePIbTapII6HIJj5GRqwViHyhbWItTduw/ybQvM8AQsV99xmqHHoEwhLESFitzAw==",
    );
    expect(ENGRAM_GIT_HEAD).toBe("fa3e8645366a71703a04b9eab7ca757e805edf1a");
    const contract = getContract();
    expect(contract.QUANTILE_NEAREST_RANK).toBe("nearest-rank/1");
    expect(contract.QUANTILE_WEIGHTED_ECDF).toBe("weighted-ecdf/1");
  });

  it("computes exact nearest-rank and weighted-ecdf quantiles", () => {
    const contract = getContract();
    expect(contract.nearestRank([10, 20, 100], 0.5)).toBe(20);
    expect(contract.nearestRank([10, 20, 100], 0.8)).toBe(100);
    expect(contract.nearestRank([10, 20, 100], 0.95)).toBe(100);
    const weighted = [
      { id: "a", value: 10 },
      { id: "b", value: 20 },
      { id: "c", value: 100, weight: "98" },
    ];
    expect(contract.weightedEcdf(weighted, 0.5)).toBe(100);
    expect(contract.weightedEcdf(weighted, 0.8)).toBe(100);
    expect(contract.weightedEcdf(weighted, 0.95)).toBe(100);
    const skewed = [
      { id: "a", value: 10, weight: "99" },
      { id: "b", value: 1000, weight: "1" },
    ];
    expect(contract.weightedEcdf(skewed, 0.5)).toBe(10);
    expect(contract.weightedEcdf(skewed, 0.8)).toBe(10);
    expect(contract.weightedEcdf(skewed, 0.95)).toBe(10);
    expect(contract.nearestRank([10, 1000], 0.8)).toBe(1000);
    expect(contract.nearestRank([10, 1000], 0.95)).toBe(1000);
    const decimal = [
      { id: "a", value: 10, weight: "0.99" },
      { id: "b", value: 1000, weight: "0.01" },
    ];
    expect(contract.weightedEcdf(decimal, 0.5)).toBe(10);
  });

  it("reports exact nEff as a reduced numerator/denominator ratio", () => {
    const contract = getContract();
    expect(contract.effectiveSizeRatio(["1", "1", "98"])).toEqual({
      numerator: "5000",
      denominator: "4803",
    });
    expect(contract.effectiveSizeRatio(["1", "1"])).toEqual({
      numerator: "2",
      denominator: "1",
    });
    expect(contract.parseEffectiveSizeRatio({ numerator: "5000", denominator: "4803" })).toEqual({
      numerator: "5000",
      denominator: "4803",
    });
    expect(() =>
      contract.parseEffectiveSizeRatio({ numerator: "1.5", denominator: "2" }),
    ).toThrow();
  });

  it("keeps merge and install milestones separate; unknown without receipt", () => {
    const contract = getContract();
    expect(contract.buildDeliveryMilestones(null, [])).toBeNull();
    const qualified = contract.qualifyInstallation(
      { targetId: "ci", forecastAt: null, receipt: null },
      {
        expectedTargetKind: "ci-runner",
        expectedPlatform: "linux",
        expectedInstallationScope: "runner",
        expectedVersion: "1.0.0",
        expectedTuple: "tuple",
        expectedIntegrity: `sha256:${"a".repeat(64)}`,
        expectedMergeSha: "a".repeat(40),
        expectedReleaseSourceSha: "b".repeat(40),
        ancestryProven: false,
      },
    );
    expect(qualified.installedAt).toBe("unknown");
    expect(qualified.reason).toBeTruthy();
  });

  it("authenticates snapshot bytes and rejects a substituted pin", () => {
    const contract = getContract();
    expect(contract.sampleSnapshotDigest("hello")).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    const ok = contract.verifyContractPin(
      { "a.txt": "hello" },
      [
        {
          path: "a.txt",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      ],
    );
    expect(ok).toEqual([]);
    const bad = contract.verifyContractPin(
      { "a.txt": "tampered" },
      [
        {
          path: "a.txt",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      ],
    );
    expect(bad.length).toBeGreaterThan(0);
  });

  it("binds receipts to repo/lot/mergeSha and validates calendar UTC instants", () => {
    const contract = getContract();
    expect(contract.isInstant("2026-10-18T07:48:57Z")).toBe(true);
    expect(contract.isInstant("2026-02-30T10:00:00Z")).toBe(false);
    const badClock = contract.validatePullRequestTiming({
      schema: "engram.time-reference/pull-request-timing/1",
      repo: "rhanka/h2a",
      number: 1,
      createdAt: "2026-02-30T10:00:00Z",
      mergedAt: "2026-10-18T10:00:00Z",
      firstCommitAt: null,
      firstCommitPolicy: "proxy-only-excluded-from-forecasts",
      openToMergeSeconds: 1,
      commits: null,
      commitsCollectionState: "not-collected",
    });
    expect(badClock.ok).toBe(false);
    const skipped = contract.ciJobServiceSeconds({
      status: "completed",
      conclusion: "skipped",
      startedAt: "2026-10-18T08:50:52Z",
      completedAt: "2026-10-18T08:50:51Z",
    });
    expect(skipped).toBeNull();
    const record = {
      schema: "engram.time-reference/delivery-milestones/1",
      repo: "rhanka/h2a",
      lotRef: "lot-1",
      forecastRevision: "F001",
      mergeSha: "a".repeat(40),
      mergeMilestone: { forecastAt: null, mergedAt: "2026-10-18T10:00:00Z", verdict: "not-claimed" },
      installMilestones: [
        {
          targetId: "ci",
          forecastAt: null,
          installedAt: "2026-10-18T10:06:00Z",
          verdict: "held",
          receiptRef: "missing",
        },
      ],
    };
    const bound = contract.validateMilestonesAgainstReceipts(
      record,
      {},
      {},
      { repo: "rhanka/h2a", lotOccurrence: "L1" },
    );
    expect(bound.length).toBeGreaterThan(0);
  });
});
