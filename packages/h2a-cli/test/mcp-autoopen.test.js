import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { resolveAutoOpen, runMcpStdio } from "../dist/index.js";

test("resolveAutoOpen: undefined when --auto-open absent", () => {
  assert.equal(resolveAutoOpen({}, () => "/x/proj"), undefined);
});

test("resolveAutoOpen: explicit --instance wins; else <host>:<cwd-leaf>", () => {
  assert.deepEqual(
    resolveAutoOpen({ "auto-open": "true", host: "claude", instance: "claude:custom" }, () => "/home/u/proj"),
    { instance: "claude:custom", host: "claude" }
  );
  assert.deepEqual(
    resolveAutoOpen({ "auto-open": "true", host: "codex" }, () => "/home/u/my-app"),
    { instance: "codex:my-app", host: "codex" }
  );
  // no host → "agent:<leaf>"; scope carried through
  assert.deepEqual(
    resolveAutoOpen({ "auto-open": "true", scope: "scope:team" }, () => "/srv/x/"),
    { instance: "agent:x", scopes: ["scope:team"] }
  );
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
