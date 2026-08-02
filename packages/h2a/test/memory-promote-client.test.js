// WP11 · Memory & context — promote client, D11 double-consensus (build brief slice 6,
// client-side orchestration — WP11-slice-3 of this build).
//
// This slice is the CLIENT-side enforcement of D11's double-consensus gate: TWO
// independent verdict legs must BOTH say GO, must actually be independent (distinct
// model and/or session — checked STRUCTURALLY off the verdicts themselves, never off
// a self-reported attestation flag), must not be the note's own author (separation of
// powers), and must be backed by two DISTINCT verdict-file references — before
// `promoteNote` is ever called. `checkDoubleConsensusPreconditions` is a pure,
// port-less function: it cannot call the port even if it wanted to, so a refusal at
// that layer makes "promoteNote never called" true by construction, not just by
// runtime luck. `promoteNoteWithDoubleConsensus` composes the guard with the dispatch
// and is what a caller actually uses; a counting stub port proves the guard's refusal
// really does stop the port call.
//
// promoteNote itself (the raw dispatch) mirrors admit-client.ts's I5 fail-closed
// contract: absent port, throwing port, rejecting port — all refuse; nothing here
// can produce `promoted: true` without a port actually having said so.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  assemblePromotionEvidence,
  checkDoubleConsensusPreconditions,
  promoteNote,
  promoteNoteWithDoubleConsensus
} from "../dist/runtime/memory/promote-client.js";

const CTX = { principal_owner: "claude:h2a-memory:abc123" };

function leg(model, session) {
  return { model, session };
}

function verdict(overrides = {}) {
  return {
    noteId: "note-1",
    verdict: "GO",
    leg: leg("gpt-5.6-terra-xhigh", "session-A"),
    at: 1000,
    ...overrides
  };
}

function attestation(overrides = {}) {
  return {
    leg1: leg("gpt-5.6-terra-xhigh", "session-A"),
    leg2: leg("opus-5-xhigh", "session-B"),
    distinctModels: true,
    distinctSessions: true,
    verdictsWrittenBeforeCrossVisibility: true,
    orchestrator: "conductor:h2a-memory",
    ...overrides
  };
}

function twoIndependentGoVerdicts() {
  return [
    verdict({ leg: leg("gpt-5.6-terra-xhigh", "session-A") }),
    verdict({ leg: leg("opus-5-xhigh", "session-B") })
  ];
}

function baseInput(overrides = {}) {
  return {
    verdicts: twoIndependentGoVerdicts(),
    attestation: attestation(),
    leg1Ref: "verdict-ref:session-A:note-1",
    leg2Ref: "verdict-ref:session-B:note-1",
    authorId: "claude:h2a-memory:author-not-a-leg",
    ...overrides
  };
}

function countingStubPort(promoteImpl) {
  let calls = 0;
  return {
    calls: () => calls,
    port: {
      async admitMemoryNote() {
        throw new Error("not used in this slice");
      },
      async promoteNote(noteId, evidence, ctx) {
        calls += 1;
        return promoteImpl(noteId, evidence, ctx);
      },
      async requestTombstone() {
        throw new Error("not used in this slice");
      }
    }
  };
}

// ---------------------------------------------------------------------------
// assemblePromotionEvidence — pure assembly into the port's PromotionEvidence shape.
// ---------------------------------------------------------------------------

test("assemblePromotionEvidence packs the two refs and a serialized attestation into PromotionEvidence", () => {
  const att = attestation();
  const evidence = assemblePromotionEvidence("verdict-ref:leg1", "verdict-ref:leg2", att);

  assert.equal(evidence.leg1_verdict_ref, "verdict-ref:leg1");
  assert.equal(evidence.leg2_verdict_ref, "verdict-ref:leg2");
  assert.equal(typeof evidence.independence_attestation, "string");

  // The attestation must be RECOVERABLE from the serialized string (not lossy),
  // since graphify's gate re-inspects it structurally.
  const parsed = JSON.parse(evidence.independence_attestation);
  assert.deepEqual(parsed, att);
});

test("assemblePromotionEvidence is pure — same inputs produce the same evidence, no side effects", () => {
  const att = attestation();
  const e1 = assemblePromotionEvidence("r1", "r2", att);
  const e2 = assemblePromotionEvidence("r1", "r2", att);
  assert.deepEqual(e1, e2);
});

// ---------------------------------------------------------------------------
// checkDoubleConsensusPreconditions — the client-side refusal gate.
// ---------------------------------------------------------------------------

test("checkDoubleConsensusPreconditions ok:true on two distinct independent GO verdicts", () => {
  const result = checkDoubleConsensusPreconditions(baseInput());
  assert.deepEqual(result, { ok: true });
});

