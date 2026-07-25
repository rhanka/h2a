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

test("deriveLiveness: the mirroredAt staleness gate strictly precedes the confidence check", () => {
  // ORDERING INVARIANT (architect ruling, 2026-07-25). The roll-up ranks `idle`
  // ABOVE `stale`, and that is only sound because staleness is decided BEFORE
  // connection confidence: it makes every `idle` genuine fresh knowledge rather
  // than absence of knowledge. Both rows below have a quiet pipeline, and each
  // would take a DIFFERENT branch of the confidence check — so if the two checks
  // are ever reordered, one of these assertions reports `idle` (or `live`) and
  // this test fails loudly instead of the roll-up silently becoming wrong.
  const pushIntervalMs = 30_000;
  const quietPipeline = iso(NOW - (2 * pushIntervalMs + 1_000));

  // (a) would be "idle-uncertain" -> 'idle' if confidence were consulted first.
  const wouldBeIdle = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - (ACTIVITY_WINDOW_MS + 1_000)),
    mirroredAt: quietPipeline
  });
  assert.equal(deriveLiveness(wouldBeIdle, NOW, pushIntervalMs), "stale");
  assert.notEqual(
    deriveLiveness(wouldBeIdle, NOW, pushIntervalMs),
    "idle",
    "a stale-pipeline row must NEVER be reported idle: the staleness gate must run first"
  );

  // (b) would be "active" -> 'live' if confidence were consulted first.
  const wouldBeLive = session({
    heartbeatAt: iso(NOW - 1_000),
    lastMcpActivityAt: iso(NOW - 1_000),
    mirroredAt: quietPipeline
  });
  assert.equal(deriveLiveness(wouldBeLive, NOW, pushIntervalMs), "stale");

  // (c) confidence "unknown" (no MCP stamp at all) is also gated by staleness.
  const wouldBeUnknown = session({
    heartbeatAt: iso(NOW - 1_000),
    mirroredAt: quietPipeline
  });
  assert.equal(deriveLiveness(wouldBeUnknown, NOW, pushIntervalMs), "stale");
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
const PEM_BAIT = "-----BEGIN PRIVATE KEY-----MIIEvQIBADAN";

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
  //
  // The bait must sit in fields the builder ACTUALLY READS, and in fields whose
  // values are STRUCTURALLY constrained (a closed vocabulary, an enum, a
  // timestamp). An earlier revision planted the PEM in `registration.publicKeys`,
  // which the builder never touches: the test looked like it pinned hostile
  // content and pinned nothing. Free-text titles are a separate, documented case
  // — see the next test.
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [
      session({
        pid: 4242,
        workStatus: "working",
        workspace: { id: "ws:9", path: SECRET_PATH, host: "claude", label: "lbl" }
      })
    ],
    registrations: [
      registration({
        publicKeys: ["-----BEGIN PUBLIC KEY-----"],
        declaredCapabilities: [PEM_BAIT, SECRET_PATH],
        roles: [PEM_BAIT]
      })
    ]
  });
  assert.deepEqual(Object.keys(feed).sort(), ["asOf", "instances", "sessions"]);
  assert.deepEqual(Object.keys(feed.instances[0]).sort(), [
    "declaredCapabilities",
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
  assert.ok(!serialized.includes("BEGIN PRIVATE KEY"));
  assert.ok(!serialized.includes(SECRET_PATH));
  assert.ok(!serialized.includes("4242"));
});

