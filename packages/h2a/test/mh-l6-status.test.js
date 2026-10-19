import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';
import { publishState, readState } from '../src/runtime/handover/state.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/status-report.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.composeUpgradeStatus, 'function', 'upgrade status composer required');
  return module;
}
function flow(t, upgradeId = 'one', buildId = 'target') {
  const f = installationFixture(); t.after(() => f.close());
  const store = new UpgradeStore(f.layout), target = f.image(buildId);
  return { f, store, target };
}
function exclusion(fenced, detail = 'observed in fixture') {
  const closed = fenced
    ? { established: true, detail }
    : { established: false, detail: 'worker still alive' };
  return { workersTerminated: closed, relaunchSourcesClosed: { established: true, detail },
    futureStartsRouted: { established: true, detail }, installerReintroductionBarred: { established: true, detail } };
}

test('F should report an unchanged preparation before any selection', async t => {
  const { composeUpgradeStatus } = await api(), { f, store, target } = flow(t);
  store.begin({ upgradeId: 'prep', target, origin: 'manual', artifactDigests: {} });
  store.prepare('prep');
  const report = composeUpgradeStatus({ store, upgradeId: 'prep' });
  assert.equal(report.transactionId, 'prep');
  assert.equal(report.phase, 'PREPARED');
  assert.equal(report.preparedVersion, target.packageVersion);
  assert.equal(report.preparedBuildId, target.buildId);
  assert.equal(report.selectedVersion, null);
  assert.equal(report.selectedBuildId, null);
  assert.equal(report.activation, 'unchanged');
  assert.equal(report.reason, null);
  assert.deepEqual(report.observedProcessIdentity, currentIdentity());
  assert.equal(report.observedGeneration, 1);
  assert.equal(Object.isFrozen(report), true);
});

test('F should report the durable selection once selected', async t => {
  const { composeUpgradeStatus } = await api(), { f, store, target } = flow(t);
  store.begin({ upgradeId: 'sel', target, origin: 'manual', artifactDigests: {} });
  store.prepare('sel'); store.select('sel');
  const report = composeUpgradeStatus({ store, upgradeId: 'sel' });
  assert.equal(report.phase, 'SELECTED');
  assert.equal(report.selectedVersion, target.packageVersion);
  assert.equal(report.selectedBuildId, target.buildId);
  assert.equal(report.loadedVersion, target.packageVersion);
  assert.equal(report.loadedBuildId, target.buildId);
  assert.equal(report.activation, 'unknown');
});

test('F should refuse a durable selection from another installation', async t => {
  const { composeUpgradeStatus } = await api();
  const a = flow(t), b = flow(t);
  a.store.begin({ upgradeId: 'one', target: a.target }); a.store.prepare('one'); a.store.select('one');
  const foreign = readState(join(a.f.state, 'selected-build.json'), 'selection').value;
  b.store.begin({ upgradeId: 'two', target: b.target }); b.store.prepare('two');
  publishState(join(b.f.state, 'selected-build.json'), foreign, 'selection');
  assert.throws(() => composeUpgradeStatus({ store: b.store, upgradeId: 'two' }), /foreign_installation_authority/);
});

test('F should report completion and failure terminally', async t => {
  const { composeUpgradeStatus } = await api(), { f, store, target } = flow(t);
  store.begin({ upgradeId: 'done', target });
  store.prepare('done'); store.select('done');
  const selected = store.status('done');
  assert.equal(composeUpgradeStatus({ store, upgradeId: 'done' }).activation, 'unknown');
  assert.equal(selected.installationState, 'SELECTED');
  const g = flow(t);
  g.store.begin({ upgradeId: 'aborted', target: g.target });
  g.store.prepare('aborted'); g.store.abort('aborted');
  const failed = composeUpgradeStatus({ store: g.store, upgradeId: 'aborted' });
  assert.equal(failed.phase, 'ABORTED');
  assert.equal(failed.activation, 'failed');
});

test('F should report deferred while legacy exclusion stays unfenced', async t => {
  const { composeUpgradeStatus } = await api(), { f, store, target } = flow(t);
  store.begin({ upgradeId: 'held', target });
  store.prepare('held');
  assert.throws(() => store.select('held', { exclusion: exclusion(false) }), /selection_deferred/);
  const report = composeUpgradeStatus({ store, upgradeId: 'held' });
  assert.equal(report.phase, 'PREPARED');
  assert.equal(report.activation, 'deferred');
  assert.equal(report.reason, 'selection_deferred:legacy_installer_unfenced');
});

test('F should refuse an invalid status envelope instead of inventing versions', async t => {
  const { composeUpgradeStatus } = await api(), { f, store, target } = flow(t);
  store.begin({ upgradeId: 'known', target });
  for (const args of [null, 42, 'status', [], { store }, { upgradeId: 'known' }, { store, upgradeId: 42 }]) {
    assert.throws(() => composeUpgradeStatus(args), /status_report_invalid/);
  }
  assert.throws(() => composeUpgradeStatus({ store, upgradeId: 'missing' }), /upgrade_not_found/);
});
