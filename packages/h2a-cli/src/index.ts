import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { renderCliHelp, runCli, runMcpServe } from "./cli.js";
import { H2A_CODEX_HOST } from "./hosts/codex.js";
import { H2A_GEMINI_HOST } from "./hosts/gemini.js";
import { H2A_CLI_MCP_TOOL_NAMES } from "./mcp.js";

export type {
  H2AConfigurableHostDescriptor,
  H2AHostDescriptor,
  H2AHostWave,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./hosts/codex.js";

export {
  H2A_CLAUDE_HOST,
  H2A_CODEX_HOST,
  H2A_GEMINI_HOST,
  H2A_CLI_MCP_TOOL_NAMES,
  renderCliHelp,
  runCli,
  runMcpServe
};

export {
  H2A_CLI_VERB_CONTRACTS,
  H2A_CLI_VERB_CONTRACT_BY_VERB,
  type H2ACliExitCode,
  type H2ACliOutputShape,
  type H2ACliVerbContract
} from "./cli-contract.js";

export {
  H2A_STORE_SCHEMA_FILE,
  H2A_STORE_SCHEMA_VERSION,
  LockTimeoutError,
  StoreSchemaMismatchError,
  createLocalStore,
  inboxDir,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  withLock,
  withLockSync,
  type CreateLocalStoreOptions,
  type H2AStoreSchemaSentinel,
  type LocalStore,
  type LocalStorePaths,
  type LockOwner,
  type WithLockOptions
} from "./runtime/local-files/index.js";

export {
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  createMcpServer,
  runMcpStdio,
  type CreateMcpServerOptions,
  type McpErrorResult,
  type McpServer,
  type McpToolDescriptor,
  type McpToolName,
  type McpToolResult,
  type RunMcpStdioOptions
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
