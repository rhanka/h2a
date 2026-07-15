import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildActionSink,
  priorRelaunchAttemptsByAgent,
  readPresenceSnapshot,
  resolveDeclaredWorkStatus
} from "../dist/runtime/loop/engine/adapters.js";
import { planLoopTick } from "../dist/runtime/loop/engine/decision.js";
import { createObjectiveLoop, listLoopEvents, updateObjectiveLoopStatus } from "../dist/runtime/loop/index.js";
import { executePlan } from "../dist/runtime/loop/engine/execute.js";
import { writePresence } from "../dist/runtime/local-files/presence.js";
import { recordStop, markDrumbeatTerminal } from "../dist/runtime/drumbeat/registry.js";

const NOW = Date.parse("2026-07-09T12:00:00.000Z");
const MIN = 60_000;

function freshRoot() {
  return join(mkdtempSync(join(tmpdir(), "h2a-wsmerge-")), ".h2a");
}

function writeIdleSession(root, instance, { host = "claude", lastActivityMinAgo = 2, workStatus } = {}) {
  writePresence(root, {
    sessionId: `sess:${instance}`,
    instance,
    host,
    pid: 4242,
    startedAt: new Date(NOW - 30 * MIN).toISOString(),
    heartbeatAt: new Date(NOW).toISOString(),
    ...(lastActivityMinAgo !== undefined
      ? { lastMcpActivityAt: new Date(NOW - lastActivityMinAgo * MIN).toISOString() }
      : {}),
    ...(workStatus ? { workStatus } : {}),
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    launchContext: { cwd: "/repo", command: `h2a mcp-serve --host ${host}`, tmux: { session: "", pane: "%7" } }
  });
}

function activeLoop(root, instance, host = "claude") {
  const loop = createObjectiveLoop(
    root,
    {
      goal: "ship the thing",
      agents: [
        { id: instance, host, role: "impl", placement: "interactive-local", status: "running", h2aInstance: instance }
      ]
    },
    NOW
  );
  updateObjectiveLoopStatus(root, loop.id, "active", { now: NOW });
  return loop;
}

function tickInput(root, loop) {
  return {
    loop: JSON.parse(JSON.stringify(loop)), // read the persisted shape via a plain clone
    agents: { degraded: true, agents: [] },
    presence: readPresenceSnapshot(root, NOW),
    refs: { degraded: false, refs: [] },
    inbox: { pendingDecisions: [] },
    now: NOW
  };
}

// --- resolveDeclaredWorkStatus (PURE) ----------------------------------------

test("resolveDeclaredWorkStatus: no entry → undefined", () => {
  assert.equal(resolveDeclaredWorkStatus(undefined, NOW), undefined);
});

test("resolveDeclaredWorkStatus: honored when no activity since the stop", () => {
  const entry = { instance: "i", workStatus: "paused", stoppedAt: new Date(NOW - MIN).toISOString(), relanceCount: 0 };
  assert.equal(resolveDeclaredWorkStatus(entry, NOW - 2 * MIN), "paused"); // activity older than stop
  assert.equal(resolveDeclaredWorkStatus(entry, undefined), "paused"); // no activity signal
});

test("resolveDeclaredWorkStatus: SUPERSEDED by fresher MCP activity → undefined (anti over-wake)", () => {
  const entry = { instance: "i", workStatus: "paused", stoppedAt: new Date(NOW - 5 * MIN).toISOString(), relanceCount: 0 };
  assert.equal(resolveDeclaredWorkStatus(entry, NOW), undefined); // resumed & active after the stop
});

test("resolveDeclaredWorkStatus: terminal (escalated/rerouted) entry → undefined", () => {
  const entry = {
    instance: "i",
    workStatus: "paused",
    stoppedAt: new Date(NOW - MIN).toISOString(),
    relanceCount: 3,
    terminal: { action: "escalate", at: new Date(NOW).toISOString() }
  };
  assert.equal(resolveDeclaredWorkStatus(entry, undefined), undefined);
});

