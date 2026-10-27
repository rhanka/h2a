import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { openBootstrapSession } from '../dist/runtime/upgrade/bootstrap-session.js';
import { prefixLayout } from '../src/runtime/handover/authority.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { publishState } from '../src/runtime/handover/state.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/upgrade-run.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.runUpgradeOnce, 'function', 'upgrade once runner required');
  return module;
}
function rig(t, buildId = 'target') {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-upgrade-run-'));
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
  const run = { session, store, upgradeId: 'run', target, launcherSource, managedDir, commandPath, exclusion };
  return { root, entry, store, session, target, managedDir, commandPath, exclusion, run };
}

test('F should execute the needed upgrade once end to end', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  const done = runUpgradeOnce(r.run);
  assert.equal(done.completed, true);
  assert.equal(fs.existsSync(r.commandPath), true);
  assert.equal(fs.readlinkSync(r.commandPath), join(r.managedDir, 'launcher', 'h2a.mjs'));
  assert.equal(r.store.status('run').installationState, 'SELECTED');
});

test('F should skip without mutating while management opted out', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  fs.writeFileSync(join(r.managedDir, 'unmanaged.json'), JSON.stringify({ schemaVersion: 1, reason: 'operator_unmanage' }));
  const done = runUpgradeOnce(r.run);
  assert.equal(done.completed, false);
  assert.equal(done.reason, 'management_opted_out');
  assert.equal(fs.existsSync(join(r.store.state, 'upgrade/transactions/run.json')), false);
  assert.equal(fs.existsSync(r.commandPath), false);
});

test('F should report already adopted without a second transaction', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  assert.equal(runUpgradeOnce({ ...r.run, upgradeId: 'one' }).completed, true);
  const again = runUpgradeOnce({ ...r.run, upgradeId: 'two' });
  assert.equal(again.completed, false);
  assert.equal(again.reason, 'already_adopted');
  assert.equal(fs.existsSync(join(r.store.state, 'upgrade/transactions/two.json')), false);
});

test('F should propagate the exclusion deferral instead of selecting', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  const open = { ...r.exclusion, workersTerminated: { established: false, detail: 'worker still alive' } };
  assert.throws(() => runUpgradeOnce({ ...r.run, exclusion: open }), /selection_deferred:legacy_installer_unfenced/);
  assert.equal(r.store.status('run').installationState, 'PREPARED');
});

test('F should honor an explicit operator override of the opt-out', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  fs.writeFileSync(join(r.managedDir, 'unmanaged.json'), JSON.stringify({ schemaVersion: 1, reason: 'operator_unmanage' }));
  const done = runUpgradeOnce({ ...r.run, explicit: true });
  assert.equal(done.completed, true);
  assert.equal(r.store.status('run').installationState, 'SELECTED');
});

test('F should refuse an invalid upgrade run envelope', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  for (const args of [null, 42, 'run', [], { ...r.run, store: null }, { ...r.run, upgradeId: '' },
    { ...r.run, target: null }, { ...r.run, session: null }]) {
    assert.throws(() => runUpgradeOnce(args), /upgrade_run_invalid/);
  }
});
