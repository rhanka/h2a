import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_BLOCKAGE_BODY_KIND,
  H2A_BLOCKAGE_CLEARED_BODY_KIND,
  blockageEnvelope,
  isActiveBlockage,
  isH2AEnvelope,
  signEnvelope,
  verifyEnvelopeSignature
} from "../dist/index.js";

test("isActiveBlockage tracks the resolvedAt field", () => {
  const raised = { instance: "a", scope: "s", reason: "r", raisedAt: "2026-05-27T00:00:00.000Z" };
  assert.equal(isActiveBlockage(raised), true);
  assert.equal(isActiveBlockage({ ...raised, resolvedAt: "2026-05-27T01:00:00.000Z" }), false);
});

test("blockageEnvelope builds a verifiable event envelope (kind=blockage)", () => {
  const blockage = {
    instance: "claude:p1",
    scope: "scope:team",
    reason: "needs API token",
    needs: "someone to provision TOKEN_X",
    raisedAt: "2026-05-27T00:00:00.000Z"
  };
  const env = blockageEnvelope({
    blockage,
    actor: { instance: "claude:p1", role: "CONDUCTOR", scope: "scope:team" }
  });
  assert.ok(isH2AEnvelope(env));
  assert.equal(env.type, "event");
  assert.equal(env.body.kind, H2A_BLOCKAGE_BODY_KIND);
  assert.deepEqual(env.body.blockage, blockage);
  assert.equal(env.createdAt, blockage.raisedAt);
  assert.ok(env.id.startsWith("blockage-"));

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const signed = signEnvelope(env, { by: "claude:p1", privateKeyPem: privatePem });
  assert.equal(verifyEnvelopeSignature(signed, publicPem, { by: "claude:p1" }), true);

  const tampered = { ...signed, body: { ...signed.body, blockage: { ...blockage, reason: "different" } } };
  assert.equal(verifyEnvelopeSignature(tampered, publicPem, { by: "claude:p1" }), false);
});

test("blockageEnvelope marks the cleared kind + uses resolvedAt", () => {
  const blockage = {
    instance: "claude:p1",
    scope: "scope:team",
    reason: "needs API token",
    raisedAt: "2026-05-27T00:00:00.000Z",
    resolvedAt: "2026-05-27T02:00:00.000Z",
    resolvedBy: "principal:fab"
  };
  const env = blockageEnvelope({
    blockage,
    actor: { instance: "claude:p1", role: "CONDUCTOR", scope: "scope:team" },
    cleared: true
  });
  assert.equal(env.body.kind, H2A_BLOCKAGE_CLEARED_BODY_KIND);
  assert.equal(env.createdAt, blockage.resolvedAt);
});
