// h2a → sentropic session-exposure feed — descriptor builders (P1, step 1).
//
// Contract under test (ratified 2026-07-24):
//   docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md
//
// The load-bearing properties, and why each one is pinned:
//  1. state/liveness sit on h2a's EXISTING primitives — the 90s keepalive
//     window (H2A_SESSION_DEFAULT_EXPIRY_MS) and WP-F connection confidence.
//     Both boundaries are pinned so a future refactor cannot silently widen
//     "live".
//  2. `stale` is a PIPELINE-freshness signal, never an agent state: a mirrored
//     row whose push daemon went quiet > 2x its interval is stale; a directly
//     observed local row (no mirroredAt) is NEVER stale, whatever the interval.
//  3. `activitySource` discriminates proven MCP traffic from a bare heartbeat
//     fallback (ratification condition #2) — a consumer must never be able to
//     read "process alive" as "proven channel activity" by omission.
//  4. NO FILESYSTEM PATH may reach a descriptor (opacity boundary): only
//     `workspace.label`, never `workspace.path` / `launchContext.cwd`.
//  5. counterpartsOpaqueRefs === [] for P1 (Gaps §2 — negotiations unmirrored).
//  6. The builders are PURE: `asOf` is injected, so two calls agree exactly.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedResponse,
  buildInstanceDescriptor,
  buildInstanceDescriptors,
  buildSessionDescriptor,
  buildSessionDescriptors,
  deriveLiveness,
  deriveSessionState,
  rollUpLiveness
} from "../dist/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-07-24T12:00:00.000Z");
const EXPIRY_MS = 90_000; // H2A_SESSION_DEFAULT_EXPIRY_MS
const ACTIVITY_WINDOW_MS = 600_000; // H2A_ACTIVITY_WINDOW_DEFAULT_MS
const INSTANCE = "claude:a2a-cli:0123456789ab";

function iso(ms) {
  return new Date(ms).toISOString();
}

function session(overrides = {}) {
  return {
    sessionId: "sess-1",
    instance: INSTANCE,
    host: "claude",
    startedAt: iso(NOW - 3_600_000),
    heartbeatAt: iso(NOW - 5_000),
    state: "open",
    interests: { scopes: [], topics: [] },
    subscribedTopics: [],
    ...overrides
  };
}

function registration(overrides = {}) {
  return {
    id: INSTANCE,
    instance: INSTANCE,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: iso(NOW - 86_400_000),
    ...overrides
  };
}

// ─── 1. deriveSessionState — the 90s and 10min boundaries ─────────────────

test("deriveSessionState: fresh heartbeat + recent MCP traffic reads open", () => {
  const s = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - 1_000)
  });
  assert.equal(deriveSessionState(s, NOW), "open");
});

test("deriveSessionState: fresh heartbeat but idle-uncertain channel reads idle", () => {
  // Heartbeat inside 90s, MCP silent past the 10-minute activity window: the
  // process lives but the channel proved nothing — honest answer is idle.
  const s = session({
    heartbeatAt: iso(NOW - 10_000),
    lastMcpActivityAt: iso(NOW - (ACTIVITY_WINDOW_MS + 1_000))
  });
  assert.equal(deriveSessionState(s, NOW), "idle");
});

test("deriveSessionState: fresh heartbeat with no MCP stamp at all reads idle", () => {
  // confidence "unknown" (legacy/mirrored record) must never read as open.
  const s = session({ heartbeatAt: iso(NOW - 10_000) });
  assert.equal(deriveSessionState(s, NOW), "idle");
});

test("deriveSessionState: heartbeat older than the 90s window reads closed", () => {
  const s = session({
    heartbeatAt: iso(NOW - (EXPIRY_MS + 1_000)),
    lastMcpActivityAt: iso(NOW - 1_000) // fresh MCP stamp must NOT rescue it
  });
  assert.equal(deriveSessionState(s, NOW), "closed");
});

test("deriveSessionState: heartbeat just inside the 90s window is not closed", () => {
  const s = session({ heartbeatAt: iso(NOW - (EXPIRY_MS - 1_000)) });
  assert.equal(deriveSessionState(s, NOW), "idle");
});

