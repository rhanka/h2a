import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../dist/index.js";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PKG_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const PKG = JSON.parse(readFileSync(join(REPO, "packages/h2a/package.json"), "utf8"));

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-bridge-lock-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write(text) { stdout += text; } },
    stderr: { write(text) { stderr += text; } },
    text: () => ({ stdout, stderr })
  };
}

async function withIsolatedHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "h2a-bridge-home-"));
  chmodSync(home, 0o700);
  const xdgRuntime = join(home, "xdg-runtime");
  mkdirSync(xdgRuntime, { recursive: true, mode: 0o700 });
  chmodSync(xdgRuntime, 0o700);
  const saved = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT,
    CODEX_HOME: process.env.CODEX_HOME,
    H2A_PREFIX: process.env.H2A_PREFIX,
    NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX
  };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.XDG_RUNTIME_DIR = xdgRuntime;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_PLUGIN_ROOT;
  delete process.env.CODEX_HOME;
  delete process.env.H2A_PREFIX;
  delete process.env.NPM_CONFIG_PREFIX;
  try {
    return await fn(home);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function writeClaudePluginCache(home, version = PKG.version, options = {}) {
  const claudeRoot = options.claudeRoot ?? join(home, ".claude");
  const pluginDir = options.pluginDir ?? join(claudeRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  if (!options.omitShim) {
    mkdirSync(join(pluginDir, "scripts"), { recursive: true });
    writeFileSync(
      join(pluginDir, "scripts", "h2a-bridge-shim.mjs"),
      readFileSync(join(PKG_ROOT, "scripts", "h2a-bridge-shim.mjs"), "utf8"),
      { mode: 0o755 }
    );
  }
  const args = options.args ?? [
    "${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs",
    "registry-bridge", "serve", "--host", "claude", "--profile", "default",
    "--wake", "auto", "--auto-open", "--auto-upgrade"
  ];
  const command = options.command ?? "node";
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "h2a",
    version,
    mcpServers: "./.claude-plugin/registry.mcp.json"
  }, null, 2));
  writeFileSync(join(pluginDir, ".claude-plugin", "registry.mcp.json"), JSON.stringify({
    mcpServers: { h2a: { command, args } }
  }, null, 2));
  if (options.writeInstalled !== false) {
    const installedPath = join(claudeRoot, "plugins", "installed_plugins.json");
    mkdirSync(dirname(installedPath), { recursive: true });
    const entries = options.installedEntries ?? [{
      scope: "user",
      installPath: pluginDir,
      version
    }];
    writeFileSync(installedPath, JSON.stringify({
      version: 2,
      plugins: { "h2a@sentropic": entries }
    }, null, 2));
  }
  return pluginDir;
}

function writeCodexPluginCache(home, version = PKG.version, options = {}) {
  const codexRoot = options.codexRoot ?? join(home, ".codex");
  const pluginDir = options.pluginDir ?? join(codexRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
  const args = options.args ?? [
    "registry-bridge", "serve", "--host", "codex", "--profile", "default",
    "--wake", "auto", "--auto-open"
  ];
  const command = options.command ?? "h2a";
  writeFileSync(join(pluginDir, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "h2a",
    version,
    mcpServers: "./.codex-plugin/registry.mcp.json"
  }, null, 2));
  writeFileSync(join(pluginDir, ".codex-plugin", "registry.mcp.json"), JSON.stringify({
    mcpServers: { h2a: { command, args } }
  }, null, 2));
  return pluginDir;
}

function fabricateMarkerBase(dir, root) {
  const runtimeBase = join(dir, "runtime-base");
  const parent = join(runtimeBase, "h2a-mcp-central");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  writeFileSync(join(parent, "marker.json"), JSON.stringify({
    endpoint: "http://127.0.0.1:9/",
    generation: "lock-recovery-fixture",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: "lock-recovery-token",
    protocol: 2,
    root
  }), { mode: 0o600 });
  return runtimeBase;
}

function admitCentral(t, dir, root) {
  const canonical = realpathSync(root);
  const runtimeBase = fabricateMarkerBase(dir, canonical);
  const saved = {};
  for (const key of ["CLAUDE_CODE_SESSION_ID", "H2A_MCP_CENTRAL", "H2A_ROOT"]) saved[key] = process.env[key];
  process.env.CLAUDE_CODE_SESSION_ID = "lock-recovery-session";
  process.env.H2A_MCP_CENTRAL = "1";
  process.env.H2A_ROOT = canonical;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  return runtimeBase;
}

test("2a: registry-bridge serve --auto-upgrade writes ONLY the plugin lock (never receipt or ~/.local/bin) and without --auto-upgrade writes nothing", async (t) => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      const configPath = join(home, ".claude.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
      writeClaudePluginCache(home);
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      const receiptPath = `${configPath}.h2a-registry.json`;
      const localBinH2a = join(home, ".local", "bin", "h2a");
      mkdirSync(join(home, ".local", "bin"), { recursive: true });
      const npmGlobalBin = join(home, ".npm-global", "bin");
      mkdirSync(npmGlobalBin, { recursive: true });
      writeFileSync(join(npmGlobalBin, "h2a"), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });

      const runtimeBase = admitCentral(t, dir, dir);

      // Without --auto-upgrade: must refuse and write nothing
      const noUpgradeIo = streams();
      const noUpgradeCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open",
        "--root", dir, "--runtime-base", runtimeBase
      ], noUpgradeIo, { delegateServe: async () => 0 });
      assert.equal(noUpgradeCode, 2);
      assert.ok(!existsSync(lockPath), "without --auto-upgrade, lock must not be written");
      assert.ok(!existsSync(receiptPath), "without --auto-upgrade, receipt must not be written");
      assert.ok(!existsSync(localBinH2a), "without --auto-upgrade, ~/.local/bin/h2a must not be written");

      // With --auto-upgrade and no pre-existing receipt: writes ONLY lockPath, strips --config / --plugin-dir from passthrough
      const io = streams();
      let delegatedFlags = null;
      const code = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--config", configPath,
        "--root", dir, "--runtime-base", runtimeBase
      ], io, {
        delegateServe: async (flags) => {
          delegatedFlags = flags;
          return 0;
        }
      });

      assert.equal(code, 0, `expected re-bootstrap to succeed, stderr: ${io.text().stderr}`);
      assert.ok(existsSync(lockPath), "default plugin lock was re-bootstrapped");
      assert.ok(!existsSync(receiptPath), "serve --auto-upgrade must never create or overwrite receipt");
      assert.ok(!existsSync(localBinH2a), "serve --auto-upgrade must never write ~/.local/bin/h2a");
      assert.ok(delegatedFlags !== null, "delegated to central attachment shim after re-bootstrap");
      assert.equal(delegatedFlags["config"], undefined, "config flag must not be forwarded in passthrough");
      assert.equal(delegatedFlags["plugin-dir"], undefined, "plugin-dir flag must not be forwarded in passthrough");

      // R2-P2-1: Fresh Claude installation where ~/.claude.json does not exist yet must still re-bootstrap default.lock.json
      rmSync(lockPath, { force: true });
      rmSync(configPath, { force: true });
      const freshCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--root", dir, "--runtime-base", runtimeBase
      ], streams(), { delegateServe: async () => 0 });
      assert.equal(freshCode, 0, "fresh Claude plugin install without ~/.claude.json must re-bootstrap default.lock.json");
      assert.ok(existsSync(lockPath), "lock provisioned without pre-existing ~/.claude.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));

      // With a pre-existing valid plugin receipt: receipt bytes must remain 100% untouched
      rmSync(lockPath, { force: true });
      const customReceipt = JSON.stringify({
        format: "h2a.registry-install/v1",
        host: "claude",
        profile: "default",
        mechanism: "plugin",
        action: "verified",
        customMarker: "must-not-be-overwritten"
      }, null, 2) + "\n";
      writeFileSync(receiptPath, customReceipt);
      const code2 = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--root", dir, "--runtime-base", runtimeBase
      ], streams(), { delegateServe: async () => 0 });
      assert.equal(code2, 0);
      assert.equal(readFileSync(receiptPath, "utf8"), customReceipt, "existing receipt must not be overwritten by serve");
    });
  });
});

test("2a security: tampered or 0-byte lock fails closed on serve --auto-upgrade, and explicit bootstrap install quarantines and heals a 0-byte lock", async (t) => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      const configPath = join(home, ".claude.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
      const pluginDir = writeClaudePluginCache(home);
      const bootstrapIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
      ], bootstrapIo, {}), 0, bootstrapIo.text().stderr);

      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      const tampered = JSON.parse(readFileSync(lockPath, "utf8"));
      tampered.entries["sentropic.h2a"].digest = "sha256:" + "f".repeat(64);
      writeFileSync(lockPath, JSON.stringify(tampered, null, 2));
      const tamperedBytes = readFileSync(lockPath, "utf8");

      const runtimeBase = admitCentral(t, dir, dir);
      const io = streams();
      let calls = 0;
      const code = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--root", dir, "--runtime-base", runtimeBase
      ], io, {
        delegateServe: async () => {
          calls++;
          return 0;
        }
      });

      assert.equal(code, 2, "tampered lock must fail closed");
      assert.equal(calls, 0, "must never delegate on tampered lock");
      assert.match(io.text().stdout, /integrity_mismatch/);
      assert.equal(readFileSync(lockPath, "utf8"), tamperedBytes, "tampered lock must not be overwritten");

      // Now test 0-byte lock: serve --auto-upgrade must refuse without overwriting, and printed bootstrap install heals it
      writeFileSync(lockPath, "");
      const zeroIo = streams();
      const zeroCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--root", dir, "--runtime-base", runtimeBase
      ], zeroIo, { delegateServe: async () => 0 });
      assert.equal(zeroCode, 2, "0-byte lock must fail closed on serve");
      assert.equal(readFileSync(lockPath, "utf8"), "", "serve must not overwrite 0-byte lock");
      assert.doesNotMatch(zeroIo.text().stderr, /run h2a registry bootstrap install.*run:/, "no duplicated internal hint");

      const healIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
      ], healIo, {}), 0, `explicit bootstrap install must heal 0-byte lock: ${healIo.text().stderr}`);
      const healOut = JSON.parse(healIo.text().stdout);
      assert.ok(typeof healOut.quarantinePath === "string" && existsSync(healOut.quarantinePath), "N4-P3-2: bootstrap install output must report quarantinePath");
      const healed = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.equal(healed.format, "h2a.registry-bridge-lock/v1");
      const lockDir = dirname(lockPath);
      const quarantined = readdirSync(lockDir).filter((n) => n.startsWith("default.lock.json.quarantine-"));
      assert.ok(quarantined.length >= 1, "0-byte lock was quarantined before replacement");

      // N4-P3-2: A valid lock that selects sentropic.engram.memory (which throws missing_binding when read without memoryEntry)
      // must NOT be treated as corrupt or quarantined/overwritten by bootstrap install --mechanism plugin
      const { provisionBridgeLock } = await import("../dist/registry/bridge-lock.js");
      const { entry: memoryEntry, configuration: memoryConfig } = await import("./helpers/engram-memory-contract.js");
      rmSync(lockPath, { force: true });
      provisionBridgeLock({
        lockPath,
        host: "claude",
        profile: "default",
        memory: { entry: memoryEntry, config: memoryConfig }
      });
      const memLockBytes = readFileSync(lockPath, "utf8");
      assert.equal(JSON.parse(memLockBytes).selection.length, 3, "precondition: 3-entry memory lock provisioned");
      const memInstallIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
      ], memInstallIo, {}), 0, memInstallIo.text().stderr);
      const memInstallOut = JSON.parse(memInstallIo.text().stdout);
      assert.equal(memInstallOut.lockAction, "already-present", "N4-P3-2: memory-selecting lock must be preserved as already-present");
      assert.equal(memInstallOut.quarantinePath, undefined, "N4-P3-2: memory-selecting lock must not be quarantined");
      assert.equal(readFileSync(lockPath, "utf8"), memLockBytes, "N4-P3-2: memory-selecting lock bytes must remain untouched");
    });
  });
});

