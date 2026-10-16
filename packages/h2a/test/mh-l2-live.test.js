import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ColdAdministration } from '../src/runtime/handover/administration.js';
import { marker, identity, hash } from './helpers/mh-l0-fixtures.js';
import { digest } from '../src/runtime/handover/wire.js';
import { liveFixture } from './helpers/mh-l2-live.js';
import { readState, replaceState, publishState } from '../src/runtime/handover/state.js';
import { withWriterMutation, withExecution, updateWriterControl } from '../src/runtime/handover/mutation.js';
import { OwnershipRegistry, OperationLedger } from '../src/runtime/handover/ownership.js';

// Mutation campaign selects one explicitly named oracle without registering
// skipped tests. The campaign refuses a zero-test or skipped-test result.
const test = (name, fn) => {
  if (!process.env.MH_L2_LIVE_CASE || name === process.env.MH_L2_LIVE_CASE) nodeTest(name, fn);
};

test('owner A should accept passive live reservation without enabling a product live coordinator', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l2-live-contract-'));
  try {
    const m = marker();
    let authorized = 0;
    const admin = new ColdAdministration({ directory, marker: m, inventory: () => ({ revision: 1 }),
      authorizeTarget: () => {}, verifyPrecheck: () => {},
      liveSource: { reserve: () => { authorized++; return hash; } },
      drain: () => ({ revision: 1, calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 0 }), close: () => {} });
    const payload = { target: { packageVersion: '0.98.8', buildId: 'future', manifestDigest: hash,
      entrypoint: join(directory, 'future.js') }, selectionEpoch: 2, precheckEvidenceDigest: hash, authorizationDigest: hash };
    const step = { protocolVersion: 1, mode: 'live-transfer', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
      expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: 1,
      stepId: 'reserve', payloadDigest: digest(payload) };
    let result;
    assert.doesNotThrow(() => { result = admin.execute('reserve', step, payload, identity); });
    assert.deepEqual(result, { state: 'RESERVED', handoverId: 'h', authorizationDigest: hash });
    assert.equal(authorized, 1);
    assert.equal(admin.execute('describe', { ...step, stepId: 'describe', payloadDigest: digest({}) }, {}, identity).liveCoordinator, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('passive source should authenticate durable delegation, reserve idempotently and refuse a conflicting step', () => {
  const f = liveFixture();
  try {
    const payload = f.payload(), result = f.step('reserve', payload);
    assert.equal(result.state, 'RESERVED');
    assert.deepEqual(f.step('reserve', payload), result);
    assert.equal(f.admin.transaction().value.controllerEpoch, 2);
    assert.throws(() => f.step('reserve', { ...payload, selectionEpoch: 3 }), /step_conflict/);
    assert.equal(f.admin.status().transaction.target.buildId, 'future-build');
    assert.equal(f.step('describe').liveCoordinator, false);
  } finally { f.close(); }
});

const invalidAuthorizations = {
  'MAC': (a) => a,
  'ticket MAC': a => ({ ...a, ticketMac: '0'.repeat(64) }),
  'old generation': a => ({ ...a, source: { ...a.source, generation: '44444444-4444-4444-8444-444444444444' } }),
  'old publication epoch': a => ({ ...a, source: { ...a.source, publicationEpoch: { ...a.source.publicationEpoch, counter: 99 } } }),
  'old process': a => ({ ...a, source: { ...a.source, pid: 999, processIdentity: { ...a.source.processIdentity, pid: 999 } } }),
  'old build': a => ({ ...a, source: { ...a.source, buildId: 'wrong-old' } }),
  'new generation': a => ({ ...a, targetPublication: { ...a.targetPublication, generation: a.source.generation } }),
  'new predecessor': a => ({ ...a, targetPublication: { ...a.targetPublication, predecessorGeneration: null } }),
  'new epoch': a => ({ ...a, targetPublication: { ...a.targetPublication, publicationEpoch: a.source.publicationEpoch } }),
  'new endpoint': a => ({ ...a, targetPublication: { ...a.targetPublication, endpoint: a.source.endpoint } }),
  'new build': a => ({ ...a, targetPublication: { ...a.targetPublication, buildId: 'wrong-new' } }),
  'new manifest': a => ({ ...a, targetPublication: { ...a.targetPublication, manifestDigest: `sha256:${'b'.repeat(64)}` } }),
  'new root': a => ({ ...a, targetPublication: { ...a.targetPublication, root: '/wrong-root' } }),
  'new UID': a => ({ ...a, targetPublication: { ...a.targetPublication, uid: a.source.uid + 1 } }),
  'new namespace': a => ({ ...a, targetPublication: { ...a.targetPublication, namespaceId: 'foreign' } }),
  'new process frame': a => ({ ...a, targetPublication: { ...a.targetPublication, processIdentity: { ...a.targetPublication.processIdentity, nsNet: '999' } } }),
  'same process': a => ({ ...a, targetPublication: { ...a.targetPublication, processIdentity: a.source.processIdentity, pid: a.source.pid } }),
  'wrong controller': a => ({ ...a, authorization: { ...a.authorization, delegatedControllerIdentity: { ...a.authorization.delegatedControllerIdentity, pid: 999 } } }),
  'wrong handover': a => ({ ...a, authorization: { ...a.authorization, handoverId: 'other' } }),
  'wrong transaction epoch': a => ({ ...a, authorization: { ...a.authorization, transactionEpoch: 2 } }),
  'stale session inventory': a => ({ ...a, inventoryRevision: a.inventoryRevision + 1 }),
  'wrong selection epoch': a => ({ ...a, selectionEpoch: 3 }),
  'expired': a => ({ ...a, expiresAt: 1500 }),
  'not yet valid': a => ({ ...a, issuedAt: 1501 })
};
for (const [name, change] of Object.entries(invalidAuthorizations)) {
  test(`passive source should refuse signed authorization with ${name}`, () => {
    const f = liveFixture();
    try {
      const hash = f.save('authorization', change(f.authorization), name === 'MAC');
      assert.throws(() => f.step('reserve', f.payload(hash)), /live_|inventory_stale/);
      assert.equal(f.admin.transaction(), undefined);
      assert.equal(f.p.registry.owners()[0].state, 'ACTIVE');
    } finally { f.close(); }
  });
}

for (const [name, changes] of Object.entries({
  'revoked authority': { controllerAuthorityState: 'REVOKED' },
  'missing delegation': { delegationState: 'NONE' },
  'wrong controller epoch': { controllerEpoch: 3 },
  'wrong controller process': { controllerIdentity: { ...identity, pid: 999 } },
  'wrong controller build': { controllerBuildId: 'wrong' },
  'wrong target manifest': { targetManifestDigest: `sha256:${'b'.repeat(64)}` },
  'wrong component journal': { componentTransactions: { mcp: 'wrong.json' } },
  'wrong receipt': { delegationReceiptDigest: `sha256:${'b'.repeat(64)}` },
  'missing ticket': { privateTicketReference: null },
  'unselected installation': { installationState: 'PREPARED' }
})) {
  test(`passive source should refuse durable ${name}`, () => {
    const f = liveFixture();
    try { f.changeUpgrade(changes); assert.throws(() => f.step('reserve', f.payload()), /live_delegation_invalid|live_ticket_missing/); }
    finally { f.close(); }
  });
}

test('passive source should refuse missing, changed or expired private ticket and receipt', () => {
  for (const which of ['missing', 'changed', 'expired', 'receipt']) {
    const f = liveFixture();
    try {
      if (which === 'missing') fs.unlinkSync(f.ticketPath);
      if (which === 'changed') {
        const old = readState(f.ticketPath, 'delegationTicket');
        replaceState(f.ticketPath, { ...old.value, ticketNonce: 'changed' }, 'delegationTicket', old);
      }
      if (which === 'expired') f.now(4000);
      if (which === 'receipt') fs.unlinkSync(join(f.upgradeDirectory, 'receipts', `${digest(f.receipt).slice(7)}.json`));
      assert.throws(() => f.step('reserve', f.payload()), /live_ticket_invalid|live_authorization_expired/);
    } finally { f.close(); }
  }
});

test('passive source should revalidate source, coordinator, inventory and delegation before new mutations', () => {
  const f = liveFixture();
  try {
    const payload = f.payload();
    assert.throws(() => f.step('reserve', payload, { expectedGeneration: f.next.generation }), /source_authority_mismatch/);
    assert.throws(() => f.step('reserve', payload, { inventoryRevision: 99 }), /inventory_stale/);
    f.step('reserve', payload);
    assert.throws(() => f.step('barrier', { deadline: 2500 }, {}, { ...f.coordinator, pid: 999 }), /transaction_authority_mismatch/);
    f.changeUpgrade({ controllerAuthorityState: 'REVOKED' });
    assert.throws(() => f.step('barrier', { deadline: 2500 }), /live_delegation_invalid/);
    assert.equal(f.p.writerControl().gate, 'OPEN');
  } finally { f.close(); }
});

test('passive retirement should preserve admitted G0 work and fence owners only after authenticated concordant publication', () => {
  const f = liveFixture();
  try {
    const operation = f.a.begin('call');
    const checkpoint = f.freeze();
    const publicationDigest = f.publication();
    assert.throws(() => f.step('retire', { publicationDigest }), /live_publication_mismatch/);
    assert.equal(f.p.registry.owners()[0].state, 'FROZEN');
    f.publish();
    assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
    assert.equal(f.admin.status().state, 'PUBLISHED');
    assert.equal(f.p.registry.owners()[0].state, 'TRANSFERRING');
    assert.equal(f.admin.admissionsOpen(), false);
    assert.equal(f.closes(), 0);
    assert.equal(f.step('drain-status').calls, 1);
    assert.throws(() => f.a.begin('call'), /ownership_fenced/);
    assert.throws(() => f.a.runOwner(() => withWriterMutation(f.root, 'registry', () => {})), /ownership_fenced/);
    withExecution(f.a.authority(operation), () => withWriterMutation(f.root, 'registry', () => fs.writeFileSync(join(f.root, 'g0-result'), 'saved')));
    f.a.finish(operation, { result: 'saved' });
    assert.equal(fs.readFileSync(join(f.root, 'g0-result'), 'utf8'), 'saved');
    assert.equal(f.p.ledger.effects('a').length, 1);
    const result = f.step('retire', { publicationDigest });
    assert.equal(result.state, 'RETIRED'); assert.equal(f.closes(), 1);
    assert.deepEqual(f.step('retire', { publicationDigest }), result);
    assert.deepEqual(f.step('checkpoint'), checkpoint);
    assert.throws(() => f.step('abort'), /stop_irreversible/);
    f.now(9000); assert.equal(f.admin.expire(), false);
    assert.equal(f.admin.admissionsOpen(), false);
    assert.equal(f.closes(), 1);
  } finally { f.close(); }
});

for (const [name, change, badMac] of [
  ['MAC', {}, true], ['authorization', { authorizationDigest: hash }],
  ['target', { markerDigest: hash }], ['checkpoint', { checkpointReferences: [] }]
]) {
  test(`passive source should refuse publication with wrong ${name} before fencing or closing`, () => {
    const f = liveFixture();
    try {
      f.freeze(); const publicationDigest = f.publication(change, badMac); f.publish();
      assert.throws(() => f.step('retire', { publicationDigest }), /live_record_unauthenticated|live_publication_mismatch/);
      assert.equal(f.admin.status().state, 'FROZEN'); assert.equal(f.closes(), 0);
      assert.equal(f.p.registry.owners()[0].state, 'FROZEN');
    } finally { f.close(); }
  });
}

test('passive source should require a frozen checkpoint, unchanged inventory and current delegation at publication', () => {
  for (const name of ['freeze', 'checkpoint', 'inventory', 'delegation', 'expiry', 'barrier', 'owner', 'bytes']) {
    const f = liveFixture();
    try {
      if (name === 'freeze') {
        f.step('reserve', f.payload()); f.step('barrier', { deadline: 2500 });
      } else {
        f.freeze();
        if (name === 'checkpoint') {
          const owner = readState(f.p.registry.ownerPath('a'), 'ownership');
          replaceState(f.p.registry.ownerPath('a'), { ...owner.value, checkpointHash: null }, 'ownership', owner);
        }
        if (name === 'inventory') f.p.inventoryRevision++;
        if (name === 'delegation') f.changeUpgrade({ controllerAuthorityState: 'REVOKED' });
        if (name === 'expiry') f.now(3000);
        if (name === 'barrier') f.now(2500);
        if (name === 'owner') {
          const owner = readState(f.p.registry.ownerPath('a'), 'ownership');
          replaceState(f.p.registry.ownerPath('a'), { ...owner.value, state: 'ACTIVE' }, 'ownership', owner);
        }
        if (name === 'bytes') fs.appendFileSync(join(f.stateDirectory, f.admin.transaction().value.checkpointReferences[0]), ' ');
      }
      const publicationDigest = f.publication(); f.publish();
      assert.throws(() => f.step('retire', { publicationDigest }), /live_|inventory_stale|barrier_expired|checkpoint_binding_mismatch|noncanonical_state/);
      assert.equal(f.closes(), 0);
      assert.equal(f.admin.status().state, name === 'freeze' ? 'BARRIER' : 'FROZEN');
    } finally { f.close(); }
  }
});

test('uncommitted publication or contradiction should prevent expiration, abort and operator stop from reopening G0', () => {
  for (const target of ['concordant', 'foreign', 'missing']) {
    const f = liveFixture();
    try {
      f.freeze(); const publicationDigest = f.publication();
      if (target === 'missing') fs.unlinkSync(f.markerPath);
      else f.publish(target === 'foreign' ? { ...f.next, buildId: 'foreign' } : f.next);
      assert.throws(() => f.step('abort'), /live_publication_requires_reconciliation/);
      assert.equal(f.admin.status().state, 'RECOVERY_BLOCKED');
      f.now(2600); assert.equal(f.admin.expire(), false);
      f.admin.operatorStop(); assert.equal(f.closes(), 0);
      assert.equal(f.p.writerControl().gate, 'BARRIER');
      assert.equal(f.p.registry.owners()[0].state, 'FROZEN');
      assert.equal(f.admin.admissionsOpen(), false);
      if (target === 'concordant') {
        f.now(1500);
        assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED');
      }
    } finally { f.close(); }
  }
});

test('unpublished live source should abort on expiry and reopen only after durable ABORTED', () => {
  const f = liveFixture();
  try {
    f.freeze(); f.now(2600);
    assert.equal(f.admin.expire(), true);
    assert.equal(f.admin.status().state, 'ABORTED');
    assert.equal(f.admin.admissionsOpen(), true);
    assert.equal(f.p.writerControl().gate, 'OPEN');
    assert.equal(f.p.registry.owners()[0].state, 'ACTIVE');
  } finally { f.close(); }
});

test('passive retirement should persist publication before fencing and reconcile uncertain ACK without reopening', t => {
  const f = liveFixture();
  try {
    const operation = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
    const fsync = fs.fsyncSync; let injected = false;
    t.mock.method(fs, 'fsyncSync', fd => {
      if (!injected && fs.fstatSync(fd).isDirectory()) { injected = true; throw new Error('injected_publication_fsync'); }
      return fsync(fd);
    });
    assert.throws(() => f.step('retire', { publicationDigest }), /persistence_indeterminate/);
    t.mock.restoreAll();
    assert.equal(f.admin.status().state, 'PUBLISHED');
    assert.equal(f.p.registry.owners()[0].state, 'FROZEN');
    assert.equal(f.closes(), 0); assert.equal(f.admin.admissionsOpen(), false);
    f.admin.reconcile();
    assert.equal(f.p.registry.owners()[0].state, 'TRANSFERRING');
    assert.throws(() => f.step('abort'), /stop_irreversible/);
    f.a.finish(operation, { ok: true });
    assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED'); assert.equal(f.closes(), 1);
  } finally { t.mock.restoreAll(); f.close(); }
});

test('passive source should preserve exact acquired G1 ownership and reject foreign generation, epoch or process', async () => {
  for (const variant of ['valid', 'generation', 'epoch', 'process']) {
    const f = liveFixture();
    try {
      const operation = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
      assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
      const path = f.p.registry.ownerPath('a'), old = readState(path, 'ownership');
      const next = { ...old.value, state: 'ACTIVE', ownerGeneration: f.next.generation, ownershipEpoch: old.value.ownershipEpoch + 1,
        ownerProcessIdentity: f.next.processIdentity };
      if (variant === 'generation') next.ownerGeneration = '44444444-4444-4444-8444-444444444444';
      if (variant === 'epoch') next.ownershipEpoch++;
      if (variant === 'process') next.ownerProcessIdentity = { ...next.ownerProcessIdentity, startTime: 999 };
      f.p.registry.withLock(() => replaceState(path, next, 'ownership', old));
      f.a.finish(operation, { ok: true });
      if (variant === 'valid') {
        assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED');
        let detached = 0; await f.a.close(() => { detached++; });
        assert.equal(detached, 1); assert.deepEqual(readState(path, 'ownership').value, next);
      } else {
        assert.throws(() => f.step('retire', { publicationDigest }), /ownership_fenced/);
        assert.equal(f.closes(), 0);
      }
    } finally { f.close(); }
  }
});

test('passive source should refuse content changed under its immutable authorization digest', () => {
  const f = liveFixture();
  try {
    const hash = f.save('authorization', f.authorization);
    const path = join(f.stateDirectory, `live-authorization-${hash.slice(7)}.json`);
    const different = f.save('authorization', { ...f.authorization, expiresAt: 3001 });
    fs.copyFileSync(join(f.stateDirectory, `live-authorization-${different.slice(7)}.json`), path);
    assert.throws(() => f.step('reserve', f.payload(hash)), /live_record_unauthenticated/);
  } finally { f.close(); }
});

test('passive source should retire after valid publication and zero drain', () => {
  const f = liveFixture();
  try {
    f.freeze(); const publicationDigest = f.publication(); f.publish();
    let result;
    assert.doesNotThrow(() => { result = f.step('retire', { publicationDigest }); });
    assert.equal(result.state, 'RETIRED');
    assert.equal(f.p.registry.owners()[0].state, 'TRANSFERRING');
    assert.equal(f.closes(), 1);
  } finally { f.close(); }
});

test('uncommitted publication should prevent expiration before any administrative reconciliation', () => {
  for (const target of ['concordant', 'foreign', 'missing']) {
    const f = liveFixture();
    try {
      f.freeze();
      if (target === 'missing') fs.unlinkSync(f.markerPath);
      else f.publish(target === 'foreign' ? { ...f.next, buildId: 'foreign' } : f.next);
      f.now(2600); assert.equal(f.admin.expire(), false);
      assert.equal(f.admin.status().state, 'RECOVERY_BLOCKED');
      assert.equal(f.admin.admissionsOpen(), false);
      assert.equal(f.p.writerControl().gate, 'BARRIER');
    } finally { f.close(); }
  }
});

test('uncommitted publication should prevent operator stop from aborting before reconciliation', () => {
  const f = liveFixture();
  try {
    f.freeze(); f.publish();
    assert.equal(f.admin.operatorStop().state, 'pause_active_stop_deferred');
    assert.equal(f.admin.status().state, 'FROZEN'); assert.equal(f.closes(), 0);
    assert.equal(f.p.writerControl().gate, 'BARRIER');
  } finally { f.close(); }
});

test('passive retirement should accept every valid stepId and resume its own durable publication after a lost ACK', () => {
  for (const secondStep of [false, true]) {
  const f = liveFixture();
  try {
    const operation = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
    const changes = { stepId: 'live-publication' };
    assert.throws(() => f.step('retire', { publicationDigest }, changes), /drain_blocked/);
    f.a.finish(operation, { ok: true });
    let result;
    assert.doesNotThrow(() => { result = f.step('retire', { publicationDigest }, secondStep ? { stepId: 'completed-retire' } : changes); });
    assert.equal(result.state, 'RETIRED'); assert.equal(f.closes(), 1);
    assert.deepEqual(f.step('retire', { publicationDigest }, changes), result);
    assert.throws(() => f.step('retire', { publicationDigest: hash }, changes), /step_conflict/);
  } finally { f.close(); }
  }
});

function acquirePeer(f) {
  const ownerPath = f.p.registry.ownerPath('a'), owner = readState(ownerPath, 'ownership');
  const acquired = { ...owner.value, state: 'ACTIVE', ownerGeneration: f.next.generation,
    ownerProcessIdentity: f.next.processIdentity, ownershipEpoch: owner.value.ownershipEpoch + 1 };
  const controlPath = join(f.stateDirectory, 'component-control.json'), control = readState(controlPath, 'componentControl');
  f.p.registry.withLock(() => {
    replaceState(ownerPath, acquired, 'ownership', owner);
    replaceState(controlPath, { ...control.value, revision: control.value.revision + 1, sourceGeneration: f.next.generation,
      ownerIdentity: f.next.processIdentity, ownerState: 'ACTIVE' }, 'componentControl', control);
    updateWriterControl(f.root, { gate: 'OPEN', handoverId: null });
  });
  const registry = new OwnershipRegistry({ directory: f.stateDirectory, generation: f.next.generation,
    processIdentity: f.next.processIdentity, lockDirectory: f.p.registry.lockDirectory });
  return { registry, ledger: new OperationLedger(registry), token: registry.token(acquired) };
}

test('passive source should retire after the authenticated acquired G1 opens its writer gate', () => {
  const f = liveFixture();
  try {
    const oldCall = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
    assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
    acquirePeer(f); f.a.finish(oldCall, { ok: true });
    let result;
    assert.doesNotThrow(() => { result = f.step('retire', { publicationDigest }); });
    assert.equal(result.state, 'RETIRED'); assert.equal(f.closes(), 1);
    assert.equal(f.p.writerControl().gate, 'OPEN');
  } finally { f.close(); }
});

test('passive source should drain only G0 while independently admitted G1 calls remain pending', () => {
  const f = liveFixture();
  try {
    const oldCall = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
    assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
    const peer = acquirePeer(f), newCall = peer.ledger.begin(peer.token, 'g1-call', 'call');
    withExecution({ root: f.root, registry: peer.registry, ledger: peer.ledger, token: peer.token, operation: newCall },
      () => withWriterMutation(f.root, 'registry', () => fs.writeFileSync(join(f.root, 'g1-work'), 'admitted')));
    assert.equal(f.p.drain().calls, 1, 'G0 drain must count its old call, not the new G1 call');
    assert.throws(() => f.a.runOwner(() => withWriterMutation(f.root, 'presence', () => {})), /ownership_fenced/);
    f.a.finish(oldCall, { outcome: 'unknown' }, true);
    assert.equal(f.p.drain().calls, 1); assert.equal(f.p.drain().effects, 1);
    assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
    f.a.finish(oldCall, { ok: true });
    assert.equal(f.p.drain().complete, true);
    assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED');
    assert.doesNotThrow(() => peer.ledger.assertOperation(newCall));
    peer.ledger.finish(newCall, { ok: true });
  } finally { f.close(); }
});

test('passive source should neither reconcile nor count new G1 launch memos', () => {
  for (const receiptPresent of [false, true]) {
    const f = liveFixture();
    try {
      const oldCall = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
      assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
      acquirePeer(f); f.a.finish(oldCall, { ok: true });
      const memo = { schemaVersion: 1, attachmentId: 'a', launchName: 'g1-next', launchId: 'g1-launch',
        initialArgumentsDigest: hash, state: 'launching', executionOwner: f.next.processIdentity,
        childProcessIdentity: null, launchReceiptReference: 'g1-receipt.json', launchTokenBinding: digest('g1-token'),
        briefReceipt: null, terminalResult: null, retrySafe: false };
      const path = join(f.stateDirectory, `launch-${digest({ attachmentId: 'a', launchName: 'g1-next' }).slice(7)}.json`);
      publishState(path, memo, 'launchMemo');
      publishState(join(f.stateDirectory, 'launch-location-g1-launch.json'), { schemaVersion: 1, launchId: 'g1-launch',
        attachmentId: 'a', workspaceRoot: f.directory, delegation: null }, 'launchLocation');
      if (receiptPresent) fs.writeFileSync(join(f.directory, 'g1-receipt.json'), JSON.stringify({ token: 'g1-token', state: 'stopped' }));
      const before = fs.readFileSync(path);
      assert.equal(f.p.drain().complete, true);
      assert.deepEqual(fs.readFileSync(path), before, 'G0 must not mutate the new G1 launch during its source drain');
      assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED');
    } finally { f.close(); }
  }
});

test('passive source should refuse an opened gate without the exact acquired target authority', () => {
  for (const variant of ['generation', 'identity', 'state', 'handover']) {
    const f = liveFixture();
    try {
      const oldCall = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
      assert.throws(() => f.step('retire', { publicationDigest }), /drain_blocked/);
      acquirePeer(f); f.a.finish(oldCall, { ok: true });
      const path = join(f.stateDirectory, 'component-control.json'), old = readState(path, 'componentControl');
      const changes = variant === 'generation' ? { sourceGeneration: f.m.generation }
        : variant === 'identity' ? { ownerIdentity: f.m.processIdentity } : variant === 'state' ? { ownerState: 'CLOSED' } : {};
      replaceState(path, { ...old.value, ...changes, revision: old.value.revision + 1 }, 'componentControl', old);
      if (variant === 'handover') updateWriterControl(f.root, { handoverId: 'foreign' });
      assert.throws(() => f.step('retire', { publicationDigest }), /barrier_required/);
      assert.equal(f.closes(), 0); assert.equal(f.admin.admissionsOpen(), false);
    } finally { f.close(); }
  }
});

test('passive source should reconcile an uncertain ownership fence before checking participants again', t => {
  const f = liveFixture();
  try {
    f.admin.options.verifyAuthority = (_operation, tx) => f.live.verifyAuthority(tx);
    const oldCall = f.a.begin('call'); f.freeze(); const publicationDigest = f.publication(); f.publish();
    const fsync = fs.fsyncSync; let directories = 0;
    t.mock.method(fs, 'fsyncSync', fd => {
      if (fs.fstatSync(fd).isDirectory() && ++directories === 2) throw new Error('injected_fence_fsync');
      return fsync(fd);
    });
    assert.throws(() => f.step('retire', { publicationDigest }), /persistence_indeterminate/);
    t.mock.restoreAll();
    assert.equal(f.admin.status().state, 'PUBLISHED'); assert.equal(f.p.registry.indeterminate, true);
    assert.equal(f.closes(), 0); assert.equal(f.admin.admissionsOpen(), false);
    assert.doesNotThrow(() => f.admin.reconcile());
    assert.equal(f.p.registry.indeterminate, false);
    assert.equal(f.p.registry.owners()[0].state, 'TRANSFERRING');
    f.a.finish(oldCall, { ok: true });
    assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED');
  } finally { t.mock.restoreAll(); f.close(); }
});

test('passive source should revalidate selection, entry and precheck before publication commitment', () => {
  for (const [hook, reason] of [['authorizeTarget', 'target_selection_mismatch'], ['verifyEntry', 'external_install_detected'], ['verifyPrecheck', 'precheck_evidence_mismatch']]) {
    const f = liveFixture();
    try {
      f.freeze(); const publicationDigest = f.publication(); f.publish();
      f.admin.options[hook] = () => { throw new Error(reason); };
      assert.throws(() => f.step('retire', { publicationDigest }), new RegExp(reason));
      assert.equal(f.admin.status().state, 'FROZEN'); assert.equal(f.closes(), 0);
      assert.equal(f.p.registry.owners()[0].state, 'FROZEN');
    } finally { f.close(); }
  }
});
