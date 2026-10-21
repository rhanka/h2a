/**
 * Velocity L7 installed entrypoint facade (lightweight, no runtime/gateway/memory).
 *
 * This module only imports the vendored agent-stats velocity closure (pure
 * deterministic code over the published engram time-reference contract) and
 * Node builtins. It never starts the runtime, gateway or memory service.
 */
import { readFileSync } from "node:fs";

import { computeCohortQuantiles, loadGithubCohortSeconds } from "./vendor/agent-stats/observations.js";

export interface EstimateFixture {
  cohorts: Record<string, Array<number | string>>;
  pullRequests: Array<{ number: number | string; createdAt: string; mergedAt: string | null }>;
}

export interface EstimateResult {
  metric: "pr_open_to_merge";
  support: "descriptive";
  calibrated: false;
  quantiles: { p50Seconds: number | null; p80Seconds: number | null; p95Seconds: number | null };
  mergedAt: null;
  installedAt: "unknown";
}

export function runEstimateFixture(fixturePath: string): EstimateResult {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as EstimateFixture;
  const values = loadGithubCohortSeconds(raw, "sol-created-desc/1");
  const quantiles = computeCohortQuantiles(values);
  return {
    metric: "pr_open_to_merge",
    support: "descriptive",
    calibrated: false,
    quantiles: {
      p50Seconds: quantiles.p50Seconds,
      p80Seconds: quantiles.p80Seconds,
      p95Seconds: quantiles.p95Seconds,
    },
    mergedAt: null,
    installedAt: "unknown",
  };
}

export function describeEstimate(): string {
  return "pr-open-to-merge descriptive; installedAt unknown until target proof";
}
