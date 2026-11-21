/**
 * LH-00 contract fakes and flag (plan section LH-00). Behind the flag, no verb
 * or agent code is wired yet: the existing `remote` signed-envelope verbs and
 * the mirror cycle are byte-identical with the flag off.
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
  type CatalogueSessionRow,
  type CatalogueSnapshot,
  type CatalogueDelta,
  type TrunkCatalogueRecord,
  type TrunkTerminalRecord,
  type TrunkRecord
} from "./types.js";
export {
  projectCatalogueRow,
  buildCatalogueSnapshot,
  serializeCatalogueSnapshot,
  parseCatalogueSnapshot,
  containsForbiddenLocalField
} from "./catalogue.js";
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
