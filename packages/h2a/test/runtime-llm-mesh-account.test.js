import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const RUNTIME_BIN = join(ROOT, "packages/h2a-runtime/dist/index.js");
const runtimeBuilt = existsSync(RUNTIME_BIN);

function runWithEnv(args, env = {}) {
  const result = spawnSync(process.execPath, [RUNTIME_BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  assert.ifError(result.error);
  return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
}

function run(...args) {
  return runWithEnv(args);
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
  "llm-mesh account list and remove execute against an isolated facade store",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const isolatedHome = mkdtempSync(join(tmpdir(), "h2a-account-admin-"));
    try {
      const json = runWithEnv(
        ["llm-mesh", "account", "list", "--json"],
        { HOME: isolatedHome },
      );
      assert.equal(json.status, 0, json.output);
      assert.deepEqual(JSON.parse(json.output), []);

      const table = runWithEnv(
        ["llm-mesh", "account", "ls"],
        { HOME: isolatedHome },
      );
      assert.equal(table.status, 0, table.output);
      assert.match(table.output, /no accounts enrolled/i);

      const missing = runWithEnv(
        ["llm-mesh", "account", "rm", "missing-account"],
        { HOME: isolatedHome },
      );
      assert.notEqual(missing.status, 0, missing.output);
      assert.match(missing.output, /missing-account/);
      assert.doesNotMatch(missing.output, /token|credential envelope/i);
    } finally {
      rmSync(isolatedHome, { recursive: true, force: true });
    }
  },
);

test(
  "llm-mesh account failures never expose keyring paths or credentials",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const isolatedHome = mkdtempSync(join(tmpdir(), "h2a-account-errors-"));
    const notDirectory = join(isolatedHome, "private-credential-store");
    const poisonedKeyringPath = join(notDirectory, "access-token");
    try {
      writeFileSync(notDirectory, "not a directory");
      const env = {
        HOME: isolatedHome,
        SENTROPIC_LLM_MESH_KEYRING_DIR: poisonedKeyringPath,
      };

      const inventory = runWithEnv(
        ["llm-mesh", "account", "list", "--json"],
        env,
      );
      assert.notEqual(inventory.status, 0, inventory.output);
      assert.match(inventory.output, /account inventory unavailable/i);
      assert.doesNotMatch(inventory.output, /private-credential-store|access-token|\.sentropic/i);

      const removal = runWithEnv(
        ["llm-mesh", "account", "remove", "acct-codex_1"],
        env,
      );
      assert.notEqual(removal.status, 0, removal.output);
      assert.match(removal.output, /account removal failed/i);
      assert.doesNotMatch(removal.output, /private-credential-store|access-token|\.sentropic/i);
    } finally {
      rmSync(isolatedHome, { recursive: true, force: true });
    }
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
