import fs from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { marker, identity, hash } from './mh-l0-fixtures.js';
import { ColdAdministration } from '../../src/runtime/handover/administration.js';
import { PassiveLiveSource, liveTransactionReference } from '../../src/runtime/handover/live-source.js';
import { Participants } from '../../src/runtime/handover/participants.js';
import { digest, sign } from '../../src/runtime/handover/wire.js';
import { readState, publishState, replaceState } from '../../src/runtime/handover/state.js';

export function liveFixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l2-live-'));
  const managedRoot = join(directory, 'managed'), state = join(managedRoot, 'state');
  const stateDirectory = join(state, 'mcp', 'ns-a'), upgradeDirectory = join(state, 'upgrade');
  const root = join(directory, 'store'), rendezvous = join(directory, 'run');
  for (const path of [stateDirectory, join(upgradeDirectory, 'transactions'), join(upgradeDirectory, 'receipts'), root, rendezvous]) {
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const m = { ...marker(), stateDirectory, root, uid: process.getuid() }, markerPath = join(rendezvous, 'marker.json');
  publishState(markerPath, m, 'marker');
  const installation = { managedRoot, canonicalPrefix: directory, prefixId: m.prefixId, uid: m.uid };
  const rootKey = Buffer.alloc(32, 0x41), coordinator = { ...identity, pid: 125 };
  const next = { ...m, generation: '33333333-3333-4333-8333-333333333333', predecessorGeneration: m.generation,
    publicationEpoch: { ...m.publicationEpoch, counter: 2 }, processIdentity: { ...identity, pid: 124, startTime: 457 }, pid: 124,
    endpoint: 'http://127.0.0.1:43211/mcp', buildId: 'future-build', packageVersion: '0.98.8' };
  const target = { packageVersion: next.packageVersion, buildId: next.buildId, manifestDigest: next.manifestDigest, entrypoint: join(directory, 'next.js') };
  const ticket = { schemaVersion: 1, upgradeId: 'u', controllerEpoch: 2, expectedRevision: 1,
    delegatedBuildId: next.buildId, targetManifestDigest: next.manifestDigest, delegatedControllerIdentity: coordinator,
    ticketNonce: 'private-ticket-never-in-reports', expiresAt: 4000 };
  const receipt = { schemaVersion: 1, upgradeId: 'u', controllerEpoch: 2, previousRevision: 1,
    delegatedControllerIdentity: coordinator, delegatedBuildId: next.buildId, targetManifestDigest: next.manifestDigest, ticketDigest: digest(ticket) };
  const receiptDigest = digest(receipt), ticketPath = join(upgradeDirectory, 'ticket.json');
  const upgradePath = join(upgradeDirectory, 'transactions', 'u.json');
  const upgrade = { schemaVersion: 1, upgradeId: 'u', revision: 2, prefixId: m.prefixId, canonicalPrefix: directory, uid: m.uid,
    requestedTarget: next.packageVersion, resolvedTarget: next.packageVersion, artifactDigests: {}, targetManifestDigest: next.manifestDigest,
    origin: 'manual', initiatorIdentity: identity, controllerIdentity: coordinator, controllerBuildId: next.buildId, controllerEpoch: 2,
    controllerAuthorityState: 'ACTIVE', delegationState: 'DELEGATED', delegatedBuildId: next.buildId, delegationReceiptDigest: receiptDigest,
    privateTicketReference: 'ticket.json', installationState: 'ACTIVATING', selectionEpoch: 2, previousSelectionReference: null,
    componentTransactions: { mcp: relative(state, join(stateDirectory, liveTransactionReference('h'))) }, observations: {}, verification: {}, createdAt: 1, updatedAt: 1 };
  publishState(ticketPath, ticket, 'delegationTicket'); publishState(upgradePath, upgrade, 'upgradeTransaction');
  publishState(join(upgradeDirectory, 'receipts', `${receiptDigest.slice(7)}.json`), receipt, 'delegationReceipt');
  let now = 1500, closes = 0;
  const p = new Participants({ directory: stateDirectory, root, marker: m, writerProof: { evidenceDigest: hash, verify: () => 'qualified' } });
  const a = p.attach('a');
  a.bind({ notifications: { stop() {}, start() {} }, sessions: { list: () => [], suspend() {}, resume() {} },
    callTool: () => ({ content: [{ text: JSON.stringify({ state: 'identity_disabled' }) }] }) });
  a.snapshot = () => ({ schemaVersion: 1, attachmentId: 'a', ownershipEpoch: 1,
    context: { workspace: directory }, identity: {}, presence: [], downstreamProtocol: '2025-06-18', servedCatalogue: [],
    subscriptions: [], observedPeers: [], observedInbox: [], notifications: {}, negotiations: [], truncation: [], blockages: [],
    producedSequence: 0, deliveredSequence: 0, wakeState: {}, terminalReferences: [], delegationReferences: [], launches: [] });
  const live = new PassiveLiveSource({ installation, marker: m, markerPath, rootKey, participants: p, now: () => now });
  const admin = new ColdAdministration({ directory: stateDirectory, marker: m, now: () => now,
    inventory: () => p.inventory(), drain: () => p.drain(), liveSource: live,
    withMutationLock: fn => p.registry.withLock(fn), reconcileParticipants: tx => p.reconcileTransaction(tx),
    assertEligible: () => p.assertEligible(), barrier: tx => p.barrier(tx.handoverId),
    freeze: (_, tx) => p.freeze(tx.handoverId), checkpoint: (_, tx) => p.checkpoint(tx.handoverId),
    authorizeTarget: value => assertTarget(value), verifyPrecheck: () => {}, close: () => { closes++; } });
  function assertTarget(value) { if (digest(value) !== digest(target)) throw new Error('target_selection_mismatch'); }
  const authorization = { schemaVersion: 1, purpose: 'live-source-authorization', source: m, targetPublication: next, target,
    authorization: { upgradeId: 'u', handoverId: 'h', transactionEpoch: 1, controllerEpoch: 2,
      selectedManifestDigest: next.manifestDigest, delegatedControllerIdentity: coordinator, delegationReceiptDigest: receiptDigest },
    inventoryRevision: p.inventory().revision, selectionEpoch: 2, issuedAt: 1000, expiresAt: 3000 };
  const save = (kind, value, tamperMac = false) => {
    const context = { service: m.service, namespaceId: m.namespaceId, generation: m.generation };
    if (kind === 'authorization' && !Object.hasOwn(value, 'ticketMac')) value = { ...value,
      ticketMac: sign(createHash('sha256').update(ticket.ticketNonce).digest(), 'requests', context, { purpose: 'live-source-ticket', authorization: value }) };
    const signed = { ...value, mac: tamperMac ? '0'.repeat(64) : sign(rootKey, 'compatibility', context, value) };
    const hash = digest(signed);
    publishState(join(stateDirectory, `live-${kind}-${hash.slice(7)}.json`), signed, kind === 'authorization' ? 'liveSourceAuthorization' : 'liveSourcePublication');
    return hash;
  };
  const payload = authorizationDigest => ({ target, controllerEpoch: 2, selectionEpoch: 2, precheckEvidenceDigest: hash,
    authorizationDigest: authorizationDigest ?? save('authorization', authorization) });
  const step = (operation, value = {}, changes = {}, caller = coordinator) => admin.execute(operation, {
    protocolVersion: 1, mode: 'live-transfer', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
    expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: authorization.inventoryRevision,
    stepId: operation, payloadDigest: digest(value), ...changes }, value, caller);
  const freeze = () => { step('reserve', payload()); step('barrier', { deadline: 2500 }); step('freeze'); return step('checkpoint'); };
  const publication = (changes = {}, badMac = false) => {
    const tx = admin.transaction().value;
    return save('publication', { schemaVersion: 1, purpose: 'live-source-publication',
      authorizationDigest: live.reservation(tx).hash, markerDigest: digest(next), checkpointReferences: tx.checkpointReferences, ...changes }, badMac);
  };
  const publish = (value = next) => {
    const old = readState(markerPath, 'marker'); replaceState(markerPath, value, 'marker', old);
  };
  const changeUpgrade = changes => {
    const old = readState(upgradePath, 'upgradeTransaction'); replaceState(upgradePath, { ...old.value, ...changes, revision: old.value.revision + 1 }, 'upgradeTransaction', old);
  };
  return { directory, stateDirectory, root, m, next, markerPath, rootKey, coordinator, target, ticket, receipt, authorization,
    ticketPath, upgradePath, upgradeDirectory, p, a, live, admin, save, payload, step, freeze, publication, publish, changeUpgrade,
    now: value => { now = value; }, closes: () => closes, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
