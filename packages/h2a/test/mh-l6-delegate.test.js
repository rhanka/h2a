import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/upgrade-delegate.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.delegateUpgrade, 'function', 'upgrade delegation orchestration required');
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

test('F should hand a selected transaction to the exact candidate once', async t => {
  const { delegateUpgrade } = await api(), { store } = selected(t), candidate = foreign();
  const handoff = delegateUpgrade({ store, upgradeId: 'one', candidate });
  assert.equal(handoff.upgradeId, 'one');
  assert.equal(handoff.delegationState, 'DELEGATING');
  assert.equal(handoff.controllerEpoch, store.status('one').controllerEpoch);
  assert.equal(store.status('one').controllerAuthorityState, 'REVOKED');
  assert.equal(handoff.ticket, undefined);
  assert.equal(Object.isFrozen(handoff), true);
});

test('F should replay a lost source acknowledgement without a second handoff', async t => {
  const { delegateUpgrade } = await api(), { store } = selected(t), candidate = foreign();
  const first = delegateUpgrade({ store, upgradeId: 'one', candidate });
  let replay, error;
  try { replay = delegateUpgrade({ store, upgradeId: 'one', candidate }); } catch (cause) { error = cause; }
  assert.equal(error, undefined);
  assert.deepEqual(replay, first);
  assert.equal(store.status('one').controllerEpoch, first.controllerEpoch);
});

test('F should keep an open handoff closed to a second source call', async t => {
  const { delegateUpgrade } = await api(), { store } = selected(t);
  const first = delegateUpgrade({ store, upgradeId: 'one', candidate: foreign() });
  assert.throws(() => delegateUpgrade({ store, upgradeId: 'one', candidate: currentIdentity() }),
    /delegation_ticket_mismatch/);
  assert.equal(store.status('one').controllerEpoch, first.controllerEpoch);
});

test('F should check CLI authority before the engine on delegation', async t => {
  const { delegateUpgrade } = await api(), { store } = selected(t);
  assert.throws(() => delegateUpgrade({ store, upgradeId: 'one', candidate: foreign(), controller: foreign() }),
    /upgrade_authority_foreign/);
  store.delegate('one', foreign());
  const other = { ...currentIdentity(), pid: 999999002 };
  assert.throws(() => delegateUpgrade({ store, upgradeId: 'one', candidate: foreign(), controller: other }),
    /upgrade_authority_revoked/);
});

test('F should refuse delegation outside the selected phase', async t => {
  const { delegateUpgrade } = await api();
  const f = installationFixture(); t.after(() => f.close());
  const store = new UpgradeStore(f.layout), target = f.image('early');
  store.begin({ upgradeId: 'early', target, origin: 'manual', artifactDigests: {} });
  store.prepare('early');
  assert.throws(() => delegateUpgrade({ store, upgradeId: 'early', candidate: foreign() }),
    /upgrade_phase_invalid/);
});

test('F should refuse an invalid delegation envelope instead of guessing', async t => {
  const { delegateUpgrade } = await api(), { store } = selected(t);
  for (const args of [null, 42, 'delegate', [], { store }, { upgradeId: 'one' }, { store, upgradeId: 'one' },
    { store, upgradeId: 'one', candidate: null }, { store, upgradeId: 'one', candidate: foreign(), controller: 'self' }]) {
    assert.throws(() => delegateUpgrade(args), /upgrade_delegate_invalid/);
  }
  assert.throws(() => delegateUpgrade({ store, upgradeId: 'missing', candidate: foreign() }), /upgrade_not_found/);
});
