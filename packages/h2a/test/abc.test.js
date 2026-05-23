import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_ABC_MODEL_IDS,
  H2A_ABC_MODEL_PROFILES,
  auditAbcModelCompatibility,
  getAbcModelProfile
} from "../dist/index.js";

test("H2A_ABC_MODEL_PROFILES exposes the three stabilized ABC mappings", () => {
  assert.deepEqual([...H2A_ABC_MODEL_IDS], [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]);

  assert.equal(
    H2A_ABC_MODEL_PROFILES.A_ENTERPRISE.label,
    "A - traditional enterprise"
  );
  assert.equal(
    H2A_ABC_MODEL_PROFILES.B_ECOSYSTEM.topology,
    "peer-federation"
  );
  assert.equal(
    H2A_ABC_MODEL_PROFILES.C_GOVERNMENT_CITIZEN.topology,
    "public-authority"
  );
});

test("getAbcModelProfile returns only known ABC profiles", () => {
  assert.equal(getAbcModelProfile("A_ENTERPRISE").track, "A");
  assert.equal(getAbcModelProfile("B_ECOSYSTEM").track, "B");
  assert.equal(getAbcModelProfile("C_GOVERNMENT_CITIZEN").track, "C");
  assert.equal(getAbcModelProfile("D_OTHER"), undefined);
});

test("auditAbcModelCompatibility validates built-in profiles against public V1 vocabulary", () => {
  for (const modelId of H2A_ABC_MODEL_IDS) {
    const result = auditAbcModelCompatibility(modelId);
    assert.equal(result.ok, true, `${modelId}: ${result.issues.join("; ")}`);
    assert.equal(result.issues.length, 0);
    assert.equal(result.modelId, modelId);
    assert.equal(result.shipped.length > 0, true);
  }
});

test("enterprise mapping keeps EXECUTIF and external authority with recurring obligations shipped", () => {
  const profile = getAbcModelProfile("A_ENTERPRISE");
  assert.equal(profile.requiredRoles.includes("EXECUTIF"), true);
  assert.equal(profile.requiredRoles.includes("CONTROL"), true);
  assert.equal(profile.escalationAuthorityKinds.includes("EXTERNAL_AUTHORITY"), true);
  assert.equal(profile.requiredPolicyAdoptionModes.includes("imposed"), true);

  const result = auditAbcModelCompatibility("A_ENTERPRISE");
  assert.equal(result.ready, false);
  assert.equal(result.shipped.includes("recurring-obligations"), true);
  assert.match(result.gaps.join("\n"), /policy precedence/);
});

test("ecosystem mapping preserves peer federation with disclosure and recourse shipped", () => {
  const profile = getAbcModelProfile("B_ECOSYSTEM");
  assert.equal(profile.topology, "peer-federation");
  assert.equal(profile.requiredRoles.includes("MANDATAIRE"), true);
  assert.equal(profile.escalationAuthorityKinds.includes("QUORUM"), true);
  assert.equal(profile.escalationAuthorityKinds.includes("RECOURSE"), true);

  const result = auditAbcModelCompatibility("B_ECOSYSTEM");
  assert.equal(result.ready, false);
  assert.equal(result.shipped.includes("controlled-disclosure"), true);
  assert.equal(result.shipped.includes("recourse"), true);
  assert.match(result.gaps.join("\n"), /policy precedence/);
});

test("government mapping preserves imposed public policy with recourse shipped", () => {
  const profile = getAbcModelProfile("C_GOVERNMENT_CITIZEN");
  assert.equal(profile.requiredPolicyAdoptionModes.includes("imposed"), true);
  assert.equal(profile.escalationAuthorityKinds.includes("EXTERNAL_AUTHORITY"), true);
  assert.equal(profile.escalationAuthorityKinds.includes("RECOURSE"), true);

  const result = auditAbcModelCompatibility("C_GOVERNMENT_CITIZEN");
  assert.equal(result.ready, false);
  assert.equal(result.shipped.includes("recourse"), true);
  assert.match(result.gaps.join("\n"), /jurisdiction/);
});

test("auditAbcModelCompatibility reports unknown ABC models without throwing", () => {
  assert.deepEqual(auditAbcModelCompatibility("D_OTHER"), {
    ok: false,
    ready: false,
    issues: ["unknown ABC model: D_OTHER"],
    gaps: [],
    shipped: [],
    partial: [],
    deferred: []
  });
});
