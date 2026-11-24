import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { doctorHostInstallations } from "../dist/hosts/installation-doctor.js";
import { defaultPluginBridgeLockPath, provisionBridgeLock, readBridgeLock } from "../dist/registry/bridge-lock.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { currentCliVersion } from "../dist/runtime/upgrade/index.js";

const SHIM_SCRIPT = fileURLToPath(new URL("../scripts/h2a-bridge-shim.mjs", import.meta.url));

function isolated(suffix = "b3") {
  const dir = mkdtempSync(join(tmpdir(), `h2a-doctor-${suffix}-`));
  chmodSync(dir, 0o700);
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  return { dir, home, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}

async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function writeClaudeCache(home, version) {
  const claudeRoot = join(home, ".claude");
  const pluginDir = join(claudeRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, "scripts"), { recursive: true });
  writeFileSync(join(pluginDir, "scripts", "h2a-bridge-shim.mjs"), readFileSync(SHIM_SCRIPT, "utf8"), { mode: 0o755 });
  const args = ["${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs", "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade"];
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "h2a", version, mcpServers: "./.claude-plugin/registry.mcp.json" }, null, 2));
  writeFileSync(join(pluginDir, ".claude-plugin", "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "node", args } } }, null, 2));
  const installedPath = join(claudeRoot, "plugins", "installed_plugins.json");
  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(installedPath, JSON.stringify({ version: 2, plugins: { "h2a@sentropic": [{ scope: "user", installPath: pluginDir, version }] } }, null, 2));
  // Minimal marketplace + settings so repairClaude can proceed to the lock step.
  writeFileSync(join(claudeRoot, "plugins", "known_marketplaces.json"), JSON.stringify({ "sentropic": { installPath: pluginDir } }, null, 2));
  return pluginDir;
}

function writeCodexCache(home, version) {
  const codexRoot = join(home, ".codex");
  const pluginDir = join(codexRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "h2a", version, mcpServers: "./.codex-plugin/registry.mcp.json" }, null, 2));
  writeFileSync(join(pluginDir, ".codex-plugin", "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["registry-bridge", "serve", "--host", "codex", "--profile", "default", "--wake", "auto", "--auto-open"] } } }, null, 2));
  return pluginDir;
}

function bridgeReport(report, host) {
  const entry = report.hosts.find((h) => h.host === host);
  assert.ok(entry, `doctor report must contain host ${host}`);
  return entry.bridgeLock;
}

test("B-3 (i): doctor --repair converges drifted N-1 digest with quarantinePath", async () => {
  const iso = isolated("converge");
  try {
    const configPath = join(iso.home, ".claude.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
    writeClaudeCache(iso.home, "0.98.10");
    const h2aPrior = structuredClone(registryPackageManifest.entries[0]);
    const trackPrior = structuredClone(trackRegistryPackageManifest.entries[0]);
    h2aPrior.publisher.packageVersion = "0.98.10";
    trackPrior.publisher.packageVersion = "0.98.10";
    await withEnv({ HOME: iso.home, XDG_CONFIG_HOME: join(iso.home, ".config"), CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined }, async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default", h2aEntry: h2aPrior, trackEntry: trackPrior });
      const priorBytes = readFileSync(lockPath, "utf8");
      const report = doctorHostInstallations({ home: iso.home, version: currentCliVersion(), repair: true, hosts: ["claude"], testHostCliReachable: () => true, runHostCommand: () => ({ ok: true }), testClaudeConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } }, writeRepairMarker: () => {} });
      const bridge = bridgeReport(report, "claude");
      assert.ok(bridge, "doctor --repair must report bridgeLock");
      assert.equal(bridge.action, "provisioned");
      assert.ok(bridge.quarantinePath, "converged report must carry quarantinePath (B-3)");
      assert.ok(existsSync(bridge.quarantinePath), "quarantine file must exist");
      assert.equal(readFileSync(bridge.quarantinePath, "utf8"), priorBytes, "quarantine holds exact prior bytes");
      assert.notEqual(readFileSync(lockPath, "utf8"), priorBytes, "lock re-provisioned to current digests");
      readBridgeLock(lockPath);
      // Idempotent: a second repair converges nothing and quarantines nothing new.
      const convergedBytes = readFileSync(lockPath, "utf8");
      const beforeQ = readdirSync(dirname(lockPath)).filter((n) => n.startsWith("default.lock.json.quarantine-")).length;
      const again = doctorHostInstallations({ home: iso.home, version: currentCliVersion(), repair: true, hosts: ["claude"], testHostCliReachable: () => true, runHostCommand: () => ({ ok: true }), testClaudeConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } }, writeRepairMarker: () => {} });
      assert.ok(bridgeReport(again, "claude"), "second repair still reports bridgeLock");
      assert.equal(readFileSync(lockPath, "utf8"), convergedBytes, "idempotent repair leaves the converged lock untouched");
      assert.equal(readdirSync(dirname(lockPath)).filter((n) => n.startsWith("default.lock.json.quarantine-")).length, beforeQ, "idempotent repair creates no extra quarantine");
    });
  } finally { iso.cleanup(); }
});

