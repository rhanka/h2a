import fs from 'node:fs';
import { join } from 'node:path';
import { digest } from './wire.js';
import { validate, safeRelative } from './formats.js';
import { privateDirectory, readState, publishState, replaceState } from './state.js';
import { mutationLock, readWriterGate, currentExecution } from './mutation.js';

const leaf = (kind, id) => `${kind}-${digest(id).slice(7)}.json`;

export class OwnershipRegistry {
  constructor(options) {
    this.directory = options.directory;
    this.generation = options.generation;
    this.processIdentity = options.processIdentity;
    this.lockDirectory = options.lockDirectory ?? this.directory;
    this.indeterminate = false;
    this.onIndeterminate = undefined;
    privateDirectory(this.directory);
    this.revisionPath = join(this.directory, 'participant-revision.json');
    this.withLock(() => {
      if (!readState(this.revisionPath, 'participantRevision')) publishState(this.revisionPath, { schemaVersion: 1, revision: 1 }, 'participantRevision');
    });
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
      const fd = fs.openSync(this.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.indeterminate = false;
    });
  }
  bump() {
    const old = readState(this.revisionPath, 'participantRevision');
    replaceState(this.revisionPath, { ...old.value, revision: old.value.revision + 1 }, 'participantRevision', old);
  }
  revision() { return readState(this.revisionPath, 'participantRevision').value.revision; }
  ownerPath(id) { return join(this.directory, leaf('ownership', id)); }
  owners() {
    return fs.readdirSync(this.directory).filter(p => p.startsWith('ownership-')).map(p => readState(join(this.directory, p), 'ownership').value);
  }
  claim(input) {
    return this.withLock(() => {
      if (readState(this.ownerPath(input.attachmentId), 'ownership')) throw new Error('ownership_exists');
      const value = { schemaVersion: 1, ...input, ownerGeneration: this.generation, ownershipEpoch: 1,
        ownerProcessIdentity: this.processIdentity, state: 'ACTIVE', handoverId: null, checkpointVersion: 1, checkpointHash: null };
      publishState(this.ownerPath(input.attachmentId), value, 'ownership'); this.bump();
      return this.token(value);
    });
  }
  token(value) {
    return Object.freeze({ attachmentId: value.attachmentId, ownerGeneration: value.ownerGeneration,
      ownershipEpoch: value.ownershipEpoch, ownerProcessIdentity: value.ownerProcessIdentity });
  }
  rebaseline(input, proveEnded) {
    return this.withLock(() => {
      const path = this.ownerPath(input.attachmentId), old = readState(path, 'ownership');
      if (!old || old.value.ownerGeneration === this.generation || !proveEnded(old.value)) throw new Error('ownership_exists');
      const value = { ...old.value, ...input, ownerGeneration: this.generation, ownershipEpoch: old.value.ownershipEpoch + 1,
        ownerProcessIdentity: this.processIdentity, state: 'ACTIVE', handoverId: null, checkpointVersion: 1, checkpointHash: null };
      replaceState(path, value, 'ownership', old); this.bump(); return this.token(value);
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
      const old = this.assertOwner(token);
      if (old.value.presenceSessionId === presenceSessionId && old.value.expectedInstance === expectedInstance) return;
      replaceState(this.ownerPath(token.attachmentId), { ...old.value, presenceSessionId, expectedInstance }, 'ownership', old); this.bump();
    });
  }
  releasePresence(token, sessionId) {
    return this.withLock(() => {
      const old = this.assertOwner(token);
      if (old.value.presenceSessionId !== sessionId) throw new Error('presence_ownership_mismatch');
      replaceState(this.ownerPath(token.attachmentId), { ...old.value, presenceSessionId: `pending:${token.attachmentId}` }, 'ownership', old); this.bump();
    });
  }
  freeze(token, handoverId) {
    return this.withLock(() => {
      const old = this.assertOwner(token, ['ACTIVE', 'FROZEN']);
      if (old.value.state === 'FROZEN') {
        if (old.value.handoverId !== handoverId) throw new Error('handover_conflict');
        return old.value;
      }
      const next = { ...old.value, state: 'FROZEN', handoverId };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old); this.bump(); return next;
    });
  }
  checkpoint(token, snapshot) {
    return this.withLock(() => {
      const old = this.assertOwner(token, ['FROZEN']);
      validate('checkpoint', snapshot);
      if (snapshot.attachmentId !== token.attachmentId || snapshot.ownershipEpoch !== token.ownershipEpoch || snapshot.deliveredSequence > snapshot.producedSequence) throw new Error('checkpoint_binding_mismatch');
      const hash = digest(snapshot), reference = `checkpoint-${hash.slice(7)}.json`;
      if (old.value.checkpointHash && old.value.checkpointHash !== hash) throw new Error('checkpoint_conflict');
      const path = join(this.directory, reference), existing = readState(path, 'checkpoint');
      if (existing && digest(existing.value) !== hash) throw new Error('checkpoint_corrupt');
      if (!existing) publishState(path, snapshot, 'checkpoint');
      if (!old.value.checkpointHash) {
        replaceState(this.ownerPath(token.attachmentId), { ...old.value, checkpointHash: hash }, 'ownership', old); this.bump();
      }
      return { reference, checkpointHash: hash, checkpointVersion: 1, source: this.token(old.value), handoverId: old.value.handoverId };
    });
  }
  loadCheckpoint(reference, hash) {
    if (!safeRelative(reference) || reference !== `checkpoint-${hash.slice(7)}.json`) throw new Error('checkpoint_reference_invalid');
    const value = readState(join(this.directory, reference), 'checkpoint')?.value;
    if (!value || digest(value) !== hash) throw new Error('checkpoint_corrupt'); return value;
  }
  abort(token, handoverId) {
    return this.withLock(() => {
      const old = this.assertOwner(token, ['FROZEN']);
      if (old.value.handoverId !== handoverId) throw new Error('handover_conflict');
      replaceState(this.ownerPath(token.attachmentId), { ...old.value, state: 'ACTIVE', handoverId: null, checkpointHash: null }, 'ownership', old); this.bump();
    });
  }
  close(token) {
    return this.withLock(() => {
      const old = this.assertOwner(token, ['ACTIVE', 'FROZEN', 'TRANSFERRING']);
      replaceState(this.ownerPath(token.attachmentId), { ...old.value, state: 'CLOSED' }, 'ownership', old); this.bump();
    });
  }
  fence(token, handoverId, checkpointHash) {
    return this.withLock(() => {
      const old = this.assertOwner(token, ['FROZEN', 'TRANSFERRING']);
      if (old.value.handoverId !== handoverId || !checkpointHash || old.value.checkpointHash !== checkpointHash) throw new Error('checkpoint_binding_mismatch');
      this.loadCheckpoint(`checkpoint-${checkpointHash.slice(7)}.json`, checkpointHash);
      if (old.value.state === 'TRANSFERRING') return old.value;
      const next = { ...old.value, state: 'TRANSFERRING' };
      replaceState(this.ownerPath(token.attachmentId), next, 'ownership', old); this.bump(); return next;
    });
  }
}

