/**
 * In-memory fake trunk endpoint and enrolment verifier (LH-00 / LH-06 / LH-07).
 *
 * TEST-ONLY: lives under test/helpers, outside dist/, and is never re-exported
 * from the package root. Both fakes refuse unless the LH-00 flag is on AND
 * the test harness explicitly sealed them in with `H2A_TEST_FAKES=1` AND the
 * fixture contract version matches the pinned WET-2 text hash — the production
 * flag alone can never open them.
 */

import { createPublicKey } from "node:crypto";
import { isRemoteControlEnabled, REMOTE_CONTROL_DISABLED_REASON } from "../../dist/runtime/remote-agent/flag.js";
import {
  TRUNK_PROTOCOL_VERSION,
  canonicalTrunkJson,
  verifyTrunkAuthPayload
} from "../../dist/runtime/remote-agent/types.js";

const TEST_FAKES_ENV = "H2A_TEST_FAKES";
const FAKES_SEALED_REASON = "fakes-sealed";
const WET2_HASH_MISMATCH_REASON = "wet2-hash-mismatch";
const OPERATE_ASSURANCE_CLIENT = "urn:sentropic:loa:passkey-fresh";
const OPERATE_ASSURANCE_FACTORS = ["hwk", "user", "mfa"];
const REMOTE_CLIENT = "remote";
const AUTH_TIME_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * SHA-256 of the LF-normalized UTF-8 bytes of SPEC_EVOL_REMOTE_FASTLANE.md (r11)
 * from the section 6 heading (`## 6. `) inclusive through the section 7 heading
 * (`## 7. `) exclusive.
 */
export const WET2_CONTRACT_VERSION = "WET-2.1";
export const WET2_TEXT_HASH =
  "b3c8a8fa7f3eff0c7066d0618c6d4fae1ce7f018e4ce58439e0598f23975035c";

export const FIXTURE_CONTRACT_METADATA = Object.freeze({
  contractVersion: WET2_CONTRACT_VERSION,
  wet2TextHash: WET2_TEXT_HASH
});

export const FIXTURE_METADATA = FIXTURE_CONTRACT_METADATA;

export function assertFixtureContractVersion(metadata) {
  const actual = metadata?.wet2TextHash;
  if (actual !== WET2_TEXT_HASH) {
    return {
      ok: false,
      reason: WET2_HASH_MISMATCH_REASON,
      expected: WET2_TEXT_HASH,
      actual
    };
  }
  return { ok: true, wet2TextHash: WET2_TEXT_HASH };
}