test("deriveSessionState: closed and expired session states read closed", () => {
  for (const state of ["closed", "expired"]) {
    const s = session({ state, heartbeatAt: iso(NOW - 1_000), lastMcpActivityAt: iso(NOW) });
    assert.equal(deriveSessionState(s, NOW), "closed", `state=${state}`);
  }
});

// ─── 2. deriveLiveness — incl. the pipeline-freshness `stale` rule ─────────

test("deriveLiveness: active channel reads live, idle-uncertain reads idle", () => {
  const live = session({ heartbeatAt: iso(NOW - 1_000), lastMcpActivityAt: iso(NOW - 1_000) });
  assert.equal(deriveLiveness(live, NOW), "live");

  const idle = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - (ACTIVITY_WINDOW_MS + 1_000))
  });
  assert.equal(deriveLiveness(idle, NOW), "idle");
});

test("deriveLiveness: expired heartbeat reads closed", () => {
  const s = session({ heartbeatAt: iso(NOW - (EXPIRY_MS + 1)) });
  assert.equal(deriveLiveness(s, NOW), "closed");
});

test("deriveLiveness: mirrored row with a quiet pipeline reads stale", () => {
  // The record's own timestamps look perfectly fresh — but the daemon that is
  // supposed to keep refreshing them has been quiet for > 2x its interval, so
  // the honest label is "we don't know", not "live".
  const pushIntervalMs = 30_000;
  const s = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - 1_000),
    mirroredAt: iso(NOW - (2 * pushIntervalMs + 1_000))
  });
  assert.equal(deriveLiveness(s, NOW, pushIntervalMs), "stale");
});

test("deriveLiveness: mirrored row with a healthy pipeline is not stale", () => {
  const pushIntervalMs = 30_000;
  const s = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - 1_000),
    mirroredAt: iso(NOW - pushIntervalMs)
  });
  assert.equal(deriveLiveness(s, NOW, pushIntervalMs), "live");
});

test("deriveLiveness: a local row (no mirroredAt) is NEVER stale", () => {
  // Same-machine clock is trustworthy: absence of mirroredAt means directly
  // observed, so the pipeline check must be skipped entirely even when a push
  // interval is supplied.
  const s = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - (ACTIVITY_WINDOW_MS + 1_000))
  });
  assert.equal(deriveLiveness(s, NOW, 1), "idle");
  assert.notEqual(deriveLiveness(s, NOW, 1), "stale");
});

test("deriveLiveness: a mirrored row with no push interval known is not stale", () => {
  // Staleness is only computable against a declared interval; without one we
  // must not invent a threshold.
  const s = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - 1_000),
    mirroredAt: iso(NOW - 86_400_000)
  });
  assert.equal(deriveLiveness(s, NOW), "live");
});

test("deriveLiveness: a closed mirrored row reads closed, not stale", () => {
  const s = session({ state: "closed", mirroredAt: iso(NOW - 86_400_000) });
  assert.equal(deriveLiveness(s, NOW, 30_000), "closed");
});

test("rollUpLiveness: best-of is live > idle > stale > closed, empty is closed", () => {
  assert.equal(rollUpLiveness(["closed", "stale", "idle", "live"]), "live");
  assert.equal(rollUpLiveness(["closed", "stale", "idle"]), "idle");
  assert.equal(rollUpLiveness(["closed", "stale"]), "stale");
  assert.equal(rollUpLiveness(["closed"]), "closed");
  assert.equal(rollUpLiveness([]), "closed");
});

// ─── 3. activitySource discrimination (ratification condition #2) ──────────

test("buildSessionDescriptor: proven MCP traffic yields activitySource mcp", () => {
  const mcpAt = iso(NOW - 2_000);
  const d = buildSessionDescriptor(session({ lastMcpActivityAt: mcpAt }), { asOf: NOW });
  assert.equal(d.activitySource, "mcp");
  assert.equal(d.lastActivityAt, mcpAt);
});

test("buildSessionDescriptor: no MCP stamp falls back to heartbeat, labelled", () => {
  const beat = iso(NOW - 5_000);
  const d = buildSessionDescriptor(session({ heartbeatAt: beat }), { asOf: NOW });
  assert.equal(d.activitySource, "heartbeat");
  assert.equal(d.lastActivityAt, beat);
});