test("DOCUMENTED LIMIT: free-text display names pass through verbatim", () => {
  // This test states the exact SHAPE of the opacity guarantee, so nobody reads
  // the guarantee as wider than it is.
  //
  // `displayName` / `topicOrTitle` are host-native session titles (Claude
  // customTitle, Codex thread_name, `/rename`). They are free text by nature, so
  // NO allowlist can constrain them the way `declaredCapabilities` and `role` are
  // constrained. Whatever the agent named itself is what the owner sees.
  //
  // What the feed therefore guarantees, precisely:
  //   - it never SOURCES a filesystem path or key material into a descriptor
  //     (paths live in workspace.path / launchContext.cwd, which are unreachable
  //     here, and key material is never read at all);
  //   - every field with a declared closed shape is validated on read.
  // What it does NOT guarantee: that a free-text title is benign. A consumer must
  // escape it like any user content — and it is the owner's OWN agent's name, in
  // the owner's own panel, not another principal's data.
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session({ name: PEM_BAIT })],
    registrations: [registration({ name: PEM_BAIT })]
  });
  assert.equal(feed.sessions[0].topicOrTitle, PEM_BAIT);
  assert.equal(feed.instances[0].displayName, PEM_BAIT);
  // But the STRUCTURAL fields are still clean in that very same feed.
  assert.deepEqual(feed.instances[0].declaredCapabilities, []);
  assert.equal(feed.instances[0].role, "AGENTS");
  assert.ok(!JSON.stringify(feed).includes(SECRET_PATH));
});

// ─── 5b. Hostile registry content at the READ boundary ────────────────────
//
// The store is populated by writers this module does not control:
// `mirror/accept.ts` authorizes a mirrored registration by KEY OWNERSHIP alone
// and never constrains its content, `serve.ts` persists it verbatim,
// `mcp/handlers.ts` applies a caller-supplied registration, and the store
// re-validates nothing on read. So a remote or prompt-injected agent can put a
// path or a PEM in its OWN registration. Sanitizing only the write path we own
// would not help: the feed IS the read boundary, and it must sanitize there.

test("declaredCapabilities is ALLOWLISTED on read: a path and a PEM cannot reach the feed", () => {
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session()],
    registrations: [
      registration({
        declaredCapabilities: [SECRET_PATH, PEM_BAIT, "h2a.session"]
      })
    ]
  });
  // Only the vocabulary member survives — an INTERSECTION, not a strip: nothing
  // here looks for "/home/" or "BEGIN"; non-members simply are not members.
  assert.deepEqual(feed.instances[0].declaredCapabilities, ["h2a.session"]);
  const serialized = JSON.stringify(feed);
  assert.ok(!serialized.includes(SECRET_PATH), "a path reached the feed via declaredCapabilities");
  assert.ok(!serialized.includes("BEGIN PRIVATE KEY"), "a PEM reached the feed");
  assert.ok(!serialized.includes("/home/"));
});

test("an unrecognized role is validated to 'unknown' on read", () => {
  // Q1 applied to the READ path: never emit a value outside the declared union,
  // no matter who wrote the registry row.
  const bogus = buildFeedResponse({
    asOf: NOW,
    sessions: [session()],
    registrations: [registration({ roles: ["SUPERADMIN"] })]
  });
  assert.equal(bogus.instances[0].role, "unknown");
  assert.ok(!JSON.stringify(bogus).includes("SUPERADMIN"));

  const blank = buildFeedResponse({
    asOf: NOW,
    sessions: [session()],
    registrations: [registration({ roles: [""] })]
  });
  assert.equal(blank.instances[0].role, "unknown");

  // A real member still passes through untouched.
  const real = buildFeedResponse({
    asOf: NOW,
    sessions: [session()],
    registrations: [registration({ roles: ["CONTROL"] })]
  });
  assert.equal(real.instances[0].role, "CONTROL");
});

// ─── 5c. ISO-typed fields never carry unparseable text ────────────────────

test("malformed timestamps become the sentinel, never raw text", () => {
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session({ startedAt: "", heartbeatAt: "garbage" })]
  });
  assert.equal(feed.sessions[0].openedAt, "unknown");
  assert.equal(feed.sessions[0].lastActivityAt, "unknown");
  assert.equal(feed.sessions[0].activitySource, "heartbeat");
  assert.equal(feed.instances[0].lastSeen, "unknown");
  assert.ok(!JSON.stringify(feed).includes("garbage"));
});

test("lastSeen is max(heartbeatAt) only — never the registration's mint time", () => {
  // Reporting a createdAt as "last seen" would be an unearned freshness claim:
  // a mint is not a sighting.
  const createdAt = iso(NOW - 86_400_000);
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [],
    registrations: [registration({ createdAt })]
  });
  assert.equal(feed.instances[0].lastSeen, "unknown");
  assert.notEqual(feed.instances[0].lastSeen, createdAt);
  assert.ok(!JSON.stringify(feed.instances[0]).includes(createdAt));
});

