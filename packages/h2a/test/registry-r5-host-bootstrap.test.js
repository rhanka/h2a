import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

test("R5 LOT-4 F-05a: receipt path blocked refuses before publication, zero writes", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    mkdirSync(join(dir, "mcp.json.h2a-registry.json")); // receipt path pre-created as a directory
    assert.throws(
      () => installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }),
      /refusing before publication/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
    const leftovers = readdirSync(dir);
    assert.ok(!leftovers.some((name) => name.endsWith(".tmp")), `staging file created: ${leftovers}`);
    assert.ok(!leftovers.some((name) => name.includes(".backup-")), `backup file created: ${leftovers}`);
    assert.ok(!existsSync(join(dir, "x.h2a-lock.json")));
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

// ---- LOT-4 completion (F-04 hook, F-05b/c/d injection, F-06 codex TOML, RQ-08 matrix) ----

const LEGACY_CODEX_CONFIG = `# owner codex config
[general]
name = "owner"

[mcp_servers.h2a]
command = "h2a"
args = ["mcp-serve", "--host", "codex", "--wake", "auto"]

[mcp_servers.other]
command = "other"
args = ["serve"]
`;

test("R5 LOT-4 F-04: concurrent edit between read and publish refuses without overwrite", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    const concurrent = `${LEGACY_CLAUDE_CONFIG}\n// concurrent operator edit\n`;
    assert.throws(
      () => installBridgeEntry({
        host: "claude", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json"),
        interpose: { afterRead: () => writeFileSync(config, concurrent) }
      }),
      /changed while preparing the edit/
    );
    assert.equal(readFileSync(config, "utf8"), concurrent);
    const leftovers = readdirSync(dir);
    assert.ok(!leftovers.some((name) => name.endsWith(".tmp")), `staging file left: ${leftovers}`);
    assert.ok(!existsSync(join(dir, "x.h2a-lock.json")));
  });
});

test("R5 LOT-4 F-05b: post-publication receipt failure rolls back to pre-install bytes", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const receipt = `${config}.h2a-registry.json`;
    const lock = join(dir, "x.h2a-lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    assert.throws(
      () => installBridgeEntry({
        host: "claude", configPath: config, profile: "default", lockPath: lock,
        interpose: {
          afterPublish: () => {
            try { rmSync(receipt, { recursive: true, force: true }); } catch { /* absent */ }
            mkdirSync(receipt);
          }
        }
      }),
      /EISDIR/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
    const leftovers = readdirSync(dir);
    assert.ok(!leftovers.some((name) => name.endsWith(".tmp")), `staging file left: ${leftovers}`);
    assert.ok(!existsSync(receipt), "transaction receipt must be gone");
    assert.ok(!existsSync(lock), "lock must never have been provisioned");
  });
});

test("R5 LOT-4 F-05b: pre-existing receipt and lock are restored to prior bytes", async () => {
  const bridgeLock = await import("../dist/registry/bridge-lock.js");
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const receipt = `${config}.h2a-registry.json`;
    const lock = join(dir, "x.h2a-lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    const priorReceipt = JSON.stringify({ format: "h2a.registry-install/v1", action: "installed", marker: "prior" });
    writeFileSync(receipt, priorReceipt);
    bridgeLock.provisionBridgeLock({
      lockPath: lock, host: "claude", profile: "default",
      bridge: { command: "h2a", args: ["registry-bridge", "serve"] },
      h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY)
    });
    const priorLock = readFileSync(lock, "utf8");
    assert.throws(
      () => installBridgeEntry({
        host: "claude", configPath: config, profile: "default", lockPath: lock,
        h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY),
        interpose: {
          afterPublish: () => {
            rmSync(receipt, { recursive: true, force: true });
            mkdirSync(receipt);
          }
        }
      }),
      /EISDIR/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
    assert.equal(readFileSync(receipt, "utf8"), priorReceipt);
    assert.equal(readFileSync(lock, "utf8"), priorLock);
  });
});

test("R5 LOT-4 F-05c: post-receipt lock failure removes the just-written receipt", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const receipt = `${config}.h2a-registry.json`;
    const lock = join(dir, "nest", "lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    assert.throws(
      () => installBridgeEntry({
        host: "claude", configPath: config, profile: "default", lockPath: lock,
        h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY),
        interpose: { afterReceipt: () => writeFileSync(join(dir, "nest"), "blocker") }
      }),
      /ENOTDIR|EEXIST/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
    assert.ok(!existsSync(receipt), "just-written receipt must be removed");
    assert.ok(!existsSync(lock), "failed lock must be absent");
  });
});