test("B-3 (ii): doctor --repair refuses sabotaged lock, bytes intact, exact remedy", async () => {
  const iso = isolated("sabotage");
  try {
    // Home with a space forces shell quoting in the remedy (B-3/NB-2).
    const spacedHome = join(iso.dir, "home with space");
    mkdirSync(spacedHome, { recursive: true, mode: 0o700 });
    chmodSync(spacedHome, 0o700);
    const home = spacedHome;
    const configPath = join(home, ".claude.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
    const pluginDir = writeClaudeCache(home, "0.98.10");
    await withEnv({ HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined }, async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default" });
      const tampered = JSON.parse(readFileSync(lockPath, "utf8"));
      tampered.entries["sentropic.h2a"].digest = "f".repeat(64);
      writeFileSync(lockPath, JSON.stringify(tampered, null, 2));
      const tamperedBytes = readFileSync(lockPath, "utf8");
      const report = doctorHostInstallations({ home, version: currentCliVersion(), repair: true, hosts: ["claude"], testHostCliReachable: () => true, runHostCommand: () => ({ ok: true }), testClaudeConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } }, writeRepairMarker: () => {} });
      const bridge = bridgeReport(report, "claude");
      assert.ok(bridge, "doctor --repair must report bridgeLock");
      assert.equal(bridge.action, "refused");
      assert.equal(readFileSync(lockPath, "utf8"), tamperedBytes, "sabotaged bytes intact");
      const q = readdirSync(dirname(lockPath)).filter((n) => n.startsWith("default.lock.json.quarantine-"));
      assert.equal(q.length, 0, "no quarantine on refused tamper");
      assert.ok(bridge.error?.includes("integrity_mismatch"), "refusal keeps the cause");
      // Paths contain a space: the remedy must be shell-quoted (B-3).
      assert.ok(bridge.error?.includes(`'${configPath}'`), `remedy quotes exact config '${configPath}' (got: ${bridge.error})`);
      assert.ok(bridge.error?.includes(`'${pluginDir}'`), `remedy quotes exact plugin-dir '${pluginDir}' (got: ${bridge.error})`);
    });
  } finally { iso.cleanup(); }
});

test("B-3 (iii): doctor --repair names host-config conflict instead of bare install", async () => {
  const iso = isolated("cfgclash");
  try {
    // Legacy direct entry blocks plugin re-bootstrap: refresh throws.
    const configPath = join(iso.home, ".claude.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["mcp-serve", "--host", "claude"] } } }, null, 2));
    writeClaudeCache(iso.home, "0.98.10");
    const h2aPrior = structuredClone(registryPackageManifest.entries[0]);
    const trackPrior = structuredClone(trackRegistryPackageManifest.entries[0]);
    h2aPrior.publisher.packageVersion = "0.98.10";
    trackPrior.publisher.packageVersion = "0.98.10";
    await withEnv({ HOME: iso.home, XDG_CONFIG_HOME: join(iso.home, ".config"), CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined }, async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default", h2aEntry: h2aPrior, trackEntry: trackPrior });
      const priorBytes = readFileSync(lockPath, "utf8");
      const report = doctorHostInstallations({ home: iso.home, version: currentCliVersion(), repair: true, hosts: ["claude"], testHostCliReachable: () => true, runHostCommand: () => ({ ok: true }), testClaudeConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } }, writeRepairMarker: () => {} });
      const bridge = bridgeReport(report, "claude");
      assert.ok(bridge, "doctor --repair must report bridgeLock");
      assert.equal(bridge.action, "refused");
      assert.equal(readFileSync(lockPath, "utf8"), priorBytes, "conflicted N-1 lock untouched");
      assert.match(bridge.error ?? "", /conflicting mechanism|legacy direct h2a|duplicate mechanism|foreign h2a/i, `refusal must name the conflict (got: ${bridge.error})`);
    });
  } finally { iso.cleanup(); }
});

test("B-3 (iv): doctor --repair converges drifted codex N-1 digest with quarantinePath", async () => {
  const iso = isolated("codex-converge");
  try {
    const configPath = join(iso.home, ".codex", "config.toml");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, 'model = "test"\n');
    writeCodexCache(iso.home, "0.98.10");
    const h2aPrior = structuredClone(registryPackageManifest.entries[0]);
    const trackPrior = structuredClone(trackRegistryPackageManifest.entries[0]);
    h2aPrior.publisher.packageVersion = "0.98.10";
    trackPrior.publisher.packageVersion = "0.98.10";
    await withEnv({ HOME: iso.home, XDG_CONFIG_HOME: join(iso.home, ".config"), CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined }, async () => {
      const lockPath = defaultPluginBridgeLockPath("codex", "default");
      provisionBridgeLock({ lockPath, host: "codex", profile: "default", h2aEntry: h2aPrior, trackEntry: trackPrior });
      const priorBytes = readFileSync(lockPath, "utf8");
      const report = doctorHostInstallations({ home: iso.home, version: currentCliVersion(), repair: true, hosts: ["codex"], testHostCliReachable: () => true, runHostCommand: () => ({ ok: true }), testCodexConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } }, writeRepairMarker: () => {} });
      const bridge = bridgeReport(report, "codex");
      assert.ok(bridge, "doctor --repair must report bridgeLock");
      assert.equal(bridge.action, "provisioned");
      assert.ok(bridge.quarantinePath, "converged codex report must carry quarantinePath (B-3)");
      assert.ok(existsSync(bridge.quarantinePath), "codex quarantine file must exist");
      assert.equal(readFileSync(bridge.quarantinePath, "utf8"), priorBytes, "codex quarantine holds exact prior bytes");
      assert.notEqual(readFileSync(lockPath, "utf8"), priorBytes, "codex lock re-provisioned to current digests");
      readBridgeLock(lockPath);
    });
  } finally { iso.cleanup(); }
});
