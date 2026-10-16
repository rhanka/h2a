import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { readState, publishState, replaceState } from '../src/runtime/handover/state.js';
import { digest } from '../src/runtime/handover/wire.js';
import { acquirePrefixLock } from '../dist/runtime/local-files/succession-lock.js';
const { UpgradeStore } = await import('../dist/runtime/upgrade/h4-store.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {};
});
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
function store(t) {
  assert.equal(typeof UpgradeStore, 'function', 'H4 durable selection engine required');
  const f = installationFixture(); t.after(() => f.close());
  return { ...f, store: new UpgradeStore(f.layout) };
}

test('U05 should select once with canonical journal, history and pins across HOME changes', t => {
  const f = store(t), target = f.image();
  const tx = f.store.begin({ upgradeId: 'first', target, origin: 'bootstrap', artifactDigests: { tarball: target.manifestDigest } });
  assert.equal(tx.installationState, 'PREPARING');
  assert.equal(f.store.prepare('first').installationState, 'PREPARED');
  const selected = f.store.select('first');
  assert.equal(selected.installationState, 'SELECTED');
  const selection = readState(join(f.state, 'selected-build.json'), 'selection').value;
  assert.equal(selection.manifestDigest, target.manifestDigest);
  assert.equal(selection.selectionEpoch, 1);
  assert.deepEqual(readState(join(f.state, 'selection-history/1.json'), 'selection')?.value, selection);
  assert.deepEqual(readState(join(f.state, 'last-valid-selection.json'), 'selection')?.value, selection);
  assert.equal(readState(join(f.state, 'pins/upgrade-first.json'), 'imagePin')?.value.targetManifestDigest, target.manifestDigest);
  for (const key of ['HOME', 'XDG_STATE_HOME']) {
    const prior = process.env[key]; process.env[key] = join(f.layout.canonicalPrefix, `other-${key}`);
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  assert.deepEqual(new UpgradeStore(f.layout).status('first'), selected);
  assert.deepEqual(f.store.select('first'), selected, 'lost ACK is idempotent');
});

test('U05 should reconcile every selection persistence cut forward without a second epoch', t => {
  const sync = fs.fsyncSync;
  // Intention, selection, history, last-valid and SELECTED each have file+directory syncs.
  for (let failAt = 1; failAt <= 11; failAt++) {
    const f = store(t), target = f.image(`cut-${failAt}`);
    f.store.begin({ upgradeId: 'cut', target }); f.store.prepare('cut');
    let count = 0;
    t.mock.method(fs, 'fsyncSync', fd => { if (++count === failAt) throw new Error('injected_sync_cut'); sync(fd); });
    assert.throws(() => f.store.select('cut'), /injected_sync_cut|persistence_indeterminate/, `cut ${failAt}`);
    t.mock.restoreAll();
    const recovered = f.store.reconcile('cut');
    assert.equal(recovered.installationState, failAt === 1 ? 'PREPARED' : 'SELECTED', `cut ${failAt}`);
    if (failAt === 1) f.store.select('cut');
    const selection = readState(join(f.state, 'selected-build.json'), 'selection').value;
    assert.equal(selection.selectionEpoch, 1);
    assert.equal(selection.manifestDigest, target.manifestDigest);
    assert.deepEqual(readState(join(f.state, 'selection-history/1.json'), 'selection').value, selection);
  }
});

test('U05 should exclude the actual legacy prefix lock and coalesce only the same request', t => {
  const f = store(t), target = f.image();
  const legacy = acquirePrefixLock(f.layout.canonicalPrefix);
  assert.equal(legacy.acquired, true);
  try { assert.throws(() => f.store.begin({ upgradeId: 'one', target }), /legacy_lock_unavailable/); }
  finally { legacy.release(); }
  assert.equal(fs.existsSync(join(f.state, 'upgrade/transactions/one.json')), false);
  const first = f.store.begin({ upgradeId: 'one', target });
  assert.deepEqual(f.store.begin({ upgradeId: 'one', target }), first);
  assert.throws(() => f.store.begin({ upgradeId: 'two', target }), /upgrade_in_progress/);
  assert.throws(() => f.store.begin({ upgradeId: 'one', target: f.image('other') }), /upgrade_request_conflict/);
  assert.throws(() => f.store.begin({ upgradeId: '../escape', target }), /upgrade_id_invalid/);
});

test('U06 should refuse foreign layout, unknown controllers and changed payload before selection', t => {
  const f = store(t), target = f.image();
  assert.throws(() => new UpgradeStore({ ...f.layout, managedRoot: f.layout.canonicalPrefix }), /foreign_installation_authority/);
  assert.throws(() => f.store.begin({ upgradeId: 'pre-h4', target: f.image('old', 99) }), /controller_protocol_incompatible/);
  f.store.begin({ upgradeId: 'valid', target }); f.store.prepare('valid');
  fs.appendFileSync(join(target.root, 'entry.mjs'), 'export const tampered=true;');
  assert.throws(() => f.store.select('valid'), /payload_mismatch/);
  assert.equal(fs.existsSync(join(f.state, 'selected-build.json')), false);
});

test('U06 should block contradictory selection and preserve all diagnostic bytes', t => {
  const f = store(t), target = f.image();
  f.store.begin({ upgradeId: 'one', target }); f.store.prepare('one');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to.endsWith('/selected-build.json')) throw new Error('injected_rename_cut'); return rename(from, to); });
  // Initial selection uses link(2), so interrupt that publication specifically.
  const link = fs.linkSync;
  t.mock.method(fs, 'linkSync', (from, to) => { if (to.endsWith('/selected-build.json')) throw new Error('injected_link_cut'); return link(from, to); });
  assert.throws(() => f.store.select('one'), /injected_link_cut/); t.mock.restoreAll();
  const intent = f.store.status('one').observations.selectionIntent;
  publishState(join(f.state, 'selected-build.json'), { ...intent, buildId: 'foreign' }, 'selection');
  const paths = ['selected-build.json', 'upgrade/transactions/one.json'];
  const before = paths.map(p => fs.readFileSync(join(f.state, p), 'utf8'));
  assert.throws(() => f.store.reconcile('one'), /RECOVERY_BLOCKED/);
  assert.deepEqual(paths.map(p => fs.readFileSync(join(f.state, p), 'utf8')), before);
  assert.equal(digest(f.store.status('one').observations.selectionIntent), digest(intent));
});

