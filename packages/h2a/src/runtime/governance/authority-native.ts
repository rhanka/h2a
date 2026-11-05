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
 *   refuse, then enforce role pin + signature — and even then never return
 *   TRUSTED until the B5+ composition compares every bound field.
 * - `buildSourceAssociation` (U-RC tuple), `buildCaptureFacts` (SG-R15 gate:
 *   any activation/admission key refuses `capture_not_activated`).
 * - `registerCustody`: isolated signer custody — the signer is a caller-held
 *   callback. The spec is closed; any key suggesting key material (exact
 *   names, synonyms, long forms) is rejected (`custody_unqualified`);
 *   same-uid mode-0600 files alone never qualify. Handles are branded.
 * - `signDriveConsentAck`: NEUTRALISED — always refuses
 *   `source_role_unavailable` until the binding↔ack↔projection↔fence
 *   composition exists (B5+). No signature is emitted on this path.
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

// r3 $defs: Id (printable ASCII 1..128), Counter/Timestamp (integers
// 0..2^53-1), Digest (hex64), NativeHash (sha256:hex64), Sig64 (86 chars).
const ID_RE = /^[\x20-\x7e]+$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const SIG64_RE = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const PAIR_ID_RE = /^drive-consent:sha256:[a-f0-9]{64}$/;
const REQUEST_ID_RE = /^[a-f0-9-]{32,36}$/;

function isId(value: unknown): value is string {
  return (
    isString(value) &&
    value.length >= 1 &&
    value.length <= 128 &&
    ID_RE.test(value)
  );
}

function isCounter(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 9007199254740991
  );
}

function isTimestamp(value: unknown): value is number {
  return isCounter(value);
}

function isDigest(value: unknown): value is string {
  return isString(value) && HEX64_RE.test(value);
}

function isNativeHash(value: unknown): value is string {
  return isString(value) && SHA256_RE.test(value);
}

function isEntryRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["digest", "id", "revision"]) &&
    isId(value["id"]) &&
    isCounter(value["revision"]) &&
    isDigest(value["digest"])
  );
}

function isSourceRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["sourceGeneration", "sourceSessionId", "streamIncarnation"]) &&
    isId(value["sourceSessionId"]) &&
    isCounter(value["sourceGeneration"]) &&
    isId(value["streamIncarnation"])
  );
}

function isSessionRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["incarnation", "originInstanceId", "sessionId"]) &&
    isId(value["originInstanceId"]) &&
    isId(value["sessionId"]) &&
    isId(value["incarnation"])
  );
}

function isParty(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["agentUuid", "instanceId", "keyAttestationRef", "registrationRef"]) &&
    isId(value["instanceId"]) &&
    isId(value["agentUuid"]) &&
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
    SIG64_RE.test(value["value"] as string)
  );
}

// ---------------------------------------------------------------------------
// Closed shape validators.
// ---------------------------------------------------------------------------

function isIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId);
}

// P2-1 round 3: the only signing class attested by the r3 vectors is D0 —
// the set is closed, anything else (e.g. D9) refuses.
const SIGNING_CLASSES: readonly string[] = ["D0"];
// P2-1 round 3: no r3 vector attests any memory-scope value — the set is
// closed and empty, so any entry refuses fail-closed (deferred to B5+).
const MEMORY_SCOPES: readonly string[] = [];

function isRoleScopePolicy(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // r3: 16 required + 3 optionals (effortCeiling, validUntil, supersedes).
  const required = [
    "actorLaunchName", "allowedCliKinds", "allowedModels", "driveConsentClass",
    "format", "governanceRoles", "mcpRights", "memoryScopes", "policyId",
    "revision", "scope", "signerInstance", "signerKeyId", "signature",
    "signingClass", "validFrom",
  ];
  const optional = ["effortCeiling", "validUntil", "supersedes"];
  const actual = Object.keys(value);
  if (
    actual.length < required.length ||
    actual.length > required.length + optional.length ||
    !required.every((k) => Object.hasOwn(value, k)) ||
    !actual.every((k) => required.includes(k) || optional.includes(k))
  ) {
    return false;
  }
  if (value["format"] !== "h2a.role-scope-policy/v1") return false;
  if (!SIGNING_CLASSES.includes(value["signingClass"] as string)) return false;
  for (const k of ["governanceRoles", "allowedCliKinds", "allowedModels"]) {
    if (!isIdArray(value[k])) return false;
  }
  // P2-1 round 3: memory scopes are a closed enum, not free strings.
  if (!isIdArray(value["memoryScopes"])) return false;
  if (!(value["memoryScopes"] as string[]).every((s) => MEMORY_SCOPES.includes(s))) {
    return false;
  }
  const rights = value["mcpRights"];
  if (
    !isRecord(rights) ||
    !hasExactKeys(rights, ["connectorClasses", "tools"]) ||
    !isIdArray(rights["tools"]) ||
    !isIdArray(rights["connectorClasses"])
  ) {
    return false;
  }
  // P2-1 round 3: typed optionals — a Counter ceiling, Id validUntil /
  // supersedes. Anything else refuses.
  if (value["effortCeiling"] !== undefined && !isCounter(value["effortCeiling"])) {
    return false;
  }
  if (value["validUntil"] !== undefined && !isId(value["validUntil"])) return false;
  if (value["supersedes"] !== undefined && !isId(value["supersedes"])) return false;
  return (
    isId(value["policyId"]) &&
    isId(value["actorLaunchName"]) &&
    isId(value["scope"]) &&
    isId(value["driveConsentClass"]) &&
    isId(value["validFrom"]) &&
    isId(value["signerInstance"]) &&
    isId(value["signerKeyId"]) &&
    isId(value["signature"]) &&
    isCounter(value["revision"])
  );
}

