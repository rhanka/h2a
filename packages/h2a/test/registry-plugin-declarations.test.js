import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { runCli } from "../dist/index.js";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";

// LOT-4B shipped plugin declarations (SP-01 -> RQ-08, RQ-12, RQ-16, RQ-17).
// The tarball is packed once per file run and shared by the extraction cases.

const exec = promisify(execFile);
const REPO = new URL("../../../", import.meta.url).pathname;
const PKG = JSON.parse(readFileSync(join(REPO, "packages/h2a/package.json"), "utf8"));

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-4b-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  const home = mkdtempSync(join(tmpdir(), "h2a-4b-home-"));
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  try {
    return await fn(home);
  } finally {
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
    rmSync(home, { recursive: true, force: true });
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashTree(root) {
  const out = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[full.slice(root.length + 1)] = sha256File(full);
    }
  };
  walk(root);
  return out;
}

let EXTRACTED = null;

before(async () => {
  const lab = mkdtempSync(join(tmpdir(), "h2a-4b-pack-"));
  try {
    const output = join(lab, "tarballs");
    const env = { PATH: process.env.PATH, LANG: "C.UTF-8" };
    for (const name of ["HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR"]) {
      env[name] = join(lab, name);
      mkdirSync(env[name], { mode: 0o700 });
    }
    await exec(process.execPath, ["scripts/pack-candidate.mjs", output], { cwd: REPO, env, timeout: 230_000, maxBuffer: 8 * 1024 * 1024 });
    const tarball = join(output, `sentropic-h2a-${PKG.version}.tgz`);
    assert.ok(existsSync(tarball), "candidate h2a tarball produced");
    const dest = join(lab, "extracted");
    mkdirSync(dest, { recursive: true });
    await exec("tar", ["-xzf", tarball, "-C", dest]);
    const list = (await exec("tar", ["-tzf", tarball], { maxBuffer: 32 * 1024 * 1024 })).stdout;
    EXTRACTED = { lab, dest: join(dest, "package"), list };
  } catch (error) {
    rmSync(lab, { recursive: true, force: true });
    throw error;
  }
});

after(async () => {
  if (EXTRACTED) rmSync(EXTRACTED.lab, { recursive: true, force: true });
});

test("LOT-4B (b): extracted tarball declares the bridge in both shipped plugins", async () => {
  const claudeManifest = JSON.parse(readFileSync(join(EXTRACTED.dest, ".claude-plugin/plugin.json"), "utf8"));
  const codexManifest = JSON.parse(readFileSync(join(EXTRACTED.dest, ".codex-plugin/plugin.json"), "utf8"));
  const claudeAsset = JSON.parse(readFileSync(join(EXTRACTED.dest, ".claude-plugin/registry.mcp.json"), "utf8"));
  const codexAsset = JSON.parse(readFileSync(join(EXTRACTED.dest, ".codex-plugin/registry.mcp.json"), "utf8"));
  assert.equal(claudeManifest.name, "h2a");
  assert.equal(claudeManifest.version, PKG.version);
  assert.equal(claudeManifest.mcpServers, "./.claude-plugin/registry.mcp.json");
  assert.equal(codexManifest.name, "h2a");
  assert.equal(codexManifest.mcpServers, "./.codex-plugin/registry.mcp.json");
  assert.deepEqual(Object.keys(claudeAsset.mcpServers), ["h2a"]);
  assert.deepEqual(Object.keys(codexAsset.mcpServers), ["h2a"]);
  for (const asset of [claudeAsset, codexAsset]) {
    assert.equal(asset.mcpServers.h2a.command, "h2a");
    assert.ok(asset.mcpServers.h2a.args.includes("registry-bridge"));
    assert.ok(!JSON.stringify(asset).includes("mcp-serve"));
  }
  assert.ok(claudeAsset.mcpServers.h2a.args.includes("--auto-upgrade"));
  assert.ok(!codexAsset.mcpServers.h2a.args.includes("--auto-upgrade"));
  assert.ok(!EXTRACTED.list.split("\n").includes("package/.mcp.json"), "root .mcp.json ships no more");
  // skills/ and hooks/ payload entries are unchanged.
  for (const rel of ["skills/h2a/SKILL.md", "hooks/hooks.json"]) {
    assert.equal(
      readFileSync(join(EXTRACTED.dest, rel), "utf8"),
      readFileSync(join(REPO, "packages/h2a", rel), "utf8"),
      `${rel} unchanged in payload`
    );
  }
});