test("checkDoubleConsensusPreconditions REFUSES when both verdicts are NO-GO", () => {
  const input = baseInput({
    verdicts: [
      verdict({ leg: leg("gpt-5.6-terra-xhigh", "session-A"), verdict: "NO-GO" }),
      verdict({ leg: leg("opus-5-xhigh", "session-B"), verdict: "NO-GO" })
    ]
  });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /GO/);
});

test("checkDoubleConsensusPreconditions REFUSES on a split verdict (one GO, one NO-GO)", () => {
  const input = baseInput({
    verdicts: [
      verdict({ leg: leg("gpt-5.6-terra-xhigh", "session-A"), verdict: "GO" }),
      verdict({ leg: leg("opus-5-xhigh", "session-B"), verdict: "NO-GO" })
    ]
  });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /GO/);
});

test("checkDoubleConsensusPreconditions REFUSES when the same leg is counted twice (same model+session)", () => {
  const sameLeg = leg("gpt-5.6-terra-xhigh", "session-A");
  const input = baseInput({
    verdicts: [verdict({ leg: sameLeg }), verdict({ leg: sameLeg })]
  });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /independent|same leg/i);
});

test("checkDoubleConsensusPreconditions REFUSES when a leg's session equals the note's author (separation of powers)", () => {
  const input = baseInput({ authorId: "session-A" });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /author/i);
});

test("checkDoubleConsensusPreconditions REFUSES when leg1Ref === leg2Ref (same verdict reference twice)", () => {
  const input = baseInput({ leg1Ref: "verdict-ref:same", leg2Ref: "verdict-ref:same" });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /ref/i);
});

test("checkDoubleConsensusPreconditions REFUSES when verdict count is not exactly 2 (too few)", () => {
  const input = baseInput({ verdicts: [verdict()] });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /2/);
});

test("checkDoubleConsensusPreconditions REFUSES when verdict count is not exactly 2 (too many)", () => {
  const input = baseInput({
    verdicts: [
      verdict({ leg: leg("m1", "s1") }),
      verdict({ leg: leg("m2", "s2") }),
      verdict({ leg: leg("m3", "s3") })
    ]
  });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /2/);
});

test("checkDoubleConsensusPreconditions REFUSES when the two verdicts reference different notes", () => {
  const input = baseInput({
    verdicts: [
      verdict({ noteId: "note-1", leg: leg("gpt-5.6-terra-xhigh", "session-A") }),
      verdict({ noteId: "note-2", leg: leg("opus-5-xhigh", "session-B") })
    ]
  });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false);
  assert.match(result.reason, /note/i);
});

test("checkDoubleConsensusPreconditions is STRUCTURAL, not merely attested — ignores attestation's own distinct* flags when verdicts collide", () => {
  // Attestation LIES (claims distinct), but the actual verdict legs are identical.
  const sameLeg = leg("gpt-5.6-terra-xhigh", "session-A");
  const input = baseInput({
    verdicts: [verdict({ leg: sameLeg }), verdict({ leg: sameLeg })],
    attestation: attestation({ distinctModels: true, distinctSessions: true })
  });
  const result = checkDoubleConsensusPreconditions(input);
  assert.equal(result.ok, false, "a lying attestation must not override the structural check on verdict.leg");
});

// ---------------------------------------------------------------------------
// promoteNote — raw dispatch, I5 fail-closed (mirrors admit-client.ts).
// ---------------------------------------------------------------------------

test("promoteNote branches to promoted:true when the injected port promotes", async () => {
  const { port } = countingStubPort(() => ({ promoted: true, id: "note-1" }));
  const evidence = assemblePromotionEvidence("r1", "r2", attestation());
  const result = await promoteNote("note-1", evidence, CTX, port);
  assert.deepEqual(result.outcome, { promoted: true, id: "note-1" });
  assert.equal(result.localOnly, false);
});

test("promoteNote branches to promoted:false when the injected port refuses", async () => {
  const { port } = countingStubPort(() => ({ promoted: false, reason: "below threshold" }));
  const evidence = assemblePromotionEvidence("r1", "r2", attestation());
  const result = await promoteNote("note-1", evidence, CTX, port);
  assert.deepEqual(result.outcome, { promoted: false, reason: "below threshold" });
  assert.equal(result.localOnly, false);
});

test("promoteNote REFUSES (fail-closed, I5) when no port is injected — undefined", async () => {
  const evidence = assemblePromotionEvidence("r1", "r2", attestation());
  const result = await promoteNote("note-1", evidence, CTX, undefined);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed/i);
  assert.equal(result.localOnly, true);
});

