import assert from "node:assert/strict";
import test from "node:test";

import { decideInboxWake, formatWakeLine } from "../dist/index.js";

const NOW = "2026-06-03T10:00:00.000Z";

function env(id, from, topic) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: from, role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", topic, text: "hi" },
    createdAt: NOW
  };
}

test("decideInboxWake: nothing unseen → null", () => {
  const inbox = [env("e1", "codex:x:1", "t")];
  assert.equal(decideInboxWake({ seen: ["e1"], inbox, nowIso: NOW }), null);
});

test("decideInboxWake: one fresh → fresh + tagged wake + updated seen", () => {
  const inbox = [env("e1", "codex:proj:1", "RELANCE")];
  const d = decideInboxWake({ seen: [], inbox, nowIso: NOW });
  assert.ok(d);
  assert.deepEqual(d.fresh.map((e) => e.id), ["e1"]);
  assert.match(d.wake, /^\[h2a-wake reason=inbox from=codex:proj:1 topic=RELANCE at=2026-06-03T10:00:00\.000Z\]/);
  assert.match(d.wake, /1 new inbox envelope; run \/h2a receive/);
  assert.deepEqual(d.seen, ["e1"]);
});

test("decideInboxWake: multiple fresh → count summary, dedups already-seen", () => {
  const inbox = [env("e1", "a:1:1", "x"), env("e2", "b:2:2", "y"), env("e3", "c:3:3", "z")];
  const d = decideInboxWake({ seen: ["e1"], inbox, nowIso: NOW });
  assert.ok(d);
  assert.deepEqual(d.fresh.map((e) => e.id), ["e2", "e3"]);
  assert.match(d.wake, /reason=inbox count=2/);
  assert.match(d.wake, /2 new inbox envelopes/);
  assert.deepEqual(d.seen, ["e1", "e2", "e3"]);
});

test("formatWakeLine: topic whitespace is normalized to underscores", () => {
  const line = formatWakeLine([env("e1", "claude:p:1", "EVO 1 self drive")], NOW);
  assert.match(line, /topic=EVO_1_self_drive/);
});
