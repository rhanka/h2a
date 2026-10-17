import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/adoption-need.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.assessAdoptionNeed, 'function', 'adoption need assessor required');
  return module;
}
function selected(t, buildId = 'target') {
  const f = installationFixture(); t.after(() => f.close());
  const store = new UpgradeStore(f.layout), target = f.image(buildId);
  store.begin({ upgradeId: 'one', target, origin: 'bootstrap', artifactDigests: { tarball: target.manifestDigest } });
  store.prepare('one');
  store.select('one');
  const selection = store.status('one').observations.selectionIntent;
  return { f, target: { packageVersion: target.packageVersion, manifestDigest: target.manifestDigest }, selection };
}

test('C2b should require adoption when no managed selection exists', async t => {
  const { assessAdoptionNeed } = await api(), f = installationFixture(); t.after(() => f.close());
  const target = { packageVersion: '0.98.7', manifestDigest: `sha256:${'b'.repeat(64)}` };
  const verdict = assessAdoptionNeed({ managed: { prefixId: f.layout.prefixId, selection: null },
    physical: { prefixId: f.layout.prefixId }, target });
  assert.equal(verdict.needed, true);
  assert.equal(verdict.reason, 'managed_selection_absent');
  assert.equal(Object.isFrozen(verdict), true);
});

test('C2b should report already adopted when selection matches the target', async t => {
  const { assessAdoptionNeed } = await api(), { f, target, selection } = selected(t);
  const verdict = assessAdoptionNeed({ managed: { prefixId: f.layout.prefixId, selection },
    physical: { prefixId: f.layout.prefixId }, target });
  assert.equal(verdict.needed, false);
  assert.equal(verdict.reason, 'already_adopted');
});

test('C2b should require adoption when the selection targets another build', async t => {
  const { assessAdoptionNeed } = await api(), { f, selection } = selected(t, 'old-build');
  const other = { packageVersion: '0.98.7', manifestDigest: `sha256:${'c'.repeat(64)}` };
  const verdict = assessAdoptionNeed({ managed: { prefixId: f.layout.prefixId, selection },
    physical: { prefixId: f.layout.prefixId }, target: other });
  assert.equal(verdict.needed, true);
  assert.equal(verdict.reason, 'target_mismatch');
});

test('C2b should require adoption when the physical installation is unreadable', async t => {
  const { assessAdoptionNeed } = await api(), { f, target, selection } = selected(t);
  const verdict = assessAdoptionNeed({ managed: { prefixId: f.layout.prefixId, selection }, physical: null, target });
  assert.equal(verdict.needed, true);
  assert.equal(verdict.reason, 'physical_installation_unreadable');
});

test('C2b should require adoption when the managed layout is unrecognized', async t => {
  const { assessAdoptionNeed } = await api(), { f, target, selection } = selected(t);
  const physical = { prefixId: f.layout.prefixId };
  for (const [managed, reason] of [[null, 'managed_installation_absent'],
    [{ prefixId: 'foreign-prefix', selection }, 'managed_prefix_foreign'],
    [{ prefixId: f.layout.prefixId, selection: { ...selection, upgradeId: '../escape' } }, 'managed_selection_malformed']]) {
    const verdict = assessAdoptionNeed({ managed, physical, target });
    assert.equal(verdict.needed, true);
    assert.equal(verdict.reason, reason);
  }
});

test('C2b should refuse an invalid adoption assessment envelope', async t => {
  const { assessAdoptionNeed } = await api(), { f, target, selection } = selected(t);
  const managed = { prefixId: f.layout.prefixId, selection }, physical = { prefixId: f.layout.prefixId };
  for (const bad of [null, 42, 'adopted', [],
    { managed, physical, target: { ...target, manifestDigest: 'sha256:short' } },
    { managed, physical, target: { ...target, packageVersion: 'latest' } },
    { managed, physical }]) {
    assert.throws(() => assessAdoptionNeed(bad), /adoption_assessment_invalid/);
  }
});
