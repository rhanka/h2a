import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLoopExecutorLease,
  createObjectiveLoop,
  detectLocalLaunchContext,
  listAutoTickLoops,
  listLoopEvents,
  readExecutorHeartbeat,
  readObjectiveLoop,
  runSupervisorBeat,
  updatePresence
} from "../dist/index.js";
import {
  PR1_NATIVE_PTY_TRANSPORT_SEAM,
  buildActionSink,
  readPresenceSnapshot
} from "../dist/runtime/loop/engine/adapters.js";
import { planLoopTick } from "../dist/runtime/loop/engine/decision.js";
import { executePlan } from "../dist/runtime/loop/engine/execute.js";
import { runTick } from "../dist/runtime/loop/engine/tick.js";
import {
  handleLoopCreate,
  handleLoopDone,
  handleLoopJoin,
  handleLoopReport,
  handleLoopStatus
} from "../dist/runtime/mcp/handlers.js";
import { SessionRegistry } from "../dist/runtime/mcp/sessions.js";

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-pty-loop-"));
  return { dir, root: join(dir, ".h2a") };
}

function nativeContext(session) {
  return {
    cwd: "/workspace",
    command: "h2a mcp-serve",
    nativePty: { session }
  };
}

function openPausedNativeSession(registry, root, { sessionId, instance, host, terminal }) {
  registry.open({
    sessionId,
    instance,
    host,
    launchContext: nativeContext(terminal)
  });
  const updated = updatePresence(root, sessionId, { workStatus: "paused" });
  assert.equal(updated?.workStatus, "paused");
}

