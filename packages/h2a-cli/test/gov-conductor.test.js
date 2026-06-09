/**
 * Tests for WP-G1: conductorFor resolver + h2a conductor CLI/MCP.
 *
 * Scenarios:
 * 1. Two live in-workspace AGENTS (no CONDUCTOR role) → conductor null, 2 candidates, live true.
 *    Documents the honest current state: agents auto-register as AGENTS, not CONDUCTOR.
 * 2. One candidate promoted to CONDUCTOR → conductor = that instance.
 * 3. No live session for the workspace → conductor null, candidates [], live false.
 * 4. A session in a DIFFERENT workspace is NOT a candidate.
 * 5. CLI `h2a conductor --workspace <id> --root <root>` returns the JSON resource shape.
 * 6. MCP `h2a_conductor` returns the same shape.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  conductorFor,
  createLocalStore,
  createMcpServer,
  runCli,
  writePresence
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
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
const WS_B = "ws:bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb";

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
// Test 1: Two AGENTS in workspace → conductor null, 2 candidates, live true
// ---------------------------------------------------------------------------
test("conductorFor: 2 AGENTS in workspace → conductor null, candidates 2, live true", () => {
  const root = tmpRoot("h2a-gov-t1-");
  try {
    const store = createLocalStore({ root });
    const instance1 = "claude:agent1:111111111111";
    const instance2 = "codex:agent2:222222222222";
    registerInstance(store, instance1, ["AGENTS"]);
    registerInstance(store, instance2, ["AGENTS"]);

    writePresence(root, makeSession({
      sessionId: "sess:a1",
      instance: instance1,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));
    writePresence(root, makeSession({
      sessionId: "sess:a2",
      instance: instance2,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" }
    }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.conductor, null, "no CONDUCTOR role → conductor must be null");
    assert.equal(result.candidates.length, 2, "both sessions are candidates");
    assert.equal(result.live, true, "candidates > 0 → live");
    assert.equal(result.workspaceId, WS_A);

    // Roles must be surfaced on candidates
    const c1 = result.candidates.find((c) => c.instance === instance1);
    assert.ok(c1, "instance1 in candidates");
    assert.deepEqual(c1.roles, ["AGENTS"]);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: One candidate promoted to CONDUCTOR → conductor = that instance
// ---------------------------------------------------------------------------
test("conductorFor: one CONDUCTOR role → conductor = that instance", () => {
  const root = tmpRoot("h2a-gov-t2-");
  try {
    const store = createLocalStore({ root });
    const conductor = "claude:conductor:cccccccccccc";
    const agent = "codex:agent:dddddddddddd";
    registerInstance(store, conductor, ["CONDUCTOR"]);
    registerInstance(store, agent, ["AGENTS"]);

    const nowIso = new Date().toISOString();
    writePresence(root, makeSession({
      sessionId: "sess:c1",
      instance: conductor,
      startedAt: nowIso,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));
    writePresence(root, makeSession({
      sessionId: "sess:a1",
      instance: agent,
      startedAt: new Date(Date.now() + 1000).toISOString(), // later
      workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" }
    }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.conductor, conductor, "conductor instance must be identified");
    assert.equal(result.candidates.length, 2, "both sessions are candidates");
    assert.equal(result.live, true);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: No live session for the workspace → conductor null, candidates [], live false
// ---------------------------------------------------------------------------
test("conductorFor: no live sessions for workspace → conductor null, candidates empty, live false", () => {
  const root = tmpRoot("h2a-gov-t3-");
  try {
    createLocalStore({ root });
    // Write a presence for WS_B, not WS_A
    writePresence(root, makeSession({
      sessionId: "sess:b1",
      instance: "claude:other:eeeeeeeeeeee",
      workspace: { id: WS_B, path: "/fake/ws-b", host: "claude", label: "ws-b" }
    }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.conductor, null);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.live, false);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: Session in a DIFFERENT workspace is NOT a candidate
// ---------------------------------------------------------------------------
test("conductorFor: session in different workspace is not a candidate", () => {
  const root = tmpRoot("h2a-gov-t4-");
  try {
    const store = createLocalStore({ root });
    const instanceA = "claude:a:aaaaaaaaaaaa";
    const instanceB = "claude:b:bbbbbbbbbbbb";
    registerInstance(store, instanceA, ["AGENTS"]);
    registerInstance(store, instanceB, ["AGENTS"]);

    writePresence(root, makeSession({
      sessionId: "sess:a1",
      instance: instanceA,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));
    writePresence(root, makeSession({
      sessionId: "sess:b1",
      instance: instanceB,
      workspace: { id: WS_B, path: "/fake/ws-b", host: "claude", label: "ws-b" }
    }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.candidates.length, 1, "only the WS_A session is a candidate");
    assert.equal(result.candidates[0].instance, instanceA);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: CLI `h2a conductor --workspace <id> --root <root>` returns resource JSON
// ---------------------------------------------------------------------------
test("CLI h2a conductor returns a resource JSON with conductor/candidates/live/workspaceId", () => {
  const root = tmpRoot("h2a-gov-cli-");
  const dir = root.replace("/.h2a", "");
  try {
    const store = createLocalStore({ root });
    const instance1 = "claude:cli-agent:111111111111";
    registerInstance(store, instance1, ["AGENTS"]);
    writePresence(root, makeSession({
      sessionId: "sess:cli1",
      instance: instance1,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    const streams = captureStreams(dir);
    const rc = runCli(["conductor", "--workspace", WS_A, "--root", root], streams);
    assert.equal(rc, 0, `expected exit 0, got ${rc} (stderr: ${streams.stderrText})`);

    const result = JSON.parse(streams.stdoutText);
    assert.ok(result && typeof result === "object", "must be a JSON object");
    assert.equal(result.workspaceId, WS_A);
    assert.equal(result.conductor, null, "AGENTS role → no conductor");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.live, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5b: CLI with a promoted CONDUCTOR returns conductor !== null
// ---------------------------------------------------------------------------
test("CLI h2a conductor with CONDUCTOR role returns conductor instance", () => {
  const root = tmpRoot("h2a-gov-cli2-");
  const dir = root.replace("/.h2a", "");
  try {
    const store = createLocalStore({ root });
    const conductor = "claude:conductor:cccccccccccc";
    registerInstance(store, conductor, ["CONDUCTOR"]);
    writePresence(root, makeSession({
      sessionId: "sess:cc1",
      instance: conductor,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    const streams = captureStreams(dir);
    const rc = runCli(["conductor", "--workspace", WS_A, "--root", root], streams);
    assert.equal(rc, 0);
    const result = JSON.parse(streams.stdoutText);
    assert.equal(result.conductor, conductor);
    assert.equal(result.live, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: MCP `h2a_conductor` returns the same shape
// ---------------------------------------------------------------------------
test("MCP h2a_conductor returns conductor/candidates/live/workspaceId", () => {
  const root = tmpRoot("h2a-gov-mcp-");
  const dir = root.replace("/.h2a", "");
  try {
    const store = createLocalStore({ root });
    const instance1 = "claude:mcp-agent:111111111111";
    registerInstance(store, instance1, ["AGENTS"]);
    writePresence(root, makeSession({
      sessionId: "sess:mcp1",
      instance: instance1,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    const server = createMcpServer({ root });
    const result = server.callTool("h2a_conductor", { workspaceId: WS_A });

    assert.ok(result && typeof result === "object");
    assert.ok(!("error" in result), `unexpected error: ${JSON.stringify(result)}`);
    assert.equal(result.workspaceId, WS_A);
    assert.equal(result.conductor, null, "AGENTS role → no conductor");
    assert.ok(Array.isArray(result.candidates), "candidates must be an array");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.live, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6b: MCP h2a_conductor with no workspaceId/workspacePath returns error
// ---------------------------------------------------------------------------
test("MCP h2a_conductor with no args returns error", () => {
  const root = tmpRoot("h2a-gov-mcp-err-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_conductor", {});
    assert.ok("error" in result, "must return an error when no workspace given");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
