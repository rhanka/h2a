import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  H2A_RUN_API_VERSION,
  buildActionSink,
  buildLoopLaunchInvocation,
  executeLoopLaunchWithSpawn,
  loopLaunchWorkspaceAllowed,
  planLaunchTarget,
  priorLaunchByAgent,
  priorRelaunchAttemptsByAgent
} from "../dist/runtime/loop/engine/adapters.js";
import {
  createObjectiveLoop,
  listLoopEvents,
  validateLoopLaunchSpec
} from "../dist/runtime/loop/index.js";
import { executePlan } from "../dist/runtime/loop/engine/execute.js";
import { durableTestDir } from "./durable-test-dir.js";

function workspace() {
  return durableTestDir("h2a-loop-launch-");
}

function launchSpec(dir, overrides = {}) {
  return {
    profile: "codex",
    workspace: dir,
    prompt: "Join agent-1 and resume the objective",
    model: "gpt-5.6-terra",
    effort: "xhigh",
    name: "loop-agent-1",
    gateway: "off",
    ...overrides
  };
}

function runtimeResult(spec, overrides = {}) {
  return {
    kind: "h2a.run.result",
    version: 1,
    apiVersion: H2A_RUN_API_VERSION,
    runtimeVersion: "0.85.16",
    ok: true,
    state: "started",
    session: {
      id: spec.name,
      tmuxSession: `remote-${spec.name}`,
      pane: "%7",
      profile: spec.profile,
      workspace: spec.workspace,
      mode: "interactive",
      background: true,
      gateway: "direct",
      h2aSidecar: true,
      pid: 4242
    },
    attach: { command: "h2a", args: ["attach", spec.name] },
    ...overrides
  };
}

