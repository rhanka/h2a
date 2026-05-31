import assert from "node:assert/strict";
import test from "node:test";

import { mergeInboxDedup } from "../dist/index.js";

const env = (id, text = "") => ({
  protocol: "sentropic.h2a",
  version: "0.1",
  id,
  type: "event",
  actor: { instance: "claude:x", role: "AGENTS", scope: "scope:default" },
  body: { kind: "message", topic: "t", text },
  createdAt: "2026-05-31T00:00:00.000Z"
});

test("empty / no sets → []", () => {
  assert.deepEqual(mergeInboxDedup([]), []);
  assert.deepEqual(mergeInboxDedup([[], []]), []);
});

test("single set passes through, sorted by id", () => {
  const out = mergeInboxDedup([[env("env:b"), env("env:a"), env("env:c")]]);
  assert.deepEqual(out.map((e) => e.id), ["env:a", "env:b", "env:c"]);
});

test("dedup by id across sets — current (first) set wins on collision", () => {
  const current = [env("env:dup", "from-current"), env("env:only-current")];
  const legacy = [env("env:dup", "from-legacy"), env("env:only-legacy")];
  const out = mergeInboxDedup([current, legacy]);
  assert.deepEqual(out.map((e) => e.id), ["env:dup", "env:only-current", "env:only-legacy"]);
  // the surviving env:dup is the current-inbox copy
  assert.equal(out.find((e) => e.id === "env:dup").body.text, "from-current");
});

test("legacy-only ids are surfaced (transparent dual-read)", () => {
  const out = mergeInboxDedup([[env("env:new")], [env("env:old1"), env("env:old2")]]);
  assert.deepEqual(out.map((e) => e.id), ["env:new", "env:old1", "env:old2"]);
});

test("entries without a string id are skipped, never throw", () => {
  const out = mergeInboxDedup([[env("env:ok"), { id: 42 }, null, {}]]);
  assert.deepEqual(out.map((e) => e.id), ["env:ok"]);
});
