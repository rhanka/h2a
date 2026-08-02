// WP11 · Memory & context — recall client, read-side / wake-recall (build brief slice 5).
//
// recallMemory dispatches through an INJECTED MemoryRecallPort and returns the
// notes for the wake path. The port is stubbed here — this slice never wires to
// real storage/graphify and is not wired into the actual wake/CLI path. I5
// (fail-closed) is the point of half these tests: an absent port, a port that
// throws/rejects, and a port that violates the notes-only projection all
// REFUSE — nothing here can produce a silent `notes: []` a caller could
// mistake for "no memories exist". The other half pins the projection
// prohibition at the consumer boundary: notes-only stays a flat list, and the
// one grouping helper this module offers cannot be used to assemble a
// human-subject profile.

import { strict as assert } from "node:assert";
import test from "node:test";

import { groupAgentWorkNotesBySubject, recallMemory } from "../dist/runtime/memory/recall-client.js";

const CTX = { principal_owner: "claude:h2a-memory:abc123" };
const QUERY = { asOf: 5000 };

function note(overrides = {}) {
  return {
    id: "note-1",
    node_type: "MemoryNote",
    memory_kind: "context",
    subject: "agent-work",
    t: 4000,
    trust: "asserted",
    review_status: "pending",
    scope: "private",
    principal_owner: "claude:h2a-memory:abc123",
    provenance: { cited: "abc", source: "toolresult:abc" },
    event: { at: 3999, kind: "tool-call", ref: "toolresult:abc" },
    ...overrides
  };
}

function resultView(overrides = {}) {
  return {
    schema: "MemoryRecallResultView@1",
    notes: [note()],
    projection: "notes-only",
    requestingPrincipal: CTX.principal_owner,
    freshness: "unverified",
    unpaged: true,
    ...overrides
  };
}

function stubPort(recallImpl) {
  let calls = 0;
  return {
    calls: () => calls,
    port: {
      async recallMemory(query, ctx) {
        calls += 1;
        return recallImpl(query, ctx);
      }
    }
  };
}

test("recallMemory returns the notes as a flat list when the injected port succeeds", async () => {
  const n = note();
  const { port } = stubPort(() => resultView({ notes: [n] }));
  const result = await recallMemory(QUERY, CTX, port);
  assert.equal(result.refused, false);
  assert.deepEqual(result.notes, [n]);
});

test("recallMemory surfaces freshness, projection, requestingPrincipal and unpaged to the caller", async () => {
  const { port } = stubPort(() => resultView());
  const result = await recallMemory(QUERY, CTX, port);
  assert.equal(result.refused, false);
  assert.equal(result.freshness, "unverified");
  assert.equal(result.projection, "notes-only");
  assert.equal(result.requestingPrincipal, CTX.principal_owner);
  assert.equal(result.unpaged, true);
});

test("recallMemory surfaces per-note trust/review_status/provenance verbatim — never dropped", async () => {
  const n = note({ trust: "signed", review_status: "promoted", provenance: { cited: "x", source: "commit:abc" } });
  const { port } = stubPort(() => resultView({ notes: [n] }));
  const result = await recallMemory(QUERY, CTX, port);
  assert.equal(result.refused, false);
  assert.equal(result.notes[0].trust, "signed");
  assert.equal(result.notes[0].review_status, "promoted");
  assert.deepEqual(result.notes[0].provenance, { cited: "x", source: "commit:abc" });
});

test("recallMemory REFUSES (fail-closed, I5) when no port is injected — undefined", async () => {
  const result = await recallMemory(QUERY, CTX, undefined);
  assert.equal(result.refused, true);
  assert.match(result.reason, /fail-closed/i);
  assert.deepEqual(result.notes, []);
});

test("recallMemory REFUSES (fail-closed, I5) when no port is injected — null", async () => {
  const result = await recallMemory(QUERY, CTX, null);
  assert.equal(result.refused, true);
  assert.deepEqual(result.notes, []);
});