function assertSealed(env, wet2TextHash = WET2_TEXT_HASH) {
  if (!isRemoteControlEnabled(env)) return { ok: false, reason: REMOTE_CONTROL_DISABLED_REASON };
  if (env[TEST_FAKES_ENV] !== "1") return { ok: false, reason: FAKES_SEALED_REASON };
  if (wet2TextHash !== WET2_TEXT_HASH) return { ok: false, reason: WET2_HASH_MISMATCH_REASON };
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
  #wet2TextHash;
  #keys = new Map();
  #challenges = new Map();
  #links = new Map();
  #liveGenByScope = new Map();
  #generation = 0;

  constructor(options) {
    this.#tenantId = options.tenantId;
    this.#endpoint = options.endpoint;
    this.#meshId = options.meshId;
    this.#env = options.env ?? process.env;
    this.#wet2TextHash = options.wet2TextHash ?? WET2_TEXT_HASH;
  }

  metadata() {
    return Object.freeze({
      contractVersion: WET2_CONTRACT_VERSION,
      wet2TextHash: this.#wet2TextHash
    });
  }

  wet2TextHash() {
    return this.#wet2TextHash;
  }

  registerFixtureKey(input) {
    const publicKey = toPublicKey(input.publicKeyPem);
    this.#keys.set(input.enrolmentRef, {
      nodeId: input.nodeId,
      publicKey,
      enrolmentRef: input.enrolmentRef,
      userId: input.userId ?? "owner",
      fingerprint: input.fingerprint ?? "fixture-fingerprint",
      revoked: Boolean(input.revoked),
      notProvisioned: Boolean(input.notProvisioned),
      renewBy: input.renewBy,
      usages: input.usages
    });
  }

  revokeEnrolment(enrolmentRef) {
    const fixture = this.#keys.get(enrolmentRef);
    if (fixture) fixture.revoked = true;
  }

  issueChallenge(challenge) {
    if (challenge.meshId !== this.#meshId) return { ok: false, reason: "mesh-mismatch" };
    if (challenge.tenantId !== this.#tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (challenge.endpoint !== this.#endpoint) return { ok: false, reason: "endpoint-mismatch" };
    this.#challenges.set(challenge.nonce, { challenge, used: false });
    return { ok: true, challenge };
  }

  openLink(input) {
    const sealed = assertSealed(this.#env, this.#wet2TextHash);
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
    if (fixture.notProvisioned) return { ok: false, reason: "not-provisioned" };
    if (fixture.revoked) return { ok: false, reason: "enrolment-revoked" };
    if (fixture.nodeId !== input.payload.nodeId) return { ok: false, reason: "identity-mismatch" };
    if (fixture.renewBy !== undefined && input.now !== undefined && input.now > fixture.renewBy) {
      return { ok: false, reason: "record-expired" };
    }
    if (!verifyTrunkAuthPayload(input.payload, input.signature, fixture.publicKey)) {
      return { ok: false, reason: "invalid-signature" };
    }
    stored.used = true;
    const scopeKey = `${this.#meshId}|${this.#tenantId}|${fixture.userId}|${input.payload.nodeId}|${input.payload.enrolmentRef}`;
    let supersededGeneration;
    const previousGen = this.#liveGenByScope.get(scopeKey);
    if (previousGen !== undefined && this.#links.has(previousGen)) {
      const prevLink = this.#links.get(previousGen);
      this.#links.delete(previousGen);
      supersededGeneration = previousGen;
      if (typeof prevLink.onSuperseded === "function") {
        prevLink.onSuperseded(previousGen);
      }
    }
    this.#generation += 1;
    this.#links.set(this.#generation, {
      linkGeneration: this.#generation,
      scopeKey,
      userId: fixture.userId,
      nodeId: input.payload.nodeId,
      enrolmentRef: input.payload.enrolmentRef,
      onSuperseded: input.onSuperseded
    });
    this.#liveGenByScope.set(scopeKey, this.#generation);
    return {
      ok: true,
      linkGeneration: this.#generation,
      ...(supersededGeneration !== undefined ? { supersededGeneration } : {})
    };
  }

  closeLink(linkGeneration) {
    const existing = this.#links.get(linkGeneration);
    if (!existing) return false;
    this.#links.delete(linkGeneration);
    if (this.#liveGenByScope.get(existing.scopeKey) === linkGeneration) {
      this.#liveGenByScope.delete(existing.scopeKey);
    }
    return true;
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
  #wet2TextHash;
  #nodes = new Map();
  #consumedNonces = new Set();
  #verified = new Set();

  constructor(options) {
    this.#tenantId = options.tenantId;
    this.#endpoint = options.endpoint;
    this.#meshId = options.meshId;
    this.#env = options.env ?? process.env;
    this.#wet2TextHash = options.wet2TextHash ?? WET2_TEXT_HASH;
  }

  metadata() {
    return Object.freeze({
      contractVersion: WET2_CONTRACT_VERSION,
      wet2TextHash: this.#wet2TextHash
    });
  }

  wet2TextHash() {
    return this.#wet2TextHash;
  }

  registerNode(input) {
    const publicKey = toPublicKey(input.publicKeyPem);
    const publicKeyPem = publicKeyPemOf(publicKey);
    this.#nodes.set(input.nodeId, { publicKey, publicKeyPem, fingerprint: input.fingerprint, revoked: false, approved: false });
  }

  verifyRequest(input) {
    const sealed = assertSealed(this.#env, this.#wet2TextHash);
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
    const sealed = assertSealed(this.#env, this.#wet2TextHash);
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

/**
 * Simulated trunk contract provider for catalogue framing (LH-06 / LH-07).
 * Encodes a logical snapshot (<= 256 KiB) into a prefix `cat.snapshot` plus
 * trailing `cat.delta` (`adds`) records, each <= `maxCatalogueRecordBytes`
 * (8192 by default in the test provider).
 */
export function createFakeCatalogueTrunkProvider(options = {}) {
  const env = options.env ?? process.env;
  const wet2TextHash = options.wet2TextHash ?? WET2_TEXT_HASH;
  const maxCatalogueRecordBytes = options.maxCatalogueRecordBytes ?? 8192;
  const metadata = Object.freeze({ contractVersion: WET2_CONTRACT_VERSION, wet2TextHash });

  function encodeLogicalSnapshot(snapshot, { startS = 1, ch = snapshot.ch ?? 1 } = {}) {
    const sealed = assertSealed(env, wet2TextHash);
    if (!sealed.ok) return { ...sealed, records: [], nextS: startS };

    const allRows = [...snapshot.rows];
    const truncatedRows = snapshot.truncatedRows ?? 0;
    const records = [];
    let s = startS;

    // 1. Largest prefix fitting in `cat.snapshot`
    const firstRows = [];
    let cursor = 0;
    while (cursor < allRows.length) {
      const candidate = {
        v: TRUNK_PROTOCOL_VERSION,
        t: "cat.snapshot",
        ch,
        s,
        at: snapshot.at,
        rows: [...firstRows, allRows[cursor]],
        truncatedRows
      };
      if (Buffer.byteLength(canonicalTrunkJson(candidate), "utf8") > maxCatalogueRecordBytes) {
        break;
      }
      firstRows.push(allRows[cursor]);
      cursor += 1;
    }
    const snapRecord = {
      v: TRUNK_PROTOCOL_VERSION,
      t: "cat.snapshot",
      ch,
      s,
      at: snapshot.at,
      rows: firstRows,
      truncatedRows
    };
    if (Buffer.byteLength(canonicalTrunkJson(snapRecord), "utf8") > maxCatalogueRecordBytes) {
      return { ok: false, reason: "record-too-large", records: [], nextS: startS };
    }
    records.push(snapRecord);
    s += 1;

    // 2. Remaining rows as `cat.delta` with `adds`
    while (cursor < allRows.length) {
      const batch = [];
      while (cursor < allRows.length) {
        const candidate = {
          v: TRUNK_PROTOCOL_VERSION,
          t: "cat.delta",
          ch,
          s,
          at: snapshot.at,
          adds: [...batch, allRows[cursor]],
          updates: [],
          removes: []
        };
        if (Buffer.byteLength(canonicalTrunkJson(candidate), "utf8") > maxCatalogueRecordBytes) {
          break;
        }
        batch.push(allRows[cursor]);
        cursor += 1;
      }
      if (batch.length === 0) {
        return { ok: false, reason: "record-too-large", records: [], nextS: startS };
      }
      records.push({
        v: TRUNK_PROTOCOL_VERSION,
        t: "cat.delta",
        ch,
        s,
        at: snapshot.at,
        adds: batch,
        updates: [],
        removes: []
      });
      s += 1;
    }

    return { ok: true, records, nextS: s };
  }

  return {
    maxCatalogueRecordBytes,
    metadata,
    encodeLogicalSnapshot
  };
}
