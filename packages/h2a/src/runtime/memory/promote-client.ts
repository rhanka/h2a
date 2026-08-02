/**
 * Promote client — D11 double-consensus, CLIENT-SIDE orchestration (build brief
 * slice 6, this build's WP11-slice-3). Two independent high-grade legs each
 * write a VERDICT (third-party-readable, never self-report); this module
 * enforces the double-consensus BEFORE `promoteNote` is ever called, and
 * dispatches through an INJECTED `MemoryProducerPort` exactly like
 * `admit-client.ts` does for admission.
 *
 * SCOPE (bounded): this is the client's consensus *enforcement* + evidence
 * *assembly*. Launching the two model legs and interpreting/reading verdict
 * FILES is out of scope here — a "leg" is an opaque `{model, session}` pair
 * and a verdict ref is an opaque locator string, both supplied by the caller
 * (the conductor orchestrating the legs). graphify's gate is the other half
 * of this boundary: it re-checks structurally (refs + attestation shape), it
 * never trusts this client's say-so either — this module's own refusal is a
 * courtesy that saves a round trip, not the authority.
 *
 * I5 — fail-closed, TWO LAYERS:
 *   1. `checkDoubleConsensusPreconditions` is a PURE, port-less function. It
 *      cannot call the port even if it wanted to — a refusal here makes
 *      "promoteNote never called" true BY CONSTRUCTION, not by a runtime
 *      guard that could be bypassed or forgotten.
 *   2. `promoteNote` (the raw dispatch) mirrors `admit-client.ts`: an absent
 *      port, or one that throws/rejects, REFUSES — never a silent
 *      `promoted: true` a caller might mistake for success.
 * `promoteNoteWithDoubleConsensus` composes both layers for a caller that
 * wants one call: check → assemble → dispatch, short-circuiting before the
 * port is ever touched on any local refusal.
 *
 * STRUCTURAL independence, not merely attested: the guard computes leg
 * distinctness and the author/session collision from the VERDICTS'
 * own `leg` field, never from `attestation.distinctModels` /
 * `attestation.distinctSessions` — those booleans are a self-report from the
 * orchestrator and travel through to graphify as part of the evidence
 * (`assemblePromotionEvidence` serializes the whole attestation), but this
 * client does not treat them as authoritative for its own local refusal. A
 * lying attestation cannot paper over two identical verdict legs.
 *
 * I1 — durable identity slot: `leg.model`, `leg.session`, `authorId` and
 * `noteId` are all OPAQUE strings here — compared with `===` only, never
 * parsed, split or derived-from. This module reserves the slot; it does not
 * mint or interpret conversation-scoped identity.
 * I4 — no new capabilities vocabulary opens here; `MemoryVerdict` and
 * `IndependenceAttestation` are D11-specific data shapes, not a second
 * capabilities taxonomy, and `PromotionEvidence`/`PromotionOutcome` are
 * reused unchanged from `./port-v1.ts`.
 */

import type { MemoryContext, MemoryProducerPort, PromotionEvidence, PromotionOutcome } from "./port-v1.js";

// ---------------------------------------------------------------------------
// Types (build brief, this slice).
// ---------------------------------------------------------------------------

/** An opaque leg identity — never parsed, only compared for equality. */
export interface LegIdentity {
  readonly model: string;
  readonly session: string;
}

/**
 * A single leg's verdict on a note. Written by the leg itself, to a
 * third-party-readable file; the FILE (referenced elsewhere by an opaque
 * `*Ref` string) is the record, not this in-memory shape — this type is how
 * the client reasons about a verdict once the caller has already resolved
 * one, not a re-implementation of reading the file.
 */
export interface MemoryVerdict {
  readonly noteId: string;
  readonly verdict: "GO" | "NO-GO";
  readonly leg: LegIdentity;
  readonly at: number;
  readonly reason?: string;
}

/**
 * The orchestrator's attestation that the two legs were actually independent.
 * Serialized whole into `PromotionEvidence.independence_attestation` so
 * graphify's gate can inspect it too — but see the module doc: this client
 * does NOT treat `distinctModels`/`distinctSessions` here as authoritative
 * for its own refusal; it recomputes distinctness from the verdicts.
 */
export interface IndependenceAttestation {
  readonly leg1: LegIdentity;
  readonly leg2: LegIdentity;
  readonly distinctModels: boolean;
  readonly distinctSessions: boolean;
  readonly verdictsWrittenBeforeCrossVisibility: boolean;
  readonly orchestrator: string;
}

// ---------------------------------------------------------------------------
// assemblePromotionEvidence — pure, packs refs + attestation into the port's shape.
// ---------------------------------------------------------------------------

/**
 * Pack the two verdict-file references and a serialized attestation into the
 * port's `PromotionEvidence` shape. Pure: same inputs → same output, no I/O.
 * The attestation is serialized with `JSON.stringify` so it survives the
 * port boundary intact and is recoverable verbatim on the far side (graphify
 * re-inspects it structurally — this is not a summary, it's the record).
 */
export function assemblePromotionEvidence(
  leg1Ref: string,
  leg2Ref: string,
  attestation: IndependenceAttestation
): PromotionEvidence {
  return {
    leg1_verdict_ref: leg1Ref,
    leg2_verdict_ref: leg2Ref,
    independence_attestation: JSON.stringify(attestation)
  };
}

// ---------------------------------------------------------------------------
// checkDoubleConsensusPreconditions — the client-side refusal gate (pure, port-less).
// ---------------------------------------------------------------------------

export type DoubleConsensusCheck = { ok: true } | { ok: false; reason: string };

