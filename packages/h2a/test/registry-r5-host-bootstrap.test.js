import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const REPO_ROOT = new URL("../../../", import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, REPO_ROOT), "utf8"));

const H2A_ENTRY = readJson("packages/h2a/registry/entries.v1.json").entries[0];
const H2A_MANIFEST = readJson("packages/h2a/registry/manifest.h2a.json");
const TRACK_ENTRY = readJson("packages/track/registry/entries.v1.json").entries[0];
const TRACK_MANIFEST = readJson("packages/track/registry/manifest.track.json");

async function loadLib() {
  return import("../dist/registry/host-bootstrap.js");
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r5-boot-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LEGACY_CLAUDE_CONFIG = `{
  "theme": "dark",
  "mcpServers": {
    "graphify-ts": { "command": "npx", "args": ["graphify-ts"] },
    "h2a": { "command": "h2a", "args": ["mcp-serve", "--auto-open", "--host", "claude", "--wake", "auto"] }
  }
}
`;

// Byte shape of the interim direct Vibe entry shipped by PR #346
// (feat/vibe-mcp-direct @ 290b27f1, renderVibeMcpEntry): the R5 migration input.
const VIBE_DIRECT_CONFIG = `# vibe user config
[general]
name = "owner"

[[mcp_servers]]
name = "h2a"
transport = "stdio"
command = "h2a"
args = ["mcp-serve", "--auto-open", "--host", "vibe", "--wake", "auto"]

[[mcp_servers]]
name = "other"
transport = "stdio"
command = "other"
args = ["serve"]
`;

test("R5 bootstrap: every host renders exactly one bridge server keyed h2a", async () => {
  const { renderBridgeEntry, BRIDGE_SERVER_KEY, SUPPORTED_HOSTS } = await loadLib();
  assert.equal(BRIDGE_SERVER_KEY, "h2a");
  assert.deepEqual([...SUPPORTED_HOSTS].sort(), ["agy", "claude", "codex", "muse", "vibe"]);
  for (const host of SUPPORTED_HOSTS) {
    const rendered = renderBridgeEntry(host, { profile: "default" });
    assert.deepEqual(Object.keys(rendered.entry), ["h2a"]);
    assert.ok(!JSON.stringify(rendered.entry).includes("sentropic-registry"));
    assert.ok(rendered.args.includes("registry-bridge"));
  }
});

test("R5 bootstrap: qualified host-visible tool ids are continuous", async () => {
  const { qualifiedToolId } = await loadLib();
  assert.equal(qualifiedToolId("claude", "plugin", "h2a_send"), "mcp__plugin_h2a_h2a__h2a_send");
  assert.equal(qualifiedToolId("claude", "file", "h2a_send"), "mcp__h2a__h2a_send");
  assert.equal(qualifiedToolId("claude", "file", "track_query"), "mcp__h2a__track_query");
  assert.equal(qualifiedToolId("vibe", "file", "h2a_send"), "mcp__h2a__h2a_send");
  assert.throws(() => qualifiedToolId("claude", "file", "h2a renamed"), /invalid_entry/);
});

test("R5 bootstrap: legacy wire surface equals the registry plan at same selection", async () => {
  const registryLib = await import("../dist/registry/registry.js");
  const registry = registryLib.createRegistry();
  const handlers = new Map(H2A_MANIFEST.tools.map((t) => [t.name, () => ({})]));
  registry.register({ descriptor: structuredClone(H2A_ENTRY), manifest: structuredClone(H2A_MANIFEST), handlers });
  const trackHandlers = new Map(TRACK_MANIFEST.tools.map((t) => [t.name, () => ({})]));
  registry.register({ descriptor: structuredClone(TRACK_ENTRY), manifest: structuredClone(TRACK_MANIFEST), handlers: trackHandlers });
  registry.select(["sentropic.h2a", "sentropic.track"]);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" });
  registry.configure("sentropic.track", { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" });
  const candidate = await registry.compile({
    bindings: {
      "h2a-local-central": { contract: "h2a.central-attachment/v2" },
      "h2a-attachment-workspace": { contract: "h2a.workspace/v1" },
      "h2a-hosted-service": { contract: "h2a.hosted-service/v1" }
    },
    compatibility: { hostFeatures: ["stdio", "streamable-http"], protocolVersions: ["2025-06-18"] }
  });
  assert.equal(candidate.ok, true);
  const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../dist/runtime/mcp/tools.js");
  assert.deepEqual(candidate.plan.orderedCapabilities, H2A_CLI_MCP_TOOL_DESCRIPTORS.map((t) => t.name));
});

test("R5 bootstrap: JSON install preserves unrelated bytes and is idempotent", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const lock = join(dir, "mcp.json.h2a-lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    const preview = installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: lock, dryRun: true });
    assert.equal(preview.action, "migrate-direct");
    assert.ok(readFileSync(config, "utf8").includes('"mcp-serve"'));
    const first = installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: lock });
    assert.equal(first.action, "migrate-direct");
    const afterFirst = readFileSync(config, "utf8");
    assert.ok(afterFirst.includes("graphify-ts"));
    assert.ok(afterFirst.includes("registry-bridge"));
    assert.ok(!afterFirst.includes("mcp-serve"));
    assert.equal((afterFirst.match(/"h2a":/g) ?? []).length, 1);
    const second = installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: lock });
    assert.equal(second.action, "reinstall-identical");
    assert.equal(readFileSync(config, "utf8"), afterFirst);
  });
});

