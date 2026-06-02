import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { createLocalStore, runCli } from "../dist/index.js";

function freshWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), "h2a-live-ws-"));
  const root = join(mkdtempSync(join(tmpdir(), "h2a-live-root-")), ".h2a");
  return { cwd, root };
}

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

function withClaudeSession(id, fn) {
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = id;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
  }
}

function connect(root, cwd, providerSessionId) {
  return withClaudeSession(providerSessionId, () => {
    const streams = captureStreams(cwd);
    const rc = runCli(["connect", "--root", root, "--host", "claude"], streams);
    assert.equal(rc, 0, streams.stderrText);
    return JSON.parse(streams.stdoutText);
  });
}

function env(id, text) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "conductor:ci", role: "CONDUCTOR", scope: "scope:default" },
    body: { kind: "message", text },
    createdAt: "2026-05-31T00:00:00.000Z"
  };
}

test("connect reclaims ONE perennial identity per workspace across distinct provider sessions (no per-session proliferation)", () => {
  const { cwd, root } = freshWorkspace();
  try {
    // Two distinct Claude Code sessions (CLAUDE_CODE_SESSION_ID) in the SAME
    // workspace must collapse onto a single perennial identity — the binding is
    // keyed on (host, workspaceId); providerSessionId is only a hint.
    const first = connect(root, cwd, "claude-session-a");
    const second = connect(root, cwd, "claude-session-b");

    assert.match(first.instance, /^claude:[a-z0-9._-]+:[a-f0-9]{12}$/);
    assert.equal(second.instance, first.instance);
    assert.equal(first.identity.action, "mint");
    assert.equal(second.identity.action, "reclaim");

    const store = createLocalStore({ root });
    assert.equal(store.listInstances().length, 1, "one identity per workspace, not per session");
    assert.equal(store.listInstanceKeys(first.instance).length, 1);
    assert.equal(existsSync(first.identity.privateKeyPath), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("connect reclaims the same perennial identity for the same provider session and local key", () => {
  const { cwd, root } = freshWorkspace();
  try {
    const first = connect(root, cwd, "claude-session-stable");
    const second = connect(root, cwd, "claude-session-stable");

    assert.equal(second.instance, first.instance);
    assert.equal(second.identity.action, "reclaim");
    assert.equal(createLocalStore({ root }).listInstances().length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("inbox read on the perennial instance also reads its legacy alias inbox with dedup", () => {
  const { cwd, root } = freshWorkspace();
  try {
    const connected = connect(root, cwd, "claude-session-legacy-mail");
    const legacyInstance = `claude:${basename(cwd)}`;

    const store = createLocalStore({ root });
    store.putInboxMessage(connected.instance, env("env:dup", "current wins"));
    store.putInboxMessage(legacyInstance, env("env:dup", "legacy duplicate"));
    store.putInboxMessage(legacyInstance, env("env:legacy-only", "legacy only"));

    const streams = captureStreams(cwd);
    const rc = runCli(["inbox", "read", "--root", root, "--instance", connected.instance], streams);
    assert.equal(rc, 0, streams.stderrText);
    const messages = JSON.parse(streams.stdoutText);

    assert.deepEqual(messages.map((message) => message.id), ["env:dup", "env:legacy-only"]);
    assert.equal(messages.find((message) => message.id === "env:dup").body.text, "current wins");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
