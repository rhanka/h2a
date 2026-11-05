/**
 * Public `remote-action-v1` route surface for cell N1 (no HTTP routes here).
 *
 * N1 parses and verifies the records the `action-nonce`, `action-stream`,
 * `action-claim` and `action-result` routes will carry. This module owns the
 * route payload-shape gate (which kinds a route accepts, and what a claim
 * must never carry), the internal-to-public refusal mapping (annex B: exact
 * signatures, typed refusals, never an invented code), and the §8 refusal
 * split: local relay errors stay typed values on this side, while
 * `endpointRefusal` bytes cross the boundary opaque and are only
 * shape-checked, never decoded for authority.
 */

import {
  REMOTE_ACTION_VERSION,
  isGeneration,
  isWireId,
  type ActionRouteId,
} from "./remote-action-contract.js";
import { VerifyError } from "./remote-action-verifier.js";

const ROUTE_KINDS: Record<ActionRouteId, readonly string[]> = {
  "action-nonce": ["nonce-publication"],
  "action-claim": ["action-claim"],
  "action-result": ["result"],
  "action-stream": ["action-ready", "result-query"],
};

const KNOWN_ROUTES: ReadonlySet<string> = new Set(Object.keys(ROUTE_KINDS));

export interface ParsedRouteRecord {
  kind: string;
  body: Record<string, unknown>;
}

const ACTION_READY_FIELDS = [
  "version",
  "kind",
  "actionId",
  "envelopeDigest",
  "connectionGeneration",
  "issuedAt",
  "expiresAt",
] as const;

const RESULT_QUERY_FIELDS = [
  "version",
  "kind",
  "queryId",
  "actionId",
  "envelopeDigest",
  "issuedAt",
  "expiresAt",
] as const;

const HEX_SHA256_RE = /^[a-f0-9]{64}$/;

function isClosedRecord(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
}

function checkOrderedLifetime(issuedAt: unknown, expiresAt: unknown): void {
  if (typeof issuedAt !== "number" || typeof expiresAt !== "number") {
    throw new VerifyError("invalid_request");
  }
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || issuedAt < 0) {
    throw new VerifyError("invalid_request");
  }
  if (issuedAt > expiresAt) throw new VerifyError("invalid_request");
}

/**
 * Shape gate for one route record. Rejects unknown routes, non-object
 * bodies, wrong kinds, version drift, and action bodies smuggled into a
 * claim (a claim carries identities and digests, never the envelope).
 * Stream signals carry typed bounds: action-ready binds the current
 * connection generation, result-query carries an A-minted queryId with a
 * lifetime of at most 30000 ms for ledger lookup only.
 */
export function parseActionRouteRecord(routeId: string, value: unknown): ParsedRouteRecord {
  if (!KNOWN_ROUTES.has(routeId)) throw new VerifyError("invalid_request", `unknown route ${routeId}`);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VerifyError("invalid_request");
  }
  const body = (value as Record<string, unknown>)["body"];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new VerifyError("invalid_request");
  }
  const record = body as Record<string, unknown>;
  if (record["version"] !== REMOTE_ACTION_VERSION) throw new VerifyError("unsupported_version");
  const kind = record["kind"];
  if (typeof kind !== "string" || !ROUTE_KINDS[routeId as ActionRouteId].includes(kind)) {
    throw new VerifyError("invalid_request");
  }
  if (routeId === "action-claim" && (Object.hasOwn(record, "envelope") || Object.hasOwn(record, "payload"))) {
    throw new VerifyError("invalid_request");
  }
  if (routeId === "action-stream") {
    if (kind === "action-ready") {
      if (!isClosedRecord(record, ACTION_READY_FIELDS)) throw new VerifyError("invalid_request");
      if (!isWireId(record["actionId"])) throw new VerifyError("invalid_request");
      if (typeof record["envelopeDigest"] !== "string" || !HEX_SHA256_RE.test(record["envelopeDigest"])) {
        throw new VerifyError("invalid_request");
      }
      if (!isGeneration(record["connectionGeneration"])) throw new VerifyError("invalid_request");
      checkOrderedLifetime(record["issuedAt"], record["expiresAt"]);
    } else {
      if (!isClosedRecord(record, RESULT_QUERY_FIELDS)) throw new VerifyError("invalid_request");
      if (!isWireId(record["queryId"]) || !isWireId(record["actionId"])) {
        throw new VerifyError("invalid_request");
      }
      if (typeof record["envelopeDigest"] !== "string" || !HEX_SHA256_RE.test(record["envelopeDigest"])) {
        throw new VerifyError("invalid_request");
      }
      checkOrderedLifetime(record["issuedAt"], record["expiresAt"]);
      if ((record["expiresAt"] as number) - (record["issuedAt"] as number) > 30000) {
        throw new VerifyError("invalid_request");
      }
    }
  }
  return { kind, body: record };
}

