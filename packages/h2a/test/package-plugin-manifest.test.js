import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { memorySkillConsumer } from './helpers/memory-skill-consumer.mjs';

test('memory skill is resolved at install time without being vendored into the plugin', t => {
  assert.equal(existsSync(new URL('../skills/engram-memory/SKILL.md', import.meta.url)), false);
  const fixture = memorySkillConsumer(t);
  const result = fixture.cli(['install-skills', '--host', 'claude', '--scope', 'project']);
  assert.equal(result.status, 0, result.stderr);
  const source = result.json().sources.find(s => s.source === 'engram');
  assert.equal(source?.dir, `${fixture.producer}/skills`);
  assert.equal(source?.count, 1);
  assert.equal(existsSync(`${fixture.lane}/.claude/skills/engram/SKILL.md`), false);
});

function json(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

test("default packaged hooks omit the workspace scope guard and retain the manual CLI hook", () => {
  const { hooks } = json("../hooks/hooks.json");
  assert.doesNotMatch(JSON.stringify(hooks), /workspace-scope-guard/);
  assert.deepEqual(hooks.PreToolUse, [{
    matcher: "Bash",
    hooks: [{
      type: "command",
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/deny-manual-h2a-cli.mjs"',
      timeout: 5
    }]
  }]);
});

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
