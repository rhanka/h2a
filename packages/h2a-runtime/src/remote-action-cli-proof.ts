/**
 * Host-bound CLI proof producer and binding verifier for cell N3.
 *
 * A `cli-session-proof` binds one native terminal session (its exact target,
 * provider and permission mode) to the approved source registration the
 * receiver admitted, so the receiver can verify the proof against its
 * `SourceAdmission` without ever touching a native host. Publication rides
 * `SessionRelayLaneClientV1.request` later (RC2.native); this module is
 * host-local: it mints and verifies records, opens no route, runs no
 * transport and performs no effect.
 *
 * Source gaps stay fail-closed: a missing approved admission, enrollment,
 * signer or provider metadata throws `ContractSourceGapError`
 * (`contract_source_gap_blocked`). Nothing here invents generations, header
 * names, keys or capsule bytes.
 */

import { sign, type KeyObject } from "node:crypto";

import {
  ContractSourceGapError,
  PROOF_TTL_MS,
  REMOTE_ACTION_VERSION,
  SIGNING_DOMAIN_PREFIX,
  canonicalJson,
  digestDomain,
  isGeneration,
  isTargetRecord,
  isWireId,
} from "./remote-action-contract.js";
import {
  VerifyError,
  verifyCliSessionProof,
  type VerifyOptions,
} from "./remote-action-verifier.js";

export const CLI_PROOF_KIND = "cli-session-proof" as const;

export const CLI_PROOF_PERMISSION_MODES = [
  "interactive",
  "auto-approve",
  "bypass",
  "unknown",
] as const;

export type CliProofPermissionMode = (typeof CLI_PROOF_PERMISSION_MODES)[number];

function isPermissionMode(value: unknown): value is CliProofPermissionMode {
  return (
    typeof value === "string" &&
    (CLI_PROOF_PERMISSION_MODES as readonly string[]).includes(value)
  );
}

export function isCliProofPermissionModeInput(
  value: unknown,
): value is CliProofPermissionMode {
  return isPermissionMode(value);
}

const HEX_SHA256_RE = /^[a-f0-9]{64}$/;

function isDigest(value: unknown): value is string {
  return typeof value === "string" && HEX_SHA256_RE.test(value);
}

export interface CliProofOwner {
  issuer: string;
  sub: string;
}

export interface CliProofEnrollment {
  approvedRegistrationRef: string;
  approvedRegistrationRevision: number;
}

export interface CliProofSigner {
  kid: string;
  issuer: string;
  audience: string;
  privateKey: KeyObject;
}

export interface CliProofProvider {
  providerId: string;
  providerVersion: string;
  executableDigest: string;
}

export interface CliProofMintInput {
  target: unknown;
  owner: CliProofOwner;
  enrollment: CliProofEnrollment | null;
  signer: CliProofSigner | null;
  provider: CliProofProvider | null;
  nativeSessionPublicKeyId: string;
  capabilitiesDigest: string;
  permissionMode: CliProofPermissionMode;
  autoApprovePolicyDigest: string | null;
  proofId: string;
  issuedAtMs?: number;
  expiresAtMs?: number;
}

export interface SignedCliSessionProof {
  body: Record<string, unknown>;
  signature: { alg: "Ed25519"; value: string };
}

export interface CliProofBindingExpectation {
  targetDigest: string;
  ownerIssuer: string;
  ownerSub: string;
  approvedRegistrationRef: string;
  approvedRegistrationRevision: number;
  providerId: string;
  providerVersion: string;
  executableDigest: string;
  nativeSessionPublicKeyId: string;
  capabilitiesDigest: string;
  permissionMode: CliProofPermissionMode;
  autoApprovePolicyDigest: string | null;
  proofId: string;
  issuedAt: number;
  expiresAt: number;
}

function failVerify(code: "invalid_request" | "invalid_target"): never {
  throw new VerifyError(code, `remote-action cli-proof: ${code}`);
}

function failGap(message: string): never {
  throw new ContractSourceGapError("contract_source_gap_blocked", message);
}

