import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isEndpointRefusalShape,
  parseActionRouteRecord,
  refusalHttpStatus,
} from "./remote-action-api.js";

const NOW_MS = 1793520000000;

const FROZEN_PAIRS: Array<[string, number]> = [
  ["invalid_request", 400],
  ["authentication_required", 401],
  ["source_auth_required", 401],
  ["origin_refused", 403],
  ["authority_refused", 403],
  ["workspace_membership_required", 403],
  ["role_refused", 403],
  ["action_scope_refused", 403],
  ["input_mode_refused", 403],
  ["control_disabled", 403],
  ["capture_refused", 403],
  ["absent", 404],
  ["intent_conflict", 409],
  ["context_changed", 409],
  ["stale_generation", 409],
  ["already_handed_off", 409],
  ["request_resolved", 409],
  ["permission_pending", 409],
  ["provider_not_ready", 409],
  ["nonce_conflict", 409],
  ["sequence_gap", 409],
  ["event_conflict", 409],
  ["result_conflict", 409],
  ["query_mismatch", 409],
  ["replay_refused", 409],
  ["expired", 410],
  ["oversize", 413],
  ["session_proof_invalid", 422],
  ["invalid_input", 422],
  ["unsupported_version", 426],
  ["resource_busy", 429],
  ["rate_limited", 429],
  ["source_unavailable", 503],
  ["authority_unavailable", 503],
  ["storage_unavailable", 503],
  ["unsupported_source", 503],
];

function validActionReady(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "remote-action-v1",
    kind: "action-ready",
    actionId: "action-1",
    envelopeDigest: "a".repeat(64),
    connectionGeneration: 4,
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 29000,
    ...overrides,
  };
}

function validResultQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "remote-action-v1",
    kind: "result-query",
    queryId: "query-1",
    actionId: "action-1",
    envelopeDigest: "a".repeat(64),
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 29000,
    ...overrides,
  };
}

describe("remote-action route and refusal gates", () => {
  it("encodes the frozen refusal code to HTTP status table", () => {
    expect(FROZEN_PAIRS).toHaveLength(36);
    for (const [code, status] of FROZEN_PAIRS) {
      expect(refusalHttpStatus(code)).toBe(status);
    }
    expect(refusalHttpStatus("no-such-code")).toBe(400);
    expect(refusalHttpStatus("relay_grant_expired")).toBe(400);
  });

  it("shape-checks opaque endpoint refusals against the contract vectors", () => {
    const vectors = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/session-content/v3/remote-action-v1/vectors/RC0EndpointRefusalV1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      positive: Array<{ id: string; value: Record<string, unknown> }>;
      negative: Array<{ id: string; value: Record<string, unknown> }>;
    };
    expect(vectors.positive.length).toBeGreaterThan(0);
    for (const entry of vectors.positive) {
      expect(isEndpointRefusalShape(entry.value)).toBe(true);
      expect(refusalHttpStatus(entry.value["code"] as string)).toBe(entry.value["httpStatus"]);
    }
    expect(vectors.negative.length).toBeGreaterThan(0);
    for (const entry of vectors.negative) {
      expect(isEndpointRefusalShape(entry.value)).toBe(false);
    }
    expect(isEndpointRefusalShape({})).toBe(false);
    expect(
      isEndpointRefusalShape({
        httpStatus: 400,
        code: "invalid_request",
        responseBytesBase64: "x".repeat(87385),
      }),
    ).toBe(false);
    expect(
      isEndpointRefusalShape({
        httpStatus: 400,
        code: "invalid_request",
        responseBytesBase64: "Zml4dHVyZQ",
      }),
    ).toBe(false);
  });

  it("validates action-ready and result-query signals on the stream route", () => {
    expect(parseActionRouteRecord("action-stream", { body: validActionReady() }).kind).toBe(
      "action-ready",
    );
    expect(parseActionRouteRecord("action-stream", { body: validResultQuery() }).kind).toBe(
      "result-query",
    );
    const refused: Array<Record<string, unknown>> = [
      validResultQuery({ expiresAt: NOW_MS + 60001 }),
      validResultQuery({ issuedAt: NOW_MS + 1000, expiresAt: NOW_MS }),
      validResultQuery({ envelopeDigest: "not-hex" }),
      validResultQuery({ queryId: "" }),
      validResultQuery({ actionId: "x".repeat(129) }),
      validActionReady({ connectionGeneration: -1 }),
      validActionReady({ issuedAt: NOW_MS + 1000, expiresAt: NOW_MS }),
      validActionReady({ actionId: "" }),
      validActionReady({ envelopeDigest: "a".repeat(63) }),
      validActionReady({ executable: "no" }),
    ];
    for (const body of refused) {
      expect(() => parseActionRouteRecord("action-stream", { body })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
    }
    expect(() =>
      parseActionRouteRecord("action-nonce", { body: validActionReady() }),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("refuses foreign RC0 typed events on the action stream gate", () => {
    const vectors = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/session-content/v3/remote-action-v1/vectors/RC0TypedEventV1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      positive: Array<{ id: string; value: Record<string, unknown> }>;
      negative: Array<{ id: string; value: Record<string, unknown> }>;
    };
    for (const entry of [...vectors.positive, ...vectors.negative]) {
      expect(() =>
        parseActionRouteRecord("action-stream", {
          body: {
            version: "remote-action-v1",
            kind: entry.value["eventKind"],
            ...(entry.value as Record<string, unknown>)["payload"] as Record<string, unknown>,
          },
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    }
  });
});
