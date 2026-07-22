import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_CLI_ADAPTER,
  H2A_CLI_HOSTS,
  H2A_CLI_MCP_TOOL_NAMES,
  renderCliHelp,
  runCli
} from "../dist/index.js";

test("h2a-cli aggregates the supported hosts", () => {
  assert.deepEqual(
    H2A_CLI_HOSTS.map((host) => host.host),
    ["codex", "claude", "gemini", "agy", "hermes", "opencode"]
  );
  assert.equal(H2A_CLI_ADAPTER.packageName, "@sentropic/h2a");
});

test("h2a-cli exposes the canonical MCP tool names", () => {
  assert.equal(H2A_CLI_MCP_TOOL_NAMES[0], "h2a_register_instance");
  // Track's read-only surface is composed into the selected h2a endpoint.
  assert.equal(H2A_CLI_MCP_TOOL_NAMES.at(-1), "track_workspace_activity");
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_loop_list"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_loop_status"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_conductor_launch"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_conductor_launch_check"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_conductor"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_conductor_claim"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_conductor_release"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_nhi_offboard"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_nhi_export"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_blockage_raise"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_session_open"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("h2a_discover_sessions"));
  assert.ok(H2A_CLI_MCP_TOOL_NAMES.includes("track_validate"));
});

test("h2a-cli renders help and command output", () => {
  assert.match(renderCliHelp(), /Human-to-agent coordination CLI/);
  assert.match(renderCliHelp(), /codex, claude, gemini/);

  let stdout = "";
  let stderr = "";
  const streams = {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) }
  };

  assert.equal(runCli(["hosts"], streams), 0);
  assert.match(stdout, /"host": "codex"/);
  assert.equal(stderr, "");

  stdout = "";
  stderr = "";
  assert.equal(runCli(["unknown"], streams), 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown command: unknown/);
});
