import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_ORG_PROPOSAL_BODY_KIND,
  H2A_ORG_RATIFIED_BODY_KIND,
  isH2AEnvelope,
  orgAssignmentEnvelope,
  signEnvelope,
  validateOrgManifest,
  verifyEnvelopeSignature
} from "../dist/index.js";

function validManifest() {
  return {
    scope: "org:acme",
    version: "1",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:coach", role: "CONDUCTOR", scopes: ["org:acme", "org:acme/build"] },
      { instance: "claude:dev-1", role: "AGENTS", scopes: ["org:acme/build"], mandateRights: ["read", "write"] }
    ],
    commEdges: [
      { from: "claude:coach", to: "claude:dev-1" },
      { from: "claude:coach", to: "claude:lead" }
    ]
  };
}

test("a valid manifest passes with no errors", () => {
  const result = validateOrgManifest(validManifest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("missing PRINCIPAL → no-principal", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:coach", role: "CONDUCTOR", scopes: ["org:acme"] },
      { instance: "claude:dev-1", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("no-principal"));
});

test("duplicate instance id → duplicate-instance", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:lead", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("duplicate-instance"));
});

test("empty instance id → instance-empty", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-empty"));
});

test("instance with no scope → instance-no-scope", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:dev-1", role: "AGENTS", scopes: [] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-no-scope"));
});

test("non-canonical role → instance-bad-role", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:dev-1", role: "BOSS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-bad-role"));
});

test("commEdge to an unknown instance → edge-unknown-instance", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] }
    ],
    commEdges: [{ from: "claude:lead", to: "claude:ghost" }]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("edge-unknown-instance"));
});

test("orgAssignmentEnvelope builds an event envelope; defaults to org-proposal", () => {
  const manifest = validManifest();
  const envelope = orgAssignmentEnvelope({
    manifest,
    actor: { instance: "claude:coach", role: "CONDUCTOR", scope: "org:acme" },
    createdAt: "2026-05-28T00:00:00.000Z"
  });
  assert.ok(isH2AEnvelope(envelope));
  assert.equal(envelope.type, "event");
  assert.equal(envelope.actor.instance, "claude:coach");
  assert.equal(envelope.actor.role, "CONDUCTOR");
  assert.equal(envelope.body.kind, H2A_ORG_PROPOSAL_BODY_KIND);
  assert.deepEqual(envelope.body.manifest, manifest);
  assert.equal(envelope.createdAt, "2026-05-28T00:00:00.000Z");
  assert.ok(envelope.id.startsWith("org-"));
  assert.equal(envelope.signatures, undefined);
});

test("orgAssignmentEnvelope honors an explicit org-ratified kind", () => {
  const envelope = orgAssignmentEnvelope({
    manifest: validManifest(),
    actor: { instance: "claude:lead", role: "PRINCIPAL", scope: "org:acme" },
    kind: H2A_ORG_RATIFIED_BODY_KIND
  });
  assert.equal(envelope.body.kind, H2A_ORG_RATIFIED_BODY_KIND);
});

test("a proposal signs + verifies (round-trip); tampering with the manifest breaks it", () => {
  const manifest = validManifest();
  const envelope = orgAssignmentEnvelope({
    manifest,
    actor: { instance: "claude:coach", role: "CONDUCTOR", scope: "org:acme" },
    createdAt: "2026-05-28T00:00:00.000Z"
  });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const signed = signEnvelope(envelope, { by: "claude:coach", privateKeyPem: privatePem });
  assert.equal(signed.signatures.length, 1);
  assert.equal(verifyEnvelopeSignature(signed, publicPem, { by: "claude:coach" }), true);

  // Tampering with the manifest breaks verification.
  const tampered = {
    ...signed,
    body: {
      ...signed.body,
      manifest: { ...signed.body.manifest, scope: "org:evil" }
    }
  };
  assert.equal(verifyEnvelopeSignature(tampered, publicPem, { by: "claude:coach" }), false);
});
