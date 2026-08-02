// WP11 · Memory & context — D11 ceremony orchestrator (this build's slice 5).
//
// runD11Ceremony COMPOSES slice 3's double-consensus (checkDoubleConsensusPreconditions
// / promoteNoteWithDoubleConsensus, ../dist/runtime/memory/promote-client.js) end to
// end: launch the two independent legs, collect their verdicts, gate on the SAME
// structural precondition check slice 3 already proved, write the verdict +
// attestation artifacts, and only then dispatch through promoteNote. The actual
// model-leg launching and file I/O are INJECTED (deps.launchLeg / deps.writeVerdict /
// deps.writeAttestation / deps.port) and stubbed here — never implemented for real.
//
// This file's job is proving the ORCHESTRATION, not re-proving slice 3's own gate
// logic (already covered exhaustively by memory-promote-client.test.js): separation
// of powers refuses BEFORE launch, a bad verdict or a leg collision refuses AFTER
// launch but BEFORE any write, and I5 fail-closed holds at every injected step —
// launchLeg, writeVerdict, writeAttestation, port — proven via counting stubs that
// later steps are NEVER reached once an earlier one refuses.

import { strict as assert } from "node:assert";
import test from "node:test";

import { runD11Ceremony } from "../dist/runtime/memory/d11-ceremony.js";

function leg(model, session) {
  return { model, session };
}

const NOTE = { noteId: "note-1", principal_owner: "claude:h2a-memory:owner-1" };
const AUTHOR_ID = "claude:h2a-memory:author-not-a-leg";
const LEG_SPEC_1 = leg("gpt-5.6-terra-xhigh", "session-A");
const LEG_SPEC_2 = leg("opus-5-xhigh", "session-B");
const CTX = { principal_owner: NOTE.principal_owner };

function goVerdictFor(legSpec) {
  return { noteId: NOTE.noteId, verdict: "GO", leg: legSpec, at: 1000 };
}

/** Counts calls; the impl may be async or throw synchronously — both are caught by the caller. */
function countingFn(impl) {
  let calls = 0;
  const args = [];
  const fn = async (...a) => {
    calls += 1;
    args.push(a);
    return impl(...a);
  };
  fn.calls = () => calls;
  fn.args = () => args;
  return fn;
}

function refCounter(prefix) {
  let n = 0;
  return countingFn(() => {
    n += 1;
    return `${prefix}:${n}`;
  });
}

function happyDeps(overrides = {}) {
  const launchLeg = countingFn(async (note, legSpec) => goVerdictFor(legSpec));
  const writeVerdict = refCounter("verdict-ref");
  const writeAttestation = refCounter("attestation-ref");
  const promoteImpl = () => ({ promoted: true, id: NOTE.noteId });
  const port = {
    async admitMemoryNote() {
      throw new Error("not used in this slice");
    },
    promoteNote: countingFn(async (noteId, evidence, ctx) => promoteImpl(noteId, evidence, ctx)),
    async requestTombstone() {
      throw new Error("not used in this slice");
    }
  };
  return {
    launchLeg,
    writeVerdict,
    writeAttestation,
    legSpecs: [LEG_SPEC_1, LEG_SPEC_2],
    port,
    ctx: CTX,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// I5 — the ceremony's own dependency bundle, fail-closed.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no deps injected — undefined", async () => {
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, undefined);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed/i);
  assert.equal(result.localOnly, true);
});

test("runD11Ceremony REFUSES (fail-closed, I5) when no deps injected — null", async () => {
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, null);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
});

// ---------------------------------------------------------------------------
// Separation of powers — refused BEFORE launchLeg is ever called.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES BEFORE launching when the two legSpecs are structurally identical", async () => {
  const deps = happyDeps({ legSpecs: [LEG_SPEC_1, LEG_SPEC_1] });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 0, "identical legSpecs must never reach launchLeg");
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES BEFORE launching when leg1's session equals the note's author", async () => {
  const deps = happyDeps({ legSpecs: [leg(LEG_SPEC_1.model, AUTHOR_ID), LEG_SPEC_2] });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.match(result.outcome.reason, /author/i);
  assert.equal(deps.launchLeg.calls(), 0, "a leg == author must never reach launchLeg");
});

