import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildForecastCard, planForecast, renderReport } from "../src/velocity/report.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l5-plan-"));
  tempDirs.push(dir);
  return dir;
}

function card() {
  return buildForecastCard({
    lotRef: "lot-1",
    metric: "pr_open_to_merge",
    quantiles: { p50Seconds: 9918, p80Seconds: 13240, p95Seconds: 46770 },
    mergedAt: "2026-10-18T10:00:00Z",
  });
}

describe("velocity T-V25 preserve the report contract", () => {
  it("keeps the four sections, WP linkage, selectors and handles offline", () => {
    tempRoot();
    const report = renderReport({
      card: card(),
      sections: ["goal", "progress", "decisions", "next"],
      wpLink: "WP8",
      period: "last-week",
      handles: ["[1.2]"],
    });
    expect(report.sections).toEqual(["goal", "progress", "decisions", "next"]);
    expect(report.wpLink).toBe("WP8");
    expect(report.offline).toBe(true);
    expect(report.text).not.toMatch(/remaining dev|installed on/i);
  });
});

describe("velocity T-V26 preserve language neutrality", () => {
  it("keeps metric and status IDs neutral with catalogue prose", () => {
    tempRoot();
    const built = card();
    expect(built.metric).toBe("pr_open_to_merge");
    expect(JSON.stringify(built)).not.toMatch(/délai|délais/);
    const rendered = renderReport({
      card: built,
      sections: ["goal", "progress", "decisions", "next"],
      catalogue: { pr_open_to_merge: "délai d'ouverture à fusion" },
    });
    expect(rendered.text).toMatch(/délai/);
  });
});

describe("velocity T-V27 no second realization state", () => {
  it("writes only forecast cards plus lock beside the plan without dropping metadata", () => {
    tempRoot();
    const planned = planForecast({
      card: card(),
      knowledgeLock: { digest: "sha256:" + "a".repeat(64) },
      existingPlan: { title: "lot-1", ownerNotes: "keep", forecast: { old: true } },
    });
    expect(planned.forecastCard.lotRef).toBe("lot-1");
    expect(planned.plan.ownerNotes).toBe("keep");
    expect(planned.usedReportSet).toBe(false);
  });

  it("restores comparables and conditional dates in a cold planning UAT", () => {
    tempRoot();
    const withReference = planForecast({
      card: card(),
      knowledgeLock: { digest: "sha256:" + "a".repeat(64) },
      existingPlan: { title: "lot-1" },
      capacity: { reviewer: 1 },
    });
    expect(withReference.dates.conditional).toBe(true);
    const withoutReference = planForecast({
      card: null,
      knowledgeLock: null,
      existingPlan: { title: "lot-1" },
      capacity: {},
    });
    expect(withoutReference.abstention).toBe(true);
  });
});
