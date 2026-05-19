import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";

import { signCanonical, verifyCanonical } from "../dist/index.js";

function generateEd25519Pem() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

test("signCanonical produces an ed25519 signature with the canonical payload as input", () => {
  const { privateKeyPem } = generateEd25519Pem();
  const value = { id: "engagement:001", scope: "scope:x", goal: "ship" };

  const sig = signCanonical(value, { by: "alice@org", privateKeyPem });

  assert.equal(sig.by, "alice@org");
  assert.equal(sig.alg, "ed25519");
  assert.match(sig.value, /^[A-Za-z0-9+/]+={0,2}$/);
});

test("verifyCanonical accepts a signature produced by the matching private key", () => {
  const { privateKeyPem, publicKeyPem } = generateEd25519Pem();
  const value = { id: "engagement:002", goal: "ship-v1" };

  const sig = signCanonical(value, { by: "alice@org", privateKeyPem });
  assert.equal(verifyCanonical(value, sig, publicKeyPem), true);
});

test("verifyCanonical rejects a tampered value", () => {
  const { privateKeyPem, publicKeyPem } = generateEd25519Pem();
  const value = { id: "engagement:003", goal: "ship-v1" };

  const sig = signCanonical(value, { by: "alice@org", privateKeyPem });
  const tampered = { ...value, goal: "abort" };
  assert.equal(verifyCanonical(tampered, sig, publicKeyPem), false);
});

test("verifyCanonical rejects a signature verified with the wrong public key", () => {
  const a = generateEd25519Pem();
  const b = generateEd25519Pem();
  const value = { id: "engagement:004" };

  const sig = signCanonical(value, { by: "alice@org", privateKeyPem: a.privateKeyPem });
  assert.equal(verifyCanonical(value, sig, b.publicKeyPem), false);
});

test("signCanonical is deterministic for ed25519 (same input → same signature)", () => {
  const { privateKeyPem } = generateEd25519Pem();
  const value = { a: 1, b: 2 };

  const s1 = signCanonical(value, { by: "alice@org", privateKeyPem });
  const s2 = signCanonical(value, { by: "alice@org", privateKeyPem });
  assert.equal(s1.value, s2.value);
});

test("verifyCanonical is insensitive to object key order (canonicalization)", () => {
  const { privateKeyPem, publicKeyPem } = generateEd25519Pem();
  const value = { b: 2, a: 1 };

  const sig = signCanonical(value, { by: "alice@org", privateKeyPem });
  assert.equal(verifyCanonical({ a: 1, b: 2 }, sig, publicKeyPem), true);
});

test("verifyCanonical rejects unknown algorithm signatures", () => {
  const { publicKeyPem } = generateEd25519Pem();
  assert.equal(
    verifyCanonical({ a: 1 }, { by: "x", alg: "rsa-pss", value: "AAA" }, publicKeyPem),
    false
  );
});