test("R5 LOT-4 F-05c: pre-existing receipt is restored when lock provisioning fails", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const receipt = `${config}.h2a-registry.json`;
    const lock = join(dir, "nest", "lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    const priorReceipt = JSON.stringify({ format: "h2a.registry-install/v1", action: "installed", marker: "prior" });
    writeFileSync(receipt, priorReceipt);
    assert.throws(
      () => installBridgeEntry({
        host: "claude", configPath: config, profile: "default", lockPath: lock,
        h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY),
        interpose: { afterReceipt: () => writeFileSync(join(dir, "nest"), "blocker") }
      }),
      /ENOTDIR|EEXIST/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
    assert.equal(readFileSync(receipt, "utf8"), priorReceipt);
    assert.ok(!existsSync(lock));
  });
});

test("R5 LOT-4 F-05d: concurrent edit after publication is preserved with named state", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const receipt = `${config}.h2a-registry.json`;
    const canary = join(dir, "canary.txt");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    writeFileSync(canary, "untouched");
    let concurrent = "";
    assert.throws(
      () => installBridgeEntry({
        host: "claude", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json"),
        interpose: {
          afterPublish: () => {
            concurrent = `${readFileSync(config, "utf8")}\n// concurrent operator edit\n`;
            writeFileSync(config, concurrent);
            mkdirSync(receipt);
          }
        }
      }),
      /published_then_edited/
    );
    assert.equal(readFileSync(config, "utf8"), concurrent);
    assert.ok(concurrent.includes("registry-bridge"), "published bytes must be preserved, not reverted");
    assert.ok(concurrent.includes("concurrent operator edit"));
    const backups = readdirSync(dir).filter((name) => name.includes(".backup-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(dir, backups[0]), "utf8"), LEGACY_CLAUDE_CONFIG);
    assert.ok(!existsSync(receipt), "no receipt file may linger");
    assert.equal(readFileSync(canary, "utf8"), "untouched");
    assert.ok(!existsSync(join(dir, "x.h2a-lock.json")));
  });
});

test("R5 LOT-4 F-06: codex installs as TOML preserving unrelated tables", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "config.toml");
    const lock = join(dir, "config.toml.h2a-lock.json");
    writeFileSync(config, LEGACY_CODEX_CONFIG);
    const result = installBridgeEntry({ host: "codex", configPath: config, profile: "default", lockPath: lock });
    assert.equal(result.action, "migrate-direct");
    const after = readFileSync(config, "utf8");
    assert.ok(after.includes("# owner codex config"));
    assert.ok(after.includes('[general]\nname = "owner"'));
    assert.ok(after.includes('[mcp_servers.other]'));
    assert.ok(after.includes("[mcp_servers.h2a]"));
    assert.ok(after.includes("registry-bridge"));
    assert.ok(!after.includes("mcp-serve"));
    assert.ok(!after.includes("{"));
    assert.equal((after.match(/\[mcp_servers\.h2a\]/g) ?? []).length, 1);
    const second = installBridgeEntry({ host: "codex", configPath: config, profile: "default", lockPath: lock });
    assert.equal(second.action, "reinstall-identical");
    assert.equal(readFileSync(config, "utf8"), after);
  });
});

test("R5 LOT-4 F-06: absent codex config creates TOML, never JSON", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "config.toml");
    const lock = join(dir, "config.toml.h2a-lock.json");
    const result = installBridgeEntry({ host: "codex", configPath: config, profile: "default", lockPath: lock });
    assert.equal(result.action, "installed");
    const after = readFileSync(config, "utf8");
    assert.ok(after.includes("[mcp_servers.h2a]"));
    assert.ok(!after.trimStart().startsWith("{"));
  });
});

test("R5 LOT-4 F-06: JSON-shaped config.toml is refused without writes", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "config.toml");
    const payload = JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["x"] } } });
    writeFileSync(config, payload);
    assert.throws(
      () => installBridgeEntry({ host: "codex", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }),
      /invalid_entry/
    );
    assert.equal(readFileSync(config, "utf8"), payload);
    assert.ok(!existsSync(`${config}.h2a-registry.json`));
  });
});

