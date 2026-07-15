import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function json(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

test("the published h2a package carries a Codex plugin with canonical h2a + track MCPs", () => {
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
      "local-tmux",
      "--auto-open"
    ]
  });
  assert.equal(
    mcp.mcpServers.h2a.args.includes("--auto-upgrade"),
    false,
    "Codex rmcp stdio must not execve an in-process auto-upgrade"
  );
  assert.deepEqual(mcp.mcpServers.track, {
    command: "h2a",
    args: ["track-mcp"]
  });

  for (const entry of [".claude-plugin", ".codex-plugin", ".mcp.json"]) {
    assert.ok(pkg.files.includes(entry), `${entry} must ship in npm package`);
  }
});
