/**
 * V1→V2 adapter (path V) — pure request BUILDERS + outcome MAPPERS between the
 * h2a memory clients' internal V1 shapes and graphify's `MemoryPortV2`
 * (vendored, types-only, in `./graphify-contracts-v2.vendored.ts`). See
 * docs/specs/2026-09-05-SPEC_v1v2-adapter... for the full mapping + the 6 gaps.
 *
 * SCOPE of THIS module (additive, correctness-critical): the pure functions that
 * turn an h2a input (a `MemoryNoteInput`, a `PromotionEvidence`, a
 * `TombstoneTarget`, a `MemoryRecallQuery`) into the corresponding V2 request,
 * and the V2 responses back into the h2a outcome shapes. It imports ZERO
 * graphify runtime — only the vendored V2 TYPES — so the anti-cycle holds.
 *
 * The 6 GAPS (G1..G6 in the spec) are NOT resolved here: they are INJECTED as a
 * `V2GapResolvers` bundle — exactly like the port itself was injected. Their
 * real implementations (tenancy → opaque scope/purpose refs, a per-call
 * principal credential, the closed component/type vocabularies, the D11-evidence
 * → authorization binding, valid_time) are go-live wiring (graphify/h-arch);
 * here they are one interface a caller supplies, and a test stubs.
 *
 * The client CUTOVER (wiring admit/recall/promote/tombstone-client + the
 * fixtures onto these builders + the V2 port) is deliberately NOT in this file —
 * it is the mechanical, high-volume step deferred to codex (the fixture rewrite
 * touches ~1385 lines). This module is the de-risked, tested foundation that
 * cutover builds on: if the field mapping is wrong, THESE tests go red first.
 */

import type {
  MemoryContext,
  MemoryNoteInput,
  MemoryRecallQuery,
  PromotionEvidence,
  TombstoneTarget,
  TombstoneAuthorization,
  AdmissionOutcome,
  PromotionOutcome,
  TombstoneOutcome
} from "./port-v1.js";
import type {
  AdmissionOutcomeV1,
  AdmissionRequestV1,
  AuthorizationContextV1,
  CandidatePayloadV2,
  CaptureAcknowledgementV1,
  CaptureRequestV2,
  CitationV1,
  Cursor,
  EvidenceBundleV1,
  IdempotencyKey,
  Instant,
  LifecycleCommandV1,
  LifecycleEventAnchorV1,
  LifecycleReceiptV1,
  MemoryComponentV2,
  OpaqueRef,
  RecallCapabilityPolicyV1,
  RecallRequestV2,
  ReconciliationConsentV1,
  RetentionV1,
  ValidIntervalV1
} from "./graphify-contracts-v2.vendored.js";

/**
 * The injected resolvers for the 6 gaps. Every field the V2 contract requires
 * that the h2a V1 note does NOT already carry in the right shape is produced
 * here — never fabricated inline in a builder. A test supplies canned values;
 * the real wiring (tenancy/identity/policy) lands at go-live.
 */
