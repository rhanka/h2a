// Tests for the V1→V2 anti-corruption compat port. Proves that
// `createV1CompatPort(v2, resolvers, reverse)` exposes a V1 producer+recall port
// whose methods map correctly to the V2 port and back — so the existing V1
// clients + fixtures need no change. tsc additionally proves the compat port
// satisfies the V1 `MemoryProducerPort & MemoryRecallPort` interface AND
// constructs real vendored V2 requests.

import { strict as assert } from "node:assert";
import test from "node:test";

import { createV1CompatPort } from "../dist/runtime/memory/port-v2-compat.js";

// --- stub gap resolvers (write-side) ---
const R = {
  scopeRef: () => "scope:x",
  purposeRef: () => "purpose:x",
  typeRef: (k) => `type:${k}`,
  components: (n) => ({ components: [{ component_id: "c1", kind: n.memory_kind, text: n.provenance.cited, citation_ids: ["cit1"] }], primary_component_id: "c1" }),
  citations: (n) => ({ citations: [{ citation_id: "cit1", source_ref: "src:x", locator: { scheme: "ref", value: n.event.ref }, content_digest: "sha256:d" }], primary_citation_id: "cit1" }),
  validTime: (n) => ({ t: n.event.at }),
  retention: () => ({ derivative_rule: "retain" }),
  reconciliation: () => ({ family_refs: [] }),
  evidenceBundle: () => ({ evidence_ref: "ev:x", evidence_digest: "sha256:e", citation_ids: ["cit1"] }),
  authorization: (ctx) => ({ credential: `cred:${ctx.principal_owner}` }),
  admissionAuthorization: ({ evidence }) => ({ credential: "cred:x", context_ref: `d11:${evidence.leg1_verdict_ref}` }),
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

// --- stub recall reverse resolvers (read-side) ---
const REV = {
  subject: () => "agent-work",
  scope: () => "private",
  principalOwner: () => "claude:owner-1",
  reviewStatus: () => "accepted",
  eventKind: () => "commit"
};

const CTX = { principal_owner: "claude:owner-1" };
const NOTE = {
  node_type: "MemoryNote", memory_kind: "decision", subject: "agent-work",
  t: 5000, t_src: "h2a:dispatch",
  event: { at: 1000, kind: "commit", ref: "sha:abc" },
  provenance: { cited: "text", source: "sha:abc" },
  principal_owner: "claude:owner-1", scope: "private"
};

function counting(impl) {
  let calls = 0;
  const fn = async (...a) => { calls += 1; return impl(...a); };
  fn.calls = () => calls;
  return fn;
}

// a stub V2 port that records which method was called and returns a canned Result
function stubV2({ capture, requestAdmission, transition, recall } = {}) {
  return {
    version: 2,
    capabilities: async () => ({ ok: true, value: {} }),
    validate: () => ({ ok: true, value: { payload_digest: "sha256:p" } }),
    capture: counting(capture ?? (async () => ({ ok: true, value: { status: "committed_pending", candidate_id: "cand-1" } }))),
    cancelCapture: async () => ({ ok: true, value: { cancelled: true } }),
    requestAdmission: counting(requestAdmission ?? (async () => ({ ok: true, value: { status: "accepted", candidate_id: "cand-1", record_id: "rec-1", cursor: "x", decision_receipt_digest: "sha256:a", transaction_receipt_digest: "sha256:b" } }))),
    transition: counting(transition ?? (async () => ({ ok: true, value: { to_state: "tombstoned" } }))),
    recall: counting(recall ?? (async () => ({ ok: true, value: { records: [{ record: RECORD, redacted_fields: [], redaction_receipt_digest: "sha256:r", score: 1, rank: 0 }], rank_receipt: {}, packet_digest: "sha256:pk" } }))),
    proposeCapitalisation: async () => ({ ok: true, value: { status: "committed_pending" } }),
    invalidateProjections: async () => ({ ok: true, value: {} }),
    readiness: async () => ({ ok: true, value: {} })
  };
}

const RECORD = {
  schema_version: 2, scope_ref: "scope:x", purpose_ref: "purpose:x",
  valid_time: { t: 1000 },
  components: [{ component_id: "c1", kind: "decision", text: "text", citation_ids: ["cit1"] }],
  primary_component_id: "c1",
  primary_event: { at: 1000, type_ref: "type:commit", citation_id: "cit1" },
  citations: [{ citation_id: "cit1", source_ref: "src:x", locator: { scheme: "ref", value: "sha:abc" }, content_digest: "sha256:d" }],
  retention: { derivative_rule: "retain" }, reconciliation: { family_refs: [] },
  record_id: "rec-1", payload_digest: "sha256:p", record_digest: "sha256:rd",
  recorded_at: "2026-09-05T00:00:00Z", recorded_cursor: "cur:9",
  authorization_receipt_digest: "sha256:ar",
  trust: { class: "asserted", evidence_digest: "sha256:e", verifier_id: "v", verifier_version: "1", issued_at: "t", revocation_epoch: "e", receipt_digest: "sha256:rc" }
};

test("compat admitMemoryNote → capture → admitted", async () => {
  const v2 = stubV2();
  const port = createV1CompatPort(v2, R, REV);
  const out = await port.admitMemoryNote(NOTE, CTX);
  assert.deepEqual(out, { admitted: true, id: "cand-1" });
  assert.equal(v2.capture.calls(), 1);
  assert.equal(v2.requestAdmission.calls(), 0);
});

test("compat admitMemoryNote: a V2 Result error → fail-closed refusal (never a silent admit)", async () => {
  const v2 = stubV2({ capture: async () => ({ ok: false, error: { code: "STORE_UNAVAILABLE", operation: "capture", message: "down", retryable: true } }) });
  const port = createV1CompatPort(v2, R, REV);
  const out = await port.admitMemoryNote(NOTE, CTX);
  assert.equal(out.admitted, false);
  assert.match(out.reason, /STORE_UNAVAILABLE/);
});

test("compat promoteNote → requestAdmission(accepted) → promoted", async () => {
  const v2 = stubV2();
  const port = createV1CompatPort(v2, R, REV);
  const out = await port.promoteNote("note-1", { leg1_verdict_ref: "v1", leg2_verdict_ref: "v2", independence_attestation: "att" }, CTX);
  assert.deepEqual(out, { promoted: true, id: "rec-1" });
  assert.equal(v2.requestAdmission.calls(), 1);
});

test("compat promoteNote: rejected admission → not promoted", async () => {
  const v2 = stubV2({ requestAdmission: async () => ({ ok: true, value: { status: "rejected", candidate_id: "c", cursor: "x", decision_receipt_digest: "sha256:a", transaction_receipt_digest: "sha256:b" } }) });
  const port = createV1CompatPort(v2, R, REV);
  const out = await port.promoteNote("note-1", { leg1_verdict_ref: "v1", leg2_verdict_ref: "v2", independence_attestation: "att" }, CTX);
  assert.equal(out.promoted, false);
});

test("compat requestTombstone → transition(tombstoned) → applied, with a signed receipt underneath", async () => {
  const v2 = stubV2();
  const port = createV1CompatPort(v2, R, REV);
  const out = await port.requestTombstone({ kind: "node", id: "rec-7" }, { requester: "who" }, CTX);
  assert.equal(out.applied, true);
  assert.equal(v2.transition.calls(), 1);
});

test("NB-01: compat requestTombstone on an EDGE target fails closed and never calls transition", async () => {
  const v2 = stubV2();
  const port = createV1CompatPort(v2, R, REV);
  const out = await port.requestTombstone({ kind: "edge", source: "rec-A", target: "rec-B", relation: "references" }, { requester: "who" }, CTX);
  assert.equal(out.applied, false);
  assert.match(out.reason, /edge tombstone is not supported/);
  assert.equal(v2.transition.calls(), 0, "no V2 transition may fire for a refused edge tombstone");
});

test("compat recallMemory → recall → notes-only view (records mapped back to V1)", async () => {
  const v2 = stubV2();
  const port = createV1CompatPort(v2, R, REV);
  const res = await port.recallMemory({ asOf: 1000 }, CTX);
  assert.equal(res.projection, "notes-only");
  assert.equal(res.notes.length, 1);
  assert.equal(res.notes[0].id, "rec-1");
  assert.equal(res.notes[0].memory_kind, "decision");
  assert.equal(res.notes[0].subject, "agent-work");
  assert.equal(res.notes[0].event.at, 1000);
  assert.equal(res.notes[0].trust, "asserted");
});

test("compat recallMemory: a V2 error throws (recall-client catches into its own refusal)", async () => {
  const v2 = stubV2({ recall: async () => ({ ok: false, error: { code: "RANKING_UNAVAILABLE", operation: "recall_current", message: "no ranker", retryable: false } }) });
  const port = createV1CompatPort(v2, R, REV);
  await assert.rejects(() => port.recallMemory({ asOf: 1 }, CTX), /RANKING_UNAVAILABLE/);
});
