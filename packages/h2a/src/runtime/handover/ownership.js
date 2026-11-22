import fs from 'node:fs';
import { join } from 'node:path';
import { digest, canonicalBytes } from './wire.js';
import { validate, safeRelative } from './formats.js';
import { privateDirectory, readState, publishState, replaceState } from './state.js';
import { mutationLock, readWriterGate, currentExecution } from './mutation.js';

export const MAX_RETAINED_TERMINAL_PER_FAMILY = 64;
export const MAX_EFFECTS_PER_ACTIVE_ATTACHMENT = 256;
export const SYNC_HYDRATE_FILE_CEILING = 128;
export const MIGRATION_SCAN_BATCH_SIZE = 100;
export const MIGRATION_COMMIT_BATCH_SIZE = 32;
export const MIGRATION_MAX_SLICE_MS = 8;

const ARCHIVED_OPERATION_CACHE_MAX = 256;
const LAUNCH_MEMO_RE = /^launch-[a-f0-9]+\.json$/;
const LAUNCH_LOC_RE = /^launch-location-(.+)\.json$/;
const GEN_END_RE = /^generation-end-(.+)\.json$/;

const leaf = (kind, id) => `${kind}-${digest(id).slice(7)}.json`;

function statStamp(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function tryFileStamp(path) {
  try {
    return statStamp(fs.lstatSync(path, { bigint: true }));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function fsyncDirectory(dirPath) {
  const fd = fs.openSync(dirPath, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function utcBatchDirName(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `batch-${y}${m}${d}`;
}

function compareBigInt(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function classifyFamily(name) {
  if (name.startsWith('operation-')) return 'operations';
  if (name.startsWith('effect-')) return 'effects';
  if (GEN_END_RE.test(name)) return 'generationEnds';
  if (name.startsWith('ownership-')) return 'ownerships';
  if (LAUNCH_MEMO_RE.test(name) || LAUNCH_LOC_RE.test(name)) return 'launches';
  if (name.startsWith('wake-')) return 'wakes';
  if (name.startsWith('checkpoint-')) return 'checkpoints';
  return null;
}

export class OwnershipRegistry {
  constructor(options) {
    this.directory = options.directory;
    this.generation = options.generation;
    this.processIdentity = options.processIdentity;
    this.lockDirectory = options.lockDirectory ?? this.directory;
    this.readOnly = Boolean(options.readOnly);
    this.indeterminate = false;
    this.onIndeterminate = undefined;
    this.ledger = null;

    // In-memory indexes (L1 r4 §4.1)
    this.ownersById = new Map();
    this.launchesByAttachment = new Map();
    this.launchLocationsById = new Map();
    this.wakesByAttachment = new Map();
    this.rootFileStamps = new Map();
    this._rootMeta = new Map();
    this.lastRevisionStamp = null;

    privateDirectory(this.directory);
    this.revisionPath = join(this.directory, 'participant-revision.json');
    if (!this.readOnly) {
      this.withLock(() => {
        if (!readState(this.revisionPath, 'participantRevision')) {
          publishState(this.revisionPath, { schemaVersion: 1, revision: 1 }, 'participantRevision');
        }
      });
    }
    this._hydrateControlFiles();
  }

  _hydrateControlFiles() {
    let entries;
    try {
      entries = fs.readdirSync(this.directory);
    } catch (error) {
      if (error.code === 'ENOENT') entries = [];
      else throw error;
    }
    this._initialJsonNames = entries.filter(n => n.endsWith('.json'));
    for (const name of this._initialJsonNames) {
      if (name.startsWith('ownership-') || LAUNCH_MEMO_RE.test(name) || LAUNCH_LOC_RE.test(name) || name.startsWith('wake-')) {
        this._ingestRootFile(name);
      }
    }
    this.lastRevisionStamp = tryFileStamp(this.revisionPath);
  }

  _ingestRootFile(name, knownStamp = undefined) {
    const filePath = join(this.directory, name);
    const stamp = knownStamp !== undefined ? knownStamp : tryFileStamp(filePath);
    if (stamp === null) {
      this._evictRootFile(name);
      return null;
    }
    if (name.startsWith('ownership-')) {
      const obs = readState(filePath, 'ownership');
      if (!obs) { this._evictRootFile(name); return null; }
      this.ownersById.set(obs.value.attachmentId, obs.value);
      this.rootFileStamps.set(name, stamp);
      this._rootMeta.set(name, { kind: 'ownership', id: obs.value.attachmentId });
      return obs.value;
    }
    if (LAUNCH_MEMO_RE.test(name)) {
      const obs = readState(filePath, 'launchMemo');
      if (!obs) { this._evictRootFile(name); return null; }
      this.recordLaunchMemo(name, obs.value, stamp);
      return obs.value;
    }
    if (LAUNCH_LOC_RE.test(name)) {
      const obs = readState(filePath, 'launchLocation');
      if (!obs) { this._evictRootFile(name); return null; }
      this.recordLaunchLocation(name, obs.value, stamp);
      return obs.value;
    }
    if (name.startsWith('wake-')) {
      const obs = readState(filePath, 'wakeIntent');
      if (!obs) { this._evictRootFile(name); return null; }
      this.recordWakeIntent(name, obs.value, stamp);
      return obs.value;
    }
    if (this.ledger) {
      return this.ledger._ingestLedgerRootFile(name, stamp);
    }
    return null;
  }

  _evictRootFile(name) {
    this.rootFileStamps.delete(name);
    const meta = this._rootMeta.get(name);
    this._rootMeta.delete(name);
    if (meta) {
      if (meta.kind === 'ownership') {
        this.ownersById.delete(meta.id);
      } else if (meta.kind === 'launchMemo') {
        const m = this.launchesByAttachment.get(meta.attachmentId);
        if (m) {
          m.delete(meta.launchName);
          if (m.size === 0) this.launchesByAttachment.delete(meta.attachmentId);
        }
      } else if (meta.kind === 'launchLocation') {
        this.launchLocationsById.delete(meta.launchId);
      } else if (meta.kind === 'wakeIntent') {
        const m = this.wakesByAttachment.get(meta.attachmentId);
        if (m) {
          m.delete(meta.key);
          if (m.size === 0) this.wakesByAttachment.delete(meta.attachmentId);
        }
      }
    }
    if (this.ledger) {
      this.ledger._evictLedgerRootFile(name);
    }
  }

  recordOwner(value) {
    const name = leaf('ownership', value.attachmentId);
    const stamp = tryFileStamp(join(this.directory, name));
    this.ownersById.set(value.attachmentId, value);
    if (stamp !== null) this.rootFileStamps.set(name, stamp);
    this._rootMeta.set(name, { kind: 'ownership', id: value.attachmentId });
  }

  recordLaunchMemo(nameOrPath, memo, knownStamp = undefined) {
    const name = nameOrPath.includes('/') ? nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1) : nameOrPath;
    const stamp = knownStamp !== undefined ? knownStamp : tryFileStamp(join(this.directory, name));
    let map = this.launchesByAttachment.get(memo.attachmentId);
    if (!map) { map = new Map(); this.launchesByAttachment.set(memo.attachmentId, map); }
    map.set(memo.launchName, memo);
    if (stamp !== null) this.rootFileStamps.set(name, stamp);
    this._rootMeta.set(name, { kind: 'launchMemo', attachmentId: memo.attachmentId, launchName: memo.launchName });
  }

  recordLaunchLocation(nameOrPath, location, knownStamp = undefined) {
    const name = nameOrPath.includes('/') ? nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1) : nameOrPath;
    const stamp = knownStamp !== undefined ? knownStamp : tryFileStamp(join(this.directory, name));
    this.launchLocationsById.set(location.launchId, location);
    if (stamp !== null) this.rootFileStamps.set(name, stamp);
    this._rootMeta.set(name, { kind: 'launchLocation', launchId: location.launchId });
  }

  recordWakeIntent(nameOrPath, intent, knownStamp = undefined) {
    const name = nameOrPath.includes('/') ? nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1) : nameOrPath;
    const stamp = knownStamp !== undefined ? knownStamp : tryFileStamp(join(this.directory, name));
    let map = this.wakesByAttachment.get(intent.attachmentId);
    if (!map) { map = new Map(); this.wakesByAttachment.set(intent.attachmentId, map); }
    map.set(intent.key, intent);
    if (stamp !== null) this.rootFileStamps.set(name, stamp);
    this._rootMeta.set(name, { kind: 'wakeIntent', attachmentId: intent.attachmentId, key: intent.key });
  }

  allLaunchMemos() {
    this.syncIfExternalChange();
    const out = [];
    for (const map of this.launchesByAttachment.values()) {
      for (const memo of map.values()) out.push(memo);
    }
    return out;
  }

  syncIfExternalChange() {
    const stamp = tryFileStamp(this.revisionPath);
    if (stamp !== null && stamp === this.lastRevisionStamp) return false;

    if (this.ledger) {
      this.ledger.syncManifestTail();
    }

    const fullyMigrated = !this.ledger || this.ledger.ledgerMigrationComplete === true;
    if (fullyMigrated) {
      let names;
      try {
        names = fs.readdirSync(this.directory).filter(n => n.endsWith('.json'));
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
      const currentSet = new Set(names);
      for (const existing of [...this.rootFileStamps.keys()]) {
        if (!currentSet.has(existing)) {
          this._evictRootFile(existing);
        }
      }
      for (const name of names) {
        if (name === 'participant-revision.json') continue;
        const s = tryFileStamp(join(this.directory, name));
        if (s === null) {
          this._evictRootFile(name);
          continue;
        }
        if (this.rootFileStamps.get(name) === s) continue;
        this._ingestRootFile(name, s);
      }
    } else {
      // During background migration, re-check only already-tracked root files by deterministic path (0 readdirSync).
      for (const [name, oldStamp] of [...this.rootFileStamps.entries()]) {
        const s = tryFileStamp(join(this.directory, name));
        if (s === null) {
          this._evictRootFile(name);
          continue;
        }
        if (s !== oldStamp) {
          this._ingestRootFile(name, s);
        }
      }
    }

    this.lastRevisionStamp = stamp;
    return true;
  }

  withLock(fn) {
    return mutationLock(this.lockDirectory, () => {
      if (this.indeterminate) throw new Error('reconciliation_required');
      try { return fn(); }
      catch (error) {
        if (error.message.startsWith('persistence_indeterminate')) {
          this.indeterminate = true; this.onIndeterminate?.();
        }
        throw error;
      }
    });
  }

  reconcile() {
    return mutationLock(this.lockDirectory, () => {
      const formats = { ownership: 'ownership', operation: 'admittedOperation', effect: 'ownerEffect',
        wake: 'wakeIntent', launch: 'launchMemo' };
      for (const name of fs.readdirSync(this.directory)) {
        const prefix = name.split('-')[0];
        let schema = formats[prefix];
        if (name === 'participant-revision.json') schema = 'participantRevision';
        if (name.startsWith('launch-location-')) schema = 'launchLocation';
        if (name.startsWith('checkpoint-')) {
          const candidate = JSON.parse(fs.readFileSync(join(this.directory, name), 'utf8'));
          schema = candidate.emptyAttachments === true ? 'emptyCheckpoint' : 'checkpoint';
        }
        if (!schema || !name.endsWith('.json')) continue;
        readState(join(this.directory, name), schema);
        const fd = fs.openSync(join(this.directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      fsyncDirectory(this.directory);
      this.indeterminate = false;
      this.lastRevisionStamp = null;
      this.syncIfExternalChange();
    });
  }

  bump() {
    const old = readState(this.revisionPath, 'participantRevision');
    replaceState(this.revisionPath, { ...old.value, revision: old.value.revision + 1 }, 'participantRevision', old);
    this.lastRevisionStamp = tryFileStamp(this.revisionPath);
  }

  revision() {
    return readState(this.revisionPath, 'participantRevision').value.revision;
  }

  ownerPath(id) { return join(this.directory, leaf('ownership', id)); }

  owners() {
    this.syncIfExternalChange();
    return [...this.ownersById.values()];
  }

  claim(input) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      if (readState(this.ownerPath(input.attachmentId), 'ownership')) throw new Error('ownership_exists');
      const value = { schemaVersion: 1, ...input, ownerGeneration: this.generation, ownershipEpoch: 1,
        ownerProcessIdentity: this.processIdentity, state: 'ACTIVE', handoverId: null, checkpointVersion: 1, checkpointHash: null };
      publishState(this.ownerPath(input.attachmentId), value, 'ownership');
      this.recordOwner(value);
      this.bump();
      return this.token(value);
    });
  }

  token(value) {
    return Object.freeze({ attachmentId: value.attachmentId, ownerGeneration: value.ownerGeneration,
      ownershipEpoch: value.ownershipEpoch, ownerProcessIdentity: value.ownerProcessIdentity });
  }

  rebaseline(input, proveEnded) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const path = this.ownerPath(input.attachmentId), old = readState(path, 'ownership');
      if (!old || old.value.ownerGeneration === this.generation || !proveEnded(old.value)) throw new Error('ownership_exists');
      const value = { ...old.value, ...input, ownerGeneration: this.generation, ownershipEpoch: old.value.ownershipEpoch + 1,
        ownerProcessIdentity: this.processIdentity, state: 'ACTIVE', handoverId: null, checkpointVersion: 1, checkpointHash: null };
      replaceState(path, value, 'ownership', old);
      this.recordOwner(value);
      this.bump();
      return this.token(value);
    });
  }

  assertOwner(token, states = ['ACTIVE']) {
    if (this.indeterminate) throw new Error('reconciliation_required');
    const observed = readState(this.ownerPath(token.attachmentId), 'ownership');
    if (!observed || token.ownerGeneration !== observed.value.ownerGeneration ||
        token.ownershipEpoch !== observed.value.ownershipEpoch ||
        digest(token.ownerProcessIdentity) !== digest(observed.value.ownerProcessIdentity) || !states.includes(observed.value.state)) throw new Error('ownership_fenced');
    return observed;
  }

  updateIdentity(token, presenceSessionId, expectedInstance) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token);
      if (old.value.presenceSessionId === presenceSessionId && old.value.expectedInstance === expectedInstance) return;
      const next = { ...old.value, presenceSessionId, expectedInstance };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
      this.recordOwner(next);
      this.bump();
    });
  }

  releasePresence(token, sessionId) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token);
      if (old.value.presenceSessionId !== sessionId) throw new Error('presence_ownership_mismatch');
      const next = { ...old.value, presenceSessionId: `pending:${token.attachmentId}` };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
      this.recordOwner(next);
      this.bump();
    });
  }

  freeze(token, handoverId) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token, ['ACTIVE', 'FROZEN']);
      if (old.value.state === 'FROZEN') {
        if (old.value.handoverId !== handoverId) throw new Error('handover_conflict');
        return old.value;
      }
      const next = { ...old.value, state: 'FROZEN', handoverId };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
      this.recordOwner(next);
      this.bump();
      return next;
    });
  }

  checkpoint(token, snapshot) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token, ['FROZEN']);
      validate('checkpoint', snapshot);
      if (snapshot.attachmentId !== token.attachmentId || snapshot.ownershipEpoch !== token.ownershipEpoch || snapshot.deliveredSequence > snapshot.producedSequence) throw new Error('checkpoint_binding_mismatch');
      const hash = digest(snapshot), reference = `checkpoint-${hash.slice(7)}.json`;
      if (old.value.checkpointHash && old.value.checkpointHash !== hash) throw new Error('checkpoint_conflict');
      const path = join(this.directory, reference), existing = readState(path, 'checkpoint');
      if (existing && digest(existing.value) !== hash) throw new Error('checkpoint_corrupt');
      if (!existing) publishState(path, snapshot, 'checkpoint');
      if (!old.value.checkpointHash) {
        const next = { ...old.value, checkpointHash: hash };
        replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
        this.recordOwner(next);
        this.bump();
      }
      return { reference, checkpointHash: hash, checkpointVersion: 1, source: this.token(old.value), handoverId: old.value.handoverId };
    });
  }

  loadCheckpoint(reference, hash) {
    if (!safeRelative(reference) || reference !== `checkpoint-${hash.slice(7)}.json`) throw new Error('checkpoint_reference_invalid');
    const value = readState(join(this.directory, reference), 'checkpoint')?.value;
    if (!value || digest(value) !== hash) throw new Error('checkpoint_corrupt');
    return value;
  }

  abort(token, handoverId) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token, ['FROZEN']);
      if (old.value.handoverId !== handoverId) throw new Error('handover_conflict');
      const next = { ...old.value, state: 'ACTIVE', handoverId: null, checkpointHash: null };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
      this.recordOwner(next);
      this.bump();
    });
  }

  close(token) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token, ['ACTIVE', 'FROZEN', 'TRANSFERRING']);
      const next = { ...old.value, state: 'CLOSED' };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
      this.recordOwner(next);
      this.bump();
    });
  }

  fence(token, handoverId, checkpointHash) {
    return this.withLock(() => {
      this.syncIfExternalChange();
      const old = this.assertOwner(token, ['FROZEN', 'TRANSFERRING']);
      if (old.value.handoverId !== handoverId || !checkpointHash || old.value.checkpointHash !== checkpointHash) throw new Error('checkpoint_binding_mismatch');
      this.loadCheckpoint(`checkpoint-${checkpointHash.slice(7)}.json`, checkpointHash);
      if (old.value.state === 'TRANSFERRING') return old.value;
      const next = { ...old.value, state: 'TRANSFERRING' };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old);
      this.recordOwner(next);
      this.bump();
      return next;
    });
  }
}

