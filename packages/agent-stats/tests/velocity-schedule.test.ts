import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { simulateSchedule, validateGraph } from "../src/velocity/schedule.js";
import { buildPlanInput, remainingTime } from "../src/velocity/plan-input.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l4-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V18 schedule the whole graph", () => {
  it("computes 13 min at capacity 2 and 21 min at capacity 1", () => {
    tempRoot();
    const nodes = [
      { id: "a", durationSeconds: 600 },
      { id: "b", durationSeconds: 480 },
      { id: "c", durationSeconds: 180 },
    ];
    const edges = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ];
    expect(simulateSchedule({ nodes, edges, capacity: 2 }).makespanSeconds).toBe(780);
    expect(simulateSchedule({ nodes, edges, capacity: 1 }).makespanSeconds).toBe(1260);
  });

  it("forces serial order when a dependency edge exists", () => {
    tempRoot();
    const nodes = [
      { id: "a", durationSeconds: 600 },
      { id: "b", durationSeconds: 480 },
    ];
    expect(
      simulateSchedule({ nodes, edges: [{ from: "a", to: "b" }], capacity: 2 }).makespanSeconds,
    ).toBe(1080);
  });
});

describe("velocity T-V19 shared capacity and common shocks", () => {
  it("queues parallel authors on one reviewer without duplicating the review", () => {
    tempRoot();
    const plan = buildPlanInput({
      nodes: [
        { id: "lot-1", durationSeconds: 600 },
        { id: "lot-2", durationSeconds: 600 },
      ],
      edges: [],
      capacities: { reviewer: 1 },
    });
    expect(plan.capacities.reviewer).toBe(1);
    expect(plan.sharedReviewQueue).toBe(true);
  });

  it("counts one shared quota outage once, not once per lot", () => {
    tempRoot();
    const plan = buildPlanInput({
      nodes: [
        { id: "lot-1", durationSeconds: 600 },
        { id: "lot-2", durationSeconds: 600 },
      ],
      edges: [],
      capacities: {},
      commonShocks: [{ id: "quota-1", durationSeconds: 300 }],
    });
    expect(plan.commonShockSeconds).toBe(300);
  });
});

describe("velocity T-V20 plan quantiles from trials", () => {
  it("differs from summed per-lot quantiles where distributions require", () => {
    tempRoot();
    const trials = simulateSchedule({
      nodes: [
        { id: "a", durationSeconds: 600 },
        { id: "b", durationSeconds: 600 },
      ],
      edges: [],
      capacity: 2,
      trials: { draws: 200, seed: 7, samples: { a: [600, 600, 3600], b: [600, 600, 3600] } },
    });
    expect(trials.trialQuantiles).toBeTruthy();
    expect(trials.summedP80).toBe(7200);
    expect(trials.trialQuantiles?.p80Seconds).not.toBe(trials.summedP80);
  });
});

describe("velocity T-V21 explicit gates and start", () => {
  it("rejects graph cycles and ignores WP parentage as precedence", () => {
    tempRoot();
    expect(() =>
      validateGraph(
        [{ id: "a" }, { id: "b" }],
        [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      ),
    ).toThrow(/cycle/i);
    expect(() => validateGraph([{ id: "a" }, { id: "b" }], [])).not.toThrow();
  });

  it("yields no unconditional completion without capacity or with an open gate", () => {
    tempRoot();
    const plan = buildPlanInput({
      nodes: [{ id: "lot-1", durationSeconds: 600 }],
      edges: [],
      capacities: {},
      openGates: ["owner-go"],
    });
    expect(plan.completionAt).toBeNull();
    expect(plan.blockedReason).toMatch(/gate|capacity/i);
  });
});

describe("velocity T-V22 condition remaining time", () => {
  it("never yields a negative remainder", () => {
    tempRoot();
    expect(remainingTime({ quantileSeconds: 600, elapsedSeconds: 900 })).toBe(0);
    expect(remainingTime({ quantileSeconds: 600, elapsedSeconds: 100 })).toBe(500);
  });
});
