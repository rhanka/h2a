import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ColdAdministration } from '../src/runtime/handover/administration.js';
import { marker, identity, hash } from './helpers/mh-l0-fixtures.js';
import { digest } from '../src/runtime/handover/wire.js';
import { liveFixture } from './helpers/mh-l2-live.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';
import { withWriterMutation, withExecution } from '../src/runtime/handover/mutation.js';

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
    assert.deepEqual(admin.execute('reserve', step, payload, identity), { state: 'RESERVED', handoverId: 'h', authorizationDigest: hash });
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
