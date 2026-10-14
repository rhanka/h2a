import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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

      // m1: --token=<v> and --cli=<v> unknown-option sanitization ensures
      // option values are never echoed on stderr.
      const tokenEqCanary = "canary-token-eq-3b5c7d9e1f2a";
      const badTokenEq = runIso("llm-mesh", "account", "enroll", "claude-code", `--token=${tokenEqCanary}`);
      assert.notEqual(badTokenEq.status, 0, badTokenEq.output);
      assert.match(badTokenEq.output, /unknown option '--token'/);
      assert.doesNotMatch(badTokenEq.output, new RegExp(tokenEqCanary));

      const cliEqCanary = "canary-cli-eq-8a6b4c2d0e1f";
      const badCliEq = runIso("llm-mesh", "account", "enroll", "claude-code", `--cli=${cliEqCanary}`);
      assert.notEqual(badCliEq.status, 0, badCliEq.output);
      assert.match(badCliEq.output, /unknown option '--cli'/);
      assert.doesNotMatch(badCliEq.output, new RegExp(cliEqCanary));

      const tokenEqFirstCanary = "canary-token-eqfirst-1c3e5a7b9d";
      const badTokenEqFirst = runIso("llm-mesh", "account", "enroll", `--token=${tokenEqFirstCanary}`, "claude-code");
      assert.notEqual(badTokenEqFirst.status, 0, badTokenEqFirst.output);
      assert.match(badTokenEqFirst.output, /unknown option '--token'/);
      assert.doesNotMatch(badTokenEqFirst.output, new RegExp(tokenEqFirstCanary));

      // m1: option-first without provider (--cli <v> or --from cli <v>): provider
      // error is static, never echoing the value on stderr.
      const cliFirstCanary = "canary-cli-first-9e8d7c6b5a4f";
      const badCliFirst = runIso("llm-mesh", "account", "enroll", "--cli", cliFirstCanary);
      assert.notEqual(badCliFirst.status, 0, badCliFirst.output);
      assert.match(badCliFirst.output, /provider has no CLI-store import/);
      assert.doesNotMatch(badCliFirst.output, new RegExp(cliFirstCanary));

      const fromCliCanary = "canary-from-cli-6a5b4c3d2e1f";
      const badFromCli = runIso("llm-mesh", "account", "enroll", "--from", "cli", fromCliCanary);
      assert.notEqual(badFromCli.status, 0, badFromCli.output);
      assert.match(badFromCli.output, /provider has no CLI-store import/);
      assert.doesNotMatch(badFromCli.output, new RegExp(fromCliCanary));

      // m1: unsupported provider positional value is refused with a static message,
      // never echoing the value.
      const unsupportedCanary = "canary-unsupported-2d4f6a8c0e1b";
      const badUnsupported = runIso("llm-mesh", "account", "enroll", unsupportedCanary);
      assert.notEqual(badUnsupported.status, 0, badUnsupported.output);
      assert.match(badUnsupported.output, /unsupported provider/);
      assert.doesNotMatch(badUnsupported.output, new RegExp(unsupportedCanary));

      const tokenFirstCanary = "canary-token-first-7c8b9d0e1f2a";
      const badTokenFirst = runIso("llm-mesh", "account", "enroll", "--token", tokenFirstCanary);
      assert.notEqual(badTokenFirst.status, 0, badTokenFirst.output);
      assert.match(badTokenFirst.output, /--token\/--from token is only valid for claude-code/);
      assert.doesNotMatch(badTokenFirst.output, new RegExp(tokenFirstCanary));

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

      // Root error boundary: unknown commands are static, never echoed.
      const flat = runIso("llm-mesh", "enroll", "codex");
      assert.notEqual(flat.status, 0, flat.output);
      assert.match(flat.output, /error: unknown command/i);

      const legacy = runIso("account", "ls");
      assert.notEqual(legacy.status, 0, legacy.output);
      assert.match(legacy.output, /error: unknown command/i);
    } finally {
      rmSync(isoBase, { recursive: true, force: true });
    }
  },
);

