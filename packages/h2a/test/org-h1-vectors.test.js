/**
 * H2A-ORG-H1 r2 — the frozen M0 test vectors of the co-sign spec
 * (`spec-r4-h2a-cosign.md` §3.1–§3.2) replayed in-repo: the deterministic M0
 * keypair (seed `sha256("h2a-m0-r4-spec-principal-key-v1")`), the canonical
 * positive vectors `H1-POS-1` / `H1-REV-1` with their pinned SHA-256 digests,
 * and the `H1`-applicable negative vectors of §3.5, asserted with the
 * co-signed snake_case refusal reasons.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalize, verifyRoleScopePolicyRevocationV1, verifyRoleScopePolicyV1 } from "../dist/index.js";

/** The pinned M0 principal public key (spec §3.1 rule 4). */
const M0_PUBLIC_PEM =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAu5m/6eQPjJaZHUZBTYXR2aR81VPzBzd9qrrjK85JjFI=\n-----END PUBLIC KEY-----";

/** Canonical positive vector `H1-POS-1` (spec §3.2, SHA-256 `46d49cec…`). */
const H1_POS_1 = {
  format: "h2a.role-scope-policy/v1",
  policyId: "pol:org:h2a:arch:v1",
  actorLaunchName: "arch",
  scope: "org:h2a",
  governanceRoles: ["AGENTS"],
  allowedCliKinds: ["claude", "codex", "agy"],
  allowedModels: ["*"],
  effortCeiling: "xhigh",
  mcpRights: {
    tools: [
      "engram_memory_status",
      "engram_memory_get",
      "engram_memory_timeline",
      "engram_memory_observe",
      "artifacts_ensure",
      "artifacts_publish",
      "artifacts_list",
      "artifacts_get"
    ],
    connectorClasses: ["memory", "artifacts", "track"]
  },
  memoryScopes: ["role", "repo"],
  driveConsentClass: "bilateral-journal-v1",
  signingClass: "D1",
  validFrom: "2026-10-30T00:00:00.000Z",
  validUntil: "2027-10-30T00:00:00.000Z",
  revision: 1,
  signerInstance: "fabien",
  signerKeyId: "key:principal:fabien:ed25519:1",
  signature: "F6NXMwIfjZzY2Q9FZEjR2oYDQBwdTLAuPkZI2wcST8JbysQldNUeQCs2uZS9b1ON4w7M0Pk6+/xArH+uZRP1BQ=="
};

/** Canonical positive vector `H1-REV-1` (spec §3.2, SHA-256 `90eb46f1…`). */
const H1_REV_1 = {
  format: "h2a.role-scope-policy-revocation/v1",
  actorLaunchName: "arch",
  scope: "org:h2a",
  revokedRevision: 1,
  revokedAt: "2026-10-30T12:00:00.000Z",
  reason: "policy_superseded_or_suspended",
  signerInstance: "fabien",
  signerKeyId: "key:principal:fabien:ed25519:1",
  signature: "b3xNx6AxcTF6w0jmrVstlF9iI7meUHS4yyHeSXSpgFxlWijZE5u/kKJ6vgW0+bkIpH1pxVCmH21tkWo3Y/vkBg=="
};

function canonicalSha256(value) {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(value), "utf8")).digest("hex")}`;
}

test("H1-POS-1 verifies against the pinned M0 public key with its pinned canonical digest", () => {
  assert.equal(canonicalSha256(H1_POS_1), "sha256:46d49cec547be69d785fd7a379759737b9868c630e5da4069fb236c1258c626e");
  const check = verifyRoleScopePolicyV1(H1_POS_1, M0_PUBLIC_PEM);
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("H1-REV-1 verifies against the pinned M0 public key with its pinned canonical digest", () => {
  assert.equal(canonicalSha256(H1_REV_1), "sha256:90eb46f18689a5c449122a61c2b68a437c236871c3c0bc398f1c066b6f3c7964");
  const check = verifyRoleScopePolicyRevocationV1(H1_REV_1, M0_PUBLIC_PEM);
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("VEC-NEG-BAD-SIG — a mutated signed field refuses with bad_signature", () => {
  const tampered = { ...H1_POS_1, effortCeiling: "max" };
  assert.equal(verifyRoleScopePolicyV1(tampered, M0_PUBLIC_PEM).reason, "bad_signature");
});

test("VEC-NEG-UNKNOWN-FIELD — an extra property refuses with unknown_field", () => {
  const extra = { ...H1_POS_1, extraField: true };
  assert.equal(verifyRoleScopePolicyV1(extra, M0_PUBLIC_PEM).reason, "unknown_field");
});

test("VEC-NEG-UNKNOWN-VERSION — an unrecognized format literal refuses with unknown_version", () => {
  const v2 = { ...H1_POS_1, format: "h2a.role-scope-policy/v2" };
  assert.equal(verifyRoleScopePolicyV1(v2, M0_PUBLIC_PEM).reason, "unknown_version");
});

test("VEC-NEG-STALE-REV — a replayed revision at or below the current one refuses with stale_or_downgraded_revision", () => {
  // the store already holds verified revision 2 → importing revision 1 is a downgrade
  const check = verifyRoleScopePolicyV1(H1_POS_1, M0_PUBLIC_PEM, { minRevision: 2 });
  assert.equal(check.ok, false);
  assert.equal(check.reason, "stale_or_downgraded_revision");
  // a revision strictly above the floor still verifies
  const fresh = verifyRoleScopePolicyV1(H1_POS_1, M0_PUBLIC_PEM, { minRevision: 0 });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
});

test("VEC-NEG-REVOKED-POLICY — a verified covering revocation refuses with policy_revoked", () => {
  const check = verifyRoleScopePolicyV1(H1_POS_1, M0_PUBLIC_PEM, { revocations: [H1_REV_1] });
  assert.equal(check.ok, false);
  assert.equal(check.reason, "policy_revoked");
  // a revocation for another (actor, scope) key does not revoke this policy
  const foreign = verifyRoleScopePolicyV1(H1_POS_1, M0_PUBLIC_PEM, {
    revocations: [{ ...H1_REV_1, scope: "org:other" }]
  });
  assert.equal(foreign.ok, true, JSON.stringify(foreign));
});
