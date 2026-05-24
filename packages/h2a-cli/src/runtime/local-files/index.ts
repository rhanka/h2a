export {
  inboxDir,
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
  createLocalStore,
  type CreateLocalStoreOptions,
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
  H2A_STORE_SCHEMA_FILE,
  H2A_STORE_SCHEMA_VERSION,
  StoreSchemaMismatchError,
  readCliPackageVersion,
  type H2AStoreSchemaSentinel
} from "./schema.js";
