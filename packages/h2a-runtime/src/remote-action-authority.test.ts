/**
 * Native action authority tests (cell N2, lot 1 — red).
 *
 * The owner composes the N1 verifier/clock with the durable fence: audit
 * correlation (`invocationId=correlationId=idempotencyKey=actionId`),
 * cross-purpose refusal, conservative cutoff boundaries and the frozen §9
 * refusal mapping. Composition refuses before any journal write.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FROZEN_REFUSAL_STATUS } from "./remote-action-api.js";
import { evaluateAdmissionDeadline } from "./remote-action-clock.js";
import {
  checkActionCorrelation,
  consumeCheckedAction,
  evaluateConsentDecision,
  mapNativeRefusal,
  type ActionCorrelationInput,
  type ConsentDecisionInput,
} from "./remote-action-owner.js";
import { openContentFence } from "./session-content-fence.js";

const FIXTURES = new URL(
  "./fixtures/session-content/v3/remote-action-v1/",
  import.meta.url,
);

async function loadVectorJson(relative: string): Promise<any> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(new URL(relative, FIXTURES), "utf8"));
}

const ACTION_ID = "vZOMaI9Jt3x_xTfGuSIuLA";

function correlated(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionId: ACTION_ID,
    afterEnvelopeDigest: "1".repeat(64),
    afterPayloadDigest: "2".repeat(64),
    beforeEnvelopeDigest: "1".repeat(64),
    beforePayloadDigest: "2".repeat(64),
    correlationId: ACTION_ID,
    evidencePurpose: "action",
    idempotencyKey: ACTION_ID,
    invocationId: ACTION_ID,
    operation: "input",
    sessionTraceId: "eafe895eb8119e6e5d06463590b2ef81",
    ...overrides,
  };
}

describe("remote-action owner authority", () => {
  it("preserves the audit correlation on identical bindings", () => {
    expect(checkActionCorrelation(correlated())).toEqual({
      decision: "correlation-preserved-model",
      effectCalls: 0,
    });
  });

  it.each(["invocationId", "correlationId", "idempotencyKey"])(
    "refuses a changed %s",
    (field) => {
      expect(checkActionCorrelation(correlated({ [field]: "changed" }))).toEqual({
        code: "authority_refused",
        effectCalls: 0,
      });
    },
  );

  it("refuses mutated envelope and payload digests", () => {
    expect(
      checkActionCorrelation(correlated({ afterEnvelopeDigest: "changed" })),
    ).toEqual({ code: "authority_refused", effectCalls: 0 });
    expect(
      checkActionCorrelation(correlated({ afterPayloadDigest: "changed" })),
    ).toEqual({ code: "authority_refused", effectCalls: 0 });
  });

  it("refuses cross-purpose policy evidence as action authority", () => {
    expect(
      checkActionCorrelation(correlated({ evidencePurpose: "policy", operation: "share" })),
    ).toEqual({ code: "authority_refused", effectCalls: 0 });
    expect(
      checkActionCorrelation(correlated({ evidencePurpose: "policy", operation: "amend" })),
    ).toEqual({ code: "authority_refused", effectCalls: 0 });
  });

  it("holds the minimum-minus-5000ms cutoff on the composed deadline", () => {
    const base = {
      clock: { known: true, rollback: false },
      expiresAtMs: 1793520030000,
      issuedAtMs: 1793520000000,
      otherDeadlinesMs: [1793520060000],
      revoked: false,
    };
    expect(evaluateAdmissionDeadline({ ...base, nowMs: 1793520024999 })).toBe("allow");
    expect(evaluateAdmissionDeadline({ ...base, nowMs: 1793520025000 })).toBe(
      "relay_grant_expired",
    );
  });

  it("refuses unknown or rolled-back clocks and live revocations", () => {
    const base = {
      expiresAtMs: 1793520030000,
      issuedAtMs: 1793520000000,
      nowMs: 1793520001000,
      otherDeadlinesMs: [] as number[],
      revoked: false,
    };
    expect(
      evaluateAdmissionDeadline({ ...base, clock: { known: false, rollback: false } }),
    ).toBe("relay_grant_unavailable");
    expect(
      evaluateAdmissionDeadline({ ...base, clock: { known: true, rollback: true } }),
    ).toBe("relay_grant_unavailable");
    expect(
      evaluateAdmissionDeadline({
        ...base,
        clock: { known: true, rollback: false },
        revoked: true,
      }),
    ).toBe("relay_grant_revoked");
  });

  it("maps native fence conditions onto the frozen refusal codes", () => {
    expect(mapNativeRefusal("journal-unavailable", "B")).toBe("ledger_unavailable");
    expect(mapNativeRefusal("journal-unavailable", "A")).toBe("authority_unavailable");
    expect(mapNativeRefusal("unresolved-projection", "B")).toBe("authority_refused");
    expect(mapNativeRefusal("missing-scope", "B")).toBe("action_scope_refused");
    expect(mapNativeRefusal("revoked-pair", "B")).toBe("control_disabled");
    for (const code of [
      "authority_unavailable",
      "authority_refused",
      "action_scope_refused",
      "control_disabled",
    ]) {
      expect(FROZEN_REFUSAL_STATUS[code]).toBeDefined();
    }
    expect(FROZEN_REFUSAL_STATUS["ledger_unavailable"]).toBeUndefined();
  });

  it("refuses a native consent decision with a missing remote scope", () => {
    expect(
      evaluateConsentDecision({
        exactProjectedGrant: true,
        exactProjectedRequest: true,
        handedOff: false,
        principalValid: true,
        projection: "positive",
        registeredExecutor: true,
        revisionsMatch: true,
        scopePresent: false,
        side: "B",
        transportLost: false,
      }),
    ).toEqual({ code: "action_scope_refused", effectCalls: 0 });
  });

  it("keeps post-handoff transport loss query-only without fabricating denial", () => {
    expect(
      evaluateConsentDecision({
        exactProjectedGrant: true,
        exactProjectedRequest: true,
        handedOff: true,
        principalValid: true,
        projection: "positive",
        registeredExecutor: true,
        revisionsMatch: true,
        scopePresent: true,
        side: "B",
        transportLost: true,
      }),
    ).toEqual({ state: "outcome_unknown", queryOnly: true });
  });

  it("refuses a correlation failure before any journal write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "authority-composition-"));
    try {
      const fence = await openContentFence(dir);
      const outcome = await consumeCheckedAction(
        fence,
        correlated({ correlationId: "changed" }),
        { digest: "a".repeat(64), key: ACTION_ID },
      );
      expect(outcome).toEqual({ ok: false, code: "authority_refused" });
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(dir, "fence-journal.jsonl"))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("r3 refusal-mapping vectors (state-transitions.json)", () => {
  it("executes every consentMapping case with zero effects", async () => {
    const vectors = await loadVectorJson("vectors/state-transitions.json");
    const cases = vectors.cases.filter(
      (entry: { evaluator: string }) => entry.evaluator === "consentMapping",
    );
    expect(cases.length).toBe(14);
    for (const entry of cases) {
      expect(
        evaluateConsentDecision(entry.input as ConsentDecisionInput),
        entry.id,
      ).toEqual(entry.expected);
      if ("effectCalls" in (entry.expected as Record<string, unknown>)) {
        expect(entry.expected.effectCalls, entry.id).toBe(0);
      }
    }
  });

  it("executes every actionCorrelation case with zero effects", async () => {
    const vectors = await loadVectorJson("vectors/state-transitions.json");
    const cases = vectors.cases.filter(
      (entry: { evaluator: string }) => entry.evaluator === "actionCorrelation",
    );
    expect(cases.length).toBe(8);
    for (const entry of cases) {
      expect(
        checkActionCorrelation(entry.input as ActionCorrelationInput),
        entry.id,
      ).toEqual(entry.expected);
      expect(entry.expected.effectCalls, entry.id).toBe(0);
    }
  });
});