function signingInputBytes(kind: string, body: Record<string, unknown>): Buffer {
  return Buffer.concat([
    Buffer.from(`${SIGNING_DOMAIN_PREFIX}${kind}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(body), "utf8"),
  ]);
}

/**
 * Mint a signed `cli-session-proof` body. Every composition input must be
 * present: a missing enrollment, signer or provider input refuses with the
 * typed source-gap code instead of filling the slot locally.
 */
export function mintCliSessionProof(
  input: CliProofMintInput,
  nowMs: number,
): SignedCliSessionProof {
  if (input.enrollment === null) {
    failGap("remote-action cli-proof: no approved registration enrollment");
  }
  if (input.signer === null) {
    failGap("remote-action cli-proof: no enrolled native signer");
  }
  if (input.signer.privateKey.asymmetricKeyType !== "ed25519") {
    failVerify("invalid_request");
  }
  if (input.provider === null) {
    failGap("remote-action cli-proof: no provider metadata");
  }
  if (!isTargetRecord(input.target)) failVerify("invalid_target");
  if (
    typeof input.owner !== "object" ||
    input.owner === null ||
    !isWireId(input.owner.issuer) ||
    !isWireId(input.owner.sub)
  ) {
    failVerify("invalid_request");
  }
  if (
    !isWireId(input.enrollment.approvedRegistrationRef) ||
    !isGeneration(input.enrollment.approvedRegistrationRevision)
  ) {
    failVerify("invalid_request");
  }
  if (
    !isWireId(input.signer.kid) ||
    !isWireId(input.signer.issuer) ||
    !isWireId(input.signer.audience)
  ) {
    failVerify("invalid_request");
  }
  if (
    !isWireId(input.provider.providerId) ||
    !isWireId(input.provider.providerVersion) ||
    !isDigest(input.provider.executableDigest)
  ) {
    failVerify("invalid_request");
  }
  if (!isWireId(input.nativeSessionPublicKeyId)) failVerify("invalid_request");
  if (!isDigest(input.capabilitiesDigest)) failVerify("invalid_request");
  if (!isPermissionMode(input.permissionMode)) failVerify("invalid_request");
  if (
    input.autoApprovePolicyDigest !== null &&
    !isDigest(input.autoApprovePolicyDigest)
  ) {
    failVerify("invalid_request");
  }
  if (!isWireId(input.proofId)) failVerify("invalid_request");
  const issuedAt = input.issuedAtMs ?? nowMs;
  const expiresAt = input.expiresAtMs ?? nowMs + PROOF_TTL_MS;
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt >= expiresAt ||
    expiresAt - issuedAt > PROOF_TTL_MS
  ) {
    failVerify("invalid_request");
  }
  const body: Record<string, unknown> = {
    version: REMOTE_ACTION_VERSION,
    kind: CLI_PROOF_KIND,
    issuer: input.signer.issuer,
    kid: input.signer.kid,
    audience: input.signer.audience,
    proofId: input.proofId,
    target: input.target,
    ownerIssuer: input.owner.issuer,
    ownerSub: input.owner.sub,
    approvedRegistrationRef: input.enrollment.approvedRegistrationRef,
    approvedRegistrationRevision: input.enrollment.approvedRegistrationRevision,
    providerId: input.provider.providerId,
    providerVersion: input.provider.providerVersion,
    executableDigest: input.provider.executableDigest,
    nativeSessionPublicKeyId: input.nativeSessionPublicKeyId,
    capabilitiesDigest: input.capabilitiesDigest,
    permissionMode: input.permissionMode,
    autoApprovePolicyDigest: input.autoApprovePolicyDigest,
    issuedAt,
    expiresAt,
  };
  const signature = sign(null, signingInputBytes(CLI_PROOF_KIND, body), input.signer.privateKey);
  return {
    body,
    signature: {
      alg: "Ed25519",
      value: signature.toString("base64url").replace(/=+$/, ""),
    },
  };
}

/**
 * Verify a proof against the §7 bound-CLI binding: N1 signature, shape, TTL,
 * trust and audience first, then exact equality of the full target digest,
 * owner, provider, capabilities and mode. Any field mutation refuses with
 * `binding_mismatch` (validly re-signed) or `invalid_signature` (tampered).
 */
export function verifyCliSessionProofBinding(
  record: unknown,
  options: VerifyOptions,
  expected: CliProofBindingExpectation,
): Record<string, unknown> {
  const body = verifyCliSessionProof(record, options);
  if (digestDomain("target", body["target"]) !== expected.targetDigest) {
    throw new VerifyError("binding_mismatch", "remote-action cli-proof: target digest mismatch");
  }
  if (
    body["ownerIssuer"] !== expected.ownerIssuer ||
    body["ownerSub"] !== expected.ownerSub
  ) {
    throw new VerifyError("binding_mismatch", "remote-action cli-proof: owner mismatch");
  }
  if (
    body["approvedRegistrationRef"] !== expected.approvedRegistrationRef ||
    body["approvedRegistrationRevision"] !== expected.approvedRegistrationRevision
  ) {
    throw new VerifyError("binding_mismatch", "remote-action cli-proof: registration mismatch");
  }
  if (
    body["providerId"] !== expected.providerId ||
    body["providerVersion"] !== expected.providerVersion
  ) {
    throw new VerifyError("binding_mismatch", "remote-action cli-proof: provider mismatch");
  }
  if (body["executableDigest"] !== expected.executableDigest) {
    throw new VerifyError(
      "binding_mismatch",
      "remote-action cli-proof: executable digest mismatch",
    );
  }
  if (body["nativeSessionPublicKeyId"] !== expected.nativeSessionPublicKeyId) {
    throw new VerifyError(
      "binding_mismatch",
      "remote-action cli-proof: native session key mismatch",
    );
  }
  if (body["capabilitiesDigest"] !== expected.capabilitiesDigest) {
    throw new VerifyError(
      "binding_mismatch",
      "remote-action cli-proof: capabilities digest mismatch",
    );
  }
  if (
    body["permissionMode"] !== expected.permissionMode ||
    body["autoApprovePolicyDigest"] !== expected.autoApprovePolicyDigest
  ) {
    throw new VerifyError("binding_mismatch", "remote-action cli-proof: mode mismatch");
  }
  if (
    body["proofId"] !== expected.proofId ||
    body["issuedAt"] !== expected.issuedAt ||
    body["expiresAt"] !== expected.expiresAt
  ) {
    throw new VerifyError("binding_mismatch", "remote-action cli-proof: identity mismatch");
  }
  return body;
}

export type CliProofRouteId = "cli-proof" | "source-open" | "source-renew";

export interface CliProofRouteAdmissionInput {
  routeId: string;
  method: string;
  path: string;
  pathParameters: Record<string, unknown>;
  authenticated: boolean;
  scopeMatches: boolean;
  bound: boolean;
  stage: string;
  engineKind: string;
  lane: string;
  purposeCurrent: boolean;
}

export interface CliProofRouteDecision {
  decision: "allow" | "deny";
  code: string | null;
}

interface CliProofRouteAdmission {
  method: string;
  params: readonly string[];
  stages: readonly string[];
  resolvePath: (params: Record<string, unknown>) => string;
}

/**
 * Model admission table for the three N3 lifecycle routes (`routeGuard`
 * evaluator of the r3 vectors). Pure shape gate over the records the
 * `cli-proof`, `source-open` and `source-renew` routes will carry: no HTTP,
 * no handler, no body read. Refusal families follow the bilateral order —
 * authorization, then scope, then consent, then stage/engine/lane.
 */
const CLI_PROOF_ROUTE_ADMISSION: Record<CliProofRouteId, CliProofRouteAdmission> = {
  "cli-proof": {
    method: "POST",
    params: ["bindingId", "sourceSessionId"],
    stages: ["bound"],
    resolvePath: (params) =>
      `/api/v1/auth/session/content/${params["bindingId"]}/source/sessions/${params["sourceSessionId"]}/proofs`,
  },
  "source-open": {
    method: "POST",
    params: ["bindingId"],
    stages: ["bootstrap", "bound"],
    resolvePath: (params) =>
      `/api/v1/auth/session/content/${params["bindingId"]}/source/sessions`,
  },
  "source-renew": {
    method: "POST",
    params: ["bindingId", "sourceSessionId"],
    stages: ["bound"],
    resolvePath: (params) =>
      `/api/v1/auth/session/content/${params["bindingId"]}/source/sessions/${params["sourceSessionId"]}/renew`,
  },
};

function deny(code: string): CliProofRouteDecision {
  return { decision: "deny", code };
}

export function evaluateCliProofRouteAdmission(
  input: CliProofRouteAdmissionInput,
): CliProofRouteDecision {
  const route = (CLI_PROOF_ROUTE_ADMISSION as Record<string, CliProofRouteAdmission>)[
    input.routeId
  ];
  if (route === undefined) return deny("relay_scope_refused");
  if (input.method !== route.method) return deny("relay_scope_refused");
  const params = input.pathParameters;
  const keys = Object.keys(params);
  if (
    keys.length !== route.params.length ||
    !route.params.every((key) => Object.hasOwn(params, key))
  ) {
    return deny("relay_scope_refused");
  }
  for (const key of route.params) {
    const value = params[key];
    if (typeof value !== "string" || value.length === 0) {
      return deny("relay_scope_refused");
    }
  }
  if (input.path !== route.resolvePath(params)) return deny("relay_scope_refused");
  if (input.authenticated !== true || input.bound !== true) {
    return deny("relay_auth_required");
  }
  if (input.scopeMatches !== true) return deny("relay_scope_refused");
  if (input.purposeCurrent !== true) return deny("relay_consent_refused");
  if (input.engineKind !== "cli") return deny("relay_scope_refused");
  if (!route.stages.includes(input.stage)) return deny("relay_scope_refused");
  if (input.lane !== "lifecycle") return deny("relay_lane_refused");
  return { decision: "allow", code: null };
}

export interface RouteHttpMediaInput {
  contentType: unknown;
  contentEncoding: unknown;
}

/**
 * Model HTTP media gate (`routeHttp` evaluator of the r3 vectors): the three
 * N3 routes accept exactly `application/json` with no content encoding.
 * Shape check only; the HTTP profile itself stays receiver-owned.
 */
export function evaluateRouteHttpMedia(input: RouteHttpMediaInput): CliProofRouteDecision {
  if (
    input.contentType === "application/json" &&
    (input.contentEncoding === null || input.contentEncoding === undefined)
  ) {
    return { decision: "allow", code: null };
  }
  return deny("invalid_request");
}

export interface CliProofSessionFacts {
  nativeSessionId: string;
  controllerEpoch: number;
  /**
   * Host-owned strings, carried so the approved-registration mapping can name
   * them. They are never parsed into wire integers: integer generations come
   * from the approved admission only.
   */
  hostGeneration: string;
  incarnation: string;
}

export interface CliProofSourceAdmission {
  appMeshId: string;
  sourceMeshId: string;
  nativeAudience: string;
  registrationId: string;
  tenantId: string;
  workspaceId: string;
  bindingId: string;
  sourceId: string;
  sourceSessionId: string;
  connectionId: string;
  sourceGeneration: number;
  bootGeneration: number;
  custodyEpoch: number;
  connectionGeneration: number;
}

/**
 * Resolve the closed 16-field wire target from the approved admission plus
 * the host session facts. Only the integer facts (`controllerEpoch`) and the
 * session id cross into the wire record; host generation/incarnation strings
 * are observed but never coerced into integer generations. A missing
 * admission refuses with the typed source-gap code instead of inventing one.
 */
export function resolveCliProofTarget(
  admission: CliProofSourceAdmission | null,
  session: CliProofSessionFacts,
): Record<string, unknown> {
  if (admission === null) {
    failGap("remote-action cli-proof: no approved source admission");
  }
  const ids: Record<string, unknown> = {
    appMeshId: admission.appMeshId,
    sourceMeshId: admission.sourceMeshId,
    nativeAudience: admission.nativeAudience,
    registrationId: admission.registrationId,
    tenantId: admission.tenantId,
    workspaceId: admission.workspaceId,
    bindingId: admission.bindingId,
    sourceId: admission.sourceId,
    sourceSessionId: admission.sourceSessionId,
    connectionId: admission.connectionId,
  };
  for (const value of Object.values(ids)) {
    if (!isWireId(value)) failVerify("invalid_request");
  }
  const generations: Record<string, unknown> = {
    sourceGeneration: admission.sourceGeneration,
    bootGeneration: admission.bootGeneration,
    custodyEpoch: admission.custodyEpoch,
    connectionGeneration: admission.connectionGeneration,
  };
  for (const value of Object.values(generations)) {
    if (!isGeneration(value)) failVerify("invalid_request");
  }
  if (!isWireId(session.nativeSessionId)) failVerify("invalid_request");
  if (!isGeneration(session.controllerEpoch)) failVerify("invalid_request");
  return {
    appMeshId: admission.appMeshId,
    sourceMeshId: admission.sourceMeshId,
    nativeAudience: admission.nativeAudience,
    registrationId: admission.registrationId,
    tenantId: admission.tenantId,
    workspaceId: admission.workspaceId,
    bindingId: admission.bindingId,
    sourceId: admission.sourceId,
    sourceSessionId: admission.sourceSessionId,
    nativeSessionId: session.nativeSessionId,
    sourceGeneration: admission.sourceGeneration,
    bootGeneration: admission.bootGeneration,
    custodyEpoch: admission.custodyEpoch,
    controllerEpoch: session.controllerEpoch,
    connectionId: admission.connectionId,
    connectionGeneration: admission.connectionGeneration,
  };
}
