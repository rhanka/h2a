import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { renderCliHelp, runCli, runMcpServe, runRemoteSend, runRemoteServe } from "./cli.js";
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
  runMcpServe,
  runRemoteSend,
  runRemoteServe
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
  deletePresence,
  inboxDir,
  listPresence,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  presenceFile,
  readPresence,
  safePathSegment,
  sanitizeStorePaths,
  updatePresence,
  withLease,
  withLeaseSync,
  withLock,
  withLockSync,
  writePresence,
  type CreateLocalStoreOptions,
  type H2AKeyEvent,
  type H2ASubagentAuditEvent,
  type H2ASubagentStatus,
  type H2AStoreSchemaSentinel,
  type LeaseHandle,
  type LeaseRecord,
  type ListPresenceOptions,
  type LocalStore,
  type LocalStorePaths,
  type LockOwner,
  type PresenceWriteResult,
  type SanitizePathsResult,
  type SanitizeRenameEntry,
  type WithLeaseOptions,
  type WithLockOptions
} from "./runtime/local-files/index.js";

export {
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  NotificationDispatcher,
  SessionRegistry,
  createMcpServer,
  runMcpStdio,
  type CreateMcpServerOptions,
  type McpErrorResult,
  type McpPushNotification,
  type McpServer,
  type McpToolDescriptor,
  type McpToolName,
  type McpToolResult,
  type NotificationSink,
  type OpenSessionRequest,
  type RunMcpStdioOptions,
  type SessionRegistryOptions
} from "./runtime/mcp/index.js";

export {
  renderK8sSidecar,
  type K8sSidecarFragment,
  type K8sSidecarOptions
} from "./runtime/deploy/k8s-sidecar.js";

export {
  renderK8sTenant,
  type K8sTenantManifest,
  type K8sTenantOptions
} from "./runtime/deploy/k8s-tenant.js";

export {
  recordStop,
  readDrumbeatEntry,
  listDrumbeat,
  clearDrumbeatEntry,
  markRelanced,
  scanDrumbeat,
  drumbeatTick,
  runDrumbeatWatch,
  loggingRelauncher,
  localTmuxRelauncher,
  headlessRelauncher,
  chainRelauncher,
  tmuxTarget,
  defaultRelauncherRuntime,
  H2A_DEFAULT_MAX_RELANCES,
  type H2ADrumbeatEntry,
  type H2ADrumbeatFinding,
  type H2ADrumbeatReason,
  type H2ADrumbeatScanResult,
  type H2ARelauncher,
  type H2ARelauncherKind,
  type RelauncherRuntime,
  type DrumbeatTickResult,
  type DrumbeatWatchOptions
} from "./runtime/drumbeat/index.js";

export {
  raiseBlockage,
  readBlockage,
  listBlockages,
  resolveBlockage,
  loggingNotifier as blockageLoggingNotifier,
  commandNotifier,
  pollingNotifier,
  chainNotifier as chainBlockageNotifier,
  defaultNotifierRuntime,
  type RaiseBlockageInput,
  type BlockageNotifier,
  type BlockagePeer,
  type NotifierRuntime
} from "./runtime/blockage/index.js";

export {
  acceptRemoteEnvelope,
  createRemoteServer,
  rejectionStatus,
  remoteServerForStore,
  sendRemoteEnvelope,
  type AcceptRemoteOptions,
  type H2AAcceptRejection,
  type H2AAcceptResult,
  type RemoteServerForStoreOptions,
  type RemoteServerOptions,
  type SendRemoteOptions,
  type SendRemoteResult
} from "./runtime/remote/index.js";

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
