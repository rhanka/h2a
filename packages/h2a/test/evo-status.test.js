// EVO-13 / h2a status — partition presence into direct vs indirect sessions.
// A "direct" session has no `mirroredAt` field (local heartbeat).
// An "indirect" session has `mirroredAt` set (stamped by the mirror ingester).

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

test("h2a status partitions direct vs indirect sessions", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-status-")), ".h2a");
  try {
    const now = new Date().toISOString();

    // Write a DIRECT session (no mirroredAt — local heartbeat)
    writePresence(root, {
      sessionId: "sess-direct-001",
      instance: "claude:proj:aaaaaaaaaaaa",
      host: "claude",
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: []
    });

    // Write an INDIRECT session (mirroredAt set — ingested from a remote/sidecar)
    writePresence(root, {
      sessionId: "sess-indirect-001",
      instance: "remote:sess-xyz",
      host: "remote",
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: [],
      mirroredAt: now
    });

    const streams = captureStreams(root);
    const exit = runCli(["status", "--root", root], streams);

    assert.equal(exit, 0, `expected exit 0 — stderr: ${streams.stderrText}`);

    const result = JSON.parse(streams.stdoutText);
    assert.equal(result.ok, true);
    assert.equal(result.counts.direct, 1, "one direct session expected");
    assert.equal(result.counts.indirect, 1, "one indirect session expected");
    assert.equal(result.counts.total, 2, "two sessions total");

    assert.equal(result.direct.length, 1);
    assert.equal(result.direct[0].instance, "claude:proj:aaaaaaaaaaaa");
    assert.equal(result.direct[0].mirroredAt, undefined, "direct session must not have mirroredAt");

    assert.equal(result.indirect.length, 1);
    assert.ok(
      typeof result.indirect[0].mirroredAt === "string",
      "indirect session must have mirroredAt as a string"
    );
    assert.equal(result.indirect[0].instance, "remote:sess-xyz");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a status returns ok:true with empty counts when no sessions present", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-status-empty-")), ".h2a");
  try {
    const streams = captureStreams(root);
    const exit = runCli(["status", "--root", root], streams);
    assert.equal(exit, 0, `expected exit 0 — stderr: ${streams.stderrText}`);
    const result = JSON.parse(streams.stdoutText);
    assert.equal(result.ok, true);
    assert.equal(result.counts.direct, 0);
    assert.equal(result.counts.indirect, 0);
    assert.equal(result.counts.total, 0);
    assert.deepEqual(result.direct, []);
    assert.deepEqual(result.indirect, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a status filters by --scope", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-status-scope-")), ".h2a");
  try {
    const now = new Date().toISOString();

    writePresence(root, {
      sessionId: "sess-sc-001",
      instance: "claude:proj:bbbbbbbbbbbb",
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      interests: { scopes: ["scope:alpha"], negotiations: [] },
      subscribedTopics: []
    });

    writePresence(root, {
      sessionId: "sess-sc-002",
      instance: "claude:proj:cccccccccccc",
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      interests: { scopes: ["scope:beta"], negotiations: [] },
      subscribedTopics: []
    });

    const streams = captureStreams(root);
    const exit = runCli(["status", "--root", root, "--scope", "scope:alpha"], streams);
    assert.equal(exit, 0);
    const result = JSON.parse(streams.stdoutText);
    assert.equal(result.counts.total, 1);
    assert.equal(result.direct[0].instance, "claude:proj:bbbbbbbbbbbb");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
