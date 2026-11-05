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
  CONSERVATIVE_SKEW_MS,
  MAX_ENVELOPE_BYTES,
  MAX_INPUT_BYTES,
  MAX_RESULT_BYTES,
  NONCE_TTL_MS,
  PROOF_TTL_MS,
  REMOTE_ACTION_VERSION,
  SIGNING_DOMAIN_PREFIX,
  canonicalJson,
  digestDomain,
  isTargetRecord,
  rawHash,
} from "./remote-action-contract.js";
import { isWithinLifetime } from "./remote-action-clock.js";
import {
  TrustError,
  assertLiveKey,
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
  | "evidence_lifetime"
  | "input_mode_refused";

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

export const PROOF_FIELDS = [
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

const ATTESTATION_FIELDS = [
  "version",
  "kind",
  "issuer",
  "kid",
  "audience",
  "actor",
  "tenantId",
  "workspaceId",
  "target",
  "cliSessionProofDigest",
  "actionId",
  "operation",
  "payloadDigest",
  "nonceId",
  "nonce",
  "consentRevision",
  "membershipRevision",
  "role",
  "actionScopes",
  "controlPolicyRevision",
  "remoteControlEpoch",
  "sessionEvidenceDigest",
  "issuedAt",
  "expiresAt",
] as const;

const ATTESTATION_ROLES: ReadonlySet<string> = new Set(["member", "workspace-admin", "workspace-owner"]);

const ACTION_SCOPES = ["remote.input", "remote.permission.respond"] as const;

const RESULT_STATES: ReadonlySet<string> = new Set([
  "pending",
  "consumed",
  "outcome_unknown",
  "succeeded",
  "denied",
  "expired",
  "stale",
  "not_in_ledger",
]);

const RESULT_REASONS: ReadonlySet<string> = new Set([
  "none",
  "stale_generation",
  "expired",
  "nonce_unknown",
  "nonce_consumed",
  "authority_refused",
  "workspace_membership_required",
  "role_refused",
  "action_scope_refused",
  "input_mode_refused",
  "control_disabled",
  "permission_pending",
  "request_resolved",
  "provider_not_ready",
  "provider_unavailable",
  "unsupported_version",
  "session_proof_invalid",
  "invalid_input",
  "replay_refused",
  "ledger_unavailable",
  "not_in_ledger",
  "effect_failed",
]);

const OPERATIONS: ReadonlySet<string> = new Set(["input", "permission-response"]);

function scopeForOperation(operation: string): string {
  return operation === "input" ? "remote.input" : "remote.permission.respond";
}

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

function checkLifetime(
  issuedAt: unknown,
  expiresAt: unknown,
  maxTtlMs: number,
  options: VerifyOptions,
): void {
  if (options.clockKnown === false || options.clockRollback === true) fail("expired");
  if (typeof issuedAt !== "number" || typeof expiresAt !== "number") fail("invalid_request");
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) fail("invalid_request");
  if (issuedAt > expiresAt || expiresAt - issuedAt > maxTtlMs) fail("invalid_request");
  if (!isWithinLifetime(options.nowMs, expiresAt)) fail("expired");
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
  if (bytes.toString("base64url") !== value) fail("invalid_signature");
  return bytes;
}

/** Nonce is 32 random bytes in canonical unpadded base64url (no pad-bit malleation). */
function checkNonce(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail("invalid_request");
  const nonce = value as string;
  if (Buffer.from(nonce, "base64url").toString("base64url") !== nonce) fail("invalid_request");
  return nonce;
}

/** Session actor is exactly {issuer, sub, sid, sessionVersion}. */
function checkActor(value: unknown): Body {
  const actor = asBody(value);
  checkClosed(actor, ["issuer", "sub", "sid", "sessionVersion"]);
  asNonEmptyString(actor["issuer"]);
  asNonEmptyString(actor["sub"]);
  asNonEmptyString(actor["sid"]);
  if (typeof actor["sessionVersion"] !== "number" || !Number.isSafeInteger(actor["sessionVersion"])) {
    fail("invalid_request");
  }
  return actor;
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
  const allowedWire =
    expectedKind === "action-envelope" ? ["body", "signature", "envelopeDigest"] : ["body", "signature"];
  for (const key of Object.keys(wire)) {
    if (!allowedWire.includes(key)) fail("invalid_request");
  }
  for (const key of ["body", "signature"]) {
    if (!Object.hasOwn(wire, key)) fail("invalid_request");
  }
  const body = asBody(wire["body"]);
  const signature = asBody(wire["signature"]);
  checkClosed(signature, ["alg", "value"]);
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
    const entry = resolveTrustEntry(options.trust, body["kid"] as string, purpose);
    if (entry.issuer !== body["issuer"] || entry.audience !== body["audience"]) {
      fail("authority_refused");
    }
    try {
      assertLiveKey(entry);
    } catch (error) {
      if (error instanceof TrustError) throw new VerifyError("authority_refused");
      throw error;
    }
    spkiBase64 = entry.publicKeySpkiBase64;
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

function checkLifetimeIfPresent(body: Body, maxTtlMs: number, options: VerifyOptions): void {
  const hasIssued = Object.hasOwn(body, "issuedAt");
  const hasExpires = Object.hasOwn(body, "expiresAt");
  if (hasIssued !== hasExpires) fail("invalid_request");
  if (hasIssued && hasExpires) checkLifetime(body["issuedAt"], body["expiresAt"], maxTtlMs, options);
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
  checkLifetimeIfPresent(body, maxTtlMs, options);
  verifyBodySignature(options, expectedKind, body, signature["value"], expectedKind);
  if (expectedKind === "action-envelope") {
    if (
      typeof wire["envelopeDigest"] !== "string" ||
      wire["envelopeDigest"] !== digestDomain("action-envelope", body)
    ) {
      fail("invalid_request");
    }
  }
  return body;
}

function checkTargetBindingIfPresent(body: Body, bindings: ExpectedBindings | undefined): void {
  if (Object.hasOwn(body, "target")) checkTargetBinding(body, bindings);
}

function decodeInputPayload(payload: unknown): Buffer {
  const record = asBody(payload);
  checkClosed(record, ["bytesBase64", "byteLength", "appendNewline"]);
  const encoded = record["bytesBase64"];
  const byteLength = record["byteLength"];
  if (typeof encoded !== "string" || typeof byteLength !== "number") fail("invalid_request");
  if (typeof record["appendNewline"] !== "boolean") fail("invalid_request");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    fail("invalid_request");
  }
  if (bytes.length !== byteLength || bytes.length > MAX_INPUT_BYTES) fail("invalid_request");
  if (bytes.toString("base64") !== encoded) fail("invalid_request");
  let text: string;
  try {
    text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch {
    fail("invalid_request");
  }
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (
      code === 0x1b ||
      code === 0x7f ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x80 && code <= 0x9f)
    ) {
      fail("invalid_request");
    }
  }
  return bytes;
}