test("buildSessionDescriptor: an unparseable MCP stamp falls back to heartbeat", () => {
  const beat = iso(NOW - 5_000);
  const d = buildSessionDescriptor(
    session({ heartbeatAt: beat, lastMcpActivityAt: "not-a-date" }),
    { asOf: NOW }
  );
  assert.equal(d.activitySource, "heartbeat");
  assert.equal(d.lastActivityAt, beat);
});

// ─── 4. counterpartsOpaqueRefs is [] for P1 ───────────────────────────────

test("buildSessionDescriptor: counterpartsOpaqueRefs is empty for P1", () => {
  const d = buildSessionDescriptor(session(), { asOf: NOW });
  assert.deepEqual(d.counterpartsOpaqueRefs, []);
  assert.equal(d.counterpartsOpaqueRefs.length, 0);
});

// ─── 5. Opacity boundary: no filesystem path may reach a descriptor ────────

const SECRET_PATH = "/home/owner/private-clients/acme-merger-duediligence";

test("workspaceLabel uses workspace.label and never leaks workspace.path", () => {
  const s = session({
    workspace: {
      id: "ws:11111111-1111-1111-1111-111111111111",
      path: SECRET_PATH,
      host: "claude",
      label: "acme-merger-duediligence-label"
    },
    launchContext: { cwd: SECRET_PATH, command: "claude --resume" },
    name: "review pass"
  });
  const feed = buildFeedResponse({ asOf: NOW, sessions: [s], registrations: [registration()] });

  assert.equal(feed.instances[0].workspaceLabel, "acme-merger-duediligence-label");
  const serialized = JSON.stringify(feed);
  assert.ok(!serialized.includes(SECRET_PATH), "descriptor leaked the workspace path");
  assert.ok(!serialized.includes("/home/"), "descriptor leaked a filesystem path");
  assert.ok(!serialized.includes("private-clients"), "descriptor leaked a path segment");
});

test("workspaceLabel falls back to the registration workspace label, still no path", () => {
  const s = session({ workspace: undefined });
  const reg = registration({
    workspace: {
      id: "ws:22222222-2222-2222-2222-222222222222",
      path: SECRET_PATH,
      host: "claude",
      label: "registered-label"
    }
  });
  const feed = buildFeedResponse({ asOf: NOW, sessions: [s], registrations: [reg] });
  assert.equal(feed.instances[0].workspaceLabel, "registered-label");
  assert.ok(!JSON.stringify(feed).includes(SECRET_PATH));
});

test("no descriptor field carries a key, token or message body", () => {
  // Only the contract's declared fields may exist — an additive leak (someone
  // spreading the raw presence record into the descriptor) fails here.
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session({ pid: 4242, workStatus: "working" })],
    registrations: [registration({ publicKeys: ["-----BEGIN PUBLIC KEY-----"] })]
  });
  assert.deepEqual(Object.keys(feed).sort(), ["asOf", "instances", "sessions"]);
  assert.deepEqual(Object.keys(feed.instances[0]).sort(), [
    "capabilities",
    "displayName",
    "host",
    "instanceId",
    "lastSeen",
    "liveness",
    "role",
    "workspaceLabel"
  ]);
  assert.deepEqual(Object.keys(feed.sessions[0]).sort(), [
    "activitySource",
    "counterpartsOpaqueRefs",
    "instanceId",
    "lastActivityAt",
    "openedAt",
    "sessionId",
    "state",
    "topicOrTitle"
  ]);
  const serialized = JSON.stringify(feed);
  assert.ok(!serialized.includes("BEGIN PUBLIC KEY"));
  assert.ok(!serialized.includes("4242"));
});

// ─── 6. Field mapping: names, role, capabilities, lastSeen ────────────────

test("displayName prefers the registration name over any session name", () => {
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [session({ name: "session title" })],
    registration: registration({ name: "registered agent" })
  });
  assert.equal(d.displayName, "registered agent");
});

test("displayName falls back to the most recent LIVE session name", () => {
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [
      session({ sessionId: "old", heartbeatAt: iso(NOW - 60_000), name: "older live name" }),
      session({ sessionId: "new", heartbeatAt: iso(NOW - 1_000), name: "newest live name" })
    ],
    registration: registration()
  });
  assert.equal(d.displayName, "newest live name");
});