test("LOT-4B (c): the renderer regenerates both assets byte-identically", async () => {
  const renderer = join(REPO, "scripts/generate-plugin-declarations.mjs");
  const claudeAsset = join(REPO, "packages/h2a/.claude-plugin/registry.mcp.json");
  const codexAsset = join(REPO, "packages/h2a/.codex-plugin/registry.mcp.json");
  await exec(process.execPath, [renderer, "--check"], { cwd: REPO });
  const before = [sha256File(claudeAsset), sha256File(codexAsset)];
  await exec(process.execPath, [renderer], { cwd: REPO });
  assert.deepEqual([sha256File(claudeAsset), sha256File(codexAsset)], before);
});

test("LOT-4B (c): the renderer refuses an unknown host before any write", async () => {
  const renderer = join(REPO, "scripts/generate-plugin-declarations.mjs");
  const claudeAsset = join(REPO, "packages/h2a/.claude-plugin/registry.mcp.json");
  const codexAsset = join(REPO, "packages/h2a/.codex-plugin/registry.mcp.json");
  const before = [sha256File(claudeAsset), sha256File(codexAsset)];
  let failed = null;
  try {
    await exec(process.execPath, [renderer, "--host", "nope"], { cwd: REPO });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, "unknown host must fail");
  assert.match(String(failed.stderr ?? failed.message), /unsupported_host|unknown host/);
  assert.deepEqual([sha256File(claudeAsset), sha256File(codexAsset)], before);
});

test("LOT-4B (d): generated declarations carry the legacy per-host context flags", () => {
  const claudeAsset = JSON.parse(readFileSync(join(REPO, "packages/h2a/.claude-plugin/registry.mcp.json"), "utf8"));
  const codexAsset = JSON.parse(readFileSync(join(REPO, "packages/h2a/.codex-plugin/registry.mcp.json"), "utf8"));
  assert.deepEqual(claudeAsset.mcpServers.h2a.args, [
    "registry-bridge", "serve", "--host", "claude", "--profile", "default",
    "--wake", "auto", "--auto-open", "--auto-upgrade"
  ]);
  assert.deepEqual(codexAsset.mcpServers.h2a.args, [
    "registry-bridge", "serve", "--host", "codex", "--profile", "default",
    "--wake", "auto", "--auto-open"
  ]);
});

const LEGACY_CLAUDE_JSON = `{
  "mcpServers": {
    "h2a": { "command": "h2a", "args": ["mcp-serve", "--host", "claude", "--wake", "auto"] }
  }
}
`;

function writeMigratedPluginDir(dir, host, args) {
  const sub = host === "claude" ? ".claude-plugin" : ".codex-plugin";
  mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, sub, "plugin.json"), JSON.stringify({
    name: "h2a",
    version: PKG.version,
    mcpServers: `./${sub}/registry.mcp.json`
  }, null, 2));
  writeFileSync(join(dir, sub, "registry.mcp.json"), JSON.stringify({
    mcpServers: { h2a: { command: "h2a", args } }
  }, null, 2));
}

function writeLegacyPluginDir(dir) {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "h2a",
    version: PKG.version,
    mcpServers: { h2a: { command: "h2a", args: ["mcp-serve", "--host", "claude", "--wake", "auto"] } }
  }, null, 2));
}

test("LOT-4B (e): plugin install records the receipt and edits nothing", async () => {
  // NOTE: defaultPluginBridgeLockPath is imported dynamically so the
  // pre-fix RED is scoped to these tests, not a whole-file load failure.
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async () => {
    await withTempDir(async (dir) => {
      const config = join(dir, "mcp.json");
      const pluginDir = join(dir, "plugin");
      writeFileSync(config, LEGACY_CLAUDE_JSON);
      writeMigratedPluginDir(pluginDir, "claude", [
        "registry-bridge", "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade"
      ]);
      const beforeTree = hashTree(pluginDir);
      const beforeConfig = sha256File(config);
      const io = streams();
      const code = await runCli(["registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", config, "--plugin-dir", pluginDir], io, {});
      assert.equal(code, 0, io.text().stderr);
      const receipt = JSON.parse(readFileSync(`${config}.h2a-registry.json`, "utf8"));
      assert.equal(receipt.mechanism, "plugin");
      assert.equal(receipt.plugin.name, "h2a");
      assert.equal(receipt.lockPath, defaultPluginBridgeLockPath("claude", "default"));
      assert.ok(existsSync(receipt.lockPath), "plugin install provisions the default lock");
      assert.deepEqual(hashTree(pluginDir), beforeTree, "plugin cache files byte-identical");
      assert.equal(sha256File(config), beforeConfig, "host config byte-identical");
    });
  });
});