/** Nonce publication: B-signed metadata for `POST …/actions/nonces`. */
export function verifyNoncePublication(
  record: unknown,
  options: VerifyOptions,
): Body {
  const body = verifySignedRecord(record, options, "nonce-publication", NONCE_FIELDS, NONCE_TTL_MS);
  checkNonce(body["nonce"]);
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
  if (Buffer.byteLength(canonicalJson(record), "utf8") > MAX_ENVELOPE_BYTES) fail("invalid_request");
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
  checkNonce(body["nonce"]);
  const actor = checkActor(body["actor"]);

  const sessionEvidence = asNonEmptyString(body["sessionEvidence"]);
  if (rawHash(Buffer.from(sessionEvidence, "utf8")) !== body["sessionEvidenceDigest"]) {
    fail("invalid_request");
  }
  const evidence = verifyIdpEvidenceJws(sessionEvidence, options, bindings);
  if (
    evidence["iss"] !== actor["issuer"] ||
    evidence["sub"] !== actor["sub"] ||
    evidence["sid"] !== actor["sid"] ||
    evidence["sessionVersion"] !== actor["sessionVersion"]
  ) {
    fail("binding_mismatch");
  }
  if (evidence["aud"] !== body["destinationAudience"]) fail("binding_mismatch");
  for (const field of ["actionId", "operation", "payloadDigest", "nonceId"] as const) {
    if (evidence[field] !== body[field]) fail("binding_mismatch");
  }
  if (evidence["targetDigest"] !== digestDomain("target", body["target"])) fail("binding_mismatch");
  if (
    typeof body["expiresAt"] !== "number" ||
    typeof evidence["exp"] !== "number" ||
    (body["expiresAt"] as number) > (evidence["exp"] as number) * 1000
  ) {
    fail("expired");
  }

  const cliProof = verifyCliSessionProof(body["cliSessionProof"], options);
  if (digestDomain("cli-session-proof", cliProof) !== body["cliSessionProofDigest"]) {
    fail("invalid_request");
  }
  if (digestDomain("target", cliProof["target"]) !== digestDomain("target", body["target"])) {
    fail("binding_mismatch");
  }
  if (cliProof["ownerIssuer"] !== actor["issuer"] || cliProof["ownerSub"] !== actor["sub"]) {
    fail("binding_mismatch");
  }
  if (cliProof["capabilitiesDigest"] !== body["capabilitiesDigest"]) fail("binding_mismatch");
  if (
    typeof body["expiresAt"] !== "number" ||
    typeof cliProof["expiresAt"] !== "number" ||
    (body["expiresAt"] as number) > (cliProof["expiresAt"] as number)
  ) {
    fail("expired");
  }
  if (
    operation === "input" &&
    (cliProof["permissionMode"] !== "interactive" || cliProof["autoApprovePolicyDigest"] !== null)
  ) {
    fail("input_mode_refused");
  }

  const attestation = verifySessionAttestation(body["sessionAttestation"], options);
  const attestedActor = attestation["actor"] as Body;
  if (
    attestedActor["issuer"] !== actor["issuer"] ||
    attestedActor["sub"] !== actor["sub"] ||
    attestedActor["sid"] !== actor["sid"] ||
    attestedActor["sessionVersion"] !== actor["sessionVersion"]
  ) {
    fail("binding_mismatch");
  }
  const target = asBody(body["target"]);
  if (attestation["tenantId"] !== target["tenantId"] || attestation["workspaceId"] !== target["workspaceId"]) {
    fail("binding_mismatch");
  }
  if (digestDomain("target", attestation["target"]) !== digestDomain("target", body["target"])) {
    fail("binding_mismatch");
  }
  for (
    const field of [
      "cliSessionProofDigest",
      "actionId",
      "operation",
      "payloadDigest",
      "nonceId",
      "nonce",
      "consentRevision",
      "sessionEvidenceDigest",
    ] as const
  ) {
    if (attestation[field] !== body[field]) fail("binding_mismatch");
  }
  if (
    typeof body["expiresAt"] !== "number" ||
    typeof attestation["expiresAt"] !== "number" ||
    (body["expiresAt"] as number) > (attestation["expiresAt"] as number)
  ) {
    fail("expired");
  }
  return body;
}

