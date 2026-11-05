/**
 * RC2.authority-native — identity adapters, producer facts, ACK signer.
 *
 * Fail-closed native authority surface. This module implements NO route, NO
 * transport, and performs NO network I/O:
 *
 * - `verifyRecordShape`: closed structural validation for the H1-H4 TARGET
 *   shapes and the RC2 consent/association/capability records (r3 vectors).
 * - `evaluateRecordTrust`: H1-H4 signed positives always refuse
 *   `BLOCKED_EXTERNAL` (DEP-AUTH-B/M0 stay closed — no origin key is ever
 *   enrolled here); drive binding/ack bytes need an enrolled A authority or
 *   refuse, then enforce role pin + signature.
 * - `buildSourceAssociation` (U-RC tuple), `buildCaptureFacts` (SG-R15 gate:
 *   any activation/admission key refuses `capture_not_activated`).
 * - `registerCustody`: isolated signer custody — the signer is a caller-held
 *   callback. File/env/argv-borne key material is rejected
 *   (`custody_unqualified`); same-uid mode-0600 files alone never qualify.
 * - `signDriveConsentAck`: signs ONLY with an enrolled `native-source`
 *   custody whose issuer/kid match the ack body; anything else refuses
 *   `source_role_unavailable`.
 * - `resolveSession`: verifies a `ProcessBindingRef` against the locally
 *   minted binding digest and returns a local `SessionRef`. Foreign origins
 *   refuse `origin_unresolved`; writer epoch/revision are never minted.
 * - `openFactRegistry`: `factRef` idempotence — duplicate identity plus
 *   identical content allocates nothing.
 */

import { computeHash } from "../../canonical.js";
import { AGENT_SESSION_ID_RE } from "./agent-launch-seam.js";

export const BLOCKED_EXTERNAL = "BLOCKED_EXTERNAL";

export type AuthorityRecord =
  | "RoleScopePolicyV1"
  | "RegistryReaderV1"
  | "RegistryInstanceViewV1"
  | "SessionAdmissionEvidenceV1"
  | "RoleAgentAttestationV1"
  | "RemoteDriveConsentBindingV1"
  | "RemoteDriveConsentAckV1"
  | "RemoteSourceAssociationV1"
  | "SessionCaptureCapabilitiesV1";

export type ShapeVerdict = "ACCEPT_SHAPE" | "REJECT_SCHEMA";

// ---------------------------------------------------------------------------
// Structural primitives.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;

function isEntryRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["digest", "id", "revision"]) &&
    isString(value["id"]) &&
    isNumber(value["revision"]) &&
    typeof value["digest"] === "string" &&
    (SHA256_RE.test(value["digest"] as string) || HEX64_RE.test(value["digest"] as string))
  );
}

function isSourceRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["sourceGeneration", "sourceSessionId", "streamIncarnation"]) &&
    isString(value["sourceSessionId"]) &&
    isNumber(value["sourceGeneration"]) &&
    isString(value["streamIncarnation"])
  );
}

function isSessionRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["incarnation", "originInstanceId", "sessionId"]) &&
    isString(value["originInstanceId"]) &&
    isString(value["sessionId"]) &&
    isString(value["incarnation"])
  );
}

function isParty(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["agentUuid", "instanceId", "keyAttestationRef", "registrationRef"]) &&
    isString(value["instanceId"]) &&
    isString(value["agentUuid"]) &&
    isEntryRef(value["registrationRef"]) &&
    isEntryRef(value["keyAttestationRef"])
  );
}

function isWireSignature(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["alg", "value"]) &&
    value["alg"] === "Ed25519" &&
    isString(value["value"]) &&
    (value["value"] as string).length > 0
  );
}

// ---------------------------------------------------------------------------
// Closed shape validators.
// ---------------------------------------------------------------------------

