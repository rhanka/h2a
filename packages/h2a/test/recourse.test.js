import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_RECOURSE_PROFILES,
  H2A_RECOURSE_STATES,
  auditAbcModelCompatibility,
  auditRecourseProfile,
  getRecourseProfile
} from "../dist/index.js";

test("H2A_RECOURSE_STATES covers the V1 recourse lifecycle", () => {
  assert.deepEqual([...H2A_RECOURSE_STATES].sort(), [
    "accepted",
    "adjudicating",
    "appealed",
    "closed",
    "decided",
    "dismissed",
    "requested"
  ]);
});

test("recourse profiles are declared for the three ABC contexts", () => {
  assert.deepEqual(Object.keys(H2A_RECOURSE_PROFILES).sort(), [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN",
    "D_SAFE"
  ]);

  const enterprise = getRecourseProfile("A_ENTERPRISE");
  assert.equal(enterprise?.defaultDeciderKind, "PRINCIPAL");
  assert.equal(enterprise?.appealable, true);
  assert.deepEqual(enterprise?.allowedDeciderKinds, [
    "PRINCIPAL",
    "CONTROL",
    "EXTERNAL_AUTHORITY"
  ]);

  const ecosystem = getRecourseProfile("B_ECOSYSTEM");
  assert.equal(ecosystem?.defaultDeciderKind, "QUORUM");
  assert.equal(ecosystem?.allowedDeciderKinds.includes("PRINCIPAL"), false);
  assert.equal(ecosystem?.allowedDeciderKinds.includes("EXTERNAL_AUTHORITY"), true);

  const publicAuthority = getRecourseProfile("C_GOVERNMENT_CITIZEN");
  assert.equal(publicAuthority?.defaultDeciderKind, "EXTERNAL_AUTHORITY");
  assert.equal(publicAuthority?.allowedDeciderKinds.includes("RECOURSE"), true);

  assert.equal(getRecourseProfile("unknown"), undefined);
});

test("auditRecourseProfile validates lifecycle + deciders without adjudicating", () => {
  const result = auditRecourseProfile("B_ECOSYSTEM");

  assert.equal(result.ok, true);
  assert.equal(result.adjudicatesDecisions, false);
  assert.equal(result.profileId, "B_ECOSYSTEM");
  assert.equal(result.defaultDeciderKind, "QUORUM");
  assert.equal(result.appealable, true);
  assert.deepEqual(result.issues, []);
  assert.match(result.unresolved.join("\n"), /V1 does not adjudicate/);
});

test("auditRecourseProfile rejects unknown ids", () => {
  const result = auditRecourseProfile("Z_UNKNOWN");

  assert.equal(result.ok, false);
  assert.equal(result.adjudicatesDecisions, false);
  assert.equal(result.profileId, undefined);
  assert.match(result.issues.join("\n"), /unknown recourse profile/);
});

test("ABC compatibility reports recourse as shipped via DEC-046", () => {
  for (const modelId of [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]) {
    const result = auditAbcModelCompatibility(modelId);
    assert.equal(result.ok, true, `${modelId} ok`);
    assert.equal(
      result.shipped.includes("recourse"),
      true,
      `${modelId} recourse shipped`
    );
    assert.equal(
      result.partial.includes("recourse"),
      false,
      `${modelId} recourse not partial`
    );
  }
});