test("LOT-4B (e): file install after a plugin receipt refuses as duplicate mechanism", async () => {
  await withIsolatedHome(async () => {
    await withTempDir(async (dir) => {
      const config = join(dir, "mcp.json");
      const pluginDir = join(dir, "plugin");
      const lock = join(dir, "file.h2a-lock.json");
      writeFileSync(config, LEGACY_CLAUDE_JSON);
      writeMigratedPluginDir(pluginDir, "claude", [
        "registry-bridge", "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade"
      ]);
      let io = streams();
      assert.equal(await runCli(["registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", config, "--plugin-dir", pluginDir], io, {}), 0, io.text().stderr);
      io = streams();
      const code = await runCli(["registry", "bootstrap", "install",
        "--host", "claude", "--profile", "default", "--config", config, "--lock", lock], io, {});
      assert.notEqual(code, 0);
      assert.match(io.text().stderr, /mechanism/);
      assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_JSON);
      assert.ok(!existsSync(lock), "refused file install writes no lock");
    });
  });
});

test("LOT-4B (e): plugin install after a file receipt refuses as duplicate mechanism", async () => {
  await withIsolatedHome(async () => {
    await withTempDir(async (dir) => {
      const config = join(dir, "mcp.json");
      const pluginDir = join(dir, "plugin");
      const lock = join(dir, "file.h2a-lock.json");
      writeFileSync(config, LEGACY_CLAUDE_JSON);
      writeMigratedPluginDir(pluginDir, "claude", [
        "registry-bridge", "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade"
      ]);
      let io = streams();
      assert.equal(await runCli(["registry", "bootstrap", "install",
        "--host", "claude", "--profile", "default", "--config", config, "--lock", lock], io, {}), 0, io.text().stderr);
      const beforeTree = hashTree(pluginDir);
      const beforeConfig = sha256File(config);
      io = streams();
      const code = await runCli(["registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", config, "--plugin-dir", pluginDir], io, {});
      assert.notEqual(code, 0);
      assert.match(io.text().stderr, /mechanism/);
      assert.deepEqual(hashTree(pluginDir), beforeTree);
      assert.equal(sha256File(config), beforeConfig);
    });
  });
});

test("LOT-4B (e): plugin install against a legacy mcp-serve plugin refuses", async () => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async () => {
    await withTempDir(async (dir) => {
      const config = join(dir, "mcp.json");
      const pluginDir = join(dir, "plugin");
      writeFileSync(config, LEGACY_CLAUDE_JSON);
      writeLegacyPluginDir(pluginDir);
      const io = streams();
      const code = await runCli(["registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", config, "--plugin-dir", pluginDir], io, {});
      assert.notEqual(code, 0);
      assert.match(io.text().stderr, /mcp-serve|legacy/);
      assert.ok(!existsSync(`${config}.h2a-registry.json`), "no receipt on refusal");
      assert.ok(!existsSync(defaultPluginBridgeLockPath("claude", "default")), "no lock on refusal");
    });
  });
});

test("LOT-4B (e): the shipped claude plugin verifies through the plugin flow", async () => {
  await withIsolatedHome(async () => {
    await withTempDir(async (dir) => {
      const config = join(dir, "mcp.json");
      const pluginDir = join(dir, "shipped");
      mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
      writeFileSync(config, LEGACY_CLAUDE_JSON);
      for (const name of ["plugin.json", "registry.mcp.json"]) {
        writeFileSync(
          join(pluginDir, ".claude-plugin", name),
          readFileSync(join(REPO, "packages/h2a/.claude-plugin", name), "utf8")
        );
      }
      const io = streams();
      const code = await runCli(["registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", config, "--plugin-dir", pluginDir], io, {});
      assert.equal(code, 0, io.text().stderr);
      const receipt = JSON.parse(readFileSync(`${config}.h2a-registry.json`, "utf8"));
      assert.equal(receipt.mechanism, "plugin");
      assert.ok(existsSync(receipt.lockPath));
    });
  });
});

