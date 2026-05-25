import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  createEnvelope,
  signEnvelope,
  verifyEnvelopeSignature
} from "../dist/index.js";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

const baseEnvelope = () =>
  createEnvelope({
    id: "env-1",
    type: "propose",
    actor: { instance: "claude:proj-1", role: "AGENTS", scope: "scope:demo" },
    body: { offer: 1 },
    createdAt: "2026-05-25T00:00:00.000Z"
  });

test("signEnvelope appends a signature without mutating the original (DEC-073)", () => {
  const { privateKeyPem } = keypair();
  const env = baseEnvelope();
  const signed = signEnvelope(env, { by: "claude:proj-1", privateKeyPem });
  assert.equal(env.signatures, undefined); // original untouched
  assert.equal(signed.signatures.length, 1);
  assert.equal(signed.signatures[0].by, "claude:proj-1");
  assert.equal(signed.signatures[0].alg, "ed25519");
});

test("verifyEnvelopeSignature accepts a valid signature", () => {
  const { privateKeyPem, publicKeyPem } = keypair();
  const signed = signEnvelope(baseEnvelope(), { by: "claude:proj-1", privateKeyPem });
  assert.equal(verifyEnvelopeSignature(signed, publicKeyPem), true);
  assert.equal(
    verifyEnvelopeSignature(signed, publicKeyPem, { by: "claude:proj-1" }),
    true
  );
});

test("verification fails against the wrong key", () => {
  const signer = keypair();
  const other = keypair();
  const signed = signEnvelope(baseEnvelope(), {
    by: "claude:proj-1",
    privateKeyPem: signer.privateKeyPem
  });
  assert.equal(verifyEnvelopeSignature(signed, other.publicKeyPem), false);
});

test("verification fails when the signed content was tampered", () => {
  const { privateKeyPem, publicKeyPem } = keypair();
  const signed = signEnvelope(baseEnvelope(), { by: "claude:proj-1", privateKeyPem });
  const tampered = { ...signed, body: { offer: 999 } };
  assert.equal(verifyEnvelopeSignature(tampered, publicKeyPem), false);
});

test("the signatures array is excluded from the signed view (stable across signers)", () => {
  const a = keypair();
  const b = keypair();
  const once = signEnvelope(baseEnvelope(), { by: "a", privateKeyPem: a.privateKeyPem });
  const twice = signEnvelope(once, { by: "b", privateKeyPem: b.privateKeyPem });
  assert.equal(twice.signatures.length, 2);
  // both signatures still verify, each against its own key, despite the second
  // signing over an envelope that already carried the first signature
  assert.equal(verifyEnvelopeSignature(twice, a.publicKeyPem, { by: "a" }), true);
  assert.equal(verifyEnvelopeSignature(twice, b.publicKeyPem, { by: "b" }), true);
});

test("verification of an unsigned envelope is false", () => {
  const { publicKeyPem } = keypair();
  assert.equal(verifyEnvelopeSignature(baseEnvelope(), publicKeyPem), false);
});

test("filtering by an unknown signer yields false", () => {
  const { privateKeyPem, publicKeyPem } = keypair();
  const signed = signEnvelope(baseEnvelope(), { by: "claude:proj-1", privateKeyPem });
  assert.equal(verifyEnvelopeSignature(signed, publicKeyPem, { by: "nobody" }), false);
});
