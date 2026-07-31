import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createObjectiveLoop,
  appendLoopEvent,
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

test("buildActionSink.close ferme le loop puis skip ; wake/launch inconnus restent fail-closed", async () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "t", goal: "g" });
    const sink = buildActionSink();
    const ctx = { root, loopId: loop.id, now: 1 };
    assert.equal(await sink.close({ type: "close", reason: "x" }, ctx), "done");
    assert.equal(readObjectiveLoop(root, loop.id).status, "done");
    assert.equal(await sink.close({ type: "close", reason: "x" }, ctx), "skipped");
    const outcome = await sink.wake({ type: "wake", agentId: "a1", reason: "x" }, ctx);
    assert.equal(typeof outcome === "string" ? outcome : outcome.outcome, "skipped");
    assert.deepEqual(
      await sink.requestLaunch({ type: "request-launch", agentId: "a1", reason: "x" }, ctx),
      { outcome: "skipped", detail: "unknown-agent" }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [reason, variant] of Object.entries({
  "no-h2a-instance": {
    now: 10_000_000,
    createLoop: (root) => createObjectiveLoop(root, {
      name: "t",
      goal: "g",
      agents: [{ id: "a1", role: "impl", placement: "local", status: "running" }]
    }),
    expectedDetail: "no-h2a-instance"
  },
  "max-relaunches": {
    now: 10_000_000,
    createLoop: (root) => createObjectiveLoop(root, {
      name: "t",
      goal: "g",
      policy: { maxRelaunches: 0 },
      agents: [{ id: "a1", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" }]
    }),
    expectedDetail: "max-relaunches"
  },
  cooldown: {
    now: 10_000_000,
    createLoop: (root, now) => {
      const loop = createObjectiveLoop(root, {
        name: "t",
        goal: "g",
        agents: [{ id: "a1", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" }]
      });
      appendLoopEvent(root, {
        type: "loop.action.applied",
        loopId: loop.id,
        at: new Date(now - 120_000).toISOString(),
        payload: { action: "wake", key: "wake:a1" }
      });
      return loop;
    },
    expectedDetail: "cooldown"
  },
  "no-fresh-tmux-session": {
    now: 10_000_000,
    createLoop: (root) => createObjectiveLoop(root, {
      name: "t",
      goal: "g",
      agents: [{ id: "a1", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" }]
    }),
    expectedDetail: "no-fresh-tmux-session"
  }
})) {
  test(`wake skip (${reason}) : loop.action.skipped contient le detail`, async () => {
    const root = freshRoot();
    try {
      const loop = variant.createLoop(root, variant.now);
      const report = await executePlan(
        root,
        loop.id,
        {
          loopId: loop.id,
          degraded: false,
          outcome: "waiting-agent",
          close: false,
          actions: [{ type: "wake", agentId: "a1", reason: "presence live" }],
          reasons: []
        },
        buildActionSink(),
        variant.now
      );
      const skipped = listLoopEvents(root, loop.id).filter((event) => event.type === "loop.action.skipped").at(-1);
      assert.equal(report.results[0].outcome, "skipped");
      assert.equal(skipped?.payload?.detail, variant.expectedDetail);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
