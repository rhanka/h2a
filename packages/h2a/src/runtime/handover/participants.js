import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OwnershipRegistry, OperationLedger } from './ownership.js';
import { WakeJournal } from './wake.js';
import { LaunchJournal } from './launch-memo.js';
import { establishWriterControl, updateWriterControl, writerDirectory, withExecution, currentExecution } from './mutation.js';
import { readState, publishState } from './state.js';
import { digest } from './wire.js';
import { ownerLiveness, currentIdentity } from './admission.js';
import { endedOwner } from './generation-end.js';

export class Participants {
  constructor(options) {
    this.root = resolve(options.root); this.directory = options.directory; this.marker = options.marker;
    this.writerProof = options.writerProof; this.attachments = new Map(); this.inventoryRevision = 1;
    this.authenticationKey = options.authenticationKey;
    establishWriterControl(this.root, this.directory);
    this.registry = new OwnershipRegistry({ directory: this.directory, generation: this.marker.generation,
      processIdentity: this.marker.processIdentity, lockDirectory: writerDirectory(this.root) });
    this.ledger = new OperationLedger(this.registry);
  }
  writerControl() { return readState(join(writerDirectory(this.root), 'control.json'), 'writerControl').value; }
  assertEligible() {
    const proof = this.writerProof;
    const verdict = proof?.verify({ root: this.root, generation: this.marker.generation, evidenceDigest: proof.evidenceDigest }) ?? 'store_writer_set_unknown';
    if (!['qualified', 'legacy_writer_unfenced', 'store_writer_set_unknown'].includes(verdict)) throw new Error('store_writer_set_unknown');
    if (verdict !== 'qualified') throw new Error(verdict);
    if (!/^sha256:[a-f0-9]{64}$/.test(proof.evidenceDigest)) throw new Error('store_writer_set_unknown');
    const old = this.writerControl();
    if (old.restriction !== verdict || old.closureEvidenceDigest !== proof.evidenceDigest) {
      updateWriterControl(this.root, { restriction: verdict, closureEvidenceDigest: proof.evidenceDigest });
    }
  }
  attach(attachmentId, context = {}) {
    return this.registry.withLock(() => {
      if (this.writerControl().gate !== 'OPEN') throw new Error('store_admission_closed');
      const input = { attachmentId, presenceSessionId: `pending:${attachmentId}`, expectedInstance: context.expectedInstance ?? 'identity_disabled' };
      const previous = readState(this.registry.ownerPath(attachmentId), 'ownership');
      const token = previous && context.attachment?.resume
        ? this.registry.rebaseline(input, owner => ownerLiveness({ processIdentity: owner.ownerProcessIdentity }, currentIdentity()) === 'dead' ||
          Boolean(this.authenticationKey && endedOwner(owner, this.marker, this.authenticationKey)))
        : this.registry.claim(input);
      const participant = new AttachmentParticipant(this, token, context);
      this.attachments.set(attachmentId, participant); this.inventoryRevision++;
      return participant;
    });
  }
  inventory() {
    let restriction = 'store_writer_set_unknown';
    try { this.assertEligible(); restriction = 'qualified'; } catch (e) { restriction = e.message; }
    return { schemaVersion: 1, revision: this.inventoryRevision, shims: [],
      transports: [...this.attachments.values()].map(a => ({ attachmentId: a.token.attachmentId,
        ownershipEpoch: a.token.ownershipEpoch, ownerGeneration: a.token.ownerGeneration, attachmentProtocol: a.advertisement?.attachmentProtocol ?? 'direct-mcp' })),
      operations: this.ledger.operations(), quarantines: [], launches: [...this.attachments.values()].flatMap(a => a.launches.memos().map(m => m.launchId)),
      endpointPinned: this.marker.endpointMode === 'fixed', writerRestrictions: restriction === 'qualified' ? [] : [restriction],
      managedImage: this.marker.handoverCapabilities.managedImage };
  }
  barrier(handoverId) {
    return this.registry.withLock(() => {
      this.assertEligible();
      const old = this.writerControl();
      if (old.gate !== 'OPEN' && old.handoverId !== handoverId) throw new Error('handover_conflict');
      if (old.gate === 'CLOSED') throw new Error('stop_irreversible');
      updateWriterControl(this.root, { gate: 'BARRIER', handoverId });
      for (const a of this.attachments.values()) { a.mcp?.notifications.stop(); a.mcp?.sessions.suspend(); }
    });
  }
  freeze(handoverId) {
    return this.registry.withLock(() => {
      this.assertEligible();
      if (this.writerControl().gate !== 'BARRIER' || this.writerControl().handoverId !== handoverId) throw new Error('barrier_required');
      if (this.ledger.operations().some(op => op.kind === 'callback' && op.state === 'pending')) throw new Error('callbacks_pending');
      for (const a of this.attachments.values()) {
        if (!a.mcp || !a.initialized) throw new Error('attachment_activation_pending');
        if (this.registry.assertOwner(a.token, ['ACTIVE', 'FROZEN']).value.state === 'ACTIVE') a.refreshIdentity();
        const status = a.identity();
        if (status.state === 'identity_pending') throw new Error('attachment_activation_pending');
      }
      for (const a of this.attachments.values()) {
        a.mcp.notifications.stop(); a.mcp.sessions.suspend();
        this.registry.freeze(a.token, handoverId);
      }
      return { frozen: true, inventoryRevision: this.inventoryRevision };
    });
  }
  checkpoint(handoverId) {
    return this.registry.withLock(() => {
      if (!this.attachments.size) {
        if (!this.drain().complete) throw new Error('attachment_checkpoint_missing');
        const checkpoint = { schemaVersion: 1, generation: this.marker.generation, publicationEpoch: this.marker.publicationEpoch,
          inventoryRevision: this.inventoryRevision, drainRevision: this.drain().revision, emptyAttachments: true };
        const reference = `checkpoint-${digest(checkpoint).slice(7)}.json`, path = join(this.directory, reference);
        if (!readState(path, 'emptyCheckpoint')) publishState(path, checkpoint, 'emptyCheckpoint');
        return { references: [reference] };
      }
      const receipts = [...this.attachments.values()].map(a => {
        const owner = this.registry.assertOwner(a.token, ['FROZEN']).value;
        if (owner.handoverId !== handoverId) throw new Error('handover_conflict');
        if (owner.checkpointHash) return { reference: `checkpoint-${owner.checkpointHash.slice(7)}.json` };
        return this.registry.checkpoint(a.token, a.snapshot());
      });
      return { references: receipts.map(r => r.reference) };
    });
  }
  abort(handoverId) {
    return this.registry.withLock(() => {
      const old = this.writerControl();
      if (old.gate === 'CLOSED') throw new Error('stop_irreversible');
      if (old.handoverId !== handoverId) throw new Error('handover_conflict');
      for (const a of this.attachments.values()) {
        const owner = this.registry.assertOwner(a.token, ['ACTIVE', 'FROZEN']).value;
        if (owner.state === 'FROZEN') this.registry.abort(a.token, handoverId);
        a.runOwner(() => { a.mcp?.sessions.resume(); a.mcp?.notifications.start(); });
      }
      updateWriterControl(this.root, { gate: 'OPEN', handoverId: null });
    });
  }
  commit() { updateWriterControl(this.root, { gate: 'CLOSED' }); }
  checkTransfer(tx, target) {
    return this.registry.withLock(() => {
      const gate = this.writerControl();
      const control = readState(join(this.directory, 'component-control.json'), 'componentControl')?.value;
      const targetOpen = target && ['PUBLISHED', 'RETIRED'].includes(tx.state) && gate.gate === 'OPEN' &&
        [null, tx.handoverId].includes(gate.handoverId) && control?.sourceGeneration === target.generation &&
        control.ownerState === 'ACTIVE' && digest(control.ownerIdentity) === digest(target.processIdentity);
      if (!(gate.handoverId === tx.handoverId && gate.gate === 'BARRIER') && !targetOpen) throw new Error('barrier_required');
      if (!this.attachments.size) {
        if (tx.checkpointReferences.length !== 1) throw new Error('attachment_checkpoint_missing');
        const reference = tx.checkpointReferences[0];
        if (!/^checkpoint-[a-f0-9]{64}\.json$/.test(reference)) throw new Error('checkpoint_reference_invalid');
        const value = readState(join(this.directory, reference), 'emptyCheckpoint')?.value;
        if (!value || reference !== `checkpoint-${digest(value).slice(7)}.json` || value.generation !== tx.source.generation ||
            digest(value.publicationEpoch) !== digest(tx.source.publicationEpoch) || value.inventoryRevision !== tx.inventoryRevision) throw new Error('checkpoint_binding_mismatch');
        return;
      }
      const references = [];
      for (const a of this.attachments.values()) {
        if (a.advertisement && (!a.shimAcceptance || a.shimAcceptance.mode !== 'handover' ||
            a.shimAcceptance.authorization.handoverId !== tx.handoverId ||
            a.shimAcceptance.authorization.transactionEpoch !== tx.transactionEpoch ||
            a.shimAcceptance.authorization.controllerEpoch !== tx.controllerEpoch)) throw new Error('shim_acceptance_required');
        const owner = readState(this.registry.ownerPath(a.token.attachmentId), 'ownership')?.value;
        // G1 may already have acquired the exact FROZEN checkpoint. Never
        // rewrite its ownership while G0's admitted operations drain.
        if (!owner || owner.handoverId !== tx.handoverId || !owner.checkpointHash ||
            !['FROZEN', 'TRANSFERRING', 'ACTIVE'].includes(owner.state) ||
            (owner.ownerGeneration === tx.source.generation && owner.state === 'ACTIVE')) throw new Error('checkpoint_binding_mismatch');
        if (!['PUBLISHED', 'RETIRED'].includes(tx.state) && owner.state !== 'FROZEN') throw new Error('checkpoint_not_frozen');
        if (owner.ownerGeneration === tx.source.generation) this.registry.assertOwner(a.token, ['FROZEN', 'TRANSFERRING']);
        else if (!target || owner.ownerGeneration !== target.generation || owner.ownershipEpoch !== a.token.ownershipEpoch + 1 ||
            digest(owner.ownerProcessIdentity) !== digest(target.processIdentity) || owner.state !== 'ACTIVE') throw new Error('ownership_fenced');
        const reference = `checkpoint-${owner.checkpointHash.slice(7)}.json`;
        const checkpoint = this.registry.loadCheckpoint(reference, owner.checkpointHash);
        if (checkpoint.attachmentId !== a.token.attachmentId || checkpoint.ownershipEpoch !== a.token.ownershipEpoch) throw new Error('checkpoint_binding_mismatch');
        references.push(reference);
      }
      if (digest(references) !== digest(tx.checkpointReferences)) throw new Error('checkpoint_binding_mismatch');
    });
  }
  transfer(tx, target) {
    return this.registry.withLock(() => {
      this.checkTransfer(tx, target);
      for (const a of this.attachments.values()) {
        const owner = readState(this.registry.ownerPath(a.token.attachmentId), 'ownership').value;
        if (owner.ownerGeneration === tx.source.generation) this.registry.fence(a.token, tx.handoverId, owner.checkpointHash);
      }
    });
  }
  reconcileTransaction(tx) {
    if (this.registry.indeterminate) this.registry.reconcile();
    const control = this.writerControl();
    if (tx?.source.generation !== this.marker.generation) return;
    if (tx.state === 'ABORTED' && control.gate === 'BARRIER' && control.handoverId === tx.handoverId) this.abort(tx.handoverId);
    if (['STOP_COMMITTED', 'STOPPED'].includes(tx.state) && control.gate !== 'CLOSED') this.commit();
  }
  drain() {
    if (this.registry.indeterminate) return { revision: this.registry.revision(), calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 1, complete: false };
    return this.registry.withLock(() => {
      const control = readState(join(this.directory, 'component-control.json'), 'componentControl')?.value;
      const tx = control?.activeTransaction ? readState(join(this.directory, control.activeTransaction), 'componentTransaction')?.value : undefined;
      const scope = tx?.mode === 'live-transfer' && tx.source.generation === this.marker.generation && ['PUBLISHED', 'RETIRED'].includes(tx.state)
        ? { generation: this.marker.generation, processIdentity: this.marker.processIdentity } : undefined;
      LaunchJournal.reconcileAll(this.registry, this.ledger, scope);
      const drain = this.ledger.drain(scope);
      for (const name of fs.readdirSync(this.directory).filter(p => /^launch-[a-f0-9]+\.json$/.test(p))) {
        const memo = readState(join(this.directory, name), 'launchMemo').value;
        if (scope && digest(memo.executionOwner) !== digest(scope.processIdentity)) continue;
        if (memo.state === 'completed') continue;
        const operations = this.ledger.operations();
        for (const [kind, key] of [['child', 'children'], ['brief', 'briefs']]) {
          if (!operations.some(o => o.operationId === `${memo.launchId}:${kind}`)) drain[key]++;
        }
      }
      drain.complete = ['calls', 'children', 'briefs', 'callbacks', 'effects'].every(k => drain[k] === 0);
      return drain;
    });
  }
}

