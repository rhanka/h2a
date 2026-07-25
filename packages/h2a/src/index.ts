export {
  H2A_ABC_MODEL_CAPABILITIES,
  H2A_ABC_MODEL_IDS,
  H2A_ABC_MODEL_PROFILES,
  auditAbcModelCompatibility,
  getAbcModelProfile
} from "./abc.js";
export type {
  H2AAbcModelCapability,
  H2AAbcModelCapabilityDescriptor,
  H2AAbcModelCapabilityStatus,
  H2AAbcModelCompatibilityResult,
  H2AAbcModelId,
  H2AAbcModelProfileDescriptor,
  H2AAbcTopology,
  H2AAbcTrack
} from "./abc.js";
export {
  H2A_MULTI_HUMAN_MODE_IDS,
  H2A_MULTI_HUMAN_MODES,
  getMultiHumanMode,
  selectMultiHumanMode
} from "./multi-human.js";
export type {
  H2AMultiHumanChannel,
  H2AMultiHumanModeDescriptor,
  H2AMultiHumanModeId,
  H2AMultiHumanModeRequest,
  H2AMultiHumanModeSelection,
  H2AMultiHumanModeSelectionFailure,
  H2AMultiHumanModeSelectionResult
} from "./multi-human.js";
export {
  H2A_GOVERNANCE_BOUNDARY_ITEMS,
  H2A_GOVERNANCE_BOUNDARY_LAYERS,
  H2A_GOVERNANCE_BOUNDARY_STATUSES,
  classifyGovernanceBoundary,
  listGovernanceBoundaryItems
} from "./governance-boundary.js";
export type {
  H2AGovernanceBoundaryItemDescriptor,
  H2AGovernanceBoundaryItemId,
  H2AGovernanceBoundaryLayer,
  H2AGovernanceBoundaryStatus
} from "./governance-boundary.js";
export {
  H2A_POLICY_PRECEDENCE_CONFLICT_DISPOSITIONS,
  H2A_POLICY_PRECEDENCE_PROFILES,
  H2A_POLICY_PRECEDENCE_TIERS,
  auditPolicyPrecedenceProfile,
  getPolicyPrecedenceProfile
} from "./policy-precedence.js";
export type {
  H2APolicyPrecedenceAuditResult,
  H2APolicyPrecedenceConflictDisposition,
  H2APolicyPrecedenceProfileDescriptor,
  H2APolicyPrecedenceTier
} from "./policy-precedence.js";
export {
  H2A_DISCLOSURE_CONFLICT_DISPOSITIONS,
  H2A_DISCLOSURE_MODES,
  H2A_DISCLOSURE_PROFILES,
  auditDisclosureProfile,
  getDisclosureProfile
} from "./disclosure.js";
export type {
  H2ADisclosureAuditResult,
  H2ADisclosureConflictDisposition,
  H2ADisclosureMode,
  H2ADisclosureProfileDescriptor
} from "./disclosure.js";
export {
  H2A_CRITERES_CONFLIT,
  H2A_DECLARATION_INTERET_BODY_KIND,
  H2A_POSTURES_CONFLIT,
  derivePostureConflit,
  isH2ADeclarationInteret
} from "./conflit-interet.js";
export type {
  H2ACritereConflit,
  H2ADeclarationInteret,
  H2APostureConflit,
  H2APostureConflitContext,
  H2APostureConflitResult
} from "./conflit-interet.js";
export {
  H2A_COMPREHENSION_ATTESTATION_BODY_KIND,
  buildComprehensionAttestation,
  canAttestComprehension,
  isComprehensionAttestation,
  verifyComprehensionAttestation
} from "./comprehension-attestation.js";
export type {
  BuildComprehensionAttestationInput,
  H2AComprehensionAttestation,
  H2APublicKeyRing
} from "./comprehension-attestation.js";
export {
  H2A_DECISION_DOSSIER_KIND,
  H2A_DECISION_DOSSIER_RANK_REASONS,
  deriveDecisionDossier,
  evaluatePresenterBias
} from "./decision-dossier.js";
export type {
  DeriveDecisionDossierInput,
  H2ADecisionDossier,
  H2ADecisionDossierItem,
  H2ADecisionDossierRankReason,
  H2APresenterBias
} from "./decision-dossier.js";
export {
  H2A_CONFIANCE_REASONS,
  H2A_POSTURES_CONFIANCE,
  derivePostureConfiance
} from "./confiance.js";
export type {
  DerivePostureConfianceInput,
  H2AConfianceReason,
  H2APostureConfiance,
  H2APostureConfianceResult
} from "./confiance.js";
export {
  H2A_RECOURSE_CONFLICT_DISPOSITIONS,
  H2A_RECOURSE_PROFILES,
  H2A_RECOURSE_STATES,
  auditRecourseProfile,
  getRecourseProfile
} from "./recourse.js";
export type {
  H2ARecourseAuditResult,
  H2ARecourseConflictDisposition,
  H2ARecourseProfileDescriptor,
  H2ARecourseState
} from "./recourse.js";
export {
  H2A_OBLIGATION_CADENCES,
  H2A_RECURRING_OBLIGATION_CONFLICT_DISPOSITIONS,
  H2A_RECURRING_OBLIGATION_PROFILES,
  auditRecurringObligationProfile,
  getRecurringObligationProfile
} from "./recurring-obligations.js";
export type {
  H2AObligationCadence,
  H2ARecurringObligationAuditResult,
  H2ARecurringObligationConflictDisposition,
  H2ARecurringObligationProfileDescriptor
} from "./recurring-obligations.js";
export {
  H2A_JURISDICTION_CONFLICT_DISPOSITIONS,
  H2A_JURISDICTION_KINDS,
  H2A_JURISDICTION_PROFILES,
  auditJurisdictionProfile,
  getJurisdictionProfile
} from "./jurisdiction.js";
export type {
  H2AJurisdictionAuditResult,
  H2AJurisdictionConflictDisposition,
  H2AJurisdictionKind,
  H2AJurisdictionProfileDescriptor
} from "./jurisdiction.js";
export {
  createEnvelope,
  isH2AEnvelope,
  signEnvelope,
  validateH2AEnvelope,
  verifyEnvelopeSignature
} from "./envelope.js";
export {
  H2A_DEFAULT_MAX_AGE_MS,
  H2A_DEFAULT_MAX_SKEW_MS,
  checkEnvelopeFreshness,
  createReplayGuard
} from "./replay.js";
export type {
  H2AFreshnessOptions,
  H2AReplayCheck,
  H2AReplayGuard,
  H2AReplayRejection
} from "./replay.js";
export {
  H2A_ACTIVITY_WINDOW_DEFAULT_MS,
  H2A_DEFAULT_STALL_IDLE_MS,
  H2A_SESSION_DEFAULT_EXPIRY_MS,
  H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
  H2A_SESSION_NOTIFICATION_TOPICS,
  H2A_SESSION_STATES,
  H2A_WORK_STATUSES,
  deriveConnectionConfidence,
  inferStall,
  isH2ASession,
  isSessionExpired,
  pickFreshSessions
} from "./session.js";
export type {
  H2AAgentVersion,
  H2AConnectionConfidence,
  H2AConnectionConfidenceOptions,
  H2ALaunchContext,
  H2ASession,
  H2ASessionExpiryOptions,
  H2ASessionInterests,
  H2ASessionNotificationTopic,
  H2ASessionState,
  H2AStallOptions,
  H2AStallReason,
  H2AStallVerdict,
  H2AWorkStatus
} from "./session.js";
export {
  H2A_HOST_BRIDGE_CLAUSES,
  H2A_HOST_BRIDGE_PROFILES,
  auditHostBridge,
  getHostBridgeProfile,
  listHostBridgeProfiles
} from "./h2a-bridge.js";
export type {
  H2AHostBridgeAuditResult,
  H2AHostBridgeAuthBoundaryClause,
  H2AHostBridgeClause,
  H2AHostBridgeDisclosureClause,
  H2AHostBridgeIdentityClause,
  H2AHostBridgeLifecycleClause,
  H2AHostBridgeProfileDescriptor,
  H2AHostBridgeProfileId,
  H2AHostBridgeResourceLimitsClause
} from "./h2a-bridge.js";
export {
  H2A_NHI_ATTESTATION_BODY_KIND,
  H2A_NHI_DEFAULT_LONG_LIVED_KEY_DAYS,
  H2A_NHI_RISK_IDS,
  auditNhiPosture,
  nhiAttestationEnvelope,
  nhiInventory,
  nhiKeyFingerprint
} from "./nhi.js";
export type {
  H2ANhiAttestationActor,
  H2ANhiAttestationBody,
  H2ANhiFinding,
  H2ANhiInstanceInventory,
  H2ANhiInstanceSnapshot,
  H2ANhiInventory,
  H2ANhiInventoryInput,
  H2ANhiInventoryTotals,
  H2ANhiKeyEventSnapshot,
  H2ANhiKeyInventory,
  H2ANhiOffboardSnapshot,
  H2ANhiPostureInput,
  H2ANhiPostureReport,
  H2ANhiPostureSummary,
  H2ANhiRiskId,
  H2ANhiSeverity,
  H2ANhiSubagentInventory,
  H2ANhiSubagentSnapshot
} from "./nhi.js";
export {
  H2A_NHI_EXPORT_KEY_USE,
  H2A_NHI_SPIFFE_PATH_ENCODINGS,
  nhiSpiffeId,
  nhiTrustBundle
} from "./nhi-export.js";
export type {
  H2ANhiTrustBundle,
  H2ANhiTrustBundleInput,
  H2ANhiTrustBundleKey
} from "./nhi-export.js";
export {
  H2A_BLOCKAGE_BODY_KIND,
  H2A_BLOCKAGE_CLEARED_BODY_KIND,
  blockageEnvelope,
  isActiveBlockage
} from "./blockage.js";
export type { H2ABlockage, H2ABlockageBody } from "./blockage.js";
export {
  H2A_ORG_PROPOSAL_BODY_KIND,
  H2A_ORG_RATIFIED_BODY_KIND,
  diffOrgManifest,
  effectiveOrgInstances,
  orgAssignmentEnvelope,
  validateOrgManifest
} from "./org.js";
export type {
  H2AOrgAssignmentActor,
  H2AOrgAssignmentBody,
  H2AOrgAssignmentKind,
  H2AOrgCommEdge,
  H2AOrgDiff,
  H2AOrgDiffEntry,
  H2AOrgInstance,
  H2AOrgManifest,
  H2AOrgMembershipGrant,
  H2AOrgRegisteredInstance,
  H2AOrgValidationError,
  H2AOrgValidationResult
} from "./org.js";
export { H2A_ORG_MANIFEST_FILENAME, parseOrgManifest } from "./org-parse.js";
export type { H2AOrgParseResult, YamlValue } from "./org-parse.js";
export { deriveValueChain } from "./value-chain.js";
export type {
  H2ADeriveValueChainOptions,
  H2AValueChainNode
} from "./value-chain.js";
export { deriveMutualisationOpportunities } from "./mutualisation.js";
export type { H2AMutualisationOpportunity } from "./mutualisation.js";
export { H2A_REFLEXIVE_ACTIONS, parseReflexiveDecision } from "./drumbeat-decision.js";
export type { H2AReflexiveAction, H2AReflexiveDecision } from "./drumbeat-decision.js";
export {
  H2A_DRUMBEAT_RESUME_BODY_KIND,
  parseDrumbeatResumeBody
} from "./drumbeat-resume.js";
export type { H2ADrumbeatResumeBody } from "./drumbeat-resume.js";
export {
  H2A_SYSML_REF_KIND,
  isH2ASysmlRef,
  sysmlRefEquals,
  validateSysmlRef
} from "./sysml.js";
export type {
  H2ASysmlRef,
  H2ASysmlRefValidation,
  H2ASysmlRefValidationError
} from "./sysml.js";
export {
  deriveInstanceId,
  deriveWorkspaceId,
  isH2AWorkspaceRef,
  mintAgentUuid,
  slugify,
  uuid12
} from "./identity.js";
export type {
  DeriveInstanceIdInput,
  DeriveWorkspaceIdInput,
  H2AWorkspaceRef
} from "./identity.js";
export { assertValidNegotiationState } from "./negotiation.js";
export { canonicalize, computeHash } from "./canonical.js";
export { signCanonical, verifyCanonical } from "./signature.js";
export type { SignOptions } from "./signature.js";
export {
  decideInboxWake,
  formatWakeLine,
  H2A_WAKE_REASON_INBOX,
  type InboxWakeInput,
  type InboxWakeDecision
} from "./wake.js";
export {
  appendJournalEntry,
  createJournalEntry,
  journalEntryAsCanonicalString,
  verifyJournalChain
} from "./journal.js";
export type {
  H2AJournalEntry,
  H2AJournalPayload,
  H2AJournalVerification
} from "./journal.js";
export {
  isAmendment,
  isAuthority,
  isContract,
  isEnforcementPlan,
  isEngagement,
  isMandate,
  isPolicy,
  isSignature
} from "./artifacts.js";
export {
  H2A_AUTHORITY_MATRIX,
  H2A_ATTESTER_COMPREHENSION_RIGHT,
  assertCanSignArtifactKind,
  canSignArtifactKind
} from "./authority.js";
export type { H2AAuthorityMatrixKind } from "./authority.js";
export {
  H2A_CONTRACTUAL_ARTIFACT_PROFILES,
  assertContractualArtifactInvariants,
  auditContractualArtifact,
  getContractualArtifactProfile
} from "./contractual.js";
export type {
  H2AContractualArtifact,
  H2AContractualArtifactAuditResult,
  H2AContractualArtifactKind,
  H2AContractualArtifactProfile,
  H2AContractualArtifactProfileDescriptor
} from "./contractual.js";
export {
  H2A_ESCALATION_AUTHORITY_KINDS,
  H2A_ESCALATION_CHANNELS,
  assertEscalationTargetResolved,
  resolveEscalationTarget
} from "./escalation.js";
export type {
  H2AEscalationAuthorityKind,
  H2AEscalationChannel,
  H2AEscalationResolution,
  H2AEscalationResolveOptions,
  H2AEscalationResolvedTarget,
  H2AEscalationTargetRequest,
  H2AEscalationUnresolvedTarget
} from "./escalation.js";
export { H2A_CANONICAL_FIXTURES } from "./fixtures-index.js";
export type { H2ACanonicalFixtureManifestEntry } from "./fixtures-index.js";
export {
  SUBAGENT_ADDRESS_SEPARATOR,
  isSubagentAddress,
  parseSubagentAddress,
  subagentActorRef,
  subagentAddress,
  validateSubagentBinding
} from "./subagents.js";
export type {
  H2ASubagentBinding,
  H2ASubagentValidation,
  H2ASubagentValidationError
} from "./subagents.js";
export {
  H2A_ARTIFACT_KINDS,
  H2A_AUTHORITY_KINDS,
  H2A_ENVELOPE_TYPES,
  H2A_NEGOTIATION_STATES,
  H2A_POLICY_ADOPTION_MODES,
  H2A_PROTOCOL,
  H2A_ROLES,
  H2A_VERSION,
  isH2AActorRegistration
} from "./types.js";
export type {
  H2AActorRef,
  H2AActorRegistration,
  H2AAmendment,
  H2AArtifactKind,
  H2AAuthority,
  H2AAuthorityKind,
  H2AContract,
  H2AEnforcementPlan,
  H2AEngagement,
  H2AEnvelope,
  H2AEnvelopeType,
  H2AMandate,
  H2ANegotiationRecord,
  H2ANegotiationState,
  H2APolicy,
  H2APolicyAdoptionMode,
  H2ARole,
  H2ASignature
} from "./types.js";

