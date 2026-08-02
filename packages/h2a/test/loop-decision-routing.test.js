import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EventStore, Track } from "@sentropic/track";
import { buildActionSink } from "../dist/runtime/loop/engine/adapters.js";
import { loopRefLocator, planLoopTick } from "../dist/runtime/loop/engine/decision.js";
import { executePlan } from "../dist/runtime/loop/engine/execute.js";
import { createObjectiveLoop } from "../dist/runtime/loop/index.js";

const EMPTY_AGENTS = { degraded: false, agents: [] };
const EMPTY_PRESENCE = { byInstance: new Map() };
const EMPTY_INBOX = { pendingDecisions: [] };

function workspace() {
  return mkdtempSync(join(tmpdir(), "h2a-loop-decision-routing-"));
}

function structuredGate(targetId) {
  return {
    system: "track",
    repoKey: "fixture",
    workspace: "fleet",
    aggregateKind: "item",
    aggregateId: targetId,
    role: "decision-gate",
    decisionGate: {
      id: "release-approval",
      decisionKind: "commitment",
      title: "Approve the staged release",
      context: "The loop is blocked until the owner chooses how to proceed with the staged release.",
      options: [
        { id: "approve", title: "Approve release", summary: "Proceed with the staged release." },
        { id: "hold", title: "Hold release", summary: "Keep the release blocked pending more evidence." },
      ],
      qa: [{ id: "risk", question: "Has the release evidence been reviewed?" }],
      recommendation: { optionId: "hold", rationale: "Hold until the owner has reviewed the evidence." },
      target: { itemId: targetId, workspace: "fleet" },
    },
  };
}

function planFor(loop, gate, status = "pending") {
  return planLoopTick({
    loop,
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: { degraded: false, refs: [{ locator: loopRefLocator(gate), status }] },
    inbox: EMPTY_INBOX,
    now: 1,
  });
}

function decisionsForSource(ledger, sourceKey) {
  return [...ledger.state().decisions.values()].filter((decision) => decision.sourceKey === sourceKey);
}

test("open structured decision gate routes exactly one well-formed pending Track decision", async () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const ledger = new Track(new EventStore(join(dir, ".track", "events.jsonl")));
    const targetId = ledger.createItem({ kind: "feature", title: "Release", workspace: "fleet" });
    const gate = structuredGate(targetId);
    const loop = createObjectiveLoop(root, { id: "route-one", goal: "Release safely", repos: [{ path: dir }], refs: [gate] });
    const plan = planFor(loop, gate);

    assert.equal(plan.outcome, "waiting-human");
    assert.equal(plan.actions.filter((action) => action.type === "route-decision").length, 1);
    const first = await executePlan(root, loop.id, plan, buildActionSink(), 1);
    assert.equal(first.results[0]?.outcome, "routed");
    assert.equal(first.counts.routed, 1);

    const decisions = [...ledger.state().decisions.values()];
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.outcome, "pending");
    assert.equal(decisions[0]?.targets[0], targetId);
    assert.equal(decisions[0]?.dossier.options.length, 2);
    assert.deepEqual(decisions[0]?.dossier.recommendation, gate.decisionGate.recommendation);

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-ticking an answered open decision gate does not duplicate its Track decision", async () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const ledger = new Track(new EventStore(join(dir, ".track", "events.jsonl")));
    const targetId = ledger.createItem({ kind: "feature", title: "Release", workspace: "fleet" });
    const gate = structuredGate(targetId);
    const loop = createObjectiveLoop(root, { id: "route-idempotent", goal: "Release safely", repos: [{ path: dir }], refs: [gate] });
    await executePlan(root, loop.id, planFor(loop, gate), buildActionSink(), 1);

    const [firstDecision] = [...ledger.state().decisions.values()];
    assert.ok(firstDecision?.sourceKey);
    ledger.selectDecisionOption(firstDecision.id, "approve");

    for (const now of [2, 3, 4]) {
      const tick = await executePlan(root, loop.id, planFor(loop, gate), buildActionSink(), now);
      assert.equal(tick.results[0]?.outcome, "routed");
      assert.equal(
        decisionsForSource(ledger, firstDecision.sourceKey).length,
        1,
        "three unchanged post-answer ticks must call createDecision exactly once for the episode",
      );
    }
    assert.equal([...ledger.state().decisions.values()].length, 1, "re-ticking an open gate must not duplicate its decision");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a resolved then reopened decision gate raises exactly one decision for its new episode", async () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const ledger = new Track(new EventStore(join(dir, ".track", "events.jsonl")));
    const targetId = ledger.createItem({ kind: "feature", title: "Release", workspace: "fleet" });
    const gate = structuredGate(targetId);
    const loop = createObjectiveLoop(root, { id: "route-reopened", goal: "Release safely", repos: [{ path: dir }], refs: [gate] });
    await executePlan(root, loop.id, planFor(loop, gate), buildActionSink(), 1);

    const [firstDecision] = [...ledger.state().decisions.values()];
    assert.ok(firstDecision?.sourceKey);
    ledger.selectDecisionOption(firstDecision.id, "approve");
    ledger.setRealization(targetId, "in-progress");
    ledger.setRealization(targetId, "done");
    assert.equal(planFor(loop, gate, "done").actions.filter((action) => action.type === "route-decision").length, 0);

    ledger.reopenItem(targetId, { motive: "regression-observed", reason: "The release needs a new owner decision." });
    for (const now of [2, 3, 4]) {
      await executePlan(root, loop.id, planFor(loop, gate), buildActionSink(), now);
    }

    const decisions = [...ledger.state().decisions.values()];
    assert.equal(decisions.length, 2, "the reopened gate must raise exactly one new decision");
    const [secondDecision] = decisions.filter((decision) => decision.id !== firstDecision.id);
    assert.ok(secondDecision?.sourceKey);
    assert.notEqual(secondDecision.sourceKey, firstDecision.sourceKey, "a reopened gate must have a distinct episode source key");
    assert.equal(decisionsForSource(ledger, firstDecision.sourceKey).length, 1);
    assert.equal(decisionsForSource(ledger, secondDecision.sourceKey).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unavailable Track ledger is failed visibly rather than skipped", async () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const gate = structuredGate("missing-target");
    const loop = createObjectiveLoop(root, { id: "ledger-down", goal: "Release safely", repos: [{ path: dir }], refs: [gate] });
    const action = planFor(loop, gate).actions.find((candidate) => candidate.type === "route-decision");
    assert.ok(action);
    const result = await buildActionSink().routeDecision(action, { root, loopId: loop.id, now: 1 });
    assert.deepEqual(result, { outcome: "failed", detail: "track-ledger-unavailable", retrySafe: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a loop without a decision-gate ref raises nothing", () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const target = {
      system: "track",
      repoKey: "fixture",
      workspace: "fleet",
      aggregateKind: "item",
      aggregateId: "target-1",
      role: "target",
    };
    const loop = createObjectiveLoop(root, { id: "no-gate", goal: "Release safely", refs: [target] });
    const plan = planLoopTick({
      loop,
      agents: EMPTY_AGENTS,
      presence: EMPTY_PRESENCE,
      refs: { degraded: false, refs: [{ locator: loopRefLocator(target), status: "pending" }] },
      inbox: EMPTY_INBOX,
      now: 1,
    });
    assert.equal(plan.actions.some((action) => action.type === "route-decision"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