export class AttachmentParticipant {
  constructor(manager, token, context) {
    this.manager = manager; this.token = token; this.context = context; this.mcp = undefined;
    this.initialized = true;
    this.wake = new WakeJournal({ registry: manager.registry, token, ledger: manager.ledger });
    this.launches = new LaunchJournal({ registry: manager.registry, token, ledger: manager.ledger, root: context.workspace ?? manager.root });
    this.wakeHandler = undefined; this.terminalReferences = []; this.delegationReferences = [];
    this.downstreamProtocol = '2025-06-18';
  }
  authority(operation, cleanup = false) { return { root: this.manager.root, registry: this.manager.registry,
    ledger: this.manager.ledger, token: this.token, operation, cleanup }; }
  runOwner(fn, cleanup = false) { return withExecution(this.authority(undefined, cleanup), fn); }
  begin(kind) { return this.manager.ledger.begin(this.token, randomUUID(), kind); }
  finish(operation, result, unknown = false) { return this.manager.ledger.finish(operation, result, unknown); }
  bind(mcp) { this.mcp = mcp; }
  identity() {
    const result = this.mcp.callTool('h2a_identity_status', {});
    return JSON.parse(result.content[0].text);
  }
  refreshIdentity() {
    const session = this.mcp?.sessions.list()[0];
    if (session) this.manager.registry.updateIdentity(this.token, session.sessionId, session.instance);
  }
  call(fn) {
    const parent = currentExecution();
    if (parent?.registry === this.manager.registry && parent.operation?.kind === 'call' &&
        parent.operation.attachmentId === this.token.attachmentId) {
      this.manager.ledger.assertOperation(parent.operation);
      return fn();
    }
    const operation = this.begin('call');
    const finish = result => { this.finish(operation, { completed: true }); return result; };
    const fail = error => { this.finish(operation, { error: String(error) }, true); throw error; };
    try {
      const result = withExecution(this.authority(operation), fn);
      return result?.then ? result.then(finish, fail) : finish(result);
    } catch (error) { return fail(error); }
  }
  executeLaunch(request, execute) {
    return this.launches.launch(request, enriched => {
      const memo = this.launches.memos().find(m => m.launchName === request.name);
      const operation = this.launches.operation(memo, 'child');
      return withExecution(this.authority(operation), () => execute(enriched));
    });
  }
  completeLaunch(request, result, record) {
    if (!request.delegation) return;
    const memo = this.launches.memos().find(m => m.launchName === request.name);
    if (!memo) throw new Error('operation_fenced');
    const eventId = this.launches.publishDelegation(memo, result);
    try {
      this.manager.registry.withLock(() => {
        this.manager.registry.assertOwner(this.token);
        if (this.manager.writerControl().gate !== 'OPEN') throw new Error('store_admission_closed');
        this.runOwner(() => record(eventId));
      });
    }
    catch (error) {
      if (!['ownership_fenced', 'store_admission_closed'].includes(error.message)) throw error;
      // The current-owner event remains durable; no old owner effect is replayed.
    }
  }
  snapshot() {
    const notification = this.mcp.notifications.checkpointState();
    const snapshot = { schemaVersion: 1, attachmentId: this.token.attachmentId, ownershipEpoch: this.token.ownershipEpoch,
      context: this.context, identity: this.identity(), presence: this.mcp.sessions.list(), downstreamProtocol: this.downstreamProtocol,
      servedCatalogue: this.mcp.listTools(), subscriptions: this.mcp.sessions.list().flatMap(s => s.subscribedTopics),
      observedPeers: notification.snapshots.flatMap(s => s.observedPeers), observedInbox: notification.snapshots.flatMap(s => s.observedInbox),
      notifications: { events: notification.notifications, ownerEffects: this.manager.ledger.effects(this.token.attachmentId) }, negotiations: notification.snapshots.flatMap(s => s.negotiations), truncation: notification.truncation,
      blockages: notification.snapshots.flatMap(s => s.blockages), producedSequence: notification.producedSequence, deliveredSequence: notification.deliveredSequence,
      wakeState: { ...this.wake.snapshot(), seen: this.wakeHandler?.checkpointState().seen ?? [] },
      terminalReferences: this.terminalReferences, delegationReferences: this.delegationReferences, launches: this.launches.memos() };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 4 * 1024 * 1024) throw new Error('checkpoint_oversize');
    return snapshot;
  }
  async close(fn) {
    if (this.transferred()) {
      this.mcp?.notifications.stop(); this.mcp?.sessions.suspend();
      await fn(); // Transport cleanup sees transferred() and preserves presence.
    } else {
      await this.runOwner(fn, true);
      this.manager.registry.close(this.token);
    }
    this.manager.attachments.delete(this.token.attachmentId); this.manager.inventoryRevision++;
  }
  transferred() {
    const owner = readState(this.manager.registry.ownerPath(this.token.attachmentId), 'ownership')?.value;
    return Boolean(owner && (owner.state === 'TRANSFERRING' || owner.ownerGeneration !== this.token.ownerGeneration));
  }
}