export class OperationLedger {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.directory = registry.directory;
    this.archiveDirectory = join(this.directory, 'archive');
    this.manifestPath = join(this.archiveDirectory, 'manifest.jsonl');

    // In-memory indexes (L1 r4 §4.1)
    this.activeById = new Map();
    this.retainedCompleted = new Map();
    this.archivedOperationCache = new Map();
    this.effectsByAttachment = new Map();
    this._effectFileToMeta = new Map(); // filename -> { attachmentId, event, order }
    this._opFileToId = new Map(); // filename -> operationId
    this._opOrder = new Map(); // filename -> monotonic seq
    this._effectOrder = new Map(); // filename -> monotonic seq
    this._seq = 0;

    this.archivedGenerationEnds = new Map();
    this.archivedOperations = new Map();
    this.archivedEffects = new Map();
    this.manifestReadOffset = 0;
    this.lastManifestStamp = null;
    this.manifestIno = null;
    this.manifestDev = null;

    this.ledgerMigrationComplete = false;
    this._migrationStopped = false;
    this._migrationTimer = null;

    registry.ledger = this;

    // Startup sequence (L1 r4 §4.2)
    this._loadArchiveIndexesAtStartup();
    const initialNames = Array.isArray(registry._initialJsonNames)
      ? registry._initialJsonNames
      : fs.readdirSync(this.directory).filter(n => n.endsWith('.json'));