export interface DoubleConsensusInput {
  readonly verdicts: readonly MemoryVerdict[];
  readonly attestation: IndependenceAttestation;
  readonly leg1Ref: string;
  readonly leg2Ref: string;
  /** The note's author (opaque id) — a leg's `session` must not equal this. */
  readonly authorId: string;
}

function refuseCheck(reason: string): DoubleConsensusCheck {
  return { ok: false, reason };
}

function sameLeg(a: LegIdentity, b: LegIdentity): boolean {
  return a.model === b.model && a.session === b.session;
}

/**
 * REFUSES to let a caller proceed to `promoteNote` unless ALL hold:
 *   - exactly 2 verdicts;
 *   - BOTH verdicts are `"GO"` (any `"NO-GO"`, or a split, refuses);
 *   - the two verdicts reference the SAME note (a mismatch refuses — two
 *     verdicts for different notes cannot jointly promote either one);
 *   - the two legs are STRUCTURALLY distinct — computed from `verdict.leg`
 *     itself, not from the attestation's own booleans (not the same
 *     model+session counted twice);
 *   - `leg1Ref !== leg2Ref` (the same verdict-file reference cannot stand in
 *     for both legs);
 *   - neither leg's `session` equals `authorId` (separation of powers — a
 *     leg cannot review its own note).
 * This function takes no port: it cannot call `promoteNote` even if it
 * wanted to, so its refusal holds by construction, not by convention.
 */
export function checkDoubleConsensusPreconditions(input: DoubleConsensusInput): DoubleConsensusCheck {
  const { verdicts, attestation, leg1Ref, leg2Ref, authorId } = input;

  if (!attestation) {
    return refuseCheck("an independence attestation is required");
  }
  if (!Array.isArray(verdicts) || verdicts.length !== 2) {
    const got = Array.isArray(verdicts) ? String(verdicts.length) : "a non-array";
    return refuseCheck(`double consensus requires exactly 2 verdicts, got ${got}`);
  }

  const [v1, v2] = verdicts;

  if (v1.verdict !== "GO" || v2.verdict !== "GO") {
    return refuseCheck(
      "double consensus requires BOTH legs to verdict GO — a NO-GO or a split refuses locally"
    );
  }

  if (v1.noteId !== v2.noteId) {
    return refuseCheck("the two verdicts reference different notes — refusing to conflate them");
  }

  if (sameLeg(v1.leg, v2.leg)) {
    return refuseCheck(
      "the two legs are not independent — the same model+session was counted twice (same leg twice)"
    );
  }

  if (leg1Ref === leg2Ref) {
    return refuseCheck("leg1Ref and leg2Ref are identical — refusing to accept one verdict reference twice");
  }

  if (v1.leg.session === authorId || v2.leg.session === authorId) {
    return refuseCheck(
      "a promoting leg's session equals the note's author — separation of powers requires an independent reviewer"
    );
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// promoteNote — raw dispatch through the injected port. I5 fail-closed.
// ---------------------------------------------------------------------------

export interface PromoteNoteResult {
  readonly outcome: PromotionOutcome;
  /** True when refused locally (no port, unreachable port, or a precondition) — the port was never called, or its call never resolved to a success. */
  readonly localOnly: boolean;
}

function refuseResult(reason: string): PromoteNoteResult {
  return { outcome: { promoted: false, reason }, localOnly: true };
}

/**
 * Dispatch `evidence` through `port.promoteNote(noteId, evidence, ctx)`.
 * `port` is injected and may be `undefined`/`null` (I5: fail-closed default,
 * not a wiring error — mirrors `admit-client.ts`). This function does NOT
 * itself enforce the double-consensus preconditions — that is
 * `checkDoubleConsensusPreconditions`'s job, run BEFORE this is called (see
 * `promoteNoteWithDoubleConsensus` for the composed entry point).
 */
export async function promoteNote(
  noteId: string,
  evidence: PromotionEvidence,
  ctx: MemoryContext,
  port: MemoryProducerPort | undefined | null
): Promise<PromoteNoteResult> {
  if (!port) {
    return refuseResult("no memory producer port injected — refusing (fail-closed, I5)");
  }

  try {
    const outcome = await port.promoteNote(noteId, evidence, ctx);
    return { outcome, localOnly: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return refuseResult(`memory producer port unreachable: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// promoteNoteWithDoubleConsensus — the composed orchestration entry point.
// ---------------------------------------------------------------------------

export interface PromoteNoteWithDoubleConsensusInput extends DoubleConsensusInput {
  readonly noteId: string;
  readonly ctx: MemoryContext;
}

/**
 * The client-side D11 promotion entry point: runs
 * `checkDoubleConsensusPreconditions` first, and ONLY on `{ok: true}`
 * assembles the evidence (`assemblePromotionEvidence`) and dispatches
 * (`promoteNote`). A local refusal short-circuits BEFORE the port is ever
 * touched — the composed call, not just the pure guard in isolation, is what
 * a conductor actually invokes once both legs have written their verdicts.
 */
export async function promoteNoteWithDoubleConsensus(
  input: PromoteNoteWithDoubleConsensusInput,
  port: MemoryProducerPort | undefined | null
): Promise<PromoteNoteResult> {
  const check = checkDoubleConsensusPreconditions(input);
  if (!check.ok) {
    return refuseResult(`double-consensus preconditions not met: ${check.reason}`);
  }

  const evidence = assemblePromotionEvidence(input.leg1Ref, input.leg2Ref, input.attestation);
  return promoteNote(input.noteId, evidence, input.ctx, port);
}