test("2a security: conflicting receipt, foreign/invalid host config, and ambiguous/unverified plugin cache all refuse re-bootstrap; printed conflict remediation command works", async (t) => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async (home) => {
    const runtimeBase = admitCentral(t, home, home);
    const configPath = join(home, ".claude.json");
    const receiptPath = `${configPath}.h2a-registry.json`;
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
    writeFileSync(receiptPath, JSON.stringify({
      format: "h2a.registry-install/v1",
      host: "claude",
      profile: "default",
      mechanism: "file",
      action: "installed"
    }));
    const pluginDir = writeClaudePluginCache(home);
    const lockPath = defaultPluginBridgeLockPath("claude", "default");

    const io = streams();
    const code = await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default",
      "--wake", "auto", "--auto-open", "--auto-upgrade"
    ], io, {
      delegateServe: async () => 0
    });

    assert.equal(code, 2);
    assert.ok(!existsSync(lockPath), "conflicting file mechanism must not provision plugin lock");
    assert.match(io.text().stdout, /missing_lock/);
    const stderrText = io.text().stderr;
    assert.ok(stderrText.includes(`bootstrap uninstall --host claude --profile default --config ${configPath}`), `stderr must include uninstall step: ${stderrText}`);
    assert.ok(stderrText.includes(`bootstrap install --mechanism plugin --host claude --profile default --config ${configPath} --plugin-dir ${pluginDir}`), `stderr must include install step: ${stderrText}`);

    // Execute the exact remediation steps printed by the refusal message
    const uninstallIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "uninstall", "--host", "claude", "--profile", "default", "--config", configPath
    ], uninstallIo, {}), 0, `remediation uninstall failed: ${uninstallIo.text().stderr}`);
    const installIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "install", "--mechanism", "plugin",
      "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
    ], installIo, {}), 0, `remediation install failed: ${installIo.text().stderr}`);
    assert.ok(existsSync(lockPath), "remediation command provisioned the plugin lock");
    rmSync(lockPath, { force: true });

    // Corrupt JSON receipt must refuse and remain untouched
    const corruptReceipt = "{not-valid-json";
    writeFileSync(receiptPath, corruptReceipt);
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], streams(), { delegateServe: async () => 0 }), 2);
    assert.ok(!existsSync(lockPath), "corrupt receipt must refuse re-bootstrap");
    assert.equal(readFileSync(receiptPath, "utf8"), corruptReceipt);

    // Receipt for another profile must refuse on serve --auto-upgrade and remain untouched;
    // N4-P3-5: running the printed install remedy must back up the replaced receipt (.backup-<id>)
    const otherProfileReceipt = JSON.stringify({
      format: "h2a.registry-install/v1",
      host: "claude",
      profile: "work",
      mechanism: "plugin"
    });
    writeFileSync(receiptPath, otherProfileReceipt);
    const otherProfileIo = streams();
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], otherProfileIo, { delegateServe: async () => 0 }), 2);
    assert.ok(!existsSync(lockPath), "mismatched profile receipt must refuse re-bootstrap");
    assert.equal(readFileSync(receiptPath, "utf8"), otherProfileReceipt);
    assert.match(otherProfileIo.text().stderr, /backup/i, "N4-P3-5: refusal remedy for foreign-profile receipt mentions receipt backup");
    const replaceProfileIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "install", "--mechanism", "plugin",
      "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
    ], replaceProfileIo, {}), 0, replaceProfileIo.text().stderr);
    const replaceProfileOut = JSON.parse(replaceProfileIo.text().stdout);
    assert.ok(
      typeof replaceProfileOut.backupPath === "string" && existsSync(replaceProfileOut.backupPath),
      `N4-P3-5: replacing receipt from another profile must create a .backup-<id> copy: ${replaceProfileIo.text().stdout}`
    );
    assert.equal(readFileSync(replaceProfileOut.backupPath, "utf8"), otherProfileReceipt, "N4-P3-5: receipt backup preserves original profile=work bytes");
    rmSync(replaceProfileOut.backupPath, { force: true });
    rmSync(lockPath, { force: true });
    rmSync(receiptPath, { force: true });

    // N4-P3-3: Semver ordering in findVerifiedPluginVersionDir: 0.98.10 must be chosen before 0.98.9
    const { findVerifiedPluginVersionDir } = await import("../dist/registry/bridge-lock.js");
    const { resolveHostPluginContext } = await import("../dist/registry/host-bootstrap.js");
    const semverCacheDir = join(home, "semver-cache");
    writeClaudePluginCache(home, "0.98.9", { pluginDir: join(semverCacheDir, "0.98.9"), writeInstalled: false });
    writeClaudePluginCache(home, "0.98.10", { pluginDir: join(semverCacheDir, "0.98.10"), writeInstalled: false });
    assert.equal(
      findVerifiedPluginVersionDir(semverCacheDir, "claude"),
      join(semverCacheDir, "0.98.10"),
      "N4-P3-3: findVerifiedPluginVersionDir must pick 0.98.10 over 0.98.9 using semver ordering"
    );
    writeCodexPluginCache(home, "0.98.9");
    const codex09810 = writeCodexPluginCache(home, "0.98.10");
    assert.equal(
      resolveHostPluginContext("codex", "default", {}, { HOME: home }).pluginDir,
      codex09810,
      "N4-P3-3: resolveHostPluginContext for codex must pick 0.98.10 over 0.98.9"
    );
    rmSync(semverCacheDir, { recursive: true, force: true });
    rmSync(join(home, ".codex"), { recursive: true, force: true });

    // N-P2-1 / R2-P2-2 / R3-P2-1: Host config conflicts (legacy mcp-serve vs foreign entry vs url):
    // each printed remedy must name the cause, lead to a working plugin MCP (creating default.lock.json), and its command must exit 0 when executed.
    // Branch A (R3-P2-1): legacy direct mcp-serve entry in ~/.claude.json -> printed remedy removes legacy entry then installs plugin mechanism
    const legacyConfig = JSON.stringify({
      mcpServers: { h2a: { command: "h2a", args: ["mcp-serve", "--host", "claude"] } }
    }, null, 2);
    writeFileSync(configPath, legacyConfig);
    const legacyIo = streams();
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], legacyIo, { delegateServe: async () => 0 }), 2);
    assert.ok(!existsSync(lockPath), "legacy mcp-serve host config must refuse auto re-bootstrap");
    assert.equal(readFileSync(configPath, "utf8"), legacyConfig);
    const legacyStderr = legacyIo.text().stderr;
    assert.ok(
      legacyStderr.includes(`h2a registry bootstrap uninstall --host claude --profile default --config ${configPath}`),
      `legacy conflict remedy must remove the legacy entry via bootstrap uninstall: ${legacyStderr}`
    );
    assert.ok(
      legacyStderr.includes(`h2a registry bootstrap install --mechanism plugin --host claude --profile default --config ${configPath} --plugin-dir ${pluginDir}`),
      `legacy conflict remedy must install the plugin mechanism: ${legacyStderr}`
    );
    assert.match(legacyStderr, /doctor --repair/i);
    // Execute the exact printed remedy commands on the legacy config -> must exit 0, remove legacy entry, create default.lock.json, and make plugin serve exit 0
    const legacyUninstallIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "uninstall", "--host", "claude", "--profile", "default", "--config", configPath
    ], legacyUninstallIo, {}), 0, `printed legacy uninstall command must exit 0: ${legacyUninstallIo.text().stderr}`);
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.h2a, undefined, "legacy mcp-serve entry removed from host config");
    const legacyInstallIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "install", "--mechanism", "plugin",
      "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
    ], legacyInstallIo, {}), 0, `printed legacy plugin install command must exit 0: ${legacyInstallIo.text().stderr}`);
    assert.ok(existsSync(lockPath), "printed legacy remedy provisioned default.lock.json");
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade",
      "--root", home, "--runtime-base", runtimeBase
    ], streams(), { delegateServe: async () => 0 }), 0, "plugin MCP serve must exit 0 after executing printed legacy remedy");
    rmSync(lockPath, { force: true });
    rmSync(receiptPath, { force: true });

    // Branch B: foreign / url / customized mcp-serve (--no-wake, R4-P3-1) mcpServers.h2a entry in ~/.claude.json (without receipt)
    for (const foreignEntry of [
      { command: "custom-h2a", args: ["serve"] },
      { url: "http://127.0.0.1:9999/mcp" },
      { command: "h2a", args: ["mcp-serve", "--no-wake"] }
    ]) {
      const foreignConfig = JSON.stringify({
        mcpServers: { h2a: foreignEntry }
      }, null, 2);
      writeFileSync(configPath, foreignConfig);
      assert.equal(await runCli([
        "registry", "bootstrap", "uninstall", "--host", "claude", "--profile", "default", "--config", configPath
      ], streams(), {}), 2, "R4-P3-1: foreign or customized mcp-serve (--no-wake) entry must refuse bootstrap uninstall");
      const foreignIo = streams();
      assert.equal(await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
      ], foreignIo, { delegateServe: async () => 0 }), 2);
      assert.ok(!existsSync(lockPath), "host config with foreign/url mcpServers.h2a must refuse re-bootstrap");
      assert.equal(readFileSync(configPath, "utf8"), foreignConfig);
      assert.doesNotMatch(foreignIo.text().stderr, /bootstrap uninstall/, "foreign config conflict must not suggest failing bootstrap uninstall");
      assert.match(foreignIo.text().stderr, /remove mcpServers\.h2a/i);
      // Follow printed remedy: remove mcpServers.h2a from config, then run printed bootstrap install -> exits 0
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
      const foreignFixIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
      ], foreignFixIo, {}), 0, `remedy after removing foreign mcpServers.h2a failed: ${foreignFixIo.text().stderr}`);
      assert.ok(existsSync(lockPath));
      rmSync(lockPath, { force: true });
      rmSync(receiptPath, { force: true });
    }

    // R2-P2-1 & R3-P2-2: Secondary Claude config ~/.config/claude/mcp.json conflict (both legacy/foreign config entry and file receipt)
    // must point --config in the printed remedy to ~/.config/claude/mcp.json (NOT ~/.claude.json), and printed command must exit 0
    const secondaryClaudeConfig = join(home, ".config", "claude", "mcp.json");
    const secondaryReceiptPath = `${secondaryClaudeConfig}.h2a-registry.json`;
    mkdirSync(dirname(secondaryClaudeConfig), { recursive: true });
    // Subcase 1: conflicting file receipt at ~/.config/claude/mcp.json.h2a-registry.json (even when ~/.claude.json is absent)
    rmSync(configPath, { force: true });
    writeFileSync(secondaryReceiptPath, JSON.stringify({
      format: "h2a.registry-install/v1",
      host: "claude",
      profile: "default",
      mechanism: "file",
      action: "installed"
    }));
    const secReceiptIo = streams();
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], secReceiptIo, { delegateServe: async () => 0 }), 2, "secondary ~/.config/claude/mcp.json.h2a-registry.json file receipt must refuse re-bootstrap");
    assert.ok(!existsSync(lockPath));
    const secReceiptStderr = secReceiptIo.text().stderr;
    assert.ok(
      secReceiptStderr.includes(`--config ${secondaryClaudeConfig}`),
      `secondary receipt conflict remedy must point --config to ${secondaryClaudeConfig}, got: ${secReceiptStderr}`
    );
    assert.ok(
      !secReceiptStderr.includes(`--config ${configPath}`),
      `secondary receipt conflict remedy must not point --config to ${configPath}: ${secReceiptStderr}`
    );
    assert.equal(await runCli([
      "registry", "bootstrap", "uninstall", "--host", "claude", "--profile", "default", "--config", secondaryClaudeConfig
    ], streams(), {}), 0, "printed uninstall for secondary file receipt must exit 0 even when ~/.claude.json is absent");
    assert.equal(await runCli([
      "registry", "bootstrap", "install", "--mechanism", "plugin",
      "--host", "claude", "--profile", "default", "--config", secondaryClaudeConfig, "--plugin-dir", pluginDir
    ], streams(), {}), 0, "printed plugin install for secondary receipt must exit 0");
    assert.ok(existsSync(lockPath));
    rmSync(lockPath, { force: true });
    rmSync(secondaryReceiptPath, { force: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));

    // Subcase 2: legacy mcp-serve entry in ~/.config/claude/mcp.json
    writeFileSync(secondaryClaudeConfig, JSON.stringify({
      mcpServers: { h2a: { command: "h2a", args: ["mcp-serve", "--host", "claude"] } }
    }, null, 2));
    const secondaryIo = streams();
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], secondaryIo, { delegateServe: async () => 0 }), 2, "secondary ~/.config/claude/mcp.json with h2a entry must refuse re-bootstrap");
    assert.ok(!existsSync(lockPath));
    const secondaryStderr = secondaryIo.text().stderr;
    assert.ok(
      secondaryStderr.includes(`--config ${secondaryClaudeConfig}`),
      `secondary config conflict remedy must point --config to ${secondaryClaudeConfig}, got: ${secondaryStderr}`
    );
    assert.ok(
      !secondaryStderr.includes(`--config ${configPath}`),
      `secondary config conflict remedy must not point --config to ${configPath}: ${secondaryStderr}`
    );
    const secUninstallIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "uninstall", "--host", "claude", "--profile", "default", "--config", secondaryClaudeConfig
    ], secUninstallIo, {}), 0, `printed uninstall for ~/.config/claude/mcp.json must exit 0: ${secUninstallIo.text().stderr}`);
    const secInstallIo = streams();
    assert.equal(await runCli([
      "registry", "bootstrap", "install", "--mechanism", "plugin",
      "--host", "claude", "--profile", "default", "--config", secondaryClaudeConfig, "--plugin-dir", pluginDir
    ], secInstallIo, {}), 0, `printed install for ~/.config/claude/mcp.json must exit 0: ${secInstallIo.text().stderr}`);
    assert.ok(existsSync(lockPath), "remedy for ~/.config/claude/mcp.json provisioned default.lock.json");
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade",
      "--root", home, "--runtime-base", runtimeBase
    ], streams(), { delegateServe: async () => 0 }), 0, "serve succeeds after secondary config remedy");
    rmSync(lockPath, { force: true });
    rmSync(secondaryReceiptPath, { force: true });
    rmSync(secondaryClaudeConfig, { force: true });

    // Host config with invalid JSON must refuse
    writeFileSync(configPath, "{broken-json");
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], streams(), { delegateServe: async () => 0 }), 2);
    assert.ok(!existsSync(lockPath), "invalid JSON host config must refuse re-bootstrap");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));

    // Ambiguous installed_plugins.json (multiple distinct valid installPaths) must refuse
    const secondPluginDir = writeClaudePluginCache(home, "9.9.9", { writeInstalled: false });
    writeClaudePluginCache(home, PKG.version, {
      installedEntries: [
        { scope: "user", installPath: pluginDir, version: PKG.version },
        { scope: "project", installPath: secondPluginDir, version: "9.9.9" }
      ]
    });
    const ambigIo = streams();
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], ambigIo, { delegateServe: async () => 0 }), 2);
    assert.ok(!existsSync(lockPath), "ambiguous installed_plugins.json must refuse re-bootstrap");
    assert.match(ambigIo.text().stderr, /ambiguous/i);

    // CLAUDE_PLUGIN_ROOT outside <claudeRoot>/plugins must be ignored/rejected
    const outsidePlugin = join(home, "outside-plugin");
    writeClaudePluginCache(home, PKG.version, { pluginDir: outsidePlugin, writeInstalled: false });
    rmSync(join(home, ".claude", "plugins"), { recursive: true, force: true });
    process.env.CLAUDE_PLUGIN_ROOT = outsidePlugin;
    assert.equal(await cmdRegistryBridge([
      "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
    ], streams(), { delegateServe: async () => 0 }), 2);
    assert.ok(!existsSync(lockPath), "CLAUDE_PLUGIN_ROOT outside ~/.claude/plugins must not be trusted");
    delete process.env.CLAUDE_PLUGIN_ROOT;

    // N-P3-4 / R2-P2-5: Plugin declarations with /opt/any/node, ./scripts/h2a-bridge-shim.mjs, or missing shim file must be rejected
    for (const badSpec of [
      { command: "node", args: ["/tmp/evil.js", "registry-bridge", "serve", "--host", "claude", "--profile", "default"] },
      { command: "/opt/any/node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs", "registry-bridge", "serve", "--host", "claude", "--profile", "default"] },
      { command: "node", args: ["./scripts/h2a-bridge-shim.mjs", "registry-bridge", "serve", "--host", "claude", "--profile", "default"] },
      { command: "node", omitShim: true, args: ["${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs", "registry-bridge", "serve", "--host", "claude", "--profile", "default"] }
    ]) {
      rmSync(join(home, ".claude", "plugins"), { recursive: true, force: true });
      writeClaudePluginCache(home, PKG.version, badSpec);
      assert.equal(await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default", "--auto-upgrade"
      ], streams(), { delegateServe: async () => 0 }), 2, `bad plugin spec must be rejected: ${JSON.stringify(badSpec)}`);
      assert.ok(!existsSync(lockPath), `bad plugin spec must not create lock: ${JSON.stringify(badSpec)}`);
    }
  });
});

