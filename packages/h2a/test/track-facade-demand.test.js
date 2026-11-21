import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { shouldDispatchRuntime } from "../dist/bin-routing.js";
import { TRACK_FACADE_VERBS, TRACK_NATIVE_VERBS, TRACK_NATIVE_WRITE_VERBS } from "../dist/cli.js";

const ROOT = process.cwd();
const H2A_BIN = join(ROOT, "packages/h2a/dist/bin.js");
const TRACK_BIN = join(ROOT, "packages/track/dist/cli/bin.js");

function run(cwd, bin, args) {
  const env = { ...process.env };
  delete env.TRACK_DIR;
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function makeGitStore(base) {
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_CEILING_DIRECTORIES: resolve(tmpdir()),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  assert.equal(spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env: gitEnv }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "root"], { cwd: repo, env: gitEnv }).status, 0);
  const init = run(repo, TRACK_BIN, ["init"]);
  assert.equal(init.status, 0, init.stderr);
  return repo;
}

test("the h2a facade routes the demand verb to Track (T2-f)", () => {
  assert.ok(TRACK_FACADE_VERBS.has("demand"), "demand must be in TRACK_FACADE_VERBS");
  assert.ok(TRACK_NATIVE_WRITE_VERBS.has("demand"), "demand must be in TRACK_NATIVE_WRITE_VERBS");
  assert.ok(TRACK_NATIVE_VERBS.has("demand"), "demand must be in TRACK_NATIVE_VERBS");
  assert.equal(shouldDispatchRuntime(["demand", "raise"]), false, "demand must not route to heavy runtime");

  const scratch = mkdtempSync(join(tmpdir(), "h2a-facade-demand-"));
  try {
    const repo = makeGitStore(scratch);
    const res = run(repo, H2A_BIN, [
      "demand",
      "raise",
      "--text",
      "Demande via facade h2a",
      "--title",
      "Facade demand",
      "--key",
      "facade-key-1",
    ]);
    assert.equal(res.status, 0, `h2a demand raise failed: ${res.stderr}`);
    assert.doesNotMatch(res.stderr ?? "", /Unknown command|requiert le runtime h2a|Run `h2a --help`/);
    const line = res.stdout.trim();
    const match = /^(\S+)\s+#(\d+)$/u.exec(line);
    assert.ok(match, `expected "<demandId> #<n>" on one line, got: ${JSON.stringify(res.stdout)}`);
    assert.equal(Number(match[2]), 1);

    const eventsPath = join(repo, ".track", "events.jsonl");
    const rawAfterFirst = readFileSync(eventsPath, "utf8");
    const replay = run(repo, H2A_BIN, [
      "demand",
      "raise",
      "--text",
      "Demande via facade h2a",
      "--title",
      "Facade demand",
      "--key",
      "facade-key-1",
    ]);
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(replay.stdout.trim(), line);
    assert.equal(readFileSync(eventsPath, "utf8"), rawAfterFirst);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
