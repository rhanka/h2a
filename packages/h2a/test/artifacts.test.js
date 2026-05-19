import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_ARTIFACT_KINDS,
  H2A_POLICY_ADOPTION_MODES,
  isAmendment,
  isAuthority,
  isContract,
  isEnforcementPlan,
  isEngagement,
  isMandate,
  isPolicy,
  isSignature
} from "../dist/index.js";

test("H2A_ARTIFACT_KINDS contains the eight canonical kinds", () => {
  assert.deepEqual([...H2A_ARTIFACT_KINDS].sort(), [
    "AMENDMENT",
    "AUTHORITY",
    "CONTRACT",
    "ENFORCEMENT_PLAN",
    "ENGAGEMENT",
    "MANDATE",
    "POLICY",
    "SIGNATURE"
  ]);
});

test("H2A_POLICY_ADOPTION_MODES exposes the four canonical adoption modes", () => {
  assert.deepEqual([...H2A_POLICY_ADOPTION_MODES].sort(), [
    "acknowledged",
    "contractual",
    "imposed",
    "ratified"
  ]);
});

test("isContract accepts a minimal valid contract", () => {
  const contract = {
    kind: "CONTRACT",
    id: "contract:001",
    parties: ["party:alice", "party:bob"],
    scope: "scope:engagement/ship-v1",
    clauses: [],
    policies: [],
    engagements: [],
    signatures: []
  };

  assert.equal(isContract(contract), true);
});

test("isContract rejects when kind is wrong", () => {
  assert.equal(isContract({ kind: "POLICY", id: "x" }), false);
});

test("isPolicy accepts a minimal valid policy", () => {
  const policy = {
    kind: "POLICY",
    id: "policy:001",
    scope: "scope:org/antoine",
    rule: "no-secrets-in-logs",
    sourceAuthority: "authority:cyber",
    adoptionMode: "ratified"
  };

  assert.equal(isPolicy(policy), true);
});

test("isPolicy rejects unknown adoption modes", () => {
  assert.equal(
    isPolicy({
      kind: "POLICY",
      id: "policy:002",
      scope: "scope:x",
      rule: "r",
      sourceAuthority: "a",
      adoptionMode: "forced"
    }),
    false
  );
});

test("isEngagement accepts a minimal valid engagement", () => {
  const engagement = {
    kind: "ENGAGEMENT",
    id: "engagement:001",
    scope: "scope:engagement/ship-v1",
    charter: { goal: "ship v1" },
    roleBindings: [],
    controls: [],
    policies: [],
    successCriteria: []
  };

  assert.equal(isEngagement(engagement), true);
});

test("isAmendment accepts a minimal valid amendment", () => {
  const amendment = {
    kind: "AMENDMENT",
    id: "amendment:001",
    targetKind: "ENGAGEMENT",
    targetId: "engagement:001",
    baseArtifactHash: "sha256:aaa",
    changes: [{ op: "set", path: "/charter/goal", value: "ship v1.1" }],
    signatures: []
  };

  assert.equal(isAmendment(amendment), true);
});

test("isAmendment rejects when targetKind is not a canonical artifact kind", () => {
  assert.equal(
    isAmendment({
      kind: "AMENDMENT",
      id: "amendment:002",
      targetKind: "NOTHING",
      targetId: "x",
      baseArtifactHash: "sha256:a",
      changes: [],
      signatures: []
    }),
    false
  );
});

test("isMandate accepts a minimal valid mandate", () => {
  const mandate = {
    kind: "MANDATE",
    id: "mandate:001",
    instance: "alice@org",
    role: "CONDUCTOR",
    scope: "scope:engagement/ship-v1",
    rights: ["sign", "amend"]
  };

  assert.equal(isMandate(mandate), true);
});

test("isMandate rejects unknown roles", () => {
  assert.equal(
    isMandate({
      kind: "MANDATE",
      id: "mandate:002",
      instance: "x",
      role: "GHOST",
      scope: "s",
      rights: []
    }),
    false
  );
});

test("isAuthority accepts an instance authority", () => {
  const authority = {
    kind: "AUTHORITY",
    id: "authority:001",
    authorityKind: "instance",
    members: ["alice@org"]
  };

  assert.equal(isAuthority(authority), true);
});

test("isAuthority accepts a quorum authority with threshold", () => {
  const authority = {
    kind: "AUTHORITY",
    id: "authority:002",
    authorityKind: "quorum",
    members: ["alice@org", "bob@org", "carol@org"],
    threshold: 2
  };

  assert.equal(isAuthority(authority), true);
});

test("isAuthority rejects a quorum without a threshold", () => {
  assert.equal(
    isAuthority({
      kind: "AUTHORITY",
      id: "authority:003",
      authorityKind: "quorum",
      members: ["alice@org", "bob@org"]
    }),
    false
  );
});

test("isSignature accepts a valid signature", () => {
  assert.equal(
    isSignature({ by: "alice@org", alg: "ed25519", value: "abc" }),
    true
  );
});

test("isSignature rejects missing fields", () => {
  assert.equal(isSignature({ by: "x", alg: "ed25519" }), false);
});

test("isEnforcementPlan accepts a minimal valid plan", () => {
  const plan = {
    kind: "ENFORCEMENT_PLAN",
    id: "enforce:001",
    scope: "scope:org/antoine",
    controls: [],
    escalations: [],
    triggers: []
  };

  assert.equal(isEnforcementPlan(plan), true);
});
