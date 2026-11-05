/**
 * Frozen `remote-action-v1` contract surface for cell N1.
 *
 * Byte source: RC0-interface-draft.5 (frozen joint text) as preserved by
 * RC2.contract r3 (MANIFEST 6245d3ae…). Nothing here invents a schema,
 * domain, bound or route: every literal mirrors the frozen text, and the r3
 * pin below names the exact manifest both sides re-pin on.
 *
 * Canonicalization covers the JCS subset this cell signs: null, boolean,
 * finite integers, ASCII-keyed objects (keys sorted by code unit), arrays and
 * strings escaped exactly as `JSON.stringify` emits them. Records outside
 * that subset (non-integer numbers, non-string map keys, `undefined`) throw
 * instead of producing ambiguous bytes.
 */

import { createHash } from "node:crypto";

export const REMOTE_ACTION_VERSION = "remote-action-v1" as const;

export const SIGNING_DOMAIN_PREFIX = "sentropic.remote-action-v1/" as const;

export const SIGNING_DOMAINS = [
  "target",
  "cli-session-proof",
  "permission-request",
  "input",
  "permission-response",
  "action-envelope",
  "result",
  "typed-event-batch",
  "nonce-publication",
  "session-attestation",
  "source-registration",
  "source-renewal",
  "action-claim",
  "remote-action-audit",
] as const;

export type SigningDomain = (typeof SIGNING_DOMAINS)[number];

/** Raw (non-JOSE) signed bodies carry exactly this alg spelling. */
export const SIGNED_BODY_ALGS = ["Ed25519"] as const;

/** IdP session evidence is a compact JWS with exactly this alg spelling. */
export const JWS_ALGS = ["EdDSA"] as const;

/** Closed 16-field session Target, in frozen field order. */
export const TARGET_FIELDS = [
  "appMeshId",
  "sourceMeshId",
  "nativeAudience",
  "registrationId",
  "tenantId",
  "workspaceId",
  "bindingId",
  "sourceId",
  "sourceSessionId",
  "nativeSessionId",
  "sourceGeneration",
  "bootGeneration",
  "custodyEpoch",
  "controllerEpoch",
  "connectionId",
  "connectionGeneration",
] as const;

const GENERATION_FIELDS: ReadonlySet<string> = new Set([
  "sourceGeneration",
  "bootGeneration",
  "custodyEpoch",
  "controllerEpoch",
  "connectionGeneration",
]);

const ID_PATTERN = /^[\x20-\x7e]+$/;

export function isWireId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= 128 && ID_PATTERN.test(value)
  );
}

export function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export type ContractSourceGapCode = "contract_source_gap_blocked" | "contract_shape_rejected";

export class ContractSourceGapError extends Error {
  readonly code: ContractSourceGapCode;

  constructor(code: ContractSourceGapCode, message?: string) {
    super(message ?? code);
    this.name = "ContractSourceGapError";
    this.code = code;
  }
}

export interface Rc0ImportedSlot {
  readonly status: "BLOCKED_EXTERNAL";
}

/**
 * Shape gate for an `RC0ImportedRecord` descriptor. Only the awaiting-producer
 * slot (`null`, resolved by N1/N5 through a packed import) loads; any locally
 * invented surrogate value is rejected before it can stand in for RC0 bytes.
 */
export function loadRc0ImportedRecord(value: unknown): Rc0ImportedSlot {
  if (value === null) return Object.freeze({ status: "BLOCKED_EXTERNAL" as const });
  throw new ContractSourceGapError(
    "contract_shape_rejected",
    "remote-action: RC0ImportedRecord surrogate is not external authority bytes",
  );
}

/**
 * Fail-closed resolution of an `RC0ImportedRecord` descriptor. The RC0 capsule
 * bytes arrive via N1/N5 packed import only; while the pin reports
 * `BLOCKED_EXTERNAL` no local fill exists, so every descriptor refuses here.
 */
