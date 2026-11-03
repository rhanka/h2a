/**
 * EdDSA/Ed25519 verifier for `remote-action-v1` records (cell N1).
 *
 * Verifies the exact records the `action-nonce`, `action-stream`,
 * `action-claim` and `action-result` routes carry: nonce publications, action
 * envelopes (input / permission-response), result reports, CLI session
 * proofs and IdP session-evidence JWS. Verification order per record:
 * closed shape → pinned header → audience → trust (kid + purpose) → target
 * and digest bindings → conservative lifetime → signature.
 *
 * Fail-closed throughout: unknown/revoked/cross-purpose kids, algorithm
 * substitution, re-signed wrong bindings, expired or malformed times, extra
 * fields and smuggled `queryId` all refuse with a typed code. A verified
 * record proves admission-worthiness only — never an effect.
 */

import { createPublicKey, verify } from "node:crypto";

import {
  ACTION_TTL_MS,
  MAX_INPUT_BYTES,
  NONCE_TTL_MS,
  PROOF_TTL_MS,
  REMOTE_ACTION_VERSION,
  SIGNING_DOMAIN_PREFIX,
  canonicalJson,
  digestDomain,
  isTargetRecord,
} from "./remote-action-contract.js";
import { isWithinLifetime } from "./remote-action-clock.js";
import {
  TrustError,
  isAllowedBodyAlg,
  isAllowedJwsAlg,
  resolveTrustEntry,
  type PinnedTrust,
} from "./remote-action-trust.js";

export type VerifyFailureCode =
  | "invalid_request"
  | "invalid_signature"
  | "invalid_target"
  | "unknown_kid"
  | "revoked_key"
  | "wrong_purpose"
  | "unsupported_algorithm"
  | "unsupported_version"
  | "authority_refused"
  | "binding_mismatch"
  | "expired"
  | "malformed_time"
  | "evidence_lifetime";

export class VerifyError extends Error {
  readonly code: VerifyFailureCode;

  constructor(code: VerifyFailureCode, message?: string) {
    super(message ?? code);
    this.name = "VerifyError";
    this.code = code;
  }
}

function fail(code: VerifyFailureCode): never {
  throw new VerifyError(code);
}

export interface VerifyOptions {
  trust: PinnedTrust;
  expectedAudience: string;
  nowMs: number;
  clockKnown?: boolean;
  clockRollback?: boolean;
}

export interface ExpectedBindings {
  expectedTargetDigest?: string;
}

type Body = Record<string, unknown>;

function asBody(value: unknown): Body {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_request");
  }
  return value as Body;
}

function asNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail("invalid_request");
  return value as string;
}

const NONCE_FIELDS = [
  "version",
  "kind",
  "issuer",
  "kid",
  "audience",
  "nonceId",
  "nonce",
  "target",
  "cliSessionProofDigest",
  "issuedAt",
  "expiresAt",
  "allowedOperations",
] as const;

const ENVELOPE_FIELDS = [
  "version",
  "kind",
  "issuer",
  "kid",
  "audience",
  "actionId",
  "target",
  "originAudience",
  "destinationAudience",
  "actor",
  "sessionEvidence",
  "sessionEvidenceDigest",
  "cliSessionProof",
  "cliSessionProofDigest",
  "sessionAttestation",
  "consentRevision",
  "operation",
  "payload",
  "payloadDigest",
  "nonceId",
  "nonce",
  "issuedAt",
  "expiresAt",
  "contractRevision",
  "capabilitiesDigest",
] as const;

const RESULT_FIELDS = [
  "version",
  "kind",
  "issuer",
  "kid",
  "audience",
  "actionId",
  "envelopeDigest",
  "target",
  "resultSeq",
  "state",
  "decision",
  "consumedAt",
  "completedAt",
  "reason",
  "nativeReceiptRef",
  "effectRef",
  "resultDigest",
  "queryId",
  "reportedAt",
  "nativeAuditCheckpointRef",
] as const;