// ---- fusionné depuis l ex-@sentropic/h2a-cli (A1) ----
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
import { H2A_HERMES_HOST } from "./hosts/hermes.js";
import { H2A_OPENCODE_HOST } from "./hosts/opencode.js";
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
  H2A_HERMES_HOST,
  H2A_OPENCODE_HOST,
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
  tryAcquireLease,
  releaseLeaseHandle,
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
  H2A_RUN_API_VERSION,
  NotificationDispatcher,
  SessionRegistry,
  buildH2aRunInvocation,
  createMcpServer,
  executeH2aRun,
  executeH2aRunWithSpawn,
  handleH2aRun,
  runMcpStdio,
  validateH2aRunRequest,
  type CreateMcpServerOptions,
  type H2aRunExecutor,
  type H2aRunInvocation,
  type H2aRunRequest,
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
  declareObjectiveLoopDone,
  joinObjectiveLoop,
  listLoopEvents,
  listObjectiveLoops,
  listAutoTickLoops,
  isLoopAutoTickEligible,
  isLoopTerminal,
  autoTickGloballyDisabled,
  H2A_TERMINAL_LOOP_STATUSES,
  H2A_AUTOTICK_LIVE_STATUSES,
  readObjectiveLoop,
  reportObjectiveLoop,
  stopObjectiveLoop,
  validateLoopLaunchSpec,
  type CreateObjectiveLoopInput,
  type H2ALoopAgent,
  type H2ALoopAgentStatus,
  type H2ALoopEvent,
  type H2ALoopLaunchSpec,
  type H2ALoopPolicy,
  type H2ALoopRepoRef,
  type H2ALoopStatus,
  type H2ALoopTrackRef,
  type H2AObjectiveLoop
} from "./runtime/loop/index.js";

