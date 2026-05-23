import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_OBLIGATION_CADENCES,
  H2A_RECURRING_OBLIGATION_PROFILES,
  auditAbcModelCompatibility,
  auditRecurringObligationProfile,
  getRecurringObligationProfile
} from "../dist/index.js";

test("H2A_OBLIGATION_CADENCES covers the V1 cadence kinds", () => {
  assert.deepEqual([...H2A_OBLIGATION_CADENCES].sort(), [
    "ad-hoc",
    "daily",
    "monthly",
    "on-event",
    "quarterly",
    "weekly",
    "yearly"
  ]);
});

test("recurring obligation profiles are declared for the three ABC contexts", () => {
  assert.deepEqual(Object.keys(H2A_RECURRING_OBLIGATION_PROFILES).sort(), [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]);

  const enterprise = getRecurringObligationProfile("A_ENTERPRISE");
  assert.equal(enterprise?.defaultCadence, "monthly");
  assert.equal(enterprise?.defaultGraceDays, 7);
  assert.equal(enterprise?.defaultReportingThresholdDays, 3);

  const ecosystem = getRecurringObligationProfile("B_ECOSYSTEM");
  assert.equal(ecosystem?.defaultCadence, "quarterly");
  assert.equal(ecosystem?.allowedCadences.includes("daily"), false);
  assert.equal(ecosystem?.allowedCadences.includes("ad-hoc"), true);

  const publicAuthority = getRecurringObligationProfile("C_GOVERNMENT_CITIZEN");
  assert.equal(publicAuthority?.defaultCadence, "yearly");
  assert.equal(publicAuthority?.defaultGraceDays, 30);

  assert.equal(getRecurringObligationProfile("unknown"), undefined);
});

test("auditRecurringObligationProfile validates cadence + thresholds without scheduling", () => {
  const result = auditRecurringObligationProfile("A_ENTERPRISE");

  assert.equal(result.ok, true);
  assert.equal(result.schedulesExecutions, false);
  assert.equal(result.profileId, "A_ENTERPRISE");
  assert.equal(result.defaultCadence, "monthly");
  assert.equal(result.defaultGraceDays, 7);
  assert.equal(result.defaultReportingThresholdDays, 3);
  assert.deepEqual(result.issues, []);
  assert.match(result.unresolved.join("\n"), /V1 does not schedule/);
});

test("auditRecurringObligationProfile rejects unknown ids", () => {
  const result = auditRecurringObligationProfile("Z_UNKNOWN");

  assert.equal(result.ok, false);
  assert.equal(result.schedulesExecutions, false);
  assert.equal(result.profileId, undefined);
  assert.match(result.issues.join("\n"), /unknown recurring obligation profile/);
});

test("ABC compatibility reports recurring-obligations as shipped via DEC-047", () => {
  for (const modelId of [
    "A_ENTERPRISE",
    "B_ECOSYSTEM",
    "C_GOVERNMENT_CITIZEN"
  ]) {
    const result = auditAbcModelCompatibility(modelId);
    assert.equal(result.ok, true, `${modelId} ok`);
    assert.equal(
      result.shipped.includes("recurring-obligations"),
      true,
      `${modelId} recurring-obligations shipped`
    );
    assert.equal(
      result.partial.includes("recurring-obligations"),
      false,
      `${modelId} recurring-obligations not partial`
    );
  }
});