test("displayName ignores a closed session's name and falls back to the label", () => {
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [
      session({
        sessionId: "dead",
        state: "closed",
        name: "stale ghost name",
        workspace: { id: "ws:3", path: SECRET_PATH, host: "claude", label: "the-label" }
      })
    ],
    registration: registration()
  });
  assert.equal(d.displayName, "the-label");
});

test("topicOrTitle uses the session name and may diverge from displayName", () => {
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session({ name: "per-session title" })],
    registrations: [registration({ name: "instance name" })]
  });
  assert.equal(feed.instances[0].displayName, "instance name");
  assert.equal(feed.sessions[0].topicOrTitle, "per-session title");
});

test("role comes from registration.roles[0]; capabilities pass through verbatim", () => {
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [session()],
    registration: registration({
      roles: ["CONDUCTOR", "AGENTS"],
      capabilities: ["h2a.session", "h2a.mcp"]
    })
  });
  assert.equal(d.role, "CONDUCTOR");
  assert.deepEqual(d.capabilities, ["h2a.session", "h2a.mcp"]);
});

test("lastSeen is the max heartbeat across the instance's sessions", () => {
  const newest = iso(NOW - 1_000);
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [
      session({ sessionId: "a", heartbeatAt: iso(NOW - 40_000) }),
      session({ sessionId: "b", heartbeatAt: newest }),
      session({ sessionId: "c", heartbeatAt: iso(NOW - 20_000) })
    ],
    registration: registration()
  });
  assert.equal(d.lastSeen, newest);
});

test("instance liveness is the best-of across its own sessions", () => {
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [
      session({ sessionId: "quiet", heartbeatAt: iso(NOW - 10_000) }), // idle
      session({
        sessionId: "busy",
        heartbeatAt: iso(NOW - 1_000),
        lastMcpActivityAt: iso(NOW - 1_000)
      }) // live
    ],
    registration: registration()
  });
  assert.equal(d.liveness, "live");
});

// ─── 7. Envelope + purity ─────────────────────────────────────────────────

test("buildFeedResponse stamps asOf from the injected timestamp only", () => {
  const feed = buildFeedResponse({ asOf: NOW, sessions: [session()] });
  assert.equal(feed.asOf, iso(NOW));
});

test("builders are pure: two calls with the same asOf agree exactly", () => {
  const input = {
    asOf: NOW,
    sessions: [session(), session({ sessionId: "sess-2", heartbeatAt: iso(NOW - 2_000) })],
    registrations: [registration()]
  };
  assert.deepEqual(buildFeedResponse(input), buildFeedResponse(input));
});

test("buildFeedResponse covers instances known only from the registry", () => {
  const other = "codex:other-repo:cafebabe0123";
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session()],
    registrations: [registration(), registration({ id: other, instance: other, name: "codex peer" })]
  });
  assert.equal(feed.instances.length, 2);
  const codex = feed.instances.find((i) => i.instanceId === other);
  assert.equal(codex.displayName, "codex peer");
  // No presence at all → absence is not liveness.
  assert.equal(codex.liveness, "closed");
});

test("buildSessionDescriptors / buildInstanceDescriptors handle an empty feed", () => {
  assert.deepEqual(buildSessionDescriptors({ asOf: NOW, sessions: [] }), []);
  assert.deepEqual(buildInstanceDescriptors({ asOf: NOW, sessions: [] }), []);
  const feed = buildFeedResponse({ asOf: NOW, sessions: [] });
  assert.deepEqual(feed.instances, []);
  assert.deepEqual(feed.sessions, []);
  assert.equal(feed.asOf, iso(NOW));
});

test("descriptors of two instances never mix sessions", () => {
  const other = "codex:other-repo:cafebabe0123";
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [
      session({ sessionId: "mine", heartbeatAt: iso(NOW - 1_000) }),
      session({
        sessionId: "theirs",
        instance: other,
        host: "codex",
        heartbeatAt: iso(NOW - 30_000)
      })
    ],
    registrations: [registration()]
  });
  const mine = feed.instances.find((i) => i.instanceId === INSTANCE);
  const theirs = feed.instances.find((i) => i.instanceId === other);
  assert.equal(mine.lastSeen, iso(NOW - 1_000));
  assert.equal(theirs.lastSeen, iso(NOW - 30_000));
  assert.equal(theirs.host, "codex");
});
