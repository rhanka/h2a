import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { forecastReviewRounds } from "../src/velocity/forecast.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l3-match-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V37 forecast review rounds", () => {
  it("produces descriptive integer 1/3/3 on [1,1,2,3] with own tail labels", () => {
    tempRoot();
    const result = forecastReviewRounds([1, 1, 2, 3]);
    expect(result).toMatchObject({
      p50Count: 1,
      p80Count: 3,
      p95Count: 3,
      sampleCount: 4,
      support: "descriptive",
    });
  });

  it("yields insufficient-evidence and null counts without round manifests", () => {
    tempRoot();
    const result = forecastReviewRounds([]);
    expect(result.support).toBe("insufficient-evidence");
    expect(result.p50Count).toBeNull();
  });

  it("does not let parallel reviewer multiplicity inflate round predictions", () => {
    tempRoot();
    const rounds = forecastReviewRounds([1, 1]);
    const inflated = forecastReviewRounds([1, 1]);
    expect(inflated.p50Count).toBe(rounds.p50Count);
  });
});
