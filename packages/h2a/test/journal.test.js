import assert from "node:assert/strict";
import test from "node:test";

import {
  appendJournalEntry,
  computeHash,
  createJournalEntry,
  verifyJournalChain
} from "../dist/index.js";

const baseEntry = (overrides = {}) => ({
  id: "evt-001",
  type: "register",
  actor: {
    instance: "conductor:01",
    role: "CONDUCTOR",
    scope: "scope:engagement/ship-v1"
  },
  body: { capabilities: ["negotiate"] },
  createdAt: "2026-05-18T00:00:00.000Z",
  ...overrides
});

test("createJournalEntry stamps protocol/version and creates a content hash", () => {
  const entry = createJournalEntry(baseEntry());

  assert.equal(entry.protocol, "sentropic.h2a");
  assert.equal(entry.version, "0.1");
  assert.match(entry.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(entry.prevHash, undefined);
  assert.equal(entry.sequence, 0);
});

test("appendJournalEntry chains prevHash and increments sequence", () => {
  const first = createJournalEntry(baseEntry({ id: "evt-001" }));
  const second = appendJournalEntry(first, baseEntry({ id: "evt-002", type: "propose" }));

  assert.equal(second.prevHash, first.contentHash);
  assert.equal(second.sequence, 1);
  assert.notEqual(second.contentHash, first.contentHash);
});

test("appendJournalEntry produces deterministic content hash for the same payload", () => {
  const first = createJournalEntry(baseEntry({ id: "evt-001" }));
  const a = appendJournalEntry(first, baseEntry({ id: "evt-002" }));
  const b = appendJournalEntry(first, baseEntry({ id: "evt-002" }));

  assert.equal(a.contentHash, b.contentHash);
});

test("verifyJournalChain accepts a well-formed chain", () => {
  const e0 = createJournalEntry(baseEntry({ id: "evt-001" }));
  const e1 = appendJournalEntry(e0, baseEntry({ id: "evt-002", type: "propose" }));
  const e2 = appendJournalEntry(e1, baseEntry({ id: "evt-003", type: "accept" }));

  assert.deepEqual(verifyJournalChain([e0, e1, e2]), { ok: true });
});

test("verifyJournalChain rejects a broken sequence", () => {
  const e0 = createJournalEntry(baseEntry({ id: "evt-001" }));
  const e1 = appendJournalEntry(e0, baseEntry({ id: "evt-002" }));
  const tampered = { ...e1, sequence: 5 };

  const result = verifyJournalChain([e0, tampered]);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /sequence/);
});

test("verifyJournalChain rejects a broken prevHash link", () => {
  const e0 = createJournalEntry(baseEntry({ id: "evt-001" }));
  const e1 = appendJournalEntry(e0, baseEntry({ id: "evt-002" }));
  const tampered = { ...e1, prevHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };

  const result = verifyJournalChain([e0, tampered]);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /prevHash/);
});

test("verifyJournalChain rejects when contentHash does not match payload", () => {
  const e0 = createJournalEntry(baseEntry({ id: "evt-001" }));
  const tampered = { ...e0, body: { capabilities: ["mutated"] } };

  const result = verifyJournalChain([tampered]);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /contentHash/);
});

test("contentHash is independent of prevHash/sequence (they wrap the payload)", () => {
  const entry = createJournalEntry(baseEntry({ id: "evt-001" }));
  const expected = computeHash({
    body: { capabilities: ["negotiate"] },
    actor: {
      instance: "conductor:01",
      role: "CONDUCTOR",
      scope: "scope:engagement/ship-v1"
    },
    createdAt: "2026-05-18T00:00:00.000Z",
    id: "evt-001",
    type: "register"
  });

  assert.equal(entry.contentHash, expected);
});