function isRoleScopePolicy(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "actorLaunchName", "allowedCliKinds", "allowedModels", "driveConsentClass",
    "format", "governanceRoles", "mcpRights", "memoryScopes", "policyId",
    "revision", "scope", "signerInstance", "signerKeyId", "signature",
    "signingClass", "validFrom",
  ];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.role-scope-policy/v1") return false;
  for (const k of ["governanceRoles", "allowedCliKinds", "allowedModels", "memoryScopes"]) {
    if (!Array.isArray(value[k])) return false;
  }
  const rights = value["mcpRights"];
  if (
    !isRecord(rights) ||
    !hasExactKeys(rights, ["connectorClasses", "tools"]) ||
    !Array.isArray(rights["tools"]) ||
    !Array.isArray(rights["connectorClasses"])
  ) {
    return false;
  }
  return isNumber(value["revision"]);
}

function isRegistryReader(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["method", "parameters"])) return false;
  const params = value["parameters"];
  if (!isRecord(params)) return false;
  switch (value["method"]) {
    case "currentRevision":
      return hasExactKeys(params, []);
    case "getInstance":
      return hasExactKeys(params, ["agentUuidOrInstance"]) && isString(params["agentUuidOrInstance"]);
    case "listChangesSince":
      return hasExactKeys(params, ["revision"]) && isString(params["revision"]);
    default:
      return false;
  }
}

function isRegistryInstanceView(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = ["agentUuid", "format", "instances", "keys", "registryRevision", "roleScopeBindings"];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.registry-instance/v1") return false;
  return (
    isString(value["registryRevision"]) &&
    isString(value["agentUuid"]) &&
    Array.isArray(value["instances"]) &&
    Array.isArray(value["keys"]) &&
    Array.isArray(value["roleScopeBindings"])
  );
}

function isSessionAdmissionEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "admittedAt", "agentUuid", "attachmentRef", "centralHost", "evidenceDigest",
    "format", "instanceId", "launchName", "signedRequestId", "transportEpoch", "verdict",
  ];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.session-admission/v1") return false;
  return keys.every((k) => k === "format" || isString(value[k]));
}

function isRoleAgentAttestation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "actorLaunchName", "agentUuid", "attestingInstance", "format", "issuedAt",
    "keyIds", "keySetRevision", "launchName", "scope", "signature",
    "signerInstance", "signerKeyId",
  ];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.role-agent-attestation/v1") return false;
  return Array.isArray(value["keyIds"]);
}

function isDriveConsentBinding(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["body", "signature"])) return false;
  if (!isWireSignature(value["signature"])) return false;
  const body = value["body"];
  if (!isRecord(body)) return false;
  const keys = [
    "actionScopes", "agentSessionId", "bindingId", "consentRevision", "driven",
    "executor", "expiresAt", "format", "grantEntryRef", "grantId", "issuedAt",
    "issuer", "journalFenceRef", "kid", "kind", "ownerIssuer", "ownerSub",
    "pairId", "principalCoSignatureRef", "principalDecision", "principalRef",
    "requestEntryRef", "requestHash", "requestId", "scopeDigest",
    "sourceConsentRevision", "sourceRef", "targetDigest",
  ];
  if (!hasExactKeys(body, keys)) return false;
  if (body["format"] !== "h2a.remote-drive-consent-binding/1") return false;
  if (body["kind"] !== "binding") return false;
  return (
    Array.isArray(body["actionScopes"]) &&
    isString(body["agentSessionId"]) &&
    isString(body["bindingId"]) &&
    isNumber(body["consentRevision"]) &&
    isNumber(body["sourceConsentRevision"]) &&
    isNumber(body["expiresAt"]) &&
    isNumber(body["issuedAt"]) &&
    isParty(body["executor"]) &&
    isParty(body["driven"]) &&
    isEntryRef(body["grantEntryRef"]) &&
    isEntryRef(body["requestEntryRef"]) &&
    isEntryRef(body["journalFenceRef"]) &&
    isString(body["grantId"]) &&
    SHA256_RE.test(body["grantId"] as string) &&
    isString(body["requestHash"]) &&
    SHA256_RE.test(body["requestHash"] as string) &&
    isString(body["scopeDigest"]) &&
    SHA256_RE.test(body["scopeDigest"] as string) &&
    isString(body["targetDigest"]) &&
    HEX64_RE.test(body["targetDigest"] as string) &&
    isString(body["requestId"]) &&
    isString(body["pairId"]) &&
    (body["pairId"] as string).startsWith("drive-consent:") &&
    isString(body["issuer"]) &&
    isString(body["kid"]) &&
    isString(body["ownerIssuer"]) &&
    isString(body["ownerSub"]) &&
    isString(body["principalDecision"]) &&
    (body["principalRef"] === null || isEntryRef(body["principalRef"])) &&
    (body["principalCoSignatureRef"] === null || isEntryRef(body["principalCoSignatureRef"])) &&
    isSourceRef(body["sourceRef"])
  );
}

