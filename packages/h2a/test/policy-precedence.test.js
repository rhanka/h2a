import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_POLICY_PRECEDENCE_PROFILES,
  H2A_POLICY_PRECEDENCE_TIERS,
  auditAbcModelCompatibility,
  auditPolicyPrecedenceProfile,
  getPolicyPrecedenceProfile
} from "../dist/index.js";

test("H2A_POLICY_PRECEDENCE_TIERS covers the four V1 policy sources", () => {
  assert.deepEqual([...H2A_POLICY_PRECEDENCE_TIERS].sort(), [
    "contractual",
    "federated",
    "local",
    "public-authority"
  ]);
});

test("policy precedence profiles are declared for the three ABC contexts", () => {
  assert.deepEqual(Object.keys(H2A_POLICY_PRECEDENCE_PROFILES).sort(), [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]);

  const enterprise = getPolicyPrecedenceProfile("A_ENTERPRISE");
  assert.equal(enterprise?.modelId, "A_ENTERPRISE");
  assert.equal(enterprise?.conflictDisposition, "escalate-not-resolve");
  assert.deepEqual(enterprise?.orderedTiers, [
    "public-authority",
    "contractual",
    "local",
    "federated"
  ]);

  const ecosystem = getPolicyPrecedenceProfile("B_ECOSYSTEM");
  assert.deepEqual(ecosystem?.orderedTiers, [
    "public-authority",
    "contractual",
    "federated",
    "local"
  ]);

  assert.equal(getPolicyPrecedenceProfile("unknown"), undefined);
});

test("auditPolicyPrecedenceProfile validates explicit order without resolving conflicts", () => {
  const result = auditPolicyPrecedenceProfile("C_GOVERNMENT_CITIZEN");

  assert.equal(result.ok, true);
  assert.equal(result.resolvesConflicts, false);
  assert.equal(result.profileId, "C_GOVERNMENT_CITIZEN");
  assert.deepEqual(result.issues, []);
  assert.match(result.unresolved.join("\n"), /does not select a winning policy/);
});

test("ABC compatibility reports policy precedence as partial, not hidden engine-ready", () => {
  const result = auditAbcModelCompatibility("A_ENTERPRISE");

  assert.equal(result.ok, true);
  assert.equal(result.partial.includes("policy-precedence"), true);
  assert.equal(result.deferred.includes("policy-precedence"), false);
  assert.match(result.gaps.join("\n"), /policy precedence profiles are declared/);
  assert.match(result.gaps.join("\n"), /no V1 resolver/);
});
