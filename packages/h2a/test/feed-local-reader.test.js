// The local feed adapter makes the ratified descriptor contract startable from
// h2a's own state, without adding a hosted route or remote-control action.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLocalStore,
  readLocalFeed,
  readPresence,
  writePresence
} from "../dist/index.js";

const INSTANCE = "codex:feed-reader:0123456789ab";
const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function registration() {
  return {
    id: INSTANCE,
    instance: INSTANCE,
    name: "Feed reader",
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    declaredCapabilities: ["read"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date(NOW - 1_000).toISOString()
  };
}

function session(overrides = {}) {
  return {
    sessionId: "sess:feed-reader",
    instance: INSTANCE,
    host: "codex",
    name: "Remote-control lane",
    startedAt: new Date(NOW - 60_000).toISOString(),
    heartbeatAt: new Date(NOW - 1_000).toISOString(),
    lastMcpActivityAt: new Date(NOW - 1_000).toISOString(),
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    workspace: {
      id: "ws:feed-reader",
      host: "codex",
      label: "h2a",
      path: "/private/worktree/h2a"
    },
    launchContext: { cwd: "/private/worktree/h2a", command: "codex --resume" },
    ...overrides
  };
}

test("readLocalFeed reads local state into the browser-safe feed response", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-feed-reader-"));
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration());
    writePresence(root, session());

    const feed = readLocalFeed({ root, asOf: NOW });

    assert.equal(feed.asOf, new Date(NOW).toISOString());
    assert.equal(feed.instances.length, 1);
    assert.equal(feed.sessions.length, 1);
    assert.equal(feed.sessions[0].state, "open");
    assert.equal(feed.sessions[0].activitySource, "mcp");
    assert.equal(feed.instances[0].workspaceLabel, "h2a");
    assert.doesNotMatch(JSON.stringify(feed), /\/private\/worktree\/h2a|codex --resume/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readLocalFeed reports expired presence as closed without deleting it", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-feed-reader-"));
  try {
    const expired = session({
      sessionId: "sess:expired",
      heartbeatAt: new Date(NOW - 91_000).toISOString(),
      lastMcpActivityAt: new Date(NOW - 91_000).toISOString()
    });
    writePresence(root, expired);

    const feed = readLocalFeed({ root, asOf: NOW });

    assert.equal(feed.sessions.length, 1);
    assert.equal(feed.sessions[0].state, "closed");
    assert.ok(readPresence(root, expired.sessionId), "a read-only feed must not sweep expired presence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readLocalFeed refuses a partial response when a presence row is unreadable", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-feed-reader-"));
  try {
    createLocalStore({ root });
    mkdirSync(join(root, "presence"), { recursive: true });
    writeFileSync(join(root, "presence", "broken.json"), "not json\n", "utf8");

    assert.throws(
      () => readLocalFeed({ root, asOf: NOW }),
      /presence source has unreadable records/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
