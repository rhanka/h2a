import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  createEnvelope,
  signEnvelope
} from "@sentropic/h2a";
import {
  extractSysmlRef,
  hashSysmlElement,
  verifyEnvelopeSysmlRef
} from "../dist/index.js";

const ELEMENT = { "@id": "el-42", name: "Wheel", mass: 12 };

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function signedEnvelope(privatePem, refOverrides = {}) {
  const ref = {
    kind: "sysmlv2",
    apiBase: "https://repo.example/api",
    project: "proj-1",
    commit: "c0ffee",
    element: "el-42",
    ...refOverrides
  };
  const env = createEnvelope({
    id: "env-sysml-01",
    type: "event",
    actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:model" },
    body: { kind: "ENGAGEMENT", subject: { sysmlRef: ref } }
  });
  return signEnvelope(env, { by: "conductor:01", privateKeyPem: privatePem });
}

test("extractSysmlRef pulls the ref from body.subject.sysmlRef", () => {
  const { privatePem } = keypair();
  const env = signedEnvelope(privatePem);
  const ref = extractSysmlRef(env);
  assert.equal(ref.project, "proj-1");
  assert.equal(ref.commit, "c0ffee");
});

test("commit-trust: valid signature over a valid ref → ok", async () => {
  const { privatePem, publicPem } = keypair();
  const env = signedEnvelope(privatePem);
  const r = await verifyEnvelopeSysmlRef(env, { publicKeyPem: publicPem, by: "conductor:01" });
  assert.equal(r.ok, true);
  assert.equal(r.signatureVerified, true);
  assert.equal(r.contentVerified, undefined); // commit-trust only
});

test("a tampered ref breaks the signature → not ok", async () => {
  const { privatePem, publicPem } = keypair();
  const env = signedEnvelope(privatePem);
  const tampered = {
    ...env,
    body: { ...env.body, subject: { sysmlRef: { ...env.body.subject.sysmlRef, commit: "deadbeef" } } }
  };
  const r = await verifyEnvelopeSysmlRef(tampered, { publicKeyPem: publicPem });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "signature-failed");
});

test("no ref in the envelope → no-sysml-ref", async () => {
  const { privatePem, publicPem } = keypair();
  const env = signEnvelope(
    createEnvelope({
      id: "e2",
      type: "event",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "s" },
      body: { kind: "ENGAGEMENT" }
    }),
    { by: "conductor:01", privateKeyPem: privatePem }
  );
  const r = await verifyEnvelopeSysmlRef(env, { publicKeyPem: publicPem });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-sysml-ref");
});

test("content-integrity: re-fetched element hash matches elementHash → ok", async () => {
  const { privatePem, publicPem } = keypair();
  const elementHash = hashSysmlElement(ELEMENT);
  const env = signedEnvelope(privatePem, { elementHash });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ELEMENT });
  const r = await verifyEnvelopeSysmlRef(env, {
    publicKeyPem: publicPem,
    contentIntegrity: true,
    fetchImpl
  });
  assert.equal(r.ok, true);
  assert.equal(r.contentVerified, true);
});

test("content-integrity: a repository that returns different bytes → content-hash-mismatch", async () => {
  const { privatePem, publicPem } = keypair();
  const env = signedEnvelope(privatePem, { elementHash: hashSysmlElement(ELEMENT) });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ...ELEMENT, mass: 999 }) });
  const r = await verifyEnvelopeSysmlRef(env, {
    publicKeyPem: publicPem,
    contentIntegrity: true,
    fetchImpl
  });
  assert.equal(r.ok, false);
  assert.equal(r.signatureVerified, true);
  assert.equal(r.contentVerified, false);
  assert.equal(r.reason, "content-hash-mismatch");
});

test("content-integrity without an elementHash → no-element-hash", async () => {
  const { privatePem, publicPem } = keypair();
  const env = signedEnvelope(privatePem); // no elementHash
  const r = await verifyEnvelopeSysmlRef(env, {
    publicKeyPem: publicPem,
    contentIntegrity: true,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ELEMENT })
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-element-hash");
});