test("2a concurrency: 24 parallel child processes running serve --auto-upgrade atomically provision default.lock.json without race failures", async (t) => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      const configPath = join(home, ".claude.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
      writeClaudePluginCache(home);
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      const runtimeBase = admitCentral(t, dir, dir);

      const runnerScript = join(dir, "race-worker.mjs");
      writeFileSync(
        runnerScript,
        `import { cmdRegistryBridge } from ${JSON.stringify(fileURLToPath(new URL("../dist/registry/cli-registry.js", import.meta.url)))};\n` +
        `let stdout = "", stderr = "";\n` +
        `const code = await cmdRegistryBridge([\n` +
        `  "serve", "--host", "claude", "--profile", "default",\n` +
        `  "--wake", "auto", "--auto-open", "--auto-upgrade",\n` +
        `  "--root", ${JSON.stringify(dir)}, "--runtime-base", ${JSON.stringify(runtimeBase)}\n` +
        `], { stdout: { write(s) { stdout += s; } }, stderr: { write(s) { stderr += s; } } }, { delegateServe: async () => 0 });\n` +
        `process.stdout.write(stdout);\n` +
        `process.stderr.write(stderr);\n` +
        `process.exit(code);\n`
      );

      const N = 24;
      const results = await Promise.all(Array.from({ length: N }, () => new Promise((resolveProc) => {
        const child = spawn(process.execPath, [runnerScript], {
          env: {
            HOME: home,
            XDG_CONFIG_HOME: join(home, ".config"),
            XDG_RUNTIME_DIR: dir,
            TMPDIR: dir,
            CLAUDE_CODE_SESSION_ID: "lock-recovery-session",
            H2A_MCP_CENTRAL: "1",
            H2A_ROOT: realpathSync(dir),
            PATH: process.env.PATH
          }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code) => resolveProc({ code, stdout, stderr }));
      })));

      for (const [idx, res] of results.entries()) {
        assert.equal(res.code, 0, `parallel child process ${idx} failed: stdout=${res.stdout} stderr=${res.stderr}`);
        assert.doesNotMatch(res.stdout, /missing_lock/);
      }
      assert.ok(existsSync(lockPath), "lock exists after 24-process parallel startup");
      const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.equal(parsed.format, "h2a.registry-bridge-lock/v1");
      const leftovers = readdirSync(dirname(lockPath)).filter((f) => f.includes(".tmp-"));
      assert.deepEqual(leftovers, [], "no temporary lock files left behind");
    });
  });
});