const RESULT_CORE_FIELDS = [
  "actionId",
  "envelopeDigest",
  "target",
  "resultSeq",
  "state",
  "decision",
  "consumedAt",
  "completedAt",
  "reason",
  "nativeReceiptRef",
  "effectRef",
] as const;

const CLAIM_FIELDS = [
  "version",
  "kind",
  "issuer",
  "kid",
  "audience",
  "actionId",
  "connectionId",
  "connectionGeneration",
  "envelopeDigest",
] as const;

const PROOF_FIELDS = [
  "version",
  "kind",
  "issuer",
  "kid",
  "audience",
  "proofId",
  "target",
  "ownerIssuer",
  "ownerSub",
  "approvedRegistrationRef",
  "approvedRegistrationRevision",
  "providerId",
  "providerVersion",
  "executableDigest",
  "nativeSessionPublicKeyId",
  "capabilitiesDigest",
  "permissionMode",
  "autoApprovePolicyDigest",
  "issuedAt",
  "expiresAt",
] as const;

const OPERATIONS: ReadonlySet<string> = new Set(["input", "permission-response"]);

function checkClosed(body: Body, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fail("invalid_request");
  }
  for (const key of allowed) {
    if (!Object.hasOwn(body, key)) fail("invalid_request");
  }
}

function checkHeader(body: Body, expectedKind: string): { kid: string } {
  if (body["version"] !== REMOTE_ACTION_VERSION) fail("unsupported_version");
  if (body["kind"] !== expectedKind) fail("invalid_request");
  asNonEmptyString(body["issuer"]);
  const kid = asNonEmptyString(body["kid"]);
  asNonEmptyString(body["audience"]);
  return { kid };
}

function checkLifetime(issuedAt: unknown, expiresAt: unknown, maxTtlMs: number, nowMs: number): void {
  if (typeof issuedAt !== "number" || typeof expiresAt !== "number") fail("invalid_request");
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) fail("invalid_request");
  if (issuedAt > expiresAt || expiresAt - issuedAt > maxTtlMs) fail("invalid_request");
  if (!isWithinLifetime(nowMs, expiresAt)) fail("expired");
}

