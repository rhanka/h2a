/**
 * In-memory fake trunk endpoint and enrolment verifier (LH-00).
 *
 * TEST-ONLY: lives under test/helpers, outside dist/, and is never re-exported
 * from the package root. Both fakes refuse unless the LH-00 flag is on AND
 * the test harness explicitly sealed them in with `H2A_TEST_FAKES=1` — the
 * production flag alone can never open them. The trunk fake binds the
 * signature to the full challenge (WET-2 clause 17) and consumes each
 * challenge nonce once; the enrolment fake checks the flag, binds
 * (meshId, tenantId, endpoint), consumes nonces, requires a prior
 * proof-of-possession `verifyRequest` before `approve`, and enforces the
 * clause 12 assurance, client binding and 10-minute `authTime` bound.
 */

import { createPublicKey } from "node:crypto";
import { isRemoteControlEnabled, REMOTE_CONTROL_DISABLED_REASON } from "../../dist/runtime/remote-agent/flag.js";
import { verifyTrunkAuthPayload } from "../../dist/runtime/remote-agent/types.js";

const TEST_FAKES_ENV = "H2A_TEST_FAKES";
const FAKES_SEALED_REASON = "fakes-sealed";
const OPERATE_ASSURANCE_CLIENT = "urn:sentropic:loa:passkey-fresh";
const OPERATE_ASSURANCE_FACTORS = ["hwk", "user", "mfa"];
const REMOTE_CLIENT = "remote";
const AUTH_TIME_MAX_AGE_MS = 10 * 60 * 1000;

function assertSealed(env) {
  if (!isRemoteControlEnabled(env)) return { ok: false, reason: REMOTE_CONTROL_DISABLED_REASON };
  if (env[TEST_FAKES_ENV] !== "1") return { ok: false, reason: FAKES_SEALED_REASON };
  return { ok: true };
}

function toPublicKey(publicKeyPem) {
  return typeof publicKeyPem === "string" ? createPublicKey(publicKeyPem) : publicKeyPem;
}

function publicKeyPemOf(key) {
  return key.export({ type: "spki", format: "pem" }).trim();
}

export class FakeTrunkEndpoint {
  #tenantId;
  #endpoint;
  #meshId;
  #env;
  #keys = new Map();
  #challenges = new Map();
  #links = new Map();
  #generation = 0;

  constructor(options) {
    this.#tenantId = options.tenantId;
    this.#endpoint = options.endpoint;
    this.#meshId = options.meshId;
    this.#env = options.env ?? process.env;
  }

