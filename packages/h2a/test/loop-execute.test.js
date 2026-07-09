import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createObjectiveLoop,
  listLoopEvents,
  readObjectiveLoop,
  updateObjectiveLoopStatus
} from "../dist/runtime/loop/index.js";
import { executePlan } from "../dist/runtime/loop/engine/execute.js";
import { buildActionSink } from "../dist/runtime/loop/engine/adapters.js";

function freshRoot() {
  return join(mkdtempSync(join(tmpdir(), "h2a-exec-")), ".h2a");
}

test("updateObjectiveLoopStatus: flip une fois, idempotent ensuite (+ 1 event loop.closed)", () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    const r1 = updateObjectiveLoopStatus(root, loop.id, "done", { now: 1, reason: "x" });
    assert.equal(r1.changed, true);
    assert.equal(readObjectiveLoop(root, loop.id).status, "done");
    const r2 = updateObjectiveLoopStatus(root, loop.id, "done", { now: 2 });
    assert.equal(r2.changed, false);
    const closed = listLoopEvents(root, loop.id).filter((e) => e.type === "loop.closed");
    assert.equal(closed.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("executePlan: action close → sink.close appelé, report.done=1, event loop.action.applied", async () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    const calls = [];
    const fakeSink = {
      close: async () => { calls.push("close"); return "done"; },
      requestLaunch: async () => "skipped",
      wake: async () => "skipped",
      routeDecision: async () => "skipped"
    };
    const plan = {
      loopId: loop.id, degraded: false, outcome: "eligible-for-close",
      close: true, actions: [{ type: "close", reason: "refs ok" }], reasons: []
    };
    const report = await executePlan(root, loop.id, plan, fakeSink, 5);
    assert.deepEqual(calls, ["close"]);
    assert.equal(report.counts.done, 1);
    assert.equal(listLoopEvents(root, loop.id).filter((e) => e.type === "loop.action.applied").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("executePlan: plan degraded → n'exécute RIEN (sécurité)", async () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    let touched = false;
    const fakeSink = {
      close: async () => { touched = true; return "done"; },
      requestLaunch: async () => { touched = true; return "done"; },
      wake: async () => { touched = true; return "done"; },
      routeDecision: async () => { touched = true; return "done"; }
    };
    const plan = {
      loopId: loop.id, degraded: true, outcome: "degraded",
      close: false, actions: [{ type: "wake", agentId: "a1", reason: "x" }], reasons: []
    };
    const report = await executePlan(root, loop.id, plan, fakeSink, 5);
    assert.equal(touched, false);
    assert.equal(report.results.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("executePlan: runtime agents degraded seul → exécute les wakes presence-proven", async () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    const calls = [];
    const fakeSink = {
      close: async () => "skipped",
      requestLaunch: async () => "skipped",
      wake: async () => { calls.push("wake"); return "done"; },
      routeDecision: async () => "skipped"
    };
    const plan = {
      loopId: loop.id,
      degraded: true,
      degradedSources: { agents: true, refs: false },
      outcome: "waiting-agent",
      close: false,
      actions: [{ type: "wake", agentId: "a1", reason: "presence live" }],
      reasons: []
    };
    const report = await executePlan(root, loop.id, plan, fakeSink, 5);
    assert.deepEqual(calls, ["wake"]);
    assert.equal(report.counts.done, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("executePlan: track refs degraded → n'exécute RIEN", async () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    let touched = false;
    const fakeSink = {
      close: async () => { touched = true; return "done"; },
      requestLaunch: async () => { touched = true; return "done"; },
      wake: async () => { touched = true; return "done"; },
      routeDecision: async () => { touched = true; return "done"; }
    };
    const plan = {
      loopId: loop.id,
      degraded: true,
      degradedSources: { agents: false, refs: true },
      outcome: "degraded",
      close: false,
      actions: [{ type: "wake", agentId: "a1", reason: "x" }],
      reasons: []
    };
    const report = await executePlan(root, loop.id, plan, fakeSink, 5);
    assert.equal(touched, false);
    assert.equal(report.results.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildActionSink.close ferme le loop puis skip ; wake/launch = skipped (not-enabled)", async () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    const sink = buildActionSink();
    const ctx = { root, loopId: loop.id, now: 1 };
    assert.equal(await sink.close({ type: "close", reason: "x" }, ctx), "done");
    assert.equal(readObjectiveLoop(root, loop.id).status, "done");
    assert.equal(await sink.close({ type: "close", reason: "x" }, ctx), "skipped");
    assert.equal(await sink.wake({ type: "wake", agentId: "a1", reason: "x" }, ctx), "skipped");
    assert.equal(await sink.requestLaunch({ type: "request-launch", agentId: "a1", reason: "x" }, ctx), "skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
