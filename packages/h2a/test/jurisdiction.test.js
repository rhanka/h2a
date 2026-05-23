import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_JURISDICTION_KINDS,
  H2A_JURISDICTION_PROFILES,
  auditAbcModelCompatibility,
  auditJurisdictionProfile,
  getJurisdictionProfile
} from "../dist/index.js";

test("H2A_JURISDICTION_KINDS covers the V1 jurisdiction kinds", () => {
  assert.deepEqual([...H2A_JURISDICTION_KINDS].sort(), [
    "delegated",
    "functional",
    "personal",
    "private-contract",
    "sectoral",
    "temporal",
    "territorial"
  ]);
});

test("jurisdiction profiles are declared for the three ABC contexts", () => {
  assert.deepEqual(Object.keys(H2A_JURISDICTION_PROFILES).sort(), [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]);

  const enterprise = getJurisdictionProfile("A_ENTERPRISE");
  assert.equal(enterprise?.defaultKind, "private-contract");
  assert.equal(enterprise?.allowedKinds.includes("personal"), false);
  assert.equal(enterprise?.allowedKinds.includes("temporal"), false);

  const ecosystem = getJurisdictionProfile("B_ECOSYSTEM");
  assert.equal(ecosystem?.defaultKind, "delegated");
  assert.equal(ecosystem?.allowedKinds.includes("territorial"), true);

  const publicAuthority = getJurisdictionProfile("C_GOVERNMENT_CITIZEN");
  assert.equal(publicAuthority?.defaultKind, "territorial");
  assert.equal(publicAuthority?.allowedKinds.includes("personal"), true);
  assert.equal(publicAuthority?.allowedKinds.includes("temporal"), true);
  assert.equal(publicAuthority?.allowedKinds.includes("private-contract"), false);

  assert.equal(getJurisdictionProfile("unknown"), undefined);
});

test("auditJurisdictionProfile validates allowed kinds without checking membership", () => {
  const result = auditJurisdictionProfile("C_GOVERNMENT_CITIZEN");

  assert.equal(result.ok, true);
  assert.equal(result.checksMembership, false);
  assert.equal(result.profileId, "C_GOVERNMENT_CITIZEN");
  assert.equal(result.defaultKind, "territorial");
  assert.deepEqual(result.issues, []);
  assert.match(result.unresolved.join("\n"), /V1 does not check membership/);
});

test("auditJurisdictionProfile rejects unknown ids", () => {
  const result = auditJurisdictionProfile("Z_UNKNOWN");

  assert.equal(result.ok, false);
  assert.equal(result.checksMembership, false);
  assert.equal(result.profileId, undefined);
  assert.match(result.issues.join("\n"), /unknown jurisdiction profile/);
});

test("ABC compatibility reports jurisdiction as shipped via DEC-048", () => {
  for (const modelId of [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]) {
    const result = auditAbcModelCompatibility(modelId);
    assert.equal(result.ok, true, `${modelId} ok`);
    assert.equal(
      result.shipped.includes("jurisdiction"),
      true,
      `${modelId} jurisdiction shipped`
    );
    assert.equal(
      result.partial.includes("jurisdiction"),
      false,
      `${modelId} jurisdiction not partial`
    );
  }
});