test("promoteNote REFUSES (fail-closed, I5) when no port is injected — null", async () => {
  const evidence = assemblePromotionEvidence("r1", "r2", attestation());
  const result = await promoteNote("note-1", evidence, CTX, null);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
});

test("promoteNote REFUSES when the port throws (unreachable) — never a silent success", async () => {
  const { port } = countingStubPort(() => {
    throw new Error("ECONNREFUSED");
  });
  const evidence = assemblePromotionEvidence("r1", "r2", attestation());
  const result = await promoteNote("note-1", evidence, CTX, port);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /unreachable/i);
  assert.match(result.outcome.reason, /ECONNREFUSED/);
});

test("promoteNote REFUSES when the port rejects (unreachable) — never a silent success", async () => {
  const port = {
    async admitMemoryNote() {
      throw new Error("not used");
    },
    async promoteNote() {
      return Promise.reject(new Error("network timeout"));
    },
    async requestTombstone() {
      throw new Error("not used");
    }
  };
  const evidence = assemblePromotionEvidence("r1", "r2", attestation());
  const result = await promoteNote("note-1", evidence, CTX, port);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /unreachable/i);
});

// ---------------------------------------------------------------------------
// promoteNoteWithDoubleConsensus — the composed orchestration entry point.
// The guard runs BEFORE the port is ever touched; a refusal short-circuits
// before dispatch, proven here via the counting stub's call count.
// ---------------------------------------------------------------------------

test("promoteNoteWithDoubleConsensus: happy path — 2 distinct GO + valid attestation calls promoteNote and returns its outcome", async () => {
  const { port, calls } = countingStubPort(() => ({ promoted: true, id: "note-1" }));
  const result = await promoteNoteWithDoubleConsensus(
    { noteId: "note-1", ctx: CTX, ...baseInput() },
    port
  );
  assert.equal(calls(), 1, "the port must be called exactly once on a valid double-consensus");
  assert.deepEqual(result.outcome, { promoted: true, id: "note-1" });
  assert.equal(result.localOnly, false);
});

test("promoteNoteWithDoubleConsensus: a split verdict refuses locally and NEVER calls the port", async () => {
  const { port, calls } = countingStubPort(() => ({ promoted: true, id: "should-not-happen" }));
  const input = baseInput({
    verdicts: [
      verdict({ leg: leg("gpt-5.6-terra-xhigh", "session-A"), verdict: "GO" }),
      verdict({ leg: leg("opus-5-xhigh", "session-B"), verdict: "NO-GO" })
    ]
  });
  const result = await promoteNoteWithDoubleConsensus({ noteId: "note-1", ctx: CTX, ...input }, port);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(calls(), 0, "a locally-refused double-consensus must never reach the injected port");
});

test("promoteNoteWithDoubleConsensus: same-leg-twice refuses locally and NEVER calls the port", async () => {
  const { port, calls } = countingStubPort(() => ({ promoted: true, id: "should-not-happen" }));
  const sameLeg = leg("gpt-5.6-terra-xhigh", "session-A");
  const input = baseInput({ verdicts: [verdict({ leg: sameLeg }), verdict({ leg: sameLeg })] });
  const result = await promoteNoteWithDoubleConsensus({ noteId: "note-1", ctx: CTX, ...input }, port);
  assert.equal(result.outcome.promoted, false);
  assert.equal(calls(), 0);
});

test("promoteNoteWithDoubleConsensus: leg == author refuses locally and NEVER calls the port", async () => {
  const { port, calls } = countingStubPort(() => ({ promoted: true, id: "should-not-happen" }));
  const input = baseInput({ authorId: "session-B" });
  const result = await promoteNoteWithDoubleConsensus({ noteId: "note-1", ctx: CTX, ...input }, port);
  assert.equal(result.outcome.promoted, false);
  assert.equal(calls(), 0);
});

test("promoteNoteWithDoubleConsensus: equal refs refuses locally and NEVER calls the port", async () => {
  const { port, calls } = countingStubPort(() => ({ promoted: true, id: "should-not-happen" }));
  const input = baseInput({ leg1Ref: "same-ref", leg2Ref: "same-ref" });
  const result = await promoteNoteWithDoubleConsensus({ noteId: "note-1", ctx: CTX, ...input }, port);
  assert.equal(result.outcome.promoted, false);
  assert.equal(calls(), 0);
});

test("promoteNoteWithDoubleConsensus: preconditions pass but no port injected still refuses (I5)", async () => {
  const result = await promoteNoteWithDoubleConsensus({ noteId: "note-1", ctx: CTX, ...baseInput() }, undefined);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|port/i);
});
