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
import { HARNESS_SKILLS } from "../dist/vendor/harness/index.js";
import { memorySkillConsumer, sha256 } from './helpers/memory-skill-consumer.mjs';
import { statSync } from 'node:fs';

for (const scope of ['user', 'project']) for (const host of ['claude', 'codex', 'muse', 'vibe', 'agy']) {
  for (const previousReceipt of [false, true]) test(`${host}/${scope} refused first install ${previousReceipt ? 'preserves the previous receipt' : 'creates no receipt'}`, t => {
    const fixture = memorySkillConsumer(t);
    const root = scope === 'project' ? join(fixture.lane, `.${host === 'agy' ? 'gemini' : host}`)
      : join(fixture.home, host === 'agy' ? '.gemini' : host === 'muse' ? '.config/muse' : `.${host}`);
    const target = join(root, host === 'agy' ? 'commands/engram-memory.toml' : 'skills/engram-memory/SKILL.md');
    const resources = host === 'agy'
      ? join(root, scope === 'project' ? 'skill-resources' : '.h2a-install/skill-resources', 'engram/0.22.1/engram-memory')
      : join(root, 'skills/engram-memory');
    const receipt = join(resources, '.h2a-source.json');
    const custom = host === 'agy' ? 'description = "Personal memory"\nprompt = "Personal instructions"\n'
      : '---\nname: engram-memory\ndescription: Personal memory\n---\nOnly owner-authored instructions.\n';
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, custom);
    const oldReceipt = JSON.stringify({ package: '@sentropic/engram', version: '0.22.0', renderedSha256: sha256(custom) }) + '\n';
    if (previousReceipt) {
      mkdirSync(resources, { recursive: true });
      writeFileSync(receipt, oldReceipt);
    }
    const args = ['install-skills', '--host', host, '--scope', scope];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = fixture.cli(args);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(readFileSync(target, 'utf8'), custom);
      if (previousReceipt) assert.equal(readFileSync(receipt, 'utf8'), oldReceipt, 'refusal must leave the previous receipt untouched');
      else assert.equal(existsSync(receipt), false, 'refusal must not attest bytes that were never installed');
      assert.equal(existsSync(join(resources, 'assets/guide.md')), false, 'refusal must not install resources from the rejected producer');
    }
  });
}

test('memory skill installs from the producer with provenance and idempotent native rendering in both scopes', t => {
  const fixture = memorySkillConsumer(t);
  for (const host of ['claude', 'codex', 'muse', 'vibe', 'agy']) for (const scope of ['user', 'project']) {
    const args = ['install-skills', '--host', host, '--scope', scope];
    const first = fixture.cli(args);
    assert.equal(first.status, 0, first.stderr);
    const report = first.json(), source = report.sources.find(s => s.source === 'engram');
    assert.ok(source, `${host}/${scope}: engram source must be reported`);
    assert.equal(source.package, '@sentropic/engram');
    assert.equal(source.version, '0.22.1');
    assert.equal(source.status, 'available');
    assert.equal(source.count, 1);
    assert.deepEqual(source.skills, [{ name: 'engram-memory', path: 'skills/engram-memory/SKILL.md', sha256: sha256(fixture.raw) }]);
    const target = host === 'agy' ? join(report.targetBase, 'engram-memory.toml') : join(report.targetBase, 'engram-memory/SKILL.md');
    const bytes = readFileSync(target);
    if (host !== 'agy') assert.equal(bytes.toString(), fixture.raw);
    else assert.match(bytes.toString(), /engram_memory_search/);
    const receiptPath = host === 'agy'
      ? join(report.targetBase, '..', scope === 'project' ? 'skill-resources' : '.h2a-install/skill-resources', 'engram', '0.22.1', 'engram-memory', '.h2a-source.json')
      : join(report.targetBase, 'engram-memory/.h2a-source.json');
    const receipt = JSON.parse(readFileSync(receiptPath));
    assert.deepEqual(receipt, { package: '@sentropic/engram', version: '0.22.1', path: 'skills/engram-memory/SKILL.md', sha256: sha256(fixture.raw), renderedSha256: sha256(bytes) });
    const before = statSync(target).mtimeMs;
    const second = fixture.cli(args);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.json().installed, [], `${host}/${scope}: reinstall must be a no-op`);
    assert.equal(statSync(target).mtimeMs, before);
    assert.deepEqual(readFileSync(target), bytes);
    const custom = 'Owner custom memory instructions.\n';
    writeFileSync(target, custom);
    const unrelated = join(report.targetBase, 'personal.txt'); writeFileSync(unrelated, 'unrelated\n');
    assert.equal(fixture.cli(args).status, 2, `${host}/${scope}: customization is a conflict`);
    assert.equal(readFileSync(target, 'utf8'), custom);
    assert.equal(readFileSync(unrelated, 'utf8'), 'unrelated\n');
  }
});