test("2b: live bridge lock respects CLAUDE_CONFIG_DIR/CODEX_HOME/checkPresence; uninstall checks receipt mechanism and live sessions; doctor --repair provisions lock via rebootstrapMissingPluginLock", async () => {
  const bridgeLock = await import("../dist/registry/bridge-lock.js");
  const { doctorHostInstallations } = await import("../dist/hosts/installation-doctor.js");
  const { writePresence } = await import("../dist/runtime/local-files/presence.js");
  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      assert.equal(typeof bridgeLock.findVerifiedPluginVersionDir, "function", "findVerifiedPluginVersionDir helper must be exported");
      assert.equal(typeof bridgeLock.resolveClaudeConfigPath, "function", "resolveClaudeConfigPath shared helper must be exported");

      // 1. Custom CLAUDE_CONFIG_DIR and CODEX_HOME liveness + R3-P3-2 shared <CLAUDE_CONFIG_DIR>/.claude.json resolution
      const customClaudeDir = join(home, "custom-claude");
      const customCodexDir = join(home, "custom-codex");
      process.env.CLAUDE_CONFIG_DIR = customClaudeDir;
      process.env.CODEX_HOME = customCodexDir;
      assert.equal(bridgeLock.resolveClaudeConfigPath(home, process.env), join(customClaudeDir, ".claude.json"));
      const claudePluginDir = writeClaudePluginCache(home, PKG.version, { claudeRoot: customClaudeDir });
      const codexPluginDir = writeCodexPluginCache(home, PKG.version, { codexRoot: customCodexDir });

      const claudeConfig = join(customClaudeDir, ".claude.json");
      writeFileSync(claudeConfig, JSON.stringify({ mcpServers: {} }, null, 2));
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", claudeConfig, "--plugin-dir", claudePluginDir
      ], streams(), {}), 0);

      const pluginLock = bridgeLock.defaultPluginBridgeLockPath("claude", "default");
      assert.equal(bridgeLock.isBridgeLockLive(pluginLock, { home }).live, true, "live under CLAUDE_CONFIG_DIR");
      assert.equal(bridgeLock.quarantineBridgeLock(pluginLock, { home }).action, "preserved-live");

      // R3-P3-2: even when plugin cache and installed_plugins.json are removed, a plugin receipt at <CLAUDE_CONFIG_DIR>/.claude.json.h2a-registry.json
      // pointing to an existing manifest outside cache keeps the lock live via resolveClaudeConfigPath(home)
      const standalonePluginDir = writeClaudePluginCache(home, PKG.version, { claudeRoot: join(dir, "standalone-claude"), writeInstalled: false });
      rmSync(join(customClaudeDir, "plugins"), { recursive: true, force: true });
      writeFileSync(`${claudeConfig}.h2a-registry.json`, JSON.stringify({
        format: "h2a.registry-install/v1",
        host: "claude",
        profile: "default",
        mechanism: "plugin",
        plugin: { name: "h2a", version: PKG.version, manifest: join(standalonePluginDir, ".claude-plugin", "plugin.json") },
        lockPath: pluginLock,
        action: "installed"
      }));
      assert.equal(
        bridgeLock.isBridgeLockLive(pluginLock, { home }).live,
        true,
        "isBridgeLockLive must inspect <CLAUDE_CONFIG_DIR>/.claude.json.h2a-registry.json"
      );
      // Restore cache under customClaudeDir
      writeClaudePluginCache(home, PKG.version, { claudeRoot: customClaudeDir });

      // R3-P3-2: ensurePluginBridgeLockForDoctor must also inspect <CLAUDE_CONFIG_DIR>/.claude.json (refusing on conflicting file receipt there)
      rmSync(pluginLock, { force: true });
      writeFileSync(`${claudeConfig}.h2a-registry.json`, JSON.stringify({
        format: "h2a.registry-install/v1",
        host: "claude",
        profile: "default",
        mechanism: "file",
        action: "installed"
      }));
      const conflictDoctorReport = doctorHostInstallations({
        home,
        hosts: ["claude"],
        repair: true,
        runHostCommand: () => ({ ok: true }),
        now: () => new Date("2026-04-20T00:00:00.000Z")
      });
      const conflictClaudeReport = conflictDoctorReport.hosts.find((h) => h.host === "claude");
      assert.equal(
        conflictClaudeReport?.bridgeLock?.action,
        "refused",
        "doctor --repair must inspect <CLAUDE_CONFIG_DIR>/.claude.json and refuse when it has a conflicting file receipt"
      );
      // Restore clean plugin receipt and lock under customClaudeDir
      rmSync(`${claudeConfig}.h2a-registry.json`, { force: true });
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", claudeConfig, "--plugin-dir", claudePluginDir
      ], streams(), {}), 0);

      const codexConfig = join(customCodexDir, "config.toml");
      writeFileSync(codexConfig, "");
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "codex", "--profile", "default", "--config", codexConfig, "--plugin-dir", codexPluginDir
      ], streams(), {}), 0);
      const codexLock = bridgeLock.defaultPluginBridgeLockPath("codex", "default");
      assert.equal(bridgeLock.isBridgeLockLive(codexLock, { home }).live, true, "live under CODEX_HOME");

      // 2. checkPresence keeps a lock live even if config/plugin is absent, AND is wired in production cmdRegistry uninstall (R2-P1-2)
      const arbitraryLock = join(dir, "session.lock.json");
      bridgeLock.provisionBridgeLock(arbitraryLock);
      assert.equal(bridgeLock.isBridgeLockLive(arbitraryLock, {
        home,
        checkPresence: () => true
      }).live, true, "checkPresence keeps lock live");

      // Production wiring of checkPresence in `bootstrap uninstall`: register a live session in H2A_ROOT
      const presenceBus = join(dir, "presence-bus");
      assert.equal(await runCli(["init", "--root", presenceBus], streams(), {}), 0);
      writePresence(presenceBus, {
        sessionId: "sess-live-uninstall-guard",
        instance: "claude:live-guard:111122223333",
        host: "claude",
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        state: "live",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: []
      });
      const liveGuardConfig = join(dir, "live-guard-mcp.json");
      const liveGuardLock = join(dir, "live-guard.lock.json");
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--host", "claude", "--config", liveGuardConfig, "--lock", liveGuardLock
      ], streams(), {}), 0);
      const savedRoot = process.env.H2A_ROOT;
      process.env.H2A_ROOT = presenceBus;
      try {
        const liveUninstallIo = streams();
        assert.equal(await runCli([
          "registry", "bootstrap", "uninstall", "--host", "claude", "--config", liveGuardConfig
        ], liveUninstallIo, {}), 2, "bootstrap uninstall must refuse when listPresence(root) reports a live session for host");
        assert.match(liveUninstallIo.text().stderr, /active session presence/);
        assert.match(liveUninstallIo.text().stderr, /sess-live-uninstall-guard/, "N4-P3-4: refusal must name the blocking session id");
        assert.match(liveUninstallIo.text().stderr, /h2a sessions/, "N4-P3-4: refusal must state the expected follow-up action");
        assert.ok(existsSync(liveGuardLock), "lock preserved while session is live in presence store");
        assert.ok(existsSync(`${liveGuardConfig}.h2a-registry.json`), "receipt preserved while session is live");

        // N4-P3-4: An orphan file receipt on a host config that does NOT declare registry-bridge (e.g. mcpServers: {})
        // must still be uninstallable via the printed « reçu file » remedy even while a plugin session for that host is live
        const orphanFileConfig = join(dir, "orphan-file-mcp.json");
        const orphanFileLock = `${orphanFileConfig}.h2a-lock.json`;
        writeFileSync(orphanFileConfig, JSON.stringify({ mcpServers: {} }, null, 2));
        writeFileSync(`${orphanFileConfig}.h2a-registry.json`, JSON.stringify({
          format: "h2a.registry-install/v1",
          host: "claude",
          profile: "default",
          mechanism: "file",
          lockPath: orphanFileLock,
          action: "installed"
        }));
        bridgeLock.provisionBridgeLock(orphanFileLock);
        const orphanUninstallIo = streams();
        assert.equal(await runCli([
          "registry", "bootstrap", "uninstall", "--host", "claude", "--profile", "default", "--config", orphanFileConfig
        ], orphanUninstallIo, {}), 0, `N4-P3-4: orphan file receipt remedy must succeed when config does not serve registry-bridge: ${orphanUninstallIo.text().stderr}`);
        assert.ok(!existsSync(`${orphanFileConfig}.h2a-registry.json`), "orphan file receipt removed");
        assert.ok(!existsSync(orphanFileLock), "orphan file lock quarantined");
      } finally {
        if (savedRoot === undefined) delete process.env.H2A_ROOT;
        else process.env.H2A_ROOT = savedRoot;
      }

      // 3. bootstrap uninstall --mechanism plugin refuses while plugin cache exists, then quarantines once cache is removed
      const refusePluginUninstallIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "uninstall", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", claudeConfig
      ], refusePluginUninstallIo, {}), 2, "must refuse plugin uninstall while plugin cache is active");
      assert.ok(existsSync(pluginLock), "plugin lock preserved when plugin cache is active");
      assert.ok(existsSync(`${claudeConfig}.h2a-registry.json`), "plugin receipt preserved when refusal triggers");

      rmSync(join(customClaudeDir, "plugins"), { recursive: true, force: true });
      const okPluginUninstallIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "uninstall", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", claudeConfig
      ], okPluginUninstallIo, {}), 0, okPluginUninstallIo.text().stderr);
      assert.ok(!existsSync(pluginLock), "retired plugin lock quarantined after cache removal");
      assert.ok(!existsSync(`${claudeConfig}.h2a-registry.json`), "retired plugin receipt removed");
      rmSync(customClaudeDir, { recursive: true, force: true });
      delete process.env.CLAUDE_CONFIG_DIR;
      delete process.env.CODEX_HOME;

      const homeClaudeConfig = join(home, ".claude.json");
      writeFileSync(homeClaudeConfig, JSON.stringify({ mcpServers: {} }, null, 2));

      // 4. N-P2-2 (N2): `uninstall --mechanism plugin` against a `file` receipt must refuse with code 2 without deleting the file receipt;
      // subsequent `file` uninstall without --lock quarantines the custom --lock from the preserved receipt.
      const fileConfig = join(dir, "mcp.json");
      const customLock = join(dir, "custom- locks", "my-custom.lock.json");
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--host", "claude", "--config", fileConfig, "--lock", customLock
      ], streams(), {}), 0);
      const customLockBytes = readFileSync(customLock, "utf8");
      const fileReceiptBytes = readFileSync(`${fileConfig}.h2a-registry.json`, "utf8");
      const receiptLeftovers = readdirSync(dirname(fileConfig)).filter((f) => f.includes(".h2a-registry.json.tmp-"));
      assert.deepEqual(receiptLeftovers, [], "atomic receipt write leaves no tmp files");

      const wrongMechanismUninstallIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "uninstall", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", fileConfig
      ], wrongMechanismUninstallIo, {}), 2, "uninstall --mechanism plugin must refuse when receipt is mechanism=file");
      assert.equal(readFileSync(`${fileConfig}.h2a-registry.json`, "utf8"), fileReceiptBytes, "file receipt must remain untouched");
      assert.ok(existsSync(customLock), "custom lock must remain untouched");

      const uninstallNoLockFlagIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "uninstall", "--host", "claude", "--config", fileConfig
      ], uninstallNoLockFlagIo, {}), 0, uninstallNoLockFlagIo.text().stderr);
      assert.ok(!existsSync(customLock), "custom --lock from receipt was quarantined even without --lock flag");
      const customQuarantined = readdirSync(dirname(customLock)).filter((f) => f.startsWith("my-custom.lock.json.quarantine-"));
      assert.equal(customQuarantined.length, 1);
      assert.equal(readFileSync(join(dirname(customLock), customQuarantined[0]), "utf8"), customLockBytes);

      // 5. Liveness check happens BEFORE deleting host config when --lock points to a live plugin lock
      const activePluginDir = writeClaudePluginCache(home);
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", homeClaudeConfig, "--plugin-dir", activePluginDir
      ], streams(), {}), 0);
      const fileConfig2 = join(dir, "mcp2.json");
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--host", "claude", "--config", fileConfig2
      ], streams(), {}), 0);
      const beforeConfig2 = readFileSync(fileConfig2, "utf8");
      const conflictUninstallIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "uninstall", "--host", "claude", "--config", fileConfig2, "--lock", pluginLock
      ], conflictUninstallIo, {}), 2, "must refuse before mutating config when --lock is a live plugin lock");
      assert.equal(readFileSync(fileConfig2, "utf8"), beforeConfig2, "host config was not mutated before liveness refusal");
      assert.ok(existsSync(`${fileConfig2}.h2a-registry.json`), "receipt was not deleted before liveness refusal");

      // 6. Quarantine error on read-only directory is surfaced as action: "error" (never "absent")
      const roDir = join(dir, "ro-lock-dir");
      const roConfig = join(dir, "ro-mcp.json");
      const roLock = join(roDir, "ro.lock.json");
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--host", "claude", "--config", roConfig, "--lock", roLock
      ], streams(), {}), 0);
      chmodSync(roDir, 0o500);
      try {
        const roUninstallIo = streams();
        const roCode = await runCli([
          "registry", "bootstrap", "uninstall", "--host", "claude", "--config", roConfig, "--lock", roLock
        ], roUninstallIo, {});
        assert.notEqual(roCode, 0, "quarantine failure must exit non-zero");
        assert.match(roUninstallIo.text().stdout, /"lockAction":\s*"error"/);
      } finally {
        chmodSync(roDir, 0o700);
      }

      // 7. doctorHostInstallations with repair: true provisions missing default.lock.json via rebootstrapMissingPluginLock and reports bridgeLock
      rmSync(pluginLock, { force: true });
      rmSync(codexLock, { force: true });
      writeCodexPluginCache(home);
      writeFileSync(join(home, ".codex", "config.toml"), "");
      writeFileSync(homeClaudeConfig, JSON.stringify({ mcpServers: {} }, null, 2));
      rmSync(`${homeClaudeConfig}.h2a-registry.json`, { force: true });

      const report = doctorHostInstallations({
        home,
        hosts: ["claude", "codex"],
        repair: true,
        runHostCommand: () => ({ ok: true }),
        now: () => new Date("2026-04-20T00:00:00.000Z")
      });
      assert.ok(report, "doctor report returned");
      assert.ok(existsSync(pluginLock), "doctor --repair provisioned Claude default.lock.json");
      assert.ok(existsSync(codexLock), "doctor --repair provisioned Codex default.lock.json");
      const codexLockData = JSON.parse(readFileSync(codexLock, "utf8"));
      assert.ok(!codexLockData.bridge.args.includes("--auto-upgrade"), "Codex lock provisioned by doctor must not carry --auto-upgrade");
      const claudeHostReport = report.hosts.find((h) => h.host === "claude");
      const codexHostReport = report.hosts.find((h) => h.host === "codex");
      assert.equal(claudeHostReport?.bridgeLock?.action, "provisioned", "doctor report records bridgeLock provisioned for claude");
      assert.equal(codexHostReport?.bridgeLock?.action, "provisioned", "doctor report records bridgeLock provisioned for codex");
    });
  });
});

