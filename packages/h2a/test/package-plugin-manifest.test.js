import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function json(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const CLAUDE_ARGS = [
  "registry-bridge",
  "serve",
  "--host",
  "claude",
  "--profile",
  "default",
  "--wake",
  "auto",
  "--auto-open",
  "--auto-upgrade"
];

const CODEX_ARGS = [
  "registry-bridge",
  "serve",
  "--host",
  "codex",
  "--profile",
  "default",
  "--wake",
  "auto",
  "--auto-open"
];

test("the published h2a package declares the registry bridge in its shipped plugins", () => {
  const pkg = json("../package.json");
  const claudeManifest = json("../.claude-plugin/plugin.json");
  const manifest = json("../.codex-plugin/plugin.json");
  const claudeAsset = json("../.claude-plugin/registry.mcp.json");
  const codexAsset = json("../.codex-plugin/registry.mcp.json");

  assert.equal(manifest.name, "h2a");
  assert.equal(claudeManifest.name, "h2a");
  assert.equal(manifest.version, pkg.version);
  assert.equal(claudeManifest.version, pkg.version);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.codex-plugin/registry.mcp.json");
  assert.equal(claudeManifest.mcpServers, "./.claude-plugin/registry.mcp.json");

  assert.deepEqual(claudeAsset.mcpServers.h2a, { command: "h2a", args: CLAUDE_ARGS });
  assert.deepEqual(Object.keys(claudeAsset.mcpServers), ["h2a"]);
  assert.deepEqual(codexAsset.mcpServers.h2a, { command: "h2a", args: CODEX_ARGS });
  assert.deepEqual(Object.keys(codexAsset.mcpServers), ["h2a"]);
  assert.equal(
    codexAsset.mcpServers.h2a.args.includes("--auto-upgrade"),
    false,
    "Codex rmcp stdio must not execve an in-process auto-upgrade"
  );

  for (const doc of [claudeManifest, manifest, claudeAsset, codexAsset]) {
    assert.ok(!JSON.stringify(doc).includes("mcp-serve"), "no shipped plugin declaration launches mcp-serve");
  }

  assert.equal(existsSync(new URL("../.mcp.json", import.meta.url)), false);
  assert.ok(!pkg.files.includes(".mcp.json"));
  assert.ok(pkg.files.includes(".claude-plugin"));
  assert.ok(pkg.files.includes(".codex-plugin"));
  for (const doc of [claudeManifest, manifest]) {
    assert.ok(!JSON.stringify(doc).includes('"./.mcp.json"'), "no manifest references the removed root .mcp.json");
  }

  assert.ok(existsSync(new URL("../skills/h2a/SKILL.md", import.meta.url)));
  assert.ok(existsSync(new URL("../skills/harness/SKILL.md", import.meta.url)));
  assert.equal(claudeAsset.mcpServers.track, undefined);
  assert.equal(codexAsset.mcpServers.track, undefined);
  assert.doesNotMatch(claudeManifest.description, /track-mcp|track MCP/i);
  assert.doesNotMatch(manifest.interface.longDescription, /track MCP/i);
});
