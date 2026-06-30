import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  createEnvelope,
  createReplayGuard,
  signEnvelope
} from "@sentropic/h2a";
import { acceptRemoteEnvelope } from "../dist/index.js";

const T0 = Date.parse("2026-05-25T12:00:00.000Z");

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

const SIGNER = "claude:proj-1";
const RECIPIENT = "codex:proj-2";

function makeEnvelope(over = {}) {
  return createEnvelope({
    id: over.id ?? "env-r1",
    type: "propose",
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    target: { instance: RECIPIENT },
    body: { offer: 1 },
    createdAt: over.createdAt ?? new Date(T0).toISOString()
  });
}

function harness(extra = {}) {
  const { privateKeyPem, publicKeyPem } = keypair();
  const delivered = [];
  const options = {
    resolvePublicKeys: (who) => (who === SIGNER ? [publicKeyPem] : []),
    guard: createReplayGuard(),
    deliver: (recipient, env) => delivered.push({ recipient, env }),
    now: T0,
    ...extra
  };
  return { privateKeyPem, publicKeyPem, delivered, options };
}

test("accepts a well-formed, signed, fresh envelope and delivers it (DEC-075)", () => {
  const h = harness();
  const signed = signEnvelope(makeEnvelope(), { by: SIGNER, privateKeyPem: h.privateKeyPem });
  const res = acceptRemoteEnvelope(signed, h.options);
  assert.equal(res.ok, true);
  assert.equal(res.deliveredTo, RECIPIENT);
  assert.equal(res.signer, SIGNER);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0].recipient, RECIPIENT);
  assert.equal(h.delivered[0].env.id, "env-r1");
});

test("rejects a non-envelope payload as malformed", () => {
  const h = harness();
  const res = acceptRemoteEnvelope({ not: "an envelope" }, h.options);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "malformed");
  assert.equal(h.delivered.length, 0);
});

test("rejects an envelope with no delivery target", () => {
  const h = harness();
  const env = createEnvelope({
    id: "no-tgt",
    type: "propose",
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    body: {},
    createdAt: new Date(T0).toISOString()
  });
  const signed = signEnvelope(env, { by: SIGNER, privateKeyPem: h.privateKeyPem });
  const res = acceptRemoteEnvelope(signed, h.options);
  assert.equal(res.reason, "no-target");
});

test("rejects an unsigned envelope", () => {
  const h = harness();
  const res = acceptRemoteEnvelope(makeEnvelope(), h.options);
  assert.equal(res.reason, "no-signature");
});

test("rejects when the signer's public key is unknown", () => {
  const h = harness({ resolvePublicKeys: () => [] });
  const signed = signEnvelope(makeEnvelope(), { by: SIGNER, privateKeyPem: h.privateKeyPem });
  const res = acceptRemoteEnvelope(signed, h.options);
  assert.equal(res.reason, "no-public-key");
});

test("rejects a signature that does not verify (wrong key)", () => {
  const h = harness();
  const attacker = keypair();
  const signed = signEnvelope(makeEnvelope(), {
    by: SIGNER,
    privateKeyPem: attacker.privateKeyPem
  });
  const res = acceptRemoteEnvelope(signed, h.options);
  assert.equal(res.reason, "bad-signature");
  assert.equal(h.delivered.length, 0);
});

test("rejects a tampered body even with a real signature on the original", () => {
  const h = harness();
  const signed = signEnvelope(makeEnvelope(), { by: SIGNER, privateKeyPem: h.privateKeyPem });
  const tampered = { ...signed, body: { offer: 9999 } };
  const res = acceptRemoteEnvelope(tampered, h.options);
  assert.equal(res.reason, "bad-signature");
});

test("rejects a replayed envelope on second receipt", () => {
  const h = harness();
  const signed = signEnvelope(makeEnvelope(), { by: SIGNER, privateKeyPem: h.privateKeyPem });
  assert.equal(acceptRemoteEnvelope(signed, h.options).ok, true);
  const second = acceptRemoteEnvelope(signed, h.options);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "replayed");
  assert.equal(h.delivered.length, 1); // not delivered twice
});

test("rejects a stale envelope (freshness window)", () => {
  const h = harness();
  const old = makeEnvelope({ id: "stale", createdAt: new Date(T0 - 10 * 60_000).toISOString() });
  const signed = signEnvelope(old, { by: SIGNER, privateKeyPem: h.privateKeyPem });
  const res = acceptRemoteEnvelope(signed, h.options);
  assert.equal(res.reason, "expired");
  assert.equal(h.delivered.length, 0);
});
