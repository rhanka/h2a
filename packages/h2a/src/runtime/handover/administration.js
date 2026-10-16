import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { digest } from './wire.js';
import { validate } from './formats.js';
import { privateDirectory, publishState, readState, replaceState } from './state.js';

const irrevocable = new Set(['PUBLISHED', 'RETIRED', 'STOP_COMMITTED', 'STOPPED', 'STARTING', 'READY', 'SUCCESSOR_FAILED']);
const blocked = new Set(['BARRIER', 'FROZEN', 'DRAINING', 'DRAIN_BLOCKED', 'RECOVERY_BLOCKED', ...irrevocable]);
const primitives = ['describe', 'inventory', 'reserve', 'barrier', 'renew', 'freeze', 'checkpoint', 'drain-status', 'abort', 'retire', 'commit-stop', 'stop-status'];
const sourceFields = ['generation', 'publicationEpoch', 'processIdentity', 'packageVersion', 'buildId', 'manifestDigest'];

// All mutation methods are synchronous: one Node turn serializes admissions,
// expiration, pause and stop. Filesystem methods still require external
// preclaim for writers outside the generation (starters/controllers).
export class ColdAdministration {
  constructor(options) {
    this.options = options; this.marker = options.marker; this.directory = options.directory;
    privateDirectory(this.directory); this.now = options.now ?? Date.now;
    this.controlPath = join(this.directory, 'component-control.json');
    this.pausePath = join(this.directory, 'operator-stop.json'); this.indeterminate = false;
    this.closeRequested = false;
    const control = readState(this.controlPath, 'componentControl');
    if (!control) publishState(this.controlPath, { schemaVersion: 1, revision: 1, activeTransaction: null,
      sourceGeneration: this.marker.generation, ownerIdentity: this.marker.processIdentity, ownerState: 'ACTIVE',
      transactionEpoch: 0, operatorStopCommitted: false, operatorStopped: false }, 'componentControl');
  }
  control() { return readState(this.controlPath, 'componentControl'); }
  transaction() {
    const control = this.control();
    return control.value.activeTransaction ? readState(join(this.directory, control.value.activeTransaction), 'componentTransaction') : undefined;
  }
  pause() { return readState(this.pausePath, 'pause')?.value.paused ?? false; }
  status() {
    const tx = this.transaction()?.value;
    return { state: tx?.state ?? (this.control().value.operatorStopCommitted ? 'STOP_COMMITTED' : 'READY'),
      generation: this.marker.generation, paused: this.pause(), transaction: tx ?? null,
      activation: tx?.state === 'SUCCESSOR_FAILED' ? 'failed' : 'pending',
      reason: tx?.state === 'SUCCESSOR_FAILED' ? 'successor_failed' : null };
  }
  admissionsOpen() {
    if (this.indeterminate || this.pause()) return false;
    const c = this.control().value;
    if (c.sourceGeneration !== this.marker.generation || c.ownerState !== 'ACTIVE' || c.operatorStopCommitted) return false;
    const tx = this.transaction()?.value;
    if (tx?.state === 'READY' && tx.source.generation !== this.marker.generation) return true;
    return !blocked.has(tx?.state);
  }
  persist(path, value, schema, observed) {
    try { return observed ? replaceState(path, value, schema, observed) : publishState(path, value, schema); }
    catch (error) { if (error.message.startsWith('persistence_indeterminate')) this.indeterminate = true; throw error; }
  }
  requestClose() {
    if (this.closeRequested) return;
    this.closeRequested = true; this.options.close();
  }
  reconcile() {
    const control = this.control(), transaction = this.transaction();
    this.options.verifyAuthority?.('reconcile', transaction?.value);
    this.pause();
    for (const path of [this.controlPath, ...(control.value.activeTransaction ? [join(this.directory, control.value.activeTransaction)] : [])]) {
      const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const directory = fs.openSync(this.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    this.indeterminate = false;
    this.options.reconcileParticipants?.(transaction?.value);
    if (transaction?.value.mode === 'live-transfer' && transaction.value.state === 'PUBLISHED') this.options.liveSource.fence(transaction.value);
    if (transaction?.value.state === 'RETIRED') this.requestClose();
    if (transaction?.value.state === 'STOP_COMMITTED' || control.value.operatorStopCommitted) this.requestClose();
    return this.status();
  }
  update(observed, changes, step, result) {
    const value = { ...observed.value, ...changes, revision: observed.value.revision + 1 };
    if (step) value.stepResults = { ...value.stepResults, [step.stepId]: { payloadDigest: step.payloadDigest, result } };
    this.persist(join(this.directory, this.control().value.activeTransaction), value, 'componentTransaction', observed);
    return result;
  }
  drain() {
    const drain = this.options.drain();
    const keys = ['calls', 'children', 'briefs', 'callbacks', 'effects'];
    if (!Number.isSafeInteger(drain.revision) || keys.some(k => !Number.isSafeInteger(drain[k]) || drain[k] < 0)) throw new Error('drain_unknown');
    return { ...drain, complete: keys.every(k => drain[k] === 0) };
  }
  execute(operation, step, payload, coordinator) {
    const fn = () => {
      try { return this.executeStep(operation, step, payload, coordinator); }
      catch (error) { if (error.message.startsWith('persistence_indeterminate')) this.indeterminate = true; throw error; }
    };
    return this.options.withMutationLock ? this.options.withMutationLock(fn) : fn();
  }
  executeStep(operation, step, payload, coordinator) {
    validate('administration', step);
    if (!primitives.includes(operation)) throw new Error('administration_unknown');
    if (step.payloadDigest !== digest(payload)) throw new Error('payload_digest_mismatch');
    step = { ...step, payloadDigest: digest({ operation, step, payload, coordinator }) };
    const m = this.marker;
    if (step.expectedGeneration !== m.generation || digest(step.expectedPublicationEpoch) !== digest(m.publicationEpoch)) throw new Error('source_authority_mismatch');
    if (this.indeterminate) throw new Error('reconciliation_required');
    let observed = this.transaction();
    const tx = observed?.value;
    this.options.verifyAuthority?.(operation, tx);
    this.options.reconcileParticipants?.(tx);
    if (tx && operation !== 'reserve') {
      if (step.upgradeId !== tx.upgradeId || step.handoverId !== tx.handoverId || step.transactionEpoch !== tx.transactionEpoch ||
        step.mode !== tx.mode || digest(coordinator) !== digest(tx.coordinator)) throw new Error('transaction_authority_mismatch');
      const prior = tx.stepResults[step.stepId];
      if (prior) {
        if (prior.payloadDigest !== step.payloadDigest) throw new Error('step_conflict');
        if (operation === 'retire' && prior.result?.state === 'PUBLISHED') {
          if (tx.state === 'RETIRED') return Object.values(tx.stepResults).map(s => s.result)
            .find(r => r?.state === 'RETIRED' && r.publicationDigest === prior.result.publicationDigest);
        } else return prior.result;
      }
    }
    const observation = (result, changes = {}) => observed ? this.update(observed, changes, step, result) : result;
    if (operation === 'describe') return observation({ protocolVersion: 1, liveCoordinator: false,
      primitives: primitives.filter(p => p === 'retire' ? Boolean(this.options.liveSource) : !['freeze', 'checkpoint'].includes(p) || Boolean(this.options[p])),
      generation: m.generation, state: tx?.state ?? 'READY', paused: this.pause() });
    if (operation === 'inventory') return observation(this.options.inventory());
    if (operation === 'stop-status') return observation({ state: this.status().state, paused: this.pause(), generation: m.generation });
    if (operation === 'drain-status') return observation(this.drain(), tx?.mode === 'cold-stop' && ['BARRIER', 'FROZEN'].includes(tx?.state) ? { state: 'DRAINING' } : {});
    if (operation === 'reserve') {
      if (this.pause()) throw new Error('deferred_paused');
      const control = this.control();
      if (tx && step.handoverId === tx.handoverId) {
        const prior = tx.stepResults[step.stepId];
        if (step.mode !== tx.mode || step.upgradeId !== tx.upgradeId || step.transactionEpoch !== tx.transactionEpoch ||
          digest(coordinator) !== digest(tx.coordinator) || !prior || prior.payloadDigest !== step.payloadDigest) throw new Error('step_conflict');
        return prior.result;
      }
      if (tx && tx.state !== 'ABORTED' && !(tx.state === 'READY' && tx.source.generation !== m.generation)) throw new Error('transaction_reserved');
      if (step.transactionEpoch <= control.value.transactionEpoch) throw new Error('transaction_epoch_stale');
      if (!['cold-stop', 'live-transfer'].includes(step.mode)) throw new Error('live_coordinator_unavailable');
      if (step.mode === 'live-transfer' && !this.options.liveSource) throw new Error('live_authorization_unavailable');
      const inventory = this.options.inventory();
      this.options.assertEligible?.();
      if (step.inventoryRevision !== inventory.revision) throw new Error('inventory_stale');
      if (inventory.transports?.length && inventory.writerRestrictions?.includes('participant_checkpoint_unqualified')) throw new Error('participant_checkpoint_unqualified');
      if (!Number.isSafeInteger(payload.selectionEpoch) || payload.selectionEpoch < 1) throw new Error('selection_epoch_invalid');
      // Exact image/selection and an isolated ready trial are mandatory contracts.
      if (!this.options.authorizeTarget || !this.options.verifyPrecheck) throw new Error('cold_precheck_unavailable');
      this.options.authorizeTarget(payload.target, payload.selectionEpoch);
      this.options.verifyEntry?.('prepare');
      this.options.verifyPrecheck(payload.precheckEvidenceDigest, payload.target);
      const authorizationDigest = step.mode === 'live-transfer' ? this.options.liveSource.reserve(step, payload, coordinator) : null;
      const state = step.mode === 'live-transfer' ? 'RESERVED' : 'PRECHECKED';
      const result = { state, handoverId: step.handoverId, ...(authorizationDigest ? { authorizationDigest } : {}) };
      const value = { schemaVersion: 1, revision: 1, component: 'mcp', upgradeId: step.upgradeId,
        handoverId: step.handoverId, transactionEpoch: step.transactionEpoch, mode: step.mode,
        source: Object.fromEntries(sourceFields.map(k => [k, m[k]])), target: payload.target, coordinator,
        controllerEpoch: payload.controllerEpoch ?? 1, inventoryRevision: step.inventoryRevision, state,
        barrierDeadline: null, precheckEvidenceDigest: payload.precheckEvidenceDigest,
        checkpointReferences: [], stepResults: { [step.stepId]: { payloadDigest: step.payloadDigest, result } },
        successorReservation: { attempts: 0, candidateIdentity: null, selectionEpoch: payload.selectionEpoch,
          targetManifestDigest: payload.target.manifestDigest } };
      const ref = `transaction-${digest(step.handoverId).slice(7)}.json`;
      const prior = readState(join(this.directory, ref), 'componentTransaction');
      if (prior) { if (digest(prior.value) !== digest(value)) throw new Error('transaction_conflict'); }
      else this.persist(join(this.directory, ref), value, 'componentTransaction');
      const pinDirectory = this.options.pinDirectory ?? this.directory;
      fs.mkdirSync(pinDirectory, { recursive: true, mode: 0o700 }); privateDirectory(pinDirectory);
      const pinPath = join(pinDirectory, `mcp-${digest({ namespaceId: m.namespaceId, handoverId: step.handoverId }).slice(7)}.json`);
      const pins = { schemaVersion: 1, upgradeId: step.upgradeId, handoverId: step.handoverId,
        sourceManifestDigest: m.manifestDigest, targetManifestDigest: value.target.manifestDigest };
      const pin = readState(pinPath, 'imagePin');
      if (pin && digest(pin.value) !== digest(pins)) throw new Error('pin_conflict');
      if (!pin) this.persist(pinPath, pins, 'imagePin');
      this.persist(this.controlPath, { ...control.value, revision: control.value.revision + 1,
        activeTransaction: ref, transactionEpoch: step.transactionEpoch }, 'componentControl', control);
      return result;
    }
    if (!tx) throw new Error('transaction_missing');
    if (operation === 'retire' && tx.mode === 'live-transfer') {
      if (!this.options.liveSource) throw new Error('live_authorization_unavailable');
      if (!['FROZEN', 'RECOVERY_BLOCKED', 'PUBLISHED'].includes(tx.state)) throw new Error('live_publication_required');
      if (step.inventoryRevision !== tx.inventoryRevision || this.options.inventory().revision !== tx.inventoryRevision) throw new Error('inventory_stale');
      if (tx.state !== 'PUBLISHED') {
        if (tx.barrierDeadline <= this.now()) throw new Error('barrier_expired');
        const publication = this.options.liveSource.publication(tx, payload.publicationDigest);
        const result = { state: 'PUBLISHED', ...publication };
        this.update(observed, { state: 'PUBLISHED' }, step, result);
        observed = this.transaction();
      } else {
        const receipt = Object.values(tx.stepResults).map(s => s.result).find(r => r?.publicationDigest && ['PUBLISHED', 'RETIRED'].includes(r.state));
        if (payload.publicationDigest !== receipt?.publicationDigest) throw new Error('live_publication_mismatch');
        this.options.liveSource.publication(tx, receipt.publicationDigest, false);
      }
      this.options.liveSource.fence(observed.value);
      if (!this.drain().complete) throw new Error('drain_blocked');
      const result = this.update(observed, { state: 'RETIRED' }, step, { state: 'RETIRED', generation: m.generation, publicationDigest: payload.publicationDigest });
      this.requestClose();
      return result;
    }
    if (irrevocable.has(tx.state)) throw new Error('stop_irreversible');
    if (tx.state === 'ABORTED') throw new Error('transaction_aborted');
    if (tx.mode === 'live-transfer') {
      if (!this.options.liveSource.sourcePublished(tx)) {
        if (tx.state !== 'RECOVERY_BLOCKED') this.update(observed, { state: 'RECOVERY_BLOCKED' }, null, null);
        throw new Error('live_publication_requires_reconciliation');
      }
      if (tx.state === 'RECOVERY_BLOCKED') throw new Error('reconciliation_required');
      this.options.liveSource.revalidate(tx);
    }
    if (step.inventoryRevision !== tx.inventoryRevision || this.options.inventory().revision !== tx.inventoryRevision) throw new Error('inventory_stale');
    if (operation === 'abort') {
      const result = this.update(observed, { state: 'ABORTED', barrierDeadline: null }, step, { state: 'ABORTED' });
      this.options.reconcileParticipants?.({ ...tx, state: 'ABORTED' });
      return result;
    }
    if (operation === 'barrier') {
      if (!['PRECHECKED', 'RESERVED'].includes(tx.state) || this.pause()) throw new Error('barrier_state_invalid');
      if (!Number.isSafeInteger(payload.deadline) || payload.deadline <= this.now()) throw new Error('barrier_expired');
      this.options.authorizeTarget(tx.target, tx.successorReservation.selectionEpoch);
      this.options.verifyEntry?.('barrier');
      this.options.assertEligible?.();
      this.options.barrier?.(tx);
      return this.update(observed, { state: 'BARRIER', barrierDeadline: payload.deadline }, step,
        { state: 'BARRIER', barrierId: randomUUID() });
    }
    if (!['BARRIER', 'FROZEN', 'DRAINING', 'DRAIN_BLOCKED'].includes(tx.state) || tx.barrierDeadline <= this.now()) throw new Error('barrier_expired');
    if (operation === 'renew') {
      if (!Number.isSafeInteger(payload.deadline) || payload.deadline <= this.now()) throw new Error('barrier_expired');
      return this.update(observed, { barrierDeadline: payload.deadline }, step, { renewed: true });
    }
    if (operation === 'freeze' || operation === 'checkpoint') {
      const primitive = this.options[operation];
      if (!primitive) throw new Error('participant_primitive_unavailable');
      const result = primitive(payload, tx);
      if (result?.then) throw new Error('participant_primitive_async');
      return this.update(observed, { state: 'FROZEN', ...(operation === 'checkpoint' ? { checkpointReferences: result.references } : {}) }, step, result);
    }
    if (operation === 'retire') throw new Error('live_publication_required');
    if (operation === 'commit-stop') {
      if (tx.mode !== 'cold-stop') throw new Error('cold_stop_mode_required');
      const drain = this.drain();
      if (!drain.complete) throw new Error('drain_blocked');
      const barriers = Object.values(tx.stepResults).map(s => s.result).filter(r => r?.barrierId);
      if (this.pause() || !barriers.some(r => r.barrierId === payload.barrierId) ||
        payload.sourceGeneration !== m.generation || digest(payload.sourceProcessIdentity) !== digest(m.processIdentity) ||
        payload.expectedDrainRevision !== drain.revision || payload.expectedInventoryRevision !== tx.inventoryRevision ||
        payload.targetBuildId !== tx.target.buildId || payload.targetManifestDigest !== tx.target.manifestDigest ||
        payload.targetEntrypoint !== tx.target.entrypoint || payload.selectionEpoch !== tx.successorReservation.selectionEpoch ||
        payload.precheckEvidenceDigest !== tx.precheckEvidenceDigest) throw new Error('commit_stop_mismatch');
      this.options.authorizeTarget(tx.target, payload.selectionEpoch);
      this.options.verifyEntry?.('commit-stop');
      this.options.verifyPrecheck(tx.precheckEvidenceDigest, tx.target);
      this.options.assertEligible?.();
      const result = this.update(observed, { state: 'STOP_COMMITTED' }, step, { state: 'STOP_COMMITTED', generation: m.generation });
      this.options.commit?.(tx);
      this.requestClose(); // Journal already durable. A lost ACK only re-reads it.
      return result;
    }
    throw new Error('administration_state_invalid');
  }
  expire() {
    const observed = this.transaction();
    if (!observed || irrevocable.has(observed.value.state) || observed.value.barrierDeadline === null || observed.value.barrierDeadline > this.now()) return false;
    if (this.indeterminate) throw new Error('reconciliation_required');
    if (observed.value.mode === 'live-transfer' && !this.options.liveSource.sourcePublished(observed.value)) {
      if (observed.value.state !== 'RECOVERY_BLOCKED') this.update(observed, { state: 'RECOVERY_BLOCKED' }, null, null);
      return false;
    }
    if (observed.value.state === 'RECOVERY_BLOCKED') return false;
    const state = this.drain().complete ? 'ABORTED' : 'DRAIN_BLOCKED';
    if (state !== observed.value.state) {
      this.update(observed, { state, ...(state === 'ABORTED' ? { barrierDeadline: null } : {}) }, null, null);
      if (state === 'ABORTED') this.options.reconcileParticipants?.({ ...observed.value, state });
    }
    return state === 'ABORTED';
  }
  writePause(paused) {
    const old = readState(this.pausePath, 'pause');
    this.persist(this.pausePath, { schemaVersion: 1, revision: (old?.value.revision ?? 0) + 1,
      paused, requestedAt: this.now(), generation: this.marker.generation }, 'pause', old);
  }
  operatorStop() {
    if (!this.pause()) this.writePause(true);
    const tx = this.transaction();
    if (tx && !irrevocable.has(tx.value.state) && tx.value.state !== 'ABORTED' &&
        !(tx.value.mode === 'live-transfer' && (tx.value.state === 'RECOVERY_BLOCKED' || !this.options.liveSource.sourcePublished(tx.value)))) {
      this.update(tx, { state: 'ABORTED' }, null, null);
      this.options.reconcileParticipants?.({ ...tx.value, state: 'ABORTED' });
    }
    this.poll();
    const control = this.control().value;
    return { paused: true, state: control.operatorStopped ? 'stopped' : control.operatorStopCommitted ? 'STOP_COMMITTED' : 'pause_active_stop_deferred',
      stopped: control.operatorStopped, generation: this.marker.generation };
  }
  resume() { this.writePause(false); }
  poll() {
    if (this.indeterminate) { this.reconcile(); return; }
    const tx = this.transaction()?.value;
    if (tx?.mode === 'live-transfer' && tx.state !== 'ABORTED' && !this.options.liveSource.sourcePublished(tx)) return;
    const control = this.control();
    if (!this.indeterminate && this.pause() && !control.value.operatorStopCommitted && control.value.sourceGeneration === this.marker.generation && this.drain().complete) {
      this.options.verifyAuthority?.();
      this.persist(this.controlPath, { ...control.value, revision: control.value.revision + 1,
        operatorStopCommitted: true }, 'componentControl', control);
      this.requestClose();
    }
  }
}
