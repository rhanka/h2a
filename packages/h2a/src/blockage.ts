/**
 * DEC-092 — EVO-3 agent-blockage feedback loop. A **blockage** is the third
 * coordination signal: the drumbeat stall is silent (→ relance, DEC-084),
 * escalation targets the competent authority (DEC-040), and a blockage is
 * broadcast to **peer agents** as an FYI / help request. `workStatus: "blocked"`
 * is already a non-stall the drumbeat skips (DEC-085); this turns it into an
 * actionable, peer-visible signal.
 *
 * Pure core: the type, an `isActiveBlockage` predicate, and a builder for a
 * signed-able envelope (parity with the NHI attestation, DEC-088) so a blockage
 * can be signed/journalled. The durable registry, notification and per-host
 * delivery live in `@sentropic/h2a-cli`.
 */

import { computeHash } from "./canonical.js";
import { createEnvelope } from "./envelope.js";
import type { H2AEnvelope, H2ARole } from "./types.js";

export interface H2ABlockage {
  readonly instance: string;
  readonly scope: string;
  /** What the agent is blocked on. */
  readonly reason: string;
  /** What would unblock it (optional, helps a peer act). */
  readonly needs?: string;
  readonly raisedAt: string;
  /** Set when the blockage is cleared. */
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
}

/** A blockage is active until it is resolved. */
export function isActiveBlockage(blockage: H2ABlockage): boolean {
  return blockage.resolvedAt === undefined;
}

export const H2A_BLOCKAGE_BODY_KIND = "blockage";
export const H2A_BLOCKAGE_CLEARED_BODY_KIND = "blockage-cleared";

export interface H2ABlockageBody {
  readonly kind: typeof H2A_BLOCKAGE_BODY_KIND | typeof H2A_BLOCKAGE_CLEARED_BODY_KIND;
  readonly blockage: H2ABlockage;
}

/**
 * Build the canonical *unsigned* envelope carrying a blockage (or its clear).
 * No new artifact kind — a plain `event` envelope, so a recipient verifies it
 * with the standard `verifyEnvelopeSignature`. The caller signs it.
 */
export function blockageEnvelope(input: {
  readonly blockage: H2ABlockage;
  readonly actor: { readonly instance: string; readonly role: H2ARole; readonly scope: string };
  readonly cleared?: boolean;
  readonly createdAt?: string;
}): H2AEnvelope<H2ABlockageBody> {
  const body: H2ABlockageBody = {
    kind: input.cleared ? H2A_BLOCKAGE_CLEARED_BODY_KIND : H2A_BLOCKAGE_BODY_KIND,
    blockage: input.blockage
  };
  const createdAt =
    input.createdAt ?? input.blockage.resolvedAt ?? input.blockage.raisedAt;
  const id = `blockage-${computeHash({ by: input.actor.instance, body, createdAt }).slice(0, 16)}`;
  return createEnvelope<H2ABlockageBody>({
    id,
    type: "event",
    actor: {
      instance: input.actor.instance,
      role: input.actor.role,
      scope: input.actor.scope
    },
    body,
    createdAt
  });
}
