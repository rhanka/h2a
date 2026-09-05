// Tests for the V1→V2 adapter builders/mappers (path V). Proves the field
// mapping is correct; tsc (build) additionally proves the builders construct
// the REAL vendored MemoryPortV2 shapes (a wrong field name/type is a compile
// error before this test ever runs). The 6 gaps are supplied by a stub
// resolver — the same injection point the go-live wiring will fill.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  buildCaptureRequest,
  buildAdmissionRequest,
  buildTombstoneCommand,
  buildRecallRequest,
  mapCaptureAcknowledgement,
  mapAdmissionOutcome,
  mapLifecycleReceipt
} from "../dist/runtime/memory/port-v2-adapter.js";

// A stub V2GapResolvers: canned, deterministic values for every injected gap.
const R = {
  scopeRef: ({ principal_owner, scope }) => `scope:${principal_owner}:${scope}`,
  purposeRef: ({ subject }) => `purpose:${subject}`,
  typeRef: (kind) => `type:${kind}`,
  components: (n) => ({
    components: [{ component_id: "c1", kind: n.memory_kind, text: n.provenance.cited, citation_ids: ["cit1"] }],
    primary_component_id: "c1"
  }),
  citations: (n) => ({
    citations: [{ citation_id: "cit1", source_ref: "src:x", locator: { scheme: "ref", value: n.event.ref }, content_digest: "sha256:d" }],
    primary_citation_id: "cit1"
  }),
  validTime: (n) => ({ t: n.event.at }),
  retention: () => ({ derivative_rule: "retain" }),
  reconciliation: () => ({ family_refs: [] }),
  evidenceBundle: () => ({ evidence_ref: "ev:x", evidence_digest: "sha256:e", citation_ids: ["cit1"] }),
  authorization: (ctx) => ({ credential: `cred:${ctx.principal_owner}` }),
  admissionAuthorization: ({ ctx, evidence }) => ({ credential: `cred:${ctx.principal_owner}`, context_ref: `d11:${evidence.leg1_verdict_ref}` }),
  idempotencyKey: () => "idem:1",
  deadlineAt: () => "2026-09-05T00:00:00Z",
  sourceOrder: () => ({ source_ref: "src:x", sequence: "cur:1" }),
  cancellationRef: () => "cancel:1",
  recallBudgets: () => ({ max_candidates: 100, max_results: 20, max_packet_bytes: 65536, deadline_at: "2026-09-05T00:00:00Z" }),
  recallCapabilityPolicy: () => ({ accepted_only_lexical: true }),
  recallPurposeRef: () => "purpose:recall",
  lifecycleEventId: () => "evt:1",
  reasonRef: () => "reason:1",
  lifecycleEventAnchor: () => ({ at: 1000 })
};

const CTX = { principal_owner: "claude:owner-1" };
const NOTE = {
  node_type: "MemoryNote",
  memory_kind: "decision",
  subject: "agent-work",
  t: 5000,
  t_src: "h2a:dispatch",
  event: { at: 1000, kind: "commit", ref: "sha:abc" },
  provenance: { cited: "the remembered text", source: "sha:abc" },
  principal_owner: "claude:owner-1",
  scope: "private"
};

test("buildCaptureRequest maps a note to CaptureRequestV2 (committed_pending = pending)", () => {
  const req = buildCaptureRequest(NOTE, CTX, R);
  assert.equal(req.schema_version, 2);
  assert.equal(req.idempotency_key, "idem:1");
  assert.equal(req.authorization.credential, "cred:claude:owner-1");
  const p = req.payload;
  assert.equal(p.schema_version, 2);
  assert.equal(p.scope_ref, "scope:claude:owner-1:private");
  assert.equal(p.purpose_ref, "purpose:agent-work");
  assert.equal(p.primary_event.at, 1000, "the episode instant is carried");
  assert.equal(p.primary_event.type_ref, "type:commit", "event.kind → type_ref");
  assert.equal(p.primary_event.citation_id, "cit1");
  assert.equal(p.components[0].kind, "decision", "memory_kind → component kind (same closed set)");
  assert.equal(p.components[0].text, "the remembered text");
  assert.equal(p.valid_time.t, 1000);
  assert.equal(p.retention.derivative_rule, "retain");
});

