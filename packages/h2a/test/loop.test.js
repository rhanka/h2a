import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createObjectiveLoop, listLoopEvents, listObjectiveLoops, readObjectiveLoop, runCli } from "../dist/index.js";

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
