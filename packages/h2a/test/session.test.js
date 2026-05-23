import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_SESSION_DEFAULT_EXPIRY_MS,
  H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
  H2A_SESSION_NOTIFICATION_TOPICS,
  H2A_SESSION_STATES,
  isH2ASession,
  isSessionExpired,
  pickFreshSessions
} from "../dist/index.js";

function liveSession(overrides = {}) {
  return {
    sessionId: "sess:abc",
    instance: "claude:proj-1",
    host: "claude",
    pid: 4242,
    startedAt: "2026-05-23T12:00:00.000Z",
    heartbeatAt: "2026-05-23T12:00:00.000Z",
    state: "live",
    interests: { scopes: ["team:devops"], negotiations: [] },
    subscribedTopics: ["presence.peer_joined", "inbox.envelope_arrived"],
    ...overrides
  };
}

test("session protocol constants are stable", () => {
  assert.deepEqual([...H2A_SESSION_STATES].sort(), [
    "closed",
    "draining",
    "expired",
    "live",
    "opening"
  ]);
  assert.deepEqual([...H2A_SESSION_NOTIFICATION_TOPICS].sort(), [
    "inbox.envelope_arrived",
    "negotiation.event_appended",
    "presence.peer_joined",
    "presence.peer_left"
  ]);
  assert.equal(H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS, 5000);
  assert.equal(H2A_SESSION_DEFAULT_EXPIRY_MS, 15000);
  assert.ok(
    H2A_SESSION_DEFAULT_EXPIRY_MS > H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
    "expiry must outlast a single missed heartbeat"
  );
});

test("isH2ASession accepts a well-formed session and rejects shape drift", () => {
  assert.equal(isH2ASession(liveSession()), true);
  assert.equal(isH2ASession(null), false);
  assert.equal(isH2ASession({}), false);
  assert.equal(
    isH2ASession(liveSession({ state: "ghost" })),
    false,
    "unknown state is rejected"
  );
  assert.equal(
    isH2ASession(liveSession({ subscribedTopics: ["chat.message"] })),
    false,
    "unknown topic is rejected"
  );
  assert.equal(
    isH2ASession(liveSession({ interests: { scopes: ["x"] } })),
    false,
    "interests must include both scopes and negotiations"
  );
  assert.equal(isH2ASession(liveSession({ pid: "4242" })), false);
});

test("isSessionExpired flags closed/expired states immediately", () => {
  const now = Date.parse("2026-05-23T12:00:10.000Z");
  assert.equal(isSessionExpired(liveSession({ state: "closed" }), { now }), true);
  assert.equal(isSessionExpired(liveSession({ state: "expired" }), { now }), true);
});

test("isSessionExpired honors heartbeat freshness vs expiryMs", () => {
  const start = Date.parse("2026-05-23T12:00:00.000Z");
  // 10s after start → still fresh under default 15s expiry
  assert.equal(
    isSessionExpired(liveSession(), { now: start + 10_000 }),
    false
  );
  // 16s after start → expired under default 15s expiry
  assert.equal(
    isSessionExpired(liveSession(), { now: start + 16_000 }),
    true
  );
  // Custom expiryMs override
  assert.equal(
    isSessionExpired(liveSession(), { now: start + 30_000, expiryMs: 60_000 }),
    false
  );
  // Invalid heartbeat treated as expired
  assert.equal(
    isSessionExpired(liveSession({ heartbeatAt: "not-a-date" }), { now: start }),
    true
  );
});

test("pickFreshSessions returns only live attachments under the expiry window", () => {
  const start = Date.parse("2026-05-23T12:00:00.000Z");
  const sessions = [
    liveSession({
      sessionId: "fresh",
      heartbeatAt: "2026-05-23T12:00:14.000Z"
    }),
    liveSession({
      sessionId: "stale",
      heartbeatAt: "2026-05-23T11:59:30.000Z"
    }),
    liveSession({ sessionId: "closed", state: "closed" }),
    liveSession({
      sessionId: "draining",
      state: "draining",
      heartbeatAt: "2026-05-23T12:00:13.500Z"
    })
  ];
  const fresh = pickFreshSessions(sessions, { now: start + 15_000 });
  const ids = fresh.map((s) => s.sessionId).sort();
  assert.deepEqual(ids, ["draining", "fresh"]);
});
