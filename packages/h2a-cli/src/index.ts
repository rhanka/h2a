import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { renderCliHelp, resolveAutoOpen, runCli, runMcpServe, runRemoteSend, runRemoteServe } from "./cli.js";
import { H2A_CODEX_HOST } from "./hosts/codex.js";
import { H2A_GEMINI_HOST } from "./hosts/gemini.js";
import { H2A_AGY_HOST } from "./hosts/agy.js";
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
  H2A_AGY_HOST,
  H2A_CLI_MCP_TOOL_NAMES,
  renderCliHelp,
  resolveAutoOpen,
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
  markDrumbeatTerminal,
  scanDrumbeat,
  drumbeatTick,
  runDrumbeatWatch,
  loggingRelauncher,
  localTmuxRelauncher,
  headlessRelauncher,
  chainRelauncher,
  tmuxTarget,
  defaultRelauncherRuntime,
  loggingDecider,
  subagentDecider,
  recordDrumbeatDecision,
  listDrumbeatDecisions,
  H2A_DEFAULT_MAX_RELANCES,
  type H2ADrumbeatEntry,
  type H2ADrumbeatFinding,
  type H2ADrumbeatReason,
  type H2ADrumbeatScanResult,
  type H2ARelauncher,
  type H2ARelauncherKind,
  type RelauncherRuntime,
  type DrumbeatTickResult,
  type DrumbeatWatchOptions,
  type ReflexiveDecider,
  type DeciderRuntime,
  type SubagentDeciderOptions,
  type H2ADrumbeatDecisionRecord
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
  recordEscalation,
  readEscalation,
  listEscalations,
  clearEscalation,
  type H2AEscalationRecord,
  type H2AEscalationReason,
  type RecordEscalationInput
} from "./runtime/escalation/index.js";

export {
  resolveProviderSession,
  defaultProviderSessionReaders,
  listBindings,
  findBinding,
  verifyReclaimProof,
  reclaimOrMint,
  mergeInboxDedup,
  type ProviderSession,
  type ProviderSessionReaders,
  type ProviderSessionSource,
  type ResolveProviderSessionInput,
  type H2AIdentityBinding,
  type IdentityBindingKey,
  type ReclaimOrMintDeps,
  type ReclaimOrMintResult
} from "./runtime/identity/index.js";

export {
  isNewerVersion,
  parseSemver,
  checkUpgrade,
  performUpgrade,
  currentCliVersion,
  upgradeCachePath,
  canReexec,
  reexecSelf,
  H2A_CLI_PACKAGE,
  H2A_UPGRADE_CHECK_TTL_MS,
  H2A_REEXEC_GUARD_ENV,
  type ReexecOptions,
  type UpgradeRuntime,
  type UpgradeCacheEntry,
  type UpgradeCheckResult
} from "./runtime/upgrade/index.js";

export { cmdUpgrade, cmdOrg, cmdCoach } from "./cli.js";

export {
  resolveSysmlElement,
  hashSysmlElement,
  verifyEnvelopeSysmlRef,
  extractSysmlRef,
  sysmlQueryScope,
  type SysmlFetchImpl,
  type SysmlFetchResponse,
  type ResolveSysmlOptions,
  type VerifyEnvelopeSysmlOptions,
  type VerifyEnvelopeSysmlResult,
  type H2ASysmlQueryScope,
  type H2ASysmlQueryDetail
} from "./runtime/sysml/index.js";

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
  H2A_GEMINI_HOST,
  H2A_AGY_HOST
] as const;

export const H2A_CLI_ADAPTER = {
  packageName: "@sentropic/h2a-cli",
  corePackageName: "@sentropic/h2a",
  protocol: "sentropic.h2a",
  hosts: H2A_CLI_HOSTS,
  mcpToolNames: H2A_CLI_MCP_TOOL_NAMES
} as const;
