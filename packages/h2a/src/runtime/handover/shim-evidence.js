import { join, relative } from 'node:path';
import { PassiveLiveSource } from './live-source.js';
import { readState } from './state.js';
import { validate, safeRelative } from './formats.js';
import { digest } from './wire.js';
import { checkCatalogue } from './catalogue.js';

// Both source and consumer derive expectations from durable authorization,
// never from a controller's claimed `expected` object. No verdict is computed.
export function shimEvidenceOptions(offer, { marker, markerPath, rootKey, installation, sourceView, attachmentId,
  inventoryRevision, challengeNonce, now = Date.now() }) {
  if (!installation) throw new Error('managed_delegation_required');
  validate('compatibilityEvidence', offer.proof);
  const control = readState(join(marker.stateDirectory, 'component-control.json'), 'componentControl')?.value;
  const tx = control?.activeTransaction && readState(join(marker.stateDirectory, control.activeTransaction), 'componentTransaction')?.value;
  if (!tx || !['RESERVED', 'BARRIER', 'FROZEN'].includes(tx.state)) throw new Error('evidence_transaction_state');
  if (inventoryRevision !== tx.inventoryRevision) throw new Error('inventory_stale');
  const targetMarker = validate('marker', offer.targetPublication);
  const descriptor = checkCatalogue(offer.descriptor);
  if (descriptor.descriptorDigest !== targetMarker.descriptorDigest || descriptor.contractDigest !== targetMarker.contractDigest) throw new Error('evidence_descriptor_mismatch');
  let a, verifierBuild;
  if (offer.proof.mode === 'handover') {
    if (tx.mode !== 'live-transfer' || tx.state !== 'FROZEN' || !tx.checkpointReferences.length) throw new Error('evidence_checkpoint_required');
    const live = new PassiveLiveSource({ installation, marker, markerPath, rootKey, now: () => now });
    live.revalidate(tx);
    const reservation = live.reservation(tx).value;
    if (digest(targetMarker) !== digest(reservation.targetPublication)) throw new Error('evidence_target_publication_mismatch');
    a = reservation.authorization; verifierBuild = targetMarker.buildId;
  } else {
    // Catalogue transactions grant no transfer or publication authority.
    if (tx.mode !== 'catalogue' || tx.source.generation !== marker.generation || digest(tx.source.publicationEpoch) !== digest(marker.publicationEpoch) ||
        digest(targetMarker) !== digest(marker) || digest(readState(markerPath, 'marker')?.value) !== digest(marker)) throw new Error('catalogue_target_not_published');
    const directory = join(installation.managedRoot, 'state', 'upgrade');
    if (!safeRelative(tx.upgradeId) || tx.upgradeId.includes('/')) throw new Error('evidence_upgrade_invalid');
    const upgrade = readState(join(directory, 'transactions', `${tx.upgradeId}.json`), 'upgradeTransaction')?.value;
    if (!upgrade || upgrade.prefixId !== installation.prefixId || upgrade.canonicalPrefix !== installation.canonicalPrefix || upgrade.uid !== installation.uid ||
        upgrade.controllerAuthorityState !== 'ACTIVE' || upgrade.delegationState !== 'DELEGATED' ||
        !['SELECTED', 'ACTIVATING'].includes(upgrade.installationState) || upgrade.controllerBuildId !== upgrade.delegatedBuildId ||
        upgrade.controllerEpoch !== tx.controllerEpoch || digest(upgrade.controllerIdentity) !== digest(tx.coordinator) ||
        upgrade.componentTransactions.mcp !== relative(join(installation.managedRoot, 'state'), join(marker.stateDirectory, control.activeTransaction))) throw new Error('evidence_delegation_mismatch');
    if (!upgrade.privateTicketReference || !upgrade.delegationReceiptDigest) throw new Error('evidence_ticket_missing');
    const ticket = readState(join(directory, upgrade.privateTicketReference), 'delegationTicket')?.value;
    const receipt = readState(join(directory, 'receipts', `${upgrade.delegationReceiptDigest.slice(7)}.json`), 'delegationReceipt')?.value;
    if (!ticket || !receipt || ticket.expiresAt <= now || digest(receipt) !== upgrade.delegationReceiptDigest || receipt.ticketDigest !== digest(ticket) ||
        ticket.expectedRevision !== receipt.previousRevision || upgrade.revision <= ticket.expectedRevision) throw new Error('evidence_ticket_invalid');
    for (const record of [ticket, receipt]) if (record.upgradeId !== tx.upgradeId || record.controllerEpoch !== tx.controllerEpoch ||
        record.delegatedBuildId !== upgrade.delegatedBuildId || record.targetManifestDigest !== upgrade.targetManifestDigest ||
        digest(record.delegatedControllerIdentity) !== digest(tx.coordinator)) throw new Error('evidence_ticket_invalid');
    a = { upgradeId: tx.upgradeId, handoverId: tx.handoverId, transactionEpoch: tx.transactionEpoch, controllerEpoch: tx.controllerEpoch,
      selectedManifestDigest: upgrade.targetManifestDigest, delegatedControllerIdentity: tx.coordinator, delegationReceiptDigest: upgrade.delegationReceiptDigest };
    verifierBuild = upgrade.delegatedBuildId;
  }
  const expected = { mode: offer.proof.mode, namespaceId: marker.namespaceId, root: marker.root, uid: marker.uid,
    attester: { generation: marker.generation, publicationEpoch: marker.publicationEpoch, processIdentity: marker.processIdentity, buildId: marker.buildId },
    source: sourceView, target: { generation: targetMarker.generation, publicationEpoch: targetMarker.publicationEpoch, endpoint: targetMarker.endpoint,
      buildId: targetMarker.buildId, manifestDigest: targetMarker.manifestDigest, descriptorDigest: descriptor.descriptorDigest,
      contractDigest: descriptor.contractDigest, catalogueRevision: offer.catalogueRevision }, attachmentId, inventoryRevision, authorization: a };
  const delegation = { controllerAuthorityState: 'ACTIVE', delegationState: 'DELEGATED', ...a,
    targetManifestDigest: a.selectedManifestDigest, controllerIdentity: a.delegatedControllerIdentity, delegatedBuildId: verifierBuild };
  return { rootKey, context: { service: marker.service, namespaceId: marker.namespaceId, generation: marker.generation },
    expected, delegation, report: offer.report, now, challengeNonce };
}
