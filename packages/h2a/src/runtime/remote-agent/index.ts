/**
 * Internal barrel for the remote-control agent (LH-00..LH-06).
 *
 * INTERNAL ONLY: this barrel is never re-exported from the package root
 * (src/index.ts). The trunk/catalogue/terminal types are provisional fixtures
 * (DB-01 replaces them with the published contract), so they stay on this
 * internal path. The fakes live under test/helpers/ and are not shipped.
 */
export {
  REMOTE_CONTROL_ENV,
  REMOTE_CONTROL_DISABLED_REASON,
  REMOTE_CONTROL_DISABLED_MESSAGE,
  isRemoteControlEnabled,
  assertRemoteControlEnabled
} from "./flag.js";
export {
  TRUNK_PROTOCOL_VERSION,
  TRUNK_RECORD_MAX_BYTES,
  TRUNK_TERMINAL_TEXT_MAX_BYTES,
  CATALOGUE_MAX_ROWS,
  CATALOGUE_ROW_MAX_BYTES,
  CATALOGUE_SNAPSHOT_MAX_BYTES,
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_OUTPUT_COALESCE_BYTES,
  canonicalTrunkJson,
  signTrunkAuthPayload,
  verifyTrunkAuthPayload,
  isTrunkRecord,
  type TrunkEnvelope,
  type TrunkChallenge,
  type TrunkAuthPayload,
  type TrunkLinkRecord,
  type InventoryHostKind,
  type CatalogueInstanceStatus,
  type CatalogueOperabilityReason,
  type CatalogueSessionRow,
  type CatalogueInstanceStatusUpdate,
  type CatalogueRowUpdate,
  type CatalogueSnapshot,
  type CatalogueDelta,
  type TrunkCatalogueRecord,
  type TrunkTerminalRecord,
  type TrunkRecord
} from "./types.js";
export {
  projectCatalogueRow,
  projectJoinedCatalogueRow,
  buildCatalogueSnapshot,
  buildBoundedCatalogueSnapshot,
  fitCatalogueRowToBound,
  serializeCatalogueSnapshot,
  parseCatalogueSnapshot,
  serializeCatalogueDelta,
  parseCatalogueDelta,
  applyCatalogueDelta,
  isInstanceStatusUpdate,
  sanitizeDisplayScalar,
  containsForbiddenLocalField,
  isInternalCompanionNativeId,
  isCanonicalCatalogueSid,
  nativeCatalogueSid,
  presenceCatalogueSid,
  type ProjectJoinedRowInput
} from "./catalogue.js";
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
