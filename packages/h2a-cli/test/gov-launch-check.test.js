/**
 * Tests for Governance D3 — Conductor Launch Check (DRY-RUN).
 *
 * Scenarios:
 * 1. Pure function `recommendConductorLaunch`:
 *    a. conductorLive === true → recommendation = "none".
 *    b. conductorLive === false + stalledCount > 0 → recommendation = "launch" + suggestedHosts.
 *    c. conductorLive === false + stalledCount = 0 → recommendation = "none".
 *
 * 2. `conductorLaunchCheck` with injected runTrackActivity returning a stalled
 *    item + no live conductor → recommendation "launch", suggestedHosts present,
 *    conductorLive false.
 *
 * 3. `conductorLaunchCheck` with a live claimed conductor + injected stalled
 *    → recommendation "none" (conductor owns it).
 *
 * 4. `conductorLaunchCheck` with runTrackActivity returning undefined (track
 *    absent) → trackAvailable false, graceful, recommendation "none".
 *
 * 5. CLI smoke: `h2a conductor-launch-check --workspace <id> --root <root>`
 *    exits 0 and prints valid JSON (track absent in CI is fine).
 *
 * 6. MCP smoke: `h2a_conductor_launch_check { workspaceId }` returns a valid
 *    result object without an error field.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendConductorClaim,
  conductorLaunchCheck,
  createLocalStore,
  createMcpServer,
  recommendConductorLaunch,
  runCli,
  writePresence
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers (reused from gov-conductor-claim.test.js pattern)
// ---------------------------------------------------------------------------

function tmpRoot(prefix) {
  return join(mkdtempSync(join(tmpdir(), prefix)), ".h2a");
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) },
    cwd: () => cwd,
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

const WS_A = "ws:aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa";

function makeSession(overrides) {
  return {
    sessionId: `sess:${Math.random().toString(36).slice(2)}`,
    instance: "claude:test:aaaaaaaaaaaa",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...overrides
  };
}

function registerInstance(store, id, roles) {
  store.registerInstance({
    id,
    instance: id,
    roles: roles ?? ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date().toISOString()
  });
}

// ---------------------------------------------------------------------------
// 1a. recommendConductorLaunch: conductorLive === true → none
// ---------------------------------------------------------------------------
test("recommendConductorLaunch: conductorLive → recommendation=none", () => {
  const result = recommendConductorLaunch({ conductorLive: true, stalledCount: 5 });
  assert.equal(result.recommendation, "none");
  assert.ok(result.reason.includes("live conductor"));
  assert.equal(result.suggestedHosts, undefined);
});

// ---------------------------------------------------------------------------
// 1b. recommendConductorLaunch: !conductorLive + stalled > 0 → launch + suggestedHosts
// ---------------------------------------------------------------------------
test("recommendConductorLaunch: !conductorLive + stalled → recommendation=launch + suggestedHosts", () => {
  const result = recommendConductorLaunch({ conductorLive: false, stalledCount: 3 });
  assert.equal(result.recommendation, "launch");
  assert.ok(result.reason.includes("3 stalled"));
  assert.deepEqual(result.suggestedHosts, ["claude", "codex", "agy"]);
});

// ---------------------------------------------------------------------------
// 1c. recommendConductorLaunch: !conductorLive + 0 stalled → none
// ---------------------------------------------------------------------------
test("recommendConductorLaunch: !conductorLive + 0 stalled → recommendation=none", () => {
  const result = recommendConductorLaunch({ conductorLive: false, stalledCount: 0 });
  assert.equal(result.recommendation, "none");
  assert.ok(result.reason.includes("stalled"));
  assert.equal(result.suggestedHosts, undefined);
});

// ---------------------------------------------------------------------------
// 2. conductorLaunchCheck: stalled item injected + no live conductor → launch
// ---------------------------------------------------------------------------
test("conductorLaunchCheck: stalled work + no conductor → recommendation=launch", () => {
  const root = tmpRoot("h2a-lc-t2-");
  try {
    createLocalStore({ root });

    const stalledItem = { id: "task-001", title: "Blocked task", reason: "in-progress-idle", since: "2026-06-01T00:00:00.000Z" };
    const fakeTrack = (_wsId, _idleMs) => ({ pending: 1, stalled: [stalledItem] });

    const result = conductorLaunchCheck({
      root,
      workspaceId: WS_A,
      runTrackActivity: fakeTrack
    });

    assert.equal(result.workspaceId, WS_A);
    assert.equal(result.trackAvailable, true);
    assert.equal(result.conductorLive, false);
    assert.equal(result.conductor, null);
    assert.equal(result.pending, 1);
    assert.equal(result.stalled.length, 1);
    assert.equal(result.stalled[0].id, "task-001");
    assert.equal(result.recommendation, "launch");
    assert.ok(result.reason.includes("1 stalled"));
    assert.deepEqual(result.suggestedHosts, ["claude", "codex", "agy"]);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. conductorLaunchCheck: live claimed conductor + stalled → none
// ---------------------------------------------------------------------------
test("conductorLaunchCheck: live conductor claimed + stalled → recommendation=none", () => {
  const root = tmpRoot("h2a-lc-t3-");
  try {
    const store = createLocalStore({ root });
    const instance = "claude:self:cccccccccccc";
    registerInstance(store, instance, ["AGENTS"]);

    // Make the instance live in WS_A
    writePresence(root, makeSession({
      sessionId: "sess:self1",
      instance,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    // Claim conductor
    appendConductorClaim(root, {
      type: "claim",
      workspaceId: WS_A,
      instance,
      at: new Date().toISOString()
    });

    const stalledItem = { id: "task-002", title: "Another task", reason: "todo-idle", since: "2026-06-01T00:00:00.000Z" };
    const fakeTrack = (_wsId, _idleMs) => ({ pending: 1, stalled: [stalledItem] });

    const result = conductorLaunchCheck({
      root,
      workspaceId: WS_A,
      runTrackActivity: fakeTrack
    });

    assert.equal(result.conductorLive, true);
    assert.equal(result.conductor, instance);
    assert.equal(result.recommendation, "none");
    assert.ok(result.reason.includes("live conductor"));
    assert.equal(result.suggestedHosts, undefined);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. conductorLaunchCheck: track absent (returns undefined) → trackAvailable=false, graceful
// ---------------------------------------------------------------------------
test("conductorLaunchCheck: track absent → trackAvailable=false, recommendation=none", () => {
  const root = tmpRoot("h2a-lc-t4-");
  try {
    createLocalStore({ root });

    const result = conductorLaunchCheck({
      root,
      workspaceId: WS_A,
      runTrackActivity: () => undefined
    });

    assert.equal(result.trackAvailable, false);
    assert.equal(result.pending, 0);
    assert.equal(result.stalled.length, 0);
    assert.equal(result.conductorLive, false);
    assert.equal(result.recommendation, "none");
    assert.equal(result.suggestedHosts, undefined);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. CLI smoke: exits 0 + valid JSON (track absent in CI is fine)
// ---------------------------------------------------------------------------
test("CLI conductor-launch-check exits 0 and prints valid JSON", () => {
  const root = tmpRoot("h2a-lc-cli-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const streams = captureStreams(dir);
    const rc = runCli(
      ["conductor-launch-check", "--workspace", WS_A, "--root", root],
      streams
    );
    assert.equal(rc, 0, `expected exit 0 (stderr: ${streams.stderrText})`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.ok(parsed && typeof parsed === "object", "stdout is a JSON object");
    assert.ok("workspaceId" in parsed, "result has workspaceId");
    assert.ok("recommendation" in parsed, "result has recommendation");
    assert.ok("conductorLive" in parsed, "result has conductorLive");
    assert.ok("trackAvailable" in parsed, "result has trackAvailable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5b. CLI: bad --idle-ms exits 1
// ---------------------------------------------------------------------------
test("CLI conductor-launch-check: bad --idle-ms exits 1", () => {
  const root = tmpRoot("h2a-lc-cli-err-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const streams = captureStreams(dir);
    const rc = runCli(
      ["conductor-launch-check", "--workspace", WS_A, "--root", root, "--idle-ms", "not-a-number"],
      streams
    );
    assert.equal(rc, 1, "bad --idle-ms should exit 1");
    assert.ok(streams.stderrText.includes("idle-ms"), "stderr mentions idle-ms");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. MCP smoke: h2a_conductor_launch_check returns a valid object
// ---------------------------------------------------------------------------
test("MCP h2a_conductor_launch_check returns a valid result", () => {
  const root = tmpRoot("h2a-lc-mcp-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_conductor_launch_check", { workspaceId: WS_A });
    assert.ok(!("error" in result), `unexpected error: ${JSON.stringify(result)}`);
    assert.ok("workspaceId" in result, "result has workspaceId");
    assert.ok("recommendation" in result, "result has recommendation");
    assert.ok("conductorLive" in result, "result has conductorLive");
    assert.ok("trackAvailable" in result, "result has trackAvailable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6b. MCP: missing workspaceId + workspacePath → error
// ---------------------------------------------------------------------------
test("MCP h2a_conductor_launch_check: missing workspaceId and workspacePath → error", () => {
  const root = tmpRoot("h2a-lc-mcp-err-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_conductor_launch_check", {});
    assert.ok("error" in result, "should return error when no workspace given");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