export class OperationLedger {
  constructor(registry) { this.registry = registry; this.directory = registry.directory; }
  path(id) { return join(this.directory, leaf('operation', id)); }
  begin(token, operationId, kind) {
    return this.registry.withLock(() => {
      this.registry.assertOwner(token);
      const gate = readWriterGate(this.registry.lockDirectory);
      const parent = currentExecution()?.operation;
      if (gate && gate !== 'OPEN') {
        if (!parent) throw new Error('store_admission_closed');
        this.assertOperation(parent);
      }
      const path = this.path(operationId);
      if (readState(path, 'admittedOperation')) throw new Error('operation_exists');
      const value = { schemaVersion: 1, revision: 1, operationId, attachmentId: token.attachmentId,
        ownerGeneration: token.ownerGeneration, executionOwner: token.ownerProcessIdentity, kind, state: 'pending', result: null };
      publishState(path, value, 'admittedOperation'); this.registry.bump(); return value;
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
      const old = readState(this.path(operation.operationId), 'admittedOperation');
      if (!old || digest(old.value.executionOwner) !== digest(operation.executionOwner) || old.value.attachmentId !== operation.attachmentId) throw new Error('operation_fenced');
      if (old.value.state === 'completed') {
        if (digest(old.value.result) !== digest(result)) throw new Error('operation_result_conflict');
        return old.value;
      }
      // The event is durable before completion so a crash cannot lose an owner
      // effect after its drain entry has disappeared. Delivery is reconciled.
      const event = { schemaVersion: 1, operationId: operation.operationId, attachmentId: operation.attachmentId, destination: 'current-owner', result };
      const eventPath = join(this.directory, leaf('effect', { operationId: operation.operationId, result }));
      const prior = readState(eventPath, 'ownerEffect');
      if (prior && digest(prior.value) !== digest(event)) throw new Error('operation_result_conflict');
      if (!prior) publishState(eventPath, event, 'ownerEffect');
      const next = { ...old.value, revision: old.value.revision + 1, state: unknown ? 'unknown' : 'completed', result };
      replaceState(this.path(operation.operationId), next, 'admittedOperation', old); this.registry.bump(); return next;
    });
  }
  operations() { return fs.readdirSync(this.directory).filter(p => p.startsWith('operation-')).map(p => readState(join(this.directory, p), 'admittedOperation').value); }
  effects(attachmentId) { return fs.readdirSync(this.directory).filter(p => p.startsWith('effect-')).map(p => readState(join(this.directory, p), 'ownerEffect').value).filter(v => v.attachmentId === attachmentId); }
  publishEffect(operation, result) {
    return this.registry.withLock(() => {
      const saved = readState(this.path(operation.operationId), 'admittedOperation')?.value;
      if (!saved || saved.attachmentId !== operation.attachmentId || digest(saved.executionOwner) !== digest(operation.executionOwner)) throw new Error('operation_fenced');
      const event = { schemaVersion: 1, operationId: operation.operationId, attachmentId: operation.attachmentId, destination: 'current-owner', result };
      const path = join(this.directory, leaf('effect', { operationId: operation.operationId, result }));
      if (!readState(path, 'ownerEffect')) { publishState(path, event, 'ownerEffect'); this.registry.bump(); }
      return digest(event);
    });
  }
  /** @param {{generation: string, processIdentity: object} | undefined} [scope] */
  drain(scope = undefined) {
    return this.registry.withLock(() => {
      const value = { revision: this.registry.revision(), calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 0 };
      const keys = { call: 'calls', child: 'children', brief: 'briefs', callback: 'callbacks', wake: 'effects' };
      for (const op of this.operations()) {
        if (scope && (op.ownerGeneration !== scope.generation || digest(op.executionOwner) !== digest(scope.processIdentity))) continue;
        if (op.state === 'completed') continue;
        value[keys[op.kind]]++;
        if (op.state === 'unknown' && op.kind !== 'wake') value.effects++;
      }
      return { ...value, complete: Object.entries(value).every(([k,v]) => k === 'revision' || v === 0) };
    });
  }
}
