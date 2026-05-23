import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const BIN_PATH = join(process.cwd(), "packages/h2a-cli/dist/bin.js");

/**
 * Spawn one `h2a mcp-serve` subprocess against a given root with a fast
 * heartbeat / notification interval so a cross-CLI cooperation scenario
 * completes in well under a second of wall time.
 */
function spawnMcpServe(root, label) {
  const child = spawn(process.execPath, [BIN_PATH, "mcp-serve", "--root", root], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      H2A_HEARTBEAT_INTERVAL_MS: "100",
      H2A_NOTIFY_INTERVAL_MS: "100",
      H2A_SESSION_EXPIRY_MS: "500"
    }
  });
  const responses = new Map(); // id -> resolver
  const notifications = [];
  const errorLines = [];
  let nextId = 100;
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    // eslint-disable-next-line no-cond-assign
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.id !== undefined && responses.has(parsed.id)) {
        responses.get(parsed.id)(parsed);
        responses.delete(parsed.id);
      } else if (parsed.method === "notifications/h2a") {
        notifications.push(parsed);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    errorLines.push(chunk.toString("utf8"));
  });
  function call(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        responses.delete(id);
        reject(new Error(`[${label}] ${method} timed out; stderr:\n${errorLines.join("")}`));
      }, 5000);
      responses.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  function notificationsByTopic(topic) {
    return notifications.filter((n) => n.params?.topic === topic);
  }
  async function waitForNotification(topic, predicate, timeoutMs = 3000) {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hit = notificationsByTopic(topic).find(predicate ?? (() => true));
      if (hit) return hit;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `[${label}] timeout waiting for ${topic}; stderr:\n${errorLines.join("")}`
        );
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  async function close(signal = null) {
    return new Promise((resolve) => {
      child.on("close", () => resolve());
      if (signal) {
        child.kill(signal);
      } else {
        // Graceful: end stdin so runMcpStdio resolves via the shutdown hook.
        child.stdin.end();
      }
    });
  }
  return {
    call,
    notifications,
    notificationsByTopic,
    waitForNotification,
    close,
    get stderr() {
      return errorLines.join("");
    }
  };
}

function callTool(name, args) {
  return { method: "tools/call", params: { name, arguments: args } };
}

function envelope(id, from, to) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: from, role: "CONDUCTOR", scope: "scope:demo" },
    body: { kind: "hello", to },
    createdAt: "2026-05-23T12:00:00.000Z"
  };
}

test(
  "two mcp-serve subprocesses cooperate: discovery + inbox push + presence leave (DEC-053)",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-xcli-"));
    const claude = spawnMcpServe(root, "claude");
    const codex = spawnMcpServe(root, "codex");
    try {
      // 1. Initialize both clients.
      await claude.call("initialize");
      await codex.call("initialize");

      // 2. Each side opens a session subscribed to all topics.
      const claudeOpen = await claude.call(
        "tools/call",
        callTool("h2a_session_open", {
          instance: "claude:proj-1",
          host: "claude",
          sessionId: "sess:claude-1",
          interests: { scopes: ["scope:demo"], negotiations: [] }
        }).params
      );
      const codexOpen = await codex.call(
        "tools/call",
        callTool("h2a_session_open", {
          instance: "codex:proj-2",
          host: "codex",
          sessionId: "sess:codex-1",
          interests: { scopes: ["scope:demo"], negotiations: [] }
        }).params
      );
      const claudeSession = JSON.parse(claudeOpen.result.content[0].text).session;
      const codexSession = JSON.parse(codexOpen.result.content[0].text).session;
      assert.equal(claudeSession.state, "live");
      assert.equal(codexSession.state, "live");

      // 3. After at least one notification tick, each side should see the
      //    other as a fresh peer via presence.peer_joined.
      const claudeJoined = await claude.waitForNotification(
        "presence.peer_joined",
        (n) => n.params.data.peer.sessionId === "sess:codex-1"
      );
      assert.equal(claudeJoined.params.data.peer.instance, "codex:proj-2");
      const codexJoined = await codex.waitForNotification(
        "presence.peer_joined",
        (n) => n.params.data.peer.sessionId === "sess:claude-1"
      );
      assert.equal(codexJoined.params.data.peer.instance, "claude:proj-1");

      // 4. Codex puts an envelope in Claude's inbox.
      await codex.call(
        "tools/call",
        callTool("h2a_inbox", {
          action: "put",
          instance: "claude:proj-1",
          envelope: envelope("env:hello", "codex:proj-2", "claude:proj-1")
        }).params
      );

      // 5. Claude receives a push notification on inbox.envelope_arrived.
      const inboxNotif = await claude.waitForNotification(
        "inbox.envelope_arrived",
        (n) => n.params.data.envelopeId === "env:hello"
      );
      assert.equal(inboxNotif.params.sessionId, "sess:claude-1");
      assert.equal(inboxNotif.params.data.instance, "claude:proj-1");

      // 6. Graceful close on codex → claude must observe presence.peer_left.
      await codex.close();
      const left = await claude.waitForNotification(
        "presence.peer_left",
        (n) => n.params.data.peer.sessionId === "sess:codex-1"
      );
      assert.equal(left.params.sessionId, "sess:claude-1");
    } finally {
      try {
        await claude.close();
      } catch {
        // ignore
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "ungraceful close (SIGKILL) leaves a stale presence file that expires via TTL (DEC-053)",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-xcli-kill-"));
    const claude = spawnMcpServe(root, "claude");
    const codex = spawnMcpServe(root, "codex");
    try {
      await claude.call("initialize");
      await codex.call("initialize");
      await claude.call(
        "tools/call",
        callTool("h2a_session_open", {
          instance: "claude:proj-1",
          sessionId: "sess:claude-2",
          interests: { scopes: ["scope:demo"], negotiations: [] }
        }).params
      );
      await codex.call(
        "tools/call",
        callTool("h2a_session_open", {
          instance: "codex:proj-2",
          sessionId: "sess:codex-2",
          interests: { scopes: ["scope:demo"], negotiations: [] }
        }).params
      );

      await claude.waitForNotification(
        "presence.peer_joined",
        (n) => n.params.data.peer.sessionId === "sess:codex-2"
      );

      // Hard kill codex — no shutdown hook runs.
      await codex.close("SIGKILL");

      // After the 500ms expiry plus a couple of notification ticks, the
      // stale presence file should be swept and claude must see peer_left.
      const left = await claude.waitForNotification(
        "presence.peer_left",
        (n) => n.params.data.peer.sessionId === "sess:codex-2",
        4000
      );
      assert.equal(left.params.sessionId, "sess:claude-2");
    } finally {
      try {
        await claude.close();
      } catch {
        // ignore
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
);
