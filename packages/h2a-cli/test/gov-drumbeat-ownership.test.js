/**
 * Tests for Gov D2 (drumbeat-ownership) and Gov D4 (cross-workspace CoI advisory).
 *
 * D2: a claimed live conductor owns its workspace's relances — peers defer on
 *     fresh stalls (relanceCount === 0); failsafe allows if relanceCount >= 1.
 * D4: cross-workspace relances emit a CoI advisory (warn, not blocked).
 *
 * All new behaviors are opt-in: selfInstance absent → default-allow (backward-compat).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendConductorClaim,
  createLocalStore,
  drumbeatTick,
  markRelanced,
  recordStop,
  writePresence
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-govd2-"));
  return { dir, root: join(dir, ".h2a") };
}

const fixed = Date.parse("2026-06-09T00:00:00.000Z");

function makeSession(overrides) {
  return {
    sessionId: `sess:${Math.random().toString(36).slice(2)}`,
    instance: "claude:test:aaaaaaaaaaaa",
    startedAt: new Date(fixed).toISOString(),
    heartbeatAt: new Date(fixed).toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...overrides
  };
}

function registerInst(store, instance, workspaceId) {
  store.registerInstance({
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date(fixed).toISOString(),
    ...(workspaceId ? { workspace: { id: workspaceId, path: "/fake/ws", host: "claude", label: "ws" } } : {})
  });
}

const WS_A = "ws:aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "ws:bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb";

// Seed a stopped entry already relanced `n` times.
function seed(root, instance, n) {
  recordStop(root, { instance, workStatus: "stopped", launchContext: { command: "echo test" } }, fixed);
  for (let i = 0; i < n; i++) markRelanced(root, instance, fixed);
}

// Recording relauncher.
function makeRelauncher() {
  const relanced = [];
  return {
    relance(finding) { relanced.push(finding.instance); return true; },
    relanced
  };
}

// ---------------------------------------------------------------------------
// Test 1: selfInstance ABSENT → finding relanced (no gate; backward-compat)
// ---------------------------------------------------------------------------
test("D2: selfInstance absent → finding relanced unconditionally (backward-compat)", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const target = "claude:target:cccccccccccc";
    registerInst(store, target, WS_A);
    seed(root, target, 0);

    // Write presence so reach-guard allows it
    writePresence(root, makeSession({ sessionId: "sess:t1", instance: target,
      workspace: { id: WS_A, path: "/fake/ws", host: "claude", label: "ws" } }));

    // Claim conductor for WS_A as a different agent
    const conductor = "codex:conductor:dddddddddddd";
    registerInst(store, conductor, WS_A);
    writePresence(root, makeSession({ sessionId: "sess:c1", instance: conductor,
      workspace: { id: WS_A, path: "/fake/ws", host: "codex", label: "ws" } }));
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: conductor, at: new Date(fixed).toISOString() });

    const rl = makeRelauncher();
    // No selfInstance — governance checks must be completely skipped
    const result = await drumbeatTick(root, rl, { root, now: fixed });
    assert.deepEqual(rl.relanced, [target], "no selfInstance → relanced regardless of conductor");
    assert.deepEqual(result.relanced, [target]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Test 2: conductor claimed+live for W, selfInstance != conductor, relanceCount 0 → SKIPPED
// ---------------------------------------------------------------------------
test("D2: conductor claimed, selfInstance != conductor, relanceCount 0 → relance SKIPPED", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const self = "claude:self:eeeeeeeeeeee";
    const conductor = "codex:cond:ffffffffffff";
    const target = "claude:target:111111111111";

    registerInst(store, self, WS_B);     // self is in workspace B
    registerInst(store, conductor, WS_A); // conductor is in workspace A
    registerInst(store, target, WS_A);    // target is in workspace A

    // Both self and conductor are live
    writePresence(root, makeSession({ sessionId: "sess:self1", instance: self,
      workspace: { id: WS_B, path: "/fake/ws-b", host: "claude", label: "ws-b" } }));
    writePresence(root, makeSession({ sessionId: "sess:cond1", instance: conductor,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" } }));
    writePresence(root, makeSession({ sessionId: "sess:t1", instance: target,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));

    // Conductor claims WS_A
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: conductor, at: new Date(fixed).toISOString() });

    seed(root, target, 0); // relanceCount === 0 (fresh stall)

    const logs = [];
    const rl = makeRelauncher();
    await drumbeatTick(root, rl, { root, selfInstance: self, now: fixed, log: (l) => logs.push(l) });

    assert.deepEqual(rl.relanced, [], "relance must be SKIPPED (conductor owns it)");
    assert.ok(logs.some((l) => l.includes("deferring relance")), "defer log emitted");
    assert.ok(logs.some((l) => l.includes(conductor)), "log mentions conductor");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Test 3: selfInstance IS the conductor → relanced
// ---------------------------------------------------------------------------
test("D2: selfInstance IS the conductor → relance proceeds", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const self = "claude:conductor:222222222222";
    const target = "claude:worker:333333333333";

    registerInst(store, self, WS_A);
    registerInst(store, target, WS_A);

    writePresence(root, makeSession({ sessionId: "sess:self1", instance: self,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));
    writePresence(root, makeSession({ sessionId: "sess:t1", instance: target,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));

    // self claims conductor
    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: self, at: new Date(fixed).toISOString() });

    seed(root, target, 0);

    const rl = makeRelauncher();
    await drumbeatTick(root, rl, { root, selfInstance: self, now: fixed });

    assert.deepEqual(rl.relanced, [target], "self IS conductor → relance proceeds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Test 4: relanceCount >= 1 → relanced (failsafe bypasses D2)
// ---------------------------------------------------------------------------
test("D2: relanceCount >= 1 → relance proceeds (failsafe; conductor missed window)", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const self = "claude:peer:444444444444";
    const conductor = "codex:cond:555555555555";
    const target = "claude:target:666666666666";

    registerInst(store, self, WS_B);
    registerInst(store, conductor, WS_A);
    registerInst(store, target, WS_A);

    writePresence(root, makeSession({ sessionId: "sess:self1", instance: self,
      workspace: { id: WS_B, path: "/fake/ws-b", host: "claude", label: "ws-b" } }));
    writePresence(root, makeSession({ sessionId: "sess:cond1", instance: conductor,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "codex", label: "ws-a" } }));
    writePresence(root, makeSession({ sessionId: "sess:t1", instance: target,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));

    appendConductorClaim(root, { type: "claim", workspaceId: WS_A, instance: conductor, at: new Date(fixed).toISOString() });

    seed(root, target, 1); // relanceCount === 1 → failsafe kicks in

    const rl = makeRelauncher();
    await drumbeatTick(root, rl, { root, selfInstance: self, now: fixed });

    assert.deepEqual(rl.relanced, [target], "relanceCount >= 1 → failsafe: relance proceeds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Test 5: no conductor claimed → relanced
// ---------------------------------------------------------------------------
test("D2: no conductor claimed → relance proceeds (no gate)", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const self = "claude:self:777777777777";
    const target = "claude:target:888888888888";

    registerInst(store, self, WS_A);
    registerInst(store, target, WS_A);

    writePresence(root, makeSession({ sessionId: "sess:self1", instance: self,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));
    writePresence(root, makeSession({ sessionId: "sess:t1", instance: target,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));

    // No conductor claim

    seed(root, target, 0);

    const rl = makeRelauncher();
    await drumbeatTick(root, rl, { root, selfInstance: self, now: fixed });

    assert.deepEqual(rl.relanced, [target], "no conductor → relance proceeds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Test 6: D4 — cross-workspace relance → relanced AND CoI advisory logged
// ---------------------------------------------------------------------------
test("D4: selfInstance in WS_B, target in WS_A → relanced AND cross-workspace advisory logged", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const self = "claude:self:999999999999";
    const target = "claude:target:aaaaaaaaaa01";

    registerInst(store, self, WS_B);   // self in WS_B
    registerInst(store, target, WS_A); // target in WS_A

    writePresence(root, makeSession({ sessionId: "sess:self1", instance: self,
      workspace: { id: WS_B, path: "/fake/ws-b", host: "claude", label: "ws-b" } }));
    writePresence(root, makeSession({ sessionId: "sess:t1", instance: target,
      workspace: { id: WS_A, path: "/fake/ws-a", host: "claude", label: "ws-a" } }));

    // No conductor for WS_A → D2 allows; D4 should fire advisory
    seed(root, target, 0);

    const logs = [];
    const rl = makeRelauncher();
    await drumbeatTick(root, rl, { root, selfInstance: self, now: fixed, log: (l) => logs.push(l) });

    assert.deepEqual(rl.relanced, [target], "D4 is advisory-only: relance must proceed");
    const advisoryLog = logs.find((l) => l.includes("cross-workspace relance"));
    assert.ok(advisoryLog !== undefined, "cross-workspace advisory must be logged");
    assert.ok(advisoryLog.includes(WS_A), "advisory mentions target workspace");
    assert.ok(advisoryLog.includes(WS_B), "advisory mentions self workspace");
    assert.ok(advisoryLog.includes(self), "advisory mentions self instance");
    assert.ok(advisoryLog.includes("advisory"), "advisory uses the word 'advisory'");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
