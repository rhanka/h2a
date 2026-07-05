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
import { HARNESS_SKILLS } from "@sentropic/harness";

// The four track skills @sentropic/track ships in `packages/track/skills/`.
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

test("install-skills --host codex renders the same three sources under .codex", () => {
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
    for (const name of ["h2a", "track-operation", "harness-brainstorm"]) {
      assert.ok(
        parsed.installed.some(
          (f) =>
            f.includes(`${sep}.codex${sep}skills${sep}`) &&
            f.endsWith(`${sep}${name}${sep}SKILL.md`)
        ),
        `expected ${name} under .codex/skills`
      );
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

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

test("install-skills renders harness-* from the @sentropic/harness package (SOURCE UNIQUE, no repo copies)", () => {
  const cwd = freshCwd();
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(
      ["install-skills", "--host", "claude", "--scope", "project"],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);

    // The harness source resolves to the INSTALLED npm package, never a copy
    // committed inside this repo's packages/ tree.
    const harnessSource = parsed.sources.find((s) => s.source === "harness");
    assert.ok(harnessSource, "sources must include a harness entry");
    assert.ok(
      harnessSource.dir.includes(`@sentropic${sep}harness${sep}skills`),
      `harness must render from the package, got ${harnessSource.dir}`
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
    assert.match(streams.stderrText, /Supported: claude, codex, gemini, agy/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