  registerFixtureKey(input) {
    const publicKey = toPublicKey(input.publicKeyPem);
    this.#keys.set(input.enrolmentRef, {
      nodeId: input.nodeId,
      publicKey,
      enrolmentRef: input.enrolmentRef,
      fingerprint: input.fingerprint ?? "fixture-fingerprint"
    });
  }

  issueChallenge(challenge) {
    if (challenge.meshId !== this.#meshId) return { ok: false, reason: "mesh-mismatch" };
    if (challenge.tenantId !== this.#tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (challenge.endpoint !== this.#endpoint) return { ok: false, reason: "endpoint-mismatch" };
    this.#challenges.set(challenge.nonce, { challenge, used: false });
    return { ok: true, challenge };
  }

  openLink(input) {
    const sealed = assertSealed(this.#env);
    if (!sealed.ok) return sealed;
    const stored = this.#challenges.get(input.payload.nonce);
    if (!stored) return { ok: false, reason: "unknown-challenge" };
    if (stored.used) return { ok: false, reason: "challenge-replayed" };
    // The presented challenge must be the issued one, field for field: a
    // challenge relayed to another tenant, mesh or endpoint never opens.
    const expected = stored.challenge;
    const given = input.challenge;
    if (
      given.nonce !== expected.nonce ||
      given.meshId !== expected.meshId ||
      given.tenantId !== expected.tenantId ||
      given.endpoint !== expected.endpoint ||
      given.serverTime !== expected.serverTime ||
      given.nodeId !== expected.nodeId ||
      given.enrolmentRef !== expected.enrolmentRef
    ) {
      return { ok: false, reason: "challenge-mismatch" };
    }
    if (input.payload.meshId !== this.#meshId) return { ok: false, reason: "mesh-mismatch" };
    if (input.payload.tenantId !== this.#tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (input.payload.endpoint !== this.#endpoint) return { ok: false, reason: "endpoint-mismatch" };
    if (input.payload.serverTime !== expected.serverTime) return { ok: false, reason: "challenge-mismatch" };
    if (input.payload.nodeId !== expected.nodeId || input.payload.enrolmentRef !== expected.enrolmentRef) {
      return { ok: false, reason: "identity-mismatch" };
    }
    const fixture = this.#keys.get(input.payload.enrolmentRef);
    if (!fixture) return { ok: false, reason: "unknown-enrolment" };
    if (fixture.nodeId !== input.payload.nodeId) return { ok: false, reason: "identity-mismatch" };
    if (!verifyTrunkAuthPayload(input.payload, input.signature, fixture.publicKey)) {
      return { ok: false, reason: "invalid-signature" };
    }
    stored.used = true;
    this.#generation += 1;
    this.#links.set(this.#generation, { linkGeneration: this.#generation, nodeId: input.payload.nodeId, enrolmentRef: input.payload.enrolmentRef });
    return { ok: true, linkGeneration: this.#generation };
  }

  liveLinkCount() {
    return this.#links.size;
  }
}

export class FakeEnrolmentVerifier {
  #tenantId;
  #endpoint;
  #meshId;
  #env;
  #nodes = new Map();
  #consumedNonces = new Set();
  #verified = new Set();

  constructor(options) {
    this.#tenantId = options.tenantId;
    this.#endpoint = options.endpoint;
    this.#meshId = options.meshId;
    this.#env = options.env ?? process.env;
  }

  registerNode(input) {
    const publicKey = toPublicKey(input.publicKeyPem);
    const publicKeyPem = publicKeyPemOf(publicKey);
    this.#nodes.set(input.nodeId, { publicKey, publicKeyPem, fingerprint: input.fingerprint, revoked: false, approved: false });
  }

  verifyRequest(input) {
    const sealed = assertSealed(this.#env);
    if (!sealed.ok) return sealed;
    const node = this.#nodes.get(input.payload.nodeId);
    if (!node) return { ok: false, reason: "unknown-node" };
    if (node.revoked) return { ok: false, reason: "node-revoked" };
    if (this.#meshId !== undefined && input.payload.meshId !== this.#meshId) return { ok: false, reason: "mesh-mismatch" };
    if (input.payload.tenantId !== this.#tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (input.payload.endpoint !== this.#endpoint) return { ok: false, reason: "endpoint-mismatch" };
    let presentedPem;
    try {
      presentedPem = publicKeyPemOf(toPublicKey(input.payload.publicKeyPem));
    } catch {
      return { ok: false, reason: "key-mismatch" };
    }
    if (presentedPem !== node.publicKeyPem) return { ok: false, reason: "key-mismatch" };
    if (this.#consumedNonces.has(input.payload.nonce)) return { ok: false, reason: "nonce-replayed" };
    const payloadRecord = {
      nodeId: input.payload.nodeId,
      publicKeyPem: input.payload.publicKeyPem,
      deviceName: input.payload.deviceName,
      nonce: input.payload.nonce,
      meshId: input.payload.meshId,
      tenantId: input.payload.tenantId,
      endpoint: input.payload.endpoint
    };
    if (!verifyTrunkAuthPayload(payloadRecord, input.signature, node.publicKey)) {
      return { ok: false, reason: "invalid-signature" };
    }
    this.#consumedNonces.add(input.payload.nonce);
    this.#verified.add(input.payload.nodeId);
    return { ok: true };
  }

  approve(input) {
    const sealed = assertSealed(this.#env);
    if (!sealed.ok) return sealed;
    const node = this.#nodes.get(input.nodeId);
    if (!node) return { ok: false, reason: "unknown-node" };
    if (node.revoked) return { ok: false, reason: "node-revoked" };
    // Proof of possession first: `approve` without a prior successful
    // `verifyRequest` for this node is refused.
    if (!this.#verified.has(input.nodeId)) return { ok: false, reason: "not-verified" };
    const now = input.now ?? Date.now();
    const authTimeAgeMs = now - input.approval.authTime;
    if (!Number.isFinite(authTimeAgeMs) || authTimeAgeMs < 0 || authTimeAgeMs > AUTH_TIME_MAX_AGE_MS) {
      return { ok: false, reason: "approval-stale" };
    }
    if (input.usages.some((usage) => usage.startsWith("sessions.")) && input.approval.client !== REMOTE_CLIENT) {
      return { ok: false, reason: "client-mismatch" };
    }
    if (input.usages.includes("sessions.operate")) {
      if (input.approval.acr !== OPERATE_ASSURANCE_CLIENT) return { ok: false, reason: "assurance-insufficient" };
      for (const factor of OPERATE_ASSURANCE_FACTORS) {
        if (!input.approval.amr.includes(factor)) return { ok: false, reason: "assurance-insufficient" };
      }
    }
    node.approved = true;
    return { ok: true };
  }

  isLive(nodeId) {
    const node = this.#nodes.get(nodeId);
    return node !== undefined && node.approved && !node.revoked;
  }

  revoke(input) {
    const node = this.#nodes.get(input.nodeId);
    if (node) node.revoked = true;
  }

  tenantId() {
    return this.#tenantId;
  }

  endpoint() {
    return this.#endpoint;
  }

  meshId() {
    return this.#meshId;
  }
}
