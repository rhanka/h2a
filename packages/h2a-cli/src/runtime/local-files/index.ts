export {
  assertHostQualifiedAddress,
  canonicalAddress,
  inboxDir,
  inboxDirRaw,
  isHostQualifiedAddress,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  presenceFile,
  safePathSegment,
  type LocalStorePaths
} from "./paths.js";

export {
  deletePresence,
  listPresence,
  readPresence,
  updatePresence,
  writePresence,
  type ListPresenceOptions,
  type PresenceWriteResult
} from "./presence.js";

export {
  sanitizeStorePaths,
  type SanitizePathsResult,
  type SanitizeRenameEntry
} from "./migrate.js";

export {
  createLocalStore,
  type CreateLocalStoreOptions,
  type H2AKeyEvent,
  type H2ASubagentAuditEvent,
  type H2ASubagentStatus,
  type LocalStore
} from "./store.js";

export {
  LockTimeoutError,
  withLock,
  withLockSync,
  type LockOwner,
  type WithLockOptions
} from "./locks.js";

export {
  withLease,
  withLeaseSync,
  type LeaseHandle,
  type LeaseRecord,
  type WithLeaseOptions
} from "./lease.js";

export {
  H2A_STORE_SCHEMA_FILE,
  H2A_STORE_SCHEMA_VERSION,
  StoreSchemaMismatchError,
  readCliPackageVersion,
  type H2AStoreSchemaSentinel
} from "./schema.js";
