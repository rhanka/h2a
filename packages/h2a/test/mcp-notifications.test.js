import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMcpServer, writePresence } from "../dist/index.js";

function freshRoot(prefix) {
  return mkdtempSync(join(tmpdir(), `h2a-notif-${prefix}-`));
}

function envelope(id, target, instance) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: {
      instance,
      role: "CONDUCTOR",
      scope: `scope:test/${target}`
    },
    body: { kind: "test", target },
    createdAt: "2026-05-23T12:00:00.000Z"
  };
}

test("NotificationDispatcher pushes inbox.envelope_arrived to a subscribed session", () => {
  const root = freshRoot("inbox");
  try {
    const received = [];
    const server = createMcpServer({
      root,
      notifications: { sink: (n) => received.push(n) }
    });
    server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      sessionId: "sess:claude-1",
      subscribedTopics: ["inbox.envelope_arrived"]
    });

    // Baseline tick — establishes the snapshot, no events yet.
    server.notifications.tick();
    assert.equal(received.length, 0);

    // Drop an envelope into the session's inbox.
    server.callTool("h2a_inbox", {
      action: "put",
      instance: "claude:proj-1",
      envelope: envelope("env:1", "claude", "codex:proj-2")
    });
    server.notifications.tick();

    const inboxNotifs = received.filter(
      (n) => n.params.topic === "inbox.envelope_arrived"
    );
    assert.equal(inboxNotifs.length, 1);
    assert.equal(inboxNotifs[0].jsonrpc, "2.0");
    assert.equal(inboxNotifs[0].method, "notifications/h2a");
    assert.equal(inboxNotifs[0].params.sessionId, "sess:claude-1");
    assert.equal(inboxNotifs[0].params.data.envelopeId, "env:1");
    assert.equal(inboxNotifs[0].params.data.instance, "claude:proj-1");

    // Second tick on same state — no new notification.
    server.notifications.tick();
    const inboxNotifs2 = received.filter(
      (n) => n.params.topic === "inbox.envelope_arrived"
    );
    assert.equal(inboxNotifs2.length, 1, "idempotent across ticks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NotificationDispatcher pushes presence.peer_joined when a new peer file appears", () => {
  const root = freshRoot("presence-join");
  try {
    const received = [];
    const server = createMcpServer({
      root,
      notifications: { sink: (n) => received.push(n) }
    });
    server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      sessionId: "sess:claude-1",
      subscribedTopics: ["presence.peer_joined", "presence.peer_left"]
    });

    server.notifications.tick();
    assert.equal(received.length, 0);

    // Forge a peer presence file (as if another mcp-serve process had
    // opened a session against the same root).
    writePresence(root, {
      sessionId: "sess:codex-1",
      instance: "codex:proj-2",
      host: "codex",
      pid: 99999,
      startedAt: "2026-05-23T12:00:00.000Z",
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: ["inbox.envelope_arrived"]
    });

    server.notifications.tick();
    const joined = received.filter((n) => n.params.topic === "presence.peer_joined");
    assert.equal(joined.length, 1);
    assert.equal(joined[0].params.data.peer.sessionId, "sess:codex-1");
    assert.equal(joined[0].params.data.peer.instance, "codex:proj-2");

    // Now close that peer manually and tick again.
    server.callTool("h2a_session_close", { sessionId: "sess:codex-1" });
    server.notifications.tick();
    const left = received.filter((n) => n.params.topic === "presence.peer_left");
    assert.equal(left.length, 1);
    assert.equal(left[0].params.data.peer.sessionId, "sess:codex-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NotificationDispatcher pushes negotiation.event_appended for followed negotiations", () => {
  const root = freshRoot("nego");
  try {
    const received = [];
    const server = createMcpServer({
      root,
      notifications: { sink: (n) => received.push(n) }
    });

    // Register the conductor and open the negotiation first.
    server.callTool("h2a_register_instance", {
      registration: {
        id: "conductor:c1",
        instance: "conductor:c1",
        roles: ["CONDUCTOR"],
        scopes: ["scope:test"],
        capabilities: ["negotiate"],
        endpoints: [],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: "2026-05-23T12:00:00.000Z"
      }
    });
    server.callTool("h2a_open_negotiation", {
      record: {
        id: "nego:1",
        scope: "scope:test",
        parties: ["conductor:c1"],
        subject: "engagement",
        status: "draft",
        requiredSigners: ["conductor:c1"]
      }
    });

    server.callTool("h2a_session_open", {
      instance: "conductor:c1",
      sessionId: "sess:c1",
      interests: { scopes: [], negotiations: ["nego:1"] },
      subscribedTopics: ["negotiation.event_appended"]
    });

    // Baseline tick — captures the current journal length (event from open).
    server.notifications.tick();
    received.length = 0;

    // Append an event.
    server.callTool("h2a_append_journal", {
      negotiationId: "nego:1",
      payload: {
        type: "event",
        actor: "conductor:c1",
        body: { kind: "tick" },
        createdAt: "2026-05-23T12:00:01.000Z"
      }
    });
    server.notifications.tick();
    const notifs = received.filter(
      (n) => n.params.topic === "negotiation.event_appended"
    );
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].params.data.negotiationId, "nego:1");
    assert.equal(notifs[0].params.data.newEntries, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NotificationDispatcher does not push topics the session did not subscribe to", () => {
  const root = freshRoot("filter");
  try {
    const received = [];
    const server = createMcpServer({
      root,
      notifications: { sink: (n) => received.push(n) }
    });
    server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      sessionId: "sess:claude-1",
      // Only subscribed to presence, not inbox
      subscribedTopics: ["presence.peer_joined"]
    });

    server.notifications.tick();
    server.callTool("h2a_inbox", {
      action: "put",
      instance: "claude:proj-1",
      envelope: envelope("env:silent", "claude", "codex:proj-2")
    });
    server.notifications.tick();

    const inboxNotifs = received.filter(
      (n) => n.params.topic === "inbox.envelope_arrived"
    );
    assert.equal(
      inboxNotifs.length,
      0,
      "unsubscribed topics must not produce push notifications"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
