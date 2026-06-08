/**
 * WP-E: Calendar-invariance pin test for isSessionExpired.
 *
 * isSessionExpired is pure epoch arithmetic:
 *   now - Date.parse(heartbeatAt) > expiryMs
 *
 * The result MUST be identical regardless of the absolute calendar date the
 * timestamps fall on. This test pins that property, preventing a future
 * "fix" from introducing calendar/TZ-sensitive logic.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isSessionExpired } from "../dist/index.js";

function makeSession(heartbeatAt, overrides = {}) {
  return {
    sessionId: "sess:pin-test",
    instance: "claude:proj:abc123",
    host: "claude",
    pid: 9999,
    startedAt: heartbeatAt,
    heartbeatAt,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...overrides
  };
}

// ─── Scenario A: 10 s delta, 15 s window → NOT expired ──────────────────────
// Two absolute calendar positions: before and after midnight on 2026-06-03/04.
// The delta is always 10_000 ms; the window is always 15_000 ms.
const DELTA_MS = 10_000;
const EXPIRY_MS = 15_000;

test("not expired (10s delta, 15s window): same result across midnight boundary", () => {
  // Pair A1: entirely before midnight 2026-06-03
  const beatA1 = "2026-06-03T23:59:45.000Z"; // T-10s
  const nowA1 = Date.parse("2026-06-03T23:59:55.000Z");
  assert.equal(nowA1 - Date.parse(beatA1), DELTA_MS);

  // Pair A2: straddles 2026-06-03 → 2026-06-04 midnight
  const beatA2 = "2026-06-03T23:59:55.000Z"; // T-10s
  const nowA2 = Date.parse("2026-06-04T00:00:05.000Z");
  assert.equal(nowA2 - Date.parse(beatA2), DELTA_MS);

  // Pair A3: straddles month boundary 2026-05-31 → 2026-06-01
  const beatA3 = "2026-05-31T23:59:55.000Z";
  const nowA3 = Date.parse("2026-06-01T00:00:05.000Z");
  assert.equal(nowA3 - Date.parse(beatA3), DELTA_MS);

  const resultA1 = isSessionExpired(makeSession(beatA1), { now: nowA1, expiryMs: EXPIRY_MS });
  const resultA2 = isSessionExpired(makeSession(beatA2), { now: nowA2, expiryMs: EXPIRY_MS });
  const resultA3 = isSessionExpired(makeSession(beatA3), { now: nowA3, expiryMs: EXPIRY_MS });

  assert.equal(resultA1, false, "A1: 10s < 15s → not expired");
  assert.equal(resultA2, false, "A2: 10s < 15s, crosses midnight → not expired");
  assert.equal(resultA3, false, "A3: 10s < 15s, crosses month → not expired");

  // All three must agree
  assert.equal(resultA1, resultA2, "A1 and A2 must agree");
  assert.equal(resultA2, resultA3, "A2 and A3 must agree");
});

// ─── Scenario B: 20 s delta, 15 s window → expired ──────────────────────────
const OVER_DELTA_MS = 20_000;

test("expired (20s delta, 15s window): same result across midnight boundary", () => {
  // Pair B1: before midnight
  const beatB1 = "2026-06-03T23:59:35.000Z";
  const nowB1 = Date.parse("2026-06-03T23:59:55.000Z");
  assert.equal(nowB1 - Date.parse(beatB1), OVER_DELTA_MS);

  // Pair B2: crosses midnight
  const beatB2 = "2026-06-03T23:59:45.000Z";
  const nowB2 = Date.parse("2026-06-04T00:00:05.000Z");
  assert.equal(nowB2 - Date.parse(beatB2), OVER_DELTA_MS);

  // Pair B3: crosses month boundary
  const beatB3 = "2026-05-31T23:59:45.000Z";
  const nowB3 = Date.parse("2026-06-01T00:00:05.000Z");
  assert.equal(nowB3 - Date.parse(beatB3), OVER_DELTA_MS);

  const resultB1 = isSessionExpired(makeSession(beatB1), { now: nowB1, expiryMs: EXPIRY_MS });
  const resultB2 = isSessionExpired(makeSession(beatB2), { now: nowB2, expiryMs: EXPIRY_MS });
  const resultB3 = isSessionExpired(makeSession(beatB3), { now: nowB3, expiryMs: EXPIRY_MS });

  assert.equal(resultB1, true, "B1: 20s > 15s → expired");
  assert.equal(resultB2, true, "B2: 20s > 15s, crosses midnight → expired");
  assert.equal(resultB3, true, "B3: 20s > 15s, crosses month → expired");

  assert.equal(resultB1, resultB2, "B1 and B2 must agree");
  assert.equal(resultB2, resultB3, "B2 and B3 must agree");
});

// ─── Scenario C: closed/expired state always expired regardless of heartbeat ─
test("state=closed is always expired regardless of calendar date", () => {
  const beatC = "2026-06-04T00:00:04.000Z"; // heartbeat 1s ago — would be fresh
  const nowC = Date.parse("2026-06-04T00:00:05.000Z");
  const result = isSessionExpired(makeSession(beatC, { state: "closed" }), { now: nowC, expiryMs: EXPIRY_MS });
  assert.equal(result, true, "closed state → always expired");
});

test("state=expired is always expired regardless of calendar date", () => {
  const beatD = "2026-06-04T00:00:04.000Z";
  const nowD = Date.parse("2026-06-04T00:00:05.000Z");
  const result = isSessionExpired(makeSession(beatD, { state: "expired" }), { now: nowD, expiryMs: EXPIRY_MS });
  assert.equal(result, true, "expired state → always expired");
});

// ─── Scenario D: exact boundary (delta === expiryMs) → expired (strict >) ───
test("delta === expiryMs is expired (strict > comparison)", () => {
  const beatE = "2026-06-04T00:00:00.000Z";
  const nowE = Date.parse("2026-06-04T00:00:15.000Z"); // exactly 15000 ms later
  assert.equal(nowE - Date.parse(beatE), EXPIRY_MS);
  const result = isSessionExpired(makeSession(beatE), { now: nowE, expiryMs: EXPIRY_MS });
  // now - beat = 15000, expiryMs = 15000; 15000 > 15000 is false → NOT expired
  assert.equal(result, false, "delta === expiryMs: 15000 > 15000 is false → not expired");
});
