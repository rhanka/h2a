import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../dist/index.js";

function plugin(host, instance = "claude:p1") {
  let stdout = "";
  let stderr = "";
  const rc = runCli(["host", "plugin", "--host", host, "--instance", instance], {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) }
  });
  return { rc, stdout, stderr };
}

test("host plugin renders a push-capable stop hook for claude/codex/gemini", () => {
  for (const host of ["claude", "codex", "gemini"]) {
    const { rc, stdout } = plugin(host);
    assert.equal(rc, 0, `${host} should render`);
    const r = JSON.parse(stdout);
    assert.equal(r.host, host);
    assert.equal(r.push, true, `${host} can be push-notified`);
    assert.equal(r.poll, undefined);
    // The hook records a stop with the launch context D3 needs.
    assert.match(r.record, /h2a drumbeat record --instance claude:p1 --status paused/);
    assert.match(r.record, /\$TMUX_PANE/);
    assert.ok(r.mechanism && r.hint);
  }
});

test("host plugin marks agy as poll-only (no daemon) with a poll command", () => {
  const { rc, stdout } = plugin("agy");
  assert.equal(rc, 0);
  const r = JSON.parse(stdout);
  assert.equal(r.host, "agy");
  assert.equal(r.push, false);
  assert.match(r.poll, /h2a drumbeat scan/);
  assert.equal(r.mechanism, "agy-plugin-poll");
});

test("host plugin rejects an unknown host and requires --instance", () => {
  assert.equal(plugin("borg").rc, 1);
  const noInstance = runCli(["host", "plugin", "--host", "claude"], {
    stdout: { write: () => {} },
    stderr: { write: () => {} }
  });
  assert.equal(noInstance, 1);
});