    if (options.skipAutoMigration) {
      if (initialNames.length <= SYNC_HYDRATE_FILE_CEILING) {
        this._hydrateRootLedgerFiles(initialNames);
      }
      this.ledgerMigrationComplete = true;
      this.registry.lastRevisionStamp = tryFileStamp(this.registry.revisionPath);
      return;
    }

    if (initialNames.length <= SYNC_HYDRATE_FILE_CEILING) {
      this._hydrateRootLedgerFiles(initialNames);
      if (!this.registry.readOnly) {
        this.compactBatch({ reason: 'startup-sync' });
      }
      this.registry.lastRevisionStamp = tryFileStamp(this.registry.revisionPath);
      this.ledgerMigrationComplete = true;
    } else {
      const pendingNames = initialNames.filter(n =>
        n.startsWith('operation-') ||
        n.startsWith('effect-') ||
        GEN_END_RE.test(n) ||
        n.startsWith('checkpoint-') ||
        n.startsWith('ownership-') ||
        LAUNCH_MEMO_RE.test(n) ||
        LAUNCH_LOC_RE.test(n) ||
        n.startsWith('wake-')
      );
      this.ledgerMigrationComplete = false;
      this._scheduleBackgroundMigration(pendingNames);
    }
  }

  stopMigration() {
    this._migrationStopped = true;
    if (this._migrationTimer !== null) {
      clearImmediate(this._migrationTimer);
      this._migrationTimer = null;
    }
  }

  _loadArchiveIndexesAtStartup() {
    // 1. Load manifest.jsonl if present
    this.syncManifestTail();
    // 2. Single startup scan of archive/batch-* filenames to catch files moved before a crash preceding manifest append (0 readState).
    let batches;
    try {
      batches = fs.readdirSync(this.archiveDirectory).filter(d => d.startsWith('batch-')).sort();
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const batchDir of batches) {
      let files;
      try {
        files = fs.readdirSync(join(this.archiveDirectory, batchDir));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of files) {
        if (name.startsWith('operation-') && name.endsWith('.json')) {
          this.archivedOperations.set(name, batchDir);
        } else if (name.startsWith('effect-') && name.endsWith('.json')) {
          this.archivedEffects.set(name, batchDir);
        } else {
          const m = GEN_END_RE.exec(name);
          if (m) this.archivedGenerationEnds.set(m[1], batchDir);
        }
      }
    }
  }

  _applyManifestRecord(rec) {
    if (!rec || typeof rec !== 'object') return;
    if (rec.reason === 'restore') {
      for (const name of rec.operations ?? []) this.archivedOperations.delete(name);
      for (const name of rec.effects ?? []) this.archivedEffects.delete(name);
      for (const gen of rec.generationEnds ?? []) {
        const m = GEN_END_RE.exec(gen);
        this.archivedGenerationEnds.delete(m ? m[1] : gen);
      }
      this.archivedOperationCache.clear();
      return;
    }
    const batchDir = rec.batchDir;
    if (typeof batchDir !== 'string' || !batchDir) return;
    for (const name of rec.operations ?? []) this.archivedOperations.set(name, batchDir);
    for (const name of rec.effects ?? []) this.archivedEffects.set(name, batchDir);
    for (const gen of rec.generationEnds ?? []) {
      const m = GEN_END_RE.exec(gen);
      this.archivedGenerationEnds.set(m ? m[1] : gen, batchDir);
    }
  }

  syncManifestTail() {
    let stat;
    try {
      stat = fs.lstatSync(this.manifestPath, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.manifestReadOffset = 0;
        this.lastManifestStamp = null;
        this.manifestIno = null;
        this.manifestDev = null;
        return;
      }
      throw error;
    }
    const stamp = statStamp(stat);
    if (stamp === this.lastManifestStamp) return;

    const size = Number(stat.size);
    const sameFile = this.manifestDev === stat.dev && this.manifestIno === stat.ino && size >= this.manifestReadOffset;
    let offset = sameFile ? this.manifestReadOffset : 0;

    if (size > offset) {
      const len = size - offset;
      const buf = Buffer.allocUnsafe(len);
      const fd = fs.openSync(this.manifestPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let bytesRead = 0;
      try {
        while (bytesRead < len) {
          const n = fs.readSync(fd, buf, bytesRead, len - bytesRead, offset + bytesRead);
          if (n <= 0) break;
          bytesRead += n;
        }
      } finally {
        fs.closeSync(fd);
      }
      const slice = buf.subarray(0, bytesRead);
      const lastNewline = slice.lastIndexOf(0x0a);
      if (lastNewline >= 0) {
        const text = slice.subarray(0, lastNewline).toString('utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            this._applyManifestRecord(JSON.parse(line));
          } catch { /* ignore malformed tail */ }
        }
        offset += lastNewline + 1;
      }
    }

    this.manifestReadOffset = offset;
    this.manifestDev = stat.dev;
    this.manifestIno = stat.ino;
    this.lastManifestStamp = stamp;
  }

  _hydrateRootLedgerFiles(names) {
    for (const name of names) {
      if (name.startsWith('operation-') || name.startsWith('effect-')) {
        const s = tryFileStamp(join(this.directory, name));
        if (s !== null) this._ingestLedgerRootFile(name, s);
      }
    }
  }

  _recordOperationInMemory(name, value, stamp) {
    this._opFileToId.set(name, value.operationId);
    if (!this._opOrder.has(name)) this._opOrder.set(name, ++this._seq);
    if (stamp !== null && stamp !== undefined) {
      this.registry.rootFileStamps.set(name, stamp);
    }
    if (value.state === 'completed') {
      this.activeById.delete(value.operationId);
      // FIFO bounded to MAX_RETAINED_TERMINAL_PER_FAMILY
      this.retainedCompleted.delete(value.operationId);
      this.retainedCompleted.set(value.operationId, value);
      while (this.retainedCompleted.size > MAX_RETAINED_TERMINAL_PER_FAMILY) {
        const oldest = this.retainedCompleted.keys().next().value;
        this.retainedCompleted.delete(oldest);
      }
    } else {
      this.retainedCompleted.delete(value.operationId);
      this.activeById.set(value.operationId, value);
    }
  }

  _rebuildEffectsListForAttachment(attachmentId) {
    const entries = [];
    for (const [fname, meta] of this._effectFileToMeta.entries()) {
      if (meta.attachmentId === attachmentId) entries.push({ fname, ...meta });
    }
    entries.sort((a, b) => a.order - b.order);
    const delegations = [];
    const regular = [];
    for (const e of entries) {
      if (e.event.result?.type === 'launch-delegation') delegations.push(e.event);
      else regular.push(e.event);
    }
    const boundedRegular = regular.length > MAX_EFFECTS_PER_ACTIVE_ATTACHMENT
      ? regular.slice(regular.length - MAX_EFFECTS_PER_ACTIVE_ATTACHMENT)
      : regular;
    const combined = [...delegations, ...boundedRegular];
    if (combined.length === 0) this.effectsByAttachment.delete(attachmentId);
    else this.effectsByAttachment.set(attachmentId, combined);
  }

  _recordRootEffect(name, event, stamp) {
    const order = this._effectOrder.get(name) ?? ++this._seq;
    this._effectOrder.set(name, order);
    this._effectFileToMeta.set(name, { attachmentId: event.attachmentId, event, order });
    if (stamp !== null && stamp !== undefined) {
      this.registry.rootFileStamps.set(name, stamp);
    }
    this._rebuildEffectsListForAttachment(event.attachmentId);
  }

  _ingestLedgerRootFile(name, stamp) {
    const filePath = join(this.directory, name);
    if (name.startsWith('operation-')) {
      const obs = readState(filePath, 'admittedOperation');
      if (!obs) { this._evictLedgerRootFile(name); return null; }
      this._recordOperationInMemory(name, obs.value, stamp);
      return obs.value;
    }
    if (name.startsWith('effect-')) {
      const obs = readState(filePath, 'ownerEffect');
      if (!obs) { this._evictLedgerRootFile(name); return null; }
      this._recordRootEffect(name, obs.value, stamp);
      return obs.value;
    }
    return null;
  }

  _evictLedgerRootFile(name) {
    const opId = this._opFileToId.get(name);
    if (opId !== undefined) {
      this._opFileToId.delete(name);
      this.activeById.delete(opId);
      this.retainedCompleted.delete(opId);
    }
    const effMeta = this._effectFileToMeta.get(name);
    if (effMeta !== undefined) {
      this._effectFileToMeta.delete(name);
      this._rebuildEffectsListForAttachment(effMeta.attachmentId);
    }
  }

  _cacheArchivedOperation(op) {
    this.archivedOperationCache.delete(op.operationId);
    this.archivedOperationCache.set(op.operationId, op);
    while (this.archivedOperationCache.size > ARCHIVED_OPERATION_CACHE_MAX) {
      const oldest = this.archivedOperationCache.keys().next().value;
      this.archivedOperationCache.delete(oldest);
    }
  }

  path(id) { return join(this.directory, leaf('operation', id)); }

  getOperation(operationId) {
    this.registry.syncIfExternalChange();
    const active = this.activeById.get(operationId);
    if (active) return active;
    const retained = this.retainedCompleted.get(operationId);
    if (retained) return retained;
    const cached = this.archivedOperationCache.get(operationId);
    if (cached) {
      this._cacheArchivedOperation(cached);
      return cached;
    }
    const filename = leaf('operation', operationId);
    if (!this.ledgerMigrationComplete || this.registry.rootFileStamps.has(filename)) {
      const rootPath = join(this.directory, filename);
      const obs = readState(rootPath, 'admittedOperation');
      if (obs) {
        if (obs.value.state !== 'completed' || this.ledgerMigrationComplete) {
          this._recordOperationInMemory(filename, obs.value, tryFileStamp(rootPath));
        }
        return obs.value;
      }
    }
    const batchDir = this.archivedOperations.get(filename);
    if (batchDir) {
      const archPath = join(this.archiveDirectory, batchDir, filename);
      const obs = readState(archPath, 'admittedOperation');
      if (obs) {
        this._cacheArchivedOperation(obs.value);
        return obs.value;
      }
    }
    return undefined;
  }

  hasPendingForAttachment(attachmentId) {
    this.registry.syncIfExternalChange();
    for (const op of this.activeById.values()) {
      if (op.attachmentId === attachmentId && op.state !== 'completed') return true;
    }
    return false;
  }

  pendingOperationIdsForAttachment(attachmentId) {
    this.registry.syncIfExternalChange();
    const out = [];
    for (const op of this.activeById.values()) {
      if (op.attachmentId === attachmentId && op.state !== 'completed') out.push(op.operationId);
    }
    return out;
  }

  hasPendingCallbacks() {
    this.registry.syncIfExternalChange();
    for (const op of this.activeById.values()) {
      if (op.kind === 'callback' && op.state === 'pending') return true;
    }
    return false;
  }

  inventoryOperations() {
    this.registry.syncIfExternalChange();
    return [...this.activeById.values(), ...this.retainedCompleted.values()];
  }

  begin(token, operationId, kind) {
    return this.registry.withLock(() => {
      this.registry.syncIfExternalChange();
      this.registry.assertOwner(token);
      const gate = readWriterGate(this.registry.lockDirectory);
      const parent = currentExecution()?.operation;
      if (gate && gate !== 'OPEN') {
        if (!parent) throw new Error('store_admission_closed');
        this.assertOperation(parent);
      }
      const filename = leaf('operation', operationId);
      const path = join(this.directory, filename);
      if (readState(path, 'admittedOperation')) throw new Error('operation_exists');
      const value = { schemaVersion: 1, revision: 1, operationId, attachmentId: token.attachmentId,
        ownerGeneration: token.ownerGeneration, executionOwner: token.ownerProcessIdentity, kind, state: 'pending', result: null };
      publishState(path, value, 'admittedOperation');
      this._recordOperationInMemory(filename, value, tryFileStamp(path));
      this.registry.bump();
      return value;
    });
  }

  assertOperation(operation) {
    if (this.registry.indeterminate) throw new Error('reconciliation_required');
    const old = readState(this.path(operation.operationId), 'admittedOperation');
    if (!old || old.value.state !== 'pending' || old.value.attachmentId !== operation.attachmentId ||
        old.value.ownerGeneration !== operation.ownerGeneration || digest(old.value.executionOwner) !== digest(operation.executionOwner) ||
        digest(old.value.executionOwner) !== digest(this.registry.processIdentity)) throw new Error('operation_fenced');
    return old;
  }

  finish(operation, result, unknown = false) {
    return this.registry.withLock(() => {
      this.registry.syncIfExternalChange();
      const opFilename = leaf('operation', operation.operationId);
      const opPath = join(this.directory, opFilename);
      const old = readState(opPath, 'admittedOperation');
      if (!old) {
        const archived = this.getOperation(operation.operationId);
        if (archived && archived.state === 'completed' &&
            archived.attachmentId === operation.attachmentId &&
            digest(archived.executionOwner) === digest(operation.executionOwner)) {
          if (digest(archived.result) !== digest(result)) throw new Error('operation_result_conflict');
          return archived;
        }
        throw new Error('operation_fenced');
      }
      if (digest(old.value.executionOwner) !== digest(operation.executionOwner) || old.value.attachmentId !== operation.attachmentId) {
        throw new Error('operation_fenced');
      }
      if (old.value.state === 'completed') {
        if (digest(old.value.result) !== digest(result)) throw new Error('operation_result_conflict');
        return old.value;
      }
      // The event is durable before completion so a crash cannot lose an owner
      // effect after its drain entry has disappeared. Delivery is reconciled.
      const event = { schemaVersion: 1, operationId: operation.operationId, attachmentId: operation.attachmentId, destination: 'current-owner', result };
      const effectName = leaf('effect', { operationId: operation.operationId, result });
      const eventPath = join(this.directory, effectName);
      const prior = readState(eventPath, 'ownerEffect');
      if (prior && digest(prior.value) !== digest(event)) throw new Error('operation_result_conflict');
      if (!prior && !this.archivedEffects.has(effectName)) {
        publishState(eventPath, event, 'ownerEffect');
        this._recordRootEffect(effectName, event, tryFileStamp(eventPath));
      }
      const next = { ...old.value, revision: old.value.revision + 1, state: unknown ? 'unknown' : 'completed', result };
      replaceState(opPath, next, 'admittedOperation', old);
      this._recordOperationInMemory(opFilename, next, tryFileStamp(opPath));
      this.registry.bump();
      return next;
    });
  }

  operations() {
    this.registry.syncIfExternalChange();
    return [...this.activeById.values(), ...this.retainedCompleted.values()];
  }

  effects(attachmentId) {
    this.registry.syncIfExternalChange();
    return [...(this.effectsByAttachment.get(attachmentId) ?? [])];
  }

  publishEffect(operation, result) {
    return this.registry.withLock(() => {
      this.registry.syncIfExternalChange();
      const saved = this.getOperation(operation.operationId);
      if (!saved || saved.attachmentId !== operation.attachmentId || digest(saved.executionOwner) !== digest(operation.executionOwner)) {
        throw new Error('operation_fenced');
      }
      const event = { schemaVersion: 1, operationId: operation.operationId, attachmentId: operation.attachmentId, destination: 'current-owner', result };
      const effectName = leaf('effect', { operationId: operation.operationId, result });
      if (this.archivedEffects.has(effectName)) {
        return digest(event);
      }
      const path = join(this.directory, effectName);
      if (this.registry.rootFileStamps.has(effectName) || readState(path, 'ownerEffect')) {
        return digest(event);
      }
      publishState(path, event, 'ownerEffect');
      this._recordRootEffect(effectName, event, tryFileStamp(path));
      this.registry.bump();
      return digest(event);
    });
  }

  /** @param {{generation: string, processIdentity: object} | undefined} [scope] */
  drain(scope = undefined) {
    return this.registry.withLock(() => {
      this.registry.syncIfExternalChange();
      const value = { revision: this.registry.revision(), calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 0 };
      if (!this.ledgerMigrationComplete) {
        return { ...value, complete: false };
      }
      const keys = { call: 'calls', child: 'children', brief: 'briefs', callback: 'callbacks', wake: 'effects' };
      for (const op of this.activeById.values()) {
        if (scope && (op.ownerGeneration !== scope.generation || digest(op.executionOwner) !== digest(scope.processIdentity))) continue;
        if (op.state === 'completed') continue;
        value[keys[op.kind]]++;
        if (op.state === 'unknown' && op.kind !== 'wake') value.effects++;
      }
      return { ...value, complete: Object.entries(value).every(([k, v]) => k === 'revision' || v === 0) };
    });
  }

  _readActiveTransactionContext() {
    let activeTx = null;
    try {
      const control = readState(join(this.directory, 'component-control.json'), 'componentControl')?.value;
      if (control?.activeTransaction) {
        const tx = readState(join(this.directory, control.activeTransaction), 'componentTransaction')?.value;
        if (tx && !['ABORTED', 'READY', 'STOPPED'].includes(tx.state)) activeTx = tx;
      }
    } catch { /* ignore absent/uninitialized control */ }
    let writerGate;
    try {
      writerGate = readWriterGate(this.registry.lockDirectory);
    } catch {
      writerGate = undefined;
    }
    return { activeTx, writerGate };
  }

  _inspectCandidateFile(name) {
    const filePath = join(this.directory, name);
    let stat;
    try {
      stat = fs.lstatSync(filePath, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile()) return null;
    const family = classifyFamily(name);
    if (!family) return null;
    let schema = null;
    if (family === 'operations') schema = 'admittedOperation';
    else if (family === 'effects') schema = 'ownerEffect';
    else if (family === 'generationEnds') schema = 'generationEnd';
    else if (family === 'ownerships') schema = 'ownership';
    else if (LAUNCH_MEMO_RE.test(name)) schema = 'launchMemo';
    else if (LAUNCH_LOC_RE.test(name)) schema = 'launchLocation';
    else if (family === 'wakes') schema = 'wakeIntent';
    else if (family === 'checkpoints') {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        schema = raw.emptyAttachments === true ? 'emptyCheckpoint' : 'checkpoint';
      } catch {
        return null;
      }
    }
    let obs;
    try {
      obs = readState(filePath, schema);
    } catch {
      return null;
    }
    if (!obs) return null;
    return {
      name,
      family,
      schema,
      dev: stat.dev,
      ino: stat.ino,
      mtimeNs: stat.mtimeNs,
      stamp: statStamp(stat),
      digest: obs.digest,
      value: obs.value
    };
  }

  _selectArchiveCandidates(inspected) {
    const { activeTx, writerGate } = this._readActiveTransactionContext();
    const activeTxCheckpoints = new Set(activeTx?.checkpointReferences ?? []);
    const activeTxSourceGen = activeTx?.source?.generation ?? null;

    const ownersByAtt = new Map(this.registry.ownersById);
    const operations = [];
    const effects = [];
    const generationEnds = [];
    const ownerships = [];
    const launchMemos = [];
    const launchLocations = new Map();
    const wakes = [];
    const checkpoints = [];

    for (const c of inspected) {
      if (c.family === 'ownerships') {
        ownersByAtt.set(c.value.attachmentId, c.value);
        ownerships.push(c);
      } else if (c.family === 'operations') operations.push(c);
      else if (c.family === 'effects') effects.push(c);
      else if (c.family === 'generationEnds') generationEnds.push(c);
      else if (c.schema === 'launchMemo') launchMemos.push(c);
      else if (c.schema === 'launchLocation') launchLocations.set(c.value.launchId, c);
      else if (c.family === 'wakes') wakes.push(c);
      else if (c.family === 'checkpoints') checkpoints.push(c);
    }

    const referencedGenerations = new Set();
    const referencedCheckpoints = new Set(activeTxCheckpoints);
    for (const owner of ownersByAtt.values()) {
      if (owner.state !== 'CLOSED') {
        referencedGenerations.add(owner.ownerGeneration);
        if (owner.checkpointHash) referencedCheckpoints.add(`checkpoint-${owner.checkpointHash.slice(7)}.json`);
      }
    }

    const pendingOpIds = new Set();
    const pendingAttachments = new Set();
    for (const op of this.activeById.values()) {
      if (op.state !== 'completed') {
        pendingOpIds.add(op.operationId);
        pendingAttachments.add(op.attachmentId);
      }
    }
    for (const c of operations) {
      if (c.value.state !== 'completed') {
        pendingOpIds.add(c.value.operationId);
        pendingAttachments.add(c.value.attachmentId);
      }
    }

    const fifoCompare = (orderMap) => (a, b) => {
      const oa = orderMap.get(a.name);
      const ob = orderMap.get(b.name);
      if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
      const mt = compareBigInt(a.mtimeNs, b.mtimeNs);
      if (mt !== 0) return mt;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    };

    const selected = [];
    const selectedNames = new Set();
    const addCandidate = (c) => {
      if (selectedNames.has(c.name)) return;
      selectedNames.add(c.name);
      selected.push(c);
    };

    // 1. operation-<sha>.json (§3.2)
    const currentGenCompletedOps = [];
    for (const c of operations) {
      if (c.value.state === 'pending' || c.value.state === 'unknown') continue;
      if (c.value.ownerGeneration !== this.registry.generation) {
        if (activeTxSourceGen && c.value.ownerGeneration === activeTxSourceGen) continue;
        addCandidate(c);
      } else {
        const owner = ownersByAtt.get(c.value.attachmentId);
        if (owner && (owner.state === 'FROZEN' || owner.state === 'TRANSFERRING')) continue;
        currentGenCompletedOps.push(c);
      }
    }
    if (currentGenCompletedOps.length > MAX_RETAINED_TERMINAL_PER_FAMILY) {
      currentGenCompletedOps.sort(fifoCompare(this._opOrder));
      const excess = currentGenCompletedOps.length - MAX_RETAINED_TERMINAL_PER_FAMILY;
      for (let i = 0; i < excess; i++) addCandidate(currentGenCompletedOps[i]);
    }

    // 2. effect-<sha>.json (§3.2)
    const activeAttachmentEffects = new Map();
    for (const c of effects) {
      if (pendingOpIds.has(c.value.operationId)) continue;
      const owner = ownersByAtt.get(c.value.attachmentId);
      if (!owner || owner.state === 'CLOSED' ||
          (owner.ownerGeneration !== this.registry.generation && owner.state !== 'TRANSFERRING' && owner.state !== 'FROZEN')) {
        addCandidate(c);
      } else if (owner.state === 'ACTIVE' && writerGate !== 'BARRIER') {
        if (c.value.result?.type === 'launch-delegation') continue; // 100% preserved
        let arr = activeAttachmentEffects.get(c.value.attachmentId);
        if (!arr) { arr = []; activeAttachmentEffects.set(c.value.attachmentId, arr); }
        arr.push(c);
      }
    }
    for (const arr of activeAttachmentEffects.values()) {
      if (arr.length > MAX_EFFECTS_PER_ACTIVE_ATTACHMENT) {
        arr.sort(fifoCompare(this._effectOrder));
        const excess = arr.length - MAX_EFFECTS_PER_ACTIVE_ATTACHMENT;
        for (let i = 0; i < excess; i++) addCandidate(arr[i]);
      }
    }

    // 3. generation-end-<uuid>.json (§3.2)
    const eligibleGenEnds = generationEnds.filter(c => !referencedGenerations.has(c.value.generation));
    if (eligibleGenEnds.length > MAX_RETAINED_TERMINAL_PER_FAMILY) {
      eligibleGenEnds.sort((a, b) => {
        const ea = a.value.endedAt ?? 0;
        const eb = b.value.endedAt ?? 0;
        if (ea !== eb) return ea - eb;
        const mt = compareBigInt(a.mtimeNs, b.mtimeNs);
        if (mt !== 0) return mt;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      const excess = eligibleGenEnds.length - MAX_RETAINED_TERMINAL_PER_FAMILY;
      for (let i = 0; i < excess; i++) addCandidate(eligibleGenEnds[i]);
    }

    // 4. ownership-<sha>.json (§3.2)
    const closedOwners = ownerships.filter(c => c.value.state === 'CLOSED' && !pendingAttachments.has(c.value.attachmentId));
    if (closedOwners.length > MAX_RETAINED_TERMINAL_PER_FAMILY) {
      closedOwners.sort((a, b) => {
        const mt = compareBigInt(a.mtimeNs, b.mtimeNs);
        if (mt !== 0) return mt;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      const excess = closedOwners.length - MAX_RETAINED_TERMINAL_PER_FAMILY;
      for (let i = 0; i < excess; i++) addCandidate(closedOwners[i]);
    }

    // 5. launch-<sha>.json and launch-location-<uuid>.json (§3.2)
    const activeLaunchesByAtt = new Map();
    const seenLaunchIds = new Set();
    for (const c of launchMemos) {
      seenLaunchIds.add(c.value.launchId);
      if (c.value.state !== 'completed') continue;
      const owner = ownersByAtt.get(c.value.attachmentId);
      if (!owner || owner.state === 'CLOSED') {
        addCandidate(c);
        const loc = launchLocations.get(c.value.launchId);
        if (loc) addCandidate(loc);
      } else {
        let arr = activeLaunchesByAtt.get(c.value.attachmentId);
        if (!arr) { arr = []; activeLaunchesByAtt.set(c.value.attachmentId, arr); }
        arr.push(c);
      }
    }
    for (const arr of activeLaunchesByAtt.values()) {
      if (arr.length > MAX_RETAINED_TERMINAL_PER_FAMILY) {
        arr.sort((a, b) => {
          const mt = compareBigInt(a.mtimeNs, b.mtimeNs);
          if (mt !== 0) return mt;
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        const excess = arr.length - MAX_RETAINED_TERMINAL_PER_FAMILY;
        for (let i = 0; i < excess; i++) {
          addCandidate(arr[i]);
          const loc = launchLocations.get(arr[i].value.launchId);
          if (loc) addCandidate(loc);
        }
      }
    }
    for (const [launchId, loc] of launchLocations.entries()) {
      if (seenLaunchIds.has(launchId)) continue;
      const owner = ownersByAtt.get(loc.value.attachmentId);
      if (!owner || owner.state === 'CLOSED') addCandidate(loc);
    }

    // 6. wake-<sha>.json (§3.2)
    const activeWakesByAtt = new Map();
    for (const c of wakes) {
      if (c.value.state === 'intent' || c.value.state === 'unknown') continue;
      const owner = ownersByAtt.get(c.value.attachmentId);
      if (!owner || owner.state === 'CLOSED') {
        addCandidate(c);
      } else {
        let arr = activeWakesByAtt.get(c.value.attachmentId);
        if (!arr) { arr = []; activeWakesByAtt.set(c.value.attachmentId, arr); }
        arr.push(c);
      }
    }
    for (const arr of activeWakesByAtt.values()) {
      if (arr.length > MAX_RETAINED_TERMINAL_PER_FAMILY) {
        arr.sort((a, b) => {
          const mt = compareBigInt(a.mtimeNs, b.mtimeNs);
          if (mt !== 0) return mt;
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        const excess = arr.length - MAX_RETAINED_TERMINAL_PER_FAMILY;
        for (let i = 0; i < excess; i++) addCandidate(arr[i]);
      }
    }

    // 7. checkpoint-<sha>.json (§3.2)
    const eligibleCheckpoints = checkpoints.filter(c => !referencedCheckpoints.has(c.name));
    if (eligibleCheckpoints.length > MAX_RETAINED_TERMINAL_PER_FAMILY) {
      eligibleCheckpoints.sort((a, b) => {
        const mt = compareBigInt(a.mtimeNs, b.mtimeNs);
        if (mt !== 0) return mt;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      const excess = eligibleCheckpoints.length - MAX_RETAINED_TERMINAL_PER_FAMILY;
      for (let i = 0; i < excess; i++) addCandidate(eligibleCheckpoints[i]);
    }

    return selected;
  }

  _commitArchiveSubLot(subLot, reason, batchName) {
    const moved = {
      operations: [],
      effects: [],
      generationEnds: [],
      ownerships: [],
      launches: [],
      wakes: [],
      checkpoints: []
    };
    if (subLot.length === 0) return moved;

    fs.mkdirSync(this.archiveDirectory, { recursive: true, mode: 0o700 });
    const batchPath = join(this.archiveDirectory, batchName);
    fs.mkdirSync(batchPath, { recursive: true, mode: 0o700 });

    let movedCount = 0;
    this.registry.withLock(() => {
      this.registry.syncIfExternalChange();
      // 1. Revalidate (dev, ino) & eligibility under lock, then renameSync each validated file.
      for (const cand of subLot) {
        const srcPath = join(this.directory, cand.name);
        let stat;
        try {
          stat = fs.lstatSync(srcPath, { bigint: true });
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        if (stat.dev !== cand.dev || stat.ino !== cand.ino) {
          // Concurrent replaceState or deletion — skip immediately (B-02).
          continue;
        }
        if (cand.family === 'operations' && this.activeById.has(cand.value.operationId)) continue;
        if (cand.family === 'effects' && this.activeById.has(cand.value.operationId)) continue;
        if (cand.family === 'ownerships' && this.hasPendingForAttachment(cand.value.attachmentId)) continue;

        const dstPath = join(batchPath, cand.name);
        fs.renameSync(srcPath, dstPath);
        movedCount++;
        if (cand.family === 'generationEnds') {
          moved.generationEnds.push(cand.value.generation);
          this.archivedGenerationEnds.set(cand.value.generation, batchName);
        } else {
          moved[cand.family].push(cand.name);
          if (cand.family === 'operations') this.archivedOperations.set(cand.name, batchName);
          else if (cand.family === 'effects') this.archivedEffects.set(cand.name, batchName);
        }
        this.registry._evictRootFile(cand.name);
      }

      if (movedCount === 0) return;

      // 2. fsyncSync(batchDirFd) then fsyncSync(stateDirFd)
      fsyncDirectory(batchPath);
      fsyncDirectory(this.directory);

      // 3. Append canonical manifest line + fsyncSync(manifestFd)
      const record = {
        archivedAt: new Date().toISOString(),
        reason,
        generation: this.registry.generation,
        batchDir: batchName,
        ...moved
      };
      const line = Buffer.concat([canonicalBytes(record), Buffer.from('\n')]);
      const mfd = fs.openSync(this.manifestPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
      try {
        fs.writeFileSync(mfd, line);
        fs.fsyncSync(mfd);
      } finally {
        fs.closeSync(mfd);
      }
      const mStat = fs.lstatSync(this.manifestPath, { bigint: true });
      this.manifestReadOffset = Number(mStat.size);
      this.manifestDev = mStat.dev;
      this.manifestIno = mStat.ino;
      this.lastManifestStamp = statStamp(mStat);

      // 4. Bump participant-revision.json
      this.registry.bump();
    });

    return moved;
  }

  compactBatch(options = {}) {
    const dryRun = Boolean(options.dryRun);
    const reason = options.reason ?? 'compact';
    let names;
    try {
      names = fs.readdirSync(this.directory).filter(n => n.endsWith('.json') && classifyFamily(n) !== null);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          dryRun,
          archived: { operations: 0, effects: 0, generationEnds: 0, ownerships: 0, launches: 0, wakes: 0, checkpoints: 0 },
          totalArchived: 0
        };
      }
      throw error;
    }

    const inspected = [];
    for (const name of names) {
      const c = this._inspectCandidateFile(name);
      if (c) inspected.push(c);
    }
    const candidates = this._selectArchiveCandidates(inspected);
    const counts = { operations: 0, effects: 0, generationEnds: 0, ownerships: 0, launches: 0, wakes: 0, checkpoints: 0 };

    if (dryRun) {
      for (const c of candidates) counts[c.family]++;
      const totalArchived = Object.values(counts).reduce((a, b) => a + b, 0);
      return { dryRun: true, archived: counts, totalArchived };
    }

    const batchName = utcBatchDirName();
    for (let i = 0; i < candidates.length; i += MIGRATION_COMMIT_BATCH_SIZE) {
      const subLot = candidates.slice(i, i + MIGRATION_COMMIT_BATCH_SIZE);
      const moved = this._commitArchiveSubLot(subLot, reason, batchName);
      for (const k of Object.keys(counts)) counts[k] += moved[k].length;
    }
    const totalArchived = Object.values(counts).reduce((a, b) => a + b, 0);
    return { dryRun: false, archived: counts, totalArchived };
  }

  _scheduleBackgroundMigration(pendingNames) {
    let scanIndex = 0;
    const inspected = [];
    let archiveQueue = null;
    let commitIndex = 0;
    const batchName = utcBatchDirName();

    const step = () => {
      this._migrationTimer = null;
      if (this._migrationStopped) return;

      try {
        // Phase 1: outside-lock inspection in slices of <= 100 files and <= 8 ms
        if (scanIndex < pendingNames.length) {
          const sliceStart = performance.now();
          let processed = 0;
          while (scanIndex < pendingNames.length && processed < MIGRATION_SCAN_BATCH_SIZE) {
            const name = pendingNames[scanIndex++];
            const c = this._inspectCandidateFile(name);
            if (c) {
              inspected.push(c);
              if (c.family === 'operations' && c.value.state !== 'completed') {
                // Insert pending/unknown immediately unless a newer revision is already in memory.
                const existing = this.activeById.get(c.value.operationId);
                if (!existing || c.value.revision > existing.revision) {
                  this._recordOperationInMemory(c.name, c.value, c.stamp);
                }
              }
            }
            processed++;
            if (performance.now() - sliceStart >= MIGRATION_MAX_SLICE_MS) break;
          }
          if (!this._migrationStopped) {
            this._migrationTimer = setImmediate(step);
          }
          return;
        }

        // Transition: select archive candidates once inspection completes
        if (archiveQueue === null) {
          archiveQueue = this._selectArchiveCandidates(inspected);
          // Hydrate retained root operations & effects into memory so active/retained indexes are complete.
          const selectedNames = new Set(archiveQueue.map(c => c.name));
          for (const c of inspected) {
            if (selectedNames.has(c.name)) continue;
            if (c.family === 'operations') {
              const existing = this.activeById.get(c.value.operationId) ?? this.retainedCompleted.get(c.value.operationId);
              if (!existing || c.value.revision >= existing.revision) {
                this._recordOperationInMemory(c.name, c.value, c.stamp);
              }
            } else if (c.family === 'effects') {
              if (!this._effectFileToMeta.has(c.name)) {
                this._recordRootEffect(c.name, c.value, c.stamp);
              }
            }
          }
        }

        // Phase 2: commit archive sub-lots of <= 32 files under lock, yielding between sub-lots
        if (commitIndex < archiveQueue.length) {
          const subLot = archiveQueue.slice(commitIndex, commitIndex + MIGRATION_COMMIT_BATCH_SIZE);
          commitIndex += subLot.length;
          this._commitArchiveSubLot(subLot, 'startup-migration', batchName);
          if (!this._migrationStopped) {
            this._migrationTimer = setImmediate(step);
          }
          return;
        }

        // Finalize: sync root stamps and flip ledgerMigrationComplete = true
        this.registry.lastRevisionStamp = null;
        this.ledgerMigrationComplete = true;
        this.registry.syncIfExternalChange();
      } catch (error) {
        if (this._migrationStopped || error.code === 'ENOENT') return;
        // Re-try or surface safely without crashing an active daemon if transient.
        this.ledgerMigrationComplete = true;
      }
    };

    this._migrationTimer = setImmediate(step);
  }

  restoreArchive() {
    let batches;
    try {
      batches = fs.readdirSync(this.archiveDirectory).filter(d => d.startsWith('batch-')).sort();
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { restored: 0, skippedIdentical: 0, conflictCount: 0, conflicts: [] };
      }
      throw error;
    }

    const items = [];
    for (const batchName of batches) {
      const batchPath = join(this.archiveDirectory, batchName);
      let files;
      try {
        files = fs.readdirSync(batchPath).filter(f => f.endsWith('.json')).sort();
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const fileName of files) {
        items.push({ batchName, batchPath, fileName, srcPath: join(batchPath, fileName) });
      }
    }

    let restored = 0;
    let skippedIdentical = 0;
    const conflicts = [];

    for (let i = 0; i < items.length; i += MIGRATION_COMMIT_BATCH_SIZE) {
      const subLot = items.slice(i, i + MIGRATION_COMMIT_BATCH_SIZE);
      this.registry.withLock(() => {
        this.registry.syncIfExternalChange();
        const moved = {
          operations: [],
          effects: [],
          generationEnds: [],
          ownerships: [],
          launches: [],
          wakes: [],
          checkpoints: []
        };
        const touchedBatches = new Set();
        let movedCount = 0;

        for (const item of subLot) {
          let srcStat;
          try {
            srcStat = fs.lstatSync(item.srcPath);
          } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
          }
          if (!srcStat.isFile()) continue;
          const dstPath = join(this.directory, item.fileName);
          let dstExists = false;
          try {
            fs.lstatSync(dstPath);
            dstExists = true;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }

          if (!dstExists) {
            fs.renameSync(item.srcPath, dstPath);
            restored++;
            movedCount++;
            touchedBatches.add(item.batchPath);
            const family = classifyFamily(item.fileName);
            if (family === 'generationEnds') {
              const m = GEN_END_RE.exec(item.fileName);
              const gen = m ? m[1] : item.fileName;
              moved.generationEnds.push(gen);
              this.archivedGenerationEnds.delete(gen);
            } else if (family) {
              moved[family].push(item.fileName);
              if (family === 'operations') this.archivedOperations.delete(item.fileName);
              else if (family === 'effects') this.archivedEffects.delete(item.fileName);
            }
          } else {
            const srcDigest = digest(JSON.parse(fs.readFileSync(item.srcPath, 'utf8')));
            const dstDigest = digest(JSON.parse(fs.readFileSync(dstPath, 'utf8')));
            if (srcDigest === dstDigest) {
              skippedIdentical++;
            } else {
              conflicts.push(item.fileName);
            }
          }
        }

        if (movedCount > 0) {
          fsyncDirectory(this.directory);
          for (const bp of touchedBatches) fsyncDirectory(bp);

          const record = {
            archivedAt: new Date().toISOString(),
            reason: 'restore',
            generation: this.registry.generation,
            batchDir: null,
            ...moved
          };
          const line = Buffer.concat([canonicalBytes(record), Buffer.from('\n')]);
          const mfd = fs.openSync(this.manifestPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
          try {
            fs.writeFileSync(mfd, line);
            fs.fsyncSync(mfd);
          } finally {
            fs.closeSync(mfd);
          }
          const mStat = fs.lstatSync(this.manifestPath, { bigint: true });
          this.manifestReadOffset = Number(mStat.size);
          this.manifestDev = mStat.dev;
          this.manifestIno = mStat.ino;
          this.lastManifestStamp = statStamp(mStat);
          this.archivedOperationCache.clear();
          this.registry.bump();
        }
      });
    }

    if (restored > 0) {
      this.registry.lastRevisionStamp = null;
      this.registry.syncIfExternalChange();
    }

    return {
      restored,
      skippedIdentical,
      conflictCount: conflicts.length,
      conflicts
    };
  }
}
