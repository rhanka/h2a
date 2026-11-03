import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/upgrade-dispatch.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.resumeUpgrade, 'function', 'upgrade resume dispatch required');
  assert.equal(typeof module?.abortUpgrade, 'function', 'upgrade abort dispatch required');
  return module;
}
function prepared(t, upgradeId = 'one', buildId = 'target') {
  const f = installationFixture(); t.after(() => f.close());
  const store = new UpgradeStore(f.layout), target = f.image(buildId);
  store.begin({ upgradeId, target, origin: 'manual', artifactDigests: {} });
  store.prepare(upgradeId);
  return { f, store, target };
}
const foreign = () => ({ ...currentIdentity(), pid: 999999001 });

test('F should resume a prepared transaction without changing its phase', async t => {
  const { resumeUpgrade } = await api(), { store } = prepared(t);
  const result = resumeUpgrade({ store, upgradeId: 'one' });
  assert.equal(result.upgradeId, 'one');
  assert.equal(result.installationState, 'PREPARED');
  assert.equal(result.controllerEpoch, store.status('one').controllerEpoch);
  assert.equal(Object.isFrozen(result), true);
});

test('F should resume a selected transaction to its durable close', async t => {
  const { resumeUpgrade } = await api(), { store } = prepared(t);
  store.select('one');
  const result = resumeUpgrade({ store, upgradeId: 'one' });
  assert.equal(result.installationState, 'SELECTED');
});

test('F should abort a prepared transaction once', async t => {
  const { abortUpgrade } = await api(), { store } = prepared(t);
  assert.equal(abortUpgrade({ store, upgradeId: 'one' }).installationState, 'ABORTED');
  assert.equal(abortUpgrade({ store, upgradeId: 'one' }).installationState, 'ABORTED');
});

test('F should refuse abort after selection', async t => {
  const { abortUpgrade } = await api(), { store } = prepared(t);
  store.select('one');
  assert.throws(() => abortUpgrade({ store, upgradeId: 'one' }), /selection_irreversible/);
});

test('F should check CLI authority before the engine on resume', async t => {
  const { resumeUpgrade } = await api(), { store } = prepared(t);
  store.select('one'); store.delegate('one', foreign());
  assert.throws(() => resumeUpgrade({ store, upgradeId: 'one' }), /upgrade_authority_revoked/);
  const { store: live } = prepared(t, 'two');
  assert.throws(() => resumeUpgrade({ store: live, upgradeId: 'two', controller: foreign() }), /upgrade_authority_foreign/);
});

test('F should check CLI authority before the engine on abort', async t => {
  const { abortUpgrade } = await api(), { store } = prepared(t);
  store.select('one'); store.delegate('one', foreign());
  assert.throws(() => abortUpgrade({ store, upgradeId: 'one' }), /upgrade_authority_revoked/);
  const { store: live } = prepared(t, 'two');
  assert.throws(() => abortUpgrade({ store: live, upgradeId: 'two', controller: foreign() }), /upgrade_authority_foreign/);
});

test('F should check CLI authority before the engine on compensate', async t => {
  const { compensateUpgrade } = await api();
  assert.equal(typeof compensateUpgrade, 'function', 'upgrade compensate dispatch required');
  const { store } = prepared(t);
  store.select('one'); store.delegate('one', foreign());
  assert.throws(() => compensateUpgrade({ store, upgradeId: 'one', component: 'mcp' }), /upgrade_authority_revoked/);
  const { store: live } = prepared(t, 'two');
  assert.throws(() => compensateUpgrade({ store: live, upgradeId: 'two', component: 'gateway', controller: foreign() }), /upgrade_authority_foreign/);
  assert.throws(() => compensateUpgrade({ store: live, upgradeId: 'missing', component: 'mcp' }), /upgrade_not_found/);
});

test('F should refuse an invalid dispatch envelope instead of guessing', async t => {
  const { resumeUpgrade, abortUpgrade } = await api(), { store } = prepared(t);
  for (const args of [null, 42, 'dispatch', [], { store }, { upgradeId: 'one' }, { store, upgradeId: 42 },
    { store, upgradeId: 'one', controller: 'self' }, { store: {}, upgradeId: 'one' }]) {
    assert.throws(() => resumeUpgrade(args), /upgrade_dispatch_invalid/);
    assert.throws(() => abortUpgrade(args), /upgrade_dispatch_invalid/);
  }
  assert.throws(() => resumeUpgrade({ store, upgradeId: 'missing' }), /upgrade_not_found/);
  assert.throws(() => abortUpgrade({ store, upgradeId: 'missing' }), /upgrade_not_found/);
});