test('U05 should retain the previous selection and reject abort after selection intent', t => {
  const f = store(t), first = f.image('first'), second = f.image('second');
  f.store.begin({ upgradeId: 'one', target: first }); f.store.prepare('one'); f.store.select('one');
  assert.throws(() => f.store.abort('one'), /selection_irreversible/);
  // A selected transaction remains engaged until component/delegation completion.
  assert.throws(() => f.store.begin({ upgradeId: 'two', target: second }), /upgrade_in_progress/);
  const f2 = store(t), third = f2.image('third');
  f2.store.begin({ upgradeId: 'abort', target: third });
  assert.equal(f2.store.abort('abort').installationState, 'ABORTED');
  assert.throws(() => f2.store.select('abort'), /upgrade_phase_invalid/);
  assert.equal(f2.store.begin({ upgradeId: 'next', target: third }).selectionEpoch, 1);
});

test('U06 should refuse a contradictory durable history before changing the selected build', t => {
  const f = store(t), target = f.image();
  f.store.begin({ upgradeId: 'one', target }); f.store.prepare('one');
  const intent = f.store.status('one').observations.selectionIntent;
  publishState(join(f.state, 'selection-history/1.json'), { ...intent, buildId: 'contradiction' }, 'selection');
  assert.throws(() => f.store.select('one'), /RECOVERY_BLOCKED:history/);
  assert.equal(fs.existsSync(join(f.state, 'selected-build.json')), false, 'history contradiction must not change selection');
});

test('U06 should refuse a contradictory last-valid record before changing selection', t => {
  const f = store(t), target = f.image();
  f.store.begin({ upgradeId: 'one', target }); f.store.prepare('one');
  const intent = f.store.status('one').observations.selectionIntent;
  publishState(join(f.state, 'last-valid-selection.json'), { ...intent, buildId: 'contradiction' }, 'selection');
  assert.throws(() => f.store.select('one'), /RECOVERY_BLOCKED:history/);
  assert.equal(fs.existsSync(join(f.state, 'selected-build.json')), false);
});

test('U05 should retain verified previous history with a monotonically increasing epoch', t => {
  const f = store(t), old = f.image('old'), target = f.image('new');
  const prior = { schemaVersion: 1, prefixId: f.layout.prefixId, canonicalPrefix: f.layout.canonicalPrefix, uid: process.getuid(),
    selectionEpoch: 7, packageVersion: old.packageVersion, buildId: old.buildId, manifestDigest: old.manifestDigest,
    entrypoint: old.entrypoint, upgradeId: 'earlier', previousSelectionReference: null };
  for (const path of ['selected-build.json', 'last-valid-selection.json', 'selection-history/7.json']) publishState(join(f.state, path), prior, 'selection');
  f.store.begin({ upgradeId: 'next', target }); f.store.prepare('next'); f.store.select('next');
  const selected = readState(join(f.state, 'selected-build.json'), 'selection').value;
  assert.equal(selected.selectionEpoch, 8);
  assert.equal(selected.previousSelectionReference, 'selection-history/7.json');
  assert.deepEqual(readState(join(f.state, 'selection-history/7.json'), 'selection').value, prior);
  assert.equal(readState(join(f.state, 'pins/upgrade-next.json'), 'imagePin').value.sourceManifestDigest, prior.manifestDigest);
});

test('U06 should reject a validly encoded intent from another installation without publication', t => {
  const f = store(t), target = f.image();
  f.store.begin({ upgradeId: 'one', target }); f.store.prepare('one');
  const path = join(f.state, 'upgrade/transactions/one.json'), record = readState(path, 'upgradeTransaction');
  replaceState(path, { ...record.value, revision: record.value.revision + 1, observations: { ...record.value.observations,
    selectionIntent: { ...record.value.observations.selectionIntent, prefixId: 'sha256:' + 'f'.repeat(64) } } }, 'upgradeTransaction', record);
  assert.throws(() => f.store.select('one'), /RECOVERY_BLOCKED:selection_intent/);
  assert.equal(fs.existsSync(join(f.state, 'selected-build.json')), false);
});