function isDriveConsentAck(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["body", "signature"])) return false;
  if (!isWireSignature(value["signature"])) return false;
  const body = value["body"];
  if (!isRecord(body)) return false;
  const keys = [
    "agentSessionId", "bindingDigest", "bindingId", "consentRevision",
    "drivenInstanceId", "executorInstanceId", "expiresAt", "format", "issuedAt",
    "issuer", "journalFenceRef", "kid", "kind", "sessionRef",
    "sourceConsentRevision", "sourceDenialFloor", "status", "targetDigest",
  ];
  if (!hasExactKeys(body, keys)) return false;
  if (body["format"] !== "h2a.remote-drive-consent-binding/1") return false;
  if (body["kind"] !== "source-ack") return false;
  if (body["status"] !== "accepted") return false;
  return (
    isString(body["agentSessionId"]) &&
    isString(body["bindingId"]) &&
    isString(body["bindingDigest"]) &&
    HEX64_RE.test(body["bindingDigest"] as string) &&
    isNumber(body["consentRevision"]) &&
    isNumber(body["sourceConsentRevision"]) &&
    isNumber(body["sourceDenialFloor"]) &&
    isNumber(body["expiresAt"]) &&
    isNumber(body["issuedAt"]) &&
    isString(body["executorInstanceId"]) &&
    isString(body["drivenInstanceId"]) &&
    isString(body["targetDigest"]) &&
    HEX64_RE.test(body["targetDigest"] as string) &&
    isString(body["issuer"]) &&
    isString(body["kid"]) &&
    isEntryRef(body["journalFenceRef"]) &&
    isSessionRef(body["sessionRef"])
  );
}

function isSourceAssociation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "childEnvironmentAgentSessionId", "format", "kind", "launchDecisionRef",
    "originAgentSessionId", "processBindingRef", "sessionRef", "sourceRef",
  ];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.remote-source-association/1") return false;
  if (value["kind"] !== "managed-cli" && value["kind"] !== "app-chat") return false;
  if (!isSessionRef(value["sessionRef"])) return false;
  if (value["kind"] === "app-chat") {
    // App-native chat maps the whole native tuple to null: no source, no
    // decision/binding refs, no agent session id.
    return (
      value["sourceRef"] === null &&
      value["originAgentSessionId"] === null &&
      value["childEnvironmentAgentSessionId"] === null &&
      value["launchDecisionRef"] === null &&
      value["processBindingRef"] === null
    );
  }
  if (!isSourceRef(value["sourceRef"])) return false;
  if (!isEntryRef(value["launchDecisionRef"]) || !isEntryRef(value["processBindingRef"])) {
    return false;
  }
  return (
    isString(value["originAgentSessionId"]) &&
    (value["originAgentSessionId"] as string).length > 0 &&
    isString(value["childEnvironmentAgentSessionId"]) &&
    (value["childEnvironmentAgentSessionId"] as string).length > 0
  );
}

