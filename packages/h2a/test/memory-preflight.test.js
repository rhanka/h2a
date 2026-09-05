// WP11 · Memory & context — local pre-flight (build brief slice 3).
//
// preflightMemoryNote must REJECT: a bad subject; a missing/non-numeric
// event.at (the structural marker of a generalization — it has no instant);
// a human subject without a retention bound. And it must ACCEPT a well-formed
// note. This is a thin wrapper over the vendored validateMemoryNoteShape, so
// these tests also pin that the wrapper does not silently narrow or widen it.

import { strict as assert } from "node:assert";
import test from "node:test";

import { preflightMemoryNote } from "../dist/runtime/memory/preflight.js";

function wellFormedNote(overrides = {}) {
  return {
    node_type: "MemoryNote",
    memory_kind: "evidence",
    subject: "agent-work",
    t: 1000,
    t_src: "h2a:dispatch",
    event: { at: 999, kind: "tool-call", ref: "toolresult:abc" },
    provenance: { cited: "abc", source: "toolresult:abc" },
    principal_owner: "claude:h2a-memory:abc123",
    scope: "private",
    ...overrides
  };
}

test("preflightMemoryNote accepts a well-formed agent-work note", () => {
  assert.deepEqual(preflightMemoryNote(wellFormedNote()), { ok: true });
});

test("preflightMemoryNote REJECTS a bad subject", () => {
  const result = preflightMemoryNote(wellFormedNote({ subject: "the-user" }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /subject/i);
});

test("preflightMemoryNote REJECTS a missing event.at (a generalization has no instant)", () => {
  const note = wellFormedNote();
  const { at, ...rest } = note.event;
  note.event = rest;
  const result = preflightMemoryNote(note);
  assert.equal(result.ok, false);
  assert.match(result.reason, /event\.at/);
});

test("preflightMemoryNote REJECTS a non-numeric event.at", () => {
  const note = wellFormedNote();
  note.event = { ...note.event, at: "yesterday" };
  const result = preflightMemoryNote(note);
  assert.equal(result.ok, false);
  assert.match(result.reason, /event\.at/);
});

test("preflightMemoryNote REJECTS a human subject with no retention bound", () => {
  const note = wellFormedNote({ subject: "human:fabien.antoine", purpose: "wake context" });
  const result = preflightMemoryNote(note);
  assert.equal(result.ok, false);
  assert.match(result.reason, /retention/);
});

test("preflightMemoryNote REJECTS a human subject with no purpose", () => {
  const note = wellFormedNote({ subject: "human:fabien.antoine", retention: 86400000 });
  const result = preflightMemoryNote(note);
  assert.equal(result.ok, false);
  assert.match(result.reason, /purpose/);
});

test("preflightMemoryNote ACCEPTS a human subject carrying both purpose and retention", () => {
  const note = wellFormedNote({
    subject: "human:fabien.antoine",
    purpose: "wake context",
    retention: 86400000
  });
  assert.deepEqual(preflightMemoryNote(note), { ok: true });
});
