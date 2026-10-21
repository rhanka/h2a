import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ingestActual, joinActuals } from "../src/velocity/actuals.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l6-act-"));
  tempDirs.push(dir);
  return dir;
}

function forecast() {
  return {
    forecastId: "F001",
    revision: "r1",
    lotRef: "lot-1",
    predictedAt: "2026-10-18T10:00:00Z",
    evidenceCutoff: "2026-10-18T10:00:00Z",
    inputRevision: "rev-1",
    referenceDigest: "sha256:" + "a".repeat(64),
    quantiles: { p50Seconds: 9918, p80Seconds: 13240, p95Seconds: 46770 },
  };
}

describe("velocity T-V28 never rewrite a prediction", () => {
  it("leaves the original record, cutoff and inputs byte-identical", () => {
    tempRoot();
    const before = JSON.stringify(forecast());
    const actual = ingestActual({
      forecast: forecast(),
      delivery: { repo: "rhanka/h2a", number: 1, mergeSha: "a".repeat(40), mergedAt: "2026-10-18T12:00:00Z" },
    });
    expect(JSON.stringify(actual.forecast)).toBe(before);
    expect(actual.forecast.evidenceCutoff).toBe("2026-10-18T10:00:00Z");
  });
});

describe("velocity T-V29 ingest a merge once", () => {
  it("ignores duplicate delivery of the same repo/PR/merge SHA", () => {
    tempRoot();
    const delivery = { repo: "rhanka/h2a", number: 1, mergeSha: "a".repeat(40), mergedAt: "2026-10-18T12:00:00Z" };
    const store = joinActuals([], { forecast: forecast(), delivery });
    const again = joinActuals(store.actuals, { forecast: forecast(), delivery });
    expect(again.actuals).toHaveLength(1);
    expect(again.duplicates).toBe(1);
  });
});

describe("velocity T-V30 adverse outcomes stay visible", () => {
  it("keeps open censored, abandonment distinct, reopening preserves history", () => {
    tempRoot();
    const open = ingestActual({ forecast: forecast(), delivery: { repo: "rhanka/h2a", number: 1, mergeSha: null, mergedAt: null, status: "open" } });
    expect(open.actual.status).toBe("censored");
    const abandoned = ingestActual({ forecast: forecast(), delivery: { repo: "rhanka/h2a", number: 1, mergeSha: null, mergedAt: null, status: "abandoned" } });
    expect(abandoned.actual.status).toBe("abandoned");
    expect(abandoned.actual.status).not.toBe(open.actual.status);
    const reopened = ingestActual({
      forecast: forecast(),
      delivery: { repo: "rhanka/h2a", number: 365, mergeSha: "b".repeat(40), mergedAt: "2026-10-18T12:00:00Z", reworkOf: 365 },
    });
    expect(reopened.actual.reworkOf).toBe(365);
  });
});

describe("velocity T-V31 no future leakage in replay", () => {
  it("rejects backtests fed future evidence or late references", () => {
    tempRoot();
    expect(() =>
      ingestActual({
        forecast: { ...forecast(), predictedAt: "2026-10-18T10:00:00Z" },
        delivery: { repo: "rhanka/h2a", number: 1, mergeSha: "a".repeat(40), mergedAt: "2026-10-18T09:00:00Z", collectedAt: "2026-10-18T11:00:00Z" },
      }),
    ).toThrow(/availability|future/i);
  });
});