function isRegistryReader(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["method", "parameters"])) return false;
  const params = value["parameters"];
  if (!isRecord(params)) return false;
  switch (value["method"]) {
    case "currentRevision":
      return hasExactKeys(params, []);
    case "getInstance":
      return hasExactKeys(params, ["agentUuidOrInstance"]) && isId(params["agentUuidOrInstance"]);
    case "listChangesSince":
      return hasExactKeys(params, ["revision"]) && isId(params["revision"]);
    default:
      return false;
  }
}

function isRegistryInstanceView(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // r3: 6 required + 2 optionals (launchName, offboardTombstone).
  const required = ["agentUuid", "format", "instances", "keys", "registryRevision", "roleScopeBindings"];
  const optional = ["launchName", "offboardTombstone"];
  const actual = Object.keys(value);
  if (
    actual.length < required.length ||
    actual.length > required.length + optional.length ||
    !required.every((k) => Object.hasOwn(value, k)) ||
    !actual.every((k) => required.includes(k) || optional.includes(k))
  ) {
    return false;
  }
  if (value["format"] !== "h2a.registry-instance/v1") return false;
  // P2-1 round 3: launchName is an optional Id, offboardTombstone an
  // optional record — never a bare string or number. Items are typed:
  // instance/binding rows are records, key rows are entry refs.
  if (value["launchName"] !== undefined && !isId(value["launchName"])) return false;
  if (value["offboardTombstone"] !== undefined && !isRecord(value["offboardTombstone"])) {
    return false;
  }
  const instances = value["instances"];
  const bindings = value["roleScopeBindings"];
  if (
    !Array.isArray(instances) ||
    !instances.every(isRecord) ||
    !Array.isArray(bindings) ||
    !bindings.every(isRecord)
  ) {
    return false;
  }
  const keyList = value["keys"];
  if (!Array.isArray(keyList) || !keyList.every(isEntryRef)) return false;
  return isId(value["registryRevision"]) && isId(value["agentUuid"]);
}

function isSessionAdmissionEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "admittedAt", "agentUuid", "attachmentRef", "centralHost", "evidenceDigest",
    "format", "instanceId", "launchName", "signedRequestId", "transportEpoch", "verdict",
  ];
  if (!hasExactKeys(value, keys)) return false;
  if (value["format"] !== "h2a.session-admission/v1") return false;
  // r3: verdict is const "admitted".
  if (value["verdict"] !== "admitted") return false;
  // P2-1 round 3: every other field is an Id, not a free string.
  return keys.every((k) => k === "format" || k === "verdict" || isId(value[k]));
}

