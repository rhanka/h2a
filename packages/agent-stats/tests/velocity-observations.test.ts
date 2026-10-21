import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildScenarioQuantiles,
  computeCohortQuantiles,
  loadEngramCohortSeconds,
  loadGithubCohortSeconds,
  openToMergeOrNull,
} from "../src/velocity/observations.js";
import {
  buildTimingRecord,
  distinctCiMetrics,
} from "../src/velocity/measure.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l1-"));
  tempDirs.push(dir);
  return dir;
}

function fixture(name: string): string {
  const url = new URL(`./fixtures/velocity/${name}`, import.meta.url);
  try {
    return readFileSync(url, "utf-8");
  } catch {
    throw new Error(`missing required fixture: ${name}`);
  }
}

describe("velocity T-V01 replay the observed cohorts", () => {
  it("replays h2a Astra/Sol open-to-merge quantiles as descriptive", () => {
    tempRoot();
    const raw = JSON.parse(fixture("github-sample.json"));
    const astra = loadGithubCohortSeconds(raw, "astra-merged-desc/1");
    const sol = loadGithubCohortSeconds(raw, "sol-created-desc/1");
    expect(computeCohortQuantiles(astra)).toMatchObject({
      n: 20,
      p50Seconds: 9918,
      p80Seconds: 46770,
      p95Seconds: 108177,
      quantileMethod: "nearest-rank/1",
      support: "descriptive",
      calibrated: false,
    });
    expect(computeCohortQuantiles(sol)).toMatchObject({
      n: 20,
      p50Seconds: 9918,
      p80Seconds: 13240,
      p95Seconds: 46770,
    });
  });

  it("replays engram enriched/older cohorts in separate regimes", () => {
    tempRoot();
    const enriched = loadEngramCohortSeconds(JSON.parse(fixture("engram-enriched.json")));
    const older = loadEngramCohortSeconds(JSON.parse(fixture("engram-older.json")));
    expect(computeCohortQuantiles(enriched)).toMatchObject({
      n: 60,
      p50Seconds: 1777,
      p80Seconds: 3617,
      p95Seconds: 23992,
    });
    expect(computeCohortQuantiles(older)).toMatchObject({
      n: 121,
      p50Seconds: 860,
      p80Seconds: 12636,
      p95Seconds: 244338,
    });
  });

  it("replays both 60-combination scenarios without calling them measurements", () => {
    tempRoot();
    const raw = JSON.parse(fixture("github-sample.json"));
    const solBase = loadGithubCohortSeconds(raw, "sol-created-desc/1");
    const astraBase = loadGithubCohortSeconds(raw, "astra-merged-desc/1");
    const sol = buildScenarioQuantiles(solBase);
    const astra = buildScenarioQuantiles(astraBase);
    expect(sol.combinations).toBe(60);
    expect(sol.independentObservations).toBe(20);
    expect(sol.kind).toBe("scenario");
    expect(astra.combinations).toBe(60);
    expect(astra.independentObservations).toBe(20);
    expect(sol.quantiles).toMatchObject({ p50Seconds: 10642.6, p80Seconds: 14264.2, p95Seconds: 47794.2 });
    expect(astra.quantiles).toMatchObject({ p50Seconds: 10729.6, p80Seconds: 47794.2, p95Seconds: 109201.2 });
  });

  it("fails instead of skipping when a fixture is absent", () => {
    tempRoot();
    expect(() => fixture("absent-fixture.json")).toThrow(/missing required fixture/);
  });
});

describe("velocity T-V02 preserve missingness", () => {
  it("keeps missing, unfinished, skipped and end-before-start as null/quarantined", () => {
    tempRoot();
    expect(openToMergeOrNull({ createdAt: "2026-10-18T10:00:00Z", mergedAt: null })).toBeNull();
    expect(
      openToMergeOrNull({ createdAt: "2026-10-18T10:00:00Z", mergedAt: "2026-10-18T09:00:00Z" }),
    ).toBeNull();
    const raw = JSON.parse(fixture("skipped-check-anomalies.json"));
    const first = raw.pullRequests[0].checks[0];
    expect(first.conclusion).toBe("skipped");
    expect(first.completedAt < first.startedAt).toBe(true);
  });

  it("never renders a zero or negative duration sample", () => {
    tempRoot();
    const samples = [
      openToMergeOrNull({ createdAt: "2026-10-18T10:00:00Z", mergedAt: null }),
      openToMergeOrNull({ createdAt: "2026-10-18T10:00:00Z", mergedAt: "2026-10-18T10:00:00Z" }),
    ];
    for (const sample of samples) {
      expect(sample === null || sample > 0).toBe(true);
    }
  });
});

describe("velocity T-V04 keep metrics separate", () => {
  it("distinguishes service sum, longest job, envelope and workflow span", () => {
    tempRoot();
    const metrics = distinctCiMetrics({
      jobs: [
        { name: "a", startedAt: "2026-10-18T10:00:00Z", completedAt: "2026-10-18T10:10:00Z" },
        { name: "b", startedAt: "2026-10-18T10:05:00Z", completedAt: "2026-10-18T10:13:00Z" },
      ],
      triggerAt: "2026-10-18T09:59:00Z",
    });
    expect(metrics.serviceSumSeconds).toBe(600 + 480);
    expect(metrics.longestJobSeconds).toBe(600);
    expect(metrics.envelopeSeconds).toBe(13 * 60);
    expect(metrics.workflowSpanSeconds).toBe(14 * 60);
  });

  it("never adds CI time to open-to-merge", () => {
    tempRoot();
    const record = buildTimingRecord({
      repo: "rhanka/h2a",
      number: 1,
      createdAt: "2026-10-18T10:00:00Z",
      mergedAt: "2026-10-18T11:00:00Z",
    });
    expect(record.openToMergeSeconds).toBe(3600);
    expect(record.ciSeconds).toBeNull();
  });
});

describe("velocity T-V06 two milestones", () => {
  it("emits mergedAt and installedAt unknown as separate fields", () => {
    tempRoot();
    const record = buildTimingRecord({
      repo: "rhanka/h2a",
      number: 1,
      createdAt: "2026-10-18T10:00:00Z",
      mergedAt: "2026-10-18T11:00:00Z",
    });
    expect(record.mergedAt).toBe("2026-10-18T11:00:00Z");
    expect(record.installedAt).toBe("unknown");
    expect(record.installationTarget).toBe("unknown");
  });

  it("keeps review counts null with a reason before L2/L3", () => {
    tempRoot();
    const record = buildTimingRecord({
      repo: "rhanka/h2a",
      number: 1,
      createdAt: "2026-10-18T10:00:00Z",
      mergedAt: "2026-10-18T11:00:00Z",
    });
    expect(record.reviewRoundsActual).toBeNull();
    expect(record.reviewMissingReason).toMatch(/round evidence/);
  });
});
