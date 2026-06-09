// WP-7: Reach Guard tests.
//
// Tests:
//   Unit — reachGuard (full-id registered → ok; bare-alias 1 live → ok;
//           phantom 0 live 0 registered → !ok; ambiguous >1 live → !ok;
//           full-id not in registry → ok; malformed 3-seg → !ok)
//   Watch chokepoint — phantom finding skipped (relauncher NOT invoked) + log emitted;
//                       registered full-id finding is relanced.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLocalStore,
  drumbeatTick,
  reachGuard,
  recordStop,
  writePresence
} from "../dist/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-rg-"));
  return { dir, root: join(dir, ".h2a") };
}

function makePresence(instance, sessionId) {
  return {
    sessionId,
    instance,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  };
}

function makeRegistration(instance) {
  return {
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date().toISOString()
  };
}

// ─── Unit: reachGuard ─────────────────────────────────────────────────────────

test("reachGuard: full-id target registered → ok", () => {
  const target = "claude:myagent:aabbccddeeff";
  const result = reachGuard({
    target,
    liveInstances: [],
    registeredInstances: [target]
  });
  assert.deepEqual(result, { ok: true });
});

test("reachGuard: bare-alias with exactly 1 live match (deliver-hint) → ok", () => {
  const live = "claude:foo:aabbccddeeff";
  const result = reachGuard({
    target: "claude:foo",
    liveInstances: [live],
    registeredInstances: [live]
  });
  assert.deepEqual(result, { ok: true });
});

test("reachGuard: phantom (0 live, 0 registered) → !ok", () => {
  const result = reachGuard({
    target: "claude:ghost",
    liveInstances: [],
    registeredInstances: []
  });
  assert.equal(result.ok, false, "phantom must be blocked");
  assert.equal("kind" in result ? result.kind : undefined, "refuse");
  assert.ok(typeof (/** @type {*} */(result).reason) === "string");
});

test("reachGuard: ambiguous (2 live for the same bare alias) → !ok", () => {
  const result = reachGuard({
    target: "claude:foo",
    liveInstances: ["claude:foo:aabbccddeeff", "claude:foo:112233445566"],
    registeredInstances: ["claude:foo:aabbccddeeff", "claude:foo:112233445566"]
  });
  assert.equal(result.ok, false, "ambiguous must be blocked");
  assert.equal("kind" in result ? result.kind : undefined, "refuse");
});

test("reachGuard: full-id not in registry but 3-seg uuid → deliver → ok", () => {
  // resolveRecipient classifies a 3-seg valid uuid as 'deliver' regardless of
  // registry — the caller chose a specific peer, not a label.
  const target = "claude:solo:aabbccddeeff";
  const result = reachGuard({
    target,
    liveInstances: [],
    registeredInstances: [] // NOT registered
  });
  assert.deepEqual(result, { ok: true });
});

test("reachGuard: bare-alias 0 live 1 registered (deliver-dormant) → ok (waking dormant is allowed)", () => {
  const registered = "claude:sleepy:aabbccddeeff";
  const result = reachGuard({
    target: "claude:sleepy",
    liveInstances: [],
    registeredInstances: [registered]
  });
  assert.deepEqual(result, { ok: true });
});

test("reachGuard: malformed 3-segment (non-uuid 3rd seg) → !ok", () => {
  const result = reachGuard({
    target: "claude:foo:notauuid",
    liveInstances: [],
    registeredInstances: []
  });
  assert.equal(result.ok, false, "malformed 3-seg must be blocked");
  assert.equal("kind" in result ? result.kind : undefined, "refuse");
});

// ─── Watch chokepoint: phantom skipped, registered full-id relanced ───────────

const fixed = Date.parse("2026-05-30T00:00:00.000Z");

test("watch chokepoint: phantom finding is skipped, relauncher not invoked, log emitted", async () => {
  const { dir, root } = freshRoot();
  try {
    // Record a stop for a phantom instance (not in the registry, no presence).
    recordStop(root, {
      instance: "claude:ghost",
      workStatus: "out-of-tokens",
      launchContext: { command: "claude" }
    }, fixed);

    const relauncherCalls = [];
    const logLines = [];
    const result = await drumbeatTick(root, {
      relance(finding) {
        relauncherCalls.push(finding.instance);
        return true;
      }
    }, {
      root,
      log: (line) => logLines.push(line),
      now: fixed
    });

    assert.deepEqual(result.relanced, [], "phantom must not be relanced");
    assert.equal(relauncherCalls.length, 0, "relauncher must not be called for a phantom");
    assert.equal(logLines.length, 1, "exactly one skip log line must be emitted");
    assert.match(logLines[0], /claude:ghost/, "log must mention the skipped instance");
    assert.match(logLines[0], /skipping relance/, "log must say skipping relance");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("watch chokepoint: registered full-id finding is relanced normally", async () => {
  const { dir, root } = freshRoot();
  const INSTANCE = "claude:myagent:aabbccddeeff";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(INSTANCE));

    recordStop(root, {
      instance: INSTANCE,
      workStatus: "out-of-tokens",
      launchContext: { command: "claude" }
    }, fixed);

    const relauncherCalls = [];
    const logLines = [];
    const result = await drumbeatTick(root, {
      relance(finding) {
        relauncherCalls.push(finding.instance);
        return true;
      }
    }, {
      root,
      log: (line) => logLines.push(line),
      now: fixed
    });

    assert.deepEqual(result.relanced, [INSTANCE], "registered full-id must be relanced");
    assert.equal(relauncherCalls.length, 1, "relauncher must be called once");
    assert.equal(logLines.length, 0, "no skip log for a valid target");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("watch chokepoint: when root is absent the guard is bypassed (backward-compatible)", async () => {
  const { dir, root } = freshRoot();
  try {
    // Phantom instance but no guard root → should still be relanced (legacy behaviour).
    recordStop(root, {
      instance: "claude:ghost",
      workStatus: "out-of-tokens",
      launchContext: { command: "claude" }
    }, fixed);

    const relauncherCalls = [];
    const result = await drumbeatTick(root, {
      relance(finding) {
        relauncherCalls.push(finding.instance);
        return true;
      }
    }, {
      // no `root` field — guard is skipped
      now: fixed
    });

    assert.deepEqual(result.relanced, ["claude:ghost"], "without guard root phantom is relanced (backward-compat)");
    assert.equal(relauncherCalls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("watch chokepoint: live bare-alias (deliver-hint) is allowed to reach", async () => {
  const { dir, root } = freshRoot();
  const INSTANCE = "claude:live:aabbccddeeff";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(INSTANCE));
    // Write a fresh presence so it shows up in liveInstances.
    writePresence(root, makePresence(INSTANCE, "sess:live-1"));

    // Record a stop for the BARE ALIAS (not the full id) — simulates a
    // drumbeat entry keyed on the channel handle.
    recordStop(root, {
      instance: "claude:live",
      workStatus: "out-of-tokens",
      launchContext: { command: "claude" }
    }, fixed);

    const relauncherCalls = [];
    const result = await drumbeatTick(root, {
      relance(finding) {
        relauncherCalls.push(finding.instance);
        return true;
      }
    }, {
      root,
      now: fixed
    });

    assert.deepEqual(result.relanced, ["claude:live"], "bare-alias with 1 live hit must be relanced (deliver-hint)");
    assert.equal(relauncherCalls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
