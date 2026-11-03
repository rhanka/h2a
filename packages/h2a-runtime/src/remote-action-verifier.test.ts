import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACTION_TTL_MS,
  CONSERVATIVE_SKEW_MS,
  canonicalJson,
  digestDomain,
  rawHash,
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
  verifyCliSessionProof,
  verifyIdpEvidenceJws,
  verifyNoncePublication,
  verifyResultReport,
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
  raw = false,
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
  const encode = (value: Record<string, unknown>): string =>
    b64url(raw ? JSON.stringify(value) : canonicalJson(value));
  const signing = `${encode(header)}.${encode(payload)}`;
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

/** Flip the final base64url character to a non-canonical spelling (pad bits set). */
function malleateLastChar(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = value[value.length - 1]!;
  const dataBits = alphabet.indexOf(last) >> 2;
  const replacement = [...alphabet].find(
    (letter) => letter !== last && alphabet.indexOf(letter) >> 2 === dataBits,
  )!;
  const malleated = `${value.slice(0, -1)}${replacement}`;
  expect(malleated).not.toBe(value);
  expect(Buffer.from(malleated, "base64url").toString("base64url")).not.toBe(malleated);
  return malleated;
}

function mintCliProofBody(
  fixture: Fixture,
  target: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "remote-action-v1",
    kind: "cli-session-proof",
    issuer: "test-source-issuer",
    kid: "test-source",
    audience: "test-b-audience",
    proofId: "proof-1",
    target,
    ownerIssuer: "test-idp",
    ownerSub: "user-1",
    approvedRegistrationRef: "reg-1",
    approvedRegistrationRevision: 1,
    providerId: "provider-1",
    providerVersion: "v1",
    executableDigest: "e".repeat(64),
    nativeSessionPublicKeyId: "native-key-1",
    capabilitiesDigest: "d".repeat(64),
    permissionMode: "interactive",
    autoApprovePolicyDigest: null,
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 59000,
    ...overrides,
  };
}

function mintAttestationBody(
  parts: {
    target: Record<string, unknown>;
    cliSessionProofDigest: string;
    sessionEvidenceDigest: string;
    payloadDigest: string;
    nonceId: string;
    nonce: string;
  },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "remote-action-v1",
    kind: "session-attestation",
    issuer: "test-a-mesh",
    kid: "test-a-att",
    audience: "test-b-audience",
    actor: { issuer: "test-idp", sub: "user-1", sid: "sid-1", sessionVersion: 1 },
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    target: parts.target,
    cliSessionProofDigest: parts.cliSessionProofDigest,
    actionId: "action-1",
    operation: "input",
    payloadDigest: parts.payloadDigest,
    nonceId: parts.nonceId,
    nonce: parts.nonce,
    consentRevision: 1,
    membershipRevision: 2,
    role: "member",
    actionScopes: ["remote.input"],
    controlPolicyRevision: 3,
    remoteControlEpoch: 4,
    sessionEvidenceDigest: parts.sessionEvidenceDigest,
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 29000,
    ...overrides,
  };
}

function mintValidEnvelopeBody(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
  cliOverrides: Record<string, unknown> = {},
  attestationOverrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const target = (overrides["target"] as Record<string, unknown> | undefined) ?? fixture.target;
  const operation = (overrides["operation"] as string | undefined) ?? "input";
  const payload =
    operation === "input"
      ? {
          bytesBase64: Buffer.from("hello\n", "utf8").toString("base64"),
          byteLength: 6,
          appendNewline: true,
        }
      : {
          decision: "allow",
          permissionRequestId: "request-1",
          requestGeneration: 1,
          contextDigest: "a".repeat(64),
        };
  const payloadDigest =
    operation === "input"
      ? digestDomain("input", Buffer.from("hello\n", "utf8"))
      : digestDomain("permission-response", payload);
  const nonceId = "nonce-1";
  const nonce = unpadded(b64url("0123456789abcdef0123456789abcdef"));
  const cliProof = signBody(
    mintCliProofBody(fixture, target, cliOverrides),
    fixture.source.privateKey,
  );
  const cliSessionProofDigest = digestDomain("cli-session-proof", cliProof.body);
  const evidence = mintEvidenceJws(fixture, {
    actionId: "action-1",
    targetDigest: digestDomain("target", target),
    operation,
    payloadDigest,
    nonceId,
    ...evidenceOverrides,
  });
  const sessionEvidenceDigest = rawHash(Buffer.from(evidence, "utf8"));
  const attestation = signBody(
    mintAttestationBody(
      { target, cliSessionProofDigest, sessionEvidenceDigest, payloadDigest, nonceId, nonce },
      attestationOverrides,
    ),
    fixture.attestation.privateKey,
  );
  return {
    version: "remote-action-v1",
    kind: "action-envelope",
    issuer: "test-a-mesh",
    kid: "test-a-workload",
    audience: "test-b-audience",
    actionId: "action-1",
    target,
    originAudience: "aud-a",
    destinationAudience: "test-b-audience",
    actor: { issuer: "test-idp", sub: "user-1", sid: "sid-1", sessionVersion: 1 },
    sessionEvidence: evidence,
    sessionEvidenceDigest,
    cliSessionProof: cliProof,
    cliSessionProofDigest,
    sessionAttestation: attestation,
    consentRevision: 1,
    operation,
    payload,
    payloadDigest,
    nonceId,
    nonce,
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 29000,
    contractRevision: "remote-action-v1",
    capabilitiesDigest: "d".repeat(64),
    ...overrides,
  };
}

