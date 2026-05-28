import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    assert.match(r.poll, /h2a drumbeat scan/); // poll is a manual fallback on push hosts too
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

test("host plugin --write claude merges an idempotent Stop hook into settings.json (DEC-102)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
  const settings = join(dir, "settings.json");
  try {
    // Pre-existing settings with an unrelated hook → must be preserved.
    writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] } }), "utf8");
    const run = (extra = []) => {
      let stdout = "", stderr = "";
      const rc = runCli(["host", "plugin", "--host", "claude", "--instance", "claude:p1", "--write", settings, ...extra], {
        stdout: { write: (c) => void (stdout += c) }, stderr: { write: (c) => void (stderr += c) }
      });
      return { rc, stdout, stderr };
    };
    const r1 = run();
    assert.equal(r1.rc, 0, r1.stderr);
    assert.equal(JSON.parse(r1.stdout).written, settings);
    let cfg = JSON.parse(readFileSync(settings, "utf8"));
    assert.equal(cfg.model, "opus"); // unrelated keys preserved
    assert.equal(cfg.hooks.Stop.length, 2); // unrelated hook + ours
    const ours = cfg.hooks.Stop.find((e) => e.hooks[0].command.includes("h2a drumbeat record"));
    assert.match(ours.hooks[0].command, /--instance claude:p1/);
    // Idempotent: a second write does not duplicate our hook.
    assert.equal(run().rc, 0);
    cfg = JSON.parse(readFileSync(settings, "utf8"));
    assert.equal(cfg.hooks.Stop.filter((e) => e.hooks[0].command.includes("h2a drumbeat record")).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host plugin --write gemini merges the Claude-format Stop hook into settings.json (DEC-103)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
  const settings = join(dir, "settings.json");
  try {
    writeFileSync(settings, JSON.stringify({ security: { auth: {} } }), "utf8");
    let stdout = "", stderr = "";
    const rc = runCli(["host", "plugin", "--host", "gemini", "--instance", "gemini:p1", "--write", settings], {
      stdout: { write: (c) => void (stdout += c) }, stderr: { write: (c) => void (stderr += c) }
    });
    assert.equal(rc, 0, stderr);
    assert.equal(JSON.parse(stdout).host, "gemini");
    const cfg = JSON.parse(readFileSync(settings, "utf8"));
    assert.ok(cfg.security); // unrelated keys preserved
    const ours = cfg.hooks.Stop.find((e) => e.hooks[0].command.includes("h2a drumbeat record"));
    assert.match(ours.hooks[0].command, /--instance gemini:p1/);
    assert.match(ours.hooks[0].command, /gemini -r/); // gemini's resume command
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host plugin --write is refused for codex (plugin/hook-trust) and agy (poll-only)", () => {
  for (const host of ["codex", "agy"]) {
    const dir = mkdtempSync(join(tmpdir(), "h2a-hook-"));
    try {
      let stderr = "";
      const rc = runCli(["host", "plugin", "--host", host, "--instance", `${host}:p1`, "--write", join(dir, "x.json")], {
        stdout: { write: () => {} }, stderr: { write: (c) => void (stderr += c) }
      });
      assert.equal(rc, 1, `${host} --write should be refused`);
      assert.match(stderr, /claude or gemini only/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("host plugin rejects an unknown host and requires --instance", () => {
  assert.equal(plugin("borg").rc, 1);
  const noInstance = runCli(["host", "plugin", "--host", "claude"], {
    stdout: { write: () => {} },
    stderr: { write: () => {} }
  });
  assert.equal(noInstance, 1);
});