test("2c: PATH resolution accepts umask 002 (0775) PATH dirs, rejects 0775 fallback prefixes with chmod message, avoids shim self-recursion, relays SIGTERM, and executes declared manifests", async () => {
  const hostBootstrap = await import("../dist/registry/host-bootstrap.js");
  const shimModule = await import("../scripts/h2a-bridge-shim.mjs");

  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      // 1. Relative PATH entries and 0775/0777 fallback prefixes outside PATH must be rejected with chmod diagnostic;
      //    umask 002 (0775) directories ON PATH must be accepted (N-P1-1), and shim + host-bootstrap must agree.
      const relBin = join(dir, "rel-bin");
      mkdirSync(relBin, { recursive: true });
      writeFileSync(join(relBin, "h2a"), "#!/bin/sh\necho hijacked\n", { mode: 0o755 });

      const wwPrefix = join(home, ".npm-global");
      const wwBin = join(wwPrefix, "bin");
      const wwPkgDist = join(wwPrefix, "lib", "node_modules", "@sentropic", "h2a", "dist");
      mkdirSync(wwBin, { recursive: true });
      mkdirSync(wwPkgDist, { recursive: true });
      const wwRealBinJs = join(wwPkgDist, "bin.js");
      writeFileSync(wwRealBinJs, `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
      const wwH2a = join(wwBin, "h2a");
      symlinkSync(wwRealBinJs, wwH2a);
      const wwChainDirs = [
        wwPrefix,
        wwBin,
        join(wwPrefix, "lib"),
        join(wwPrefix, "lib", "node_modules"),
        join(wwPrefix, "lib", "node_modules", "@sentropic"),
        join(wwPrefix, "lib", "node_modules", "@sentropic", "h2a"),
        wwPkgDist
      ];
      for (const d of wwChainDirs) chmodSync(d, 0o777);

      // Outside PATH: world-writable 0777 fallback prefix must be rejected by both host-bootstrap and shim
      const fallbackEnv = {
        HOME: home,
        PATH: `.:./rel-bin:/usr/bin:/bin`,
        H2A_PREFIX: "relative/prefix",
        NPM_CONFIG_PREFIX: "./relative-npm"
      };
      const hbRejected = [];
      const shimRejected = [];
      assert.equal(hostBootstrap.resolveH2aExecutable(fallbackEnv, { rejected: hbRejected }), null, "host-bootstrap rejects 0777 fallback outside PATH");
      assert.equal(shimModule.resolveH2aExecutable(fallbackEnv, undefined, { rejected: shimRejected }), null, "shim rejects 0777 fallback outside PATH");
      // N4-P3-1: All untrusted ancestors in the chain must be listed at once (never stopping after the first 2 via break)
      for (const d of wwChainDirs) {
        assert.ok(hbRejected.some((r) => r.includes(`${d} has mode 0777`)), `N4-P3-1: host-bootstrap rejected list must include ${d}, got: ${hbRejected.join("; ")}`);
        assert.ok(shimRejected.some((r) => r.includes(`${d} has mode 0777`)), `N4-P3-1: shim rejected list must include ${d}, got: ${shimRejected.join("; ")}`);
      }

      // Running the shim when fallback is 0777 outside PATH must list all rejected ancestors, mode 0777, uid, and chmod go-w
      const shimPath = join(PKG_ROOT, "scripts", "h2a-bridge-shim.mjs");
      const rejectedRun = spawnSync(process.execPath, [
        shimPath, "registry-bridge", "serve", "--host", "claude", "--profile", "default"
      ], {
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_RUNTIME_DIR: dir,
          TMPDIR: dir,
          PATH: "/usr/bin:/bin"
        },
        encoding: "utf8",
        timeout: 10_000
      });
      assert.equal(rejectedRun.status, 2);
      assert.match(rejectedRun.stderr, /missing_executable/);
      assert.match(rejectedRun.stderr, /0777/, `expected octal mode 0777 in shim refusal: ${rejectedRun.stderr}`);
      assert.match(rejectedRun.stderr, /chmod go-w/, `expected chmod go-w remedy in shim refusal: ${rejectedRun.stderr}`);
      for (const d of wwChainDirs) {
        assert.ok(rejectedRun.stderr.includes(d), `N4-P3-1: shim stderr must list ancestor ${d} at once: ${rejectedRun.stderr}`);
      }

      // N4-P2-2: When the ~/.npm-global chain is untrusted (0777), bootstrap install --mechanism plugin and doctor --repair
      // must NOT stay silent: they must report `PATH fallback not linked: <reasons, chmod>` on stderr and in JSON/report output,
      // and leave ~/.local/bin/h2a unlinked.
      const unlinkedConfigPath = join(home, ".claude.json");
      writeFileSync(unlinkedConfigPath, JSON.stringify({ mcpServers: {} }, null, 2));
      const unlinkedPluginDir = writeClaudePluginCache(home);
      const unlinkedCodexPluginDir = writeCodexPluginCache(home);
      void unlinkedCodexPluginDir;
      writeFileSync(join(home, ".codex", "config.toml"), "");
      const unlinkedInstallIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", unlinkedConfigPath, "--plugin-dir", unlinkedPluginDir
      ], unlinkedInstallIo, {}), 0);
      assert.ok(!existsSync(join(home, ".local", "bin", "h2a")), "N4-P2-2: ~/.local/bin/h2a must not be linked when target chain is 0777");
      assert.match(unlinkedInstallIo.text().stderr, /PATH fallback not linked:.*0777.*chmod go-w/, `N4-P2-2: install stderr must report PATH fallback not linked: ${unlinkedInstallIo.text().stderr}`);
      const unlinkedInstallOut = JSON.parse(unlinkedInstallIo.text().stdout);
      assert.equal(unlinkedInstallOut.pathFallback?.linked, null, "N4-P2-2: install JSON output reports pathFallback.linked = null");
      assert.match(unlinkedInstallOut.pathFallback?.warning ?? "", /PATH fallback not linked:.*chmod go-w/);

      const { doctorHostInstallations } = await import("../dist/hosts/installation-doctor.js");
      const doctorFallbackIo = streams();
      const doctorFallbackReport = doctorHostInstallations({
        home,
        hosts: ["codex"],
        repair: true,
        stderr: doctorFallbackIo.stderr,
        runHostCommand: () => ({ ok: true }),
        now: () => new Date("2026-04-20T00:00:00.000Z")
      });
      assert.match(doctorFallbackIo.text().stderr, /PATH fallback not linked:.*0777.*chmod go-w/, `N4-P2-2: doctor stderr must not be neutralized: ${doctorFallbackIo.text().stderr}`);
      const codexDoctorFallback = doctorFallbackReport.hosts.find((h) => h.host === "codex");
      assert.equal(codexDoctorFallback?.pathFallback?.linked, null, "N4-P2-2: doctor host report includes pathFallback");
      assert.match(codexDoctorFallback?.pathFallback?.warning ?? "", /PATH fallback not linked:.*chmod go-w/);
      if (codexDoctorFallback?.bridgeLock?.lockPath) {
        rmSync(codexDoctorFallback.bridgeLock.lockPath, { force: true });
      }

      // On PATH: umask 002 (0775) bin directory in PATH must be accepted by both host-bootstrap and shim, and launch h2a!
      for (const d of wwChainDirs) chmodSync(d, 0o775);
      const onPathEnv = {
        HOME: home,
        PATH: `${wwBin}:/usr/bin:/bin`
      };
      assert.equal(hostBootstrap.resolveH2aExecutable(onPathEnv), wwH2a, "host-bootstrap accepts 0775 bin dir when on PATH");
      assert.equal(shimModule.resolveH2aExecutable(onPathEnv), wwH2a, "shim accepts 0775 bin dir when on PATH");
      const onPathRun = spawnSync(process.execPath, [
        shimPath, "registry-bridge", "serve", "--host", "claude", "--profile", "default"
      ], {
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_RUNTIME_DIR: dir,
          TMPDIR: dir,
          PATH: `${wwBin}:/usr/bin:/bin`
        },
        encoding: "utf8",
        timeout: 10_000
      });
      assert.equal(onPathRun.status, 2);
      assert.doesNotMatch(onPathRun.stdout, /missing_executable/, "bin 0775 in PATH must launch h2a, not fail missing_executable");
      assert.match(onPathRun.stdout, /central_unavailable|missing_lock/);

      // Fix fallback permissions to 0o755: now ~/.npm-global/bin/h2a is trusted even when outside PATH ( while HOME and ~/.local are 0775 from umask 002!)
      chmodSync(home, 0o775);
      for (const d of wwChainDirs) chmodSync(d, 0o755);
      const validResolved = hostBootstrap.resolveH2aExecutable({
        HOME: home,
        PATH: "/usr/bin:/bin"
      });
      assert.equal(validResolved, wwH2a, "trusted ~/.npm-global/bin/h2a is resolved when outside PATH");
      assert.equal(shimModule.resolveH2aExecutable({ HOME: home, PATH: "/usr/bin:/bin" }), wwH2a, "shim agrees with host-bootstrap");

      // 2. ensureLocalBinH2aFallback: works even when ~/.local and ~/.local/bin are 0775 (umask 002), logs to stderr, ignores H2A_PREFIX, heals broken symlink
      const localDir = join(home, ".local");
      const localBin = join(localDir, "bin");
      const localBinH2a = join(localBin, "h2a");
      mkdirSync(localBin, { recursive: true, mode: 0o775 });
      chmodSync(localDir, 0o775);
      chmodSync(localBin, 0o775);

      const configPath = join(home, ".claude.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
      const pluginDir = writeClaudePluginCache(home);

      // Even if H2A_PREFIX points to an attacker path, ensureLocalBinH2aFallback must ignore H2A_PREFIX
      const fakePrefix = join(dir, "attacker-prefix");
      mkdirSync(join(fakePrefix, "bin"), { recursive: true });
      writeFileSync(join(fakePrefix, "bin", "h2a"), "#!/bin/sh\n", { mode: 0o755 });
      process.env.H2A_PREFIX = fakePrefix;

      const installPluginIo = streams();
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
      ], installPluginIo, {}), 0);
      delete process.env.H2A_PREFIX;

      assert.ok(existsSync(localBinH2a), "verifyPluginInstall linked ~/.local/bin/h2a under 0775 ~/.local/bin");
      assert.equal(realpathSync(localBinH2a), realpathSync(wwH2a), "linked to ~/.npm-global/bin/h2a, never H2A_PREFIX");
      assert.match(installPluginIo.text().stderr, /linked PATH fallback/, "stderr logs the created ~/.local/bin/h2a link");

      // Replace ~/.local/bin/h2a with a broken symlink to a non-h2a path under HOME: must NOT be unlinked even if HOME path contains /h2a/
      rmSync(localBinH2a, { force: true });
      symlinkSync(join(home, "other-tool", "bin", "other"), localBinH2a);
      assert.equal(hostBootstrap.ensureLocalBinH2aFallback(home, process.env, streams().stderr), null);
      assert.ok(lstatSync(localBinH2a).isSymbolicLink() && !existsSync(localBinH2a), "non-h2a broken symlink under HOME is untouched");

      // Replace ~/.local/bin/h2a with a broken symlink to an old h2a path under HOME and verify repair replaces it
      rmSync(localBinH2a, { force: true });
      symlinkSync(join(home, ".npm-global", "lib", "node_modules", "@sentropic", "h2a-old", "dist", "bin.js"), localBinH2a);
      assert.ok(lstatSync(localBinH2a).isSymbolicLink() && !existsSync(localBinH2a), "precondition: broken symlink");
      assert.equal(await runCli([
        "registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
      ], streams(), {}), 0);
      assert.ok(existsSync(localBinH2a), "broken symlink under HOME was replaced with working symlink");

      // 3. If ~/.local/bin/h2a is a symlink to h2a-bridge-shim.mjs itself, shim must skip itself and not recurse
      rmSync(localBinH2a, { force: true });
      symlinkSync(shimPath, localBinH2a);
      const selfLoopRun = spawnSync(process.execPath, [
        shimPath, "registry-bridge", "serve", "--host", "claude", "--profile", "default"
      ], {
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_RUNTIME_DIR: dir,
          TMPDIR: dir,
          PATH: `${localBin}:/usr/bin:/bin`
        },
        encoding: "utf8",
        timeout: 10_000
      });
      assert.equal(selfLoopRun.status, 2, `shim avoided self-recursion and ran h2a: ${selfLoopRun.stderr}`);
      assert.match(selfLoopRun.stdout, /central_unavailable/);
      rmSync(localBinH2a, { force: true });

      // Restore working ~/.local/bin/h2a link via ensureLocalBinH2aFallback
      hostBootstrap.ensureLocalBinH2aFallback(home, process.env);
      assert.ok(existsSync(localBinH2a));

      // 4. Execute the DECLARED manifest command from .claude-plugin/registry.mcp.json and .codex-plugin/registry.mcp.json
      const nodeOnlyBin = join(dir, "node-only-bin");
      mkdirSync(nodeOnlyBin, { recursive: true, mode: 0o755 });
      chmodSync(nodeOnlyBin, 0o755);
      symlinkSync(process.execPath, join(nodeOnlyBin, "node"));
      const claudeManifest = JSON.parse(readFileSync(join(PKG_ROOT, ".claude-plugin", "registry.mcp.json"), "utf8"));
      const codexManifest = JSON.parse(readFileSync(join(PKG_ROOT, ".codex-plugin", "registry.mcp.json"), "utf8"));

      // Claude manifest: uses node + ${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs (expanded by Claude Code)
      const claudeEntry = claudeManifest.mcpServers.h2a;
      assert.equal(claudeEntry.command, "node", "claude manifest must declare node command");
      assert.match(claudeEntry.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/h2a-bridge-shim\.mjs$/);
      const claudeRun = spawnSync(
        claudeEntry.command,
        claudeEntry.args.map((arg) => arg.replace("${CLAUDE_PLUGIN_ROOT}", PKG_ROOT.replace(/\/$/, ""))),
        {
          env: {
            HOME: home,
            XDG_CONFIG_HOME: join(home, ".config"),
            XDG_RUNTIME_DIR: dir,
            TMPDIR: dir,
            PATH: `${nodeOnlyBin}:/usr/bin:/bin`
          },
          encoding: "utf8",
          timeout: 10_000
        }
      );
      assert.equal(claudeRun.status, 2, `declared claude manifest command failed: ${claudeRun.stderr}`);
      assert.match(claudeRun.stdout, /central_unavailable/);
      assert.doesNotMatch(claudeRun.stdout, /missing_lock/);
      assert.doesNotMatch(claudeRun.stdout, /missing_executable/);

      // Codex manifest (N-P1-2 / R2-P1-1 / N-P3-3): must NOT depend on ${CLAUDE_PLUGIN_ROOT};
      // executed AS DECLARED without any variable substitution under login PATH (${localBin}:${nodeOnlyBin}:/usr/bin:/bin)
      const codexEntry = codexManifest.mcpServers.h2a;
      assert.equal(codexEntry.command, "h2a", "codex manifest must declare h2a command without ${CLAUDE_PLUGIN_ROOT}");
      assert.ok(!JSON.stringify(codexEntry).includes("CLAUDE_PLUGIN_ROOT"), "codex manifest must not reference CLAUDE_PLUGIN_ROOT");
      const codexRun = spawnSync(codexEntry.command, codexEntry.args, {
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_RUNTIME_DIR: dir,
          TMPDIR: dir,
          PATH: `${localBin}:${nodeOnlyBin}:/usr/bin:/bin`
        },
        encoding: "utf8",
        timeout: 10_000
      });
      assert.equal(codexRun.status, 2, `declared codex manifest command failed: ${codexRun.stderr ?? codexRun.error?.message}`);
      assert.match(codexRun.stdout, /missing_lock/, "codex run must reach h2a and report missing_lock");
      assert.doesNotMatch(codexRun.stdout, /missing_executable/, "codex run must not fail with missing_executable");

      // 5. N-P3-8 / R2-P2-3 / R3-P3-1: Shim relays SIGTERM even after non-fatal SIGINT or SIGHUP
      const sigBinDir = join(dir, "sig-bin");
      mkdirSync(sigBinDir, { recursive: true, mode: 0o755 });
      const sigMarkerFile = join(dir, "child-sigterm.txt");
      const dummyH2a = join(sigBinDir, "h2a");
      writeFileSync(
        dummyH2a,
        `#!${process.execPath}\n` +
        `import { writeFileSync } from "node:fs";\n` +
        `const received = [];\n` +
        `process.on("SIGINT", () => { received.push("SIGINT"); process.stdout.write("GOT_SIGINT\\n"); });\n` +
        `process.on("SIGHUP", () => { received.push("SIGHUP"); process.stdout.write("GOT_SIGHUP\\n"); });\n` +
        `process.on("SIGTERM", () => { received.push("SIGTERM"); writeFileSync(${JSON.stringify(sigMarkerFile)}, received.join(",")); process.exit(0); });\n` +
        `process.stdout.write("READY\\n");\n` +
        `setTimeout(() => process.exit(1), 2000);\n`,
        { mode: 0o755 }
      );
      await new Promise((resolveSig, rejectSig) => {
        const shimProc = spawn(process.execPath, [shimPath, "registry-bridge", "serve"], {
          env: {
            HOME: home,
            PATH: `${sigBinDir}:/usr/bin:/bin`
          }
        });
        const timer = setTimeout(() => {
          try { shimProc.kill("SIGKILL"); } catch { /* ignore */ }
          rejectSig(new Error("timed out waiting for shim to forward SIGTERM after SIGINT/SIGHUP"));
        }, 5000);
        let buf = "";
        let sentSigint = false;
        let sentSighup = false;
        let sentSigterm = false;
        shimProc.stdout.on("data", (chunk) => {
          buf += chunk.toString();
          if (!sentSigint && buf.includes("READY")) {
            sentSigint = true;
            shimProc.kill("SIGINT");
          }
          if (!sentSighup && buf.includes("GOT_SIGINT")) {
            sentSighup = true;
            shimProc.kill("SIGHUP");
          }
          if (!sentSigterm && buf.includes("GOT_SIGHUP")) {
            sentSigterm = true;
            shimProc.kill("SIGTERM");
          }
        });
        shimProc.on("error", (err) => { clearTimeout(timer); rejectSig(err); });
        shimProc.on("close", () => { clearTimeout(timer); resolveSig(); });
      });
      assert.equal(readFileSync(sigMarkerFile, "utf8"), "SIGINT,SIGHUP,SIGTERM", "shim must relay SIGTERM even after non-fatal SIGINT and SIGHUP");
    });
  });
});

