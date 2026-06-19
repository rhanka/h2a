import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
  isH2ASession
} from "@sentropic/h2a";

import {
  SessionRegistry,
  createLocalStore,
  createMcpServer,
  listPresence,
  presenceFile,
  localStorePaths,
  writePresence
} from "../dist/index.js";

function makeRoot(prefix) {
  return mkdtempSync(join(tmpdir(), `h2a-session-${prefix}-`));
}

test("h2a_session_open writes a presence file and returns the session + peers", () => {
  const root = makeRoot("open");
  try {
    createLocalStore({ root });
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      host: "claude",
      interests: { scopes: ["team:devops"], negotiations: [] }
    });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(isH2ASession(result.session), true);
    assert.equal(result.session.state, "live");
    assert.equal(result.session.instance, "claude:proj-1");
    assert.equal(result.session.host, "claude");
    assert.deepEqual(result.session.interests.scopes, ["team:devops"]);
    assert.equal(result.peers.length, 0);

    const paths = localStorePaths(root);
    const file = presenceFile(paths, result.session.sessionId);
    assert.ok(existsSync(file), "presence file must exist on disk");
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(onDisk.sessionId, result.session.sessionId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_session_open with no instance returns a friendly error", () => {
  const root = makeRoot("no-instance");
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_session_open", {});
    assert.match(result.error, /missing 'instance'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_session_open rejects unknown subscribedTopics", () => {
  const root = makeRoot("bad-topics");
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      subscribedTopics: ["chat.message"]
    });
    assert.match(result.error, /subscribedTopics/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_discover_sessions returns peers from disk and filters by scope/instance", () => {
  const root = makeRoot("discover");
  try {
    const server = createMcpServer({ root });
    server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      sessionId: "sess:claude-1",
      interests: { scopes: ["team:devops"], negotiations: [] }
    });
    server.callTool("h2a_session_open", {
      instance: "codex:proj-2",
      sessionId: "sess:codex-1",
      interests: { scopes: ["team:devops"], negotiations: [] }
    });
    server.callTool("h2a_session_open", {
      instance: "gemini:proj-3",
      sessionId: "sess:gemini-1",
      interests: { scopes: ["team:research"], negotiations: [] }
    });

    const all = server.callTool("h2a_discover_sessions", {});
    assert.equal(all.sessions.length, 3);

    const devops = server.callTool("h2a_discover_sessions", { scope: "team:devops" });
    const ids = devops.sessions.map((s) => s.sessionId).sort();
    assert.deepEqual(ids, ["sess:claude-1", "sess:codex-1"]);

    const onlyCodex = server.callTool("h2a_discover_sessions", {
      instance: "codex:proj-2"
    });
    assert.equal(onlyCodex.sessions.length, 1);
    assert.equal(onlyCodex.sessions[0].sessionId, "sess:codex-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_session_close deletes the presence file and stops the heartbeat", () => {
  const root = makeRoot("close");
  try {
    const server = createMcpServer({ root });
    const opened = server.callTool("h2a_session_open", {
      instance: "claude:proj-1"
    });
    const sid = opened.session.sessionId;
    const paths = localStorePaths(root);
    assert.ok(existsSync(presenceFile(paths, sid)));

    const closed = server.callTool("h2a_session_close", { sessionId: sid });
    assert.equal(closed.ok, true);
    assert.equal(closed.session.state, "closed");
    assert.equal(
      existsSync(presenceFile(paths, sid)),
      false,
      "closed sessions are swept from disk"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SessionRegistry expires stale peer presence files on scan", () => {
  const root = makeRoot("expire");
  try {
    // expiryMs must be comfortably larger than the test's own wall-clock so the
    // just-opened "fresh" session cannot age out between open() and scanFresh()
    // on a slow runner (a 100ms window flaked on Windows node22 — the fresh
    // session aged past it during scheduling). The stale peer is 60s old, so any
    // window < 60s still proves filtering; 30s removes the race.
    const reg = new SessionRegistry(root, {
      heartbeatIntervalMs: 50,
      expiryMs: 30_000,
      autoHeartbeat: false
    });
    const live = reg.open({
      instance: "claude:proj-1",
      sessionId: "sess:fresh"
    });
    // Manually forge a stale peer presence file
    const paths = localStorePaths(root);
    const staleSession = {
      ...live,
      sessionId: "sess:stale",
      instance: "codex:proj-2",
      heartbeatAt: new Date(Date.now() - 60_000).toISOString()
    };
    // write through the public API so isH2ASession passes
    writePresence(root, staleSession);

    const fresh = reg.scanFresh();
    const ids = fresh.map((s) => s.sessionId).sort();
    assert.deepEqual(ids, ["sess:fresh"], "stale session must be filtered out");
    // The stale file should be swept from disk by the scan.
    const onDisk = listPresence(root, { includeExpired: true });
    assert.equal(
      onDisk.some((s) => s.sessionId === "sess:stale"),
      false,
      "stale presence file must be swept from disk"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SessionRegistry.touch keeps the heartbeat fresh", () => {
  const root = makeRoot("touch");
  try {
    const reg = new SessionRegistry(root, { autoHeartbeat: false });
    const session = reg.open({
      instance: "claude:proj-1",
      sessionId: "sess:tt"
    });
    const before = Date.parse(session.heartbeatAt);
    // Slightly later
    const after = reg.touch("sess:tt");
    assert.ok(after);
    const afterTs = Date.parse(after.heartbeatAt);
    assert.ok(
      afterTs >= before,
      `expected ${after.heartbeatAt} >= ${session.heartbeatAt}`
    );
    reg.closeAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SessionRegistry.touch recreates a missing presence file for a still-open session", () => {
  const root = makeRoot("touch-recreate");
  try {
    const reg = new SessionRegistry(root, { autoHeartbeat: false });
    const session = reg.open({
      instance: "codex:remote:a6694dc87c1d",
      sessionId: "sess:remote-live"
    });
    const paths = localStorePaths(root);
    const file = presenceFile(paths, session.sessionId);
    assert.ok(existsSync(file), "open session writes initial presence");

    rmSync(file, { force: true });
    assert.equal(existsSync(file), false, "presence was externally swept");

    const revived = reg.touch(session.sessionId);
    assert.ok(revived, "touch should revive presence for in-memory live session");
    assert.ok(existsSync(file), "revived session must be visible on disk again");

    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(onDisk.sessionId, session.sessionId);
    assert.equal(onDisk.instance, session.instance);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS is < expiry (sanity)", () => {
  assert.equal(typeof H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS, "number");
});