export interface V2GapResolvers {
  /** G1: {principal_owner, scope} → an opaque scope reference (tenancy). */
  scopeRef(input: { readonly principal_owner: string; readonly scope: string }): OpaqueRef;
  /** G1: purpose → an opaque purpose reference; required for EVERY capture (default for non-human). */
  purposeRef(input: { readonly subject: string; readonly purpose?: string }): OpaqueRef;
  /** G3: an event-kind label → an opaque type reference. */
  typeRef(kind: string): OpaqueRef;
  /** G3: the note's content → V2 components + which one is primary. */
  components(note: MemoryNoteInput): { readonly components: ReadonlyArray<MemoryComponentV2>; readonly primary_component_id: string };
  /** G3: the note's provenance → V2 citations (the primary event's citation is one of these). */
  citations(note: MemoryNoteInput): { readonly citations: ReadonlyArray<CitationV1>; readonly primary_citation_id: string };
  /** G6: the note's temporal anchor → a bi-temporal valid interval. */
  validTime(note: MemoryNoteInput): ValidIntervalV1;
  /** retention/TTL → V2 retention (default "retain" for non-human). */
  retention(note: MemoryNoteInput): RetentionV1;
  /** reconciliation consent (co-spec C1). */
  reconciliation(note: MemoryNoteInput): ReconciliationConsentV1;
  /** the evidence a note carries; the verifier derives the trust class from it (earned-not-asserted). */
  evidenceBundle(note: MemoryNoteInput): EvidenceBundleV1;
  /** G2: ctx → a per-call authorization credential (dynamic principal, never static). */
  authorization(ctx: MemoryContext): AuthorizationContextV1;
  /**
   * G4: the D11 evidence + ctx → the admission authorization. The two verdict
   * refs + attestation ref are recorded h2a-side and carried by
   * `AuthorizationContextV1.context_ref` (an opaque ref to the ceremony
   * receipt) — graphify applies on a valid authorization; h2a holds the
   * auditable D11 artifact. See spec G4/G5 (single admission authority).
   */
  admissionAuthorization(input: { readonly ctx: MemoryContext; readonly evidence: PromotionEvidence }): AuthorizationContextV1;
  /** a fresh idempotency key for a capture. */
  idempotencyKey(): IdempotencyKey;
  /** a deadline for a request. */
  deadlineAt(): Instant;
  /** capture source-order: which source, what sequence. */
  sourceOrder(note: MemoryNoteInput): { readonly source_ref: OpaqueRef; readonly sequence: Cursor };
  /** a cancellation ref for a capture. */
  cancellationRef(): OpaqueRef;
  /** RecallRequestV2 budgets + capability policy (new surface, no V1 analogue). */
  recallBudgets(): RecallRequestV2["budgets"];
  recallCapabilityPolicy(): RecallCapabilityPolicyV1;
  recallPurposeRef(query: MemoryRecallQuery, ctx: MemoryContext): OpaqueRef;
  /** a lifecycle command's fresh event id. */
  lifecycleEventId(): IdempotencyKey;
  /** a lifecycle command's reason ref. */
  reasonRef(input: { readonly ctx: MemoryContext; readonly auth: TombstoneAuthorization }): OpaqueRef;
  /** a lifecycle command's event anchor. */
  lifecycleEventAnchor(): LifecycleEventAnchorV1;
}

// ---------------------------------------------------------------------------
// WRITE-side builders: h2a input → V2 request. Pure; every gap comes from `r`.
// ---------------------------------------------------------------------------

/** `admitMemoryNote(note)` → `capture(CaptureRequestV2)`. `committed_pending` = the V1 `pending`. */
export function buildCaptureRequest(note: MemoryNoteInput, ctx: MemoryContext, r: V2GapResolvers): CaptureRequestV2 {
  const { components, primary_component_id } = r.components(note);
  const { citations, primary_citation_id } = r.citations(note);
  const payload: CandidatePayloadV2 = {
    schema_version: 2,
    scope_ref: r.scopeRef({ principal_owner: note.principal_owner, scope: note.scope }),
    purpose_ref: r.purposeRef({ subject: note.subject, purpose: note.purpose }),
    valid_time: r.validTime(note),
    components,
    primary_component_id,
    primary_event: { at: note.event.at, type_ref: r.typeRef(note.event.kind), citation_id: primary_citation_id },
    citations,
    retention: r.retention(note),
    reconciliation: r.reconciliation(note)
  };
  return {
    schema_version: 2,
    idempotency_key: r.idempotencyKey(),
    payload,
    evidence: r.evidenceBundle(note),
    authorization: r.authorization(ctx),
    source_order: r.sourceOrder(note),
    deadline_at: r.deadlineAt(),
    cancellation_ref: r.cancellationRef()
  };
}

/** `promoteNote(noteId, evidence)` → `requestAdmission(AdmissionRequestV1)` — the D11 verdict APPLIES here. */
export function buildAdmissionRequest(
  noteId: string,
  evidence: PromotionEvidence,
  ctx: MemoryContext,
  r: V2GapResolvers
): AdmissionRequestV1 {
  return {
    candidate_id: noteId,
    authorization: r.admissionAuthorization({ ctx, evidence }),
    deadline_at: r.deadlineAt()
  };
}