test('missing producer package and missing memory SKILL.md are reported explicitly without deleting existing memory', t => {
  const fixture = memorySkillConsumer(t);
  const args = ['install-skills', '--host', 'muse'];
  assert.equal(fixture.cli(args).status, 0);
  const target = join(fixture.home, '.config/muse/skills/engram-memory/SKILL.md');
  const retired = join(fixture.home, '.config/muse/skills/retired/SKILL.md');
  mkdirSync(join(retired, '..'), { recursive: true }); writeFileSync(retired, 'retired managed h2a skill\n');
  const manifestPath = join(fixture.home, '.config/muse/.h2a-install/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.files['skills/retired/SKILL.md'] = { sha256: sha256(readFileSync(retired)), source: 'h2a@0.98.7/retired', selected: true };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  rmSync(join(fixture.skill, 'SKILL.md'));
  for (const absentPackage of [false, true]) {
    if (absentPackage) rmSync(fixture.producer, { recursive: true });
    const result = fixture.cli(args), source = result.json().sources.find(s => s.source === 'engram');
    assert.equal(source?.status, 'missing');
    assert.deepEqual(source.missing, ['skills/engram-memory/SKILL.md']);
    assert.equal(source.count, 0);
    assert.match(result.stderr, /missing.*@sentropic\/engram.*skills\/engram-memory\/SKILL\.md/);
    assert.equal(readFileSync(target, 'utf8'), fixture.raw, 'an unavailable source cannot authorize pruning');
    assert.equal(existsSync(retired), false, 'an optional missing producer must not disable core pruning');
  }
});

// The four Track skills; harness-track-report is the sole report contract.
const TRACK_SKILLS = [
  "branch-lifecycle",
  "present-decision",
  "propose-workpackages",
  "track-operation"
];
// Every harness skill is rendered under the `harness-` prefix (anti-collision).
const HARNESS_INSTALL_NAMES = HARNESS_SKILLS.map((s) => `harness-${s.name}`);

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

test("install-skills user scope follows configured Claude and Codex roots", () => {
  const home = freshCwd();
  const cwd = freshCwd();
  const configuredClaude = join(home, "configured-claude");
  const configuredCodex = join(home, "configured-codex");
  const previousHome = process.env.HOME;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = configuredClaude;
    process.env.CODEX_HOME = configuredCodex;
    for (const [host, expected] of [
      ["claude", join(configuredClaude, "skills")],
      ["codex", join(configuredCodex, "skills")]
    ]) {
      const streams = captureStreams(cwd);
      assert.equal(runCli(["install-skills", "--host", host, "--scope", "user"], streams), 0, streams.stderrText);
      assert.equal(JSON.parse(streams.stdoutText).targetBase, expected);
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills user scope preserves default Claude and Codex roots", () => {
  const home = freshCwd();
  const cwd = freshCwd();
  const previousHome = process.env.HOME;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    process.env.HOME = home;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CODEX_HOME;
    for (const host of ["claude", "codex"]) {
      const streams = captureStreams(cwd);
      assert.equal(runCli(["install-skills", "--host", host, "--scope", "user"], streams), 0, streams.stderrText);
      assert.equal(JSON.parse(streams.stdoutText).targetBase, join(home, `.${host}`, "skills"));
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host claude renders h2a + track + harness from a single source each", () => {
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

    // h2a's own unified skill (DEC-057) is still present, verbatim.
    const h2aFile = parsed.installed.find((f) =>
      f.endsWith(`${sep}h2a${sep}SKILL.md`)
    );
    assert.ok(h2aFile, `expected an h2a/SKILL.md among ${parsed.installed}`);
    assert.ok(existsSync(h2aFile));
    const body = readFileSync(h2aFile, "utf8");
    assert.match(body, /^---/, "must preserve YAML frontmatter");
    assert.match(body, /^name: h2a$/m);
    assert.match(body, /\/h2a connect/);
    assert.match(body, /\/h2a discover/);
    assert.match(body, /\/h2a send/);
    assert.match(body, /\/h2a negotiate/);
    assert.match(body, /exactly one active `mcpServers\.h2a` endpoint/);
    assert.match(body, /Never configure, call, or suggest `track-mcp`/);

    // Track is an independently packaged source. Read this worktree's shipped
    // source directly so this isolated test never follows a parent checkout's
    // already-built workspace link.
    const trackOperation = readFileSync(
      new URL("../../track/skills/track-operation/SKILL.md", import.meta.url),
      "utf8"
    );
    assert.match(trackOperation, /MCP remains read-only/);
    assert.match(trackOperation, /Never configure `track-mcp`/);

    // track skills rendered from @sentropic/track (native names).
    for (const t of TRACK_SKILLS) {
      assert.ok(
        parsed.installed.some((f) => f.endsWith(`${sep}${t}${sep}SKILL.md`)),
        `expected track skill ${t} among installed`
      );
    }
    // harness skills rendered from @sentropic/harness under the harness- prefix.
    for (const h of HARNESS_INSTALL_NAMES) {
      assert.ok(
        parsed.installed.some((f) => f.endsWith(`${sep}${h}${sep}SKILL.md`)),
        `expected harness skill ${h} among installed`
      );
    }

    // Provenance summary: one entry per single source, with resolved dir + count.
    const bySource = Object.fromEntries(parsed.sources.map((s) => [s.source, s]));
    assert.ok(bySource.h2a.count >= 1);
    assert.equal(bySource.track.count, TRACK_SKILLS.length);
    assert.equal(bySource.harness.count, HARNESS_INSTALL_NAMES.length);
    for (const s of ["h2a", "track", "harness"]) {
      assert.ok(bySource[s].dir && existsSync(bySource[s].dir), `${s} source dir must resolve`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const [host, projectDir] of [
  ["codex", ".codex"],
  ["hermes", ".hermes"],
  ["opencode", ".opencode"],
  ["muse", ".muse"]
]) {
  test(`install-skills --host ${host} renders the same three sources under ${projectDir}`, () => {
    const cwd = freshCwd();
    try {
      const streams = captureStreams(cwd);
      const rc = runCli(
        ["install-skills", "--host", host, "--scope", "project"],
        streams
      );
      assert.equal(rc, 0, streams.stderrText);
      const parsed = JSON.parse(streams.stdoutText);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.host, host);
      assert.equal(parsed.targetBase, join(cwd, projectDir, "skills"));
      for (const name of ["h2a", "track-operation", "harness-brainstorm"]) {
        assert.ok(
          parsed.installed.some(
            (f) =>
              f.includes(`${sep}${projectDir}${sep}skills${sep}`) &&
              f.endsWith(`${sep}${name}${sep}SKILL.md`)
          ),
          `expected ${name} under ${projectDir}/skills`
        );
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test("install-skills --host gemini renders every source as a .toml custom command", () => {
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
    // h2a + track + harness all rendered as TOML.
    for (const name of ["h2a", "track-operation", "harness-brainstorm"]) {
      assert.ok(
        parsed.installed.some((f) => f.endsWith(`${sep}${name}.toml`)),
        `expected ${name}.toml`
      );
    }
    const h2aToml = parsed.installed.find((f) => f.endsWith(`${sep}h2a.toml`));
    const body = readFileSync(h2aToml, "utf8");
    assert.match(body, /^description = "/);
    assert.match(body, /^prompt = '''$/m);
    assert.match(body, /custom command for Gemini CLI/);
    assert.match(body, /\/h2a connect/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host agy renders the .toml commands + emits an importHint (DEC-101)", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "agy", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "agy");
    // agy shares the gemini location (~/.gemini/commands), here project-scoped.
    assert.equal(parsed.targetBase, join(cwd, ".gemini", "commands"));
    assert.ok(
      parsed.installed.some((f) => f.endsWith(`${sep}h2a.toml`)),
      "expected h2a.toml"
    );
    assert.ok(
      parsed.installed.some((f) => f.endsWith(`${sep}harness-plan.toml`)),
      "expected harness-plan.toml"
    );
    // agy has no own skill store → the summary tells the user to import it.
    assert.match(parsed.importHint, /agy plugin import gemini/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host muse renders SKILL.md dirs + emits a verifyHint", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "muse", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "muse");
    // muse owns its store; project scope follows the $CONFIG_DIR layout.
    assert.equal(parsed.targetBase, join(cwd, ".muse", "skills"));
    assert.ok(
      parsed.installed.some((f) => f.endsWith(`${sep}h2a${sep}SKILL.md`)),
      "expected h2a/SKILL.md"
    );
    // No import step — the summary tells the user how to verify pickup.
    assert.match(parsed.verifyHint, /muse skills list/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills --host vibe renders SKILL.md dirs + emits a verifyHint", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "vibe", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "vibe");
    // vibe discovers skills from .vibe/skills (project scope) or ~/.vibe/skills.
    assert.equal(parsed.targetBase, join(cwd, ".vibe", "skills"));
    assert.ok(
      parsed.installed.some((f) => f.endsWith(`${sep}h2a${sep}SKILL.md`)),
      "expected h2a/SKILL.md"
    );
    // No import step — the summary tells the user how to verify pickup.
    assert.match(parsed.verifyHint, /session open/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills renders harness-* from h2a-owned vendored harness skills (SOURCE UNIQUE, no external package)", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "claude", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);

    // The harness source is now h2a-owned: no external @sentropic/harness
    // package, no standalone harness CLI lifecycle.
    const harnessSource = parsed.sources.find((s) => s.source === "harness");
    assert.ok(harnessSource, "sources must include a harness entry");
    assert.ok(
      harnessSource.dir.endsWith(`${sep}skills${sep}harness`),
      `harness must render from h2a-owned skills, got ${harnessSource.dir}`
    );
    assert.equal(harnessSource.count, HARNESS_SKILLS.length);

    // Every manifest skill is rendered, prefixed, with a matching frontmatter
    // name (Claude/Codex reject dir ≠ name).
    for (const entry of HARNESS_SKILLS) {
      const installName = `harness-${entry.name}`;
      const file = parsed.installed.find((f) =>
        f.endsWith(`${sep}${installName}${sep}SKILL.md`)
      );
      assert.ok(file, `expected rendered ${installName}`);
      const body = readFileSync(file, "utf8");
      assert.match(
        body,
        new RegExp(`^name: ${installName}$`, "m"),
        `${installName} frontmatter name must be rewritten to match its directory`
      );
    }
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

test("install-skills preserves unknown legacy commands in the shared agy/Gemini store", () => {
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
    assert.deepEqual(parsed.prunedLegacy, []);
    for (const legacy of ["h2a-connect", "h2a-discover", "h2a-send"]) {
      assert.equal(readFileSync(join(base, `${legacy}.toml`), 'utf8'), `description = "legacy"\nprompt = '''old'''\n`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install-skills refuses overwrite without --force on any host", () => {
  for (const host of ["claude", "codex", "gemini", "vibe", "muse", "agy"]) {
    const cwd = freshCwd();
    try {
      // Initial install
      let streams = captureStreams(cwd);
      assert.equal(
        runCli(["install-skills", "--host", host, "--scope", "project"], streams),
        0,
        streams.stderrText
      );
      // Identical reinstall is a no-op. Only customized bytes need --force.
      streams = captureStreams(cwd);
      assert.equal(runCli(["install-skills", "--host", host, "--scope", "project"], streams), 0);
      assert.deepEqual(JSON.parse(streams.stdoutText).installed, []);
      const target = host === 'gemini' || host === 'agy'
        ? join(cwd, '.gemini/commands/h2a.toml') : join(cwd, `.${host}/skills/h2a/SKILL.md`);
      writeFileSync(target, 'Owner customized instructions.\n');
      // Customized reinstall without --force → exit 2, reported as skipped.
      streams = captureStreams(cwd);
      const rc = runCli(
        ["install-skills", "--host", host, "--scope", "project"],
        streams
      );
      assert.equal(rc, 2);
      const parsed = JSON.parse(streams.stdoutText);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.skipped.length > 0);
      assert.equal(readFileSync(target, 'utf8'), 'Owner customized instructions.\n');
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
    assert.match(streams.stderrText, /Supported: claude, codex, gemini, agy, hermes, opencode, muse, vibe\./);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
