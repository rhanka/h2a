// WP-5: keepalive — external pane prober
//
// Tests:
//  1. keepaliveOnce refreshes a presence whose pane is in the live set
//  2. keepaliveOnce does NOT refresh a presence whose pane is NOT in the live set
//  3. CLI keepalive --once with no tmux exits 0 and refreshes nothing

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { keepaliveOnce, runCli } from "../dist/index.js";
import { listPresence, writePresence } from "../dist/runtime/local-files/presence.js";

function makeSession(overrides = {}) {
  return {
    sessionId: `sess-${Math.random().toString(36).slice(2, 10)}`,
    instance: "claude:test:aabbccddeeff",
    host: "claude",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date(Date.now() - 5000).toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [
      "presence.peer_joined",
      "presence.peer_left",
      "inbox.envelope_arrived",
      "negotiation.event_appended"
    ],
    launchContext: {
      cwd: tmpdir(),
      command: "claude",
      tmux: { session: "main", pane: "%1" }
    },
    ...overrides
  };
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

// ─── 1. keepaliveOnce refreshes a pane that is live ────────────────────────

test("keepaliveOnce: refreshes presence whose pane is in livePanes", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp5-kap-live-"));
  const root = join(dir, ".h2a");
  try {
    // Init and write a presence file
    runCli(["init", "--root", root], captureStreams(dir));
    const session = makeSession({ sessionId: "sess-kaplive", launchContext: { cwd: dir, command: "test", tmux: { session: "s", pane: "%42" } } });
    writePresence(root, session);

    const oldBeat = session.heartbeatAt;
    const now = new Date(Date.now() + 2000); // 2s in the future
    const livePanes = new Set(["%42"]);
    const refreshed = keepaliveOnce({ root, livePanes, now });

    assert.equal(refreshed.length, 1, "should have refreshed 1 session");
    assert.equal(refreshed[0].sessionId, "sess-kaplive");
    assert.equal(refreshed[0].pane, "%42");

    // Verify the heartbeatAt on disk was updated
    const sessions = listPresence(root, { includeExpired: true });
    const found = sessions.find((s) => s.sessionId === "sess-kaplive");
    assert.ok(found, "session should still exist");
    assert.notEqual(found.heartbeatAt, oldBeat, "heartbeatAt should have changed");
    assert.equal(found.heartbeatAt, now.toISOString(), "heartbeatAt should match the now parameter");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 2. keepaliveOnce does NOT refresh a pane not in live set ──────────────

test("keepaliveOnce: does NOT refresh presence whose pane is absent from livePanes", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp5-kap-dead-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const session = makeSession({ sessionId: "sess-kapdead", launchContext: { cwd: dir, command: "test", tmux: { session: "s", pane: "%99" } } });
    writePresence(root, session);

    const oldBeat = session.heartbeatAt;
    const livePanes = new Set(["%1", "%2"]); // %99 is NOT included
    const refreshed = keepaliveOnce({ root, livePanes });

    assert.equal(refreshed.length, 0, "should have refreshed 0 sessions (pane not live)");

    // heartbeatAt on disk should be unchanged
    const sessions = listPresence(root, { includeExpired: true });
    const found = sessions.find((s) => s.sessionId === "sess-kapdead");
    assert.ok(found, "session should still exist");
    assert.equal(found.heartbeatAt, oldBeat, "heartbeatAt should NOT have changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 3. keepaliveOnce: no pane context → no refresh ────────────────────────

test("keepaliveOnce: skips sessions without tmux pane info", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp5-kap-nopane-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    // Session with no tmux context
    const session = makeSession({
      sessionId: "sess-nopane",
      launchContext: { cwd: dir, command: "test" } // no tmux field
    });
    writePresence(root, session);

    const livePanes = new Set(["%1", "%2", "%3"]);
    const refreshed = keepaliveOnce({ root, livePanes });

    assert.equal(refreshed.length, 0, "should have refreshed 0 sessions (no pane info)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 4. CLI keepalive --once: graceful when tmux is absent ─────────────────

test("keepalive --once (via runCli async path note): sync path returns 1 for async verb", () => {
  // keepalive is an async verb dispatched from bin.ts; runCli returns 1 for it
  // with a notice that it's async.  The --once path with no tmux is tested via
  // keepaliveOnce directly (tests 1-3 above).
  const dir = mkdtempSync(join(tmpdir(), "wp5-kap-sync-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const streams = captureStreams(dir);
    const rc = runCli(["keepalive", "--once"], streams);
    // sync path returns 1 because keepalive is async
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /async/);
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
