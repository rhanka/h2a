/**
 * Internal barrel for the remote-control agent (LH-00..LH-07).
 *
 * INTERNAL ONLY: this barrel is never re-exported from the package root
 * (src/index.ts). The trunk/catalogue/terminal types are provisional fixtures
 * (DB-01 replaces them with the published contract), so they stay on this
 * internal path. The fakes live under test/helpers/ and are not shipped.
 */
export {
  REMOTE_CONTROL_ENV,
  REMOTE_CONTROL_OFF_ENV,
  REMOTE_CONTROL_DISABLED_REASON,
  REMOTE_CONTROL_DISABLED_MESSAGE,
  isRemoteControlEnabled,
  isRemoteControlKilledByEnv,
  assertRemoteControlEnabled
} from "./flag.js";
export {
  TRUNK_PROTOCOL_VERSION,
  TRUNK_RECORD_MAX_BYTES,
  TRUNK_TERMINAL_TEXT_MAX_BYTES,
  CATALOGUE_MAX_ROWS,
  CATALOGUE_ROW_MAX_BYTES,
  CATALOGUE_SNAPSHOT_MAX_BYTES,
  CATALOGUE_LABEL_MAX_BYTES,
  CATALOGUE_LABEL_PREFIX_MAX_BYTES,
  CATALOGUE_ID_MAX_BYTES,
  CATALOGUE_PART_MAX_ROWS,
  CATALOGUE_SNAPSHOT_MAX_PARTS,
  CATALOGUE_DELTA_MAX_ENTRIES,
  CATALOGUE_RECORD_MAX_BYTES,
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_OUTPUT_COALESCE_BYTES,
  canonicalTrunkJson,
  signTrunkBytes,
  verifyTrunkBytes,
  signTrunkAuthPayload,
  verifyTrunkAuthPayload,
  isTrunkRecord,
  type TrunkEnvelope,
  type TrunkChallenge,
  type TrunkAuthPayload,
  type TrunkHelloRecord,
  type TrunkAuthRecord,
  type TrunkReadyRecord,
  type StateBeginRecord,
  type StatePartRecord,
  type StateEndRecord,
  type StateAppliedRecord,
  type StateActiveRecord,
  type PropGrantRecord,
  type TrunkStateRecord,
  type InstanceBindRecord,
  type InstanceBoundRecord,
  type InstanceRevokedRecord,
  type TrunkInstanceRecord,
  type TrunkLinkRecord,
  type InventoryHostKind,
  type CatalogueInstanceStatus,
  type CatalogueOperabilityReason,
  type CatalogueSessionRow,
  type CatalogueWireRow,
  type CatalogueSnapshotPart,
  type CatalogueSnapshotEnd,
  type CatalogueDelta,
  type TrunkCatalogueRecord,
  type TrunkTerminalRecord,
  type TrunkExtensionRecord,
  type TrunkRecord
} from "./types.js";
export {
  projectCatalogueRow,
  projectJoinedCatalogueRow,
  projectBoundedCatalogue,
  stripCatalogueLabel,
  jcsEscapedLength,
  boundCatalogueLabel,
  sanitizeDisplayScalar,
  containsForbiddenLocalField,
  isInternalCompanionNativeId,
  isCanonicalCatalogueSid,
  nativeCatalogueSid,
  presenceCatalogueSid,
  type ProjectJoinedRowInput
} from "./catalogue.js";
export {
  catalogueRowsEqual,
  planCatalogueUpdate,
  type CatalogueProjection,
  type CataloguePlan
} from "./catalogue-plan.js";
export {
  resolveExclusionsDir,
  resolveExclusionsFilePath,
  resolveCatalogueIdsFilePath,
  readExclusions,
  isSidExcluded,
  validateSessionTarget,
  setSessionExcluded,
  clearSessionExcluded,
  linkExclusionAlias,
  writeCatalogueIdsIndex,
  withExclusionShareAllowed,
  type StoredExclusionEntry,
  type StoredExclusionsFile,
  type ExclusionsLocationOptions,
  type ExclusionMutationOptions,
  type ExclusionReadResult,
  type ExclusionMutationResult,
  type ShareAllowedResult
} from "./exclusions.js";
export {
  CATALOGUE_DEFAULT_POLL_INTERVAL_MS,
  CATALOGUE_DEFAULT_COALESCE_WINDOW_MS,
  CATALOGUE_DEFAULT_PRESENCE_FRESHNESS_MS,
  defaultListNativeInventoryForRemote,
  createCatalogueProjector,
  type RemoteNativeSessionSnapshot,
  type RemoteNativeInventory,
  type RemoteNativeInventoryReader,
  type CatalogueTimerHandle,
  type CatalogueClock,
  type CatalogueAuditEvent,
  type CatalogueUnavailableReason,
  type CatalogueUnavailableEvent,
  type CatalogueEmitMessage,
  type ResolvedOpenTarget,
  type RefusedOpenTarget,
  type ResolveOpenResult,
  type CatalogueProjectorOptions,
  type CatalogueProjector
} from "./catalogue-watch.js";
export {
  NODE_KEY_FILE,
  NODE_KEY_DIR,
  resolveNodeKeyDir,
  nodeKeyFingerprint,
  loadNodeKey,
  readNodeKeyStatus,
  generateNodeKey,
  deleteNodeKey,
  type NodeKeyLoadResult,
  type NodeKeyStatus,
  type NodeKeyOptions
} from "./node-key.js";
export {
  REMOTE_CONTROL_VERBS,
  REMOTE_CONTROL_GATED_VERBS,
  REMOTE_CONTROL_GROUP,
  isRemoteControlVerb,
  defaultIsInteractive,
  remoteControlUnknownMessage,
  remoteControlKillFlagFile,
  setRemoteControlKillFlag,
  readRemoteControlKillFlag,
  runRemoteControlVerb,
  type RemoteControlVerb,
  type RemoteControlResult,
  type RemoteControlRunOptions
} from "./service.js";
export {
  resolveFleetValve,
  classifyLaunchHost,
  buildFleetInventory,
  buildFleetInventoryFromRoot,
  type FleetValve,
  type InventoryRow,
  type FleetInventory
} from "./fleet-inventory.js";
export {
  MAX_CREDIT_WINDOW_RECORDS,
  MAX_CREDIT_WINDOW_BYTES,
  TrunkCreditManager,
  type CreditAvailability,
  type CreditLimits,
  type CreditUpdateResult
} from "./trunk-credit.js";
export {
  normalizeCatalogueSid,
  wireInstanceId,
  isWireInstanceId,
  wireNodeId,
  isWireNodeId
} from "./wire-ids.js";
export {
  extractRawEd25519PublicKeyBase64,
  formatWET2Fingerprint,
  loadLocalInstancePossession,
  readRevokedInstancesRegistry,
  persistRevokedInstancesRegistry,
  TrunkInstanceManager,
  type LocalInstancePossession,
  type InstanceActResult,
  type RevokedInstancesScopeEntry,
  type RevokedInstancesRegistryRead
} from "./trunk-instance.js";
export {
  TrunkClient,
  readLinkStatusFile,
  writeLinkStatusFile,
  type TrunkEnrolment,
  type TrunkClock,
  type TrunkConnectionHandlers,
  type TrunkConnection,
  type TrunkConnector,
  type CatalogueEmitEvent,
  type TrunkCatalogueSource,
  type TrunkChannelContext,
  type TrunkLinkTerminationCause,
  type TrunkTerminalConsumer,
  type TrunkInstanceBindPayload,
  type PreparedCatalogueRecord,
  type TrunkContractProvider,
  type TrunkAuditEvent,
  type TrunkLinkStatus,
  type TrunkClientOptions
} from "./trunk-client.js";
export {
  AUTHORITY_SYNC_DEADLINE_MS,
  AUTHORITY_MAX_REVOCATIONS,
  AUTHORITY_MAX_GRANTS,
  AUTHORITY_MAX_PARTS,
  AUTHORITY_PART_MAX_ENTRIES,
  AUTHORITY_ENTRY_MAX_BYTES,
  AUTHORITY_PART_MAX_BYTES,
  AUTHORITY_RECORD_MAX_BYTES,
  AUTHORITY_ID_MAX_BYTES,
  AUTHORITY_MESH_TENANT_MAX_BYTES,
  AUTHORITY_GRANT_MAX_KINDS,
  AUTHORITY_KIND_MAX_BYTES,
  AUTHORITY_REVOKED_ACTORS,
  isUnescapedAsciiToken,
  isIsoUtc24Timestamp,
  AuthoritySyncStager,
  type AuthorityRevokedActor,
  type AuthorityRevocationEntry,
  type AuthorityGrantEntry,
  type TrunkAuthorityState,
  type AuthoritySyncStagerOptions,
  type AuthorityStagerStepResult,
  type AuthorityStagerEndResult
} from "./trunk-authority.js";
export {
  TERMINAL_OUTPUT_COALESCE_MS,
  TERMINAL_OUTPUT_POLL_INTERVAL_MS,
  TERMINAL_OUTPUT_MAX_RANGES,
  CoalescedRangeIndex,
  segmentSingleChunk,
  TerminalOutputAssembler,
  type NativeOutputChunk,
  type NativeReplayGap,
  type CoalescedRange,
  type TermOutProposal,
  type TerminalOutputAssemblerOptions
} from "./terminal-output.js";
export {
  TERMINAL_BRIDGE_DEFAULT_READ_TIMEOUT_MS,
  defaultConnectNativeObserverClient,
  createTerminalBridge,
  type NativeObserverSessionState,
  type NativeObserverAttachment,
  type NativeObserverReplay,
  type NativeTerminalObserverClient,
  type TerminalBridgeClock,
  type TerminalBridgeAuditEvent,
  type TerminalBridgeOptions,
  type TerminalBridge
} from "./terminal-bridge.js";
export {
  openTerminalInputLog,
  purgeStaleIncarnationLogs,
  type InputLogEntryResult,
  type InputLogEntry,
  type EpochEndReason,
  type EpochStatus,
  type ClassifyInSeqResult,
  type ReplayAfterResult,
  type TerminalInputLog
} from "./terminal-input-log.js";
export {
  isAllowlistedTerminalReply,
  createTerminalReplyFilter,
  type TerminalReplyClock,
  type TerminalReplyCheckResult,
  type TerminalReplyFilter
} from "./terminal-reply-filter.js";
export {
  REMOTE_CONTROL_ACTIVITY_WINDOW_MS,
  REMOTE_CONTROL_IDLE_TIMEOUT_MS,
  REMOTE_CONTROL_GRACE_TIMEOUT_MS,
  REMOTE_CONTROL_WATCH_INTERVAL_MS,
  TERMINAL_CONTROL_PORT_TIMEOUT_MS,
  defaultConnectNativeControlPort,
  createTerminalInput,
  type TerminalChannelCloseReason,
  type TerminalControlLease,
  type TerminalControlAcquireResult,
  type TerminalControlPort,
  type TerminalControlPortFactory,
  type TerminalInputClock,
  type TerminalInputAuditEvent,
  type TerminalInputOptions,
  type TerminalInputChannelAttachment,
  type TerminalInputModule
} from "./terminal-input.js";
