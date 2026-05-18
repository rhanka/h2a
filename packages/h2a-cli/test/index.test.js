import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_CLI_ADAPTER,
  H2A_CLI_HOSTS,
  H2A_CLI_MCP_TOOL_NAMES
} from "../dist/index.js";

test("h2a-cli aggregates the supported hosts", () => {
  assert.deepEqual(
    H2A_CLI_HOSTS.map((host) => host.host),
    ["codex", "claude", "gemini"]
  );
  assert.equal(H2A_CLI_ADAPTER.packageName, "@sentropic/h2a-cli");
});

test("h2a-cli exposes the canonical MCP tool names", () => {
  assert.equal(H2A_CLI_MCP_TOOL_NAMES[0], "h2a_register_instance");
  assert.equal(H2A_CLI_MCP_TOOL_NAMES.at(-1), "h2a_escalate");
});