test("launch validation rejects missing context, unsupported profiles and unsafe names", () => {
  const dir = workspace();
  try {
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), model: undefined }), /model/);
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), profile: "gemini" }), /claude or codex/);
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), name: "unsafe/name" }), /name/);
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), workspace: "relative" }), /absolute/);
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), workspace: tmpdir() }), /durable|\/tmp/);
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), surprise: true }), /unknown field/);
    assert.throws(() => validateLoopLaunchSpec({ ...launchSpec(dir), gateway: "required" }), /only for claude/);
    assert.equal(
      validateLoopLaunchSpec({ ...launchSpec(dir), profile: "claude", gateway: "required" }).gateway,
      "required"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical loop launch uses argv plus stdin, sidecar, background JSON and no shell", () => {
  const dir = workspace();
  try {
    const spec = validateLoopLaunchSpec(launchSpec(dir));
    const invocation = buildLoopLaunchInvocation(spec, "/opt/h2a/bin.js");
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.cwd, dir);
    assert.equal(invocation.input, spec.prompt);
    assert.deepEqual(invocation.args, [
      "/opt/h2a/bin.js", "run", "codex", dir,
      "--no-attach", "--background", "--json", "--name", "loop-agent-1",
      "--prompt-stdin", "--h2a", "--no-gw", "--model", "gpt-5.6-terra",
      "--effort", "xhigh"
    ]);
    assert.equal(invocation.args.includes(spec.prompt), false);

    let observed;
    const result = executeLoopLaunchWithSpawn(spec, (command, args, options) => {
      observed = { command, args, options };
      return { status: 0, stdout: JSON.stringify(runtimeResult(spec)), stderr: "" };
    });
    assert.equal(result.ok, true);
    assert.equal(observed.options.shell, false);
    assert.equal(observed.options.input, spec.prompt);
    assert.equal(observed.args.includes(spec.prompt), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude required gateway is explicit in argv and must be proven by the result", () => {
  const dir = workspace();
  try {
    const spec = validateLoopLaunchSpec(launchSpec(dir, { profile: "claude", gateway: "required" }));
    assert.equal(buildLoopLaunchInvocation(spec).args.includes("--gw"), true);

    const accepted = executeLoopLaunchWithSpawn(spec, () => ({
      status: 0,
      stdout: JSON.stringify(runtimeResult(spec, {
        session: { ...runtimeResult(spec).session, gateway: "gateway" }
      })),
      stderr: ""
    }));
    assert.equal(accepted.ok, true);

    const refused = executeLoopLaunchWithSpawn(spec, () => ({
      status: 0,
      stdout: JSON.stringify(runtimeResult(spec)),
      stderr: ""
    }));
    assert.equal(refused.ok, false);
    assert.equal(refused.retrySafe, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime skew, duplicate names and timeouts fail closed", () => {
  const dir = workspace();
  try {
    const spec = validateLoopLaunchSpec(launchSpec(dir));
    const skew = executeLoopLaunchWithSpawn(spec, () => ({
      status: 0,
      stdout: JSON.stringify(runtimeResult(spec, { apiVersion: "h2a.run/v999" })),
      stderr: ""
    }));
    assert.deepEqual(skew, {
      ok: false,
      detail: "incompatible h2a runtime: invalid h2a.run.result contract",
      retrySafe: false
    });

    for (const overrides of [
      { runtimeVersion: "not-a-semver" },
      { session: { ...runtimeResult(spec).session, pid: 0 } },
      { session: { ...runtimeResult(spec).session, pane: undefined } },
      { session: { ...runtimeResult(spec).session, gateway: "gateway" } },
      { attach: null },
      { attach: { command: "h2a", args: ["attach", "another-name"] } }
    ]) {
      const invalid = executeLoopLaunchWithSpawn(spec, () => ({
        status: 0,
        stdout: JSON.stringify(runtimeResult(spec, overrides)),
        stderr: ""
      }));
      assert.equal(invalid.ok, false);
      assert.equal(invalid.retrySafe, false);
      assert.match(invalid.detail, /invalid h2a\.run\.result contract/);
    }

    const duplicate = executeLoopLaunchWithSpawn(spec, () => ({
      status: 1,
      stdout: "",
      stderr: "local session loop-agent-1 already exists"
    }));
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.retrySafe, false);

    const timeout = new Error("timed out");
    timeout.code = "ETIMEDOUT";
    const unknown = executeLoopLaunchWithSpawn(spec, () => ({
      status: null,
      stdout: "",
      stderr: "",
      error: timeout
    }));
    assert.equal(unknown.ok, false);
    assert.equal(unknown.retrySafe, false);
    assert.match(unknown.detail, /status unknown/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("request-launch is fail-closed without a spec and invokes an injected launcher with one", async () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const unconfigured = createObjectiveLoop(root, {
      id: "plain",
      goal: "ship",
      agents: [{ id: "a1", host: "codex", role: "builder", placement: "local", status: "running" }]
    });
    let calls = 0;
    const sink = buildActionSink({ launcher: { launch: () => { calls += 1; return { ok: true }; } } });
    assert.deepEqual(
      await sink.requestLaunch({ type: "request-launch", agentId: "a1", reason: "dead" }, { root, loopId: unconfigured.id, now: 1 }),
      { outcome: "skipped", detail: "no-launch-spec" }
    );
    assert.equal(calls, 0);

    const spec = validateLoopLaunchSpec(launchSpec(dir));
    const configured = createObjectiveLoop(root, {
      id: "configured",
      goal: "ship",
      agents: [{ id: "a1", host: "codex", role: "builder", placement: "local", status: "running", launch: spec }]
    });
    const launchCalls = [];
    const launchSink = buildActionSink({
      launcher: { launch: (value) => { launchCalls.push(value); return { ok: true, detail: "started" }; } }
    });
    const result = await launchSink.requestLaunch(
      { type: "request-launch", agentId: "a1", reason: "dead" },
      { root, loopId: configured.id, now: 1 }
    );
    assert.deepEqual(result, { outcome: "done", detail: "started" });
    assert.deepEqual(launchCalls, [spec]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("action boundary rejects out-of-scope workspaces and persisted host/profile skew", async () => {
  const dir = workspace();
  const outside = mkdtempSync(join(dirname(process.cwd()), "h2a-loop-outside-"));
  const root = join(dir, ".h2a");
  try {
    const outsideSpec = validateLoopLaunchSpec(launchSpec(outside));
    const loop = createObjectiveLoop(root, {
      id: "bounded-workspace",
      goal: "ship",
      agents: [{ id: "a1", host: "codex", role: "builder", placement: "local", status: "running", launch: outsideSpec }]
    });
    assert.equal(loopLaunchWorkspaceAllowed(loop, outsideSpec, process.cwd()), false);
    let calls = 0;
    const sink = buildActionSink({
      controllerRoot: process.cwd(),
      launcher: { launch: () => { calls += 1; return { ok: true }; } }
    });
    assert.deepEqual(
      await sink.requestLaunch(
        { type: "request-launch", agentId: "a1", reason: "dead" },
        { root, loopId: loop.id, now: 1 }
      ),
      { outcome: "skipped", detail: "launch workspace is outside the controller and declared repo boundaries" }
    );
    assert.equal(calls, 0);

    const statePath = join(root, "loops", loop.id, "state.json");
    const forged = JSON.parse(readFileSync(statePath, "utf8"));
    forged.agents[0].host = "claude";
    writeFileSync(statePath, `${JSON.stringify(forged, null, 2)}\n`, "utf8");
    assert.deepEqual(
      await sink.requestLaunch(
        { type: "request-launch", agentId: "a1", reason: "dead" },
        { root, loopId: loop.id, now: 1 }
      ),
      { outcome: "skipped", detail: "launch profile differs from persisted agent host" }
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("applied and failed launches consume durable budget; deferred/skipped do not", async () => {
  const dir = workspace();
  const root = join(dir, ".h2a");
  try {
    const spec = validateLoopLaunchSpec(launchSpec(dir));
    const loop = createObjectiveLoop(root, {
      id: "bounded",
      goal: "ship",
      policy: { maxRelaunches: 2 },
      agents: [{ id: "a1", host: "codex", role: "builder", placement: "local", status: "running", launch: spec }]
    });
    const plan = {
      loopId: loop.id,
      degraded: false,
      outcome: "waiting-agent",
      close: false,
      actions: [{ type: "request-launch", agentId: "a1", reason: "dead" }],
      reasons: []
    };
    await executePlan(root, loop.id, plan, {
      close: async () => "skipped",
      wake: async () => "skipped",
      routeDecision: async () => "skipped",
      requestLaunch: async () => ({ outcome: "failed", detail: "timeout", retrySafe: false })
    }, 1_000);
    const history = priorLaunchByAgent(listLoopEvents(root, loop.id)).get("a1");
    assert.deepEqual(history, { count: 1, latestAt: 1_000, retryForbidden: true });
    assert.deepEqual(
      planLaunchTarget({ loop, agentId: "a1", priorCount: 1, priorLatestAt: 1_000, retryForbidden: true, now: 1_000_000 }),
      { kind: "skip", reason: "prior-launch-state-unknown" }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wake and launch share one per-agent cooldown and maxRelaunches budget", () => {
  const dir = workspace();
  try {
    const spec = validateLoopLaunchSpec(launchSpec(dir));
    const loop = {
      id: "shared-budget",
      agents: [{ id: "a1", host: "codex", role: "builder", placement: "local", status: "running", launch: spec }],
      policy: { tickMs: 60_000, maxRelaunches: 1 }
    };
    const history = priorRelaunchAttemptsByAgent([
      { type: "loop.action.applied", at: "2026-07-14T10:00:00.000Z", payload: { action: "wake", key: "wake:a1" } },
      { type: "loop.action.deferred", at: "2026-07-14T10:01:00.000Z", payload: { action: "request-launch", key: "request-launch:a1" } }
    ]).get("a1");
    assert.deepEqual(history, { count: 1, latestAt: Date.parse("2026-07-14T10:00:00.000Z") });
    assert.deepEqual(
      planLaunchTarget({
        loop,
        agentId: "a1",
        priorCount: history.count,
        priorLatestAt: history.latestAt,
        now: Date.parse("2026-07-14T11:00:00.000Z")
      }),
      { kind: "skip", reason: "max-relaunches" }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
