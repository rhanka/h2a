/**
 * EVO-12 hosted MCP server — wraps the EXISTING in-process h2a tool dispatch
 * (`McpServer.callTool`) behind an SDK `Server`, exposing ONLY the read-only
 * allowlist. `dispatchHostedTool` refuses any non-allowlisted tool name
 * (defense-in-depth: a signing/private-key tool is never reachable here, even
 * if the wire asked for it).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { currentCliVersion } from "../upgrade/index.js";
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from "../mcp/tools.js";
import type { McpServer } from "../mcp/server.js";
import { hostedReadOnlyDescriptors, isHostedReadOnlyTool } from "./readonly-allowlist.js";

export function dispatchHostedTool(
  h2a: McpServer,
  name: string,
  args: Record<string, unknown> | undefined
): CallToolResult {
  if (!isHostedReadOnlyTool(name)) {
    return {
      content: [{ type: "text", text: `tool '${name}' is not exposed on the hosted read-only surface` }],
      isError: true
    };
  }
  const result = h2a.callTool(name, args);
  if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
    return { content: [{ type: "text", text: result.error }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

/** SDK Server exposing only the read-only allowlist, dispatching to the h2a callTool. */
export function buildHostedMcpServer(h2a: McpServer): Server {
  const server = new Server(
    { name: "h2a", version: currentCliVersion() },
    { capabilities: { tools: { listChanged: true } } }
  );

  const announced = hostedReadOnlyDescriptors(H2A_CLI_MCP_TOOL_DESCRIPTORS).map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema as Record<string, unknown>
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: announced }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (req): Promise<CallToolResult> =>
      dispatchHostedTool(h2a, req.params.name, req.params.arguments ?? {})
  );

  return server;
}
