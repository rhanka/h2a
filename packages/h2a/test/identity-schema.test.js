import assert from "node:assert/strict";
import test from "node:test";

import { isH2AActorRegistration, isH2ASession } from "../dist/index.js";

function registration(overrides = {}) {
  return {
    id: "claude:repo:9f3a1c20aaaa",
    instance: "claude:repo:9f3a1c20aaaa",
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-30T00:00:00.000Z",
    ...overrides
  };
}

// DEC-114: additive `workspace?` + `name?` on H2ASession + H2AActorRegistration.
// Guards validate-when-present; old records (without them) stay valid.

function liveSession(overrides = {}) {
  return {
    sessionId: "sess:abc",
    instance: "claude:repo:9f3a1c20aaaa",
    host: "claude",
    pid: 4242,
    startedAt: "2026-05-23T12:00:00.000Z",
    heartbeatAt: "2026-05-23T12:00:00.000Z",
    state: "live",
    interests: { scopes: ["team:devops"], negotiations: [] },
    subscribedTopics: ["presence.peer_joined", "inbox.envelope_arrived"],
    ...overrides
  };
}

const workspace = {
  id: "ws:11111111-2222-5333-8444-555555555555",
  path: "/home/u/repo",
  host: "claude",
  label: "repo"
};

test("isH2ASession: a legacy session without workspace/name stays valid (back-compat)", () => {
  assert.ok(isH2ASession(liveSession()));
});

test("isH2ASession: a session carrying a valid workspace + name validates", () => {
  assert.ok(isH2ASession(liveSession({ workspace, name: "design-lead" })));
});

test("isH2ASession: a malformed workspace is rejected (validate-when-present)", () => {
  assert.ok(!isH2ASession(liveSession({ workspace: { id: 5 } })));
  assert.ok(!isH2ASession(liveSession({ workspace: { id: "ws:x" } }))); // missing path/host/label
});

test("isH2ASession: a non-string name is rejected (validate-when-present)", () => {
  assert.ok(!isH2ASession(liveSession({ name: 42 })));
});

test("isH2AActorRegistration: a legacy registration (no agentUuid/workspace) is valid", () => {
  assert.ok(isH2AActorRegistration(registration()));
});

test("isH2AActorRegistration: the additive identity fields validate when present", () => {
  assert.ok(
    isH2AActorRegistration(
      registration({
        agentUuid: "11111111-2222-5333-8444-555555555555",
        workspace,
        name: "design-lead"
      })
    )
  );
});

test("isH2AActorRegistration: rejects malformed additive fields (validate-when-present)", () => {
  assert.ok(!isH2AActorRegistration(registration({ agentUuid: 5 })));
  assert.ok(!isH2AActorRegistration(registration({ workspace: { id: "ws:x" } })));
  assert.ok(!isH2AActorRegistration(registration({ name: 7 })));
  assert.ok(!isH2AActorRegistration(null));
  assert.ok(!isH2AActorRegistration(registration({ publicKeys: "nope" })));
});
