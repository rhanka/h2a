import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/upgrade-authority.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.assertUpgradeAuthority, 'function', 'upgrade authority check required');
  return module;
}
function selected(t, upgradeId = 'one', buildId = 'target') {
  const f = installationFixture(); t.after(() => f.close());
  const store = new UpgradeStore(f.layout), target = f.image(buildId);
  store.begin({ upgradeId, target, origin: 'manual', artifactDigests: {} });
  store.prepare(upgradeId); store.select(upgradeId);
  return { f, store, target };
}
const foreign = () => ({ ...currentIdentity(), pid: 999999001 });

test('F should authorize the bound controller on its transaction', async t => {
  const { assertUpgradeAuthority } = await api(), { store } = selected(t);
  const grant = assertUpgradeAuthority({ store, upgradeId: 'one' });
  assert.equal(grant.upgradeId, 'one');
  assert.equal(grant.epoch, store.status('one').controllerEpoch);
  assert.equal(Object.isFrozen(grant), true);
});

test('F should authorize an explicitly presented matching controller', async t => {
  const { assertUpgradeAuthority } = await api(), { store } = selected(t);
  const grant = assertUpgradeAuthority({ store, upgradeId: 'one', controller: currentIdentity() });
  assert.equal(grant.upgradeId, 'one');
});

test('F should refuse a foreign controller with a CLI-level reason', async t => {
  const { assertUpgradeAuthority } = await api(), { store } = selected(t);
  assert.throws(() => assertUpgradeAuthority({ store, upgradeId: 'one', controller: foreign() }), /upgrade_authority_foreign/);
});

test('F should refuse a controller revoked by delegation', async t => {
  const { assertUpgradeAuthority } = await api(), { store } = selected(t);
  store.delegate('one', foreign());
  assert.throws(() => assertUpgradeAuthority({ store, upgradeId: 'one' }), /upgrade_authority_revoked/);
});

test('F should refuse an invalid authority envelope instead of guessing', async t => {
  const { assertUpgradeAuthority } = await api(), { store } = selected(t);
  for (const args of [null, 42, 'authority', [], { store }, { upgradeId: 'one' }, { store, upgradeId: 42 },
    { store, upgradeId: 'one', controller: 'self' }]) {
    assert.throws(() => assertUpgradeAuthority(args), /upgrade_authority_invalid/);
  }
  assert.throws(() => assertUpgradeAuthority({ store, upgradeId: 'missing' }), /upgrade_not_found/);
});
