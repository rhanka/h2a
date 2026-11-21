// LH-03 skill and the three MCP tools. Temporary store root from TMPDIR;
// no live state and no network.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  H2A_CLI_MCP_TOOL_NAMES,
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  createMcpServer,
  createLocalStore
} from "../dist/index.js";

function makeRoot() {
  const base = mkdtempSync(join(process.env.TMPDIR, "lh03-"));
  const root = join(base, "store");
  mkdirSync(root, { recursive: true });
  return { base, root };
}

function cleanup(dirs) {
  rmSync(dirs.base, { recursive: true, force: true });
}

function readSkill() {
  return readFileSync(new URL("../skills/remote/SKILL.md", import.meta.url), "utf8");
}

const NEW_TOOLS = ["h2a_remote_status", "h2a_remote_off", "h2a_remote_kill"];
const GATED_TOOLS = ["h2a_remote_enrol", "h2a_remote_up", "h2a_remote_on"];

test("the plugin file listing contains the new skill and both manifests still validate", () => {
  const skillUrl = new URL("../skills/remote/SKILL.md", import.meta.url);
  assert.equal(existsSync(skillUrl), true, "remote skill document is missing");
  for (const rel of ["../.claude-plugin/plugin.json", "../.codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
    assert.equal(manifest.name, "h2a");
    assert.equal(typeof manifest.version, "string");
  }
  const text = readSkill();
  assert.match(text, /^---\n/, "skill must carry frontmatter");
  assert.match(text, /^name:\s*remote\b/m, "skill must be named remote");
});

test("the MCP tool list contains exactly the three new names beside the existing set", () => {
  const names = [...H2A_CLI_MCP_TOOL_NAMES];
  for (const tool of NEW_TOOLS) {
    assert.equal(names.filter((n) => n === tool).length, 1, `expected exactly one ${tool}`);
  }
  // the existing set is untouched: still starts and ends as before
  assert.equal(names[0], "h2a_register_instance");
  assert.equal(names[names.length - 1], "track_workspace_activity");
  // every tool has a descriptor
  const descriptors = new Set(H2A_CLI_MCP_TOOL_DESCRIPTORS.map((d) => d.name));
  for (const tool of NEW_TOOLS) {
    assert.equal(descriptors.has(tool), true, `missing descriptor for ${tool}`);
  }
});

test("the gated tools do not exist by construction", () => {
  const names = new Set(H2A_CLI_MCP_TOOL_NAMES);
  for (const tool of GATED_TOOLS) {
    assert.equal(names.has(tool), false, `gated tool ${tool} must not exist`);
  }
  const descriptors = new Set(H2A_CLI_MCP_TOOL_DESCRIPTORS.map((d) => d.name));
  for (const tool of GATED_TOOLS) {
    assert.equal(descriptors.has(tool), false, `gated descriptor ${tool} must not exist`);
  }
});

test("each handler calls the same service as the matching CLI verb", () => {
  const dirs = makeRoot();
  const prev = process.env.H2A_REMOTE_CONTROL;
  process.env.H2A_REMOTE_CONTROL = "1";
  try {
    const store = createLocalStore({ root: dirs.root });
    const server = createMcpServer({ root: dirs.root, store });
    const status = server.callTool("h2a_remote_status", {});
    assert.equal(status.error, undefined);
    assert.equal(status.ok, true);
    assert.equal(status.verb, "status");
    const off = server.callTool("h2a_remote_off", { session: "sess-1" });
    assert.equal(off.ok, true);
    assert.equal(off.verb, "off");
    const kill = server.callTool("h2a_remote_kill", {});
    assert.equal(kill.ok, true);
    assert.equal(kill.verb, "kill");
    // same service: status after kill reports the local flag
    const after = server.callTool("h2a_remote_status", {});
    assert.equal(after.kill, true);
  } finally {
    if (prev !== undefined) process.env.H2A_REMOTE_CONTROL = prev;
    else delete process.env.H2A_REMOTE_CONTROL;
    cleanup(dirs);
  }
});

test("a handler call for the gated verbs is refused as unknown by construction", () => {
  const dirs = makeRoot();
  try {
    const server = createMcpServer({ root: dirs.root });
    for (const tool of GATED_TOOLS) {
      const result = server.callTool(tool, {});
      assert.equal(result.error, `unknown tool: ${tool}`);
    }
  } finally {
    cleanup(dirs);
  }
});

test("the skill prints the terminal commands for the gated verbs instead of running them", () => {
  const text = readSkill();
  for (const verb of ["enrol", "up", "on", "revoke"]) {
    assert.match(text, new RegExp(`h2a remote ${verb}`), `skill must print the terminal command for ${verb}`);
  }
  for (const verb of ["enrol", "up", "on"]) {
    assert.match(text, new RegExp(`--confirm ${verb}`), `skill must name the typed confirmation for ${verb}`);
  }
  assert.match(text, /[Ss]ite-side approval/, "skill must name the site-side approval as the human boundary");
  // the skill never offers the gated verbs as agent actions
  for (const tool of GATED_TOOLS) {
    assert.equal(text.includes(tool), false, `skill must not offer ${tool} as an action`);
  }
});

test("the skill text and tool descriptions never offer the gated verbs as actions", () => {
  const text = readSkill();
  assert.equal(/h2a_remote_(enrol|up|on)\b/.test(text), false, "skill must not name gated MCP tools");
  for (const descriptor of H2A_CLI_MCP_TOOL_DESCRIPTORS) {
    if (!NEW_TOOLS.includes(descriptor.name)) continue;
    assert.equal(/h2a_remote_(enrol|up|on)\b/.test(descriptor.description), false, `${descriptor.name} must not offer a gated verb`);
    assert.match(descriptor.description, /h2a remote/, `${descriptor.name} must point at the CLI`);
  }
});