function isCaptureCapabilities(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "bits", "capabilityRevision", "cliExecutableDigest", "cliVersion", "columns",
    "convergenceManifestDigest", "declaredLosses", "format", "hostKind",
    "kind", "matrixDigest", "matrixSource", "originAgentSessionId",
    "pluginDigest", "pluginIdentity", "pluginVersion", "pointOrdering",
    "providerDialect", "providerTupleDigest", "rc0CapabilitiesDigest", "sourceRef",
  ];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.session-capture/1") return false;
  if (value["kind"] !== "capabilities") return false;
  for (const k of ["pluginIdentity", "pluginVersion", "pluginDigest", "convergenceManifestDigest"]) {
    if (value[k] !== null && !isString(value[k])) return false;
  }
  return (
    isNumber(value["capabilityRevision"]) &&
    isRecord(value["bits"]) &&
    Array.isArray(value["declaredLosses"]) &&
    Array.isArray(value["columns"]) &&
    isSourceRef(value["sourceRef"])
  );
}

/** Closed structural validation for one authority record. Shape only. */
export function verifyRecordShape(record: AuthorityRecord, value: unknown): ShapeVerdict {
  switch (record) {
    case "RoleScopePolicyV1":
      return isRoleScopePolicy(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "RegistryReaderV1":
      return isRegistryReader(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "RegistryInstanceViewV1":
      return isRegistryInstanceView(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "SessionAdmissionEvidenceV1":
      return isSessionAdmissionEvidence(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "RoleAgentAttestationV1":
      return isRoleAgentAttestation(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "RemoteDriveConsentBindingV1":
      return isDriveConsentBinding(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "RemoteDriveConsentAckV1":
      return isDriveConsentAck(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "RemoteSourceAssociationV1":
      return isSourceAssociation(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    case "SessionCaptureCapabilitiesV1":
      return isCaptureCapabilities(value) ? "ACCEPT_SHAPE" : "REJECT_SCHEMA";
    default:
      return "REJECT_SCHEMA";
  }
}

// ---------------------------------------------------------------------------
// Trust evaluation (gates stay closed).
// ---------------------------------------------------------------------------

export interface RecordTrustAuthority {
  readonly issuer: string;
  readonly kid: string;
  /** Issuers this authority recognises (defaults to the pinned issuer). */
  readonly knownIssuers?: readonly string[];
  readonly verify: (
    body: unknown,
    signature: { readonly alg: string; readonly value: string },
  ) => boolean;
}

export type TrustVerdict =
  | { readonly verdict: "TRUSTED" }
  | { readonly verdict: "BLOCKED_EXTERNAL"; readonly requires: readonly string[] }
  | { readonly verdict: "REJECT_SCHEMA" }
  | { readonly verdict: "REJECT_SIGNATURE" }
  | { readonly verdict: "REJECT_ROLE" };

const H_RECORDS: ReadonlySet<string> = new Set([
  "RoleScopePolicyV1",
  "RegistryReaderV1",
  "RegistryInstanceViewV1",
  "SessionAdmissionEvidenceV1",
  "RoleAgentAttestationV1",
]);

/**
 * H1-H4 signed positives always refuse BLOCKED_EXTERNAL: no origin key is
 * ever enrolled here (DEP-AUTH-B/M0). Drive binding/ack bytes need the
 * enrolled A authority, then enforce the pinned role before the signature.
 */
export function evaluateRecordTrust(
  record: AuthorityRecord,
  value: unknown,
  authority: RecordTrustAuthority | null,
): TrustVerdict {
  if (H_RECORDS.has(record)) {
    return {
      verdict: BLOCKED_EXTERNAL,
      requires: ["DEP-AUTH-B/M0 canonical bytes and bilateral pins"],
    };
  }
  if (verifyRecordShape(record, value) !== "ACCEPT_SHAPE") {
    return { verdict: "REJECT_SCHEMA" };
  }
  if (!isRecord(value) || !isRecord(value["body"]) || !isRecord(value["signature"])) {
    return { verdict: "REJECT_SCHEMA" };
  }
  const body = value["body"] as Record<string, unknown>;
  const signature = value["signature"] as { alg: string; value: string };
  if (authority === null) {
    return { verdict: BLOCKED_EXTERNAL, requires: ["A-drive-binding authority"] };
  }
  if (body["issuer"] !== authority.issuer || body["kid"] !== authority.kid) {
    // A recognised but wrong-purpose issuer is a role refusal; an unknown
    // issuer cannot authenticate, so its bytes fail as a signature refusal.
    const known = authority.knownIssuers ?? [authority.issuer];
    if (!known.includes(body["issuer"] as string)) {
      return authority.verify(body, signature)
        ? { verdict: "REJECT_ROLE" }
        : { verdict: "REJECT_SIGNATURE" };
    }
    return { verdict: "REJECT_ROLE" };
  }
  if (!authority.verify(body, signature)) {
    return { verdict: "REJECT_SIGNATURE" };
  }
  return { verdict: "TRUSTED" };
}

// ---------------------------------------------------------------------------
// Producer facts: source association (U-RC) and capture capabilities.
// ---------------------------------------------------------------------------

export interface SessionRefValue {
  readonly originInstanceId: string;
  readonly sessionId: string;
  readonly incarnation: string;
}

export interface SourceRefValue {
  readonly sourceSessionId: string;
  readonly sourceGeneration: number;
  readonly streamIncarnation: string;
}

export interface SourceAssociationInput {
  readonly kind: "managed-cli" | "app-chat";
  readonly sessionRef: SessionRefValue;
  readonly sourceRef?: SourceRefValue;
  readonly agentSessionId?: string;
  readonly decisionDigest?: string;
  readonly bindingDigest?: string;
}

function toEntryRef(id: string, digest: string): { id: string; revision: number; digest: string } {
  return { id, revision: 1, digest };
}

/**
 * U-RC tuple → `agentSessionId`: a managed CLI child carries the verified
 * launch decision id; app-native chat maps to null.
 */
export function buildSourceAssociation(input: SourceAssociationInput): Record<string, unknown> {
  if (!input || (input.kind !== "managed-cli" && input.kind !== "app-chat")) {
    throw new Error("association_refused: kind must be managed-cli or app-chat");
  }
  if (!isSessionRef(input.sessionRef)) {
    throw new Error("association_refused: sessionRef malformed");
  }
  if (input.kind === "managed-cli" && !isSourceRef(input.sourceRef)) {
    throw new Error("association_refused: sourceRef malformed");
  }
  const forCli =
    input.kind === "managed-cli"
      ? (() => {
          if (
            !isString(input.agentSessionId) ||
            !AGENT_SESSION_ID_RE.test(input.agentSessionId as string)
          ) {
            throw new Error("association_refused: managed-cli needs a verified agent session id");
          }
          if (!isString(input.decisionDigest) || !isString(input.bindingDigest)) {
            throw new Error("association_refused: managed-cli needs decision and binding digests");
          }
          return input.agentSessionId as string;
        })()
      : null;
  const value = {
    format: "h2a.remote-source-association/1",
    kind: input.kind,
    sessionRef: { ...input.sessionRef },
    sourceRef: input.kind === "managed-cli" ? { ...(input.sourceRef as SourceRefValue) } : null,
    originAgentSessionId: forCli,
    launchDecisionRef:
      input.kind === "managed-cli"
        ? toEntryRef("launch-decision", input.decisionDigest as string)
        : null,
    processBindingRef:
      input.kind === "managed-cli"
        ? toEntryRef("process-binding", input.bindingDigest as string)
        : null,
    childEnvironmentAgentSessionId: forCli,
  };
  if (verifyRecordShape("RemoteSourceAssociationV1", value) !== "ACCEPT_SHAPE") {
    throw new Error("association_refused: produced value fails the closed shape");
  }
  return value;
}

/**
 * Capabilities producer facts. SG-R15 gate: the facts describe capability,
 * never activation — any activation/admission key refuses
 * `capture_not_activated` and capture stays disabled.
 */
export function buildCaptureFacts(measured: unknown): Record<string, unknown> {
  if (!isRecord(measured)) {
    throw new Error("capture_not_activated: measured facts must be a record");
  }
  for (const key of Object.keys(measured)) {
    if (/activ|admiss/i.test(key)) {
      throw new Error(`capture_not_activated: ${key} requires the SG-R15 committed ACK`);
    }
  }
  if (verifyRecordShape("SessionCaptureCapabilitiesV1", measured) !== "ACCEPT_SHAPE") {
    throw new Error("capture_not_activated: measured facts fail the closed shape");
  }
  return { ...measured };
}

// ---------------------------------------------------------------------------
// Isolated signer custody + drive-ACK signer path.
// ---------------------------------------------------------------------------

export interface CustodySigner {
  (body: Record<string, unknown>): { readonly alg: string; readonly value: string };
}

export interface CustodyHandle {
  readonly role: string;
  readonly issuer: string;
  readonly kid: string;
  readonly fingerprint: string;
  readonly signer: CustodySigner;
}

/**
 * Isolated signer custody. The signer is a caller-held callback: keys live
 * outside CLI, hooks, browser, env and argv. Any file/env/argv-borne key
 * descriptor refuses `custody_unqualified` — same-uid mode-0600 files alone
 * never qualify. Only non-secret references (issuer/kid/fingerprint) leave
 * this adapter.
 */
export function registerCustody(spec: unknown): CustodyHandle {
  if (!isRecord(spec)) throw new Error("custody_unqualified: custody spec must be a record");
  for (const key of ["keyFile", "keyPath", "privateKeyPem", "envVar", "argv"]) {
    if (spec[key] !== undefined) {
      throw new Error(`custody_unqualified: ${key} is not isolated custody`);
    }
  }
  const role = spec["role"];
  const issuer = spec["issuer"];
  const kid = spec["kid"];
  const signer = spec["signer"];
  if (!isString(role) || role.length === 0) throw new Error("custody_unqualified: role required");
  if (!isString(issuer) || issuer.length === 0) {
    throw new Error("custody_unqualified: issuer required");
  }
  if (!isString(kid) || kid.length === 0) throw new Error("custody_unqualified: kid required");
  if (typeof signer !== "function") {
    throw new Error("custody_unqualified: caller-held signer required");
  }
  const fingerprint = computeHash({ issuer, kid }).slice("sha256:".length, "sha256:".length + 16);
  return { role, issuer, kid, fingerprint, signer: signer as CustodySigner };
}

/**
 * B-side drive-ACK signer path: signs ONLY with an enrolled `native-source`
 * custody whose issuer/kid match the ack body. Without it (production until
 * DEP-AUTH-B) every ack refuses `source_role_unavailable` — the native key
 * alone never signs a projection.
 */
export function signDriveConsentAck(
  custody: CustodyHandle,
  body: Record<string, unknown>,
): { body: Record<string, unknown>; signature: { alg: string; value: string } } {
  if (!custody || custody.role !== "native-source" || typeof custody.signer !== "function") {
    throw new Error("source_role_unavailable: no enrolled native source role");
  }
  if (body["issuer"] !== custody.issuer || body["kid"] !== custody.kid) {
    throw new Error("source_role_unavailable: ack issuer/kid must match the enrolled role");
  }
  const signature = custody.signer(body);
  if (
    !isRecord(signature) ||
    (signature["alg"] !== "Ed25519" && signature["alg"] !== "ed25519") ||
    !isString(signature["value"])
  ) {
    throw new Error("source_role_unavailable: signer must return an Ed25519 envelope");
  }
  const ack = {
    body: { ...body },
    signature: { alg: "Ed25519", value: signature["value"] as string },
  };
  if (verifyRecordShape("RemoteDriveConsentAckV1", ack) !== "ACCEPT_SHAPE") {
    throw new Error("source_role_unavailable: signed ack fails the closed shape");
  }
  return ack;
}

// ---------------------------------------------------------------------------
// ProcessBindingRef → SessionRef resolver + fact registry.
// ---------------------------------------------------------------------------

export interface ProcessBindingInput {
  readonly processBindingRef: { readonly id: string; readonly revision: number; readonly digest: string };
  readonly localInstanceId: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly sessionId: string;
  readonly incarnation: string;
  readonly originInstanceId?: string;
}

export type SessionResolution =
  | { readonly ok: true; readonly sessionRef: SessionRefValue; readonly bindingDigest: string }
  | { readonly ok: false; readonly reason: "binding_refused" | "origin_unresolved" };

/**
 * `RegistryInput.resolveSession` producer semantics. The native host mints
 * the binding digest over the canonical local tuple
 * `{ instanceId, pid, startedAt }`; a ref whose digest differs refuses, a
 * foreign origin stays unresolved, and writer epoch/revision are never
 * supplied (mesh-owned).
 */
export function resolveSession(input: ProcessBindingInput): SessionResolution {
  const ref = input?.processBindingRef;
  if (
    !input ||
    !isRecord(ref) ||
    !isString(ref["id"]) ||
    !isNumber(ref["revision"]) ||
    !isString(ref["digest"]) ||
    !isString(input.localInstanceId) ||
    !Number.isSafeInteger(input.pid) ||
    !isString(input.startedAt) ||
    !isString(input.sessionId) ||
    !isString(input.incarnation)
  ) {
    return { ok: false, reason: "binding_refused" };
  }
  const expected = computeHash({
    instanceId: input.localInstanceId,
    pid: input.pid,
    startedAt: input.startedAt,
  });
  if (ref["digest"] !== expected) return { ok: false, reason: "binding_refused" };
  if (input.originInstanceId !== undefined && input.originInstanceId !== input.localInstanceId) {
    return { ok: false, reason: "origin_unresolved" };
  }
  return {
    ok: true,
    sessionRef: {
      originInstanceId: input.localInstanceId,
      sessionId: input.sessionId,
      incarnation: input.incarnation,
    },
    bindingDigest: expected,
  };
}

export interface FactRegistry {
  readonly allocations: number;
  allocFact(
    identity: string,
    content: unknown,
  ): { readonly id: string; readonly revision: number; readonly digest: string };
}

/**
 * Lifecycle/capabilities fact emission with `factRef` idempotence: duplicate
 * identity plus identical content allocates nothing; changed content
 * allocates exactly +1 revision.
 */
export function openFactRegistry(): FactRegistry {
  const commits = new Map<string, { revision: number; digest: string }>();
  const revisions = new Map<string, number>();
  let allocations = 0;
  return {
    get allocations() {
      return allocations;
    },
    allocFact(identity: string, content: unknown) {
      if (!isString(identity) || identity.length === 0) {
        throw new Error("fact_refused: identity required");
      }
      const digest = computeHash({ identity, content });
      const key = `${identity}\0${digest}`;
      const existing = commits.get(key);
      if (existing) return { id: factId(identity, digest), revision: existing.revision, digest };
      const revision = (revisions.get(identity) ?? 0) + 1;
      revisions.set(identity, revision);
      commits.set(key, { revision, digest });
      allocations += 1;
      return { id: factId(identity, digest), revision, digest };
    },
  };
}

function factId(identity: string, digest: string): string {
  void identity;
  return `fact-${digest.slice("sha256:".length, "sha256:".length + 12)}`;
}
