/**
 * Native action owner (cell N2).
 *
 * Pure predicates composing the N1 verifier/clock with the durable fence:
 * audit correlation (`invocationId=correlationId=idempotencyKey=actionId`),
 * cross-purpose refusal, native consent mapping and the frozen §9 refusal
 * table. No effect, no network, no store — every branch carries
 * `effectCalls: 0` where the reference vectors do.
 *
 * `ledger_unavailable` is a B-side `Result.reason` for a never-consumed
 * action, never an HTTP code: the A-side peer of the same journal outage is
 * `authority_unavailable` (HTTP 503). The frozen `RC0EndpointRefusalV1` table
 * therefore pins every mapped code except `ledger_unavailable` by design.
 */

import {
  consumeAction,
  type ConsumeArgs,
  type ConsumeOutcome,
  type ContentFence,
} from "./session-content-fence.js";

export type ConsentProjection =
  | "positive"
  | "revoked"
  | "refused"
  | "expired"
  | "absent"
  | "unavailable"
  | "unresolved";

export interface ConsentDecisionInput {
  side: "A" | "B";
  handedOff: boolean;
  projection: ConsentProjection;
  transportLost: boolean;
  exactProjectedRequest: boolean;
  exactProjectedGrant: boolean;
  registeredExecutor: boolean;
  principalValid: boolean;
  revisionsMatch: boolean;
  scopePresent: boolean;
}

export type ConsentDecision =
  | { decision: "allow-at-consent-model-only"; effectCalls: 0 }
  | {
      code:
        | "control_disabled"
        | "ledger_unavailable"
        | "authority_unavailable"
        | "authority_refused"
        | "action_scope_refused";
      effectCalls: 0;
    }
  | { state: "outcome_unknown"; queryOnly: true };

export function evaluateConsentDecision(input: ConsentDecisionInput): ConsentDecision {
  // Post-handoff transport loss preserves the consumed/ambiguous outcome and
  // stays query-only; it never fabricates a no-effect denial. Handoff alone,
  // with transport intact and a readable projection, keeps normal evaluation.
  if (input.handedOff && (input.projection === "unavailable" || input.transportLost)) {
    return { queryOnly: true, state: "outcome_unknown" };
  }
  if (input.projection === "unavailable") {
    return input.side === "B"
      ? { code: "ledger_unavailable", effectCalls: 0 }
      : { code: "authority_unavailable", effectCalls: 0 };
  }
  if (
    input.projection === "revoked" ||
    input.projection === "refused" ||
    input.projection === "expired" ||
    input.projection === "absent"
  ) {
    return { code: "control_disabled", effectCalls: 0 };
  }
  if (
    input.projection !== "positive" ||
    !input.exactProjectedRequest ||
    !input.exactProjectedGrant ||
    !input.registeredExecutor ||
    !input.principalValid ||
    !input.revisionsMatch
  ) {
    return { code: "authority_refused", effectCalls: 0 };
  }
  if (!input.scopePresent) return { code: "action_scope_refused", effectCalls: 0 };
  return { decision: "allow-at-consent-model-only", effectCalls: 0 };
}

export interface ActionCorrelationInput {
  operation: string;
  evidencePurpose: string;
  actionId: string;
  invocationId: string;
  correlationId: string;
  idempotencyKey: string;
  sessionTraceId: string;
  beforeEnvelopeDigest: string;
  afterEnvelopeDigest: string;
  beforePayloadDigest: string;
  afterPayloadDigest: string;
}

export type CorrelationDecision =
  | { decision: "correlation-preserved-model"; effectCalls: 0 }
  | { code: "authority_refused"; effectCalls: 0 };

export function checkActionCorrelation(input: ActionCorrelationInput): CorrelationDecision {
  if (
    (input.operation !== "input" && input.operation !== "permission-response") ||
    input.evidencePurpose !== "action"
  ) {
    return { code: "authority_refused", effectCalls: 0 };
  }
  if (!input.actionId || input.actionId === input.sessionTraceId) {
    return { code: "authority_refused", effectCalls: 0 };
  }
  if (
    input.invocationId !== input.actionId ||
    input.correlationId !== input.actionId ||
    input.idempotencyKey !== input.actionId
  ) {
    return { code: "authority_refused", effectCalls: 0 };
  }
  if (
    input.afterEnvelopeDigest !== input.beforeEnvelopeDigest ||
    input.afterPayloadDigest !== input.beforePayloadDigest
  ) {
    return { code: "authority_refused", effectCalls: 0 };
  }
  return { decision: "correlation-preserved-model", effectCalls: 0 };
}

export type NativeRefusalCause =
  | "journal-unavailable"
  | "unresolved-projection"
  | "missing-scope"
  | "revoked-pair";

/** Frozen §9 mapping from a native fence condition to the refusal code. */
export function mapNativeRefusal(cause: NativeRefusalCause, side: "A" | "B"): string {
  switch (cause) {
    case "journal-unavailable":
      return side === "B" ? "ledger_unavailable" : "authority_unavailable";
    case "unresolved-projection":
      return "authority_refused";
    case "missing-scope":
      return "action_scope_refused";
    case "revoked-pair":
      return "control_disabled";
  }
}

/**
 * Fence consume gated on audit correlation. A correlation failure refuses
 * before any journal write, so the fence keeps no trace of the attempt.
 */
export function consumeCheckedAction(
  fence: ContentFence,
  correlation: ActionCorrelationInput,
  args: ConsumeArgs,
): Promise<ConsumeOutcome> {
  const verdict = checkActionCorrelation(correlation);
  if ("code" in verdict) return Promise.resolve({ code: verdict.code, ok: false } as const);
  return consumeAction(fence, args);
}
