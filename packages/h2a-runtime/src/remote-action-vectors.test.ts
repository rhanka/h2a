import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ACTION_ROUTES,
  MAX_INPUT_BYTES,
  RC2_R3_PIN,
  assertRc0ImportedRecordResolved,
  loadRc0ImportedRecord,
} from "./remote-action-contract.js";
import { evaluateAdmissionDeadline } from "./remote-action-clock.js";
import {
  assertLiveKey,
  loadPublicFixtureTrust,
  resolveTrustEntry,
} from "./remote-action-trust.js";

const FIXTURES = new URL(
  "./fixtures/session-content/v3/remote-action-v1/",
  import.meta.url,
);

function loadBytes(relative: string): Buffer {
  return readFileSync(new URL(relative, FIXTURES));
}

function loadJson(relative: string): any {
  return JSON.parse(loadBytes(relative).toString("utf8"));
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Frozen RC0 draft.6 rev b digest, RC2-CONTRACT.md section 1. */
const FROZEN_RC0_SOURCE_DIGEST =
  "87908afecb9d389cebd324a87717313e2f86f885200322cd55d52930962aee48";

describe("remote-action r3 vector execution", () => {
  it("pins the exact RC0 source digest and every pinned vector byte", () => {
    const pin = loadJson("pin.json") as {
      rc0SourceDigest: string;
      rc0Status: string;
      vectors: Record<string, string>;
    };
    expect(pin.rc0SourceDigest).toBe(FROZEN_RC0_SOURCE_DIGEST);
    expect(pin.rc0SourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(pin.rc0Status).toMatch(/BLOCKED_EXTERNAL/);
    for (const [name, sha] of Object.entries(pin.vectors)) {
      expect(sha256Hex(loadBytes(`vectors/${name}`))).toBe(sha);
    }
    for (const [name, sha] of Object.entries(RC2_R3_PIN.vectors)) {
      expect(sha256Hex(loadBytes(`vectors/${name}`))).toBe(sha);
      expect((pin.vectors as Record<string, string>)[name]).toBe(sha);
    }
  });

  it("drives admission deadlines directly from state-transitions.json", () => {
    const vectors = loadJson("vectors/state-transitions.json") as {
      cases: Array<{
        id: string;
        evaluator: string;
        input: {
          issuedAt: number;
          expiresAt: number;
          otherDeadlines: number[];
          now: number;
          clockKnown: boolean;
          clockRollback: boolean;
          revoked: boolean;
          subscriptionGap: boolean;
        };
        expected: string;
      }>;
    };
    const deadlineCases = vectors.cases.filter(
      (entry) => entry.evaluator === "deadline",
    );
    expect(deadlineCases.length).toBeGreaterThan(0);
    for (const entry of deadlineCases) {
      expect(
        evaluateAdmissionDeadline({
          issuedAtMs: entry.input.issuedAt,
          expiresAtMs: entry.input.expiresAt,
          otherDeadlinesMs: entry.input.otherDeadlines,
          clock: {
            known: entry.input.clockKnown,
            rollback: entry.input.clockRollback,
          },
          nowMs: entry.input.now,
          revoked: entry.input.revoked,
          subscriptionGap: entry.input.subscriptionGap,
        }),
      ).toBe(entry.expected);
    }
  });

  it("keeps RC0ImportedRecord fail-closed on the source gap", () => {
    const vectors = loadJson("vectors/RC0ImportedRecord.json") as {
      positive: Array<{ id: string; expect: string; value: unknown }>;
      negative: Array<{ id: string; expect: string; value: unknown }>;
    };
    expect(vectors.positive).toHaveLength(1);
    expect(vectors.positive[0]!.expect).toBe("BLOCKED_EXTERNAL");
    const slot = loadRc0ImportedRecord(vectors.positive[0]!.value);
    expect(slot).toEqual({ status: "BLOCKED_EXTERNAL" });
    expect(() => assertRc0ImportedRecordResolved(slot)).toThrowError(
      expect.objectContaining({ code: "contract_source_gap_blocked" }),
    );
    expect(() => assertRc0ImportedRecordResolved(vectors.positive[0]!.value)).toThrowError(
      expect.objectContaining({ code: "contract_source_gap_blocked" }),
    );
    expect(vectors.negative).toHaveLength(1);
    expect(vectors.negative[0]!.expect).toBe("REJECT_SCHEMA");
    expect(() => loadRc0ImportedRecord(vectors.negative[0]!.value)).toThrowError(
      expect.objectContaining({ code: "contract_shape_rejected" }),
    );
  });

  it("loads public fixture trust as fixture-only and never live authority", () => {
    const vectors = loadJson("vectors/public-fixture-trust.json") as {
      keys: Array<{ kid: string; status: string }>;
    };
    const raw = loadJson("vectors/public-fixture-trust.json") as unknown;
    const trust = loadPublicFixtureTrust(raw, ["action-envelope"], "test-b-audience");
    expect(trust.keys).toHaveLength(vectors.keys.length);
    for (const key of trust.keys) {
      expect(key.fixtureOnly).toBe(true);
      expect(key.audience).toBe("test-b-audience");
      expect(() => assertLiveKey(key)).toThrowError(
        expect.objectContaining({ code: "fixture_only" }),
      );
    }
    const entry = resolveTrustEntry(trust, "fixture-A-route-key", "action-envelope");
    expect(entry.issuer).toBe("fixture-A-route");
    const mutated = JSON.parse(JSON.stringify(raw)) as { keys: Array<{ status: string }> };
    mutated.keys[0]!["status"] = "live";
    expect(() => loadPublicFixtureTrust(mutated, ["action-envelope"], "test-b-audience")).toThrowError(
      expect.objectContaining({ code: "contract_shape_rejected" }),
    );
  });

  it("checks route-action vectors against the frozen route registry", () => {
    const shapeDenySuffixes = [
      "-wrong-method",
      "-extra-path",
      "-caller-invented-resolved-path",
      "-extra-parameter",
      "-escaped-path",
    ];
    const placeholders = (template: string): Set<string> =>
      new Set([...template.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!));
    const fill = (template: string, params: Record<string, string>): string =>
      template.replace(/:([A-Za-z]+)/g, (match, name: string) => params[name] ?? match);
    let executed = 0;
    for (const name of [
      "route-action-nonce",
      "route-action-claim",
      "route-action-result",
      "route-action-stream",
    ] as const) {
      const vectors = loadJson(`vectors/${name}.json`) as {
        routeId: string;
        positive: Array<{ id: string; evaluator: string; input: any; expected: any }>;
        negative: Array<{ id: string; evaluator: string; input: any; expected: any }>;
      };
      expect(Object.keys(ACTION_ROUTES)).toContain(vectors.routeId);
      const route = ACTION_ROUTES[vectors.routeId as keyof typeof ACTION_ROUTES];
      const frozen: Record<string, string> = {
        "route-action-nonce":
          "POST /api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/nonces",
        "route-action-claim":
          "POST /api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/:actionId/claim",
        "route-action-result":
          "POST /api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/:actionId/results",
        "route-action-stream":
          "GET /api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/stream",
      };
      expect(`${route.method} ${route.path}`).toBe(frozen[name]);
      for (const entry of vectors.positive) {
        expect(Object.keys(ACTION_ROUTES)).toContain(entry.input.routeId);
        if (entry.evaluator === "routeGuard") {
          expect(entry.expected.decision).toBe("allow");
          expect(entry.input.method).toBe(route.method);
          expect(fill(route.path, entry.input.pathParameters)).toBe(entry.input.path);
          executed += 1;
        }
      }
      for (const entry of vectors.negative) {
        expect(Object.keys(ACTION_ROUTES)).toContain(entry.input.routeId);
        if (entry.evaluator !== "routeGuard") continue;
        expect(entry.expected.decision).toBe("deny");
        const params = entry.input.pathParameters as Record<string, string>;
        const shapeOk =
          entry.input.method === route.method &&
          fill(route.path, params) === entry.input.path &&
          Object.keys(params).every((key) => placeholders(route.path).has(key));
        const isShapeDeny = shapeDenySuffixes.some((suffix) => entry.id.endsWith(suffix));
        expect(shapeOk).toBe(!isShapeDeny);
        executed += 1;
      }
    }
    expect(executed).toBeGreaterThan(0);
  });

  it("bounds route-action HTTP framing vectors under the frozen input bound", () => {
    let executed = 0;
    for (const name of [
      "route-action-nonce",
      "route-action-claim",
      "route-action-result",
      "route-action-stream",
    ]) {
      const vectors = loadJson(`vectors/${name}.json`) as {
        positive: Array<{ id: string; evaluator: string; input: any; expected: any }>;
        negative: Array<{ id: string; evaluator: string; input: any; expected: any }>;
      };
      for (const entry of [...vectors.positive, ...vectors.negative]) {
        if (entry.evaluator !== "routeHttp") continue;
        expect(entry.input.bodyBytes).toBeLessThanOrEqual(MAX_INPUT_BYTES);
        if (entry.expected.decision === "allow") {
          expect(entry.expected.code).toBeNull();
          expect(entry.input.contentEncoding).toBeNull();
        } else {
          expect(entry.expected.code).toBe("invalid_request");
          expect(
            entry.input.contentEncoding !== null || entry.input.contentType !== "application/json",
          ).toBe(true);
        }
        executed += 1;
      }
    }
    expect(executed).toBeGreaterThan(0);
  });
});