export function assertRc0ImportedRecordResolved(descriptor: unknown): never {
  void descriptor;
  throw new ContractSourceGapError(
    "contract_source_gap_blocked",
    "remote-action: RC0 capsule not received (BLOCKED_EXTERNAL); no local fill",
  );
}

/** True only for the exact closed 16-field Target: no missing, null or extra field. */
export function isTargetRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== TARGET_FIELDS.length) return false;
  for (const field of TARGET_FIELDS) {
    if (!Object.hasOwn(record, field)) return false;
    const entry = record[field];
    if (GENERATION_FIELDS.has(field)) {
      if (!isGeneration(entry)) return false;
    } else if (!isWireId(entry)) {
      return false;
    }
  }
  return true;
}

export const ACTION_TTL_MS = 30000;
export const NONCE_TTL_MS = 60000;
export const PROOF_TTL_MS = 60000;
export const CONSERVATIVE_SKEW_MS = 5000;
export const MAX_ENVELOPE_BYTES = 65536;
export const MAX_RESULT_BYTES = 16384;
export const MAX_INPUT_BYTES = 32768;

export const ACTION_ROUTES = {
  "action-nonce": {
    method: "POST",
    path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/nonces",
  },
  "action-claim": {
    method: "POST",
    path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/:actionId/claim",
  },
  "action-result": {
    method: "POST",
    path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/:actionId/results",
  },
  "action-stream": {
    method: "GET",
    path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/stream",
  },
} as const;

export type ActionRouteId = keyof typeof ACTION_ROUTES;

/** r3 pin both sides re-pin on. Hashes mirror `pin.json` and the r3 manifest. */
export const RC2_R3_PIN = {
  manifestSha256: "6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715",
  revision: "r3",
  contractManifestSha256: "88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565",
  vectors: {
    "consent-native-canonical.json":
      "436d59008001e58252000b040509d1dc551d9aa82370a57f6c514cdd8360d10a",
    "RC0ImportedRecord.json":
      "951abfe00143599da7841707939bb5cec083665424b6cf5ed8ce986e818664c6",
    "route-action-nonce.json":
      "9e3823d0ab962d3cba8924b19f08d4a05de205f1c24456be3b45301d8da15fdb",
    "route-action-claim.json":
      "8735fae8ff6d153d0b0fcdf0462346cbe3c90776e1440efbb4814aa871d8c4b6",
    "route-action-result.json":
      "20e3a453f6427cf71abee300dd99b9b6548938f68d8647668cac19bc473ea332",
    "route-action-stream.json":
      "1d9c3a48f0a19c0858ce5cf82ea181d27e8945bd07665ca35a2cae0947a644e4",
    "public-fixture-trust.json":
      "81ed3136e06d95eedb056cdc5d19efebad1225d8626b836565685fcbc05167d1",
    "state-transitions.json":
      "3e3e4acc27f6e7615c22dc08fabd75bcdb5339097104e0487e384d6ebbd4f018",
  },
} as const;

/** Deterministic canonical JSON for the signing subset (see header note). */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("remote-action: non-integer number is not canonicalizable");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error("remote-action: value is not canonicalizable");
}

/**
 * D(kind, value) = SHA256(UTF8(prefix + kind) || 0x00 || suffix) where the
 * suffix is the exact decoded bytes for `Buffer` input (the `input` domain)
 * and the UTF-8 canonical JSON otherwise.
 */
export function digestDomain(kind: string, value: unknown): string {
  const prefix = Buffer.from(`${SIGNING_DOMAIN_PREFIX}${kind}`, "utf8");
  const suffix =
    value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(canonicalJson(value), "utf8");
  return createHash("sha256")
    .update(Buffer.concat([prefix, Buffer.from([0]), suffix]))
    .digest("hex");
}

/** RawHash(bytes) = SHA256(bytes), without any JSON wrapper. */
export function rawHash(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
