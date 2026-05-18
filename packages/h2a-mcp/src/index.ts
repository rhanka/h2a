export const H2A_MCP_TOOL_NAMES = [
  "h2a_register_instance",
  "h2a_discover_instances",
  "h2a_open_negotiation",
  "h2a_offer",
  "h2a_counteroffer",
  "h2a_sign",
  "h2a_stabilize",
  "h2a_inbox",
  "h2a_append_journal",
  "h2a_escalate"
] as const;

export const H2A_MCP_ADAPTER = {
  packageName: "@sentropic/h2a-mcp",
  corePackageName: "@sentropic/h2a",
  protocol: "sentropic.h2a",
  toolNames: H2A_MCP_TOOL_NAMES
} as const;
