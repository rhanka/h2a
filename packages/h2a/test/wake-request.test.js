import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, runCli, writePresence } from "../dist/index.js";

function runWake(root, args) {
  let out = "";
  let err = "";
  const streams = {
    stdout: { write: (c) => void (out += c) },
    stderr: { write: (c) => void (err += c) }
  };
  const rc = runCli(["wake-request", "--root", root, ...args], streams);
  return { rc, out, err };
}

function remotePresence(instance, pane) {
  const now = new Date().toISOString();
  return {
    sessionId: `sess:${instance}`,
    instance,
    host: "remote",
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...(pane
      ? { launchContext: { cwd: "/x", command: "remote serve", tmux: { session: "r", pane } } }
      : {})
  };
}

test("wake-request: emits a signed wake-request envelope to the remote inbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-wake-"));
  const root = join(dir, ".h2a");
  try {
    const target = "codex:foo:aaaaaaaaaaaa";
    const remote = "remote:r:cccccccccccc";
    const { rc, out } = runWake(root, [
      "--to", target,
      "--instance", "claude:cond:bbbbbbbbbbbb",
      "--remote", remote
    ]);
    assert.equal(rc, 0);
    const report = JSON.parse(out);
    assert.equal(report.action, "emitted");
    assert.equal(report.to, remote);
    assert.equal(report.request.kind, "wake-request");
    assert.equal(report.request.target, target);
    // Self-describing: the exact CLI line the launcher should type into the
    // target's pane — full, runnable (the bare `h2a inbox read` errors).
    assert.equal(
      report.request.instructionLine,
      `h2a inbox read --instance ${target} --root ${root}`
    );

    const store = createLocalStore({ root });
    const inbox = store.readInbox(remote);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].body.topic, "wake-request");
    assert.equal(inbox[0].body.request.target, target);
    assert.match(inbox[0].body.request.instructionLine, /^h2a inbox read --instance codex:foo:/);
    assert.equal(inbox[0].actor.instance, "claude:cond:bbbbbbbbbbbb");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wake-request: prefers a pane-bearing live remote when --remote is omitted", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-wake-resolve-"));
  const root = join(dir, ".h2a");
  try {
    writePresence(root, remotePresence("remote:nopane:111111111111")); // no pane
    writePresence(root, remotePresence("remote:withpane:222222222222", "%7")); // pane → preferred
    const { rc, out } = runWake(root, [
      "--to", "codex:foo:aaaaaaaaaaaa",
      "--instance", "claude:cond:bbbbbbbbbbbb"
    ]);
    assert.equal(rc, 0);
    assert.equal(JSON.parse(out).to, "remote:withpane:222222222222");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wake-request: --dry-run previews without emitting", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-wake-dry-"));
  const root = join(dir, ".h2a");
  try {
    const { rc, out } = runWake(root, ["--to", "codex:foo:aaaaaaaaaaaa", "--remote", "remote:r:cccccccccccc", "--dry-run"]);
    assert.equal(rc, 0);
    assert.equal(JSON.parse(out).action, "would-emit");
    const store = createLocalStore({ root });
    assert.equal(store.readInbox("remote:r:cccccccccccc").length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wake-request: no live remote (and no --remote) → action no-remote, nothing emitted", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-wake-noremote-"));
  const root = join(dir, ".h2a");
  try {
    const { rc, out } = runWake(root, ["--to", "codex:foo:aaaaaaaaaaaa", "--instance", "claude:cond:bbbbbbbbbbbb"]);
    assert.equal(rc, 0);
    assert.equal(JSON.parse(out).action, "no-remote");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wake-request: --to is required", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-wake-noto-"));
  const root = join(dir, ".h2a");
  try {
    const { rc, err } = runWake(root, ["--instance", "claude:cond:bbbbbbbbbbbb"]);
    assert.equal(rc, 1);
    assert.match(err, /--to <instance> is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
