import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createObjectiveLoop, joinObjectiveLoop, listLoopEvents, listObjectiveLoops, readObjectiveLoop, runCli } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-loop-"));
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("createObjectiveLoop persists state, objective and event journal", () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(
      root,
      {
        id: "loop-test",
        name: "Loop test",
        goal: "Keep agents aligned with track",
        repos: [{ path: "/repo", role: "target" }],
        refs: [
          {
            system: "track",
            repoKey: "h2a",
            workspace: "ws:test",
            aggregateKind: "wp",
            aggregateId: "WP-1",
            role: "target"
          }
        ],
        agents: [
          {
            id: "agent-1",
            host: "claude",
            role: "conductor",
            placement: "local",
            status: "planned"
          }
        ]
      },
      1_800_000_000_000
    );

    assert.equal(loop.id, "loop-test");
    assert.equal(readObjectiveLoop(root, "loop-test").goal, "Keep agents aligned with track");
    assert.equal(listObjectiveLoops(root).length, 1);
    assert.deepEqual(
      listLoopEvents(root, "loop-test").map((event) => event.type),
      ["loop.created", "loop.track-linked", "loop.agent-added"]
    );
    assert.ok(existsSync(join(root, "loops", "loop-test", "objective.md")));
    assert.match(readFileSync(join(root, "loops", "loop-test", "objective.md"), "utf8"), /Keep agents aligned/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a loop create/status/agents/logs expose stable JSON shapes", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    const createStreams = captureStreams(dir);
    const rc = runCli(
      [
        "loop",
        "create",
        "--root",
        root,
        "--id",
        "loop-cli",
        "--name",
        "CLI loop",
        "--goal",
        "Coordinate remote agents",
        "--repo",
        "/repo:target",
        "--track",
        JSON.stringify({
          system: "track",
          repoKey: "h2a",
          workspace: "ws:test",
          aggregateKind: "wp",
          aggregateId: "WP-1",
          role: "target"
        }),
        "--agent",
        "codex:implementer:remote"
      ],
      createStreams
    );
    assert.equal(rc, 0, createStreams.stderrText);
    const created = JSON.parse(createStreams.stdoutText);
    assert.equal(created.status, "created");
    assert.equal(created.agents[0].host, "codex");

    const statusStreams = captureStreams(dir);
    assert.equal(runCli(["loop", "status", "loop-cli", "--root", root], statusStreams), 0);
    assert.equal(JSON.parse(statusStreams.stdoutText).id, "loop-cli");

    const agentsStreams = captureStreams(dir);
    assert.equal(runCli(["loop", "agents", "loop-cli", "--root", root], agentsStreams), 0);
    assert.ok(Array.isArray(JSON.parse(agentsStreams.stdoutText)));

    const logsStreams = captureStreams(dir);
    assert.equal(runCli(["loop", "logs", "loop-cli", "--root", root, "--agent", "implementer"], logsStreams), 0);
    const logs = JSON.parse(logsStreams.stdoutText);
    assert.equal(logs.agent.role, "implementer");
    assert.ok(logs.events.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop create --agent accepts every host adapter incl. hermes/opencode", () => {
  for (const host of ["hermes", "opencode", "agy"]) {
    const dir = freshRoot();
    const root = join(dir, ".h2a");
    try {
      const streams = captureStreams(dir);
      const rc = runCli(
        ["loop", "create", "--root", root, "--id", `loop-${host}`, "--goal", "x", "--agent", `${host}:implementer:local`],
        streams
      );
      assert.equal(rc, 0, streams.stderrText);
      assert.equal(JSON.parse(streams.stdoutText).agents[0].host, host);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("h2a loop join/report/done/stop append durable MVP events", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    const mk = captureStreams(dir);
    assert.equal(runCli(["loop", "create", "--root", root, "--id", "loop-pr1", "--goal", "Ship PR1"], mk), 0, mk.stderrText);

    const joinStreams = captureStreams(dir);
    assert.equal(runCli(["loop", "join", "loop-pr1", "--root", root, "--instance", "codex:h2a:abc", "--agent-id", "agent-a", "--role", "implementer"], joinStreams), 0, joinStreams.stderrText);
    assert.equal(JSON.parse(joinStreams.stdoutText).agents[0].id, "agent-a");

    const reportStreams = captureStreams(dir);
    assert.equal(runCli(["loop", "report", "loop-pr1", "--root", root, "--agent-id", "agent-a", "--note", "progress"], reportStreams), 0, reportStreams.stderrText);

    const doneStreams = captureStreams(dir);
    assert.equal(runCli(["loop", "done", "loop-pr1", "--root", root, "--agent-id", "agent-a", "--note", "done"], doneStreams), 0, doneStreams.stderrText);
    assert.equal(JSON.parse(doneStreams.stdoutText).status, "done");

    assert.deepEqual(
      listLoopEvents(root, "loop-pr1").map((e) => e.type),
      ["loop.created", "loop.agent-joined", "loop.agent-report", "loop.done-declared", "loop.closed"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop done --override-refs requires human confirmation", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    const mk = captureStreams(dir);
    assert.equal(runCli(["loop", "create", "--root", root, "--id", "loop-override", "--goal", "Ship", "--track", JSON.stringify({ system: "track", repoKey: "h2a", workspace: "ws:test", aggregateKind: "wp", aggregateId: "WP-1", role: "target" })], mk), 0, mk.stderrText);
    const denied = captureStreams(dir);
    assert.equal(runCli(["loop", "done", "loop-override", "--root", root, "--override-refs"], denied), 1);
    assert.match(denied.stderrText, /confirm-human-override/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop join fills a predeclared planned agent slot", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    const mk = captureStreams(dir);
    assert.equal(runCli(["loop", "create", "--root", root, "--id", "loop-planned", "--goal", "Ship", "--agent", "claude:reviewer:local"], mk), 0, mk.stderrText);
    const joined = captureStreams(dir);
    assert.equal(runCli(["loop", "join", "loop-planned", "--root", root, "--instance", "claude:h2a:live", "--agent-id", "agent-1", "--role", "reviewer"], joined), 0, joined.stderrText);
    const loop = JSON.parse(joined.stdoutText);
    assert.equal(loop.agents.length, 1);
    assert.equal(loop.agents[0].id, "agent-1");
    assert.equal(loop.agents[0].h2aInstance, "claude:h2a:live");
    assert.equal(loop.agents[0].status, "running");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop create/join expose strict launch specs through stdin JSON", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  const launch = {
    profile: "claude",
    workspace: dir,
    prompt: "Join and resume the objective loop",
    model: "claude-opus-4-8",
    effort: "xhigh",
    name: "objective-builder",
    gateway: "required"
  };
  try {
    const created = captureStreams(dir);
    created.stdinText = JSON.stringify(launch);
    assert.equal(runCli([
      "loop", "create", "--root", root, "--id", "loop-launch", "--goal", "Ship",
      "--agent", "claude:builder:local", "--launch-stdin"
    ], created), 0, created.stderrText);
    assert.deepEqual(JSON.parse(created.stdoutText).agents[0].launch, launch);

    const joined = captureStreams(dir);
    joined.stdinText = JSON.stringify(launch);
    assert.equal(runCli([
      "loop", "join", "loop-launch", "--root", root,
      "--instance", "claude:h2a:live", "--agent-id", "agent-1",
      "--role", "builder", "--launch-stdin"
    ], joined), 0, joined.stderrText);
    assert.deepEqual(JSON.parse(joined.stdoutText).agents[0].launch, launch);

    const unsafe = captureStreams(dir);
    unsafe.stdinText = JSON.stringify({ ...launch, name: "unsafe/name" });
    assert.notEqual(runCli([
      "loop", "join", "loop-launch", "--root", root,
      "--instance", "claude:h2a:other", "--agent-id", "other",
      "--launch-stdin"
    ], unsafe), 0);
    assert.match(unsafe.stderrText, /launch name/);

    const argvPrompt = captureStreams(dir);
    assert.notEqual(runCli([
      "loop", "join", "loop-launch", "--root", root,
      "--instance", "claude:h2a:nope", "--agent-id", "nope",
      "--launch", "{}"
    ], argvPrompt), 0);
    assert.match(argvPrompt.stderrText, /prompts must not be passed in argv/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-join refuses a launch profile incompatible with the enrolled host", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    createObjectiveLoop(root, {
      id: "profile-mismatch",
      goal: "Ship",
      agents: [{
        id: "agent-1",
        host: "claude",
        role: "builder",
        placement: "local",
        status: "running",
        h2aInstance: "claude:h2a:live"
      }]
    });
    assert.throws(() => joinObjectiveLoop(root, "profile-mismatch", {
      instance: "claude:h2a:live",
      agentId: "agent-1",
      launch: {
        profile: "codex",
        workspace: dir,
        prompt: "resume",
        model: "gpt-5.6-terra",
        name: "mismatch"
      }
    }), /host differs from launch profile/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
