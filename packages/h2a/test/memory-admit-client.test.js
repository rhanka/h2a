// WP11 · Memory & context — admit client (build brief slice 4).
//
// admitMemoryNote dispatches through an INJECTED MemoryProducerPort and branches
// on the discriminated AdmissionOutcome. The port is stubbed/mocked here — this
// slice never wires to real storage. I5 (fail-closed) is the point of this file:
// an absent port, and a port that throws/rejects, both REFUSE; nothing here can
// produce a silent `admitted: true` without a port actually saying so.

import { strict as assert } from "node:assert";
import test from "node:test";

import { admitMemoryNote } from "../dist/runtime/memory/admit-client.js";

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

const CTX = { principal_owner: "claude:h2a-memory:abc123" };

function countingStubPort(admitImpl) {
  let calls = 0;
  return {
    calls: () => calls,
    port: {
      async admitMemoryNote(note, ctx) {
        calls += 1;
        return admitImpl(note, ctx);
      },
      async promoteNote() {
        throw new Error("not used in this slice");
      },
      async requestTombstone() {
        throw new Error("not used in this slice");
      }
    }
  };
}

test("admitMemoryNote branches to admitted:true when the injected port admits", async () => {
  const { port } = countingStubPort(() => ({ admitted: true, id: "note-123" }));
  const result = await admitMemoryNote(wellFormedNote(), CTX, port);
  assert.deepEqual(result.outcome, { admitted: true, id: "note-123" });
  assert.equal(result.localOnly, false);
});

test("admitMemoryNote branches to admitted:false when the injected port refuses", async () => {
  const { port } = countingStubPort(() => ({ admitted: false, reason: "quota exceeded" }));
  const result = await admitMemoryNote(wellFormedNote(), CTX, port);
  assert.deepEqual(result.outcome, { admitted: false, reason: "quota exceeded" });
  assert.equal(result.localOnly, false);
});

test("admitMemoryNote REFUSES (fail-closed, I5) when no port is injected — undefined", async () => {
  const result = await admitMemoryNote(wellFormedNote(), CTX, undefined);
  assert.equal(result.outcome.admitted, false);
  assert.match(result.outcome.reason, /fail-closed/i);
  assert.equal(result.localOnly, true);
});

test("admitMemoryNote REFUSES (fail-closed, I5) when no port is injected — null", async () => {
  const result = await admitMemoryNote(wellFormedNote(), CTX, null);
  assert.equal(result.outcome.admitted, false);
  assert.equal(result.localOnly, true);
});

test("admitMemoryNote REFUSES when the port throws (unreachable) — never a silent success", async () => {
  const { port } = countingStubPort(() => {
    throw new Error("ECONNREFUSED");
  });
  const result = await admitMemoryNote(wellFormedNote(), CTX, port);
  assert.equal(result.outcome.admitted, false);
  assert.match(result.outcome.reason, /unreachable/i);
  assert.match(result.outcome.reason, /ECONNREFUSED/);
});

test("admitMemoryNote REFUSES when the port rejects (unreachable) — never a silent success", async () => {
  const port = {
    async admitMemoryNote() {
      return Promise.reject(new Error("network timeout"));
    },
    async promoteNote() {
      throw new Error("not used");
    },
    async requestTombstone() {
      throw new Error("not used");
    }
  };
  const result = await admitMemoryNote(wellFormedNote(), CTX, port);
  assert.equal(result.outcome.admitted, false);
  assert.match(result.outcome.reason, /unreachable/i);
});

test("admitMemoryNote runs the LOCAL pre-flight before ever calling the port", async () => {
  const { port, calls } = countingStubPort(() => ({ admitted: true, id: "should-not-happen" }));
  const malformed = wellFormedNote({ subject: "not-a-valid-subject" });
  const result = await admitMemoryNote(malformed, CTX, port);
  assert.equal(result.outcome.admitted, false);
  assert.match(result.outcome.reason, /preflight/i);
  assert.equal(result.localOnly, true);
  assert.equal(calls(), 0, "a locally-rejected note must never reach the injected port");
});

test("admitMemoryNote's local pre-flight rejects the same generalization case preflight.ts rejects", async () => {
  const { port, calls } = countingStubPort(() => ({ admitted: true, id: "should-not-happen" }));
  const note = wellFormedNote();
  const { at, ...rest } = note.event;
  note.event = rest;
  const result = await admitMemoryNote(note, CTX, port);
  assert.equal(result.outcome.admitted, false);
  assert.equal(calls(), 0);
});
