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

import { REMOTE_ACTION_VERSION, type ActionRouteId } from "./remote-action-contract.js";
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

/**
 * Shape gate for one route record. Rejects unknown routes, non-object
 * bodies, wrong kinds, version drift, and action bodies smuggled into a
 * claim (a claim carries identities and digests, never the envelope).
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

/** Closed public refusal code → HTTP status (I5 vocabulary). */
export function refusalHttpStatus(code: string): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "authentication_required":
    case "source_auth_required":
      return 401;
    case "authority_refused":
      return 403;
    case "absent":
      return 404;
    case "already_handed_off":
    case "stale_generation":
    case "replay_refused":
      return 409;
    case "expired":
      return 410;
    case "oversize":
      return 413;
    case "session_proof_invalid":
    case "invalid_input":
      return 422;
    case "unsupported_version":
      return 426;
    case "source_unavailable":
    case "authority_unavailable":
    case "storage_unavailable":
      return 503;
    default:
      return 400;
  }
}

/**
 * Shape-only check for opaque `RC0EndpointRefusalV1` bytes. The bytes cross
 * unchanged and grant nothing: this accepts structure, never authority.
 */
export function isEndpointRefusalShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["httpStatus"] === "number" &&
    typeof record["code"] === "string" &&
    typeof record["responseBytesBase64"] === "string"
  );
}
