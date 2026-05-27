import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_DEFAULT_STALL_IDLE_MS,
  H2A_WORK_STATUSES,
  inferStall,
  isH2ASession
} from "../dist/index.js";

const T0 = Date.parse("2026-05-26T12:00:00.000Z");

function session(over = {}) {
  return {
    sessionId: "s1",
    instance: "claude:proj",
    startedAt: new Date(T0 - 60_000).toISOString(),
    heartbeatAt: new Date(T0).toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...over
  };
}

const stale = () => new Date(T0 - H2A_DEFAULT_STALL_IDLE_MS - 1000).toISOString();
const fresh = () => new Date(T0 - 1000).toISOString();

test("done / blocked sessions are never a drumbeat stall", () => {
  assert.equal(inferStall(session({ workStatus: "done", heartbeatAt: stale() }), { now: T0 }).stalled, false);
  // blocked is the EVO-3 feedback loop, not a silent stall
  assert.equal(inferStall(session({ workStatus: "blocked", heartbeatAt: stale() }), { now: T0 }).stalled, false);
});

test("out-of-tokens is a stall regardless of heartbeat freshness", () => {
  const r = inferStall(session({ workStatus: "out-of-tokens", heartbeatAt: fresh() }), { now: T0 });
  assert.deepEqual(r, { stalled: true, reason: "out-of-tokens" });
});

test("working + fresh heartbeat is not stalled; working + stale is", () => {
  assert.equal(inferStall(session({ workStatus: "working", heartbeatAt: fresh() }), { now: T0 }).stalled, false);
  assert.deepEqual(
    inferStall(session({ workStatus: "working", heartbeatAt: stale() }), { now: T0 }),
    { stalled: true, reason: "idle" }
  );
});

test("paused + stale heartbeat is a stall (candidate for relance)", () => {
  assert.deepEqual(
    inferStall(session({ workStatus: "paused", heartbeatAt: stale() }), { now: T0 }),
    { stalled: true, reason: "idle" }
  );
});

test("no workStatus: stale heartbeat = heuristic stall, fresh = none", () => {
  assert.deepEqual(
    inferStall(session({ heartbeatAt: stale() }), { now: T0 }),
    { stalled: true, reason: "idle-heuristic" }
  );
  assert.equal(inferStall(session({ heartbeatAt: stale() }), { now: T0, idleMs: 10 * 60_000 }).stalled, false);
  assert.equal(inferStall(session({ heartbeatAt: fresh() }), { now: T0 }).stalled, false);
});

test("closed / expired sessions are not stalls", () => {
  assert.equal(inferStall(session({ state: "closed", heartbeatAt: stale() }), { now: T0 }).stalled, false);
  assert.equal(inferStall(session({ state: "expired", heartbeatAt: stale() }), { now: T0 }).stalled, false);
});

test("unparseable heartbeat cannot infer a stall", () => {
  assert.equal(inferStall(session({ heartbeatAt: "not-a-date" }), { now: T0 }).stalled, false);
});

test("isH2ASession accepts valid workStatus + launchContext", () => {
  const s = session({
    workStatus: "working",
    launchContext: {
      cwd: "/home/u/proj",
      command: "codex",
      resumeCommand: "codex resume",
      tty: "/dev/pts/3",
      tmux: { session: "main", window: "0", pane: "%2" }
    }
  });
  assert.equal(isH2ASession(s), true);
  for (const ws of H2A_WORK_STATUSES) {
    assert.equal(isH2ASession(session({ workStatus: ws })), true);
  }
});

test("isH2ASession rejects an unknown workStatus or malformed launchContext", () => {
  assert.equal(isH2ASession(session({ workStatus: "spinning" })), false);
  assert.equal(isH2ASession(session({ launchContext: { command: "x" } })), false); // missing cwd
  assert.equal(isH2ASession(session({ launchContext: { cwd: "/x", command: "c", tmux: { session: "m" } } })), false); // tmux missing pane
});
