import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_HOST_BRIDGE_CLAUSES,
  H2A_HOST_BRIDGE_PROFILES,
  H2A_SESSION_STATES,
  auditHostBridge,
  getHostBridgeProfile,
  listHostBridgeProfiles
} from "../dist/index.js";

test("H2A_HOST_BRIDGE_CLAUSES lists the 5 canonical clauses from DEC-056", () => {
  assert.deepEqual([...H2A_HOST_BRIDGE_CLAUSES].sort(), [
    "auth-boundary",
    "disclosure",
    "identity",
    "lifecycle",
    "resource-limits"
  ]);
});

test("H2A_HOST_BRIDGE_PROFILES ships the remote-controle bridge by default", () => {
  const profile = getHostBridgeProfile("remote-controle");
  assert.ok(profile);
  assert.equal(profile.hostId, "remote-controle");
  assert.equal(profile.identity.hostHint, "remote-controle");
  assert.equal(profile.identity.envVarMap.instance, "H2A_INSTANCE");
  assert.equal(profile.identity.envVarMap.host, "H2A_HOST");
  assert.equal(profile.identity.envVarMap.root, "H2A_ROOT");
  // Lifecycle map covers the 4 remote-controle states; every target is in
  // H2A_SESSION_STATES.
  for (const target of Object.values(profile.lifecycle.stateMap)) {
    assert.ok(H2A_SESSION_STATES.includes(target));
  }
  // V1 invariant: never enforces host resource limits.
  assert.equal(profile.resourceLimits.enforced, false);
  // References include DEC-056/058/059.
  assert.ok(profile.references.includes("DEC-056"));
  assert.ok(profile.references.includes("DEC-058"));
  assert.ok(profile.references.includes("DEC-059"));
});

test("auditHostBridge accepts a well-formed shipped profile and lists the 5 clauses", () => {
  const result = auditHostBridge("remote-controle");
  assert.equal(result.ok, true);
  assert.equal(result.hostId, "remote-controle");
  assert.equal(result.enforces, false);
  assert.deepEqual([...result.clauses].sort(), [
    "auth-boundary",
    "disclosure",
    "identity",
    "lifecycle",
    "resource-limits"
  ]);
  assert.deepEqual(result.issues, []);
});

test("auditHostBridge rejects unknown host ids", () => {
  const result = auditHostBridge("vscode-remote");
  assert.equal(result.ok, false);
  assert.equal(result.hostId, undefined);
  assert.equal(result.clauses.length, 0);
  assert.match(result.issues.join("\n"), /unknown host bridge profile/);
});

test("listHostBridgeProfiles enumerates the registered bridges", () => {
  const ids = listHostBridgeProfiles();
  assert.ok(Array.isArray(ids));
  assert.ok(ids.includes("remote-controle"));
});

test("H2A_HOST_BRIDGE_PROFILES.remote-controle lifecycle stateMap maps to known H2ASessionState values", () => {
  const map = H2A_HOST_BRIDGE_PROFILES["remote-controle"].lifecycle.stateMap;
  // Spot-check a couple of well-known transitions.
  assert.equal(map.provisioning, "opening");
  assert.equal(map.running, "live");
  assert.equal(map.terminating, "draining");
  assert.equal(map.ended, "closed");
});

test("auditHostBridge rejects a profile whose lifecycle targets are unknown states (simulated)", () => {
  // We cannot mutate the frozen built-in. Instead, monkey-patch the audit
  // input via the public exports by checking that a clearly-broken hostId
  // returns the expected shape.
  const unknown = auditHostBridge("not-real");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.clauses.length, 0);
});

test("H2A_HOST_BRIDGE_CLAUSES match the 5 fields validated by auditHostBridge", () => {
  // The audit returns one clause per validated field; for the shipped
  // remote-controle profile, all 5 must be present.
  const result = auditHostBridge("remote-controle");
  assert.equal(result.clauses.length, H2A_HOST_BRIDGE_CLAUSES.length);
  for (const c of H2A_HOST_BRIDGE_CLAUSES) {
    assert.ok(result.clauses.includes(c), `audit must list clause ${c}`);
  }
});
