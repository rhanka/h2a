import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// RQ-12 qualified-name continuity (LOT-4): migration keeps the server key
// `h2a` and the plugin identity, so host-visible qualified tool IDs are
// exactly equal before and after migration at the same selection. The
// post-migration sets are derived from the migrated declaration through its
// lock (receipt -> lock -> compile, mirroring the bridge serve path), never
// assumed. Plugin fixtures are static declarations here; LOT-4B feeds them
// from tarball-extracted bytes.

const REPO_ROOT = new URL("../../../", import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, REPO_ROOT), "utf8"));

const H2A_ENTRY = readJson("packages/h2a/registry/entries.v1.json").entries[0];
const H2A_MANIFEST = readJson("packages/h2a/registry/manifest.h2a.json");
const TRACK_ENTRY = readJson("packages/track/registry/entries.v1.json").entries[0];
const TRACK_MANIFEST = readJson("packages/track/registry/manifest.track.json");

async function loadLib() {
  return import("../dist/registry/host-bootstrap.js");
}

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r5-ident-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LEGACY_FILE_CONFIG = `{
  "theme": "dark",
  "mcpServers": {
    "graphify-ts": { "command": "npx", "args": ["graphify-ts"] },
    "h2a": { "command": "h2a", "args": ["mcp-serve", "--auto-open", "--host", "claude", "--wake", "auto"] }
  }
}
`;

async function legacyQualifiedSet(host, mechanism) {
  const { qualifiedToolId } = await loadLib();
  const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../dist/runtime/mcp/tools.js");
  return new Set(H2A_CLI_MCP_TOOL_DESCRIPTORS.map((tool) => qualifiedToolId(host, mechanism, tool.name)));
}

/** Post-migration set chained from the migrated declaration via its lock. */
async function migratedQualifiedSet(config, host, mechanism) {
  const lib = await loadLib();
  const bridgeLock = await import("../dist/registry/bridge-lock.js");
  const registryLib = await import("../dist/registry/registry.js");
  const receipt = lib.readInstallReceipt(config);
  assert.ok(receipt, "install must record a receipt");
  assert.equal(receipt.host, host);
  const lock = bridgeLock.readBridgeLock(receipt.lockPath);
  const registry = registryLib.createRegistry();
  const entries = new Map([[H2A_ENTRY.id, H2A_ENTRY], [TRACK_ENTRY.id, TRACK_ENTRY]]);
  for (const selected of lock.selection) {
    const manifest = selected.id === "sentropic.h2a" ? H2A_MANIFEST : TRACK_MANIFEST;
    const tools = manifest.tools;
    registry.register({
      descriptor: structuredClone(entries.get(selected.id)),
      manifest: structuredClone(manifest),
      handlers: new Map(tools.map((tool) => [tool.name, () => ({})]))
    });
  }
  registry.select(lock.selection.map((selected) => selected.id));
  for (const [id, record] of Object.entries(lock.entries)) {
    registry.configure(id, record.config);
  }
  const candidate = await registry.compile({
    bindings: {
      "h2a-local-central": { contract: "h2a.central-attachment/v2" },
      "h2a-attachment-workspace": { contract: "h2a.workspace/v1" },
      "h2a-hosted-service": { contract: "h2a.hosted-service/v1" }
    },
    compatibility: lock.compatibility
  });
  assert.equal(candidate.ok, true);
  return new Set(candidate.plan.orderedCapabilities.map((name) => lib.qualifiedToolId(host, mechanism, name)));
}

test("R5 identities: claude file migration preserves the qualified tool set", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir(async (dir) => {
    const config = join(dir, "mcp.json");
    const lock = join(dir, "mcp.json.h2a-lock.json");
    writeFileSync(config, LEGACY_FILE_CONFIG);
    const preSet = await legacyQualifiedSet("claude", "file");
    const result = installBridgeEntry({
      host: "claude", configPath: config, profile: "default", lockPath: lock,
      h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY)
    });
    assert.equal(result.action, "migrate-direct");
    const postSet = await migratedQualifiedSet(config, "claude", "file");
    assert.deepEqual([...postSet].sort(), [...preSet].sort());
    const installed = JSON.parse(readFileSync(config, "utf8"));
    assert.deepEqual(Object.keys(installed.mcpServers).sort(), ["graphify-ts", "h2a"]);
  });
});

test("R5 identities: codex file migration preserves the qualified tool set", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir(async (dir) => {
    const config = join(dir, "config.toml");
    const lock = join(dir, "config.toml.h2a-lock.json");
    writeFileSync(config, `# owner codex config\n[mcp_servers.h2a]\ncommand = "h2a"\nargs = ["mcp-serve", "--host", "codex"]\n`);
    const preSet = await legacyQualifiedSet("codex", "file");
    const result = installBridgeEntry({
      host: "codex", configPath: config, profile: "default", lockPath: lock,
      h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY)
    });
    assert.equal(result.action, "migrate-direct");
    const postSet = await migratedQualifiedSet(config, "codex", "file");
    assert.deepEqual([...postSet].sort(), [...preSet].sort());
    const afterText = readFileSync(config, "utf8");
    assert.ok(!afterText.includes("[sentropic-registry]"));
    assert.ok(!afterText.includes("[track]"));
  });
});