test("R5 LOT-4 F-06: codex uninstall removes only the installer-owned entry", async () => {
  const { installBridgeEntry, uninstallBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "config.toml");
    const lock = join(dir, "config.toml.h2a-lock.json");
    writeFileSync(config, LEGACY_CODEX_CONFIG);
    installBridgeEntry({ host: "codex", configPath: config, profile: "default", lockPath: lock });
    const removed = uninstallBridgeEntry({ host: "codex", configPath: config });
    assert.equal(removed.action, "uninstalled");
    const after = readFileSync(config, "utf8");
    assert.ok(!after.includes("[mcp_servers.h2a]"));
    assert.ok(after.includes("[mcp_servers.other]"));
    assert.ok(after.includes('[general]\nname = "owner"'));
  });
});

test("R5 LOT-4 RQ-08: agy installs one JSON entry keyed h2a", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp_config.json");
    const lock = join(dir, "mcp_config.json.h2a-lock.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { other: { command: "other", args: ["serve"] } } }));
    const result = installBridgeEntry({ host: "agy", configPath: config, profile: "default", lockPath: lock });
    assert.equal(result.action, "installed");
    const installed = JSON.parse(readFileSync(config, "utf8"));
    assert.deepEqual(Object.keys(installed.mcpServers).sort(), ["h2a", "other"]);
    assert.ok(installed.mcpServers.h2a.args.includes("--host"));
    assert.ok(installed.mcpServers.h2a.args.includes("agy"));
  });
});

test("R5 LOT-4 RQ-08: muse file install stays blocked with zero writes", async () => {
  const { installBridgeEntry, previewInstall, uninstallBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "settings.json");
    writeFileSync(config, JSON.stringify({ mcpServers: {} }));
    assert.throws(
      () => installBridgeEntry({ host: "muse", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }),
      /unsupported_host/
    );
    assert.throws(() => previewInstall({ host: "muse", configPath: config }), /unsupported_host/);
    assert.throws(() => uninstallBridgeEntry({ host: "muse", configPath: config }), /unsupported_host/);
    assert.equal(readFileSync(config, "utf8"), JSON.stringify({ mcpServers: {} }));
    assert.ok(!existsSync(`${config}.h2a-registry.json`));
    assert.ok(!existsSync(join(dir, "x.h2a-lock.json")));
  });
});

test("R5 LOT-4 RQ-08: file install with a plugin receipt recorded refuses as duplicate mechanism", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    writeFileSync(`${config}.h2a-registry.json`, JSON.stringify({
      format: "h2a.registry-install/v1", host: "claude", profile: "default",
      mechanism: "plugin", action: "installed"
    }));
    assert.throws(
      () => installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: join(dir, "x.h2a-lock.json") }),
      /mechanism/
    );
    assert.equal(readFileSync(config, "utf8"), LEGACY_CLAUDE_CONFIG);
    assert.ok(!existsSync(join(dir, "x.h2a-lock.json")));
  });
});

test("R5 LOT-4 RQ-08: uninstall refuses after a user edit of the installer-owned entry", async () => {
  const { installBridgeEntry, uninstallBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const lock = join(dir, "mcp.json.h2a-lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    installBridgeEntry({ host: "claude", configPath: config, profile: "default", lockPath: lock });
    const edited = JSON.parse(readFileSync(config, "utf8"));
    edited.mcpServers.h2a.args.push("--user-flag");
    writeFileSync(config, JSON.stringify(edited));
    const editedBytes = readFileSync(config, "utf8");
    assert.throws(() => uninstallBridgeEntry({ host: "claude", configPath: config }), /conflict/);
    assert.equal(readFileSync(config, "utf8"), editedBytes);
  });
});

test("R5 LOT-4 RQ-08: second identical install keeps the same lock revision", async () => {
  const { installBridgeEntry } = await loadLib();
  await withTempDir((dir) => {
    const config = join(dir, "mcp.json");
    const lock = join(dir, "mcp.json.h2a-lock.json");
    writeFileSync(config, LEGACY_CLAUDE_CONFIG);
    const options = () => ({
      host: "claude", configPath: config, profile: "default", lockPath: lock,
      h2aEntry: structuredClone(H2A_ENTRY), trackEntry: structuredClone(TRACK_ENTRY)
    });
    const first = installBridgeEntry(options());
    assert.equal(first.lockAction, "provisioned");
    const firstLock = readFileSync(lock, "utf8");
    assert.equal(JSON.parse(firstLock).lockVersion, 1);
    const firstConfig = readFileSync(config, "utf8");
    const again = installBridgeEntry(options());
    assert.equal(again.action, "reinstall-identical");
    assert.equal(again.lockAction, "already-present");
    assert.equal(readFileSync(config, "utf8"), firstConfig);
    assert.equal(readFileSync(lock, "utf8"), firstLock);
  });
});
