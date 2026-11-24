import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";
import { defaultPluginBridgeLockPath, provisionBridgeLock } from "../dist/registry/bridge-lock.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";

const SHIM_SCRIPT = fileURLToPath(new URL("../scripts/h2a-bridge-shim.mjs", import.meta.url));

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write(t) { stdout += t; } },
    stderr: { write(t) { stderr += t; } },
    text: () => ({ stdout, stderr }),
  };
}

function isolated() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-upgrade-heal-"));
  chmodSync(dir, 0o700);
  const home = join(dir, "home");
  const xdgConfig = join(home, ".config");
  const xdgRuntime = join(dir, "runtime");
  const root = join(home, "ws", ".h2a");
  for (const d of [home, xdgConfig, xdgRuntime, root]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
  return { dir, home, xdgConfig, xdgRuntime, root, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
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

function writeCodexCache(home, version) {
  const codexRoot = join(home, ".codex");
  const pluginDir = join(codexRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "h2a", version, mcpServers: "./.codex-plugin/registry.mcp.json" }, null, 2));
  writeFileSync(join(pluginDir, ".codex-plugin", "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["registry-bridge", "serve", "--host", "codex", "--profile", "default", "--wake", "auto", "--auto-open"] } } }, null, 2));
  return pluginDir;
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
  return pluginDir;
}

function fakeMarker(xdgRuntime, root) {
  const parent = join(xdgRuntime, "h2a-mcp-central");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  writeFileSync(join(parent, "marker.json"), JSON.stringify({ endpoint: "http://127.0.0.1:9/mcp", generation: "upgrade-heal-fixture", pid: process.pid, startedAt: new Date().toISOString(), token: "t", protocol: 2, root }), { mode: 0o600 });
}

test("L5A-(a) codex stale N-1 lock self-heals on serve with quarantine, then serves", async () => {
  const iso = isolated();
  try {
    const configPath = join(iso.home, ".codex", "config.toml");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, 'model = "test"\n');
    writeCodexCache(iso.home, "0.98.10");
    fakeMarker(iso.xdgRuntime, iso.root);
    const h2aPrior = structuredClone(registryPackageManifest.entries[0]);
    const trackPrior = structuredClone(trackRegistryPackageManifest.entries[0]);
    h2aPrior.publisher.packageVersion = "0.98.10";
    trackPrior.publisher.packageVersion = "0.98.10";
    await withEnv({ HOME: iso.home, XDG_CONFIG_HOME: iso.xdgConfig, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_ROOT: iso.root, H2A_MCP_CENTRAL: "1", CLAUDE_CONFIG_DIR: undefined, CLAUDE_PLUGIN_ROOT: undefined, CODEX_HOME: undefined }, async () => {
      const lockPath = defaultPluginBridgeLockPath("codex", "default");
      provisionBridgeLock({ lockPath, host: "codex", profile: "default", h2aEntry: h2aPrior, trackEntry: trackPrior });
      const priorBytes = readFileSync(lockPath, "utf8");
      const io = streams();
      let delegated = 0;
      // --instance sidecar skips the claude-only shared-central admission
      // (R5-CA owns non-Claude adapters) so the lock heal can delegate.
      const code = await cmdRegistryBridge(["serve", "--host", "codex", "--profile", "default", "--wake", "auto", "--auto-open", "--instance", "test-sidecar", "--root", iso.root, "--runtime-base", iso.xdgRuntime], io, { delegateServe: async () => { delegated++; return 0; } });
      assert.equal(code, 0, `codex N-1 lock must self-heal on serve (stderr: ${io.text().stderr} stdout: ${io.text().stdout})`);
      assert.equal(delegated, 1, "must delegate after heal");
      assert.notEqual(readFileSync(lockPath, "utf8"), priorBytes, "lock re-provisioned to current digests");
      const q = readdirSync(dirname(lockPath)).filter((n) => n.startsWith("default.lock.json.quarantine-"));
      assert.ok(q.length >= 1, "old N-1 lock kept in quarantine");
      const qBytes = readFileSync(join(dirname(lockPath), q[0]), "utf8");
      assert.equal(qBytes, priorBytes, "quarantine holds exact prior bytes");
      assert.match(io.text().stderr, /quarantine/i, "heal logged with quarantine path");
    });
  } finally { iso.cleanup(); }
});

test("L5A-(a) integrity_mismatch that cannot self-heal prints the exact install remedy", async () => {
  const iso = isolated();
  try {
    const configPath = join(iso.home, ".claude.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
    const pluginDir = writeClaudeCache(iso.home, "0.98.10");
    fakeMarker(iso.xdgRuntime, iso.root);
    await withEnv({ HOME: iso.home, XDG_CONFIG_HOME: iso.xdgConfig, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_ROOT: iso.root, H2A_MCP_CENTRAL: "1", CLAUDE_CONFIG_DIR: undefined, CLAUDE_PLUGIN_ROOT: undefined, CODEX_HOME: undefined }, async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default" });
      const tampered = JSON.parse(readFileSync(lockPath, "utf8"));
      tampered.entries["sentropic.h2a"].digest = "f".repeat(64);
      writeFileSync(lockPath, JSON.stringify(tampered, null, 2));
      const io = streams();
      const code = await cmdRegistryBridge(["serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade", "--root", iso.root, "--runtime-base", iso.xdgRuntime], io, { delegateServe: async () => 0 });
      assert.equal(code, 2, "tampered lock must fail closed");
      const out = io.text().stdout + "\n" + io.text().stderr;
      assert.match(out, /integrity_mismatch/);
      assert.match(out, /registry bootstrap install --mechanism plugin --host claude --profile default --config .* --plugin-dir .*/);
      assert.ok(out.includes(pluginDir) || out.includes("--plugin-dir"), `remedy must name plugin-dir (got: ${out.slice(0, 800)})`);
    });
  } finally { iso.cleanup(); }
});
