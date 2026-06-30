import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { resolveAutoOpen, runMcpStdio } from "../dist/index.js";

test("resolveAutoOpen: undefined when --auto-open absent", () => {
  assert.equal(resolveAutoOpen({}, () => "/x/proj"), undefined);
});

test("resolveAutoOpen: explicit --instance wins; else <host>:<cwd-leaf>", () => {
  const cwd = mkdtempSync(join(tmpdir(), "h2a-autoopen-cwd-"));
  const root = join(mkdtempSync(join(tmpdir(), "h2a-autoopen-root-")), ".h2a");
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "claude-autoopen-session";
  try {
  assert.deepEqual(
    resolveAutoOpen(
      { "auto-open": "true", host: "claude", instance: "claude:custom", root },
      () => cwd
    ),
    { instance: "claude:custom", host: "claude" }
  );
  const resolved = resolveAutoOpen({ "auto-open": "true", host: "claude", root }, () => cwd);
  assert.match(resolved.instance, /^claude:h2a-autoopen-cwd-[a-z0-9]+:[a-f0-9]{12}$/);
  assert.equal(resolved.host, "claude");
  assert.equal(resolved.name, basename(cwd));
  assert.equal(resolved.workspace.id.startsWith("ws:"), true);
  // no host → "agent:<leaf>"; scope carried through
  const agent = resolveAutoOpen({ "auto-open": "true", scope: "scope:team", root }, () => cwd);
  assert.match(agent.instance, /^agent:h2a-autoopen-cwd-[a-z0-9]+:[a-f0-9]{12}$/);
  assert.deepEqual(agent.scopes, ["scope:team"]);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio with autoOpen writes a presence session at boot (EVO-6)", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-autoopen-"));
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let errText = "";
  stderr.on("data", (c) => (errText += c.toString()));
  try {
    const done = runMcpStdio({
      root,
      stdin,
      stdout,
      stderr,
      autoOpen: { instance: "claude:proj", host: "claude" }
    });
    // give the boot path a tick to open the session + write presence
    await new Promise((r) => setTimeout(r, 60));
    const presenceDir = join(root, "presence");
    const files = readdirSync(presenceDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 1, "a presence file should exist after auto-open");
    const sessions = files.map((f) => JSON.parse(readFileSync(join(presenceDir, f), "utf8")));
    const mine = sessions.find((s) => s.instance === "claude:proj");
    assert.ok(mine, "the auto-opened session should be present");
    assert.equal(mine.host, "claude");
    assert.match(errText, /auto-opened session for claude:proj/);
    // shut down cleanly
    stdin.end();
    await done;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