test("native host publishes the owning PTY to its MCP sidecar environment", () => {
  const source = readFileSync(
    new URL("../../h2a-runtime/src/native-host.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("export function startNativeH2aSidecar(");
  const end = source.indexOf("\nexport ", start + 1);
  assert.notEqual(start, -1, "native sidecar function exists");
  const body = source.slice(start, end === -1 ? source.length : end);
  assert.match(body, /env\["H2A_NATIVE_PTY_SESSION"\]\s*=\s*name/);
});

test("native MCP sidecar context identifies its owning PTY even with inherited tmux", () => {
  assert.deepEqual(
    detectLocalLaunchContext(
      {
        H2A_NATIVE_PTY_SESSION: "native-worker",
        TMUX: "/tmp/tmux-1000/default,1,0",
        TMUX_PANE: "%4"
      },
      "/workspace"
    ),
    nativeContext("native-worker")
  );
});

test("tick decision schedules a native-PTY wake for a paused live participant", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  const plan = planLoopTick({
    loop: {
      id: "pty-loop",
      goal: "finish the objective",
      status: "running",
      refs: [],
      agents: [{
        id: "worker",
        host: "codex",
        role: "participant",
        placement: "local",
        status: "running",
        h2aInstance: "codex:worker"
      }],
      policy: {
        tickMs: 60_000,
        idleMs: 900_000,
        maxRelaunches: 3,
        requireHumanTypingGuard: true,
        autoTick: true,
        closeWhenRefsSatisfied: false,
        successCriteria: "explicit-done",
        decisionGatePolicy: "all-go-or-waived"
      }
    },
    agents: { degraded: true, agents: [] },
    presence: {
      byInstance: new Map([["codex:worker", {
        instance: "codex:worker",
        liveSession: true,
        wakeTransport: "native-pty",
        workStatus: "paused",
        lastActivityAtMs: now
      }]])
    },
    refs: { degraded: false, refs: [] },
    inbox: { pendingDecisions: [] },
    now
  });

  const wake = plan.actions.find((action) => action.type === "wake");
  assert.equal(wake?.agentId, "worker");
  assert.equal(wake?.wakeTransport, "native-pty");
});

test("native PTY create, join, report, supervised tick, and done preserve lifecycle state", async () => {
  const { dir, root } = freshRoot();
  const registry = new SessionRegistry(root, { autoHeartbeat: false });
  try {
    openPausedNativeSession(registry, root, {
      sessionId: "sess-conductor",
      instance: "codex:conductor",
      host: "codex",
      terminal: "native-conductor"
    });
    openPausedNativeSession(registry, root, {
      sessionId: "sess-worker",
      instance: "claude:worker",
      host: "claude",
      terminal: "native-worker"
    });

    const created = handleLoopCreate(root, {
      id: "native-cycle",
      goal: "complete the native PTY lifecycle",
      instance: "codex:conductor",
      agentId: "conductor",
      autoTick: true
    });
    assert.equal(created.kind, "loop-created");
    assert.equal(created.loop.status, "created");
    assert.equal(created.loop.agents[0].host, "codex", "host comes from live presence");

    const joined = handleLoopJoin(root, {
      loopId: "native-cycle",
      instance: "claude:worker",
      agentId: "worker"
    });
    assert.equal(joined.kind, "loop-joined");
    assert.deepEqual(
      joined.loop.agents.map((agent) => [agent.id, agent.host, agent.h2aInstance]),
      [
        ["conductor", "codex", "codex:conductor"],
        ["worker", "claude", "claude:worker"]
      ]
    );

    const reported = handleLoopReport(root, {
      loopId: "native-cycle",
      instance: "claude:worker",
      note: "source checks are running"
    });
    assert.equal(reported.kind, "loop-reported");
    assert.equal(
      listLoopEvents(root, "native-cycle").filter((event) => event.type === "loop.agent-report").length,
      1
    );

    const held = acquireLoopExecutorLease(root, "native-cycle");
    assert.ok(held, "a competing executor can own the per-loop lease");
    const lockedBeat = await runSupervisorBeat(root, { env: {} });
    assert.deepEqual(lockedBeat.skippedLocked, ["native-cycle"]);
    assert.equal(readExecutorHeartbeat(root, "native-cycle"), null);
    held.release();

    const beat = await runSupervisorBeat(root, { env: {} });
    assert.deepEqual(beat.ticked, ["native-cycle"]);
    assert.ok(readExecutorHeartbeat(root, "native-cycle"), "successful tick stamps attendance");
    const reacquired = acquireLoopExecutorLease(root, "native-cycle");
    assert.ok(reacquired, "supervisor releases the lease after its tick");
    reacquired.release();

    const status = handleLoopStatus(root, { loopId: "native-cycle" });
    assert.equal(status.kind, "loop-status");
    assert.deepEqual(status.lastTick.actions, ["wake", "wake"]);
    const seamEvents = listLoopEvents(root, "native-cycle").filter(
      (event) =>
        event.type === "loop.action.skipped" &&
        event.payload?.detail === PR1_NATIVE_PTY_TRANSPORT_SEAM
    );
    assert.equal(seamEvents.length, 2, "delivery dependency is visible, not silently successful");

    const done = handleLoopDone(root, {
      loopId: "native-cycle",
      instance: "claude:worker",
      note: "cycle complete"
    });
    assert.equal(done.kind, "loop-done-declared");
    assert.equal(done.loop.status, "done");
    assert.equal(readObjectiveLoop(root, "native-cycle").status, "done");
    assert.equal(
      listLoopEvents(root, "native-cycle").filter((event) => event.type === "loop.closed").length,
      1
    );
    assert.deepEqual(listAutoTickLoops(root, {}), [], "done loop leaves supervisor registry");

    const terminalTick = await runTick(root, "native-cycle", { execute: true });
    assert.deepEqual(terminalTick.plan.actions, [], "terminal loop cannot be woken");
    const lateReport = handleLoopReport(root, {
      loopId: "native-cycle",
      instance: "claude:worker",
      note: "too late"
    });
    assert.match(lateReport.error, /terminal/);
  } finally {
    registry.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native wake handoff uses the stable PTY target through an injected transport seam", async () => {
  const { dir, root } = freshRoot();
  const registry = new SessionRegistry(root, { autoHeartbeat: false });
  try {
    openPausedNativeSession(registry, root, {
      sessionId: "sess-handoff",
      instance: "codex:worker",
      host: "codex",
      terminal: "native-worker"
    });
    const loop = createObjectiveLoop(root, {
      id: "native-handoff",
      goal: "resume work",
      agents: [{
        id: "worker",
        host: "codex",
        role: "participant",
        placement: "local",
        status: "running",
        h2aInstance: "codex:worker"
      }]
    });
    const now = Date.now();
    const plan = planLoopTick({
      loop,
      agents: { degraded: true, agents: [] },
      presence: readPresenceSnapshot(root, now),
      refs: { degraded: false, refs: [] },
      inbox: { pendingDecisions: [] },
      now
    });
    const requests = [];
    const report = await executePlan(
      root,
      loop.id,
      plan,
      buildActionSink({
        nativeWakeDriver: {
          drive(request) {
            requests.push(request);
            return "done";
          }
        }
      }),
      now
    );

    assert.equal(report.counts.done, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].to, "native-worker");
    assert.equal(requests[0].launchContext.nativePty.session, "native-worker");
    assert.equal(
      listLoopEvents(root, loop.id).filter((event) => event.type === "loop.action.applied").length,
      1
    );
  } finally {
    registry.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PTY participant done declaration retains refs and does not close the objective", () => {
  const { dir, root } = freshRoot();
  const registry = new SessionRegistry(root, { autoHeartbeat: false });
  try {
    openPausedNativeSession(registry, root, {
      sessionId: "sess-ref-worker",
      instance: "codex:worker",
      host: "codex",
      terminal: "native-ref-worker"
    });
    createObjectiveLoop(root, {
      id: "native-refs",
      goal: "finish tracked work",
      refs: [{
        system: "track",
        repoKey: "repo",
        workspace: "main",
        aggregateKind: "item",
        aggregateId: "ITEM-1",
        role: "target"
      }]
    });
    assert.equal(handleLoopJoin(root, {
      loopId: "native-refs",
      instance: "codex:worker",
      agentId: "worker"
    }).kind, "loop-joined");
    assert.equal(handleLoopReport(root, {
      loopId: "native-refs",
      instance: "codex:worker",
      note: "implementation complete"
    }).kind, "loop-reported");

    const declaration = handleLoopDone(root, {
      loopId: "native-refs",
      instance: "codex:worker",
      note: "agent work complete"
    });
    assert.equal(declaration.kind, "loop-done-declared");
    assert.equal(declaration.loop.status, "created", "refs remain the closure authority");
    assert.deepEqual(declaration.loop.refs.map((ref) => ref.aggregateId), ["ITEM-1"]);
    const events = listLoopEvents(root, "native-refs");
    assert.equal(events.filter((event) => event.type === "loop.done-declared").length, 1);
    assert.equal(events.filter((event) => event.type === "loop.closed").length, 0);
  } finally {
    registry.closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.todo("native PTY wake injection depends on PR-1 native-PTY transport; validated post-PR-1 merge");