test("buildAdmissionRequest maps promote to requestAdmission; D11 evidence rides the authorization", () => {
  const evidence = { leg1_verdict_ref: "v1", leg2_verdict_ref: "v2", independence_attestation: "att" };
  const req = buildAdmissionRequest("note-9", evidence, CTX, R);
  assert.equal(req.candidate_id, "note-9");
  assert.equal(req.authorization.context_ref, "d11:v1", "the ceremony/verdict evidence is carried by authorization.context_ref (G4)");
});

test("buildTombstoneCommand maps a node target to transition(tombstone)", () => {
  const cmd = buildTombstoneCommand({ kind: "node", id: "rec-7" }, { requester: "who" }, CTX, R);
  assert.equal(cmd.operation, "tombstone");
  assert.equal(cmd.record_id, "rec-7");
  assert.equal(cmd.event_id, "evt:1");
  assert.equal(cmd.authorization.credential, "cred:claude:owner-1");
});

test("buildRecallRequest maps a point recall to RecallRequestV2 with as_of + budgets", () => {
  const req = buildRecallRequest({ asOf: 1234 }, CTX, R);
  assert.equal(req.purpose_ref, "purpose:recall");
  assert.equal(req.as_of.valid_time, 1234);
  assert.equal(req.budgets.max_results, 20);
  assert.equal(req.authorization.credential, "cred:claude:owner-1");
});

test("mapCaptureAcknowledgement: committed_pending → admitted; refused → refused", () => {
  assert.deepEqual(mapCaptureAcknowledgement({ status: "committed_pending", candidate_id: "c9" }), { admitted: true, id: "c9" });
  assert.equal(mapCaptureAcknowledgement({ status: "refused" }).admitted, false);
});

test("mapAdmissionOutcome: accepted → promoted; rejected → refused", () => {
  assert.deepEqual(mapAdmissionOutcome({ status: "accepted", candidate_id: "c9", record_id: "r9", cursor: "x", decision_receipt_digest: "sha256:a", transaction_receipt_digest: "sha256:b" }), { promoted: true, id: "r9" });
  assert.equal(mapAdmissionOutcome({ status: "rejected", candidate_id: "c9", cursor: "x", decision_receipt_digest: "sha256:a", transaction_receipt_digest: "sha256:b" }).promoted, false);
});

test("mapLifecycleReceipt: to_state tombstoned → applied; else not", () => {
  assert.equal(mapLifecycleReceipt({ to_state: "tombstoned" }).applied, true);
  assert.equal(mapLifecycleReceipt({ to_state: "accepted_current" }).applied, false);
});

test("NB-01: buildTombstoneCommand REFUSES an edge target (never mis-targets the source node)", () => {
  assert.throws(
    () => buildTombstoneCommand({ kind: "edge", source: "rec_A", target: "rec_B", relation: "references" }, { requester: "who" }, CTX, R),
    /edge tombstone is not supported/
  );
  // a node target still builds cleanly, on its own id (not a source fallback)
  const cmd = buildTombstoneCommand({ kind: "node", id: "rec_A" }, { requester: "who" }, CTX, R);
  assert.equal(cmd.record_id, "rec_A");
});

test("NB-02: duplicate_exact admits via record_digest when candidate_id is omitted; fails closed if neither", () => {
  // candidate_id present → admitted on it
  assert.deepEqual(mapCaptureAcknowledgement({ status: "duplicate_exact", candidate_id: "c9" }), { admitted: true, id: "c9" });
  // candidate_id omitted but record_digest present → admitted on the digest (idempotent dedup)
  assert.deepEqual(mapCaptureAcknowledgement({ status: "duplicate_exact", record_digest: "sha256:dup" }), { admitted: true, id: "sha256:dup" });
  // neither identifier → fail closed
  assert.equal(mapCaptureAcknowledgement({ status: "duplicate_exact" }).admitted, false);
  // a fresh commit still REQUIRES candidate_id (no digest fallback for committed_pending)
  assert.equal(mapCaptureAcknowledgement({ status: "committed_pending", record_digest: "sha256:x" }).admitted, false);
});
