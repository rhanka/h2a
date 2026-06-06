// EVO: discoverability by name — `--name` filter on `h2a sessions` and `h2a status`.
// Two sessions with distinct display names; filtering by a substring of one name
// must return only that session.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli, writePresence } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

function makeRoot() {
  return join(mkdtempSync(join(tmpdir(), "h2a-discover-name-")), ".h2a");
}

function seedSessions(root) {
  const now = new Date().toISOString();
  writePresence(root, {
    sessionId: "sess-chat-001",
    instance: "claude:sentropic:aaaaaaaaaaaa",
    host: "claude",
    name: "sentropic-chat",
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  });
  writePresence(root, {
    sessionId: "sess-radar-001",
    instance: "claude:radar:bbbbbbbbbbbb",
    host: "claude",
    name: "radar-immobilier",
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  });
}

test("h2a sessions --name chat returns only the sentropic-chat session", () => {
  const root = makeRoot();
  try {
    seedSessions(root);
    const streams = captureStreams(root);
    const rc = runCli(["sessions", "--root", root, "--name", "chat"], streams);
    assert.equal(rc, 0, `expected exit 0 — stderr: ${streams.stderrText}`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.ok(Array.isArray(parsed), "output must be a JSON array");
    assert.equal(parsed.length, 1, "exactly one session must match");
    assert.equal(parsed[0].name, "sentropic-chat");
    assert.equal(parsed[0].sessionId, "sess-chat-001");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a sessions --name is case-insensitive (CHAT matches sentropic-chat)", () => {
  const root = makeRoot();
  try {
    seedSessions(root);
    const streams = captureStreams(root);
    const rc = runCli(["sessions", "--root", root, "--name", "CHAT"], streams);
    assert.equal(rc, 0, `expected exit 0 — stderr: ${streams.stderrText}`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "sentropic-chat");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a sessions --name radar returns only the radar-immobilier session", () => {
  const root = makeRoot();
  try {
    seedSessions(root);
    const streams = captureStreams(root);
    const rc = runCli(["sessions", "--root", root, "--name", "radar"], streams);
    assert.equal(rc, 0, `expected exit 0 — stderr: ${streams.stderrText}`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "radar-immobilier");
    assert.equal(parsed[0].sessionId, "sess-radar-001");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a sessions --name with no match returns empty array", () => {
  const root = makeRoot();
  try {
    seedSessions(root);
    const streams = captureStreams(root);
    const rc = runCli(["sessions", "--root", root, "--name", "nonexistent"], streams);
    assert.equal(rc, 0, `expected exit 0 — stderr: ${streams.stderrText}`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.deepEqual(parsed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a status --name chat returns only direct/indirect counts for the chat session", () => {
  const root = makeRoot();
  try {
    seedSessions(root);
    const streams = captureStreams(root);
    const rc = runCli(["status", "--root", root, "--name", "chat"], streams);
    assert.equal(rc, 0, `expected exit 0 — stderr: ${streams.stderrText}`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.counts.total, 1);
    assert.equal(parsed.direct.length + parsed.indirect.length, 1);
    const session = [...parsed.direct, ...parsed.indirect][0];
    assert.equal(session.name, "sentropic-chat");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
