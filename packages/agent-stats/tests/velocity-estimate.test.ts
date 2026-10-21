import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { forecastTiming } from "../src/velocity/forecast.js";
import { buildEstimate } from "../src/velocity/estimate.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l3-est-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V14 reject hindsight and invented evidence", () => {
  it("refuses future merges, unknown PRs and post-outcome fields", () => {
    tempRoot();
    expect(() =>
      forecastTiming({
        predictedAt: "2026-10-18T10:00:00Z",
        evidenceCutoff: "2026-10-18T10:00:00Z",
        observations: [{ id: "99", value: 100, collectedAt: "2026-10-18T09:00:00Z" }],
        selectedIds: ["missing"],
        referencePublishedAt: "2026-10-18T09:00:00Z",
        appliesToRevision: "rev-1",
      }),
    ).toThrow(/unknown comparable/i);
    expect(() =>
      forecastTiming({
        predictedAt: "2026-10-18T10:00:00Z",
        evidenceCutoff: "2026-10-18T10:00:00Z",
        observations: [{ id: "1", value: 100, collectedAt: "2026-10-18T09:00:00Z", finalDiffSize: 999 }],
        selectedIds: ["1"],
        referencePublishedAt: "2026-10-18T09:00:00Z",
        appliesToRevision: "rev-1",
      }),
    ).toThrow(/hindsight/i);
  });

  it("enforces availability clocks over event timestamps", () => {
    tempRoot();
    expect(() =>
      forecastTiming({
        predictedAt: "2026-10-18T10:00:00Z",
        evidenceCutoff: "2026-10-18T10:00:00Z",
        observations: [{ id: "1", value: 3600, collectedAt: "2026-10-18T11:00:00Z" }],
        selectedIds: ["1"],
        referencePublishedAt: "2026-10-18T09:00:00Z",
        appliesToRevision: "rev-1",
      }),
    ).toThrow(/availability/i);
    expect(() =>
      forecastTiming({
        predictedAt: "2026-10-18T10:00:00Z",
        evidenceCutoff: "2026-10-18T10:00:00Z",
        observations: [{ id: "1", value: 3600, collectedAt: "2026-10-18T09:00:00Z" }],
        selectedIds: ["1"],
        referencePublishedAt: "2026-10-18T11:00:00Z",
        appliesToRevision: "rev-1",
      }),
    ).toThrow(/reference/i);
  });

  it("ignores numeric adjustments from the injected AI port", () => {
    tempRoot();
    const result = forecastTiming({
      predictedAt: "2026-10-18T10:00:00Z",
      evidenceCutoff: "2026-10-18T10:00:00Z",
      observations: [
        { id: "1", value: 100, collectedAt: "2026-10-18T09:00:00Z" },
        { id: "2", value: 200, collectedAt: "2026-10-18T09:00:00Z" },
      ],
      selectedIds: ["1", "2"],
      referencePublishedAt: "2026-10-18T09:00:00Z",
      appliesToRevision: "rev-1",
      aiSelection: { selectedIds: ["1", "2"], reasons: { "1": "similar", "2": "similar" }, numericAdjustment: 9999 },
    });
    expect(result.quantiles.p50Seconds).not.toBe(9999);
  });
});

describe("velocity T-V15 expose sparse support", () => {
  it("yields insufficient-evidence on n=0, never 0 min", () => {
    tempRoot();
    const result = buildEstimate({
      selected: [],
      baseline: [],
      exclusions: [],
      estimatorVersion: "velocity/1",
      policyVersion: "policy/1",
    });
    expect(result.support).toBe("insufficient-evidence");
    expect(result.quantiles.p50Seconds).toBeNull();
  });
});

describe("velocity T-V16 show selection effects", () => {
  it("emits selected and baseline with exclusions explained", () => {
    tempRoot();
    const result = buildEstimate({
      selected: [{ id: "1", value: 100 }],
      baseline: [
        { id: "1", value: 100 },
        { id: "2", value: 1000 },
      ],
      exclusions: [{ id: "2", reason: "different regime" }],
      estimatorVersion: "velocity/1",
      policyVersion: "policy/1",
    });
    expect(result.quantiles.p50Seconds).toBe(100);
    expect(result.baseline?.p50Seconds).toBe(100);
    expect(result.exclusions).toHaveLength(1);
  });
});
