import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { prefixLayout } from '../src/runtime/handover/authority.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { publishState } from '../src/runtime/handover/state.js';
import { openBootstrapSession } from '../dist/runtime/upgrade/bootstrap-session.js';
import { acquirePrefixLock } from '../dist/runtime/local-files/succession-lock.js';

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

async function executeApi() {
  const module = await import('../dist/runtime/upgrade/adoption-execute.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.executeAdoption, 'function', 'adoption executor required');
  return module;
}
function rig(t, buildId = 'target') {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-adoption-exec-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = join(root, 'prefix'), pkg = join(prefix, 'lib/node_modules/@sentropic/h2a');
  fs.mkdirSync(join(pkg, 'dist'), { recursive: true, mode: 0o755 });
  fs.mkdirSync(join(prefix, 'bin'), { mode: 0o755 });
  const entry = join(pkg, 'dist/bin.js');
  fs.writeFileSync(entry, '#!/usr/bin/env node\nprocess.stdout.write("must never execute");\n', { mode: 0o755 });
  fs.writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@sentropic/h2a', version: '0.98.6', bin: { h2a: 'dist/bin.js' } }), { mode: 0o644 });
  const command = join(prefix, 'bin/h2a');
  fs.symlinkSync('../lib/node_modules/@sentropic/h2a/dist/bin.js', command);
  const layout = prefixLayout(prefix, prefix, process.getuid());
  for (const path of ['state', 'state/upgrade', 'state/upgrade/transactions', 'state/upgrade/private',
    'state/upgrade/receipts', 'state/selection-history', 'state/pins', 'images']) {
    fs.mkdirSync(join(layout.managedRoot, path), { recursive: true, mode: 0o700 });
  }
  const installation = { schemaVersion: 1, prefixId: layout.prefixId, canonicalPrefix: prefix,
    uid: process.getuid(), managedRoot: layout.managedRoot };
  publishState(join(layout.managedRoot, 'installation.json'), installation, 'installation');
  const store = new UpgradeStore(installation);
  const stage = join(prefix, 'stage'); fs.mkdirSync(stage, { mode: 0o700 });
  fs.writeFileSync(join(stage, 'entry.mjs'), `export const buildId=${JSON.stringify(buildId)};\n`);
  fs.writeFileSync(join(stage, 'controller.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, entrypoint: 'entry.mjs' }));
  const manifest = createManifest(stage, { packageVersion: '0.98.7', buildId,
    profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
    entrypoints: { controller: 'entry.mjs', shim: 'entry.mjs' }, startupWaitBudgetMs: 10000, maxAttachments: 64, nativeArtifacts: [] });
  fs.writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest));
  const manifestDigest = digest(manifest);
  fs.renameSync(stage, join(layout.managedRoot, 'images', manifestDigest.slice(7)));
  const target = { packageVersion: '0.98.7', buildId, manifestDigest, entrypoint: 'entry.mjs' };
  const session = openBootstrapSession({ prefix, entrypoint: command, legacyPrefix: prefix, target });
  t.after(() => session.release());
  const managedDir = join(root, 'managed'); fs.mkdirSync(managedDir, { mode: 0o700 });
  const launcherSource = join(root, 'launcher-source.mjs');
  fs.writeFileSync(launcherSource, 'export const launcher = true;\n');
  const commandPath = join(root, 'bin/h2a'); fs.mkdirSync(join(root, 'bin'), { mode: 0o755 });
  const exclusion = { workersTerminated: { established: true, detail: 'no legacy worker alive' },
    relaunchSourcesClosed: { established: true, detail: 'autostart entries removed' },
    futureStartsRouted: { established: true, detail: 'managed launcher primary' },
    installerReintroductionBarred: { established: true, detail: 'installer path unreachable' } };
  return { root, prefix, entry, store, target, session, managedDir, launcherSource, commandPath, exclusion };
}

test('C2b should execute adoption from session to selected build', async t => {
  const { executeAdoption } = await executeApi(), r = rig(t);
  const done = executeAdoption({ session: r.session, store: r.store, upgradeId: 'adopt',
    target: r.target, launcherSource: r.launcherSource, managedDir: r.managedDir, commandPath: r.commandPath, exclusion: r.exclusion });
  assert.equal(done.completed, true);
  assert.equal(done.transaction.installationState, 'SELECTED');
  assert.equal(done.installation?.digest, `sha256:${createHash('sha256').update(fs.readFileSync(r.launcherSource)).digest('hex')}`);
  assert.equal(fs.readlinkSync(r.commandPath), done.installation.launcherPath);
  const handedBack = acquirePrefixLock(r.prefix);
  assert.equal(handedBack.acquired, true);
  handedBack.release();
});

test('C2b should return already adopted without mutating when selection matches', async t => {
  const { executeAdoption } = await executeApi(), r = rig(t);
  const first = { session: r.session, store: r.store, target: r.target, launcherSource: r.launcherSource,
    managedDir: r.managedDir, commandPath: r.commandPath, exclusion: r.exclusion };
  assert.equal(executeAdoption({ ...first, upgradeId: 'one' }).completed, true);
  const again = executeAdoption({ ...first, upgradeId: 'two' });
  assert.equal(again.completed, false);
  assert.equal(again.reason, 'already_adopted');
  assert.equal(fs.existsSync(join(r.store.state, 'upgrade/transactions/two.json')), false);
});

test('C2b should install the launcher but defer selection while exclusion is unfenced', async t => {
  const { executeAdoption } = await executeApi(), r = rig(t);
  const open = { ...r.exclusion, workersTerminated: { established: false, detail: 'worker still alive' } };
  assert.throws(() => executeAdoption({ session: r.session, store: r.store, upgradeId: 'deferred',
    target: r.target, launcherSource: r.launcherSource, managedDir: r.managedDir, commandPath: r.commandPath, exclusion: open }),
  /selection_deferred:legacy_installer_unfenced/);
  assert.equal(fs.readlinkSync(r.commandPath), join(r.managedDir, 'launcher', 'h2a.mjs'));
  assert.equal(r.store.status('deferred').installationState, 'PREPARED');
});

test('C2b should write nothing when the session drifted before adoption', async t => {
  const { executeAdoption } = await executeApi(), r = rig(t);
  fs.appendFileSync(r.entry, 'export const drifted=true;\n');
  assert.throws(() => executeAdoption({ session: r.session, store: r.store, upgradeId: 'drifted',
    target: r.target, launcherSource: r.launcherSource, managedDir: r.managedDir, commandPath: r.commandPath, exclusion: r.exclusion }),
  /legacy_installation_changed/);
  assert.equal(fs.existsSync(join(r.store.state, 'upgrade/transactions/drifted.json')), false);
  assert.equal(fs.existsSync(join(r.managedDir, 'launcher')), false);
  assert.equal(fs.existsSync(r.commandPath), false);
});

test('C2b should refuse an invalid adoption execution envelope', async t => {
  const { executeAdoption } = await executeApi(), r = rig(t);
  const valid = { session: r.session, store: r.store, upgradeId: 'bad', target: r.target,
    launcherSource: r.launcherSource, managedDir: r.managedDir, commandPath: r.commandPath };
  for (const args of [null, 42, 'adopt', [], { ...valid, store: null }, { ...valid, upgradeId: '' },
    { ...valid, target: null }, { ...valid, commandPath: 42 }]) {
    assert.throws(() => executeAdoption(args), /adoption_execute_invalid/);
  }
});
