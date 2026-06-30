import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  chainBlockageNotifier,
  commandNotifier,
  pollingNotifier,
  runCli
} from "../dist/index.js";

function run(argv) {
  let stdout = "";
  let stderr = "";
  const rc = runCli(argv, {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) }
  });
  return { rc, stdout, stderr };
}

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-blockage-"));
  return { dir, root: join(dir, ".h2a") };
}

test("blockage raise → list → resolve lifecycle", () => {
  const { dir, root } = freshRoot();
  try {
    run(["init", "--root", root]);

    const raised = run([
      "blockage", "raise", "--root", root,
      "--instance", "claude:p1", "--scope", "scope:team",
      "--reason", "needs token", "--needs", "provision TOKEN_X"
    ]);
    assert.equal(raised.rc, 0, raised.stderr);
    const b = JSON.parse(raised.stdout);
    assert.equal(b.ok, true);
    assert.equal(b.instance, "claude:p1");
    assert.equal(b.reason, "needs token");
    assert.equal(b.needs, "provision TOKEN_X");
    assert.ok(b.raisedAt);
    assert.equal(b.resolvedAt, undefined);

    // list (active filter)
    const active = JSON.parse(run(["blockage", "list", "--root", root, "--active"]).stdout);
    assert.equal(active.length, 1);
    assert.equal(active[0].instance, "claude:p1");

    // resolve
    const resolved = run(["blockage", "resolve", "--root", root, "--instance", "claude:p1", "--by", "principal:fab"]);
    assert.equal(resolved.rc, 0, resolved.stderr);
    const r = JSON.parse(resolved.stdout);
    assert.ok(r.resolvedAt);
    assert.equal(r.resolvedBy, "principal:fab");

    // now no active blockages, but the record remains
    assert.equal(JSON.parse(run(["blockage", "list", "--root", root, "--active"]).stdout).length, 0);
    assert.equal(JSON.parse(run(["blockage", "list", "--root", root]).stdout).length, 1);

    // resolve is idempotent — keeps the first resolution
    const again = JSON.parse(run(["blockage", "resolve", "--root", root, "--instance", "claude:p1"]).stdout);
    assert.equal(again.resolvedAt, r.resolvedAt);
    assert.equal(again.resolvedBy, "principal:fab");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blockage raise requires --reason; resolve of an unknown instance exits 2", () => {
  const { dir, root } = freshRoot();
  try {
    run(["init", "--root", root]);
    const noReason = run(["blockage", "raise", "--root", root, "--instance", "x"]);
    assert.equal(noReason.rc, 1);
    assert.match(noReason.stderr, /--reason/);

    const ghost = run(["blockage", "resolve", "--root", root, "--instance", "ghost:1"]);
    assert.equal(ghost.rc, 2);
    assert.match(ghost.stderr, /no blockage recorded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commandNotifier substitutes the template + runs the wake command", () => {
  const calls = [];
  const runtime = { run: (file, args) => (calls.push([file, ...args]), true) };
  const notifier = commandNotifier({
    command: ["wake", "--to", "{peer}", "--about", "{instance}", "--why", "{reason}"],
    runtime
  });
  const ok = notifier.notify(
    { instance: "claude:p1", scope: "s", reason: "needs token", raisedAt: "t" },
    { instance: "codex:p2", host: "codex" }
  );
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ["wake", "--to", "codex:p2", "--about", "claude:p1", "--why", "needs token"]);
});

test("pollingNotifier declines (poll-only); chain falls through to command", async () => {
  const calls = [];
  const runtime = { run: (file, args) => (calls.push([file, ...args]), true) };
  const poll = pollingNotifier();
  assert.equal(poll.notify({ instance: "a", scope: "s", reason: "r", raisedAt: "t" }, { instance: "b" }), false);

  const chain = chainBlockageNotifier(poll, commandNotifier({ command: ["wake", "{peer}"], runtime }));
  const ok = await chain.notify({ instance: "a", scope: "s", reason: "r", raisedAt: "t" }, { instance: "b" });
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ["wake", "b"]);
});

test("blockage list --instance is the EVO-3 poll digest (only my effective scopes)", () => {
  const { dir, root } = freshRoot();
  try {
    run(["init", "--root", root]);
    const reg = {
      id: "reg-agy",
      instance: "agy:1",
      roles: ["AGENTS"],
      scopes: ["scope:team-a"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    assert.equal(run(["register", "--root", root, "--json", JSON.stringify(reg)]).rc, 0);

    run(["blockage", "raise", "--root", root, "--instance", "x:1", "--scope", "scope:team-a", "--reason", "A"]);
    run(["blockage", "raise", "--root", root, "--instance", "y:1", "--scope", "scope:team-b", "--reason", "B"]);

    // agy:1 belongs only to scope:team-a → digest shows just that blockage
    const digest = JSON.parse(run(["blockage", "list", "--root", root, "--instance", "agy:1", "--active"]).stdout);
    assert.equal(digest.length, 1);
    assert.equal(digest[0].scope, "scope:team-a");

    // sanity: unfiltered list still shows both
    const all = JSON.parse(run(["blockage", "list", "--root", root, "--active"]).stdout);
    assert.equal(all.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
