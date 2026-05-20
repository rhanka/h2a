import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_CONTRACTUAL_ARTIFACT_PROFILES,
  assertContractualArtifactInvariants,
  auditContractualArtifact,
  getContractualArtifactProfile
} from "../dist/index.js";

const contract = {
  kind: "CONTRACT",
  id: "contract:001",
  parties: ["party:alice", "party:bob"],
  scope: "scope:customer/acme",
  clauses: [],
  policies: ["policy:security"],
  engagements: ["engagement:sow-001"],
  signatures: []
};

const policy = {
  kind: "POLICY",
  id: "policy:security",
  scope: "scope:org/acme",
  rule: "no secrets in logs",
  sourceAuthority: "authority:security",
  adoptionMode: "ratified"
};

const engagement = {
  kind: "ENGAGEMENT",
  id: "engagement:sow-001",
  scope: "scope:engagement/sow-001",
  charter: { goal: "deliver the integration" },
  roleBindings: [{ role: "CONDUCTOR", instance: "conductor:01" }],
  controls: ["control:security"],
  policies: ["policy:security"],
  successCriteria: ["accepted by principal"]
};

test("H2A_CONTRACTUAL_ARTIFACT_PROFILES encodes the counter-audit distinctions", () => {
  assert.equal(
    H2A_CONTRACTUAL_ARTIFACT_PROFILES.CONTRACT.profile,
    "normative-container"
  );
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.CONTRACT.executable, false);
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.CONTRACT.canContainPolicies, true);
  assert.equal(
    H2A_CONTRACTUAL_ARTIFACT_PROFILES.CONTRACT.canInstantiateEngagements,
    true
  );

  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.POLICY.profile, "durable-rule");
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.POLICY.durable, true);
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.POLICY.executable, false);
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.POLICY.canInstantiateEngagements, false);

  assert.equal(
    H2A_CONTRACTUAL_ARTIFACT_PROFILES.ENGAGEMENT.profile,
    "operational-executable"
  );
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.ENGAGEMENT.executable, true);
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.ENGAGEMENT.canReferencePolicies, true);
  assert.equal(H2A_CONTRACTUAL_ARTIFACT_PROFILES.ENGAGEMENT.canContainPolicies, false);
});

test("getContractualArtifactProfile returns profiles only for CONTRACT/POLICY/ENGAGEMENT", () => {
  assert.equal(getContractualArtifactProfile("CONTRACT").profile, "normative-container");
  assert.equal(getContractualArtifactProfile("POLICY").profile, "durable-rule");
  assert.equal(getContractualArtifactProfile("ENGAGEMENT").profile, "operational-executable");
  assert.equal(getContractualArtifactProfile("MANDATE"), undefined);
});

test("auditContractualArtifact accepts the three non-collapsed artifacts", () => {
  assert.deepEqual(auditContractualArtifact(contract), {
    ok: true,
    kind: "CONTRACT",
    profile: "normative-container",
    issues: []
  });
  assert.deepEqual(auditContractualArtifact(policy), {
    ok: true,
    kind: "POLICY",
    profile: "durable-rule",
    issues: []
  });
  assert.deepEqual(auditContractualArtifact(engagement), {
    ok: true,
    kind: "ENGAGEMENT",
    profile: "operational-executable",
    issues: []
  });
});

test("auditContractualArtifact rejects POLICY carrying ENGAGEMENT executable fields", () => {
  const collapsed = {
    ...policy,
    charter: { goal: "do work" },
    roleBindings: [],
    successCriteria: []
  };
  const result = auditContractualArtifact(collapsed);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "POLICY");
  assert.match(result.issues.join("\n"), /POLICY must not carry ENGAGEMENT fields/);
  assert.match(result.issues.join("\n"), /charter/);
  assert.match(result.issues.join("\n"), /roleBindings/);
  assert.match(result.issues.join("\n"), /successCriteria/);
});

test("auditContractualArtifact rejects ENGAGEMENT carrying POLICY durable-rule fields", () => {
  const collapsed = {
    ...engagement,
    rule: "no secrets in logs",
    sourceAuthority: "authority:security",
    adoptionMode: "ratified"
  };
  const result = auditContractualArtifact(collapsed);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "ENGAGEMENT");
  assert.match(result.issues.join("\n"), /ENGAGEMENT must not carry POLICY fields/);
  assert.match(result.issues.join("\n"), /sourceAuthority/);
});

test("auditContractualArtifact rejects CONTRACT carrying POLICY or ENGAGEMENT fields", () => {
  const collapsed = {
    ...contract,
    rule: "no secrets in logs",
    charter: { goal: "do work" }
  };
  const result = auditContractualArtifact(collapsed);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "CONTRACT");
  assert.match(result.issues.join("\n"), /CONTRACT must not carry POLICY fields/);
  assert.match(result.issues.join("\n"), /CONTRACT must not carry ENGAGEMENT fields/);
});

test("auditContractualArtifact rejects non-contractual artifact kinds", () => {
  const result = auditContractualArtifact({
    kind: "MANDATE",
    id: "mandate:001",
    instance: "human:alice",
    role: "CONDUCTOR",
    scope: "scope:x",
    rights: []
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "MANDATE");
  assert.match(result.issues.join("\n"), /not a contractual artifact kind/);
});

test("assertContractualArtifactInvariants throws with all audit issues", () => {
  assert.doesNotThrow(() => assertContractualArtifactInvariants(contract));
  assert.throws(
    () => assertContractualArtifactInvariants({ ...policy, charter: {} }),
    /POLICY must not carry ENGAGEMENT fields: charter/
  );
});
