import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marker, identity, hash } from './helpers/mh-l0-fixtures.js';
import { digest } from '../src/runtime/handover/wire.js';

test('M23/M24 should persist internal stop before close, reconcile lost ACK and never reopen', async () => {
  const { ColdAdministration } = await import('../src/runtime/handover/administration.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-cold-'));
  try {
    let now = 1000, calls = 1, closed = 0;
    const m = marker();
    const admin = new ColdAdministration({ directory: dir, marker: m, now: () => now,
      inventory: () => ({ revision: 1 }), drain: () => ({ revision: 1, calls, children: 0, briefs: 0, callbacks: 0, effects: 0 }),
      authorizeTarget: target => assert.equal(target.manifestDigest, hash),
      verifyPrecheck: evidence => assert.equal(evidence, hash),
      close: () => { assert.equal(admin.status().state, 'STOP_COMMITTED'); closed++; } });
    const target = { packageVersion: '0.98.7', buildId: 'next', manifestDigest: hash, entrypoint: join(dir, 'next.js') };
    const step = (operation, payload = {}, stepId = operation) => admin.execute(operation, {
      protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
      expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch,
      inventoryRevision: 1, stepId, payloadDigest: digest(payload) }, payload, identity);
    step('reserve', { target, selectionEpoch: 2, precheckEvidenceDigest: hash });
    const barrier = step('barrier', { deadline: 2000 });
    assert.equal(admin.admissionsOpen(), false);
    assert.deepEqual(step('barrier', { deadline: 2000 }), barrier);
    assert.throws(() => step('barrier', { deadline: 2100 }), /step_conflict/);
    const commit = { sourceGeneration: m.generation, sourceProcessIdentity: m.processIdentity,
      barrierId: barrier.barrierId, expectedDrainRevision: 1, expectedInventoryRevision: 1,
      targetBuildId: target.buildId, targetManifestDigest: hash, targetEntrypoint: target.entrypoint,
      selectionEpoch: 2, precheckEvidenceDigest: hash };
    assert.throws(() => step('commit-stop', commit), /drain_blocked/);
    assert.equal(closed, 0);
    calls = 0;
    const ack = step('commit-stop', commit);
    assert.equal(closed, 1);
    assert.equal(fs.existsSync(join(dir, 'operator-stop.json')), false);
    const recovered = new ColdAdministration({ ...admin.options, close: () => { closed++; } });
    assert.deepEqual(recovered.execute('commit-stop', { protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
      expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: 1,
      stepId: 'commit-stop', payloadDigest: digest(commit) }, commit, identity), ack);
    now = 3000;
    assert.equal(recovered.expire(), false);
    assert.equal(recovered.admissionsOpen(), false);
    assert.throws(() => step('abort'), /stop_irreversible/);
    assert.equal(closed, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('operator pause should remain armed after timeout, cancel explicitly before commit and never clear on upgrade', async () => {
  const { ColdAdministration } = await import('../src/runtime/handover/administration.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-pause-'));
  try {
    let calls = 1, closes = 0;
    const admin = new ColdAdministration({ directory: dir, marker: marker(),
      inventory: () => ({ revision: 1 }), drain: () => ({ revision: 1, calls, children: 0, briefs: 0, callbacks: 0, effects: 0 }), close: () => { closes++; } });
    assert.equal(admin.operatorStop().state, 'pause_active_stop_deferred');
    assert.equal(admin.admissionsOpen(), false);
    admin.resume();
    assert.equal(admin.admissionsOpen(), true);
    admin.operatorStop(); calls = 0; admin.poll();
    assert.equal(closes, 1);
    assert.equal(admin.operatorStop().state, 'STOP_COMMITTED');
    admin.resume(); assert.equal(admin.admissionsOpen(), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M25 should durably consume at most three attempts, refuse live/unknown candidates and preserve pins', async () => {
  const { reserveSuccessorAttempt, recordSuccessor, failSuccessor } = await import('../src/runtime/handover/successor.js');
  const { publishState, readState } = await import('../src/runtime/handover/state.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-successor-'));
  try {
    const m = marker(), path = join(dir, 'transaction.json');
    const transaction = { schemaVersion: 1, revision: 1, component: 'mcp', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
      mode: 'cold-stop', source: { generation: m.generation, publicationEpoch: m.publicationEpoch, processIdentity: identity,
        packageVersion: m.packageVersion, buildId: m.buildId, manifestDigest: hash },
      target: { packageVersion: '0.98.7', buildId: 'next', manifestDigest: hash, entrypoint: '/lab/next.js' }, coordinator: identity,
      controllerEpoch: 1, inventoryRevision: 1, state: 'STOPPED', barrierDeadline: null, precheckEvidenceDigest: hash,
      checkpointReferences: [], stepResults: {}, successorReservation: { attempts: 0, candidateIdentity: null, selectionEpoch: 2, targetManifestDigest: hash } };
    publishState(path, transaction, 'componentTransaction');
    const options = { sourceLiveness: 'dead', candidateLiveness: 'dead', selectionEpoch: 2, targetManifestDigest: hash, paused: false };
    for (let i = 1; i <= 3; i++) {
      const ticket = reserveSuccessorAttempt(path, options);
      assert.equal(readState(path, 'componentTransaction').value.successorReservation.attempts, i);
      assert.throws(() => reserveSuccessorAttempt(path, { ...options, candidateLiveness: 'unknown' }), /candidate_liveness_unknown/);
      recordSuccessor(path, ticket, { ...identity, pid: 124 });
      assert.throws(() => reserveSuccessorAttempt(path, { ...options, candidateLiveness: 'alive' }), /candidate_alive/);
      failSuccessor(path, ticket, 'startup_failed', 'dead');
    }
    assert.equal(readState(path, 'componentTransaction').value.state, 'SUCCESSOR_FAILED');
    assert.throws(() => reserveSuccessorAttempt(path, options), /successor_failed/);
    assert.equal(fs.existsSync(path), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M24 should keep admissions closed after indeterminate fsync and reconcile the committed journal before close', async t => {
  const { ColdAdministration } = await import('../src/runtime/handover/administration.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-indeterminate-'));
  try {
    let closes = 0;
    const m = marker(), target = { packageVersion: '0.98.7', buildId: 'next', manifestDigest: hash, entrypoint: '/lab/next.js' };
    const admin = new ColdAdministration({ directory: dir, marker: m, inventory: () => ({ revision: 1 }),
      drain: () => ({ revision: 1, calls: 0, children: 0, briefs: 0, callbacks: 0, effects: 0 }),
      authorizeTarget: () => {}, verifyPrecheck: () => {}, close: () => { closes++; } });
    const step = (operation, payload) => admin.execute(operation, { protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h',
      transactionEpoch: 1, expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch,
      inventoryRevision: 1, stepId: operation, payloadDigest: digest(payload) }, payload, identity);
    step('reserve', { target, selectionEpoch: 2, precheckEvidenceDigest: hash });
    const barrier = step('barrier', { deadline: Date.now()+10000 });
    const sync = fs.fsyncSync; let count = 0;
    t.mock.method(fs, 'fsyncSync', fd => { if (++count === 2) throw new Error('injected_directory_fsync'); sync(fd); });
    assert.throws(() => step('commit-stop', { sourceGeneration: m.generation, sourceProcessIdentity: identity,
      barrierId: barrier.barrierId, expectedDrainRevision: 1, expectedInventoryRevision: 1, targetBuildId: 'next', targetManifestDigest: hash,
      targetEntrypoint: target.entrypoint, selectionEpoch: 2, precheckEvidenceDigest: hash }), /persistence_indeterminate/);
    t.mock.restoreAll();
    assert.equal(admin.admissionsOpen(), false);
    assert.equal(closes, 0);
    assert.equal(admin.reconcile().state, 'STOP_COMMITTED');
    assert.equal(closes, 1);
    admin.poll(); assert.equal(closes, 1);
  } finally { t.mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});
