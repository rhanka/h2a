import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_DISCLOSURE_MODES,
  H2A_DISCLOSURE_PROFILES,
  auditAbcModelCompatibility,
  auditDisclosureProfile,
  getDisclosureProfile
} from "../dist/index.js";

test("H2A_DISCLOSURE_MODES covers the six V1 disclosure projections", () => {
  assert.deepEqual([...H2A_DISCLOSURE_MODES].sort(), [
    "attestation",
    "denied",
    "evidence-package",
    "full-view",
    "hash-only",
    "redacted-view"
  ]);
});

test("disclosure profiles are declared for the three ABC contexts", () => {
  assert.deepEqual(Object.keys(H2A_DISCLOSURE_PROFILES).sort(), [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]);

  const enterprise = getDisclosureProfile("A_ENTERPRISE");
  assert.equal(enterprise?.modelId, "A_ENTERPRISE");
  assert.equal(enterprise?.conflictDisposition, "escalate-not-resolve");
  assert.equal(enterprise?.defaultMode, "redacted-view");
  assert.deepEqual(enterprise?.allowedModes, [
    "full-view",
    "redacted-view",
    "evidence-package",
    "attestation",
    "hash-only"
  ]);

  const ecosystem = getDisclosureProfile("B_ECOSYSTEM");
  assert.equal(ecosystem?.defaultMode, "evidence-package");
  assert.equal(ecosystem?.allowedModes.includes("full-view"), false);
  assert.deepEqual(ecosystem?.allowedModes, [
    "redacted-view",
    "evidence-package",
    "attestation",
    "hash-only"
  ]);

  const publicAuthority = getDisclosureProfile("C_GOVERNMENT_CITIZEN");
  assert.equal(publicAuthority?.defaultMode, "evidence-package");
  assert.equal(publicAuthority?.allowedModes.includes("full-view"), true);

  assert.equal(getDisclosureProfile("unknown"), undefined);
});

test("auditDisclosureProfile validates allowed modes without producing projections", () => {
  const result = auditDisclosureProfile("C_GOVERNMENT_CITIZEN");

  assert.equal(result.ok, true);
  assert.equal(result.producesProjection, false);
  assert.equal(result.profileId, "C_GOVERNMENT_CITIZEN");
  assert.equal(result.defaultMode, "evidence-package");
  assert.deepEqual(result.issues, []);
  assert.match(result.unresolved.join("\n"), /V1 does not produce projections/);
});

test("auditDisclosureProfile rejects unknown ids", () => {
  const result = auditDisclosureProfile("Z_UNKNOWN");

  assert.equal(result.ok, false);
  assert.equal(result.producesProjection, false);
  assert.equal(result.profileId, undefined);
  assert.match(result.issues.join("\n"), /unknown disclosure profile/);
});

test("ABC compatibility reports controlled-disclosure as shipped via DEC-045", () => {
  for (const modelId of [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]) {
    const result = auditAbcModelCompatibility(modelId);
    assert.equal(result.ok, true, `${modelId} ok`);
    assert.equal(
      result.shipped.includes("controlled-disclosure"),
      true,
      `${modelId} controlled-disclosure shipped`
    );
    assert.equal(
      result.partial.includes("controlled-disclosure"),
      false,
      `${modelId} controlled-disclosure not partial`
    );
  }
});