test("runD11Ceremony REFUSES BEFORE launching when leg2's session equals the note's author", async () => {
  const deps = happyDeps({ legSpecs: [LEG_SPEC_1, leg(LEG_SPEC_2.model, AUTHOR_ID)] });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — launchLeg absent/throwing/rejecting.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no launchLeg is injected", async () => {
  const deps = happyDeps({ launchLeg: undefined });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|launchLeg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when launchLeg throws — never a silent success", async () => {
  const deps = happyDeps({
    launchLeg: countingFn(async () => {
      throw new Error("model unreachable");
    })
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /launchLeg/i);
  assert.match(result.outcome.reason, /model unreachable/);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when launchLeg rejects — never a silent success", async () => {
  const deps = happyDeps({
    launchLeg: countingFn(() => Promise.reject(new Error("timeout")))
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /launchLeg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// After launch, before any write: the SAME structural gate slice 3 proved.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when a returned verdict is NO-GO — writeVerdict/writeAttestation/promote never called", async () => {
  const deps = happyDeps({
    launchLeg: countingFn(async (note, legSpec) => {
      const v = goVerdictFor(legSpec);
      return legSpec.session === LEG_SPEC_2.session ? { ...v, verdict: "NO-GO", reason: "insufficient evidence" } : v;
    })
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /GO/);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 2, "both legs are still launched — the gate runs on what came back");
  assert.equal(deps.writeVerdict.calls(), 0, "a refused ceremony must never write a verdict");
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two returned verdicts' legs collide, despite distinct legSpecs", async () => {
  // launchLeg IGNORES the legSpec it was given and returns the same leg identity
  // for both — the ceremony must catch this structurally, off the verdicts
  // actually returned, not trust that distinct legSpecs implies distinct verdicts.
  const collidingLeg = leg("same-model", "same-session");
  const deps = happyDeps({
    launchLeg: countingFn(async () => ({ noteId: NOTE.noteId, verdict: "GO", leg: collidingLeg, at: 1000 }))
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /independent|same leg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two returned verdicts disagree on noteId", async () => {
  const deps = happyDeps({
    launchLeg: countingFn(async (note, legSpec) => {
      const v = goVerdictFor(legSpec);
      return legSpec.session === LEG_SPEC_2.session ? { ...v, noteId: "some-other-note" } : v;
    })
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /note/i);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — writeVerdict / writeAttestation absent/throwing.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no writeVerdict is injected", async () => {
  const deps = happyDeps({ writeVerdict: undefined });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|writeVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when writeVerdict throws — writeAttestation/promote never called", async () => {
  const deps = happyDeps({
    writeVerdict: countingFn(async () => {
      throw new Error("disk full");
    })
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /writeVerdict/i);
  assert.match(result.outcome.reason, /disk full/);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES (fail-closed, I5) when no writeAttestation is injected", async () => {
  const deps = happyDeps({ writeAttestation: undefined });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|writeAttestation/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are written before the attestation step");
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when writeAttestation throws — promote never called", async () => {
  const deps = happyDeps({
    writeAttestation: countingFn(async () => {
      throw new Error("signing key unavailable")
    })
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /writeAttestation/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — the port itself (reused from slice 3, proven end to end here).
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no port is injected — writes still happened", async () => {
  const deps = happyDeps({ port: undefined });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|port/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2);
  assert.equal(deps.writeAttestation.calls(), 1);
});

test("runD11Ceremony REFUSES when the port throws (unreachable) — never a silent success", async () => {
  const deps = happyDeps();
  deps.port.promoteNote = countingFn(async () => {
    throw new Error("ECONNREFUSED");
  });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /unreachable/i);
  assert.equal(result.localOnly, true);
});

// ---------------------------------------------------------------------------
// Happy path — the full composition, end to end.
// ---------------------------------------------------------------------------

test("runD11Ceremony happy path: 2 distinct GO legs → verdicts written, attestation written, promote called with the right evidence", async () => {
  const deps = happyDeps();
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

  assert.deepEqual(result.outcome, { promoted: true, id: NOTE.noteId });
  assert.equal(result.localOnly, false);

  assert.equal(deps.launchLeg.calls(), 2, "both legs are launched");
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are written");
  assert.equal(deps.writeAttestation.calls(), 1, "exactly one attestation is written");
  assert.equal(deps.port.promoteNote.calls(), 1, "promoteNote is called exactly once");

  // The attestation actually written reflects the VERDICTS' real leg identities,
  // computed (not asserted blindly).
  const [writtenAttestation] = deps.writeAttestation.args()[0];
  assert.deepEqual(writtenAttestation.leg1, LEG_SPEC_1);
  assert.deepEqual(writtenAttestation.leg2, LEG_SPEC_2);
  assert.equal(writtenAttestation.distinctModels, true);
  assert.equal(writtenAttestation.distinctSessions, true);
  assert.equal(writtenAttestation.verdictsWrittenBeforeCrossVisibility, true);
  assert.equal(typeof writtenAttestation.orchestrator, "string");

  // The evidence handed to promoteNote carries the REFS the injected writers
  // returned — not the raw objects (Part 1's reconciliation: a locator, not JSON).
  const [promotedNoteId, evidence, ctx] = deps.port.promoteNote.args()[0];
  assert.equal(promotedNoteId, NOTE.noteId);
  assert.equal(evidence.leg1_verdict_ref, "verdict-ref:1");
  assert.equal(evidence.leg2_verdict_ref, "verdict-ref:2");
  assert.equal(evidence.independence_attestation, "attestation-ref:1");
  assert.deepEqual(ctx, CTX);
});

test("runD11Ceremony happy path is order-agnostic on which leg reports distinctModels/distinctSessions correctly for two DIFFERENT sessions but the SAME model", async () => {
  const sameModel = "gpt-5.6-terra-xhigh";
  const deps = happyDeps({ legSpecs: [leg(sameModel, "session-A"), leg(sameModel, "session-C")] });
  const result = await runD11Ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, true);
  const [writtenAttestation] = deps.writeAttestation.args()[0];
  assert.equal(writtenAttestation.distinctModels, false, "same model on both legs — not distinct");
  assert.equal(writtenAttestation.distinctSessions, true, "distinct sessions still make the legs independent");
});