test("recallMemory REFUSES when the port throws (unreachable) — never a silent empty", async () => {
  const { port } = stubPort(() => {
    throw new Error("ECONNREFUSED");
  });
  const result = await recallMemory(QUERY, CTX, port);
  assert.equal(result.refused, true);
  assert.match(result.reason, /unreachable/i);
  assert.match(result.reason, /ECONNREFUSED/);
  assert.deepEqual(result.notes, []);
});

test("recallMemory REFUSES when the port rejects (unreachable) — never a silent empty", async () => {
  const port = {
    async recallMemory() {
      return Promise.reject(new Error("network timeout"));
    }
  };
  const result = await recallMemory(QUERY, CTX, port);
  assert.equal(result.refused, true);
  assert.match(result.reason, /unreachable/i);
  assert.deepEqual(result.notes, []);
});

test("recallMemory REFUSES when the port returns a projection other than notes-only", async () => {
  const { port } = stubPort(() => resultView({ projection: "profile-summary" }));
  const result = await recallMemory(QUERY, CTX, port);
  assert.equal(result.refused, true);
  assert.match(result.reason, /projection/i);
  assert.deepEqual(result.notes, []);
});

test("a refusal is a DISTINCT shape from a genuine empty recall — never confusable", async () => {
  const { port: emptyPort } = stubPort(() => resultView({ notes: [] }));
  const genuinelyEmpty = await recallMemory(QUERY, CTX, emptyPort);
  assert.equal(genuinelyEmpty.refused, false);
  assert.deepEqual(genuinelyEmpty.notes, []);

  const refused = await recallMemory(QUERY, CTX, undefined);
  assert.equal(refused.refused, true);
  assert.deepEqual(refused.notes, []);

  // Both carry an empty notes array, but only `refused` distinguishes "no
  // memories" from "could not ask" — a caller must branch on `refused`, not
  // on notes.length, to tell them apart.
  assert.notEqual(genuinelyEmpty.refused, refused.refused);
});

test("recallMemory calls the injected port exactly once with the query and ctx", async () => {
  const { port, calls } = stubPort((query, ctx) => {
    assert.deepEqual(query, QUERY);
    assert.deepEqual(ctx, CTX);
    return resultView();
  });
  await recallMemory(QUERY, CTX, port);
  assert.equal(calls(), 1);
});

// --- No-profile-aggregation guard -----------------------------------------

test("groupAgentWorkNotesBySubject groups agent-work notes by subject", () => {
  const a = note({ id: "a", subject: "agent-work" });
  const b = note({ id: "b", subject: "agent-work" });
  const result = groupAgentWorkNotesBySubject([a, b]);
  assert.deepEqual(result.grouped, { "agent-work": [a, b] });
  assert.equal(result.excludedHumanSubjectCount, 0);
});

test("groupAgentWorkNotesBySubject EXCLUDES human-subject notes from the grouping — never assembles a profile", () => {
  const agentNote = note({ id: "a", subject: "agent-work" });
  const humanNote = note({ id: "h", subject: "human:fabien.antoine" });
  const result = groupAgentWorkNotesBySubject([agentNote, humanNote]);
  assert.deepEqual(result.grouped, { "agent-work": [agentNote] });
  assert.equal(result.excludedHumanSubjectCount, 1);
  // The human-subject note must not appear ANYWHERE in the grouped output,
  // under its own key or folded into another — it is excluded, not hidden.
  assert.deepEqual(Object.keys(result.grouped), ["agent-work"]);
  for (const bucket of Object.values(result.grouped)) {
    assert.ok(!bucket.includes(humanNote));
  }
});

test("groupAgentWorkNotesBySubject with only human-subject notes yields an empty grouping, fully counted", () => {
  const h1 = note({ id: "h1", subject: "human:fabien.antoine" });
  const h2 = note({ id: "h2", subject: "human:someone.else" });
  const result = groupAgentWorkNotesBySubject([h1, h2]);
  assert.deepEqual(result.grouped, {});
  assert.equal(result.excludedHumanSubjectCount, 2);
});
