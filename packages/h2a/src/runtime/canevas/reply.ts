// Canevas ③ tranche-3b — PURE reply-envelope construction. The IO (put + journal
// + live-instance resolution) lives in answer.ts. RISK #1 (consensus): this speaks
// for the human — `answeredBy:"local-human"` is a transparent marker, NEVER a
// forged signed h2a attestation. The target is resolved LIVE by the shell to avoid
// misrouting (multi-session addressing bug).

import { createEnvelope } from "../../envelope.js";
import type { H2AEnvelope } from "../../types.js";

/** Synthetic actor for canevas-relayed human answers (not a real h2a instance). */
export const CANEVAS_SELF_INSTANCE = "canevas:local-human";

export interface DecisionReplyInput {
  readonly decisionId: string;
  readonly answerId: string;
  readonly note?: string;
  /** The escalating agent — LIVE-resolved by the shell before calling this. */
  readonly targetInstance: string;
  readonly envelopeId: string;
  readonly createdAt: string;
  readonly scope?: string;
}

/**
 * PURE: build the reply envelope for a human decision answer. Type `event`, body
 * a `decision-reply` message carrying `replyTo`, `answerId` and the transparent
 * `answeredBy:"local-human"` marker.
 */
export function buildDecisionReplyEnvelope(input: DecisionReplyInput): H2AEnvelope {
  return createEnvelope({
    id: input.envelopeId,
    type: "event",
    actor: { instance: CANEVAS_SELF_INSTANCE, role: "PRINCIPAL", scope: input.scope ?? "scope:default" },
    target: { instance: input.targetInstance },
    body: {
      kind: "message",
      topic: "decision-reply",
      replyTo: input.decisionId,
      answerId: input.answerId,
      answeredBy: "local-human",
      ...(input.note !== undefined ? { note: input.note } : {})
    },
    createdAt: input.createdAt
  });
}

export interface ReplyRecord {
  readonly decisionId: string;
  readonly answerId: string;
  readonly envelopeId: string;
  readonly targetInstance: string;
  readonly createdAt: string;
}
