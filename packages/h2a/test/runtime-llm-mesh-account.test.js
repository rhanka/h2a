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
    // Every spawn below runs under temp HOME/XDG_RUNTIME_DIR/H2A_ROOT:
    // nothing here may read or disturb the owner's real mesh store.
    const isoBase = mkdtempSync(join(tmpdir(), "h2a-account-iso-"));
    const isoEnv = (extra = {}) => ({
      HOME: isoBase,
      XDG_RUNTIME_DIR: join(isoBase, "run"),
      H2A_ROOT: join(isoBase, "h2a-root"),
      ...extra,
    });
    const runIso = (...args) => runWithEnv(args, isoEnv());
    try {
      const accountHelp = runIso("llm-mesh", "account", "--help");
      assert.equal(accountHelp.status, 0, accountHelp.output);
      assert.match(accountHelp.output, /enroll/);
      assert.match(accountHelp.output, /list\|ls/);
      assert.match(accountHelp.output, /remove\|rm\|unenroll/);

      const canonical = runIso("llm-mesh", "account", "enroll", "--help");
      assert.equal(canonical.status, 0, canonical.output);
      assert.match(canonical.output, /Usage: h2a llm-mesh account enroll/);
      assert.match(canonical.output, /cloud-code, codex, muse/);
      assert.match(canonical.output, /claude-code/);
      assert.match(canonical.output, /--from oauth\|cli\|token/);
      assert.match(canonical.output, /--token/);
      assert.doesNotMatch(canonical.output, /--credential-import/);
      assert.match(canonical.output, /muse\s+OAuth device flow/);
      assert.match(canonical.output, /--cli/);
      assert.doesNotMatch(canonical.output, /muse-code device flow/);

      const badCli = runIso("llm-mesh", "account", "enroll", "codex", "--cli");
      assert.notEqual(badCli.status, 0, badCli.output);
      assert.match(badCli.output, /--cli\/--from cli is only valid for providers with a local CLI import \(muse, claude-code\)/);

      const claudeCliNoStore = runIso("llm-mesh", "account", "enroll", "claude-code", "--cli");
      assert.notEqual(claudeCliNoStore.status, 0, claudeCliNoStore.output);
      assert.match(claudeCliNoStore.output, /Claude CLI store not found/);

      const badImport = runIso("llm-mesh", "account", "enroll", "codex", "--token");
      assert.notEqual(badImport.status, 0, badImport.output);
      assert.match(badImport.output, /--token\/--from token is only valid for claude-code/);

      const badBoth = runIso("llm-mesh", "account", "enroll", "claude-code", "--cli", "--token");
      assert.notEqual(badBoth.status, 0, badBoth.output);
      assert.match(badBoth.output, /--cli and --token cannot be combined/);

      const badFrom = runIso("llm-mesh", "account", "enroll", "claude-code", "--from", "bogus");
      assert.notEqual(badFrom.status, 0, badFrom.output);
      assert.match(badFrom.output, /--from must be one of oauth, cli, token/);

      const badFromCombo = runIso("llm-mesh", "account", "enroll", "claude-code", "--from", "cli", "--cli");
      assert.notEqual(badFromCombo.status, 0, badFromCombo.output);
      assert.match(badFromCombo.output, /--from cannot be combined with --cli or --token/);

      const badFromProvider = runIso("llm-mesh", "account", "enroll", "codex", "--from", "token");
      assert.notEqual(badFromProvider.status, 0, badFromProvider.output);
      assert.match(badFromProvider.output, /--token\/--from token is only valid for claude-code/);

      // m4 canaries: rejected values are never echoed back.
      const fromCanary = "canary-from-9f8e7d6c5b4a";
      const badFromCanary = runIso("llm-mesh", "account", "enroll", "claude-code", "--from", fromCanary);
      assert.notEqual(badFromCanary.status, 0, badFromCanary.output);
      assert.match(badFromCanary.output, /--from must be one of oauth, cli, token/);
      assert.doesNotMatch(badFromCanary.output, new RegExp(fromCanary));

      // m1 (r8): a token value passed as an excess positional (the likely
      // cron shape `--from token "$SECRET"`) is refused statically without
      // echoing the value. Token material travels on stdin only, never argv.
      const excessCanary = "canary-excess-4d2e6a8c0b1f";
      const badExcess = runIso("llm-mesh", "account", "enroll", "claude-code", "--from", "token", excessCanary);
      assert.notEqual(badExcess.status, 0, badExcess.output);
      assert.match(badExcess.output, /too many arguments \(expected provider only; never pass secrets in argv\)/);
      assert.doesNotMatch(badExcess.output, new RegExp(excessCanary));

      const tokenCanary = "canary-token-1a2b3c4d5e6f";
      const badTokenValue = runIso("llm-mesh", "account", "enroll", "claude-code", "--token", tokenCanary);
      assert.notEqual(badTokenValue.status, 0, badTokenValue.output);
      assert.match(badTokenValue.output, /too many arguments \(expected provider only; never pass secrets in argv\)/);
      assert.doesNotMatch(badTokenValue.output, new RegExp(tokenCanary));

      const cliCanary = "canary-cli-7a8b9c0d1e2f";
      const badCliValue = runIso("llm-mesh", "account", "enroll", "claude-code", "--cli", cliCanary);
      assert.notEqual(badCliValue.status, 0, badCliValue.output);
      assert.match(badCliValue.output, /too many arguments \(expected provider only; never pass secrets in argv\)/);
      assert.doesNotMatch(badCliValue.output, new RegExp(cliCanary));

      // m2 (r8): option-first ordering keeps working — `--cli muse` selects
      // the muse CLI-store import (provider recognized, not swallowed as a
      // --cli value). In the isolated temp HOME the store is absent, so the
      // failure is the static store error, never a missing provider argument.
      const optionFirst = runIso("llm-mesh", "account", "enroll", "--cli", "muse");
      assert.doesNotMatch(optionFirst.output, /missing required argument 'provider'/);
      assert.doesNotMatch(optionFirst.output, /\[value\]/);
      // Help invites no argv value for --cli/--token (booleans, stdin only).
      assert.doesNotMatch(canonical.output, /--cli \[value\]/);
      assert.doesNotMatch(canonical.output, /--token \[value\]/);

      for (const command of ["list", "ls"]) {
        const help = runIso("llm-mesh", "account", command, "--help");
        assert.equal(help.status, 0, help.output);
        assert.match(help.output, /--json/);
      }

      for (const command of ["remove", "rm", "unenroll"]) {
        const help = runIso("llm-mesh", "account", command, "--help");
        assert.equal(help.status, 0, help.output);
        assert.match(help.output, /<account-id>/);
      }

      const flat = runIso("llm-mesh", "enroll", "codex");
      assert.notEqual(flat.status, 0, flat.output);
      assert.match(flat.output, /unknown command ['"]enroll['"]/i);

      const legacy = runIso("account", "ls");
      assert.notEqual(legacy.status, 0, legacy.output);
      assert.match(legacy.output, /unknown command ['"]account['"]/i);
    } finally {
      rmSync(isoBase, { recursive: true, force: true });
    }
  },
);

test(
  "llm-mesh account list and remove execute against an isolated facade store",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const isolatedHome = mkdtempSync(join(tmpdir(), "h2a-account-admin-"));
    const isolatedEnv = {
      HOME: isolatedHome,
      XDG_RUNTIME_DIR: join(isolatedHome, "run"),
      H2A_ROOT: join(isolatedHome, "h2a-root"),
    };
    try {
      const json = runWithEnv(
        ["llm-mesh", "account", "list", "--json"],
        isolatedEnv,
      );
      assert.equal(json.status, 0, json.output);
      assert.deepEqual(JSON.parse(json.output), []);

      const table = runWithEnv(
        ["llm-mesh", "account", "ls"],
        isolatedEnv,
      );
      assert.equal(table.status, 0, table.output);
      assert.match(table.output, /no accounts enrolled/i);

      const missing = runWithEnv(
        ["llm-mesh", "account", "rm", "missing-account"],
        isolatedEnv,
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
        XDG_RUNTIME_DIR: join(isolatedHome, "run"),
        H2A_ROOT: join(isolatedHome, "h2a-root"),
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