test("2d: central_unavailable and prefix_owner_mismatch report exact failing condition and condition-specific actionable owner commands", async () => {
  const { defaultPluginBridgeLockPath, provisionBridgeLock } = await import("../dist/registry/bridge-lock.js");
  const { prepareAuthority } = await import("../dist/runtime/handover/admission.js");
  const { prefixLayout } = await import("../dist/runtime/handover/authority.js");

  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock(lockPath);

      // Condition 2 failure: missing CLAUDE_CODE_SESSION_ID -> remedy mentions CLAUDE_CODE_SESSION_ID (not mcp-central-serve)
      const savedSession = process.env.CLAUDE_CODE_SESSION_ID;
      delete process.env.CLAUDE_CODE_SESSION_ID;
      try {
        const io2 = streams();
        const code2 = await cmdRegistryBridge([
          "serve", "--host", "claude", "--profile", "default", "--runtime-base", dir
        ], io2, { delegateServe: async () => 0 });
        assert.equal(code2, 2);
        assert.match(io2.text().stderr, /condition 2 failed.*CLAUDE_CODE_SESSION_ID/);
        assert.doesNotMatch(io2.text().stderr, /remediation: h2a mcp-central-serve/);
      } finally {
        if (savedSession !== undefined) process.env.CLAUDE_CODE_SESSION_ID = savedSession;
      }

      // Condition 3 failure: H2A_MCP_CENTRAL=0 -> remedy mentions unsetting/enabling H2A_MCP_CENTRAL
      const savedCentral = process.env.H2A_MCP_CENTRAL;
      process.env.CLAUDE_CODE_SESSION_ID = "diag-session";
      process.env.H2A_MCP_CENTRAL = "0";
      try {
        const io3 = streams();
        const code3 = await cmdRegistryBridge([
          "serve", "--host", "claude", "--profile", "default", "--runtime-base", dir
        ], io3, { delegateServe: async () => 0 });
        assert.equal(code3, 2);
        assert.match(io3.text().stderr, /H2A_MCP_CENTRAL=0/);
        assert.match(io3.text().stderr, /unset H2A_MCP_CENTRAL|H2A_MCP_CENTRAL=1/);
      } finally {
        if (savedCentral === undefined) delete process.env.H2A_MCP_CENTRAL;
        else process.env.H2A_MCP_CENTRAL = savedCentral;
      }

      // Condition 4 failure: missing marker at runtime-base -> remedy includes --runtime-base
      process.env.CLAUDE_CODE_SESSION_ID = "diag-session";
      process.env.H2A_MCP_CENTRAL = "1";
      try {
        const noMarkerBase = join(dir, "no-marker");
        const io4 = streams();
        const code4 = await cmdRegistryBridge([
          "serve", "--host", "claude", "--profile", "default", "--runtime-base", noMarkerBase
        ], io4, { delegateServe: async () => 0 });
        assert.equal(code4, 2);
        assert.match(io4.text().stderr, /marker\.json/);
        assert.match(io4.text().stderr, /h2a mcp-central-serve/);
        assert.ok(io4.text().stderr.includes(`--runtime-base ${noMarkerBase}`), `expected --runtime-base in ${io4.text().stderr}`);

        // N4-P2-1: Condition 4 with operator-stop.json (paused: true vs paused: false)
        // 1) Persist canonical operator pause via `h2a central stop --runtime-base <pausedBase>`
        const pausedBase = join(dir, "paused-base");
        mkdirSync(pausedBase, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        chmodSync(pausedBase, 0o700);
        const stopIo = streams();
        assert.equal(await runCli(["central", "stop", "--runtime-base", pausedBase], stopIo, {}), 0, stopIo.text().stderr);
        const ioPaused = streams();
        assert.equal(await cmdRegistryBridge([
          "serve", "--host", "claude", "--profile", "default", "--runtime-base", pausedBase
        ], ioPaused, { delegateServe: async () => 0 }), 2);
        const pausedStderr = ioPaused.text().stderr;
        assert.match(pausedStderr, /operator-stop\.json/);
        assert.doesNotMatch(pausedStderr, /h2a central start/, "N4-P2-1: must never suggest non-existent `h2a central start`");
        assert.match(pausedStderr, /resume central with: h2a mcp-central-serve --root .* --runtime-base /);
        assert.match(pausedStderr, /h2a central status --runtime-base /);

        // Execute the printed `h2a central status` and `h2a mcp-central-serve` commands via runCli
        const statusIo = streams();
        assert.equal(await runCli(["central", "status", "--runtime-base", pausedBase], statusIo, {}), 0, statusIo.text().stderr);
        assert.equal(JSON.parse(statusIo.text().stdout).paused, true, "central status reports paused=true before resume");

        const centralRoot = join(home, "h2a-workspace", ".h2a");
        mkdirSync(centralRoot, { recursive: true, mode: 0o700 });
        assert.equal(await runCli(["init", "--root", centralRoot], streams(), {}), 0);
        const pkgMode = lstatSync(PKG_ROOT).mode & 0o777;
        chmodSync(PKG_ROOT, 0o755);
        try {
          const ac = new AbortController();
          let serveStderr = "";
          const serveIo = {
            stdout: { write() {} },
            stderr: {
              write(chunk) {
                serveStderr += chunk;
                if (serveStderr.includes("listening on")) ac.abort();
              }
            }
          };
          const serveExit = await runCli(
            ["mcp-central-serve", "--root", centralRoot, "--runtime-base", pausedBase],
            serveIo,
            { signal: ac.signal }
          );
          assert.equal(serveExit, 0, `N4-P2-1: printed mcp-central-serve command must be accepted by runCli and start central: ${serveStderr}`);
          assert.match(serveStderr, /listening on/, "mcp-central-serve started listening");
        } finally {
          chmodSync(PKG_ROOT, pkgMode);
        }

        // After explicit serve lifted the pause and stopped cleanly, operator-stop.json has paused: false and marker.json is absent:
        // central_unavailable must NOT falsely claim `paused by operator`!
        const statusAfterIo = streams();
        assert.equal(await runCli(["central", "status", "--runtime-base", pausedBase], statusAfterIo, {}), 0);
        assert.equal(JSON.parse(statusAfterIo.text().stdout).paused, false, "mcp-central-serve lifted paused to false");

        const ioUnpausedNoMarker = streams();
        assert.equal(await cmdRegistryBridge([
          "serve", "--host", "claude", "--profile", "default", "--runtime-base", pausedBase
        ], ioUnpausedNoMarker, { delegateServe: async () => 0 }), 2);
        assert.doesNotMatch(
          ioUnpausedNoMarker.text().stderr,
          /paused by operator/,
          `N4-P2-1: operator-stop.json with paused=false must not be reported as paused by operator: ${ioUnpausedNoMarker.text().stderr}`
        );
        assert.match(ioUnpausedNoMarker.text().stderr, /missing or unreadable central marker/);
      } finally {
        delete process.env.CLAUDE_CODE_SESSION_ID;
        delete process.env.H2A_MCP_CENTRAL;
      }

      // prefix_owner_mismatch in authority.js and admission.js distinguishes mode (chmod go-w) vs uid (chown)
      const badPrefix = join(dir, "writable-prefix");
      mkdirSync(badPrefix, { recursive: true });
      chmodSync(badPrefix, 0o775);

      assert.throws(
        () => prefixLayout(badPrefix, badPrefix, process.getuid()),
        (err) => {
          assert.match(err.message, /prefix_owner_mismatch/);
          assert.ok(err.message.includes(badPrefix), `expected path in ${err.message}`);
          assert.match(err.message, /0775/);
          assert.ok(err.message.includes("chmod go-w"), `expected chmod go-w in ${err.message}`);
          return true;
        }
      );

      assert.throws(
        () => prefixLayout(badPrefix, badPrefix, process.getuid() + 1),
        (err) => {
          assert.match(err.message, /prefix_owner_mismatch/);
          assert.match(err.message, /chown/);
          return true;
        }
      );

      await assert.rejects(
        () => prepareAuthority({ directory: join(dir, "auth-dir"), root: join(dir, "root"), physicalPrefix: badPrefix }),
        (err) => {
          assert.match(err.message, /prefix_owner_mismatch/);
          assert.ok(err.message.includes(badPrefix), `expected path in ${err.message}`);
          assert.match(err.message, /0775/);
          assert.ok(err.message.includes("chmod go-w"), `expected chmod go-w in ${err.message}`);
          return true;
        }
      );
    });
  });
});

