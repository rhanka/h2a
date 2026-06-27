import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import {
  renderCliHelp,
  resolveAutoOpen,
  runCli,
  runDriveServe,
  runDrumbeatRelanceInbox,
  runMcpServe,
  runRemoteSend,
  runRemoteServe,
  runMirrorServe,
  runMirrorPush
} from "./cli.js";
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
  runDriveServe,
  runDrumbeatRelanceInbox,
  runMcpServe,
  runRemoteSend,
  runRemoteServe,
  runMirrorServe,
  runMirrorPush
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
  assertHostQualifiedAddress,
  canonicalAddress,
  createLocalStore,
  isHostQualifiedAddress,
  deletePresence,
  inboxDir,
  inboxDirRaw,
  listPresence,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  presenceFile,
  reachGuard,
  readPresence,
  reapAllDeadPresence,
  reapDeadInstancePresence,
  resolveRecipient,
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
  type RecipientResolution,
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
  H2A_DEFAULT_LOOP_POLICY,
  appendLoopEvent,
  createLoopId,
  createObjectiveLoop,
  listLoopEvents,
  listObjectiveLoops,
  readObjectiveLoop,
  type CreateObjectiveLoopInput,
  type H2ALoopAgent,
  type H2ALoopAgentStatus,
  type H2ALoopEvent,
  type H2ALoopPolicy,
  type H2ALoopRepoRef,
  type H2ALoopStatus,
  type H2ALoopTrackRef,
  type H2AObjectiveLoop
} from "./runtime/loop/index.js";

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
  remoteRelauncher,
  chainRelauncher,
  tmuxTarget,
  tmuxSendSubmit,
  paneHasRecentHumanActivity,
  H2A_WAKE_DEFER_ACTIVITY_DEFAULT_MS,
  defaultRelauncherRuntime,
  relanceFromInbox,
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
  type H2ARelanceInboxResult,
  type H2ARelanceInboxSkip,
  type H2ARelanceInboxSkipReason,
  type RelauncherRuntime,
  type RemoteEndpointResolver,
  type RemoteEnvelopeSender,
  type RemoteRelauncherOptions,
  type RelanceFromInboxOptions,
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
  acceptDriveInstruction,
  authorizeDrive,
  buildHeadlessDriveCommand,
  chainDriver,
  createRemoteDriveServer,
  detectTmuxLaunchContext,
  formatSignedDriveInstruction,
  headlessDriver,
  latestLaunchContext,
  localTmuxDriver,
  loggingDriver,
  nativeDriveCommand,
  nativeBackchannelDriver,
  parseSignedDriveInstruction,
  remoteDriveRejectionStatus,
  remoteDriveServerForStore,
  verifyDriveOnReceive,
  verifySignedDriveInstruction,
  type AcceptDriveInstructionOptions,
  type BuildHeadlessDriveCommandInput,
  type DriveCommand,
  type FormatSignedDriveInstructionOptions,
  type H2ADriveAcceptReason,
  type H2ADriveAcceptResult,
  type H2ADriveAuthorizeReason,
  type H2ADriveAuthorizeResult,
  type H2ADriveInstructionPayload,
  type H2ADriveReceiveReason,
  type H2ADriveReceiveResult,
  type H2ADriveRemoteReason,
  type H2ADriveRemoteResult,
  type H2ADriveRequest,
  type H2ADriveVerifyReason,
  type H2ADriveVerifyResult,
  type H2ADriver,
  type H2ADriverKind,
  type NativeBackchannelDriverOptions,
  type NativeDriveCommandInput,
  type ParsedSignedDriveInstruction,
  type RemoteDriveServerForStoreOptions,
  type RemoteDriveServerOptions,
  type VerifyDriveOnReceiveOptions,
  type VerifySignedDriveInstructionOptions
} from "./runtime/drive/index.js";

export { createInboxWakeHandler, type InboxWakeHandlerDeps } from "./runtime/drive/inbox-wake.js";
export { agentVersion, readInstalledSkillVersion } from "./runtime/version/agent-version.js";

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
  readHostSessionName,
  listBindings,
  findBinding,
  verifyReclaimProof,
  reclaimOrMint,
  mergeInboxDedup,
  decideLegacyAdoption,
  type LegacyAdoptionInput,
  type LegacyAdoptionDecision,
  type ProviderSession,
  type ProviderSessionReaders,
  type ProviderSessionSource,
  type ResolveProviderSessionInput,
  type H2AIdentityBinding,
  type IdentityBindingKey,
  type ReclaimOrMintDeps,
  type ReclaimOrMintResult,
  type HostNameReaders
} from "./runtime/identity/index.js";

export {
  computeDurableWorkspaceId,
  durableWorkspaceId
} from "./runtime/identity/workspace-id.js";

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
  H2A_AUTO_UPGRADE_CHECK_TTL_MS,
  H2A_UPGRADE_CHECK_TTL_MS,
  H2A_REEXEC_GUARD_ENV,
  type ReexecOptions,
  type UpgradeRuntime,
  type UpgradeCacheEntry,
  type UpgradeCheckResult
} from "./runtime/upgrade/index.js";

export { cmdKeepalive, cmdUpgrade, cmdOrg, cmdCoach, keepaliveOnce, cmdConductorLaunch, cmdPresenceReap, cmdWakeRequest } from "./cli.js";

export {
  conductorFor,
  appendConductorClaim,
  listConductorClaims,
  activeConductorClaims,
  recommendConductorLaunch,
  conductorLaunchCheck,
  recordSpawnRequest,
  lastSpawnRequestAt,
  spawnAllowed,
  type ConductorCandidate,
  type ConductorClaimEvent,
  type ConductorForOptions,
  type ConductorResolution,
  type ConductorLaunchRecommendation,
  type ConductorLaunchCheckOpts,
  type ConductorLaunchCheckResult,
  type RecommendConductorLaunchOpts,
  type StalledItem,
  type SpawnRequestEvent,
  type SpawnAllowedOpts
} from "./runtime/governance/index.js";

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

export * from "./runtime/mcp-http/index.js";

export * from "./runtime/mirror/index.js";

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