function isRoleAgentAttestation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // P2-1 round 3: 12 required + admitted optional expiresAt (parallel to
  // issuedAt — the r3 vectors carry both as strings, never numbers).
  const required = [
    "actorLaunchName", "agentUuid", "attestingInstance", "format", "issuedAt",
    "keyIds", "keySetRevision", "launchName", "scope", "signature",
    "signerInstance", "signerKeyId",
  ];
  const optional = ["expiresAt"];
  const actual = Object.keys(value);
  if (
    actual.length < required.length ||
    actual.length > required.length + optional.length ||
    !required.every((k) => Object.hasOwn(value, k)) ||
    !actual.every((k) => required.includes(k) || optional.includes(k))
  ) {
    return false;
  }
  if (value["format"] !== "h2a.role-agent-attestation/v1") return false;
  if (value["expiresAt"] !== undefined && !isId(value["expiresAt"])) return false;
  if (!isIdArray(value["keyIds"])) return false;
  return (
    isId(value["actorLaunchName"]) &&
    isId(value["agentUuid"]) &&
    isId(value["attestingInstance"]) &&
    isId(value["issuedAt"]) &&
    isId(value["keySetRevision"]) &&
    isId(value["launchName"]) &&
    isId(value["scope"]) &&
    isId(value["signature"]) &&
    isId(value["signerInstance"]) &&
    isId(value["signerKeyId"])
  );
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
  // r3: actionScopes = 1-2 unique enums; principalDecision = enum;
  // principalRef = Id|null (not EntryRef); pairId = full 85-char pattern.
  const scopes = body["actionScopes"];
  if (
    !Array.isArray(scopes) ||
    scopes.length < 1 ||
    scopes.length > 2 ||
    new Set(scopes).size !== scopes.length ||
    !scopes.every((s) => s === "remote.input" || s === "remote.permission.respond")
  ) {
    return false;
  }
  return (
    isId(body["agentSessionId"]) &&
    isId(body["bindingId"]) &&
    isCounter(body["consentRevision"]) &&
    isCounter(body["sourceConsentRevision"]) &&
    isTimestamp(body["expiresAt"]) &&
    isTimestamp(body["issuedAt"]) &&
    isParty(body["executor"]) &&
    isParty(body["driven"]) &&
    isEntryRef(body["grantEntryRef"]) &&
    isEntryRef(body["requestEntryRef"]) &&
    isEntryRef(body["journalFenceRef"]) &&
    isNativeHash(body["grantId"]) &&
    isNativeHash(body["requestHash"]) &&
    isNativeHash(body["scopeDigest"]) &&
    isDigest(body["targetDigest"]) &&
    isString(body["requestId"]) &&
    REQUEST_ID_RE.test(body["requestId"] as string) &&
    isString(body["pairId"]) &&
    PAIR_ID_RE.test(body["pairId"] as string) &&
    isId(body["issuer"]) &&
    isId(body["kid"]) &&
    isId(body["ownerIssuer"]) &&
    isId(body["ownerSub"]) &&
    (body["principalDecision"] === "principal-absent" ||
      body["principalDecision"] === "co-signed") &&
    (body["principalRef"] === null || isId(body["principalRef"])) &&
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
    isId(body["agentSessionId"]) &&
    isId(body["bindingId"]) &&
    isDigest(body["bindingDigest"]) &&
    isCounter(body["consentRevision"]) &&
    isCounter(body["sourceConsentRevision"]) &&
    isCounter(body["sourceDenialFloor"]) &&
    isTimestamp(body["expiresAt"]) &&
    isTimestamp(body["issuedAt"]) &&
    isId(body["executorInstanceId"]) &&
    isId(body["drivenInstanceId"]) &&
    isDigest(body["targetDigest"]) &&
    isId(body["issuer"]) &&
    isId(body["kid"]) &&
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
  // P2-1 round 3: agent session ids are Ids (printable ASCII 1..128) —
  // a 500-char string or a number refuses.
  return isId(value["originAgentSessionId"]) && isId(value["childEnvironmentAgentSessionId"]);
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
  // P2-1 round 3: hostKind and matrixSource are closed — the only values
  // attested by the r3 vectors. Anything else refuses.
  if (value["hostKind"] !== "claude") return false;
  if (value["matrixSource"] !== "H2A_HOST_HOOK_CAPABILITIES") return false;
  // P2-1 round 3: digest slots hold hex64 digests, never free strings.
  for (const k of ["cliExecutableDigest", "matrixDigest", "rc0CapabilitiesDigest", "providerTupleDigest"]) {
    if (!isDigest(value[k])) return false;
  }
  if (!isId(value["cliVersion"]) || !isId(value["providerDialect"])) return false;
  if (!isId(value["originAgentSessionId"])) return false;
  // r3: bits = closed capability map of exactly the 5 known bits, each an
  // exact 8-key entry (state enum + refs + the 4 digest slots, null when a
  // slot does not apply).
  const BIT_STATES = ["unavailable", "contract-only", "installed-qualified"];
  const KNOWN_BITS = [
    "ptyBytes", "structuredDeltas", "completePermissionContext",
    "literalInput", "permissionResponse",
  ];
  const BIT_KEYS = [
    "state", "producerRef", "cliVersion", "dialect",
    "executableDigest", "pluginDigest", "receiptDigest", "sourceGap",
  ];
  const bits = value["bits"];
  if (!isRecord(bits)) return false;
  const bitNames = Object.keys(bits);
  if (bitNames.length !== KNOWN_BITS.length || !KNOWN_BITS.every((b) => Object.hasOwn(bits, b))) {
    return false;
  }
  for (const entry of Object.values(bits)) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, BIT_KEYS) ||
      !BIT_STATES.includes(entry["state"] as string) ||
      !isId(entry["producerRef"]) ||
      !isId(entry["cliVersion"]) ||
      !isId(entry["dialect"]) ||
      !isDigest(entry["executableDigest"]) ||
      (entry["pluginDigest"] !== null && !isDigest(entry["pluginDigest"])) ||
      (entry["receiptDigest"] !== null && !isDigest(entry["receiptDigest"])) ||
      (entry["sourceGap"] !== null && !isId(entry["sourceGap"]))
    ) {
      return false;
    }
  }
  const COLUMNS = [
    "typed-message", "typed-tool-call", "typed-tool-result", "permission-request",
    "permission-response", "literal-input", "pty-fallback", "sub-agent-call-attribution",
  ];
  const COLUMN_STATES = ["enforced", "rendered", "guided", "gap", "not-applicable"];
  const COLUMN_KEYS = ["column", "state", "cliVersion", "dialect", "receiptDigest", "sourceGap"];
  const columns = value["columns"];
  // P2-1 round 3: exactly the 8 known columns, each an exact 6-key entry.
  if (!Array.isArray(columns) || columns.length !== COLUMNS.length) return false;
  for (const col of columns) {
    if (
      !isRecord(col) ||
      !hasExactKeys(col, COLUMN_KEYS) ||
      !COLUMNS.includes(col["column"] as string) ||
      !COLUMN_STATES.includes(col["state"] as string) ||
      !isId(col["cliVersion"]) ||
      !isId(col["dialect"]) ||
      (col["receiptDigest"] !== null && !isDigest(col["receiptDigest"])) ||
      (col["sourceGap"] !== null && !isId(col["sourceGap"]))
    ) {
      return false;
    }
  }
  // P2-1 round 3: declared losses are a closed, duplicate-free enum;
  // pointOrdering is an array of Ids, never a bare string.
  const LOSSES = ["no-structured-deltas", "incomplete-context", "no-literal-input", "no-permission-response"];
  const losses = value["declaredLosses"];
  if (
    !Array.isArray(losses) ||
    new Set(losses).size !== losses.length ||
    !losses.every((l) => LOSSES.includes(l as string))
  ) {
    return false;
  }
  if (!isIdArray(value["pointOrdering"])) return false;
  return isCounter(value["capabilityRevision"]) && isSourceRef(value["sourceRef"]);
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
 *
 * P1-1 neutralisation (rv416w, composition lot B5+) : even a well-formed,
 * well-signed binding/ack never returns TRUSTED here — no bound field is
 * compared against an independent expectation on this path. It refuses
 * BLOCKED_EXTERNAL until the binding↔ACK↔projection↔fence composition
 * exists and every bound field is compared.
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
  return {
    verdict: BLOCKED_EXTERNAL,
    requires: ["binding↔ack↔projection↔fence composition (B5+) — no TRUSTED until every bound field is compared"],
  };
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
          // r3 RevisionRef.digest is Digest (hex64): reject sha256:-prefixed
          // or malformed digests at the producer, not just at the shape.
          if (!isDigest(input.decisionDigest) || !isDigest(input.bindingDigest)) {
            throw new Error("association_refused: managed-cli needs hex64 decision and binding digests");
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
 * outside CLI, hooks, browser, env and argv. The spec is closed
 * (`role,issuer,kid,fingerprint?,signer` only): any other key — including
 * synonyms or long forms carrying key material — refuses
 * `custody_unqualified` fail-closed. Same-uid mode-0600 files alone never
 * qualify. Only non-secret references (issuer/kid/fingerprint) leave
 * this adapter. Enrolled handles are branded: only the exact object
 * returned here is ever accepted downstream.
 */
const ENROLLED_CUSTODY = new WeakSet<object>();

export function registerCustody(spec: unknown): CustodyHandle {
  if (!isRecord(spec)) throw new Error("custody_unqualified: custody spec must be a record");
  // Fail-closed material screen first: any key whose name suggests key
  // material refuses, even under a name the closed spec never listed.
  for (const key of Object.keys(spec)) {
    if (/key|private|secret|pem|token|passw|credential|seed|env|argv|path|file|vault|kms|hsm/i.test(key)) {
      throw new Error(`custody_unqualified: ${key} is not isolated custody`);
    }
  }
  for (const key of Object.keys(spec)) {
    if (!["role", "issuer", "kid", "fingerprint", "signer"].includes(key)) {
      throw new Error(`custody_unqualified: unknown custody field ${key}`);
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
  if (spec["fingerprint"] !== undefined && !isString(spec["fingerprint"])) {
    throw new Error("custody_unqualified: fingerprint must be a string");
  }
  const fingerprint =
    isString(spec["fingerprint"]) && spec["fingerprint"].length > 0
      ? (spec["fingerprint"] as string)
      : computeHash({ issuer, kid }).slice("sha256:".length, "sha256:".length + 16);
  const handle: CustodyHandle = { role, issuer, kid, fingerprint, signer: signer as CustodySigner };
  ENROLLED_CUSTODY.add(handle);
  return handle;
}

/** True only for the exact object returned by `registerCustody`. */
export function isEnrolledCustody(custody: unknown): custody is CustodyHandle {
  return !!custody && typeof custody === "object" && ENROLLED_CUSTODY.has(custody);
}

/**
 * B-side drive-ACK signer path — NEUTRALISED fail-closed (rv416w P1-2,
 * composition lot B5+). No signature is emitted on this path until the
 * binding↔ACK↔projection↔fence composition exists: the ACK signer would
 * otherwise sign without consent authority (no binding digest recomputed
 * or compared, no projection consulted, no fence checked). Every call
 * refuses `source_role_unavailable`, including enrolled native-source
 * handles and well-formed bodies.
 */
export function signDriveConsentAck(
  custody: CustodyHandle,
  body: Record<string, unknown>,
): { body: Record<string, unknown>; signature: { alg: string; value: string } } {
  void custody;
  void body;
  throw new Error(
    "source_role_unavailable: ack signing suspended until the binding↔ack↔projection↔fence composition exists (B5+)",
  );
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

/**
 * Host-observed process port. The liveness half of the bound tuple
 * (pid + startedAt) is read here — never from the bearer bag, which any
 * caller can self-mint. Live wiring to the real process table belongs to
 * the B5+ composition; until then callers inject a stub or fail closed.
 */
export interface HostProcessPort {
  observeProcess(): { readonly pid: number; readonly startedAt: string } | null;
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
 *
 * P2-2 round 3: the liveness half (pid + startedAt) is host-observed via
 * the injected port — the bearer bag alone never resolves.
 */
export function resolveSession(
  input: ProcessBindingInput,
  host?: HostProcessPort | null,
): SessionResolution {
  const ref = input?.processBindingRef;
  if (
    !input ||
    !isRecord(ref) ||
    !isId(ref["id"]) ||
    !isCounter(ref["revision"]) ||
    (ref["revision"] as number) < 1 ||
    // Binding digests are producer-minted (computeHash output): hex64 or
    // sha256:hex64 both bind; anything else refuses.
    (!isDigest(ref["digest"]) && !isNativeHash(ref["digest"])) ||
    !isId(input.localInstanceId) ||
    !Number.isSafeInteger(input.pid) ||
    !isString(input.startedAt) ||
    !isId(input.sessionId) ||
    !isId(input.incarnation)
  ) {
    return { ok: false, reason: "binding_refused" };
  }
  // P2-4: origin is required (an omitted origin never defaults to local),
  // and the bound digest covers the session/incarnation/ref identity —
  // a ref minted for one session cannot resolve to another.
  if (input.originInstanceId === undefined) {
    return { ok: false, reason: "origin_unresolved" };
  }
  if (input.originInstanceId !== input.localInstanceId) {
    return { ok: false, reason: "origin_unresolved" };
  }
  // P2-2 round 3: without a host port the origin stays unresolved —
  // fail-closed until the B5+ host wiring exists.
  if (!host) {
    return { ok: false, reason: "origin_unresolved" };
  }
  const observed = host.observeProcess();
  if (!observed || !Number.isSafeInteger(observed.pid) || !isString(observed.startedAt)) {
    return { ok: false, reason: "origin_unresolved" };
  }
  // P2-2 round 3: the liveness expectation comes from the host-observed
  // tuple, never from the bearer bag — a self-minted tuple with a
  // hand-recomputed digest refuses.
  const expected = computeHash({
    instanceId: input.localInstanceId,
    pid: observed.pid,
    startedAt: observed.startedAt,
    sessionId: input.sessionId,
    incarnation: input.incarnation,
    refId: ref["id"],
    refRevision: ref["revision"],
  });
  if (ref["digest"] !== expected) return { ok: false, reason: "binding_refused" };
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
