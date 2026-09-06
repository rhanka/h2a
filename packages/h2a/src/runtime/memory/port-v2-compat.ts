/**
 * V1→V2 anti-corruption port (path V, the cutover). `createV1CompatPort` wraps a
 * real `MemoryPortV2` (+ the injected `V2GapResolvers`) and EXPOSES the V1
 * `MemoryProducerPort & MemoryRecallPort` the h2a clients already consume — so
 * admit-client / promote-client / tombstone-client / recall-client + all their
 * fixtures (including the 1656-line D11 ceremony suite) stay UNCHANGED, and their
 * anti-fabrication coverage is preserved by construction (nothing rewritten).
 *
 * This is the ACL between h2a's stable V1-facing internal API and graphify's V2
 * contract: the clients speak V1; this port maps each call to V2 via the proven
 * builders (`./port-v2-adapter.ts`) and maps the V2 responses back. At go-live,
 * h2a constructs `createV1CompatPort(realGraphifyV2Port, realResolvers, realReverse)`
 * and hands it to the clients — that IS the V2 wiring. Imports ZERO graphify
 * runtime (only vendored types) — anti-cycle holds.
 *
 * The 6 gaps stay injected (`V2GapResolvers`); the recall RESPONSE reverse-mapping
 * needs the fields V2 does not carry back flat (subject, scope, principal_owner,
 * review_status), supplied by an injected `V2RecallReverseResolvers` — the same
 * go-live wiring point.
 */

import type {
  AdmissionOutcome,
  MemoryContext,
  MemoryKind,
  MemoryNoteInput,
  MemoryProducerPort,
  MemoryRecallPort,
  MemoryRecallQuery,
  MemoryRecallResultView,
  MemoryScope,
  PromotionEvidence,
  PromotionOutcome,
  RecalledMemoryNoteView,
  TombstoneAuthorization,
  TombstoneOutcome,
  TombstoneTarget,
  TrustTier
} from "./port-v1.js";
import type { LifecycleCommandV1, MemoryPortV2, MemoryRecordV2, RecallPacketV2 } from "./graphify-contracts-v2.vendored.js";
import {
  buildAdmissionRequest,
  buildCaptureRequest,
  buildRecallRequest,
  buildTombstoneCommand,
  mapAdmissionOutcome,
  mapCaptureAcknowledgement,
  mapLifecycleReceipt,
  type V2GapResolvers
} from "./port-v2-adapter.js";

/**
 * Recover the V1 view fields a `MemoryRecordV2` does not carry back in the flat
 * V1 shape (V2 dropped a top-level `subject`, and encodes tenancy as opaque
 * refs). Injected — the real resolution (scope_ref → {principal_owner, scope},
 * the record's state → review_status) is graphify/go-live wiring.
 */
export interface V2RecallReverseResolvers {
  subject(record: MemoryRecordV2): string;
  scope(record: MemoryRecordV2): MemoryScope;
  principalOwner(record: MemoryRecordV2): string;
  reviewStatus(record: MemoryRecordV2): string;
  /** An event-kind label recovered from the primary event's opaque `type_ref`. */
  eventKind(record: MemoryRecordV2): string;
}

/** Map one V2 record to the V1 projected view. Pure; the recovered fields come from `rev`. */
export function mapRecordToView(record: MemoryRecordV2, rev: V2RecallReverseResolvers): RecalledMemoryNoteView {
  const primary = record.components.find((c) => c.component_id === record.primary_component_id) ?? record.components[0];
  const primaryCitation = record.citations.find((c) => c.citation_id === record.primary_event.citation_id);
  const view: RecalledMemoryNoteView = {
    id: record.record_id,
    node_type: "MemoryNote",
    memory_kind: (primary?.kind ?? "context") as MemoryKind,
    subject: rev.subject(record),
    t: record.valid_time.t,
    trust: record.trust.class as TrustTier,
    review_status: rev.reviewStatus(record),
    scope: rev.scope(record),
    principal_owner: rev.principalOwner(record),
    provenance: { cited: primary?.text ?? "", source: primaryCitation?.locator.value ?? "" },
    event: {
      at: record.primary_event.at,
      kind: rev.eventKind(record),
      ref: primaryCitation?.locator.value ?? ""
    }
  };
  if (record.valid_time.t_end !== undefined) view.t_end = record.valid_time.t_end;
  return view;
}

/** Map a `RecallPacketV2` to the V1 recall result view (notes-only). */
export function mapRecallPacket(
  packet: RecallPacketV2,
  rev: V2RecallReverseResolvers,
  requestingPrincipal: string
): MemoryRecallResultView {
  return {
    schema: "memory-recall/v2-compat",
    notes: packet.records.map((r) => mapRecordToView(r.record, rev)),
    projection: "notes-only",
    requestingPrincipal,
    freshness: "unverified",
    unpaged: true
  };
}

/**
 * Build a V1 `MemoryProducerPort & MemoryRecallPort` backed by a V2 port. Each V1
 * call maps to V2 via the proven builders; a V2 `Result` error becomes the V1
 * fail-closed refusal shape the clients already handle (a producer error → an
 * `{admitted/promoted/applied:false, reason}`; a recall error THROWS, which
 * `recall-client` catches into its own refusal, matching the V1 recall contract).
 */
export function createV1CompatPort(
  v2: MemoryPortV2,
  resolvers: V2GapResolvers,
  recallReverse: V2RecallReverseResolvers
): MemoryProducerPort & MemoryRecallPort {
  return {
    async admitMemoryNote(note: MemoryNoteInput, ctx: MemoryContext): Promise<AdmissionOutcome> {
      const res = await v2.capture(buildCaptureRequest(note, ctx, resolvers));
      if (!res.ok) return { admitted: false, reason: `${res.error.code}: ${res.error.message}` };
      return mapCaptureAcknowledgement(res.value);
    },
    async promoteNote(noteId: string, evidence: PromotionEvidence, ctx: MemoryContext): Promise<PromotionOutcome> {
      const res = await v2.requestAdmission(buildAdmissionRequest(noteId, evidence, ctx, resolvers));
      if (!res.ok) return { promoted: false, reason: `${res.error.code}: ${res.error.message}` };
      return mapAdmissionOutcome(res.value);
    },
    async requestTombstone(
      target: TombstoneTarget,
      auth: TombstoneAuthorization,
      ctx: MemoryContext
    ): Promise<TombstoneOutcome> {
      let command: LifecycleCommandV1;
      try {
        command = buildTombstoneCommand(target, auth, ctx, resolvers);
      } catch (err) {
        // NB-01: an unbuildable command (e.g. an edge target with no resolvable
        // record_id) fails closed rather than mis-targeting a node.
        return { applied: false, reason: err instanceof Error ? err.message : String(err) };
      }
      const res = await v2.transition(command);
      if (!res.ok) return { applied: false, reason: `${res.error.code}: ${res.error.message}` };
      return mapLifecycleReceipt(res.value);
    },
    async recallMemory(query: MemoryRecallQuery, ctx: MemoryContext): Promise<MemoryRecallResultView> {
      const res = await v2.recall(buildRecallRequest(query, ctx, resolvers));
      if (!res.ok) throw new Error(`recall refused by V2 port — ${res.error.code}: ${res.error.message}`);
      return mapRecallPacket(res.value, recallReverse, ctx.principal_owner);
    }
  };
}
