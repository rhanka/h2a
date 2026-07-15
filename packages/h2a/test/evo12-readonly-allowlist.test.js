import assert from "node:assert/strict";
import test from "node:test";

import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from "../dist/runtime/mcp/tools.js";
import {
  H2A_HOSTED_READONLY_TOOLS,
  hostedReadOnlyDescriptors,
  isHostedReadOnlyTool,
  toolTakesPrivateKey
} from "../dist/runtime/mcp-http/readonly-allowlist.js";

test("allowlist EXCLUDES every signing / private-key / mutating tool", () => {
  for (const forbidden of [
    "h2a_sign",
    "h2a_attest_comprehension",
    "h2a_offer",
    "h2a_counteroffer",
    "h2a_register_instance",
    "h2a_stabilize",
    "h2a_open_negotiation",
    "h2a_session_open",
    "h2a_nhi_offboard",
    "h2a_inbox",
    "h2a_run"
  ]) {
    assert.equal(isHostedReadOnlyTool(forbidden), false, `${forbidden} must NOT be hosted`);
  }
});

test("allowlist INCLUDES the read-only info tools (claude.ai 'has the info')", () => {
  for (const ro of [
    "h2a_discover_instances",
    "h2a_discover_sessions",
    "h2a_nhi_inventory",
    "h2a_nhi_report",
    "h2a_conflict_posture",
    "h2a_blockage_list"
  ]) {
    assert.equal(isHostedReadOnlyTool(ro), true, `${ro} should be hosted read-only`);
  }
});

test("the structural invariant: NO hosted tool takes a private key (schema scan)", () => {
  const exposed = hostedReadOnlyDescriptors(H2A_CLI_MCP_TOOL_DESCRIPTORS);
  // every allowlisted name resolved to a real descriptor
  assert.equal(exposed.length, H2A_HOSTED_READONLY_TOOLS.length);
  for (const d of exposed) {
    assert.equal(toolTakesPrivateKey(d), false, `${d.name} leaks a private key on the hosted surface`);
  }
});

test("toolTakesPrivateKey is true for a real signing tool (sanity)", () => {
  const sign = H2A_CLI_MCP_TOOL_DESCRIPTORS.find((d) => d.name === "h2a_sign");
  assert.ok(sign, "h2a_sign descriptor exists");
  assert.equal(toolTakesPrivateKey(sign), true);
});

test("hostedReadOnlyDescriptors THROWS if the allowlist were to include a private-key tool", () => {
  // simulate a mis-edit: a fake descriptor named like a read tool but with a private key
  const poisoned = [
    ...H2A_CLI_MCP_TOOL_DESCRIPTORS,
    {
      name: "h2a_discover_instances",
      description: "poisoned dup",
      inputSchema: { type: "object", properties: { privateKeyPem: { type: "string" } } }
    }
  ];
  assert.throws(() => hostedReadOnlyDescriptors(poisoned), /must not include private-key tools/);
});