test(
  "enroll root error boundary never echoes argv secrets in any form",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    // Property-style canary: one random secret injected in 28 fixed argv
    // forms across the enroll command tree (multi-line values,
    // parent-placed options, attached short options, --opt=<v>,
    // attached with no `=`/` `, bare long/short flags at enroll and root
    // level, positionals, unknown options, unknown commands). No run may
    // print it on stdout or stderr; every run must refuse without enrolling.
    const isoBase = mkdtempSync(join(tmpdir(), "h2a-account-canary-"));
    const isoEnv = {
      HOME: isoBase,
      XDG_RUNTIME_DIR: join(isoBase, "run"),
      H2A_ROOT: join(isoBase, "h2a-root"),
    };
    const secret = `pz${randomBytes(18).toString("hex")}`;
    const forms = [
      ["llm-mesh", "account", "enroll", "claude-code", `--token=${secret}`],
      ["llm-mesh", "account", "enroll", "claude-code", `--cli=${secret}`],
      ["llm-mesh", "account", "enroll", "claude-code", `--token={\n  "accessToken": "${secret}"\n}`],
      ["llm-mesh", "account", "enroll", "claude-code", `--token=${secret}\n`],
      [`--token=${secret}`, "llm-mesh", "account", "enroll", "claude-code"],
      ["llm-mesh", `--token=${secret}`, "account", "enroll", "claude-code"],
      ["llm-mesh", "account", `--token=${secret}`, "enroll", "claude-code"],
      ["llm-mesh", "account", "enroll", "claude-code", `-t${secret}`],
      ["llm-mesh", "account", "enroll", "claude-code", `-${secret}`],
      // r12 m1: attached with no `=` (a missing-separator typo) and bare
      // long flags keep no user text — the name is kept only when declared.
      ["llm-mesh", "account", "enroll", "claude-code", `--token${secret}`],
      ["llm-mesh", "account", "enroll", "claude-code", `--${secret}`],
      [`--${secret}`, "llm-mesh", "account", "enroll", "claude-code"],
      [`-${secret}`],
      ["llm-mesh", "account", "enroll", "claude-code", `--tokn=${secret}`],
      ["llm-mesh", "account", "enroll", secret],
      ["llm-mesh", "account", "enroll", "claude-code", "--from", "token", secret],
      ["llm-mesh", "account", "enroll", "claude-code", "--token", secret],
      ["llm-mesh", "account", "enroll", "claude-code", "--cli", secret],
      ["llm-mesh", "account", "enroll", "claude-code", `--from=${secret}`],
      ["llm-mesh", "account", secret],
      // r12 m2: unknown commands carrying values (an `error: `-bearing
      // value, a quote-bearing value) are static, never echoed.
      ["llm-mesh", "account", `x error: ${secret}`],
      ["llm-mesh", "account", `it's ${secret}`],
      // r12 m2: values containing `error: ` (single-line and multi-line
      // JSON) and extra `remove` positionals are static, never echoed.
      ["llm-mesh", "account", "enroll", "claude-code", `--token=X error: ${secret}`],
      ["llm-mesh", "account", "enroll", "claude-code", `--token={\n "a": "${secret}",\n "e": "error: no"\n}`],
      ["llm-mesh", "account", "remove", "x", `a error: ${secret}`],
      ["llm-mesh", "account", "remove", "x", "y", secret],
      ["llm-mesh", secret, "account", "enroll", "claude-code"],
      [secret],
    ];
    // Static shapes proven per form: unclassifiable input yields the bare
    // static message (overlapping fragments below assert the same shape);
    // a declared `--token` name is kept without its value.
    const staticShapes = [
      [`--token${secret}`, /error: unknown option(\n|$)/],
      [`--${secret}`, /error: unknown option(\n|$)/],
      [`-${secret}`, /error: unknown option(\n|$)/],
      [`-t${secret}`, /error: unknown option(\n|$)/],
      [`--token=${secret}\n`, /error: unknown option(\n|$)/],
      [`"accessToken": "${secret}"`, /error: unknown option(\n|$)/],
      [`--token=X error: ${secret}`, /unknown option '--token'/],
      [`"e": "error: no"`, /error: unknown option(\n|$)/],
      [`x error: ${secret}`, /error: unknown command(\n|$)/],
      [`it's ${secret}`, /error: unknown command(\n|$)/],
      [`a error: ${secret}`, /too many arguments for 'remove'\. Expected 1 argument but got 2\./],
    ];
    try {
      for (const args of forms) {
        const result = runWithEnv(args, isoEnv);
        assert.notEqual(result.status, 0, `expected refusal for ${JSON.stringify(args)}: ${result.output}`);
        assert.doesNotMatch(result.output, new RegExp(secret), `secret echoed for ${JSON.stringify(args)}: ${result.output}`);
        for (const [fragment, shape] of staticShapes) {
          if (args.some((a) => a.includes(fragment))) {
            assert.match(result.output, shape, `not static for ${JSON.stringify(args)}: ${result.output}`);
          }
        }
      }
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