test("an empty string behaves as absence, so the sentinel is not defeated", () => {
  // Reachable in practice: `h2a connect --name ""` writes name === "".
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [session({ host: "", name: "", workspace: undefined })],
    registrations: [registration({ name: "", workspace: undefined })]
  });
  assert.equal(feed.instances[0].displayName, "unknown");
  assert.equal(feed.instances[0].host, "unknown");
  assert.equal(feed.instances[0].workspaceLabel, "unknown");
  assert.equal(feed.sessions[0].topicOrTitle, "unknown");
});

// ─── 5d. The documented orderings are behaviour, so they are pinned ───────

test("buildInstanceDescriptors orders instances by lastSeen descending", () => {
  const a = "claude:a:aaaaaaaaaaaa";
  const b = "codex:b:bbbbbbbbbbbb";
  const c = "gemini:c:cccccccccccc";
  const feed = buildFeedResponse({
    asOf: NOW,
    // Deliberately NOT in output order.
    sessions: [
      session({ sessionId: "s-b", instance: b, heartbeatAt: iso(NOW - 30_000) }),
      session({ sessionId: "s-c", instance: c, heartbeatAt: iso(NOW - 60_000) }),
      session({ sessionId: "s-a", instance: a, heartbeatAt: iso(NOW - 1_000) })
    ]
  });
  assert.deepEqual(
    feed.instances.map((i) => i.instanceId),
    [a, b, c]
  );
});

test("buildSessionDescriptors orders sessions by lastActivityAt descending", () => {
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [
      session({ sessionId: "middle", heartbeatAt: iso(NOW - 30_000) }),
      session({ sessionId: "oldest", heartbeatAt: iso(NOW - 60_000) }),
      // Newest by PROVEN MCP activity, not by heartbeat, so this also pins that
      // the sort keys off the emitted lastActivityAt.
      session({
        sessionId: "newest",
        heartbeatAt: iso(NOW - 45_000),
        lastMcpActivityAt: iso(NOW - 1_000)
      })
    ]
  });
  assert.deepEqual(
    feed.sessions.map((s) => s.sessionId),
    ["newest", "middle", "oldest"]
  );
});

// ─── 6. Field mapping: names, role, declaredCapabilities, lastSeen ───────

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

test("role comes from registration.roles[0]; declaredCapabilities pass through", () => {
  const d = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [session()],
    registration: registration({
      roles: ["CONDUCTOR", "AGENTS"],
      declaredCapabilities: ["h2a.session", "h2a.mcp"]
    })
  });
  assert.equal(d.role, "CONDUCTOR");
  assert.deepEqual(d.declaredCapabilities, ["h2a.session", "h2a.mcp"]);
});

test("role is never synthesized: a registration with no roles yields 'unknown'", () => {
  // Architect ruling, 2026-07-25: never emit a value indistinguishable from a
  // real one. A missing role must NOT render as a genuine H2A_ROLES member,
  // because once real roles land an absent role would read as an asserted claim
  // of authority.
  const REAL_ROLES = [
    "PRINCIPAL",
    "EXECUTIF",
    "CONDUCTOR",
    "AGENTS",
    "CONTROL",
    "MANDATAIRE"
  ];

  const noRoles = buildInstanceDescriptor(INSTANCE, {
    asOf: NOW,
    sessions: [session()],
    registration: registration({ roles: [] })
  });
  assert.equal(noRoles.role, "unknown");
  assert.ok(!REAL_ROLES.includes(noRoles.role), "a missing role must not be a real H2ARole");

  // Same for an instance with presence but no registration at all — and the row
  // is still EMITTED, never dropped (a dropped row would be a false negative on
  // presence, and collides with "empty arrays = nothing enrolled").
  const feed = buildFeedResponse({ asOf: NOW, sessions: [session()] });
  assert.equal(feed.instances.length, 1);
  assert.equal(feed.instances[0].role, "unknown");
  assert.ok(!REAL_ROLES.includes(feed.instances[0].role));
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
