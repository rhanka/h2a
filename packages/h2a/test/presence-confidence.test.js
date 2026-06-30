import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_ACTIVITY_WINDOW_DEFAULT_MS,
  deriveConnectionConfidence
} from "@sentropic/h2a";

import {
  SessionRegistry,
  createLocalStore,
  writePresence
} from "../dist/index.js";
import { handleDiscoverSessions, handleInbox } from "../dist/runtime/mcp/handlers.js";

// ── Core: deriveConnectionConfidence (pure) ──────────────────────────────────

const NOW = Date.parse("2026-06-10T12:00:00.000Z");

function sessWith(lastMcpActivityAt, extra = {}) {
  return {
    sessionId: "sess:c",
    instance: "claude:x",
    startedAt: "2026-06-10T00:00:00.000Z",
    heartbeatAt: "2026-06-10T12:00:00.000Z",
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    ...(lastMcpActivityAt ? { lastMcpActivityAt } : {}),
    ...extra
  };
}

test("deriveConnectionConfidence: active when MCP traffic is within the window", () => {
  const s = sessWith(new Date(NOW - 60_000).toISOString()); // 1 min ago
  assert.equal(deriveConnectionConfidence(s, { now: NOW }), "active");
});

test("deriveConnectionConfidence: idle-uncertain past the window (heartbeat irrelevant here)", () => {
  const s = sessWith(new Date(NOW - (H2A_ACTIVITY_WINDOW_DEFAULT_MS + 60_000)).toISOString());
  assert.equal(deriveConnectionConfidence(s, { now: NOW }), "idle-uncertain");
});

test("deriveConnectionConfidence: unknown when lastMcpActivityAt is absent or unparseable", () => {
  assert.equal(deriveConnectionConfidence(sessWith(undefined), { now: NOW }), "unknown");
  assert.equal(deriveConnectionConfidence(sessWith("not-a-date"), { now: NOW }), "unknown");
});

test("deriveConnectionConfidence: skew margin rescues a mirrored timestamp just past the window", () => {
  // 30s past the window — without margin: idle-uncertain; with a 120s margin: active.
  const at = new Date(NOW - (H2A_ACTIVITY_WINDOW_DEFAULT_MS + 30_000)).toISOString();
  const s = sessWith(at, { mirroredAt: new Date(NOW).toISOString() });
  assert.equal(deriveConnectionConfidence(s, { now: NOW }), "idle-uncertain");
  assert.equal(deriveConnectionConfidence(s, { now: NOW, skewMarginMs: 120_000 }), "active");
});

// ── SessionRegistry: activity is seeded at open and flushed by touch ──────────

function readSession(root, sessionId) {
  const dir = join(root, "presence");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (s.sessionId === sessionId) return s;
  }
  return undefined;
}

test("SessionRegistry: open seeds lastMcpActivityAt; markActivity + touch flushes a newer value", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-conf-reg-"));
  try {
    const reg = new SessionRegistry(root, { autoHeartbeat: false });
    reg.open({ instance: "claude:proj", sessionId: "sess:reg-act" });

    const atOpen = readSession(root, "sess:reg-act");
    assert.ok(atOpen.lastMcpActivityAt, "open must seed lastMcpActivityAt (boot = active)");
    assert.equal(deriveConnectionConfidence(atOpen), "active");

    await new Promise((r) => setTimeout(r, 8));
    reg.markActivity("sess:reg-act");
    reg.touch("sess:reg-act");

    const afterTouch = readSession(root, "sess:reg-act");
    assert.ok(
      Date.parse(afterTouch.lastMcpActivityAt) >= Date.parse(atOpen.lastMcpActivityAt),
      "touch must flush the latest markActivity timestamp"
    );
    // markActivity on an unknown id is a no-op (must not throw).
    reg.markActivity("sess:nope");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("handleDiscoverSessions: surfaces connectionConfidence per session", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-conf-disc-"));
  try {
    const reg = new SessionRegistry(root, { autoHeartbeat: false });
    reg.open({ instance: "claude:disc", sessionId: "sess:disc" });
    const result = handleDiscoverSessions(reg, undefined);
    assert.ok(Array.isArray(result.sessions));
    const mine = result.sessions.find((s) => s.instance === "claude:disc");
    assert.ok(mine, "the opened session should appear");
    assert.equal(mine.connectionConfidence, "active", "just-opened ⇒ active");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── handleInbox put: honest recipientConfidence at send time ─────────────────

function makeRegistration(instance) {
  return {
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date().toISOString()
  };
}

function makePresence(instance, sessionId, { heartbeatAt, lastMcpActivityAt } = {}) {
  const now = new Date().toISOString();
  return {
    sessionId,
    instance,
    startedAt: now,
    heartbeatAt: heartbeatAt ?? now,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...(lastMcpActivityAt ? { lastMcpActivityAt } : {})
  };
}

function envelopeObj(id) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "claude:sender:bbbbbbbbbbbb", role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", text: "hi" },
    createdAt: new Date().toISOString()
  };
}

function putTo(fullId, presence) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-conf-put-"));
  const root = join(dir, ".h2a");
  const store = createLocalStore({ root });
  store.registerInstance(makeRegistration(fullId));
  writePresence(root, presence);
  const result = handleInbox(store, {
    action: "put",
    instance: fullId,
    envelope: envelopeObj(`env:conf:${fullId}`)
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("handleInbox put: recipientConfidence='active' when the channel carried traffic recently", () => {
  const fullId = "claude:foo:aaaaaaaaaaaa";
  const r = putTo(fullId, makePresence(fullId, "sess:live", { lastMcpActivityAt: new Date().toISOString() }));
  assert.equal(r.ok, true);
  assert.equal(r.recipientLive, true);
  assert.equal(r.recipientConfidence, "active");
});

test("handleInbox put: recipientConfidence='idle-uncertain' when heartbeat is fresh but MCP is silent (false-live)", () => {
  const fullId = "claude:bar:cccccccccccc";
  // heartbeat NOW (so recipientLive=true), but last MCP traffic 20 min ago.
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  const r = putTo(fullId, makePresence(fullId, "sess:fl", { lastMcpActivityAt: stale }));
  assert.equal(r.ok, true);
  assert.equal(r.recipientLive, true, "heartbeat is fresh");
  assert.equal(r.recipientConfidence, "idle-uncertain", "but the MCP channel is silent");
});

test("handleInbox put: recipientConfidence='unknown' for a legacy presence with no activity stamp", () => {
  const fullId = "claude:baz:dddddddddddd";
  const r = putTo(fullId, makePresence(fullId, "sess:legacy")); // no lastMcpActivityAt
  assert.equal(r.ok, true);
  assert.equal(r.recipientConfidence, "unknown");
});