test("R5 bootstrap: non-default legacy declarations conflict instead of normalizing", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["mcp-serve", "--no-wake"] } } }));
    assert.throws(() => installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }), /--no-wake/);
    assert.ok(readFileSync(config, "utf8").includes("--no-wake"));
  });
});

test("R5 bootstrap: vibe interim direct entry migrates in one transaction", async () => {
  const { installBridgeEntry, uninstallBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "config.toml");
    const lock = join(dir, "config.toml.h2a-lock.json");
    writeFileSync(config, VIBE_DIRECT_CONFIG);
    const preview = installBridgeEntry({ host: "vibe", configPath: config, profile: "default", lockPath: lock, dryRun: true });
    assert.equal(preview.action, "migrate-direct");
    const result = installBridgeEntry({ host: "vibe", configPath: config, profile: "default", lockPath: lock });
    assert.equal(result.action, "migrate-direct");
    const after = readFileSync(config, "utf8");
    assert.ok(after.includes('[general]\nname = "owner"'));
    assert.ok(after.includes('name = "other"'));
    assert.equal((after.match(/\[\[mcp_servers\]\]/g) ?? []).length, 2);
    assert.ok(after.includes("registry-bridge"));
    assert.ok(!after.includes("mcp-serve"));
    assert.equal((after.match(/name = "h2a"/g) ?? []).length, 1);
    const removed = uninstallBridgeEntry({ host: "vibe", configPath: config });
    assert.equal(removed.action, "uninstalled");
    const afterUninstall = readFileSync(config, "utf8");
    assert.ok(!afterUninstall.includes('name = "h2a"'));
    assert.ok(afterUninstall.includes('name = "other"'));
  });
});

test("R5 bootstrap: uninstall refuses a conflicting user-owned h2a entry", async () => {
  const { uninstallBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { h2a: { command: "custom-h2a-fork", args: ["serve"] } } }));
    assert.throws(() => uninstallBridgeEntry({ host: "claude", configPath: config }), /conflict/);
    assert.ok(readFileSync(config, "utf8").includes("custom-h2a-fork"));
  });
});

test("R5 bootstrap: failed migration restores the original bytes", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    assert.throws(
      () => installBridgeEntry({ host: "nope", configPath: config, profile: "default" }),
      /unsupported_host|unknown host/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
  });
});

// ---- LOT-4 (F-04/F-05/F-06/F-10) ----

test("R5 LOT-4 F-05: install without a caller-resolved lock refuses missing_lock", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    assert.throws(
      () => installBridgeEntry({ host: "claude", configPath: config, profile: "default" }),
      /missing_lock/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
  });
});

test("R5 LOT-4 F-05: installed bridge command carries the resolved --lock", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const lock = join(dir, "custom.h2a-lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: lock });
    const installed = JSON.parse(readFileSync(config, "utf8"));
    const args = installed.mcpServers.h2a.args;
    const flag = args.indexOf("--lock");
    assert.notEqual(flag, -1);
    assert.equal(args[flag + 1], lock);
  });
});

test("R5 LOT-4 F-04a: receipt failure after rename restores the original bytes", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    mkdirSync(join(dir, "mcp.json.h2a-registry.json")); // receipt path unwritable: EISDIR on receipt write
    assert.throws(
      () => installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }),
      /EISDIR/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
  });
});

test("R5 LOT-4 F-06: preview refuses an unknown host with unsupported_host", async () => {
  const { previewInstall } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    assert.throws(() => previewInstall({ host: "nope", configPath: config }), /unsupported_host/);
  });
});

test("R5 LOT-4 F-06: install refuses an unknown host with unsupported_host, config untouched", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    assert.throws(
      () => installBridgeEntry({ host: "nope", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }),
      /unsupported_host/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
  });
});

test("R5 LOT-4 F-10: provisioned lock lands next to the host config", async () => {
  const bridgeLock = await import("../dist/registry/bridge-lock.js");
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const configDir = join(dir, "config");
    const decoyDir = join(dir, "profiles");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(decoyDir, { recursive: true });
    const config = join(configDir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    writeFileSync(join(decoyDir, "default.toml"), "# decoy profile template living elsewhere\n");
    const lock = bridgeLock.defaultBridgeLockPath(config);
    assert.equal(lock, join(configDir, "mcp.json.h2a-lock.json"));
    installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: lock });
    const provisioned = bridgeLock.provisionBridgeLock({
      lockPath: lock,
      host: "claude",
      profile: "default",
      bridge: { command: "h2a", args: ["registry-bridge", "serve", "--host", "claude", "--profile", "default", "--lock", lock] },
      h2aEntry: structuredClone(H2A_ENTRY),
      trackEntry: structuredClone(TRACK_ENTRY)
    });
    assert.equal(provisioned.action, "provisioned");
    assert.equal(provisioned.lockPath, lock);
    const lockDoc = JSON.parse(readFileSync(lock, "utf8"));
    assert.equal(lockDoc.host, "claude");
    assert.deepEqual(readdirSync(decoyDir), ["default.toml"]);
  });
});