/** Result report: B-signed immutable ResultCore plus reporting wrapper. */
export function verifyResultReport(
  record: unknown,
  options: VerifyOptions,
  bindings?: ExpectedBindings,
): Body {
  if (Buffer.byteLength(canonicalJson(record), "utf8") > MAX_RESULT_BYTES) fail("invalid_request");
  const body = verifySignedRecord(record, options, "result", RESULT_FIELDS, ACTION_TTL_MS, bindings);
  const core: Body = {};
  for (const field of RESULT_CORE_FIELDS) core[field] = body[field];
  if (digestDomain("result", core) !== body["resultDigest"]) fail("invalid_request");
  const state = body["state"];
  const reason = body["reason"];
  if (typeof state !== "string" || !RESULT_STATES.has(state)) fail("invalid_request");
  if (typeof reason !== "string" || !RESULT_REASONS.has(reason)) fail("invalid_request");
  if (state === "not_in_ledger") {
    if (
      body["resultSeq"] !== null ||
      reason !== "not_in_ledger" ||
      body["queryId"] === null ||
      body["nativeReceiptRef"] !== null ||
      body["effectRef"] !== null
    ) {
      fail("invalid_request");
    }
  } else {
    if (
      !Number.isSafeInteger(body["resultSeq"]) ||
      (body["resultSeq"] as number) < 1 ||
      reason === "not_in_ledger"
    ) {
      fail("invalid_request");
    }
  }
  if (reason === "none" && state !== "pending" && state !== "consumed" && state !== "succeeded") {
    fail("invalid_request");
  }
  if ((state === "consumed" || state === "succeeded") && body["nativeReceiptRef"] === null) {
    fail("invalid_request");
  }
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
  const body = verifySignedRecord(record, options, "cli-session-proof", PROOF_FIELDS, PROOF_TTL_MS);
  const mode = body["permissionMode"];
  if (mode !== "interactive" && mode !== "auto-approve" && mode !== "bypass" && mode !== "unknown") {
    fail("invalid_request");
  }
  const policyDigest = body["autoApprovePolicyDigest"];
  if (policyDigest !== null && (typeof policyDigest !== "string" || !/^[a-f0-9]{64}$/.test(policyDigest))) {
    fail("invalid_request");
  }
  return body;
}

