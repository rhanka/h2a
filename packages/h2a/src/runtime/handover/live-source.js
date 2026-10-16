import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { digest, verify } from './wire.js';
import { validate, safeRelative } from './formats.js';
import { readState } from './state.js';

const unsigned = ({ mac, ...value }) => value;
const context = m => ({ service: m.service, namespaceId: m.namespaceId, generation: m.generation });
export const liveTransactionReference = id => `transaction-${digest(id).slice(7)}.json`;

// Passive source only. There is deliberately no producer, publisher, starter,
// acquisition, restoration or product strategy in this module.
export class PassiveLiveSource {
  constructor({ installation, marker, markerPath, rootKey, participants, now = Date.now }) {
    Object.assign(this, { installation, marker, markerPath, rootKey, participants, now });
  }
  record(kind, hash) {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error('live_record_digest_invalid');
    const schema = kind === 'authorization' ? 'liveSourceAuthorization' : 'liveSourcePublication';
    const value = readState(join(this.marker.stateDirectory, `live-${kind}-${hash.slice(7)}.json`), schema)?.value;
    if (!value || digest(value) !== hash ||
        !verify(this.rootKey, 'compatibility', context(this.marker), unsigned(value), value.mac)) throw new Error('live_record_unauthenticated');
    return value;
  }
  reservation(tx) {
    // Only the original RESERVED result carries this digest. Subsequent
    // request payloads cannot replace the authorization pinned at reservation.
    const results = Object.values(tx.stepResults).map(s => s.result);
    const result = results.find(r => r?.state === 'RESERVED' && r.authorizationDigest);
    if (!result) throw new Error('live_authorization_missing');
    return { hash: result.authorizationDigest, value: this.record('authorization', result.authorizationDigest) };
  }
  checkTuple(value, step, target, selectionEpoch, coordinator) {
    const m = this.marker, a = value.authorization, next = validate('marker', value.targetPublication);
    validate('marker', value.source);
    if (digest(value.source) !== digest(m) || step.expectedGeneration !== m.generation ||
        digest(step.expectedPublicationEpoch) !== digest(m.publicationEpoch)) throw new Error('live_source_mismatch');
    if (next.generation === m.generation || next.predecessorGeneration !== m.generation ||
        next.publicationEpoch.bootId !== m.publicationEpoch.bootId || next.publicationEpoch.counter <= m.publicationEpoch.counter ||
        next.endpoint === m.endpoint || next.buildId !== target.buildId || next.manifestDigest !== target.manifestDigest ||
        next.packageVersion !== target.packageVersion || a.selectedManifestDigest !== target.manifestDigest ||
        digest(value.target) !== digest(target) || value.selectionEpoch !== selectionEpoch) throw new Error('live_target_mismatch');
    for (const key of ['namespaceId', 'prefixId', 'uid', 'root', 'stateDirectory', 'authKeyReference']) {
      if (digest(next[key]) !== digest(m[key])) throw new Error('live_target_mismatch');
    }
    for (const key of ['machineId', 'bootId', 'pidNamespace', 'nsNet']) {
      if (next.processIdentity[key] !== m.processIdentity[key]) throw new Error('live_target_mismatch');
    }
    if (digest(next.processIdentity) === digest(m.processIdentity) || next.endpointMode !== 'discovered' || m.endpointMode !== 'discovered') throw new Error('live_target_mismatch');
    if (a.upgradeId !== step.upgradeId || a.handoverId !== step.handoverId || a.transactionEpoch !== step.transactionEpoch ||
        digest(a.delegatedControllerIdentity) !== digest(coordinator)) throw new Error('live_controller_mismatch');
    if (value.inventoryRevision !== step.inventoryRevision) throw new Error('inventory_stale');
  }
  delegation(value) {
    const { installation: i } = this, a = value.authorization;
    if (!safeRelative(a.upgradeId) || a.upgradeId.includes('/')) throw new Error('live_upgrade_id_invalid');
    const directory = join(i.managedRoot, 'state', 'upgrade');
    const upgrade = readState(join(directory, 'transactions', `${a.upgradeId}.json`), 'upgradeTransaction')?.value;
    if (!upgrade || upgrade.upgradeId !== a.upgradeId || upgrade.prefixId !== i.prefixId || upgrade.uid !== i.uid ||
        upgrade.canonicalPrefix !== i.canonicalPrefix || upgrade.controllerAuthorityState !== 'ACTIVE' ||
        upgrade.delegationState !== 'DELEGATED' || !['SELECTED', 'ACTIVATING'].includes(upgrade.installationState) ||
        upgrade.controllerEpoch !== a.controllerEpoch || digest(upgrade.controllerIdentity) !== digest(a.delegatedControllerIdentity) ||
        upgrade.controllerBuildId !== upgrade.delegatedBuildId || upgrade.delegatedBuildId !== value.target.buildId ||
        upgrade.targetManifestDigest !== a.selectedManifestDigest || upgrade.selectionEpoch !== value.selectionEpoch ||
        upgrade.delegationReceiptDigest !== a.delegationReceiptDigest ||
        upgrade.componentTransactions.mcp !== relative(join(i.managedRoot, 'state'), join(this.marker.stateDirectory, liveTransactionReference(a.handoverId)))) throw new Error('live_delegation_invalid');
    if (!upgrade.privateTicketReference) throw new Error('live_ticket_missing');
    const ticket = readState(join(directory, upgrade.privateTicketReference), 'delegationTicket')?.value;
    const receipt = readState(join(directory, 'receipts', `${a.delegationReceiptDigest.slice(7)}.json`), 'delegationReceipt')?.value;
    if (!ticket || !receipt || digest(receipt) !== a.delegationReceiptDigest || receipt.ticketDigest !== digest(ticket) ||
        ticket.upgradeId !== a.upgradeId || receipt.upgradeId !== a.upgradeId ||
        ticket.controllerEpoch !== a.controllerEpoch || receipt.controllerEpoch !== a.controllerEpoch ||
        ticket.expectedRevision !== receipt.previousRevision || upgrade.revision <= ticket.expectedRevision ||
        ticket.delegatedBuildId !== value.target.buildId || receipt.delegatedBuildId !== value.target.buildId ||
        ticket.targetManifestDigest !== a.selectedManifestDigest || receipt.targetManifestDigest !== a.selectedManifestDigest ||
        digest(ticket.delegatedControllerIdentity) !== digest(a.delegatedControllerIdentity) ||
        digest(receipt.delegatedControllerIdentity) !== digest(a.delegatedControllerIdentity) ||
        ticket.expiresAt <= this.now()) throw new Error('live_ticket_invalid');
    const { mac, ticketMac, ...authorization } = value;
    if (!verify(createHash('sha256').update(ticket.ticketNonce).digest(), 'requests', context(this.marker),
      { purpose: 'live-source-ticket', authorization }, ticketMac)) throw new Error('live_ticket_possession_invalid');
  }
  authorize(value, step, target, selectionEpoch, coordinator) {
    this.checkTuple(value, step, target, selectionEpoch, coordinator);
    if (this.now() < value.issuedAt || this.now() >= value.expiresAt || value.expiresAt <= value.issuedAt) throw new Error('live_authorization_expired');
    this.delegation(value);
  }
  reserve(step, payload, coordinator) {
    const value = this.record('authorization', payload.authorizationDigest);
    if (payload.controllerEpoch !== value.authorization.controllerEpoch) throw new Error('live_controller_mismatch');
    this.authorize(value, step, payload.target, payload.selectionEpoch, coordinator);
    return payload.authorizationDigest;
  }
  revalidate(tx) {
    const { value } = this.reservation(tx);
    if (tx.controllerEpoch !== value.authorization.controllerEpoch) throw new Error('live_controller_mismatch');
    this.authorize(value, { ...tx, expectedGeneration: tx.source.generation, expectedPublicationEpoch: tx.source.publicationEpoch },
      tx.target, tx.successorReservation.selectionEpoch, tx.coordinator);
  }
  sourcePublished(tx) {
    const current = readState(this.markerPath, 'marker')?.value;
    if (current && digest(current) === digest(this.marker)) return true;
    // Missing/foreign/concordant-but-uncommitted publications all forbid reopen.
    return false;
  }
  publication(tx, publicationDigest, firstAcceptance = true, checkParticipants = true) {
    const { hash, value } = this.reservation(tx);
    const publication = this.record('publication', publicationDigest);
    if (firstAcceptance) this.revalidate(tx);
    const current = readState(this.markerPath, 'marker')?.value;
    if (publication.authorizationDigest !== hash || publication.markerDigest !== digest(value.targetPublication) ||
        !current || digest(current) !== publication.markerDigest || !tx.checkpointReferences.length ||
        digest(publication.checkpointReferences) !== digest(tx.checkpointReferences)) throw new Error('live_publication_mismatch');
    if (checkParticipants && tx.state !== 'RETIRED') this.participants.checkTransfer(tx, value.targetPublication);
    return { publicationDigest, markerDigest: publication.markerDigest };
  }
  verifyAuthority(tx) {
    if (!tx || tx.mode !== 'live-transfer' || this.sourcePublished(tx)) return false;
    const publication = Object.values(tx.stepResults).map(s => s.result).find(r => r?.publicationDigest && ['PUBLISHED', 'RETIRED'].includes(r.state));
    // This is the pure publication-authority read before reconciliation. The
    // registry may still be indeterminate; every retirement/fence checks the
    // participants after their required fsync/reconciliation has completed.
    if (publication) this.publication(tx, publication.publicationDigest, false, false);
    else if (digest(readState(this.markerPath, 'marker')?.value ?? null) !== digest(this.reservation(tx).value.targetPublication)) throw new Error('live_publication_mismatch');
    return true;
  }
  fence(tx) { this.participants.transfer(tx, this.reservation(tx).value.targetPublication); }
}
