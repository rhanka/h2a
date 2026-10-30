/**
 * H2A-ORG-H1 — the signed role/scope policy vocabulary (r2 §2.6) in its §8.1
 * H1 wire shape: a deterministic builder, an ed25519 signer over the canonical
 * bytes of the document excluding `signature`, and a total verifier whose
 * named refusals match the M0 vector set (bad signature; unknown field;
 * unknown version; stale revision; revoked policy). Also covers the pure
 * ratification verifier behind the `h2a org provision` fail-closed gate: an
 * unratified or badly signed `org-ratified` envelope creates no rights.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_ORG_PROPOSAL_BODY_KIND,
  H2A_ORG_RATIFIED_BODY_KIND,
  H2A_ROLE_SCOPE_POLICY_FORMAT,
  H2A_ROLE_SCOPE_POLICY_REVOCATION_FORMAT,
  buildRoleScopePolicyRevocationV1,
  buildRoleScopePolicyV1,
  isRoleScopePolicyRevoked,
  orgAssignmentEnvelope,
  signEnvelope,
  signRoleScopePolicyRevocationV1,
  signRoleScopePolicyV1,
  validateOrgManifest,
  verifyOrgRatification,
  verifyRoleScopePolicyRevocationV1,
  verifyRoleScopePolicyV1
} from "../dist/index.js";

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function policyInput(overrides = {}) {
  return {
    actorLaunchName: "dev-1",
    scope: "org:acme",
    governanceRoles: ["AGENTS"],
    allowedCliKinds: ["claude", "codex"],
    allowedModels: ["muse-spark-1.3"],
    effortCeiling: "high",
    mcpRights: { tools: ["engram_memory_status"], connectorClasses: ["memory"] },
    memoryScopes: ["role"],
    driveConsentClass: "pair-time-scoped",
    signingClass: "D2",
    validFrom: "2026-10-30T00:00:00.000Z",
    revision: 1,
    signerInstance: "claude:lead",
    signerKeyId: "sha256:abcd1234",
    ...overrides
  };
}

test("buildRoleScopePolicyV1 is deterministic — same input, same document and policyId", () => {
  const a = buildRoleScopePolicyV1(policyInput());
  const b = buildRoleScopePolicyV1(policyInput());
  assert.deepEqual(a, b);
  assert.equal(a.format, H2A_ROLE_SCOPE_POLICY_FORMAT);
  assert.equal(a.policyId, b.policyId);
  assert.ok(a.policyId.startsWith("sha256:"));
  // a different (actor, scope, revision) key is a different policy document
  const c = buildRoleScopePolicyV1(policyInput({ revision: 2 }));
  assert.notEqual(c.policyId, a.policyId);
});

test("buildRoleScopePolicyV1 defaults omitted ceilings to empty arrays (none)", () => {
  const p = buildRoleScopePolicyV1(
    policyInput({
      governanceRoles: undefined,
      allowedCliKinds: undefined,
      allowedModels: undefined,
      effortCeiling: undefined,
      mcpRights: undefined,
      memoryScopes: undefined
    })
  );
  assert.deepEqual(p.governanceRoles, []);
  assert.deepEqual(p.allowedCliKinds, []);
  assert.deepEqual(p.allowedModels, []);
  assert.deepEqual(p.memoryScopes, []);
  assert.deepEqual(p.mcpRights, { tools: [], connectorClasses: [] });
  assert.equal("effortCeiling" in p, false);
});

test("buildRoleScopePolicyV1 refuses contract-violating inputs", () => {
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ revision: 0 })), /revision/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ revision: 1.5 })), /revision/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ signingClass: "D9" })), /signingClass/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ memoryScopes: ["team"] })), /memoryScopes/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ actorLaunchName: "" })), /actorLaunchName/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ scope: "" })), /scope/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ driveConsentClass: "" })), /driveConsentClass/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ validFrom: "" })), /validFrom/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ signerInstance: "" })), /signerInstance/);
  assert.throws(() => buildRoleScopePolicyV1(policyInput({ signerKeyId: "" })), /signerKeyId/);
});

test("signRoleScopePolicyV1 refuses a signer that is not the document's signerInstance", () => {
  const { privatePem } = keys();
  const unsigned = buildRoleScopePolicyV1(policyInput());
  assert.throws(
    () => signRoleScopePolicyV1(unsigned, { by: "claude:coach", privateKeyPem: privatePem }),
    /does not match signerInstance/
  );
});

test("sign → verify round-trip against the signer's public key", () => {
  const { privatePem, publicPem } = keys();
  const signed = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput()), {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  assert.equal(typeof signed.signature, "string");
  assert.notEqual(signed.signature, "");
  const check = verifyRoleScopePolicyV1(signed, publicPem);
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("tampering with any signed field refuses with bad-signature", () => {
  const { privatePem, publicPem } = keys();
  const signed = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput()), {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  const tampered = { ...signed, actorLaunchName: "someone-else" };
  assert.equal(verifyRoleScopePolicyV1(tampered, publicPem).reason, "bad-signature");
});

test("verifying against a foreign key refuses with bad-signature", () => {
  const a = keys();
  const b = keys();
  const signed = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput()), {
    by: "claude:lead",
    privateKeyPem: a.privatePem
  });
  assert.equal(verifyRoleScopePolicyV1(signed, b.publicPem).reason, "bad-signature");
});

test("an unknown field refuses with unknown-field", () => {
  const { privatePem, publicPem } = keys();
  const signed = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput()), {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  const extra = { ...signed, extraField: "nope" };
  assert.equal(verifyRoleScopePolicyV1(extra, publicPem).reason, "unknown-field");
});

test("an unknown version refuses with unknown-version", () => {
  const { privatePem, publicPem } = keys();
  const signed = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput()), {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  const v2 = { ...signed, format: "h2a.role-scope-policy/v2" };
  assert.equal(verifyRoleScopePolicyV1(v2, publicPem).reason, "unknown-version");
});

test("a missing required field refuses with missing-field", () => {
  const { privatePem, publicPem } = keys();
  const signed = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput()), {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  const { mcpRights: _drop, ...noRights } = signed;
  assert.equal(verifyRoleScopePolicyV1(noRights, publicPem).reason, "missing-field");
});

test("revision 0 refuses with stale-revision", () => {
  const { privatePem, publicPem } = keys();
  const unsigned = buildRoleScopePolicyV1(policyInput());
  const zeroed = signRoleScopePolicyV1({ ...unsigned, revision: 0 }, {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  assert.equal(verifyRoleScopePolicyV1(zeroed, publicPem).reason, "stale-revision");
});

test("a non-object refuses with not-an-object", () => {
  assert.equal(verifyRoleScopePolicyV1("nope", "pem").reason, "not-an-object");
  assert.equal(verifyRoleScopePolicyV1(null, "pem").reason, "not-an-object");
});

test("revocation: build → sign → verify round-trip; tampering refuses", () => {
  const { privatePem, publicPem } = keys();
  const unsigned = buildRoleScopePolicyRevocationV1({
    actorLaunchName: "dev-1",
    scope: "org:acme",
    revokedRevision: 3,
    revokedAt: "2026-10-30T00:00:00.000Z",
    reason: "rotated key set",
    signerInstance: "claude:lead",
    signerKeyId: "sha256:abcd1234"
  });
  const signed = signRoleScopePolicyRevocationV1(unsigned, {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  assert.equal(signed.format, H2A_ROLE_SCOPE_POLICY_REVOCATION_FORMAT);
  const check = verifyRoleScopePolicyRevocationV1(signed, publicPem);
  assert.equal(check.ok, true, JSON.stringify(check));
  const tampered = { ...signed, revokedRevision: 4 };
  assert.equal(verifyRoleScopePolicyRevocationV1(tampered, publicPem).reason, "bad-signature");
  const unknown = { ...signed, format: "h2a.role-scope-policy-revocation/v2" };
  assert.equal(verifyRoleScopePolicyRevocationV1(unknown, publicPem).reason, "unknown-version");
});

test("isRoleScopePolicyRevoked — a matching revocation revokes; stale, foreign or unverifiable ones do not", () => {
  const { privatePem, publicPem } = keys();
  const policy = signRoleScopePolicyV1(buildRoleScopePolicyV1(policyInput({ revision: 3 })), {
    by: "claude:lead",
    privateKeyPem: privatePem
  });
  const revocation = (overrides = {}) =>
    signRoleScopePolicyRevocationV1(
      buildRoleScopePolicyRevocationV1({
        actorLaunchName: "dev-1",
        scope: "org:acme",
        revokedRevision: 3,
        revokedAt: "2026-10-30T00:00:00.000Z",
        reason: "offboarded",
        signerInstance: "claude:lead",
        signerKeyId: "sha256:abcd1234",
        ...overrides
      }),
      { by: "claude:lead", privateKeyPem: privatePem }
    );

  assert.deepEqual(isRoleScopePolicyRevoked(policy, revocation(), publicPem), { revoked: true });
  // a revocation below the policy revision is stale — the policy still stands
  assert.deepEqual(isRoleScopePolicyRevoked(policy, revocation({ revokedRevision: 2 }), publicPem), {
    revoked: false,
    reason: "stale-revocation"
  });
  // a revocation for another (actor, scope) key does not touch this policy
  assert.deepEqual(isRoleScopePolicyRevoked(policy, revocation({ scope: "org:other" }), publicPem), {
    revoked: false,
    reason: "wrong-policy"
  });
  // a revocation that does not verify grants nothing
  const other = keys();
  const foreignSigned = signRoleScopePolicyRevocationV1(
    buildRoleScopePolicyRevocationV1({
      actorLaunchName: "dev-1",
      scope: "org:acme",
      revokedRevision: 3,
      revokedAt: "2026-10-30T00:00:00.000Z",
      reason: "offboarded",
      signerInstance: "claude:lead",
      signerKeyId: "sha256:abcd1234"
    }),
    { by: "claude:lead", privateKeyPem: other.privatePem }
  );
  assert.deepEqual(isRoleScopePolicyRevoked(policy, foreignSigned, publicPem), {
    revoked: false,
    reason: "bad-revocation"
  });
});

// ---------------------------------------------------------------------------
// The pure verifier behind the `h2a org provision` ratification gate.
// ---------------------------------------------------------------------------

function committedManifest() {
  return {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "codex:dev-1", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
}

function ratifiedEnvelope(manifest, overrides = {}) {
  const {
    by = "claude:lead",
    role = "PRINCIPAL",
    kind = H2A_ORG_RATIFIED_BODY_KIND,
    key = keys()
  } = overrides;
  const envelope = orgAssignmentEnvelope({
    manifest,
    actor: { instance: by, role, scope: manifest.scope },
    kind,
    createdAt: "2026-10-30T00:00:00.000Z"
  });
  return { envelope: signEnvelope(envelope, { by, privateKeyPem: key.privatePem }), key };
}

test("verifyOrgRatification — a PRINCIPAL-signed org-ratified envelope over the committed manifest verifies", () => {
  const manifest = committedManifest();
  const { envelope, key } = ratifiedEnvelope(manifest);
  const check = verifyOrgRatification({
    envelope,
    committedManifest: manifest,
    publicKeysFor: () => [key.publicPem]
  });
  assert.equal(check.ok, true);
  assert.equal(check.actor, "claude:lead");
});

test("verifyOrgRatification — a proposal envelope is not a ratification (wrong-kind)", () => {
  const manifest = committedManifest();
  const { envelope, key } = ratifiedEnvelope(manifest, { kind: H2A_ORG_PROPOSAL_BODY_KIND });
  const check = verifyOrgRatification({
    envelope,
    committedManifest: manifest,
    publicKeysFor: () => [key.publicPem]
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "wrong-kind");
});

test("verifyOrgRatification — a CONDUCTOR cannot ratify (wrong-actor-role)", () => {
  const manifest = committedManifest();
  const { envelope, key } = ratifiedEnvelope(manifest, { role: "CONDUCTOR" });
  const check = verifyOrgRatification({
    envelope,
    committedManifest: manifest,
    publicKeysFor: () => [key.publicPem]
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "wrong-actor-role");
});

test("verifyOrgRatification — an edited committed manifest creates no rights (manifest-mismatch)", () => {
  const manifest = committedManifest();
  const { envelope, key } = ratifiedEnvelope(manifest);
  const edited = {
    ...manifest,
    instances: [
      ...manifest.instances,
      { instance: "codex:dev-2", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const check = verifyOrgRatification({
    envelope,
    committedManifest: edited,
    publicKeysFor: () => [key.publicPem]
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "manifest-mismatch");
});

test("verifyOrgRatification — the ratifier must be a declared PRINCIPAL of the ratified org", () => {
  const manifest = committedManifest();
  const { envelope, key } = ratifiedEnvelope(manifest, { by: "codex:dev-1" });
  const check = verifyOrgRatification({
    envelope,
    committedManifest: manifest,
    publicKeysFor: () => [key.publicPem]
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "actor-not-declared-principal");
});

test("verifyOrgRatification — an envelope whose manifest violates the invariants refuses (invalid-manifest)", () => {
  const broken = {
    scope: "org:acme",
    instances: [{ instance: "codex:dev-1", role: "AGENTS", scopes: ["org:acme"] }]
  };
  const { envelope, key } = ratifiedEnvelope(broken);
  const check = verifyOrgRatification({
    envelope,
    committedManifest: broken,
    publicKeysFor: () => [key.publicPem]
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "invalid-manifest");
});

test("verifyOrgRatification — no registered keys → signer-not-registered", () => {
  const manifest = committedManifest();
  const { envelope } = ratifiedEnvelope(manifest);
  const check = verifyOrgRatification({
    envelope,
    committedManifest: manifest,
    publicKeysFor: () => []
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "signer-not-registered");
});

test("verifyOrgRatification — a signature by an unregistered key refuses (bad-signature)", () => {
  const manifest = committedManifest();
  const signing = keys();
  const registered = keys();
  const { envelope } = ratifiedEnvelope(manifest, { key: signing });
  const check = verifyOrgRatification({
    envelope,
    committedManifest: manifest,
    publicKeysFor: () => [registered.publicPem]
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "bad-signature");
});

test("verifyOrgRatification — garbage is not an envelope (not-an-envelope)", () => {
  const check = verifyOrgRatification({
    envelope: { hello: "world" },
    committedManifest: committedManifest(),
    publicKeysFor: () => []
  });
  assert.equal(check.ok, false);
  assert.equal(check.refusal, "not-an-envelope");
});

test("verifyOrgRatification is consistent with validateOrgManifest on the committed shape", () => {
  // sanity: the fixture manifest used above satisfies the invariants
  assert.equal(validateOrgManifest(committedManifest()).ok, true);
});
