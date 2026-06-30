import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  reapAllDeadPresence,
  reapDeadInstancePresence,
  runCli,
  runMcpStdio,
  writePresence
} from "../dist/index.js";

/** A minimal-but-valid presence session (mirrors SessionRegistry.open output). */
function sess(sessionId, instance, pid) {
  return {
    sessionId,
    instance,
    host: "claude",
    pid,
    startedAt: "2026-06-10T00:00:00.000Z",
    heartbeatAt: "2026-06-10T00:00:00.000Z",
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  };
}

function presenceInstances(root) {
  const dir = join(root, "presence");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

const LIVE = process.pid;

test("reapDeadInstancePresence: reaps SAME-instance dead-pid presence, keeps live + caller + other instances", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-reap-inst-"));
  try {
    writePresence(root, sess("sess:keep-live", "claude:x", LIVE)); // caller, live
    writePresence(root, sess("sess:x-dead-1", "claude:x", 11111)); // reap
    writePresence(root, sess("sess:x-dead-2", "claude:x", 33333)); // reap
    writePresence(root, sess("sess:y-dead", "claude:y", 22222)); // other instance: keep

    // Injected liveness probe: only the current process is "alive".
    const reaped = reapDeadInstancePresence(
      root,
      "claude:x",
      "sess:keep-live",
      (pid) => pid === LIVE
    );

    assert.deepEqual([...reaped].sort(), ["sess:x-dead-1", "sess:x-dead-2"]);
    const left = presenceInstances(root).map((s) => s.sessionId).sort();
    assert.deepEqual(left, ["sess:keep-live", "sess:y-dead"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reapDeadInstancePresence: keepSessionId is never reaped even if its pid reads dead", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-reap-keep-"));
  try {
    writePresence(root, sess("sess:self", "claude:x", 99999)); // caller, pid reads dead
    const reaped = reapDeadInstancePresence(root, "claude:x", "sess:self", () => false);
    assert.deepEqual(reaped, []);
    assert.ok(existsSync(join(root, "presence", "sess__self.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reapAllDeadPresence: reaps EVERY dead-pid presence across instances, keeps live", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-reap-all-"));
  try {
    writePresence(root, sess("sess:live", "claude:x", LIVE));
    writePresence(root, sess("sess:x-dead", "claude:x", 11111));
    writePresence(root, sess("sess:y-dead", "claude:y", 22222));

    const reaped = reapAllDeadPresence(root, (pid) => pid === LIVE);
    assert.equal(reaped.length, 2);
    assert.deepEqual(reaped.map((r) => r.sessionId).sort(), ["sess:x-dead", "sess:y-dead"]);
    assert.deepEqual([...new Set(reaped.map((r) => r.instance))].sort(), ["claude:x", "claude:y"]);

    const left = presenceInstances(root).map((s) => s.sessionId);
    assert.deepEqual(left, ["sess:live"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: abort signal shuts down gracefully and closes presence (no false-live)", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-abort-"));
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let errText = "";
  stderr.on("data", (c) => (errText += c.toString()));
  const ac = new AbortController();
  try {
    const done = runMcpStdio({
      root,
      stdin,
      stdout,
      stderr,
      signal: ac.signal,
      autoOpen: { instance: "claude:abortproj", host: "claude" }
    });
    await new Promise((r) => setTimeout(r, 60));
    // presence exists while connected
    assert.ok(
      presenceInstances(root).some((s) => s.instance === "claude:abortproj"),
      "presence should exist after auto-open"
    );
    // host kill → abort → graceful shutdown closes the session (presence removed)
    ac.abort();
    await done;
    assert.equal(
      presenceInstances(root).some((s) => s.instance === "claude:abortproj"),
      false,
      "presence must be cleared on graceful shutdown (closed, not false-live)"
    );
    assert.match(errText, /auto-opened session for claude:abortproj/);
  } finally {
    stdin.end();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cmdPresenceReap (CLI): keeps live presence, reaps a genuinely-dead pid; reports JSON", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-reap-cli-"));
  try {
    // A genuinely-dead pid: spawn a node that exits, then await its exit so the
    // kernel has reaped it (process.kill(pid,0) → ESRCH).
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = child.pid;
    await new Promise((r) => child.on("exit", r));
    await new Promise((r) => setTimeout(r, 30));

    writePresence(root, sess("sess:cli-live", "claude:z", LIVE));
    writePresence(root, sess("sess:cli-dead", "claude:z", deadPid));

    let out = "";
    const streams = {
      stdout: { write: (c) => void (out += c) },
      stderr: { write: () => {} }
    };
    const rc = runCli(["presence-reap", "--root", root], streams);
    assert.equal(rc, 0);
    const report = JSON.parse(out);
    assert.equal(report.ok, true);
    assert.equal(report.scope, "all-dead-pid");
    assert.equal(report.count, 1);
    assert.equal(report.reaped[0].sessionId, "sess:cli-dead");

    // live presence survived
    const left = presenceInstances(root).map((s) => s.sessionId);
    assert.deepEqual(left, ["sess:cli-live"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cmdPresenceReap (CLI): --instance scopes the reap label", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-reap-cli-inst-"));
  try {
    writePresence(root, sess("sess:live", "claude:z", LIVE));
    let out = "";
    const streams = { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } };
    const rc = runCli(["presence-reap", "--root", root, "--instance", "claude:z"], streams);
    assert.equal(rc, 0);
    const report = JSON.parse(out);
    assert.equal(report.scope, "claude:z");
    assert.equal(report.count, 0); // live pid kept
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
