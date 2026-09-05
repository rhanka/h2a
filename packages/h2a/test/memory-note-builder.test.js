// WP11 · Memory & context — NoteBuilder (build brief slice 2).
//
// Maps an h2a episode (H2AMemoryEvent) to the vendored MemoryNoteInput. Covers
// the field mapping named in the brief: event{at,kind,ref}; subject passthrough;
// memory_kind per the folded taxonomy; t stamped at dispatch (distinct from
// event.at) + t_src; provenance{cited,source} with source === event.ref;
// principal_owner + scope passthrough; purpose/retention carried only for a
// human subject.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  buildMemoryNote,
  foldTaxonomyToMemoryKind,
  isHumanMemorySubject
} from "../dist/runtime/memory/note-builder.js";

function baseEvent(overrides = {}) {
  return {
    at: 12345,
    kind: "tool-result",
    ref: "toolresult:xyz",
    taxonomy: "measured-fact",
    cited: "the build went green",
    subject: "agent-work",
    principalOwner: "claude:h2a-memory:abc123",
    scope: "private",
    ...overrides
  };
}

test("buildMemoryNote fills event {at, kind, ref} from the episode", () => {
  const note = buildMemoryNote(baseEvent(), { now: () => 99999 });
  assert.deepEqual(note.event, { at: 12345, kind: "tool-result", ref: "toolresult:xyz" });
});

test("buildMemoryNote sets node_type to the literal MemoryNote", () => {
  const note = buildMemoryNote(baseEvent(), { now: () => 1 });
  assert.equal(note.node_type, "MemoryNote");
});

test("buildMemoryNote passes subject through verbatim (agent-work)", () => {
  const note = buildMemoryNote(baseEvent({ subject: "agent-work" }), { now: () => 1 });
  assert.equal(note.subject, "agent-work");
});

test("buildMemoryNote passes subject through verbatim (human:<id>)", () => {
  const note = buildMemoryNote(
    baseEvent({ subject: "human:fabien.antoine", taxonomy: "user", purpose: "wake context", retention: 86400000 }),
    { now: () => 1 }
  );
  assert.equal(note.subject, "human:fabien.antoine");
});

test("buildMemoryNote stamps t at dispatch time via the injected clock, distinct from event.at", () => {
  const note = buildMemoryNote(baseEvent({ at: 111 }), { now: () => 222 });
  assert.equal(note.t, 222);
  assert.notEqual(note.t, note.event.at, "t (dispatch) and event.at (episode instant) may legitimately differ");
});

test("buildMemoryNote defaults t_src to h2a:dispatch, or carries a caller-supplied one", () => {
  const withDefault = buildMemoryNote(baseEvent(), { now: () => 1 });
  assert.equal(withDefault.t_src, "h2a:dispatch");

  const withCustom = buildMemoryNote(baseEvent({ tSrc: "h2a:wake-recall" }), { now: () => 1 });
  assert.equal(withCustom.t_src, "h2a:wake-recall");
});

test("buildMemoryNote sets provenance.source to the SAME handle as event.ref", () => {
  const note = buildMemoryNote(baseEvent({ ref: "commit:deadbeef", cited: "fixed the flake" }), { now: () => 1 });
  assert.deepEqual(note.provenance, { cited: "fixed the flake", source: "commit:deadbeef" });
  assert.equal(note.provenance.source, note.event.ref);
});

test("buildMemoryNote passes principal_owner and scope through verbatim", () => {
  const note = buildMemoryNote(baseEvent({ principalOwner: "claude:h2a-memory:deadbeef12", scope: "capitalised" }), {
    now: () => 1
  });
  assert.equal(note.principal_owner, "claude:h2a-memory:deadbeef12");
  assert.equal(note.scope, "capitalised");
});

test("buildMemoryNote carries purpose + retention only when subject is human", () => {
  const humanNote = buildMemoryNote(
    baseEvent({
      subject: "human:fabien.antoine",
      taxonomy: "user",
      purpose: "wake context",
      retention: 86400000
    }),
    { now: () => 1 }
  );
  assert.equal(humanNote.purpose, "wake context");
  assert.equal(humanNote.retention, 86400000);

  const agentNote = buildMemoryNote(baseEvent({ subject: "agent-work", purpose: "should be dropped" }), {
    now: () => 1
  });
  assert.equal(
    agentNote.purpose,
    undefined,
    "an agent-work note must not carry purpose/retention even if the caller passed them"
  );
});

test("foldTaxonomyToMemoryKind maps the folded taxonomy per the build brief", () => {
  assert.equal(foldTaxonomyToMemoryKind("feedback"), "decision");
  assert.equal(foldTaxonomyToMemoryKind("user"), "context");
  assert.equal(foldTaxonomyToMemoryKind("project"), "context");
  assert.equal(foldTaxonomyToMemoryKind("measured-fact"), "evidence");
  // "reference" folds to "context" — RESOLVED (graphify SPEC_AGENT_MEMORY_SUBSTRATE
  // §3.1.1): "reference → provenance, NOT a genre." A reference (URL/dashboard/
  // ticket) is a LOCATOR, not an observed fact, so it is never `evidence`; the
  // host note is `context`, and the locator itself rides in `provenance.source`.
  assert.equal(foldTaxonomyToMemoryKind("reference"), "context");
});

test("buildMemoryNote's memory_kind follows the fold for each taxonomy member", () => {
  const cases = [
    ["reference", "context"],
    ["feedback", "decision"],
    ["user", "context"],
    ["project", "context"],
    ["measured-fact", "evidence"]
  ];
  for (const [taxonomy, expectedKind] of cases) {
    const note = buildMemoryNote(baseEvent({ taxonomy }), { now: () => 1 });
    assert.equal(note.memory_kind, expectedKind, `taxonomy ${taxonomy} should fold to ${expectedKind}`);
  }
});

test("isHumanMemorySubject discriminates agent-work from human:<id>", () => {
  assert.equal(isHumanMemorySubject("agent-work"), false);
  assert.equal(isHumanMemorySubject("human:fabien.antoine"), true);
  assert.equal(isHumanMemorySubject("human:"), false, "an empty id after the prefix is not a valid human subject");
});