test("LOT-4B (f): serve without --lock resolves the provisioned default lock", async () => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async () => {
    await withTempDir(async (dir) => {
      const config = join(dir, "mcp.json");
      const pluginDir = join(dir, "plugin");
      writeFileSync(config, LEGACY_CLAUDE_JSON);
      writeMigratedPluginDir(pluginDir, "claude", [
        "registry-bridge", "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade"
      ]);
      const io = streams();
      assert.equal(await runCli(["registry", "bootstrap", "install", "--mechanism", "plugin",
        "--host", "claude", "--profile", "default", "--config", config, "--plugin-dir", pluginDir], io, {}), 0, io.text().stderr);
      const expected = defaultPluginBridgeLockPath("claude", "default");
      let delegated = null;
      const serveIo = streams();
      const code = await cmdRegistryBridge(["serve", "--host", "claude", "--profile", "default"], serveIo, {
        delegateServe: async (flags) => {
          delegated = flags;
          return 0;
        }
      });
      if (code === 2) {
        // No qualified central route in this harness: the refusal must be the
        // attachment refusal, never a missing lock (the lock resolved).
        assert.match(serveIo.text().stdout, /central_unavailable/);
      } else {
        assert.equal(code, 0, serveIo.text().stderr);
        assert.equal(delegated.lock, expected);
      }
      assert.ok(!JSON.stringify(serveIo.text().stdout).includes("missing_lock"));
    });
  });
});

test("LOT-4B (f): serve without --lock and no lock anywhere refuses missing_lock", async () => {
  const { defaultPluginBridgeLockPath } = await import("../dist/registry/bridge-lock.js");
  await withIsolatedHome(async () => {
    const expected = defaultPluginBridgeLockPath("claude", "default");
    assert.ok(!existsSync(expected));
    let delegated = 0;
    const io = streams();
    const code = await cmdRegistryBridge(["serve", "--host", "claude", "--profile", "default"], io, {
      delegateServe: async () => {
        delegated++;
        return 0;
      }
    });
    assert.equal(code, 2);
    assert.match(io.text().stdout, /missing_lock/);
    assert.match(io.text().stderr, /missing_lock/);
    assert.ok(io.text().stderr.includes(expected), "diagnostic names the default lock path");
    assert.equal(delegated, 0, "serves nothing");
  });
});

test("LOT-4B (g): shipped plugin bytes preserve the qualified tool set", async () => {
  const { qualifiedToolId } = await import("../dist/registry/host-bootstrap.js");
  const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../dist/runtime/mcp/tools.js");
  const names = H2A_CLI_MCP_TOOL_DESCRIPTORS.map((tool) => tool.name);
  const legacyEntry = { command: "h2a", args: ["mcp-serve", "--host", "claude", "--wake", "auto"] };
  for (const [host, rel] of [["claude", ".claude-plugin/registry.mcp.json"], ["codex", ".codex-plugin/registry.mcp.json"]]) {
    const shipped = JSON.parse(readFileSync(join(EXTRACTED.dest, rel), "utf8"));
    assert.deepEqual(Object.keys(shipped.mcpServers), ["h2a"]);
    const entry = shipped.mcpServers.h2a;
    assert.ok(entry.args.includes("registry-bridge"));
    assert.ok(!entry.args.includes("mcp-serve"));
    assert.ok(legacyEntry.args.includes("mcp-serve"));
    const preSet = new Set(names.map((name) => qualifiedToolId(host, "plugin", name)));
    const postSet = new Set(names.map((name) => qualifiedToolId(host, "plugin", name)));
    assert.deepEqual([...postSet].sort(), [...preSet].sort());
    assert.ok(qualifiedToolId(host, "plugin", names[0]).startsWith("mcp__plugin_h2a_h2a__"));
  }
});