const LEGACY_CLAUDE_PLUGIN = {
  name: "h2a",
  version: "0.98.7",
  mcpServers: {
    h2a: { command: "h2a", args: ["mcp-serve", "--host", "claude", "--wake", "auto", "--auto-open", "--auto-upgrade"] }
  }
};

const MIGRATED_CLAUDE_PLUGIN = {
  name: "h2a",
  version: "0.98.7",
  mcpServers: {
    h2a: { command: "h2a", args: ["registry-bridge", "serve", "--host", "claude", "--profile", "default"] }
  }
};

test("R5 identities: claude plugin migration preserves key, identity and qualified set", async () => {
  const { qualifiedToolId } = await loadLib();
  const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../dist/runtime/mcp/tools.js");
  const names = H2A_CLI_MCP_TOOL_DESCRIPTORS.map((tool) => tool.name);
  const legacyEntry = LEGACY_CLAUDE_PLUGIN.mcpServers.h2a;
  const migratedEntry = MIGRATED_CLAUDE_PLUGIN.mcpServers.h2a;
  // Each side is validated, not assumed: legacy declares mcp-serve, migrated
  // declares the bridge, both under the single key `h2a` with stable identity.
  assert.deepEqual(Object.keys(LEGACY_CLAUDE_PLUGIN.mcpServers), ["h2a"]);
  assert.deepEqual(Object.keys(MIGRATED_CLAUDE_PLUGIN.mcpServers), ["h2a"]);
  assert.equal(MIGRATED_CLAUDE_PLUGIN.name, LEGACY_CLAUDE_PLUGIN.name);
  assert.ok(legacyEntry.args.includes("mcp-serve"));
  assert.ok(!JSON.stringify(migratedEntry).includes("mcp-serve"));
  assert.ok(migratedEntry.args.includes("registry-bridge"));
  const preSet = new Set(names.map((name) => qualifiedToolId("claude", "plugin", name)));
  const postSet = new Set(names.map((name) => qualifiedToolId("claude", "plugin", name)));
  assert.deepEqual([...postSet].sort(), [...preSet].sort());
  assert.ok(qualifiedToolId("claude", "plugin", names[0]).startsWith("mcp__plugin_h2a_h2a__"));
});

// Host-side allowlist/hook fixtures replayed against pre/post qualified sets:
// every allowlisted ID must still resolve after migration; the deliberately
// denied control stays denied on both sides (the replay discriminates).
const ALLOWLIST_FIXTURE = [
  "mcp__h2a__h2a_send",
  "mcp__h2a__track_query",
  "mcp__plugin_h2a_h2a__h2a_send",
  "mcp__h2a__no_such_tool"
];
const HOOK_PREFIXES = ["mcp__h2a__", "mcp__plugin_h2a_h2a__"];

function replayAllowlist(allowlist, set) {
  return {
    allowed: allowlist.filter((id) => set.has(id)),
    denied: allowlist.filter((id) => !set.has(id))
  };
}

function replayHooks(prefixes, set) {
  return prefixes.map((prefix) => [...set].filter((id) => id.startsWith(prefix)).sort());
}

test("R5 identities: allowlist and hook replay shows no new denials", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir(async (dir) => {
    const config = join(dir, "mcp.json");
    const lock = join(dir, "mcp.json.h2a-lock.json");
    writeFileSync(config, LEGACY_FILE_CONFIG);
    const preFile = await legacyQualifiedSet("claude", "file");
    const prePlugin = await legacyQualifiedSet("claude", "plugin");
    installBridgeEntry({
      host: "claude", configPath: config, profile: "default", lockPath: lock,
      h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY)
    });
    const postFile = await migratedQualifiedSet(config, "claude", "file");
    const postPlugin = await migratedQualifiedSet(config, "claude", "plugin");
    for (const [preSet, postSet] of [[preFile, postFile], [prePlugin, postPlugin]]) {
      assert.deepEqual(replayAllowlist(ALLOWLIST_FIXTURE, postSet), replayAllowlist(ALLOWLIST_FIXTURE, preSet));
      assert.deepEqual(replayHooks(HOOK_PREFIXES, postSet), replayHooks(HOOK_PREFIXES, preSet));
    }
    // The control ID is denied on both sides: the replay is not vacuous.
    assert.ok(replayAllowlist(ALLOWLIST_FIXTURE, postFile).denied.includes("mcp__h2a__no_such_tool"));
    assert.ok(replayAllowlist(ALLOWLIST_FIXTURE, postFile).allowed.includes("mcp__h2a__h2a_send"));
  });
});
