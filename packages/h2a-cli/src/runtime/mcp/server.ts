import { createLocalStore, type LocalStore } from "../local-files/store.js";

import {
  handleAppendJournal,
  handleDiscoverInstances,
  handleInbox,
  handleRegisterInstance,
  notImplemented,
  type McpErrorResult,
  type McpToolResult
} from "./handlers.js";
import {
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  type McpToolDescriptor,
  type McpToolName
} from "./tools.js";

export interface CreateMcpServerOptions {
  /** Filesystem root for the backing local-files store. */
  root: string;
  /**
   * Optional pre-built store. If omitted, the server creates one with
   * `createLocalStore({ root })`. Useful for tests that want to share state
   * with the CLI.
   */
  store?: LocalStore;
}

export interface McpServer {
  listTools(): McpToolDescriptor[];
  callTool(name: string, args: Record<string, unknown> | undefined): McpToolResult | McpErrorResult;
}

/**
 * Build an in-process MCP server backed by the local-files runtime.
 *
 * This is intentionally NOT a JSON-RPC / stdio transport. It exposes a
 * minimal `{ listTools, callTool }` surface so the same dispatch can be
 * unit-tested today and wrapped in a real MCP transport in a later slice.
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const store = options.store ?? createLocalStore({ root: options.root });

  function callTool(
    name: string,
    args: Record<string, unknown> | undefined
  ): McpToolResult | McpErrorResult {
    const toolName = name as McpToolName;
    switch (toolName) {
      case "h2a_register_instance":
        return handleRegisterInstance(store, args as never);
      case "h2a_discover_instances":
        return handleDiscoverInstances(store, args as never);
      case "h2a_inbox":
        return handleInbox(store, args as never);
      case "h2a_append_journal":
        return handleAppendJournal(store, args as never);
      case "h2a_open_negotiation":
      case "h2a_offer":
      case "h2a_counteroffer":
      case "h2a_sign":
      case "h2a_stabilize":
      case "h2a_escalate":
        return notImplemented(toolName);
      default:
        return { error: `unknown tool: ${name}` };
    }
  }

  return {
    listTools: () => H2A_CLI_MCP_TOOL_DESCRIPTORS.slice(),
    callTool
  };
}
