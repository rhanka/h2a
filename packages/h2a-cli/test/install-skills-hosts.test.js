import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
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

test("install-skills --host claude --scope project writes the unified h2a SKILL.md (DEC-057)", () => {
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
    assert.equal(parsed.installed.length, 1, "DEC-057 consolidates to a single h2a skill");
    const file = parsed.installed[0];
    assert.ok(file.endsWith(`${sep}h2a${sep}SKILL.md`), `expected h2a/SKILL.md, got ${file}`);
    assert.ok(existsSync(file));
    const body = readFileSync(file, "utf8");
    assert.match(body, /^---/, "must preserve YAML frontmatter");
    assert.match(body, /^name: h2a$/m);
    assert.match(body, /\/h2a connect/);
    assert.match(body, /\/h2a discover/);
    assert.match(body, /\/h2a send/);
    assert.match(body, /\/h2a negotiate/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host codex --scope project writes the unified h2a SKILL.md under .codex (DEC-057)", () => {
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
    assert.equal(parsed.installed.length, 1);
    const file = parsed.installed[0];
    assert.ok(file.endsWith(`${sep}h2a${sep}SKILL.md`));
    assert.ok(file.includes(`${sep}.codex${sep}skills${sep}`));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host gemini --scope project writes a single h2a.toml custom command (DEC-057)", () => {
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
    assert.equal(parsed.installed.length, 1);
    const file = parsed.installed[0];
    assert.ok(file.endsWith(`${sep}h2a.toml`), `expected h2a.toml, got ${file}`);
    const body = readFileSync(file, "utf8");
    assert.match(body, /^description = "/);
    assert.match(body, /^prompt = '''$/m);
    assert.match(body, /custom command for Gemini CLI/);
    assert.match(body, /\/h2a connect/);
    assert.match(body, /\/h2a discover/);
    assert.match(body, /\/h2a send/);
    assert.match(body, /\/h2a negotiate/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const host of ["claude", "codex"]) {
  test(`install-skills prunes legacy h2a-connect/discover/send on ${host} (DEC-057 migration)`, () => {
    const cwd = freshCwd();
    try {
      // Plant stale legacy entries by hand.
      const base = join(cwd, `.${host}`, "skills");
      for (const legacy of ["h2a-connect", "h2a-discover", "h2a-send"]) {
        const dir = join(base, legacy);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), "---\nname: legacy\n---\nold\n");
      }
      const streams = captureStreams(cwd);
      const rc = runCli(
        ["install-skills", "--host", host, "--scope", "project"],
        streams
      );
      assert.equal(rc, 0, streams.stderrText);
      const parsed = JSON.parse(streams.stdoutText);
      assert.equal(parsed.ok, true);
      const prunedNames = parsed.prunedLegacy.map((e) => e.name).sort();
      assert.deepEqual(prunedNames, [
        "h2a-connect",
        "h2a-discover",
        "h2a-send"
      ]);
      assert.equal(existsSync(join(base, "h2a-connect")), false);
      assert.equal(existsSync(join(base, "h2a-discover")), false);
      assert.equal(existsSync(join(base, "h2a-send")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test("install-skills prunes legacy h2a-*.toml on gemini (DEC-057 migration)", () => {
  const cwd = freshCwd();
  try {
    const base = join(cwd, ".gemini", "commands");
    mkdirSync(base, { recursive: true });
    for (const legacy of ["h2a-connect", "h2a-discover", "h2a-send"]) {
      writeFileSync(join(base, `${legacy}.toml`), `description = "legacy"\nprompt = '''old'''\n`);
    }
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "gemini", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    const prunedNames = parsed.prunedLegacy.map((e) => e.name).sort();
    assert.deepEqual(prunedNames, [
      "h2a-connect",
      "h2a-discover",
      "h2a-send"
    ]);
    for (const legacy of ["h2a-connect", "h2a-discover", "h2a-send"]) {
      assert.equal(existsSync(join(base, `${legacy}.toml`)), false);
    }
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
