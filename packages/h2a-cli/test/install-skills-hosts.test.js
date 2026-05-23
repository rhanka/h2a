import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

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

function freshCwd() {
  return mkdtempSync(join(tmpdir(), "h2a-install-skills-"));
}

test("install-skills --host claude --scope project writes SKILL.md files (DEC-054)", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "claude", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "claude");
    assert.equal(parsed.targetBase, join(cwd, ".claude", "skills"));
    assert.ok(parsed.installed.length >= 3, "must install all bundled skills");
    for (const file of parsed.installed) {
      assert.ok(file.endsWith("SKILL.md"), `expected SKILL.md, got ${file}`);
      assert.ok(existsSync(file));
      const body = readFileSync(file, "utf8");
      assert.match(body, /^---/, "must preserve YAML frontmatter");
      assert.match(body, /^name: /m);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host codex --scope project writes SKILL.md files under .codex (DEC-055)", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "codex", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "codex");
    assert.equal(parsed.targetBase, join(cwd, ".codex", "skills"));
    assert.ok(parsed.installed.length >= 3);
    for (const file of parsed.installed) {
      assert.ok(file.includes(".codex/skills/"));
      assert.ok(file.endsWith("SKILL.md"));
      const body = readFileSync(file, "utf8");
      assert.match(body, /^---/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host gemini --scope project writes TOML custom commands (DEC-055)", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "gemini", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "gemini");
    assert.equal(parsed.targetBase, join(cwd, ".gemini", "commands"));
    assert.ok(parsed.installed.length >= 3);
    for (const file of parsed.installed) {
      assert.ok(file.endsWith(".toml"), `expected .toml, got ${file}`);
      assert.ok(existsSync(file));
      const body = readFileSync(file, "utf8");
      assert.match(body, /^description = "/, "TOML must declare description");
      assert.match(body, /^prompt = '''$/m, "TOML must contain a multiline prompt");
      assert.match(body, /custom command for Gemini CLI/);
    }
    // Verify h2a-connect.toml description preserves the original frontmatter text
    const connectFile = parsed.installed.find((f) => f.endsWith("h2a-connect.toml"));
    assert.ok(connectFile, "h2a-connect.toml must be produced");
    const connectBody = readFileSync(connectFile, "utf8");
    assert.match(connectBody, /Bootstrap a live h2a session/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills refuses overwrite without --force on any host", () => {
  for (const host of ["claude", "codex", "gemini"]) {
    const cwd = freshCwd();
    try {
      // Initial install
      let streams = captureStreams(cwd);
      assert.equal(
        runCli(["install-skills", "--host", host, "--scope", "project"], streams),
        0,
        streams.stderrText
      );
      // Second install without --force → exit 2, items reported as skipped
      streams = captureStreams(cwd);
      const rc = runCli(
        ["install-skills", "--host", host, "--scope", "project"],
        streams
      );
      assert.equal(rc, 2);
      const parsed = JSON.parse(streams.stdoutText);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.skipped.length > 0);
      // Third install with --force → exit 0, all overwritten
      streams = captureStreams(cwd);
      const forced = runCli(
        ["install-skills", "--host", host, "--scope", "project", "--force"],
        streams
      );
      assert.equal(forced, 0, streams.stderrText);
      const forcedParsed = JSON.parse(streams.stdoutText);
      assert.equal(forcedParsed.ok, true);
      assert.equal(forcedParsed.skipped.length, 0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test("install-skills rejects unknown host", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "claude-desktop", "--scope", "project"],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /Supported: claude, codex, gemini/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