/** `requestTombstone(target)` → `transition({operation:"tombstone", record_id})`. Node targets only; an edge target refuses fail-closed (NB-01). */
export function buildTombstoneCommand(
  target: TombstoneTarget,
  auth: TombstoneAuthorization,
  ctx: MemoryContext,
  r: V2GapResolvers
): LifecycleCommandV1 {
  // NB-01: only a node target carries a single record_id, which is what the V2
  // lifecycle surface transitions. An edge target's own record/projection id must
  // be resolved from the edge triple (the edge-tombstone sub-gap, a go-live
  // concern). Mapping an edge to `target.source` — as an earlier revision did —
  // would transition the WHOLE source node (and every other edge on it), not the
  // single edge A→B: a destructive mis-target. Refuse fail-closed here rather than
  // invent a record_id; the compat port turns this throw into an {applied:false}
  // outcome, so no edge tombstone can silently destroy a shared node.
  if (target.kind !== "node") {
    throw new Error(
      "edge tombstone is not supported by the V1→V2 adapter yet — needs edge→record_id resolution (NB-01); refusing rather than tombstoning the source node"
    );
  }
  return {
    event_id: r.lifecycleEventId(),
    reason_ref: r.reasonRef({ ctx, auth }),
    event_anchor: r.lifecycleEventAnchor(),
    authorization: r.authorization(ctx),
    deadline_at: r.deadlineAt(),
    operation: "tombstone",
    record_id: target.id
  };
}

/** `recallMemory(query)` → `recall(RecallRequestV2)`. `asOf`/`window` → `as_of`; budgets/policy are new. */
export function buildRecallRequest(query: MemoryRecallQuery, ctx: MemoryContext, r: V2GapResolvers): RecallRequestV2 {
  const as_of =
    typeof query.asOf === "number"
      ? { valid_time: query.asOf }
      : query.window && query.window.untilMs !== null
        ? { valid_time: query.window.untilMs }
        : undefined;
  return {
    // The V1 query carried no free-text; the wake-recall query string is the
    // caller's — the cutover threads it. Empty string is a valid "recall all
    // live for this principal/purpose" under the budgets below.
    query: "",
    purpose_ref: r.recallPurposeRef(query, ctx),
    ...(as_of ? { as_of } : {}),
    authorization: r.authorization(ctx),
    capability_policy: r.recallCapabilityPolicy(),
    budgets: r.recallBudgets()
  };
}

// ---------------------------------------------------------------------------
// READ-side / outcome MAPPERS: V2 response → h2a outcome. Fail-closed on refusal.
// ---------------------------------------------------------------------------

/** `CaptureAcknowledgementV1` → `AdmissionOutcome`. `committed_pending`/`duplicate_exact` = admitted; else refused. */
export function mapCaptureAcknowledgement(ack: CaptureAcknowledgementV1): AdmissionOutcome {
  // A fresh commit must return its candidate_id.
  if (ack.status === "committed_pending" && typeof ack.candidate_id === "string") {
    return { admitted: true, id: ack.candidate_id };
  }
  // NB-02: `duplicate_exact` is an idempotent success — the store already holds
  // this exact payload. `candidate_id` is OPTIONAL on CaptureAcknowledgementV1, so
  // fall back to the `record_digest` as the stable id when it is omitted: refusing
  // a recognized duplicate merely because candidate_id is absent would break dedup
  // idempotency on a retried admission. Still fail closed if the store returned
  // neither identifier.
  if (ack.status === "duplicate_exact") {
    const id = ack.candidate_id ?? ack.record_digest;
    if (typeof id === "string") return { admitted: true, id };
  }
  return { admitted: false, reason: `capture not committed — status "${ack.status}"` };
}

/** `AdmissionOutcomeV1` → `PromotionOutcome`. `accepted` (with a record_id) = promoted; else refused. */
export function mapAdmissionOutcome(outcome: AdmissionOutcomeV1): PromotionOutcome {
  if (outcome.status === "accepted" && typeof outcome.record_id === "string") {
    return { promoted: true, id: outcome.record_id };
  }
  return { promoted: false, reason: `admission not accepted — status "${outcome.status}"` };
}

/** `LifecycleReceiptV1` → `TombstoneOutcome`. Applied iff the transition reached the `tombstoned` state. */
export function mapLifecycleReceipt(receipt: LifecycleReceiptV1): TombstoneOutcome {
  const applied = receipt.to_state === "tombstoned";
  return applied ? { applied: true } : { applied: false, reason: `transition landed in "${receipt.to_state}", not tombstoned` };
}