test("2e: isExclusiveUserPrivateGroup admits sole-member UPG and fails closed on shared groups, foreign uid/gid, or malformed tables", async () => {
  const hostBootstrap = await import("../dist/registry/host-bootstrap.js");
  const shimModule = await import("../scripts/h2a-bridge-shim.mjs");

  const passwdExclusive = "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000:Alice:/home/alice:/bin/bash\nbob:x:1001:1001:Bob:/home/bob:/bin/bash\n";
  const groupExclusiveEmpty = "root:x:0:\nalice:x:1000:\nbob:x:1001:\n";
  const groupExclusiveSelf = "root:x:0:\nalice:x:1000:alice\nbob:x:1001:\n";
  const groupSharedMember = "root:x:0:\nalice:x:1000:bob\nbob:x:1001:\n";
  const passwdSharedPrimaryGid = "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000:Alice:/home/alice:/bin/bash\nbob:x:1001:1000:Bob:/home/bob:/bin/bash\n";

  for (const [label, fn] of [
    ["host-bootstrap", hostBootstrap.isExclusiveUserPrivateGroup],
    ["h2a-bridge-shim", shimModule.isExclusiveUserPrivateGroup]
  ]) {
    assert.equal(fn({ uid: 1000, gid: 1000 }, { uid: 1000, gid: 1000, passwdContent: passwdExclusive, groupContent: groupExclusiveEmpty }), true, `${label}: empty member list UPG`);
    assert.equal(fn({ uid: 1000, gid: 1000 }, { uid: 1000, gid: 1000, passwdContent: passwdExclusive, groupContent: groupExclusiveSelf }), true, `${label}: self-only member list UPG`);
    assert.equal(fn({ uid: 1000, gid: 1000 }, { uid: 1000, gid: 1000, passwdContent: passwdExclusive, groupContent: groupSharedMember }), false, `${label}: shared /etc/group member rejected`);
    assert.equal(fn({ uid: 1000, gid: 1000 }, { uid: 1000, gid: 1000, passwdContent: passwdSharedPrimaryGid, groupContent: groupExclusiveEmpty }), false, `${label}: shared /etc/passwd primary gid rejected`);
    assert.equal(fn({ uid: 0, gid: 0 }, { uid: 1000, gid: 1000, passwdContent: passwdExclusive, groupContent: groupExclusiveEmpty }), false, `${label}: root-owned path rejected for non-root user`);
    assert.equal(fn({ uid: 1000, gid: 100 }, { uid: 1000, gid: 1000, passwdContent: passwdExclusive, groupContent: groupExclusiveEmpty }), false, `${label}: non-primary gid rejected`);
    assert.equal(fn({ uid: 1000, gid: 1000 }, { uid: 1000, gid: 1000, passwdContent: "malformed", groupContent: groupExclusiveEmpty }), false, `${label}: malformed /etc/passwd fails closed`);
    assert.equal(fn({ uid: 1000, gid: 1000 }, { uid: 1000, gid: 1000, passwdContent: passwdExclusive, groupContent: "malformed" }), false, `${label}: malformed /etc/group fails closed`);
  }
});

