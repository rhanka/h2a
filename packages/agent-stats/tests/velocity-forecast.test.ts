import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { selectComparables } from "../src/velocity/comparables.js";
import { buildCohort } from "../src/velocity/cohort.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l3-fc-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V13 replay a frozen selection", () => {
  it("reproduces exact numbers for the same IDs, weights and estimator version", () => {
    tempRoot();
    const observations = [
      { id: "1", value: 9918 },
      { id: "2", value: 13240 },
      { id: "3", value: 46770 },
    ];
    const first = selectComparables(observations, {
      selectedIds: ["1", "2", "3"],
      weights: { "1": "1", "2": "1", "3": "1" },
      estimatorVersion: "velocity/1",
      policyVersion: "policy/1",
    });
    const second = selectComparables(observations, {
      selectedIds: ["1", "2", "3"],
      weights: { "1": "1", "2": "1", "3": "1" },
      estimatorVersion: "velocity/1",
      policyVersion: "policy/1",
    });
    expect(second.quantiles).toEqual(first.quantiles);
    expect(first.quantiles.p50Seconds).toBe(13240);
  });

  it("asserts D6 weighted fixtures and decimal-string equality", () => {
    tempRoot();
    const weighted = selectComparables(
      [
        { id: "a", value: 10 },
        { id: "b", value: 20 },
        { id: "c", value: 100 },
      ],
      {
        selectedIds: ["a", "b", "c"],
        weights: { a: "1", b: "1", c: "98" },
        estimatorVersion: "velocity/1",
        policyVersion: "policy/1",
      },
    );
    expect(weighted.quantiles.p50Seconds).toBe(100);
    expect(weighted.quantiles.p80Seconds).toBe(100);
    expect(weighted.quantiles.p95Seconds).toBe(100);
    const skewed = selectComparables(
      [
        { id: "a", value: 10 },
        { id: "b", value: 1000 },
      ],
      {
        selectedIds: ["a", "b"],
        weights: { a: "99", b: "1" },
        estimatorVersion: "velocity/1",
        policyVersion: "policy/1",
      },
    );
    expect(skewed.quantiles.p80Seconds).toBe(10);
    expect(skewed.quantiles.p95Seconds).toBe(10);
    const decimal = selectComparables(
      [
        { id: "a", value: 10 },
        { id: "b", value: 1000 },
      ],
      {
        selectedIds: ["a", "b"],
        weights: { a: "0.99", b: "0.01" },
        estimatorVersion: "velocity/1",
        policyVersion: "policy/1",
      },
    );
    expect(decimal.quantiles.p50Seconds).toBe(10);
  });

  it("rejects invalid weights, IDs and p", () => {
    tempRoot();
    const observations = [{ id: "a", value: 10 }];
    expect(() =>
      selectComparables(observations, {
        selectedIds: ["missing"],
        weights: {},
        estimatorVersion: "velocity/1",
        policyVersion: "policy/1",
      }),
    ).toThrow(/unknown comparable/i);
    expect(() =>
      selectComparables(observations, {
        selectedIds: ["a"],
        weights: { a: "not-a-number" },
        estimatorVersion: "velocity/1",
        policyVersion: "policy/1",
      }),
    ).toThrow();
  });

  it("returns the boundary value on exact cumulative-boundary equality", () => {
    tempRoot();
    const result = selectComparables(
      [
        { id: "a", value: 10 },
        { id: "b", value: 20 },
      ],
      {
        selectedIds: ["a", "b"],
        weights: { a: "1", b: "1" },
        estimatorVersion: "velocity/1",
        policyVersion: "policy/1",
      },
    );
    expect(result.quantiles.p50Seconds).toBe(10);
  });
});

describe("velocity T-V17 fail visibly on regime mismatch", () => {
  it("marks changed fingerprints conditional-historical, never silent recycle", () => {
    tempRoot();
    const cohort = buildCohort({
      cohortKey: "h2a-sol/1",
      members: ["1", "2"],
      fingerprint: { model: "a", ci: "old" },
      currentFingerprint: { model: "a", ci: "new" },
    });
    expect(cohort.applicability).toBe("conditional-historical");
    expect(cohort.historyPreserved).toBe(true);
  });
});