function signingInputBytes(kind: string, body: Body): Buffer {
  return Buffer.concat([
    Buffer.from(`${SIGNING_DOMAIN_PREFIX}${kind}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(body), "utf8"),
  ]);
}

function decodeSignature(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) fail("invalid_signature");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 64) fail("invalid_signature");
  return bytes;
}

function checkTargetBinding(body: Body, bindings: ExpectedBindings | undefined): void {
  if (!isTargetRecord(body["target"])) fail("invalid_target");
  if (bindings?.expectedTargetDigest !== undefined) {
    if (digestDomain("target", body["target"]) !== bindings.expectedTargetDigest) {
      fail("binding_mismatch");
    }
  }
}

interface SignedWire {
  body: Body;
  kind: string;
}

function checkSignedWire(record: unknown, expectedKind: string, allowed: readonly string[]): SignedWire {
  const wire = asBody(record);
  const body = asBody(wire["body"]);
  const signature = asBody(wire["signature"]);
  if (!isAllowedBodyAlg(signature["alg"])) fail("unsupported_algorithm");
  checkClosed(body, allowed);
  const { kid } = checkHeader(body, expectedKind);
  void kid;
  return { body, kind: expectedKind };
}

function verifyBodySignature(
  options: VerifyOptions,
  kind: string,
  body: Body,
  signatureValue: unknown,
  purpose: string,
): void {
  const { kid } = checkHeader(body, kind);
  void kid;
  let spkiBase64: string;
  try {
    spkiBase64 = resolveTrustEntry(options.trust, body["kid"] as string, purpose).publicKeySpkiBase64;
  } catch (error) {
    if (error instanceof TrustError) {
      throw new VerifyError(error.code as VerifyFailureCode);
    }
    throw error;
  }
  if (body["audience"] !== options.expectedAudience) fail("authority_refused");
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({
      key: Buffer.from(spkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    fail("invalid_request");
  }
  const ok = verify(null, signingInputBytes(kind, body), key, decodeSignature(signatureValue));
  if (!ok) fail("invalid_signature");
}

function checkLifetimeIfPresent(body: Body, maxTtlMs: number, nowMs: number): void {
  const hasIssued = Object.hasOwn(body, "issuedAt");
  const hasExpires = Object.hasOwn(body, "expiresAt");
  if (hasIssued !== hasExpires) fail("invalid_request");
  if (hasIssued && hasExpires) checkLifetime(body["issuedAt"], body["expiresAt"], maxTtlMs, nowMs);
}

function verifySignedRecord(
  record: unknown,
  options: VerifyOptions,
  expectedKind: string,
  allowed: readonly string[],
  maxTtlMs: number,
  bindings?: ExpectedBindings,
): Body {
  const { body } = checkSignedWire(record, expectedKind, allowed);
  const wire = asBody(record);
  const signature = asBody(wire["signature"]);
  checkTargetBindingIfPresent(body, bindings);
  checkLifetimeIfPresent(body, maxTtlMs, options.nowMs);
  verifyBodySignature(options, expectedKind, body, signature["value"], expectedKind);
  const envelopeDigest = wire["envelopeDigest"];
  if (envelopeDigest !== undefined && envelopeDigest !== digestDomain("action-envelope", body)) {
    fail("invalid_request");
  }
  return body;
}

function checkTargetBindingIfPresent(body: Body, bindings: ExpectedBindings | undefined): void {
  if (Object.hasOwn(body, "target")) checkTargetBinding(body, bindings);
}

function decodeInputPayload(payload: unknown): Buffer {
  const record = asBody(payload);
  const encoded = record["bytesBase64"];
  const byteLength = record["byteLength"];
  if (typeof encoded !== "string" || typeof byteLength !== "number") fail("invalid_request");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    fail("invalid_request");
  }
  if (bytes.length !== byteLength || bytes.length > MAX_INPUT_BYTES) fail("invalid_request");
  if (bytes.toString("base64") !== encoded) fail("invalid_request");
  try {
    new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch {
    fail("invalid_request");
  }
  return bytes;
}

/** Nonce publication: B-signed metadata for `POST …/actions/nonces`. */
export function verifyNoncePublication(
  record: unknown,
  options: VerifyOptions,
): Body {
  const body = verifySignedRecord(record, options, "nonce-publication", NONCE_FIELDS, NONCE_TTL_MS);
  const allowed = body["allowedOperations"];
  if (
    !Array.isArray(allowed) ||
    allowed.length === 0 ||
    !allowed.every((entry) => entry === "input" || entry === "permission-response")
  ) {
    fail("invalid_request");
  }
  return body;
}

/** Action envelope: A-signed intent binding target, proofs and payload. */
export function verifyActionEnvelope(
  record: unknown,
  options: VerifyOptions,
  bindings?: ExpectedBindings,
): Body {
  const body = verifySignedRecord(record, options, "action-envelope", ENVELOPE_FIELDS, ACTION_TTL_MS, bindings);
  const operation = body["operation"];
  if (typeof operation !== "string" || !OPERATIONS.has(operation)) fail("invalid_request");
  if (operation === "input") {
    const bytes = decodeInputPayload(body["payload"]);
    if (digestDomain("input", bytes) !== body["payloadDigest"]) fail("invalid_request");
  } else {
    if (digestDomain("permission-response", body["payload"]) !== body["payloadDigest"]) {
      fail("invalid_request");
    }
  }
  return body;
}

/** Result report: B-signed immutable ResultCore plus reporting wrapper. */
export function verifyResultReport(
  record: unknown,
  options: VerifyOptions,
  bindings?: ExpectedBindings,
): Body {
  const body = verifySignedRecord(record, options, "result", RESULT_FIELDS, ACTION_TTL_MS, bindings);
  const core: Body = {};
  for (const field of RESULT_CORE_FIELDS) core[field] = body[field];
  if (digestDomain("result", core) !== body["resultDigest"]) fail("invalid_request");
  return body;
}

/** Action claim: B-signed handoff request carrying no action body. */
export function verifyActionClaim(record: unknown, options: VerifyOptions): Body {
  const { body } = checkSignedWire(record, "action-claim", CLAIM_FIELDS);
  const wire = asBody(record);
  const signature = asBody(wire["signature"]);
  if (!Number.isSafeInteger(body["connectionGeneration"])) fail("invalid_request");
  if (typeof body["envelopeDigest"] !== "string" || (body["envelopeDigest"] as string).length !== 64) {
    fail("invalid_request");
  }
  verifyBodySignature(options, "action-claim", body, signature["value"], "action-claim");
  return body;
}

/** CLI session proof: B-signed binding of the managed native session. */
export function verifyCliSessionProof(record: unknown, options: VerifyOptions): Body {
  return verifySignedRecord(record, options, "cli-session-proof", PROOF_FIELDS, PROOF_TTL_MS);
}

const EVIDENCE_CLAIMS = [
  "iss",
  "sub",
  "sid",
  "sessionVersion",
  "tenantId",
  "workspaceId",
  "auth_time",
  "amr",
  "aud",
  "iat",
  "exp",
  "jti",
  "actionId",
  "targetDigest",
  "operation",
  "payloadDigest",
  "nonceId",
] as const;

function decodeJwsPart(part: string): Body {
  if (!/^[A-Za-z0-9_-]*$/.test(part) || part.length === 0) fail("invalid_request");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    fail("invalid_request");
  }
  return asBody(parsed);
}

/** IdP session evidence: compact JWS minted over the live login lineage. */
export function verifyIdpEvidenceJws(
  compact: unknown,
  options: VerifyOptions,
  bindings?: ExpectedBindings,
): Body {
  if (typeof compact !== "string") fail("invalid_request");
  const parts = (compact as string).split(".");
  if (parts.length !== 3) fail("invalid_request");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJwsPart(encodedHeader);
  if (!isAllowedJwsAlg(header["alg"])) fail("unsupported_algorithm");
  const kid = asNonEmptyString(header["kid"]);
  const payload = decodeJwsPart(encodedPayload);
  for (const claim of EVIDENCE_CLAIMS) {
    if (!Object.hasOwn(payload, claim)) fail("invalid_request");
  }
  if (payload["aud"] !== options.expectedAudience) fail("authority_refused");
  const iat = payload["iat"];
  const exp = payload["exp"];
  const authTime = payload["auth_time"];
  if (
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    typeof authTime !== "number" ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp) ||
    !Number.isSafeInteger(authTime) ||
    iat < 0 ||
    exp < 0 ||
    authTime < 0
  ) {
    fail("malformed_time");
  }
  if (exp <= iat || exp - iat > 60) fail("evidence_lifetime");
  if (authTime > iat) fail("malformed_time");
  if (options.nowMs >= exp * 1000 - 5000) fail("expired");
  if (bindings?.expectedTargetDigest !== undefined && payload["targetDigest"] !== bindings.expectedTargetDigest) {
    fail("binding_mismatch");
  }
  let spkiBase64: string;
  try {
    spkiBase64 = resolveTrustEntry(options.trust, kid, "evidence").publicKeySpkiBase64;
  } catch (error) {
    if (error instanceof TrustError) {
      throw new VerifyError(error.code as VerifyFailureCode);
    }
    throw error;
  }
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({
      key: Buffer.from(spkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    fail("invalid_request");
  }
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  if (!verify(null, signingInput, key, decodeSignature(encodedSignature))) {
    fail("invalid_signature");
  }
  return payload;
}