test("2f: plain npm pack + npm install -g under umask 0002 passes registry bootstrap PATH fallback and bridge shim under UPG", async () => {
  const hostBootstrap = await import("../dist/registry/host-bootstrap.js");
  const shimModule = await import("../scripts/h2a-bridge-shim.mjs");

  await withIsolatedHome(async (home) => {
    await withTempDir(async (dir) => {
      const pkgSrc = join(dir, "pkg-src");
      const pkgDist = join(pkgSrc, "dist");
      mkdirSync(pkgDist, { recursive: true, mode: 0o755 });
      writeFileSync(
        join(pkgSrc, "package.json"),
        JSON.stringify({ name: "@sentropic/h2a", version: "0.98.11", bin: { h2a: "dist/bin.js" } }, null, 2) + "\n",
        { mode: 0o644 }
      );
      writeFileSync(join(pkgDist, "bin.js"), `#!/usr/bin/env node\nprocess.stdout.write("h2a-packed-ok\\n");\n`, { mode: 0o755 });
      chmodSync(pkgSrc, 0o755);
      chmodSync(pkgDist, 0o755);
      chmodSync(join(pkgDist, "bin.js"), 0o755);

      const npmCache = join(dir, "npm-cache");
      const userConfig = join(dir, "npmrc");
      const globalConfig = join(dir, "global-npmrc");
      mkdirSync(npmCache, { recursive: true, mode: 0o700 });
      writeFileSync(userConfig, "");
      writeFileSync(globalConfig, "");

      const npmEnv = {
        ...process.env,
        HOME: home,
        TMPDIR: dir,
        TMP: dir,
        TEMP: dir,
        npm_config_cache: npmCache,
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
        npm_config_update_notifier: "false"
      };
      for (const k of Object.keys(npmEnv)) {
        if (/^npm_config_(?:umask|prefix)$/i.test(k)) delete npmEnv[k];
      }

      const prevUmask = process.umask(0o022);
      let tarballPath;
      try {
        const packRes = spawnSync("npm", ["pack", "--offline", "--json", "--pack-destination", dir], {
          cwd: pkgSrc,
          env: npmEnv,
          encoding: "utf8",
          timeout: 30_000
        });
        assert.equal(packRes.status, 0, `npm pack failed: ${packRes.stderr}`);
        const receipt = JSON.parse(packRes.stdout)[0];
        tarballPath = join(dir, receipt.filename);
      } finally {
        process.umask(prevUmask);
      }

      const prefix = join(home, ".npm-global");
      mkdirSync(prefix, { recursive: true, mode: 0o755 });
      chmodSync(prefix, 0o755);

      const prevInstallUmask = process.umask(0o002);
      try {
        const installRes = spawnSync(
          "npm",
          ["install", "-g", "--prefix", prefix, "--offline", "--no-audit", "--no-fund", tarballPath],
          { cwd: dir, env: npmEnv, encoding: "utf8", timeout: 30_000 }
        );
        assert.equal(installRes.status, 0, `npm install -g failed: ${installRes.stderr}`);
      } finally {
        process.umask(prevInstallUmask);
      }

      const installedDist = join(prefix, "lib", "node_modules", "@sentropic", "h2a", "dist");
      const installedBin = join(installedDist, "bin.js");
      const installedCmd = join(prefix, "bin", "h2a");
      const distSt = statSync(installedDist);
      const binSt = statSync(installedBin);
      assert.equal(distSt.mode & 0o777, 0o775, "reproduces npm pacote extracting dist with 0775 under umask 0002");
      assert.equal(binSt.mode & 0o777, 0o775, "reproduces npm pacote extracting dist/bin.js with 0775 under umask 0002");

      const hostHasExclusiveUpg = hostBootstrap.isExclusiveUserPrivateGroup(binSt);
      assert.equal(shimModule.isExclusiveUserPrivateGroup(binSt), hostHasExclusiveUpg, "shim and host-bootstrap agree on host UPG status");

      if (hostHasExclusiveUpg) {
        const narrowEnv = { HOME: home, PATH: "/usr/bin:/bin" };
        assert.equal(hostBootstrap.resolveH2aExecutable(narrowEnv), installedCmd, "host-bootstrap resolves 0775 UPG npm install -g outside PATH");
        assert.equal(shimModule.resolveH2aExecutable(narrowEnv), installedCmd, "shim resolves 0775 UPG npm install -g outside PATH");

        const configPath = join(home, ".claude.json");
        writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
        const pluginDir = writeClaudePluginCache(home);
        const io = streams();
        assert.equal(await runCli([
          "registry", "bootstrap", "install", "--mechanism", "plugin",
          "--host", "claude", "--profile", "default", "--config", configPath, "--plugin-dir", pluginDir
        ], io, {}), 0);
        const out = JSON.parse(io.text().stdout);
        const expectedLink = join(home, ".local", "bin", "h2a");
        assert.equal(out.pathFallback?.linked, expectedLink, `bootstrap must link ~/.local/bin/h2a under UPG umask 0002 install, stderr: ${io.text().stderr}`);
        assert.equal(out.pathFallback?.warning, undefined);
        assert.equal(realpathSync(expectedLink), realpathSync(installedBin));
      } else {
        const rejectedNonUpg = [];
        assert.equal(hostBootstrap.resolveH2aExecutable({ HOME: home, PATH: "/usr/bin:/bin" }, { rejected: rejectedNonUpg }), null, "non-UPG host must fail closed on 0775");
        assert.ok(rejectedNonUpg.some((r) => r.includes("0775") && r.includes("chmod go-w")));
        assert.equal(shimModule.resolveH2aExecutable({ HOME: home, PATH: "/usr/bin:/bin" }), null, "shim must agree on non-UPG fail-closed 0775");
      }

      // World-writable 0777 must STILL be rejected even under UPG
      chmodSync(installedBin, 0o777);
      const rejected = [];
      assert.equal(hostBootstrap.resolveH2aExecutable({ HOME: home, PATH: "/usr/bin:/bin" }, { rejected }), null);
      assert.ok(rejected.some((r) => r.includes("0777") && r.includes("chmod go-w")));
      assert.equal(shimModule.resolveH2aExecutable({ HOME: home, PATH: "/usr/bin:/bin" }), null);
    });
  });
});
