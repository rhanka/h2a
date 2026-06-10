/**
 * Tests for WP-G1b: claimable conductor (append-only claims store + conductorFor
 * precedence update + CLI/MCP claim|release verbs).
 *
 * Scenarios:
 * 1. Claims store: claim then release → no active claim.
 * 2. Two claims (A earlier, B later) both live → activeConductorClaims returns
 *    [A, B] (A first); conductorFor → conductor = A.
 * 3. A releases → conductor = B.
 * 4. A claim by a NON-live instance is ignored by conductorFor (must be live
 *    in-workspace candidate).
 * 5. CLI: `conductor claim --instance <self>` then `conductor` resolves
 *    conductor=self; `conductor release` → conductor=null (if sole claimant).
 * 6. MCP: h2a_conductor_claim returns the resolved conductor; release frees it.
 * 7. `claimedBy` field: claim-based resolution sets claimedBy; role-based sets null.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activeConductorClaims,
  appendConductorClaim,
  conductorFor,
  createLocalStore,
  createMcpServer,
  listConductorClaims,
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
// Test 1: Claim then release → no active claim
// ---------------------------------------------------------------------------
test("claims store: claim then release → no active claim for that instance", () => {
  const root = tmpRoot("h2a-claim-t1-");
  try {
    createLocalStore({ root });
    const instance = "claude:a:aaaaaaaaaaaa";

    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance, at: "2026-01-01T00:00:00.000Z" });
    appendConductorClaim(root, { type: "release", workspaceId: WS_A, instance, at: "2026-01-01T00:01:00.000Z" });

    const all = listConductorClaims(root);
    assert.equal(all.length, 2, "both events persisted");

    const active = activeConductorClaims(root, WS_A);
    assert.equal(active.length, 0, "after release, no active claim");
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: Two claims both live → activeConductorClaims returns [A, B] (A first);
//          conductorFor → conductor = A
// ---------------------------------------------------------------------------
test("claims store: two claims (A earlier, B later) both live → conductor = A", () => {
  const root = tmpRoot("h2a-claim-t2-");
  try {
    const store = createLocalStore({ root });
    const instanceA = "claude:a:aaaaaaaaaaaa";
    const instanceB = "codex:b:bbbbbbbbbbbb";
    registerInstance(store, instanceA, ["AGENTS"]);
    registerInstance(store, instanceB, ["AGENTS"]);

    // A claims first (earlier `at`)
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: instanceA, at: "2026-01-01T00:00:00.000Z" });
    // B claims second (later `at`)
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: instanceB, at: "2026-01-01T00:01:00.000Z" });

    const active = activeConductorClaims(root, WS_A);
    assert.equal(active.length, 2, "two active claimants");
    assert.equal(active[0].instance, instanceA, "A is first (earlier claim)");
    assert.equal(active[1].instance, instanceB, "B is second");

    // Both instances are live in workspace
    writePresence(root, makeSession({ sessionId: "sess:a1", instance: instanceA, workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));
    writePresence(root, makeSession({ sessionId: "sess:b1", instance: instanceB, workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" } }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.conductor, instanceA, "earliest active claimant wins");
    assert.equal(result.claimedBy, instanceA, "claimedBy = instanceA");
    assert.equal(result.live, true);
    assert.equal(result.candidates.length, 2);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: A releases → conductor = B
// ---------------------------------------------------------------------------
test("claims store: A releases → conductor = B", () => {
  const root = tmpRoot("h2a-claim-t3-");
  try {
    const store = createLocalStore({ root });
    const instanceA = "claude:a:aaaaaaaaaaaa";
    const instanceB = "codex:b:bbbbbbbbbbbb";
    registerInstance(store, instanceA, ["AGENTS"]);
    registerInstance(store, instanceB, ["AGENTS"]);

    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: instanceA, at: "2026-01-01T00:00:00.000Z" });
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: instanceB, at: "2026-01-01T00:01:00.000Z" });

    // Both live
    writePresence(root, makeSession({ sessionId: "sess:a1", instance: instanceA, workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));
    writePresence(root, makeSession({ sessionId: "sess:b1", instance: instanceB, workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" } }));

    // Verify A is conductor initially
    const before = conductorFor({ root, workspaceId: WS_A });
    assert.equal(before.conductor, instanceA);

    // A releases
    appendConductorClaim(root, { type: "release", workspaceId: WS_A, instance: instanceA, at: "2026-01-01T00:02:00.000Z" });

    const after = conductorFor({ root, workspaceId: WS_A });
    assert.equal(after.conductor, instanceB, "after A releases, B becomes conductor");
    assert.equal(after.claimedBy, instanceB, "claimedBy = instanceB");
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: A claim by a NON-live instance is ignored by conductorFor
// ---------------------------------------------------------------------------
test("conductorFor: claim by non-live instance is ignored (must be live candidate)", () => {
  const root = tmpRoot("h2a-claim-t4-");
  try {
    const store = createLocalStore({ root });
    const instanceA = "claude:a:aaaaaaaaaaaa";
    const instanceB = "codex:b:bbbbbbbbbbbb";
    registerInstance(store, instanceA, ["AGENTS"]);
    registerInstance(store, instanceB, ["AGENTS"]);

    // instanceA claims but is NOT live
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: instanceA, at: "2026-01-01T00:00:00.000Z" });

    // Only instanceB is live
    writePresence(root, makeSession({ sessionId: "sess:b1", instance: instanceB, workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" } }));

    const result = conductorFor({ root, workspaceId: WS_A });
    // instanceA's claim is ignored because it's not a live in-workspace candidate
    assert.equal(result.conductor, null, "non-live claimant is ignored → null conductor");
    assert.equal(result.claimedBy, null, "claimedBy = null when no live claimant");
    assert.equal(result.candidates.length, 1, "only instanceB is a candidate");
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: CLI conductor claim → conductor=self; release → conductor=null
// ---------------------------------------------------------------------------
test("CLI conductor claim sets conductor=self; release frees it", () => {
  const root = tmpRoot("h2a-claim-cli-");
  const dir = root.replace("/.h2a", "");
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

    // Claim
    const claimStreams = captureStreams(dir);
    const claimRc = runCli(
      ["conductor", "claim", "--instance", instance, "--workspace", WS_A, "--root", root],
      claimStreams
    );
    assert.equal(claimRc, 0, `claim should exit 0 (stderr: ${claimStreams.stderrText})`);
    const claimResult = JSON.parse(claimStreams.stdoutText);
    assert.equal(claimResult.conductor, instance, "after claim, conductor=self");
    assert.equal(claimResult.claimedBy, instance, "claimedBy=self after claim");
    assert.equal(claimResult.live, true);

    // Verify with plain conductor
    const resolveStreams = captureStreams(dir);
    const resolveRc = runCli(
      ["conductor", "--workspace", WS_A, "--root", root],
      resolveStreams
    );
    assert.equal(resolveRc, 0);
    const resolveResult = JSON.parse(resolveStreams.stdoutText);
    assert.equal(resolveResult.conductor, instance, "conductor still resolves to self");

    // Release
    const releaseStreams = captureStreams(dir);
    const releaseRc = runCli(
      ["conductor", "release", "--instance", instance, "--workspace", WS_A, "--root", root],
      releaseStreams
    );
    assert.equal(releaseRc, 0, `release should exit 0 (stderr: ${releaseStreams.stderrText})`);
    const releaseResult = JSON.parse(releaseStreams.stdoutText);
    assert.equal(releaseResult.conductor, null, "after sole claimant releases, conductor=null");
    assert.equal(releaseResult.claimedBy, null, "claimedBy=null after release");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5b: CLI conductor claim without --instance returns exit 1
// ---------------------------------------------------------------------------
test("CLI conductor claim without --instance exits 1", () => {
  const root = tmpRoot("h2a-claim-cli-err-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const streams = captureStreams(dir);
    const rc = runCli(
      ["conductor", "claim", "--workspace", WS_A, "--root", root],
      streams
    );
    assert.equal(rc, 1, "missing --instance → exit 1");
    assert.ok(streams.stderrText.includes("--instance"), "stderr mentions --instance");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: MCP h2a_conductor_claim returns the resolved conductor
// ---------------------------------------------------------------------------
test("MCP h2a_conductor_claim sets conductor=self; h2a_conductor_release frees it", () => {
  const root = tmpRoot("h2a-claim-mcp-");
  const dir = root.replace("/.h2a", "");
  try {
    const store = createLocalStore({ root });
    const instance = "claude:mcp-self:dddddddddddd";
    registerInstance(store, instance, ["AGENTS"]);

    writePresence(root, makeSession({
      sessionId: "sess:mcp-self1",
      instance,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    const server = createMcpServer({ root });

    // Claim
    const claimResult = server.callTool("h2a_conductor_claim", {
      instance,
      workspaceId: WS_A
    });
    assert.ok(!("error" in claimResult), `unexpected error: ${JSON.stringify(claimResult)}`);
    assert.equal(claimResult.conductor, instance, "after claim, conductor=self");
    assert.equal(claimResult.claimedBy, instance, "claimedBy=self");
    assert.equal(claimResult.live, true);

    // Release
    const releaseResult = server.callTool("h2a_conductor_release", {
      instance,
      workspaceId: WS_A
    });
    assert.ok(!("error" in releaseResult), `unexpected error: ${JSON.stringify(releaseResult)}`);
    assert.equal(releaseResult.conductor, null, "after release, conductor=null");
    assert.equal(releaseResult.claimedBy, null, "claimedBy=null");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6b: MCP h2a_conductor_claim without instance returns error
// ---------------------------------------------------------------------------
test("MCP h2a_conductor_claim without instance returns error", () => {
  const root = tmpRoot("h2a-claim-mcp-err-");
  const dir = root.replace("/.h2a", "");
  try {
    createLocalStore({ root });
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_conductor_claim", { workspaceId: WS_A });
    assert.ok("error" in result, "must return an error when no instance given");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7: claimedBy is null for role-based resolution (back-compat)
// ---------------------------------------------------------------------------
test("conductorFor: role-based resolution sets claimedBy=null", () => {
  const root = tmpRoot("h2a-claim-t7-");
  try {
    const store = createLocalStore({ root });
    const conductor = "claude:conductor:cccccccccccc";
    registerInstance(store, conductor, ["CONDUCTOR"]);

    writePresence(root, makeSession({
      sessionId: "sess:c1",
      instance: conductor,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.conductor, conductor, "role-based resolution finds conductor");
    assert.equal(result.claimedBy, null, "claimedBy=null for role-based resolution");
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8: claims are scoped to workspaceId — WS_B claim does not affect WS_A
// ---------------------------------------------------------------------------
test("claims are workspace-scoped: WS_B claim does not affect WS_A resolution", () => {
  const root = tmpRoot("h2a-claim-t8-");
  try {
    const store = createLocalStore({ root });
    const instance = "claude:a:aaaaaaaaaaaa";
    registerInstance(store, instance, ["AGENTS"]);

    // Claim in WS_B
    appendConductorClaim(root, { type: "claim", workspaceId: WS_B, instance, at: "2026-01-01T00:00:00.000Z" });

    writePresence(root, makeSession({
      sessionId: "sess:a1",
      instance,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" }
    }));

    const result = conductorFor({ root, workspaceId: WS_A });
    assert.equal(result.conductor, null, "WS_B claim has no effect on WS_A");
    assert.equal(result.claimedBy, null);
    assert.equal(result.candidates.length, 1);
  } finally {
    rmSync(root.replace("/.h2a", ""), { recursive: true, force: true });
  }
});