test("resolveDeclaredWorkStatus: unparseable stoppedAt → undefined", () => {
  const entry = { instance: "i", workStatus: "paused", stoppedAt: "not-a-date", relanceCount: 0 };
  assert.equal(resolveDeclaredWorkStatus(entry, undefined), undefined);
});

// --- readPresenceSnapshot folds the drumbeat registry ------------------------

test("readPresenceSnapshot: folds drumbeat 'paused' into presence.workStatus (dead R3 branch revived)", () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-1";
    writeIdleSession(root, instance, { lastActivityMinAgo: 2 });
    recordStop(root, { instance, workStatus: "paused" }, NOW - MIN); // stop hook 1min ago
    const view = readPresenceSnapshot(root, NOW).byInstance.get(instance);
    assert.equal(view.workStatus, "paused");
    assert.equal(view.hasTmuxLaunchContext, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readPresenceSnapshot: presence's OWN workStatus wins over the registry", () => {
  const root = freshRoot();
  try {
    const instance = "codex:conv-1";
    writeIdleSession(root, instance, { host: "codex", lastActivityMinAgo: 2, workStatus: "working" });
    recordStop(root, { instance, workStatus: "paused" }, NOW - MIN);
    const view = readPresenceSnapshot(root, NOW).byInstance.get(instance);
    assert.equal(view.workStatus, "working");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readPresenceSnapshot: registry superseded by fresh activity → no workStatus", () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-1";
    writeIdleSession(root, instance, { lastActivityMinAgo: 0 }); // active right now
    recordStop(root, { instance, workStatus: "paused" }, NOW - 5 * MIN); // stopped 5min ago
    const view = readPresenceSnapshot(root, NOW).byInstance.get(instance);
    assert.equal(view.workStatus, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- End-to-end decision: the tick now emits a wake for a stopped agent ------

for (const host of ["claude", "codex"]) {
  test(`planLoopTick: drumbeat 'paused' agent (${host}) → WAKE emitted (relance like /loop)`, () => {
    const root = freshRoot();
    try {
      const instance = `${host}:conv-1`;
      const loop = activeLoop(root, instance, host);
      writeIdleSession(root, instance, { host, lastActivityMinAgo: 2 });
      recordStop(root, { instance, workStatus: "paused" }, NOW - MIN);
      const plan = planLoopTick(tickInput(root, loop));
      assert.ok(plan.actions.some((a) => a.type === "wake"), `expected a wake action, got ${JSON.stringify(plan.actions)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("planLoopTick: BEFORE the fix's signal (no workStatus, recent activity) → no wake (R3 gate holds)", () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-1";
    const loop = activeLoop(root, instance);
    writeIdleSession(root, instance, { lastActivityMinAgo: 1 }); // just finished, no drumbeat entry
    const plan = planLoopTick(tickInput(root, loop));
    assert.ok(!plan.actions.some((a) => a.type === "wake"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planLoopTick: drumbeat 'working' → never a wake target", () => {
  const root = freshRoot();
  try {
    const instance = "codex:conv-1";
    const loop = activeLoop(root, instance, "codex");
    writeIdleSession(root, instance, { host: "codex", lastActivityMinAgo: 2 });
    recordStop(root, { instance, workStatus: "working" }, NOW - MIN);
    const plan = planLoopTick(tickInput(root, loop));
    assert.ok(!plan.actions.some((a) => a.type === "wake"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planLoopTick: terminal drumbeat entry (escalated) → not re-woken", () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-1";
    const loop = activeLoop(root, instance);
    writeIdleSession(root, instance, { lastActivityMinAgo: 2 });
    recordStop(root, { instance, workStatus: "paused" }, NOW - MIN);
    markDrumbeatTerminal(root, instance, "escalate", NOW);
    const plan = planLoopTick(tickInput(root, loop));
    assert.ok(!plan.actions.some((a) => a.type === "wake"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Transport seam: wake glue drives an INJECTED driver (no real tmux) ------

test("buildActionSink({driver}).wake: drives the fake driver with the tagged line + tmux ctx → done", async () => {
  const root = freshRoot();
  try {
    const instance = "codex:conv-1";
    const loop = activeLoop(root, instance, "codex");
    writeIdleSession(root, instance, { host: "codex", lastActivityMinAgo: 2 });
    const calls = [];
    const fakeDriver = { drive: (req) => { calls.push(req); return true; } };
    const sink = buildActionSink({ driver: fakeDriver });
    const outcome = await sink.wake({ type: "wake", agentId: instance, reason: "test" }, { root, loopId: loop.id, now: NOW });
    assert.equal(outcome, "done");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, instance);
    assert.match(calls[0].instructionLine, /\[h2a-wake reason=loop /);
    assert.equal(calls[0].launchContext.tmux.pane, "%7");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildActionSink({driver}).wake: driver defers (human active) → deferred, no budget consumed", async () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-1";
    const loop = activeLoop(root, instance);
    writeIdleSession(root, instance, { lastActivityMinAgo: 2 });
    const fakeDriver = { drive: () => false }; // human-typing guard deferred
    const sink = buildActionSink({ driver: fakeDriver });
    const outcome = await sink.wake({ type: "wake", agentId: instance, reason: "test" }, { root, loopId: loop.id, now: NOW });
    assert.equal(outcome, "deferred");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildActionSink({wakeDriver}).wake: tmux injection failure → failed and consumes budget", async () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-failed";
    const loop = activeLoop(root, instance);
    writeIdleSession(root, instance, { lastActivityMinAgo: 2 });
    const sink = buildActionSink({ wakeDriver: { drive: () => "failed" } });
    const report = await executePlan(
      root,
      loop.id,
      {
        loopId: loop.id,
        degraded: false,
        outcome: "waiting-agent",
        close: false,
        actions: [{ type: "wake", agentId: instance, reason: "test" }],
        reasons: []
      },
      sink,
      NOW
    );
    assert.equal(report.results[0].outcome, "failed");
    assert.deepEqual(
      priorRelaunchAttemptsByAgent(listLoopEvents(root, loop.id)).get(instance),
      { count: 1, latestAt: NOW }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("localTmuxLoopWakeDriver distinguishes human defer from tmux send failure", async () => {
  const { localTmuxLoopWakeDriver } = await import("../dist/runtime/loop/engine/adapters.js");
  const request = {
    to: "codex:test",
    instructionLine: "resume",
    launchContext: { cwd: "/repo", command: "codex", tmux: { session: "s", pane: "%7" } }
  };
  const humanActive = localTmuxLoopWakeDriver({
    runtime: {
      capture: (_file, args) => args[0] === "display-message" ? "s\n" : `${Math.floor(Date.now() / 1000)}\n`,
      run: () => { throw new Error("must not send while human active"); }
    }
  });
  assert.equal(await humanActive.drive(request), "deferred-human");

  const failedSend = localTmuxLoopWakeDriver({
    runtime: { capture: () => undefined, run: () => false }
  });
  assert.equal(await failedSend.drive(request), "failed");
});

test("buildActionSink({driver}).wake: no fresh tmux session → skipped, driver untouched", async () => {
  const root = freshRoot();
  try {
    const instance = "claude:conv-1";
    const loop = activeLoop(root, instance);
    // no presence written → no fresh tmux session
    let called = false;
    const fakeDriver = { drive: () => { called = true; return true; } };
    const sink = buildActionSink({ driver: fakeDriver });
    const outcome = await sink.wake({ type: "wake", agentId: instance, reason: "test" }, { root, loopId: loop.id, now: NOW });
    assert.equal(outcome, "skipped");
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