/** Internal verifier diagnostics mapped onto the closed public HTTP codes. */
export function publicRefusalFor(code: string): string {
  switch (code) {
    case "invalid_request":
    case "invalid_signature":
    case "invalid_target":
    case "unsupported_algorithm":
    case "malformed_time":
      return "invalid_request";
    case "unknown_kid":
    case "revoked_key":
    case "wrong_purpose":
    case "binding_mismatch":
    case "authority_refused":
    case "input_mode_refused":
      return "authority_refused";
    case "unsupported_version":
      return "unsupported_version";
    case "expired":
    case "evidence_lifetime":
      return "expired";
    default:
      return "invalid_request";
  }
}

/**
 * Frozen refusal code → HTTP status table (`RC0EndpointRefusalV1` schema).
 * The schema is the single source: every pair below mirrors one of its
 * `(code, httpStatus)` variants, and unknown codes fall back to 400.
 */
export const FROZEN_REFUSAL_STATUS: Record<string, number> = Object.freeze({
  invalid_request: 400,
  authentication_required: 401,
  source_auth_required: 401,
  origin_refused: 403,
  authority_refused: 403,
  workspace_membership_required: 403,
  role_refused: 403,
  action_scope_refused: 403,
  input_mode_refused: 403,
  control_disabled: 403,
  capture_refused: 403,
  absent: 404,
  intent_conflict: 409,
  context_changed: 409,
  stale_generation: 409,
  already_handed_off: 409,
  request_resolved: 409,
  permission_pending: 409,
  provider_not_ready: 409,
  nonce_conflict: 409,
  sequence_gap: 409,
  event_conflict: 409,
  result_conflict: 409,
  query_mismatch: 409,
  replay_refused: 409,
  expired: 410,
  oversize: 413,
  session_proof_invalid: 422,
  invalid_input: 422,
  unsupported_version: 426,
  resource_busy: 429,
  rate_limited: 429,
  source_unavailable: 503,
  authority_unavailable: 503,
  storage_unavailable: 503,
  unsupported_source: 503,
});

/** Closed public refusal code → HTTP status (I5 vocabulary). */
export function refusalHttpStatus(code: string): number {
  return FROZEN_REFUSAL_STATUS[code] ?? 400;
}

const REFUSAL_B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Shape-only check for opaque `RC0EndpointRefusalV1` bytes. The bytes cross
 * unchanged and grant nothing: this accepts structure, never authority.
 * Keys are exactly closed, the `(code, httpStatus)` pair must match the
 * frozen table, and the payload must be canonical standard base64 within
 * the 87 384-character bound.
 */
export function isEndpointRefusalShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isClosedRecord(record, ["httpStatus", "code", "responseBytesBase64"])) return false;
  if (typeof record["code"] !== "string") return false;
  if (FROZEN_REFUSAL_STATUS[record["code"]] !== record["httpStatus"]) return false;
  const encoded = record["responseBytesBase64"];
  if (typeof encoded !== "string" || encoded.length > 87384 || !REFUSAL_B64_RE.test(encoded)) {
    return false;
  }
  try {
    if (Buffer.from(encoded, "base64").toString("base64") !== encoded) return false;
  } catch {
    return false;
  }
  return true;
}
