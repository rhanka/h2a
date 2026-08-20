import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const RUNTIME_BIN = join(ROOT, "packages/h2a-runtime/dist/index.js");
const runtimeBuilt = existsSync(RUNTIME_BIN);

function run(...args) {
  const result = spawnSync(process.execPath, [RUNTIME_BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.ifError(result.error);
  return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
}

test(
  "llm-mesh account exposes enrollment, inventory, and removal",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const accountHelp = run("llm-mesh", "account", "--help");
    assert.equal(accountHelp.status, 0, accountHelp.output);
    assert.match(accountHelp.output, /enroll/);
    assert.match(accountHelp.output, /list\|ls/);
    assert.match(accountHelp.output, /remove\|rm\|unenroll/);

    const canonical = run("llm-mesh", "account", "enroll", "--help");
    assert.equal(canonical.status, 0, canonical.output);
    assert.match(canonical.output, /Usage: h2a llm-mesh account enroll/);
    assert.match(canonical.output, /cloud-code or codex/);

    for (const command of ["list", "ls"]) {
      const help = run("llm-mesh", "account", command, "--help");
      assert.equal(help.status, 0, help.output);
      assert.match(help.output, /--json/);
    }

    for (const command of ["remove", "rm", "unenroll"]) {
      const help = run("llm-mesh", "account", command, "--help");
      assert.equal(help.status, 0, help.output);
      assert.match(help.output, /<account-id>/);
    }

    const flat = run("llm-mesh", "enroll", "codex");
    assert.notEqual(flat.status, 0, flat.output);
    assert.match(flat.output, /unknown command ['"]enroll['"]/i);

    const legacy = run("account", "ls");
    assert.notEqual(legacy.status, 0, legacy.output);
    assert.match(legacy.output, /unknown command ['"]account['"]/i);
  },
);

test(
  "delegate no longer exposes account pinning",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const help = run("delegate", "--help");
    assert.equal(help.status, 0, help.output);
    assert.doesNotMatch(help.output, /--account\b/);
  },
);
