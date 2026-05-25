import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_DEFAULT_MAX_AGE_MS,
  checkEnvelopeFreshness,
  createEnvelope,
  createReplayGuard
} from "../dist/index.js";

const T0 = Date.parse("2026-05-25T12:00:00.000Z");

const envAt = (id, iso) =>
  createEnvelope({
    id,
    type: "propose",
    actor: { instance: "claude:proj-1", role: "AGENTS", scope: "scope:demo" },
    body: {},
    createdAt: iso
  });

test("fresh envelope passes the freshness check (DEC-074)", () => {
  const env = envAt("e1", new Date(T0).toISOString());
  assert.deepEqual(checkEnvelopeFreshness(env, { now: T0 }), { ok: true });
});

test("an expired envelope is rejected", () => {
  const env = envAt("e2", new Date(T0 - H2A_DEFAULT_MAX_AGE_MS - 1000).toISOString());
  const r = checkEnvelopeFreshness(env, { now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

test("a future-dated envelope beyond skew is rejected", () => {
  const env = envAt("e3", new Date(T0 + 120_000).toISOString());
  const r = checkEnvelopeFreshness(env, { now: T0, maxSkewMs: 60_000 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "future");
});

test("within skew, a slightly-future envelope is accepted", () => {
  const env = envAt("e4", new Date(T0 + 30_000).toISOString());
  assert.equal(checkEnvelopeFreshness(env, { now: T0, maxSkewMs: 60_000 }).ok, true);
});

test("an unparseable timestamp is rejected", () => {
  const env = envAt("e5", "not-a-date");
  const r = checkEnvelopeFreshness(env, { now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid-timestamp");
});

test("replay guard accepts once, rejects the same id again", () => {
  const guard = createReplayGuard();
  const env = envAt("dup", new Date(T0).toISOString());
  assert.equal(guard.accept(env, T0).ok, true);
  const second = guard.accept(env, T0);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "replayed");
});

test("replay guard rejects a stale envelope without recording it", () => {
  const guard = createReplayGuard();
  const stale = envAt("old", new Date(T0 - H2A_DEFAULT_MAX_AGE_MS - 1000).toISOString());
  const r = guard.accept(stale, T0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
  assert.equal(guard.size(), 0);
});

test("replay guard prunes ids that fall out of the freshness window", () => {
  const guard = createReplayGuard({ maxAgeMs: 1000 });
  guard.accept(envAt("a", new Date(T0).toISOString()), T0);
  assert.equal(guard.size(), 1);
  // a later accept past the window prunes the earlier id
  guard.accept(envAt("b", new Date(T0 + 5000).toISOString()), T0 + 5000);
  assert.equal(guard.size(), 1);
  // and "a" could now be re-accepted (it has aged out of memory) — but it is
  // also stale by the freshness check, so it would still be refused:
  assert.equal(guard.accept(envAt("a", new Date(T0).toISOString()), T0 + 5000).reason, "expired");
});

test("distinct ids within the window all pass", () => {
  const guard = createReplayGuard();
  assert.equal(guard.accept(envAt("x", new Date(T0).toISOString()), T0).ok, true);
  assert.equal(guard.accept(envAt("y", new Date(T0).toISOString()), T0).ok, true);
  assert.equal(guard.size(), 2);
});
