import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_ATTESTER_COMPREHENSION_RIGHT,
  H2A_COMPREHENSION_ATTESTATION_BODY_KIND,
  buildComprehensionAttestation,
  canAttestComprehension,
  computeHash,
  createEnvelope,
  isComprehensionAttestation,
  signCanonical,
  verifyComprehensionAttestation
} from "../dist/index.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

test("buildComprehensionAttestation computes comprehension of a canonical dossier hash", () => {
  const dossier = { kind: "ENGAGEMENT", id: "engagement:attn", goal: "read me" };
  const body = buildComprehensionAttestation({
    subject: "principal:1",
    dossier,
    at: "2026-05-31T00:00:00.000Z"
  });

  assert.equal(body.kind, H2A_COMPREHENSION_ATTESTATION_BODY_KIND);
  assert.equal(body.subject, "principal:1");
  assert.equal(body.dossierHash, computeHash(dossier));
  assert.equal(body.at, "2026-05-31T00:00:00.000Z");
  assert.equal(isComprehensionAttestation(body), true);
  assert.equal(isComprehensionAttestation({ ...body, kind: "attention" }), false);
  assert.equal(isComprehensionAttestation({ ...body, dossierHash: "not-a-hash" }), false);
});

test("verifyComprehensionAttestation verifies a body signature and rejects tampering", () => {
  const { privatePem, publicPem } = keypair();
  const body = buildComprehensionAttestation({
    subject: "principal:1",
    dossierHash: computeHash("exact dossier"),
    at: "2026-05-31T00:00:00.000Z"
  });
  const envelope = createEnvelope({
    id: "env-comprehension-1",
    type: "event",
    actor: { instance: "principal:1", role: "PRINCIPAL", scope: "scope:attn" },
    body,
    signatures: [signCanonical(body, { by: "principal:1", privateKeyPem: privatePem })]
  });

  assert.equal(verifyComprehensionAttestation(envelope, [publicPem]), true);
  assert.equal(
    verifyComprehensionAttestation(
      { ...envelope, body: { ...body, dossierHash: computeHash("tampered") } },
      [publicPem]
    ),
    false
  );
  assert.equal(verifyComprehensionAttestation({ ...envelope, signatures: [] }, [publicPem]), false);
});

test("canAttestComprehension is native for human deciders and mandate-gated for AGENTS", () => {
  assert.equal(canAttestComprehension("PRINCIPAL"), true);
  assert.equal(canAttestComprehension("EXECUTIF"), true);
  assert.equal(canAttestComprehension("MANDATAIRE"), true);
  assert.equal(canAttestComprehension("CONDUCTOR"), false);
  assert.equal(canAttestComprehension("CONTROL"), false);
  assert.equal(canAttestComprehension("AGENTS"), false);
  assert.equal(canAttestComprehension("AGENTS", [H2A_ATTESTER_COMPREHENSION_RIGHT]), true);
});