/** App authorization attestation: A-signed membership/scope/consent binding. */
export function verifySessionAttestation(record: unknown, options: VerifyOptions): Body {
  const body = verifySignedRecord(record, options, "session-attestation", ATTESTATION_FIELDS, ACTION_TTL_MS);
  checkActor(body["actor"]);
  if (!isTargetRecord(body["target"])) fail("invalid_target");
  checkNonce(body["nonce"]);
  const role = body["role"];
  if (typeof role !== "string" || !ATTESTATION_ROLES.has(role)) fail("invalid_request");
  const operation = body["operation"];
  if (typeof operation !== "string" || !OPERATIONS.has(operation)) fail("invalid_request");
  const scopes = body["actionScopes"];
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    !scopes.every((entry) => typeof entry === "string" && (ACTION_SCOPES as readonly string[]).includes(entry)) ||
    JSON.stringify(scopes) !== JSON.stringify([...scopes].sort()) ||
    new Set(scopes).size !== scopes.length ||
    !scopes.includes(scopeForOperation(operation))
  ) {
    fail("invalid_request");
  }
  return body;
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
  if (options.clockKnown === false || options.clockRollback === true) fail("expired");
  const parts = (compact as string).split(".");
  if (parts.length !== 3) fail("invalid_request");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJwsPart(encodedHeader);
  if (!isAllowedJwsAlg(header["alg"])) fail("unsupported_algorithm");
  checkClosed(header, ["alg", "kid", "typ"]);
  if (header["typ"] !== "h2a-action-session+jwt") fail("invalid_request");
  const kid = asNonEmptyString(header["kid"]);
  const payload = decodeJwsPart(encodedPayload);
  checkClosed(payload, EVIDENCE_CLAIMS);
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
  if (iat * 1000 > options.nowMs + CONSERVATIVE_SKEW_MS) fail("malformed_time");
  if (options.nowMs >= exp * 1000 - 5000) fail("expired");
  if (bindings?.expectedTargetDigest !== undefined && payload["targetDigest"] !== bindings.expectedTargetDigest) {
    fail("binding_mismatch");
  }
  let spkiBase64: string;
  try {
    const entry = resolveTrustEntry(options.trust, kid, "evidence");
    if (entry.issuer !== payload["iss"] || entry.audience !== payload["aud"]) {
      fail("authority_refused");
    }
    try {
      assertLiveKey(entry);
    } catch (error) {
      if (error instanceof TrustError) throw new VerifyError("authority_refused");
      throw error;
    }
    spkiBase64 = entry.publicKeySpkiBase64;
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
