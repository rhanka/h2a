import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACTION_TTL_MS,
  CONSERVATIVE_SKEW_MS,
  canonicalJson,
  digestDomain,
} from "./remote-action-contract.js";
import {
  createPinnedTrust,
  type PinnedTrust,
} from "./remote-action-trust.js";
import { evaluateAdmissionDeadline } from "./remote-action-clock.js";
import { parseActionRouteRecord } from "./remote-action-api.js";
import {
  VerifyError,
  verifyActionEnvelope,
  verifyIdpEvidenceJws,
  verifyNoncePublication,
} from "./remote-action-verifier.js";

const NOW_MS = 1793520000000;

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function unpadded(input: string): string {
  return input.replace(/=+$/, "");
}

interface MintedKeys {
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  spkiBase64: string;
}

function mintKeys(): MintedKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, spkiBase64: der.toString("base64") };
}

function signingInput(kind: string, body: Record<string, unknown>): Buffer {
  return Buffer.concat([
    Buffer.from(`sentropic.remote-action-v1/${kind}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(body), "utf8"),
  ]);
}

function signBody(
  body: Record<string, unknown>,
  privateKey: MintedKeys["privateKey"],
): { body: Record<string, unknown>; signature: { alg: string; value: string } } {
  const signature = sign(null, signingInput(body["kind"] as string, body), privateKey);
  return {
    body,
    signature: { alg: "Ed25519", value: unpadded(b64url(signature)) },
  };
}

function mintTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appMeshId: "mesh-a",
    sourceMeshId: "mesh-b",
    nativeAudience: "aud-b",
    registrationId: "reg-1",
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    bindingId: "binding-1",
    sourceId: "source-1",
    sourceSessionId: "session-1",
    nativeSessionId: "cli-1",
    sourceGeneration: 3,
    bootGeneration: 7,
    custodyEpoch: 1,
    controllerEpoch: 2,
    connectionId: "conn-1",
    connectionGeneration: 4,
    ...overrides,
  };
}

interface Fixture {
  trust: PinnedTrust;
  source: MintedKeys;
  workload: MintedKeys;
  idp: MintedKeys;
  attestation: MintedKeys;
  target: Record<string, unknown>;
}

function mintFixture(): Fixture {
  const source = mintKeys();
  const workload = mintKeys();
  const idp = mintKeys();
  const attestation = mintKeys();
  const target = mintTarget();
  const trust = createPinnedTrust([
    {
      kid: "test-source",
      issuer: "test-source-issuer",
      audience: "test-b-audience",
      purposes: ["nonce-publication", "cli-session-proof", "action-claim", "result"],
      publicKeySpkiBase64: source.spkiBase64,
      revoked: false,
      fixtureOnly: false,
    },
    {
      kid: "test-a-workload",
      issuer: "test-a-mesh",
      audience: "test-b-audience",
      purposes: ["action-envelope"],
      publicKeySpkiBase64: workload.spkiBase64,
      revoked: false,
      fixtureOnly: false,
    },
    {
      kid: "test-idp",
      issuer: "test-idp",
      audience: "test-b-audience",
      purposes: ["evidence"],
      publicKeySpkiBase64: idp.spkiBase64,
      revoked: false,
      fixtureOnly: false,
    },
    {
      kid: "test-a-att",
      issuer: "test-a-mesh",
      audience: "test-b-audience",
      purposes: ["session-attestation"],
      publicKeySpkiBase64: attestation.spkiBase64,
      revoked: false,
      fixtureOnly: false,
    },
  ]);
  return { trust, source, workload, idp, attestation, target };
}

function mintNonceBody(target: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "remote-action-v1",
    kind: "nonce-publication",
    issuer: "test-source-issuer",
    kid: "test-source",
    audience: "test-b-audience",
    nonceId: "nonce-1",
    nonce: unpadded(b64url("0123456789abcdef0123456789abcdef")),
    target,
    cliSessionProofDigest: "a".repeat(64),
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 59000,
    allowedOperations: ["input"],
  };
}

function mintEnvelopeBody(target: Record<string, unknown>): Record<string, unknown> {
  const payload = {
    bytesBase64: Buffer.from("hello\n", "utf8").toString("base64"),
    byteLength: 6,
    appendNewline: true,
  };
  return {
    version: "remote-action-v1",
    kind: "action-envelope",
    issuer: "test-a-mesh",
    kid: "test-a-workload",
    audience: "test-b-audience",
    actionId: "action-1",
    target,
    originAudience: "aud-a",
    destinationAudience: "aud-b",
    actor: { issuer: "test-idp", sub: "user-1", sid: "sid-1", sessionVersion: 1 },
    sessionEvidence: "header.payload.signature",
    sessionEvidenceDigest: "b".repeat(64),
    cliSessionProof: { version: "remote-action-v1", kind: "cli-session-proof" },
    cliSessionProofDigest: "c".repeat(64),
    sessionAttestation: { version: "remote-action-v1", kind: "session-attestation" },
    consentRevision: 1,
    operation: "input",
    payload,
    payloadDigest: digestDomain("input", Buffer.from("hello\n", "utf8")),
    nonceId: "nonce-1",
    nonce: unpadded(b64url("0123456789abcdef0123456789abcdef")),
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 29000,
    contractRevision: "remote-action-v1",
    capabilitiesDigest: "d".repeat(64),
  };
}

function mintEvidenceJws(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
): string {
  const iatSec = Math.floor(NOW_MS / 1000) - 10;
  const payload = {
    iss: "test-idp",
    sub: "user-1",
    sid: "sid-1",
    sessionVersion: 1,
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    auth_time: iatSec - 5,
    amr: ["pwd", "mfa"],
    aud: "test-b-audience",
    iat: iatSec,
    exp: iatSec + 60,
    jti: "jti-1",
    actionId: "action-1",
    targetDigest: "e".repeat(64),
    operation: "input",
    payloadDigest: "f".repeat(64),
    nonceId: "nonce-1",
    ...overrides,
  };
  const header = { alg: "EdDSA", typ: "h2a-action-session+jwt", kid: "test-idp" };
  const signing = `${b64url(canonicalJson(header))}.${b64url(canonicalJson(payload))}`;
  const signature = sign(null, Buffer.from(signing, "utf8"), fixture.idp.privateKey);
  return `${signing}.${unpadded(b64url(signature))}`;
}

function opts(fixture: Fixture) {
  return {
    trust: fixture.trust,
    expectedAudience: "test-b-audience",
    nowMs: NOW_MS,
    clockKnown: true,
    clockRollback: false,
  };
}

describe("remote-action verifier", () => {
  it("accepts a validly signed nonce publication", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    const body = verifyNoncePublication(record, opts(fixture));
    expect(body["nonceId"]).toBe("nonce-1");
  });

  it("accepts a validly signed action envelope", () => {
    const fixture = mintFixture();
    const record = signBody(mintEnvelopeBody(fixture.target), fixture.workload.privateKey);
    const body = verifyActionEnvelope(record, opts(fixture));
    expect(body["actionId"]).toBe("action-1");
  });

  it("accepts a valid IdP evidence JWS", () => {
    const fixture = mintFixture();
    const claims = verifyIdpEvidenceJws(mintEvidenceJws(fixture), opts(fixture));
    expect(claims["actionId"]).toBe("action-1");
  });

  it("refuses a tampered signature", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    const tampered = {
      ...record,
      signature: { alg: "Ed25519", value: `A${record.signature.value.slice(1)}` },
    };
    expect(() => verifyNoncePublication(tampered, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_signature" }),
    );
  });

  it("refuses a validly re-signed wrong binding, not only tampered bytes", () => {
    const fixture = mintFixture();
    const expectedTargetDigest = digestDomain("target", fixture.target);
    const otherTarget = mintTarget({ sourceSessionId: "session-other" });
    const record = signBody(mintEnvelopeBody(otherTarget), fixture.workload.privateKey);
    expect(() =>
      verifyActionEnvelope(record, opts(fixture), { expectedTargetDigest }),
    ).toThrowError(expect.objectContaining({ code: "binding_mismatch" }));
  });

  it("fails closed on a wrong kid", () => {
    const fixture = mintFixture();
    const body = { ...mintNonceBody(fixture.target), kid: "unknown-key" };
    const record = signBody(body, fixture.source.privateKey);
    expect(() => verifyNoncePublication(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "unknown_kid" }),
    );
  });

  it("fails closed on a revoked kid", () => {
    const fixture = mintFixture();
    const revoked = createPinnedTrust([
      {
        kid: "test-source",
        issuer: "test-source-issuer",
        audience: "test-b-audience",
        purposes: ["nonce-publication", "cli-session-proof", "action-claim", "result"],
        publicKeySpkiBase64: fixture.source.spkiBase64,
        revoked: true,
        fixtureOnly: false,
      },
    ]);
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    expect(() =>
      verifyNoncePublication(record, { ...opts(fixture), trust: revoked }),
    ).toThrowError(expect.objectContaining({ code: "revoked_key" }));
  });

  it("refuses cross-purpose key use with a valid signature", () => {
    const fixture = mintFixture();
    const body = { ...mintEnvelopeBody(fixture.target), kid: "test-a-att", issuer: "test-a-mesh" };
    const record = signBody(body, fixture.attestation.privateKey);
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "wrong_purpose" }),
    );
  });

  it("refuses algorithm substitution on raw bodies", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    const substituted = {
      ...record,
      signature: { alg: "RS256", value: record.signature.value },
    };
    expect(() => verifyNoncePublication(substituted, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "unsupported_algorithm" }),
    );
  });

  it("refuses algorithm substitution on the IdP JWS", () => {
    const fixture = mintFixture();
    const compact = mintEvidenceJws(fixture).split(".");
    const header = { alg: "RS256", typ: "h2a-action-session+jwt", kid: "test-idp" };
    const forged = `${b64url(canonicalJson(header))}.${compact[1]!}.${compact[2]!}`;
    expect(() => verifyIdpEvidenceJws(forged, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "unsupported_algorithm" }),
    );
  });

  it("refuses expired records under the conservative clock", () => {
    const fixture = mintFixture();
    const atCutoff = signBody(
      { ...mintNonceBody(fixture.target), expiresAt: NOW_MS + CONSERVATIVE_SKEW_MS },
      fixture.source.privateKey,
    );
    expect(() => verifyNoncePublication(atCutoff, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "expired" }),
    );
    const justBefore = signBody(
      { ...mintNonceBody(fixture.target), expiresAt: NOW_MS + CONSERVATIVE_SKEW_MS + 1 },
      fixture.source.privateKey,
    );
    expect(() => verifyNoncePublication(justBefore, opts(fixture))).not.toThrow();
  });

  it("refuses malformed NumericDate claims", () => {
    const fixture = mintFixture();
    expect(() =>
      verifyIdpEvidenceJws(mintEvidenceJws(fixture, { iat: "yesterday" }), opts(fixture)),
    ).toThrowError(expect.objectContaining({ code: "malformed_time" }));
    expect(() =>
      verifyIdpEvidenceJws(
        mintEvidenceJws(fixture, { exp: Math.floor(NOW_MS / 1000) + 0.5 }),
        opts(fixture),
      ),
    ).toThrowError(expect.objectContaining({ code: "malformed_time" }));
  });

  it("refuses IdP evidence exceeding the 60-second lifetime", () => {
    const fixture = mintFixture();
    const iatSec = Math.floor(NOW_MS / 1000) - 10;
    expect(() =>
      verifyIdpEvidenceJws(mintEvidenceJws(fixture, { exp: iatSec + 61 }), opts(fixture)),
    ).toThrowError(expect.objectContaining({ code: "evidence_lifetime" }));
    expect(ACTION_TTL_MS).toBe(30000);
  });

  it("rejects a queryId smuggled into the signed envelope", () => {
    const fixture = mintFixture();
    const record = signBody(
      { ...mintEnvelopeBody(fixture.target), queryId: "query-1" },
      fixture.workload.privateKey,
    );
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("rejects records with extra or missing closed fields", () => {
    const fixture = mintFixture();
    const extra = signBody(
      { ...mintNonceBody(fixture.target), trustRoots: ["x"] },
      fixture.source.privateKey,
    );
    expect(() => verifyNoncePublication(extra, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    const body = mintNonceBody(fixture.target);
    delete body["nonce"];
    const missing = signBody(body, fixture.source.privateKey);
    expect(() => verifyNoncePublication(missing, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("rejects a Target that is not the closed 16-field record", () => {
    const fixture = mintFixture();
    const shortTarget = mintTarget();
    delete shortTarget["connectionGeneration"];
    const record = signBody(mintNonceBody(shortTarget), fixture.source.privateKey);
    expect(() => verifyNoncePublication(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_target" }),
    );
  });

  it("rejects an unknown operation before any effect", () => {
    const fixture = mintFixture();
    const record = signBody(
      { ...mintEnvelopeBody(fixture.target), operation: "launch-missiles" },
      fixture.workload.privateKey,
    );
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("parses route payload shapes without accepting an action body on claim", () => {
    const parsed = parseActionRouteRecord("action-claim", {
      body: {
        version: "remote-action-v1",
        kind: "action-claim",
        actionId: "action-1",
        connectionId: "conn-1",
        connectionGeneration: 4,
        envelopeDigest: "a".repeat(64),
      },
    });
    expect(parsed.kind).toBe("action-claim");
    expect(() =>
      parseActionRouteRecord("action-claim", {
        body: { version: "remote-action-v1", kind: "action-claim", envelope: {} },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() => parseActionRouteRecord("unknown-route", {})).toThrowError(VerifyError);
  });

  it("evaluates the conservative deadline predicate from state-transitions", () => {
    const issuedAt = 1793520000000;
    const expiresAt = issuedAt + 30000;
    expect(
      evaluateAdmissionDeadline({
        issuedAtMs: issuedAt,
        expiresAtMs: expiresAt,
        otherDeadlinesMs: [issuedAt + 60000],
        clock: { known: true, rollback: false },
        nowMs: issuedAt + 1000,
        revoked: false,
      }),
    ).toBe("allow");
    expect(
      evaluateAdmissionDeadline({
        issuedAtMs: issuedAt,
        expiresAtMs: expiresAt,
        otherDeadlinesMs: [issuedAt + 60000],
        clock: { known: true, rollback: false },
        nowMs: issuedAt + 25000,
        revoked: false,
      }),
    ).toBe("relay_grant_expired");
    expect(
      evaluateAdmissionDeadline({
        issuedAtMs: issuedAt,
        expiresAtMs: expiresAt,
        otherDeadlinesMs: [],
        clock: { known: true, rollback: false },
        nowMs: issuedAt + 1000,
        revoked: true,
      }),
    ).toBe("relay_grant_revoked");
    expect(
      evaluateAdmissionDeadline({
        issuedAtMs: issuedAt,
        expiresAtMs: expiresAt,
        otherDeadlinesMs: [],
        clock: { known: false, rollback: false },
        nowMs: issuedAt + 1000,
        revoked: false,
      }),
    ).toBe("clock_unknown");
    expect(
      evaluateAdmissionDeadline({
        issuedAtMs: issuedAt,
        expiresAtMs: expiresAt,
        otherDeadlinesMs: [],
        clock: { known: true, rollback: true },
        nowMs: issuedAt + 1000,
        revoked: false,
      }),
    ).toBe("clock_rollback");
  });

  it("refuses a record bound to a different audience", () => {
    const fixture = mintFixture();
    const record = signBody(
      { ...mintNonceBody(fixture.target), audience: "other-audience" },
      fixture.source.privateKey,
    );
    expect(() => verifyNoncePublication(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "authority_refused" }),
    );
  });
});
