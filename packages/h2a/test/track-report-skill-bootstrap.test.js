import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";

const SKILL_PATH = new URL("../skills/harness/track-report/SKILL.md", import.meta.url);

function extractBootstrapShellBlock() {
  const skill = readFileSync(SKILL_PATH, "utf8");
  const start = skill.search(/^## Bootstrap[^\n]*$/m);
  assert.ok(start >= 0, "SKILL.md must contain a `## Bootstrap` section");
  const rest = skill.slice(start);
  const nextHeading = rest.indexOf("\n## ", 1);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  const codeMatch = /```(?:sh|bash)\r?\n([\s\S]*?)\r?\n```/.exec(section);
  assert.ok(codeMatch, "SKILL.md `## Bootstrap` section must contain a shell code block");
  return codeMatch[1];
}

function writeFakeTrackBin(binPath, { version, ownerTable }) {
  mkdirSync(dirname(binPath), { recursive: true });
  const helpLine = ownerTable
    ? "usage: track report [--owner-table] [--status-table]\n--owner-table renders the owner status table\n"
    : "usage: track report [--status-table]\n";
  const script = [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    `if (args[0] === '--version') { process.stdout.write(${JSON.stringify(`${version}\n`)}); process.exit(0); }`,
    `if (args[0] === 'report' && args.includes('--help')) { process.stdout.write(${JSON.stringify(helpLine)}); process.exit(0); }`,
    "process.exit(0);"
  ].join("\n");
  writeFileSync(binPath, script, "utf8");
  chmodSync(binPath, 0o755);
}

function reducedEnv(home, extra = {}) {
  return {
    HOME: home,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    ...extra
  };
}

test("the skill bootstrap resolves the track binary from a shell with no rc file and no local build (TD-b)", () => {
  const block = extractBootstrapShellBlock();
  const root = mkdtempSync(join(tmpdir(), "h2a-track-bootstrap-td-b-"));
  try {
    const cwd = join(root, "empty-repo");
    const home = join(root, "home");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(home, { recursive: true });

    // 1) Global per-user npm prefix under HOME (no rc file, no local build)
    const globalBin = join(home, ".npm-global", "lib", "node_modules", "@sentropic", "track", "dist", "cli", "bin.js");
    writeFakeTrackBin(globalBin, { version: "0.98.11", ownerTable: true });

    const res = spawnSync("sh", ["-eu", "-c", block], {
      cwd,
      env: reducedEnv(home),
      encoding: "utf8"
    });
    assert.equal(res.status, 0, `bootstrap failed:\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    const printed = res.stdout.trim().split(/\r?\n/).find((line) => line.endsWith("bin.js")) ?? "";
    assert.ok(isAbsolute(printed), `expected an absolute bin.js path on stdout, got: ${JSON.stringify(res.stdout)}`);
    assert.equal(printed, globalBin);

    const help = spawnSync(process.execPath, [printed, "report", "--help"], {
      cwd,
      env: reducedEnv(home),
      encoding: "utf8"
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--owner-table/);

    // 2) Nested @sentropic/track inside globally installed @sentropic/h2a when direct global track is too old
    writeFakeTrackBin(globalBin, { version: "0.98.10", ownerTable: false });
    const nestedBin = join(
      home,
      ".npm-global",
      "lib",
      "node_modules",
      "@sentropic",
      "h2a",
      "node_modules",
      "@sentropic",
      "track",
      "dist",
      "cli",
      "bin.js"
    );
    writeFakeTrackBin(nestedBin, { version: "0.98.11", ownerTable: true });

    const nestedRes = spawnSync("sh", ["-eu", "-c", block], {
      cwd,
      env: reducedEnv(home),
      encoding: "utf8"
    });
    assert.equal(nestedRes.status, 0, `nested bootstrap failed:\nstdout: ${nestedRes.stdout}\nstderr: ${nestedRes.stderr}`);
    const nestedPrinted = nestedRes.stdout.trim().split(/\r?\n/).find((line) => line.endsWith("bin.js")) ?? "";
    assert.equal(nestedPrinted, nestedBin);

    // 3) Never falls back to a bare `track` on PATH; fails with one sentence naming what was tried
    const emptyHome = join(root, "empty-home");
    const fakePathBinDir = join(root, "fake-path-bin");
    mkdirSync(emptyHome, { recursive: true });
    mkdirSync(fakePathBinDir, { recursive: true });
    const fakeBareTrack = join(fakePathBinDir, "track");
    writeFakeTrackBin(fakeBareTrack, { version: "0.98.11", ownerTable: true });

    const failRes = spawnSync("sh", ["-eu", "-c", block], {
      cwd,
      env: reducedEnv(emptyHome, { PATH: `${fakePathBinDir}:${dirname(process.execPath)}:/usr/bin:/bin` }),
      encoding: "utf8"
    });
    assert.notEqual(failRes.status, 0, "bootstrap must fail when only a bare `track` on PATH exists");
    const stderrLines = failRes.stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.equal(stderrLines.length, 1, `expected one failure sentence on stderr, got: ${JSON.stringify(failRes.stderr)}`);
    assert.match(stderrLines[0], /TRACK_BIN/);
    assert.match(stderrLines[0], /--owner-table/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
