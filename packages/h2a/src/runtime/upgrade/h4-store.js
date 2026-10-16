import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { acquirePrefixLock } from '../local-files/succession-lock.js';
import { prefixLayout } from '../handover/authority.js';
import { currentIdentity, ownerLiveness } from '../handover/admission.js';
import { validate } from '../handover/formats.js';
import { digest } from '../handover/wire.js';
import { privateDirectory, readState, publishState, replaceState } from '../handover/state.js';
import { mutationLock } from '../handover/mutation.js';
import { verifyImage } from '../handover/image.js';
import { assertImageRuntime } from './image-policy.js';

const terminal = new Set(['COMPLETED', 'ABORTED']);
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('upgrade_id_invalid');
  return value;
};
const syncDirectory = path => {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

// No HOME/XDG authority. All writes take the *existing* succession lock before
// the H4 selection flock. Every durable boundary rechecks compatible ownership.
export class UpgradeStore {
  constructor(installation) {
    validate('installation', installation);
    const physical = prefixLayout(installation.canonicalPrefix, installation.canonicalPrefix, process.getuid());
    if (installation.canonicalPrefix !== physical.canonicalPrefix || installation.managedRoot !== physical.managedRoot ||
      installation.prefixId !== physical.prefixId || installation.uid !== physical.uid) throw new Error('foreign_installation_authority');
    const stored = readState(join(installation.managedRoot, 'installation.json'), 'installation');
    if (!stored || digest(stored.value) !== digest(installation)) throw new Error('foreign_installation_authority');
    this.installation = Object.freeze({ ...installation });
    this.state = join(installation.managedRoot, 'state');
    this.transactions = join(this.state, 'upgrade/transactions');
  }
  #path(upgradeId) { return join(this.transactions, `${id(upgradeId)}.json`); }
  #read(upgradeId) {
    const record = readState(this.#path(upgradeId), 'upgradeTransaction');
    if (!record) throw new Error('upgrade_not_found');
    for (const key of ['prefixId', 'canonicalPrefix', 'uid']) {
      if (record.value[key] !== this.installation[key]) throw new Error('foreign_installation_authority');
    }
    if (record.value.upgradeId !== upgradeId) throw new Error('RECOVERY_BLOCKED:journal_identity');
    const tx = record.value, intent = validate('selection', tx.observations.selectionIntent);
    if (['prefixId', 'canonicalPrefix', 'uid', 'upgradeId', 'selectionEpoch', 'previousSelectionReference']
      .some(key => intent[key] !== tx[key]) || intent.manifestDigest !== tx.targetManifestDigest || intent.packageVersion !== tx.resolvedTarget) {
      throw new Error('RECOVERY_BLOCKED:selection_intent');
    }
    const previousEpoch = tx.previousSelectionReference?.match(/^selection-history\/([1-9][0-9]*)\.json$/)?.[1];
    if (tx.previousSelectionReference === null ? tx.selectionEpoch !== 1 || tx.observations.previousSelectionDigest !== null :
      !previousEpoch || Number(previousEpoch) + 1 !== tx.selectionEpoch || !/^sha256:[0-9a-f]{64}$/.test(tx.observations.previousSelectionDigest ?? '')) {
      throw new Error('RECOVERY_BLOCKED:selection_intent');
    }
    return record;
  }
  #locked(fn) {
    const lease = acquirePrefixLock(this.installation.canonicalPrefix, { readFirst: true });
    if (!lease.acquired) throw new Error(`legacy_lock_unavailable:${lease.reason}`);
    try {
      return mutationLock(this.state, () => {
        const held = () => { if (!lease.stillHeld()) throw new Error('legacy_lock_lost'); };
        held(); return fn(held);
      });
    } finally { lease.release(); }
  }
  #write(record, changes, held) {
    held();
    return replaceState(this.#path(record.value.upgradeId), { ...record.value, ...changes,
      revision: record.value.revision + 1, updatedAt: Math.max(Date.now(), record.value.updatedAt) }, 'upgradeTransaction', record);
  }
  #target(target) {
    if (!/^sha256:[0-9a-f]{64}$/.test(target.manifestDigest ?? '')) throw new Error('manifest_digest_required');
    const root = join(this.installation.managedRoot, 'images', target.manifestDigest?.slice(7) ?? 'invalid');
    privateDirectory(root);
    const path = join(root, 'manifest.json');
    if (!fs.lstatSync(path).isFile()) throw new Error('image_manifest_required');
    const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
    verifyImage(root, manifest, target.manifestDigest);
    assertImageRuntime(manifest);
    if (!manifest.entrypoints.controller || manifest.entrypoints.controller !== target.entrypoint) throw new Error('controller_protocol_incompatible');
    if (manifest.packageVersion !== target.packageVersion || manifest.buildId !== target.buildId ||
      manifest.profile.nodeMajor !== Number(process.versions.node.split('.')[0]) ||
      manifest.profile.nodeAbi !== process.versions.modules || manifest.profile.arch !== process.arch ||
      process.platform !== 'linux' || !process.report.getReport().header.glibcVersionRuntime) throw new Error('selection_profile_mismatch');
    const controllerPath = join(root, 'controller.json');
    if (!manifest.files.some(f => f.path === 'controller.json' && f.type === 'file')) throw new Error('controller_protocol_incompatible');
    const controller = JSON.parse(fs.readFileSync(controllerPath, 'utf8'));
    if (controller.schemaVersion !== 1 || controller.protocolVersion !== 1 || controller.entrypoint !== target.entrypoint) {
      throw new Error('controller_protocol_incompatible');
    }
    return manifest;
  }
  #selection() {
    const record = readState(join(this.state, 'selected-build.json'), 'selection');
    if (record) for (const key of ['prefixId', 'canonicalPrefix', 'uid']) {
      if (record.value[key] !== this.installation[key]) throw new Error('foreign_installation_authority');
    }
    return record;
  }
  #assertController(tx) {
    if (tx.controllerAuthorityState !== 'ACTIVE' || digest(tx.controllerIdentity) !== digest(currentIdentity())) {
      throw new Error('controller_authority_revoked');
    }
  }
  status(upgradeId) { return this.#read(upgradeId).value; }
  begin({ upgradeId, target, origin = 'manual', artifactDigests = {} }) {
    id(upgradeId);
    return this.#locked(held => {
      this.#target(target);
      const selection = this.#selection();
      const image = { packageVersion: target.packageVersion, buildId: target.buildId,
        manifestDigest: target.manifestDigest, entrypoint: target.entrypoint };
      const requestDigest = digest({ target: image, origin, artifactDigests });
      for (const name of fs.readdirSync(this.transactions).sort()) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name)) throw new Error('RECOVERY_BLOCKED:unknown_journal');
        const existing = this.#read(name.slice(0, -5)).value;
        if (existing.upgradeId === upgradeId) {
          if (existing.observations.requestDigest !== requestDigest) throw new Error('upgrade_request_conflict');
          return existing;
        }
        if (!terminal.has(existing.installationState)) throw new Error('upgrade_in_progress');
      }
      const selectionEpoch = (selection?.value.selectionEpoch ?? 0) + 1;
      const previousSelectionReference = selection ? `selection-history/${selection.value.selectionEpoch}.json` : null;
      const intent = { schemaVersion: 1, prefixId: this.installation.prefixId, canonicalPrefix: this.installation.canonicalPrefix,
        uid: this.installation.uid, selectionEpoch, ...image, previousSelectionReference, upgradeId };
      validate('selection', intent);
      const now = Date.now(), identity = currentIdentity();
      const transaction = { schemaVersion: 1, upgradeId, revision: 1, prefixId: this.installation.prefixId,
        canonicalPrefix: this.installation.canonicalPrefix, uid: this.installation.uid,
        requestedTarget: target.packageVersion, resolvedTarget: target.packageVersion, artifactDigests,
        targetManifestDigest: target.manifestDigest, origin, initiatorIdentity: identity,
        controllerIdentity: identity, controllerBuildId: 'h4-bootstrap-v1', controllerEpoch: 1,
        controllerAuthorityState: 'ACTIVE', delegationState: 'NONE', delegatedBuildId: null,
        delegationReceiptDigest: null, privateTicketReference: null, installationState: 'PREPARING', selectionEpoch,
        previousSelectionReference, componentTransactions: {}, observations: { requestDigest, selectionIntent: intent,
          previousSelectionDigest: selection?.digest ?? null }, verification: {}, createdAt: now, updatedAt: now };
      held(); return publishState(this.#path(upgradeId), transaction, 'upgradeTransaction').value;
    });
  }
  prepare(upgradeId) {
    return this.#locked(held => {
      const record = this.#read(upgradeId), tx = record.value; this.#assertController(tx);
      if (tx.installationState !== 'PREPARING') throw new Error('upgrade_phase_invalid');
      this.#target(tx.observations.selectionIntent);
      const pin = { schemaVersion: 1, upgradeId, handoverId: `h4-${upgradeId}`,
        sourceManifestDigest: this.#selection()?.value.manifestDigest ?? tx.targetManifestDigest, targetManifestDigest: tx.targetManifestDigest };
      const path = join(this.state, 'pins', `upgrade-${id(upgradeId)}.json`), prior = readState(path, 'imagePin');
      if (prior && digest(prior.value) !== digest(pin)) throw new Error('RECOVERY_BLOCKED:pin');
      held(); if (!prior) publishState(path, pin, 'imagePin');
      return this.#write(record, { installationState: 'PREPARED', verification: { imageVerified: true } }, held).value;
    });
  }
  #finish(record, held) {
    const tx = record.value, intent = validate('selection', tx.observations.selectionIntent);
    if (intent.upgradeId !== tx.upgradeId || intent.manifestDigest !== tx.targetManifestDigest || intent.selectionEpoch !== tx.selectionEpoch) {
      throw new Error('RECOVERY_BLOCKED:selection_intent');
    }
    this.#target(intent);
    const history = join(this.state, 'selection-history', `${intent.selectionEpoch}.json`);
    const prior = readState(history, 'selection');
    if (prior && prior.digest !== digest(intent)) throw new Error('RECOVERY_BLOCKED:history');
    const backup = join(this.state, 'last-valid-selection.json'), last = readState(backup, 'selection');
    if (last && last.digest !== digest(intent) && last.digest !== tx.observations.previousSelectionDigest) {
      throw new Error('RECOVERY_BLOCKED:history');
    }
    const selected = this.#selection();
    if (selected?.digest !== digest(intent)) {
      if ((selected?.digest ?? null) !== tx.observations.previousSelectionDigest || tx.installationState !== 'SELECTING') {
        throw new Error('RECOVERY_BLOCKED:selection');
      }
      held();
      const path = join(this.state, 'selected-build.json');
      if (selected) replaceState(path, intent, 'selection', selected); else publishState(path, intent, 'selection');
    }
    // A previous directory fsync may have failed after rename/link. Never ACK
    // solely because a read sees the new bytes.
    held(); syncDirectory(this.state);
    held(); if (!prior) publishState(history, intent, 'selection');
    held();
    if (!last) publishState(backup, intent, 'selection');
    else if (last.digest !== digest(intent)) replaceState(backup, intent, 'selection', last);
    return tx.installationState === 'SELECTING' ? this.#write(record, { installationState: 'SELECTED' }, held).value : tx;
  }
  select(upgradeId) {
    return this.#locked(held => {
      let record = this.#read(upgradeId); this.#assertController(record.value);
      if (record.value.installationState === 'SELECTED') return this.#finish(record, held);
      if (record.value.installationState !== 'PREPARED') throw new Error('upgrade_phase_invalid');
      this.#target(record.value.observations.selectionIntent);
      if ((this.#selection()?.digest ?? null) !== record.value.observations.previousSelectionDigest) throw new Error('RECOVERY_BLOCKED:selection');
      record = this.#write(record, { installationState: 'SELECTING' }, held);
      return this.#finish(record, held);
    });
  }
  reconcile(upgradeId) {
    return this.#locked(held => {
      const record = this.#read(upgradeId); this.#assertController(record.value);
      if (['SELECTING', 'SELECTED'].includes(record.value.installationState)) return this.#finish(record, held);
      if (['PREPARING', 'PREPARED', 'ABORTED'].includes(record.value.installationState)) return record.value;
      throw new Error('RECOVERY_BLOCKED:unsupported_phase');
    });
  }
  abort(upgradeId) {
    return this.#locked(held => {
      const record = this.#read(upgradeId); this.#assertController(record.value);
      if (record.value.installationState === 'ABORTED') return record.value;
      if (!['PREPARING', 'PREPARED'].includes(record.value.installationState)) throw new Error('selection_irreversible');
      return this.#write(record, { installationState: 'ABORTED' }, held).value;
    });
  }
  #ticket(record) {
    const tx = record.value;
    if (tx.privateTicketReference !== `private/delegation-${id(tx.upgradeId)}-${tx.controllerEpoch}.json`) throw new Error('delegation_ticket_mismatch');
    const ticket = readState(join(this.state, 'upgrade', tx.privateTicketReference), 'delegationTicket');
    if (!ticket || ticket.value.upgradeId !== tx.upgradeId || ticket.value.controllerEpoch !== tx.controllerEpoch ||
      ticket.value.delegatedBuildId !== tx.delegatedBuildId || ticket.value.targetManifestDigest !== tx.targetManifestDigest) {
      throw new Error('delegation_ticket_mismatch');
    }
    return ticket.value;
  }
  #loaded(tx) {
    const intent = tx.observations.selectionIntent;
    this.#target(intent);
    const entry = join(this.installation.managedRoot, 'images', intent.manifestDigest.slice(7), intent.entrypoint);
    if (!process.argv[1] || fs.realpathSync(process.argv[1]) !== fs.realpathSync(entry)) throw new Error('controller_entrypoint_mismatch');
  }
  delegate(upgradeId, candidateIdentity) {
    validate('processIdentity', candidateIdentity);
    return this.#locked(held => {
      const record = this.#read(upgradeId), tx = record.value;
      // A lost ACK may replay the handoff, but never reactivates its source.
      if (tx.installationState === 'DELEGATING' && tx.controllerAuthorityState === 'REVOKED' &&
        digest(tx.controllerIdentity) === digest(currentIdentity())) {
        const ticket = this.#ticket(record);
        if (digest(ticket.delegatedControllerIdentity) !== digest(candidateIdentity) || ticket.expectedRevision !== tx.revision) throw new Error('delegation_ticket_mismatch');
        held(); syncDirectory(this.transactions); syncDirectory(join(this.state, 'upgrade/private'));
        return { transaction: tx, ticket };
      }
      this.#assertController(tx);
      if (tx.installationState !== 'SELECTED') throw new Error('upgrade_phase_invalid');
      // SELECTED is checked without repairing anything before revocation.
      if (this.#selection()?.digest !== digest(tx.observations.selectionIntent)) throw new Error('RECOVERY_BLOCKED:selection');
      this.#target(tx.observations.selectionIntent);
      return this.#handoff(record, candidateIdentity, held);
    });
  }
  #handoff(record, candidateIdentity, held) {
    const tx = record.value, upgradeId = tx.upgradeId;
    const reference = `private/delegation-${id(upgradeId)}-${tx.controllerEpoch + 1}.json`;
    const path = join(this.state, 'upgrade', reference);
    let ticket = readState(path, 'delegationTicket')?.value;
    const binding = { schemaVersion: 1, upgradeId, controllerEpoch: tx.controllerEpoch + 1,
      expectedRevision: tx.revision + 1, delegatedBuildId: tx.observations.selectionIntent.buildId,
      targetManifestDigest: tx.targetManifestDigest, delegatedControllerIdentity: candidateIdentity };
    if (ticket) {
      for (const [key, value] of Object.entries(binding)) if (digest(ticket[key]) !== digest(value)) throw new Error('delegation_ticket_mismatch');
      held(); syncDirectory(dirname(path));
    } else {
      ticket = { ...binding, ticketNonce: randomBytes(32).toString('hex'), expiresAt: Date.now() + 15 * 60_000 };
      held(); publishState(path, ticket, 'delegationTicket');
    }
    const transaction = this.#write(record, { installationState: 'DELEGATING', controllerAuthorityState: 'REVOKED',
      delegationState: 'DELEGATING', controllerEpoch: ticket.controllerEpoch, delegationReceiptDigest: null,
      delegatedBuildId: ticket.delegatedBuildId, privateTicketReference: reference }, held).value;
    return { transaction, ticket };
  }
  recoverDelegation(upgradeId, candidateIdentity) {
    validate('processIdentity', candidateIdentity);
    return this.#locked(held => {
      const record = this.#read(upgradeId), tx = record.value, identity = currentIdentity();
      if (!['DELEGATING', 'ACTIVATING', 'PARTIAL'].includes(tx.installationState) ||
        !['DELEGATING', 'DELEGATED'].includes(tx.delegationState)) throw new Error('upgrade_phase_invalid');
      if (digest(tx.controllerIdentity) !== digest(identity) || tx.delegationState === 'DELEGATED') {
        this.#loaded(tx);
        if (digest(candidateIdentity) !== digest(identity)) throw new Error('delegation_identity_mismatch');
      }
      const ticket = this.#ticket(record);
      if (tx.delegationState === 'DELEGATED') this.#receipt(tx, ticket);
      if (tx.delegationState === 'DELEGATING' && ticket.expectedRevision !== tx.revision) throw new Error('delegation_revision_mismatch');
      if (this.#selection()?.digest !== digest(tx.observations.selectionIntent)) throw new Error('RECOVERY_BLOCKED:selection');
      this.#target(tx.observations.selectionIntent);
      if (digest(ticket.delegatedControllerIdentity) === digest(candidateIdentity)) {
        if (digest(candidateIdentity) !== digest(identity)) throw new Error('delegation_identity_mismatch');
        if (tx.delegationState === 'DELEGATED') this.#receipt(tx, ticket);
        held(); syncDirectory(this.transactions); syncDirectory(join(this.state, 'upgrade/private'));
        return { transaction: tx, ticket };
      }
      if (ownerLiveness({ processIdentity: ticket.delegatedControllerIdentity }, identity) !== 'dead') throw new Error('delegation_owner_not_dead');
      return this.#handoff(record, candidateIdentity, held);
    });
  }
  acquireDelegation(upgradeId, suppliedTicket) {
    validate('delegationTicket', suppliedTicket);
    return this.#locked(held => {
      const record = this.#read(upgradeId), tx = record.value, ticket = this.#ticket(record);
      if (digest(suppliedTicket) !== digest(ticket)) throw new Error('delegation_ticket_mismatch');
      const identity = currentIdentity();
      if (digest(ticket.delegatedControllerIdentity) !== digest(identity)) throw new Error('delegation_identity_mismatch');
      this.#loaded(tx);
      if (this.#selection()?.digest !== digest(tx.observations.selectionIntent)) throw new Error('RECOVERY_BLOCKED:selection');
      if (tx.delegationState === 'DELEGATED' && tx.controllerAuthorityState === 'ACTIVE') {
        this.#assertController(tx); this.#receipt(tx, ticket);
        held(); syncDirectory(this.transactions); syncDirectory(join(this.state, 'upgrade/receipts'));
        return tx;
      }
      if (tx.installationState !== 'DELEGATING' || tx.delegationState !== 'DELEGATING' || tx.controllerAuthorityState !== 'REVOKED' ||
        ticket.expectedRevision !== tx.revision) throw new Error('delegation_revision_mismatch');
      if (ticket.expiresAt <= Date.now()) throw new Error('delegation_ticket_expired');
      const receipt = { schemaVersion: 1, upgradeId, controllerEpoch: ticket.controllerEpoch, previousRevision: tx.revision,
        delegatedControllerIdentity: identity, delegatedBuildId: ticket.delegatedBuildId,
        targetManifestDigest: tx.targetManifestDigest, ticketDigest: digest(ticket) };
      const receiptDigest = digest(receipt), path = join(this.state, 'upgrade/receipts', receiptDigest.slice(7) + '.json');
      const prior = readState(path, 'delegationReceipt');
      if (prior && prior.digest !== receiptDigest) throw new Error('RECOVERY_BLOCKED:delegation_receipt');
      held(); if (!prior) publishState(path, receipt, 'delegationReceipt');
      if (prior) { held(); syncDirectory(dirname(path)); }
      return this.#write(record, { installationState: 'ACTIVATING', delegationState: 'DELEGATED', controllerAuthorityState: 'ACTIVE',
        controllerIdentity: identity, controllerBuildId: ticket.delegatedBuildId, delegationReceiptDigest: receiptDigest }, held).value;
    });
  }
  #receipt(tx, ticket) {
    if (!tx.delegationReceiptDigest) throw new Error('RECOVERY_BLOCKED:delegation_receipt');
    const receipt = readState(join(this.state, 'upgrade/receipts', tx.delegationReceiptDigest.slice(7) + '.json'), 'delegationReceipt');
    if (!receipt || receipt.digest !== tx.delegationReceiptDigest || receipt.value.ticketDigest !== digest(ticket) ||
      receipt.value.upgradeId !== tx.upgradeId || receipt.value.controllerEpoch !== tx.controllerEpoch ||
      receipt.value.previousRevision !== ticket.expectedRevision || receipt.value.delegatedBuildId !== tx.controllerBuildId ||
      receipt.value.targetManifestDigest !== tx.targetManifestDigest || digest(receipt.value.delegatedControllerIdentity) !== digest(tx.controllerIdentity)) {
      throw new Error('RECOVERY_BLOCKED:delegation_receipt');
    }
    return receipt.value;
  }
  assertMutationAuthority(upgradeId) {
    return this.#locked(held => {
      const record = this.#read(upgradeId), tx = record.value; this.#assertController(tx);
      if (tx.delegationState === 'DELEGATED') {
        this.#loaded(tx); this.#receipt(tx, this.#ticket(record));
        if (this.#selection()?.digest !== digest(tx.observations.selectionIntent)) throw new Error('RECOVERY_BLOCKED:selection');
        held(); syncDirectory(this.transactions); syncDirectory(join(this.state, 'upgrade/receipts'));
      }
      return tx;
    });
  }
}