function mintResultBody(
  target: Record<string, unknown>,
  coreOverrides: Record<string, unknown> = {},
  wrapperOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const core = {
    actionId: "action-1",
    envelopeDigest: "a".repeat(64),
    target,
    resultSeq: 1,
    state: "succeeded",
    decision: null,
    consumedAt: NOW_MS - 5000,
    completedAt: NOW_MS - 1000,
    reason: "none",
    nativeReceiptRef: "receipt-1",
    effectRef: null,
    ...coreOverrides,
  };
  return {
    version: "remote-action-v1",
    kind: "result",
    issuer: "test-source-issuer",
    kid: "test-source",
    audience: "test-b-audience",
    ...core,
    resultDigest: digestDomain("result", core),
    queryId: null,
    reportedAt: NOW_MS - 500,
    nativeAuditCheckpointRef: null,
    ...wrapperOverrides,
  };
}

describe("remote-action verifier", () => {
  it("accepts a validly signed nonce publication", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    const body = verifyNoncePublication(record, opts(fixture));
    expect(body["nonceId"]).toBe("nonce-1");
  });

  it("accepts a fully bound action envelope", () => {
    const fixture = mintFixture();
    const body = mintValidEnvelopeBody(fixture);
    const record = {
      ...signBody(body, fixture.workload.privateKey),
      envelopeDigest: digestDomain("action-envelope", body),
    };
    expect(verifyActionEnvelope(record, opts(fixture))["actionId"]).toBe("action-1");
  });

  it("refuses an envelope carrying unverified nested proofs", () => {
    const fixture = mintFixture();
    const record = signBody(mintEnvelopeBody(fixture.target), fixture.workload.privateKey);
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(VerifyError);
  });

  it("accepts a valid IdP evidence JWS", () => {
    const fixture = mintFixture();
    const claims = verifyIdpEvidenceJws(mintEvidenceJws(fixture), opts(fixture));
    expect(claims["actionId"]).toBe("action-1");
  });

  it("refuses a tampered signature", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    // Replace the first character with a different valid alphabet letter. The
    // first character carries six full data bits, so any change alters the
    // decoded bytes; fixed-letter replacement is a no-op whenever the
    // signature already starts with that letter (random per key).
    const first = record.signature.value[0]!;
    const replacement = first === "g" ? "h" : "g";
    const tampered = {
      ...record,
      signature: { alg: "Ed25519", value: `${replacement}${record.signature.value.slice(1)}` },
    };
    expect(Buffer.from(tampered.signature.value, "base64url")).not.toEqual(
      Buffer.from(record.signature.value, "base64url"),
    );
    expect(() => verifyNoncePublication(tampered, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_signature" }),
    );
  });

  it("refuses a validly re-signed wrong binding, not only tampered bytes", () => {
    const fixture = mintFixture();
    const expectedTargetDigest = digestDomain("target", fixture.target);
    const otherTarget = mintTarget({ sourceSessionId: "session-other" });
    const body = mintValidEnvelopeBody(fixture, { target: otherTarget });
    const record = {
      ...signBody(body, fixture.workload.privateKey),
      envelopeDigest: digestDomain("action-envelope", body),
    };
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
    const body = mintValidEnvelopeBody(fixture, { kid: "test-a-att", issuer: "test-a-mesh" });
    const record = {
      ...signBody(body, fixture.attestation.privateKey),
      envelopeDigest: digestDomain("action-envelope", body),
    };
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
        mintEvidenceJws(fixture, { exp: Math.floor(NOW_MS / 1000) + 0.5 }, true),
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
    ).toBe("relay_grant_unavailable");
    expect(
      evaluateAdmissionDeadline({
        issuedAtMs: issuedAt,
        expiresAtMs: expiresAt,
        otherDeadlinesMs: [],
        clock: { known: true, rollback: true },
        nowMs: issuedAt + 1000,
        revoked: false,
      }),
    ).toBe("relay_grant_unavailable");
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

  it("refuses a signature with non-canonical base64url pad bits", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    const malleated = {
      ...record,
      signature: { alg: "Ed25519", value: malleateLastChar(record.signature.value) },
    };
    expect(() => verifyNoncePublication(malleated, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_signature" }),
    );
  });

  it("refuses nonces with non-canonical base64url encoding", () => {
    const fixture = mintFixture();
    const body = mintNonceBody(fixture.target);
    const tampered = signBody(
      { ...body, nonce: malleateLastChar(body["nonce"] as string) },
      fixture.source.privateKey,
    );
    expect(() => verifyNoncePublication(tampered, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    const envelope = mintValidEnvelopeBody(fixture);
    const badEnvelope = signBody(
      { ...envelope, nonce: malleateLastChar(envelope["nonce"] as string) },
      fixture.workload.privateKey,
    );
    expect(() =>
      verifyActionEnvelope(
        { ...badEnvelope, envelopeDigest: digestDomain("action-envelope", badEnvelope.body) },
        opts(fixture),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("refuses live admission on issuer mismatch with the pinned entry", () => {
    const fixture = mintFixture();
    const record = signBody(
      { ...mintNonceBody(fixture.target), issuer: "rogue-issuer" },
      fixture.source.privateKey,
    );
    expect(() => verifyNoncePublication(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "authority_refused" }),
    );
  });

  it("refuses live admission on pinned-audience mismatch with the entry", () => {
    const fixture = mintFixture();
    const mismatched = createPinnedTrust([
      {
        kid: "test-source",
        issuer: "test-source-issuer",
        audience: "different-audience",
        purposes: ["nonce-publication", "cli-session-proof", "action-claim", "result"],
        publicKeySpkiBase64: fixture.source.spkiBase64,
        revoked: false,
        fixtureOnly: false,
      },
    ]);
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    expect(() =>
      verifyNoncePublication(record, { ...opts(fixture), trust: mismatched }),
    ).toThrowError(expect.objectContaining({ code: "authority_refused" }));
  });

  it("refuses fixture-only keys for live admission", () => {
    const fixture = mintFixture();
    const fixtureTrust = createPinnedTrust([
      {
        kid: "test-source",
        issuer: "test-source-issuer",
        audience: "test-b-audience",
        purposes: ["nonce-publication", "cli-session-proof", "action-claim", "result"],
        publicKeySpkiBase64: fixture.source.spkiBase64,
        revoked: false,
        fixtureOnly: true,
      },
      {
        kid: "test-idp",
        issuer: "test-idp",
        audience: "test-b-audience",
        purposes: ["evidence"],
        publicKeySpkiBase64: fixture.idp.spkiBase64,
        revoked: false,
        fixtureOnly: true,
      },
    ]);
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    expect(() =>
      verifyNoncePublication(record, { ...opts(fixture), trust: fixtureTrust }),
    ).toThrowError(expect.objectContaining({ code: "authority_refused" }));
    expect(() =>
      verifyIdpEvidenceJws(
        mintEvidenceJws(fixture),
        { ...opts(fixture), trust: fixtureTrust },
      ),
    ).toThrowError(expect.objectContaining({ code: "authority_refused" }));
  });

  it("refuses every record when the clock is unknown or rolled back", () => {
    const fixture = mintFixture();
    const record = signBody(mintNonceBody(fixture.target), fixture.source.privateKey);
    expect(() =>
      verifyNoncePublication(record, { ...opts(fixture), clockKnown: false }),
    ).toThrowError(expect.objectContaining({ code: "expired" }));
    expect(() =>
      verifyNoncePublication(record, { ...opts(fixture), clockRollback: true }),
    ).toThrowError(expect.objectContaining({ code: "expired" }));
    expect(() =>
      verifyIdpEvidenceJws(mintEvidenceJws(fixture), { ...opts(fixture), clockKnown: false }),
    ).toThrowError(expect.objectContaining({ code: "expired" }));
  });

  it("refuses IdP evidence minted in the future", () => {
    const fixture = mintFixture();
    const futureIat = Math.floor(NOW_MS / 1000) + 100;
    expect(() =>
      verifyIdpEvidenceJws(
        mintEvidenceJws(fixture, { iat: futureIat, exp: futureIat + 60 }),
        opts(fixture),
      ),
    ).toThrowError(expect.objectContaining({ code: "malformed_time" }));
  });

  it("refuses IdP evidence with an open header or open claims", () => {
    const fixture = mintFixture();
    const compact = mintEvidenceJws(fixture).split(".");
    const payload = compact[1]!;
    const signature = compact[2]!;
    const openHeader = b64url(
      canonicalJson({ alg: "EdDSA", typ: "h2a-action-session+jwt", kid: "test-idp", crit: ["exp"] }),
    );
    expect(() =>
      verifyIdpEvidenceJws(`${openHeader}.${payload}.${signature}`, opts(fixture)),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    const noTyp = b64url(canonicalJson({ alg: "EdDSA", kid: "test-idp" }));
    expect(() =>
      verifyIdpEvidenceJws(`${noTyp}.${payload}.${signature}`, opts(fixture)),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    const extraClaim = mintEvidenceJws(fixture, { smuggled: "no" });
    expect(() => verifyIdpEvidenceJws(extraClaim, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("refuses IdP evidence with a non-canonical signature encoding", () => {
    const fixture = mintFixture();
    const compact = mintEvidenceJws(fixture).split(".");
    const malleated = `${compact[0]}.${compact[1]}.${malleateLastChar(compact[2]!)}`;
    expect(() => verifyIdpEvidenceJws(malleated, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_signature" }),
    );
  });

  it("refuses an envelope whose evidence diverges from the bound identity", () => {
    const fixture = mintFixture();
    const body = mintValidEnvelopeBody(fixture, {}, {}, {}, { actionId: "other-action" });
    const record = {
      ...signBody(body, fixture.workload.privateKey),
      envelopeDigest: digestDomain("action-envelope", body),
    };
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "binding_mismatch" }),
    );
  });

  it("refuses an envelope whose evidence digest does not match the bytes", () => {
    const fixture = mintFixture();
    const body = mintValidEnvelopeBody(fixture, { sessionEvidenceDigest: "0".repeat(64) });
    const record = {
      ...signBody(body, fixture.workload.privateKey),
      envelopeDigest: digestDomain("action-envelope", body),
    };
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("requires the wire envelopeDigest on every action envelope", () => {
    const fixture = mintFixture();
    const body = mintValidEnvelopeBody(fixture);
    const record = signBody(body, fixture.workload.privateKey);
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    const openWire = {
      ...record,
      envelopeDigest: digestDomain("action-envelope", body),
      smuggled: true,
    };
    expect(() => verifyActionEnvelope(openWire, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("refuses input admitted under a non-interactive permission mode", () => {
    const fixture = mintFixture();
    const body = mintValidEnvelopeBody(
      fixture,
      {},
      { permissionMode: "auto-approve", autoApprovePolicyDigest: "a".repeat(64) },
    );
    const record = {
      ...signBody(body, fixture.workload.privateKey),
      envelopeDigest: digestDomain("action-envelope", body),
    };
    expect(() => verifyActionEnvelope(record, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "input_mode_refused" }),
    );
  });

  it("refuses a cli proof re-signed under the wrong purpose key", () => {
    const fixture = mintFixture();
    const proof = signBody(
      mintCliProofBody(fixture, fixture.target, { kid: "test-a-att", issuer: "test-a-mesh" }),
      fixture.attestation.privateKey,
    );
    const body = mintValidEnvelopeBody(fixture);
    const forged = {
      ...signBody(
        { ...body, cliSessionProof: proof, cliSessionProofDigest: digestDomain("cli-session-proof", proof.body) },
        fixture.workload.privateKey,
      ),
      envelopeDigest: "placeholder",
    };
    forged.envelopeDigest = digestDomain("action-envelope", forged.body);
    expect(() => verifyActionEnvelope(forged, opts(fixture))).toThrowError(VerifyError);
  });

  it("accepts a valid cli-session-proof and a not_in_ledger observation", () => {
    const fixture = mintFixture();
    const proof = signBody(mintCliProofBody(fixture, fixture.target), fixture.source.privateKey);
    expect(verifyCliSessionProof(proof, opts(fixture))["proofId"]).toBe("proof-1");
    const observation = signBody(
      mintResultBody(
        fixture.target,
        {
          resultSeq: null,
          state: "not_in_ledger",
          consumedAt: null,
          completedAt: null,
          reason: "not_in_ledger",
          nativeReceiptRef: null,
        },
        { queryId: "query-1" },
      ),
      fixture.source.privateKey,
    );
    expect(verifyResultReport(observation, opts(fixture))["state"]).toBe("not_in_ledger");
  });

  it("refuses result reports that break the immutable-core invariants", () => {
    const fixture = mintFixture();
    const check = (core: Record<string, unknown>): void =>
      expect(() =>
        verifyResultReport(signBody(mintResultBody(fixture.target, core), fixture.source.privateKey), opts(fixture)),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    check({ resultSeq: 0 });
    check({ state: "consumed", nativeReceiptRef: null });
    check({ state: "denied", reason: "none" });
    check({ state: "succeeded", reason: "not_in_ledger" });
    check({ state: "not_in_ledger", resultSeq: null, reason: "not_in_ledger", nativeReceiptRef: "receipt-1" });
    const tampered = signBody(
      { ...mintResultBody(fixture.target), resultDigest: "0".repeat(64) },
      fixture.source.privateKey,
    );
    expect(() => verifyResultReport(tampered, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("closes the cli-session-proof mode and policy digest", () => {
    const fixture = mintFixture();
    const check = (overrides: Record<string, unknown>): void =>
      expect(() =>
        verifyCliSessionProof(
          signBody(mintCliProofBody(fixture, fixture.target, overrides), fixture.source.privateKey),
          opts(fixture),
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    check({ permissionMode: "superuser" });
    check({ autoApprovePolicyDigest: "not-hex" });
  });

  it("closes the input payload and rejects control bytes", () => {
    const fixture = mintFixture();
    const envelopeWith = (payload: Record<string, unknown>): Record<string, unknown> => {
      const body = mintValidEnvelopeBody(fixture, { payload });
      return {
        ...signBody(
          { ...body, payloadDigest: digestDomain("input", Buffer.from(payload["bytesBase64"] as string, "base64")) },
          fixture.workload.privateKey,
        ),
        envelopeDigest: "placeholder",
      };
    };
    const closed = (record: Record<string, unknown>): Record<string, unknown> => ({
      ...record,
      envelopeDigest: digestDomain("action-envelope", (record as { body: Record<string, unknown> }).body),
    });
    expect(() =>
      verifyActionEnvelope(
        closed(envelopeWith({ bytesBase64: "aGVsbG8K", byteLength: 6, appendNewline: true, extra: 1 })),
        opts(fixture),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() =>
      verifyActionEnvelope(
        closed(envelopeWith({ bytesBase64: "aGVsbG8K", byteLength: 6, appendNewline: "yes" })),
        opts(fixture),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    const esc = Buffer.from("hi\x1bbye\n", "utf8");
    expect(() =>
      verifyActionEnvelope(
        closed(
          envelopeWith({
            bytesBase64: esc.toString("base64"),
            byteLength: esc.length,
            appendNewline: false,
          }),
        ),
        opts(fixture),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("refuses records that exceed the frozen wire bounds", () => {
    const fixture = mintFixture();
    const bigPayload = {
      decision: "allow",
      permissionRequestId: "request-1",
      requestGeneration: 1,
      contextDigest: "a".repeat(64),
      pad: "x".repeat(70000),
    };
    const body = mintValidEnvelopeBody(fixture, { operation: "permission-response" });
    const oversized = {
      ...signBody(
        {
          ...body,
          payload: bigPayload,
          payloadDigest: digestDomain("permission-response", bigPayload),
        },
        fixture.workload.privateKey,
      ),
      envelopeDigest: "placeholder",
    };
    oversized.envelopeDigest = digestDomain("action-envelope", oversized.body);
    expect(() => verifyActionEnvelope(oversized, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    const bigResult = signBody(
      mintResultBody(fixture.target, {}, { nativeAuditCheckpointRef: "x".repeat(20000) }),
      fixture.source.privateKey,
    );
    expect(() => verifyResultReport(bigResult, opts(fixture))).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });
});
