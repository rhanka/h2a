import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const H2A_BIN = join(ROOT, "packages/h2a/dist/bin.js");
const LEGACY_USAGE = /Usage:\s+remote\b/i;
// Executable examples are lowercase and single-line. Keep semantic prose such
// as "Remote jobs" and persisted `.remote/` paths out of this branding guard.
const LEGACY_COMMAND = /(?:`|\$[\t ]*|(?:Run|see|with|next:|supervise:|attach:)[\t ]+)remote[\t ]+(?:run|delegate|jobs|workspace|attach|ls|stop|config|h2a)\b/m;

function h2aHelp(...args) {
  const result = spawnSync(process.execPath, [H2A_BIN, ...args, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" }
  });
  return {
    code: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
    error: result.error
  };
}

for (const command of ["run", "delegate", "jobs", "workspace"]) {
  test(`runtime help: ${command} is branded and actionable only through h2a`, () => {
    const result = h2aHelp(command);
    assert.ifError(result.error);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, new RegExp(`Usage:\\s+h2a\\s+${command}\\b`, "i"));
    assert.doesNotMatch(result.output, LEGACY_USAGE);
    assert.doesNotMatch(result.output, LEGACY_COMMAND);
  });
}

test("runtime relay bridge has a canonical route and keeps the legacy namespace alias", () => {
  for (const route of [["relay", "bridge"], ["h2a", "bridge"]]) {
    const result = h2aHelp(...route);
    assert.ifError(result.error);
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.output, LEGACY_USAGE);
    assert.doesNotMatch(result.output, LEGACY_COMMAND);
  }
});

test("h2a remote remains on the native transport route", () => {
  const result = h2aHelp("remote");
  assert.ifError(result.error);
  assert.equal(result.code, 1);
  assert.match(result.output, /h2a remote: subcommand required \(serve, send\)/);
  assert.doesNotMatch(result.output, /runtime incompatible|dispatchH2a/);
});
