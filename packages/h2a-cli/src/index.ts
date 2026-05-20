import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { renderCliHelp, runCli } from "./cli.js";
import { H2A_CODEX_HOST } from "./hosts/codex.js";
import { H2A_GEMINI_HOST } from "./hosts/gemini.js";
import { H2A_CLI_MCP_TOOL_NAMES } from "./mcp.js";

export {
  H2A_CLAUDE_HOST,
  H2A_CODEX_HOST,
  H2A_GEMINI_HOST,
  H2A_CLI_MCP_TOOL_NAMES,
  renderCliHelp,
  runCli
};

export {
  createLocalStore,
  inboxDir,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  type CreateLocalStoreOptions,
  type LocalStore,
  type LocalStorePaths
} from "./runtime/local-files/index.js";

export {
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  createMcpServer,
  type CreateMcpServerOptions,
  type McpErrorResult,
  type McpServer,
  type McpToolDescriptor,
  type McpToolName,
  type McpToolResult
} from "./runtime/mcp/index.js";

export const H2A_CLI_HOSTS = [
  H2A_CODEX_HOST,
  H2A_CLAUDE_HOST,
  H2A_GEMINI_HOST
] as const;

export const H2A_CLI_ADAPTER = {
  packageName: "@sentropic/h2a-cli",
  corePackageName: "@sentropic/h2a",
  protocol: "sentropic.h2a",
  hosts: H2A_CLI_HOSTS,
  mcpToolNames: H2A_CLI_MCP_TOOL_NAMES
} as const;
