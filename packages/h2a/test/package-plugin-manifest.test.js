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

test("the published h2a package carries a singleton h2a MCP endpoint", () => {
  const pkg = json("../package.json");
  const claudeManifest = json("../.claude-plugin/plugin.json");
  const manifest = json("../.codex-plugin/plugin.json");
  const mcp = json("../.mcp.json");

  assert.equal(manifest.name, "h2a");
  assert.equal(manifest.version, pkg.version);
  assert.equal(claudeManifest.version, pkg.version);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.ok(existsSync(new URL("../skills/h2a/SKILL.md", import.meta.url)));
  assert.ok(existsSync(new URL("../skills/harness/SKILL.md", import.meta.url)));

  assert.deepEqual(mcp.mcpServers.h2a, {
    command: "h2a",
    args: [
      "mcp-serve",
      "--host",
      "codex",
      "--wake",
      "auto",
      "--auto-open"
    ]
  });
  assert.equal(
    mcp.mcpServers.h2a.args.includes("--auto-upgrade"),
    false,
    "Codex rmcp stdio must not execve an in-process auto-upgrade"
  );
  assert.deepEqual(Object.keys(mcp.mcpServers), ["h2a"]);
  assert.equal(mcp.mcpServers.track, undefined);
  assert.deepEqual(Object.keys(claudeManifest.mcpServers), ["h2a"]);
  assert.equal(claudeManifest.mcpServers.track, undefined);
  assert.doesNotMatch(claudeManifest.description, /track-mcp|track MCP/i);
  assert.doesNotMatch(manifest.interface.longDescription, /track MCP/i);

  for (const entry of [".claude-plugin", ".codex-plugin", ".mcp.json"]) {
    assert.ok(pkg.files.includes(entry), `${entry} must ship in npm package`);
  }
});
