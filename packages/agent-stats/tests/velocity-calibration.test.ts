import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { calibrate, compareBaseline, scoreRounds } from "../src/velocity/calibration.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l6-cal-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V32 coverage with abstention", () => {
  it("publishes denominators, coverage, loss, MAE, bias, width and abstention", () => {
    tempRoot();
    const report = calibrate({
      pairs: [
        { predictedP50: 100, actual: 110 },
        { predictedP50: 200, actual: 190 },
      ],
      abstentions: 1,
      total: 3,
    });
    expect(report.denominator).toBe(3);
    expect(report.abstentionRate).toBeCloseTo(1 / 3, 5);
    expect(report.mae).toBe(10);
    expect(report.bias).toBe(0);
    expect(report.coverage).toBeGreaterThanOrEqual(0);
  });

  it("flags universal refusal instead of scoring it as success", () => {
    tempRoot();
    const report = calibrate({ pairs: [], abstentions: 5, total: 5 });
    expect(report.universalRefusal).toBe(true);
    expect(report.coverage).toBeNull();
  });

  it("keeps AI only on better loss/coverage at equal abstention", () => {
    tempRoot();
    const baseline = calibrate({ pairs: [{ predictedP50: 100, actual: 200 }], abstentions: 0, total: 1 });
    const candidate = calibrate({ pairs: [{ predictedP50: 100, actual: 110 }], abstentions: 0, total: 1 });
    expect(compareBaseline({ baseline, candidate }).keepCandidate).toBe(true);
  });
});

describe("velocity T-V38 compare forecast and actual review rounds", () => {
  it("joins two rounds from parallel reviewers plus a correction wave", () => {
    tempRoot();
    const scored = scoreRounds({
      forecast: { p50Count: 1, p80Count: 2 },
      actualWaves: [
        { roundId: "R1", reviewerRuns: ["a", "b"] },
        { roundId: "R2", reviewerRuns: ["c"] },
      ],
    });
    expect(scored.completedRounds).toBe(2);
    expect(scored.reviewerRuns).toBe(3);
  });

  it("treats unknown coverage as missing and ignores duplicate receipts", () => {
    tempRoot();
    const missing = scoreRounds({ forecast: { p50Count: 1 }, actualWaves: [], coverage: "unknown" });
    expect(missing.denominator).toBe(0);
    const dup = scoreRounds({
      forecast: { p50Count: 1 },
      actualWaves: [{ roundId: "R1", reviewerRuns: ["a"] }],
      duplicateReceipts: 2,
    });
    expect(dup.completedRounds).toBe(1);
  });
});