export {
  acquireLoopExecutorLease,
  loopExecutorLockPath,
  DEFAULT_LOOP_EXECUTOR_LEASE_MS,
  type LoopExecutorLease
} from "./runtime/loop/executor-lease.js";

export {
  runLoopSupervisor,
  runSupervisorBeat,
  loopAttendance,
  stampExecutorHeartbeat,
  readExecutorHeartbeat,
  loopExecutorHeartbeatPath,
  DEFAULT_SUPERVISOR_INTERVAL_MS,
  DEFAULT_UNATTENDED_TICKS,
  type LoopAttendance,
  type LoopSupervisorOptions,
  type SupervisorBeatSummary,
  type ExecutorHeartbeat
} from "./runtime/loop/supervisor.js";

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
  sanitizeDeclaredCapabilities,
  H2A_CLI_DECLARED_CAPABILITIES,
  H2A_DECLARED_CAPABILITIES,
  type H2ADeclaredCapability,
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

export * from "./runtime/feed/index.js";

export * from "./runtime/reporting/index.js";

export const H2A_CLI_HOSTS = [
  H2A_CODEX_HOST,
  H2A_CLAUDE_HOST,
  H2A_GEMINI_HOST,
  H2A_AGY_HOST,
  H2A_HERMES_HOST,
  H2A_OPENCODE_HOST
] as const;

export const H2A_CLI_ADAPTER = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  protocol: "sentropic.h2a",
  hosts: H2A_CLI_HOSTS,
  mcpToolNames: H2A_CLI_MCP_TOOL_NAMES
} as const;
