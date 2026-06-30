import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMcpServer } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-blockage-notif-"));
}

test("dispatcher pushes peer.blocked / peer.unblocked to a subscribed peer in scope", () => {
  const root = freshRoot();
  try {
    const received = [];
    const server = createMcpServer({ root, notifications: { sink: (n) => received.push(n) } });

    // A peer session in scope:team, subscribed to the blockage topics.
    server.callTool("h2a_session_open", {
      instance: "codex:p2",
      sessionId: "sess:codex-2",
      interests: { scopes: ["scope:team"] },
      subscribedTopics: ["peer.blocked", "peer.unblocked"]
    });

    // Baseline — no blockage yet.
    server.notifications.tick();
    assert.equal(received.filter((n) => n.params.topic === "peer.blocked").length, 0);

    // A different instance raises a blockage in scope:team.
    server.callTool("h2a_blockage_raise", {
      instance: "claude:p1",
      scope: "scope:team",
      reason: "needs API token",
      needs: "provision TOKEN_X"
    });
    server.notifications.tick();

    const blocked = received.filter((n) => n.params.topic === "peer.blocked");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].params.sessionId, "sess:codex-2");
    assert.equal(blocked[0].params.data.instance, "claude:p1");
    assert.equal(blocked[0].params.data.reason, "needs API token");
    assert.equal(blocked[0].params.data.needs, "provision TOKEN_X");

    // No duplicate on an unchanged tick.
    server.notifications.tick();
    assert.equal(received.filter((n) => n.params.topic === "peer.blocked").length, 1);

    // Resolve → peer.unblocked.
    server.callTool("h2a_blockage_resolve", { instance: "claude:p1", by: "principal:fab" });
    server.notifications.tick();
    const unblocked = received.filter((n) => n.params.topic === "peer.unblocked");
    assert.equal(unblocked.length, 1);
    assert.equal(unblocked[0].params.data.instance, "claude:p1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dispatcher does not notify an instance of its own blockage, nor out-of-scope peers", () => {
  const root = freshRoot();
  try {
    const received = [];
    const server = createMcpServer({ root, notifications: { sink: (n) => received.push(n) } });

    // The blocked instance's own session (should NOT be told about itself).
    server.callTool("h2a_session_open", {
      instance: "claude:p1",
      sessionId: "sess:self",
      interests: { scopes: ["scope:team"] },
      subscribedTopics: ["peer.blocked"]
    });
    // A peer in a DIFFERENT scope (should NOT hear it).
    server.callTool("h2a_session_open", {
      instance: "gemini:p3",
      sessionId: "sess:other-scope",
      interests: { scopes: ["scope:other"] },
      subscribedTopics: ["peer.blocked"]
    });

    server.notifications.tick();
    server.callTool("h2a_blockage_raise", { instance: "claude:p1", scope: "scope:team", reason: "x" });
    server.notifications.tick();

    assert.equal(received.filter((n) => n.params.topic === "peer.blocked").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
