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
  const run = await import('../dist/runtime/upgrade/upgrade-run.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  const execute = await import('../dist/runtime/upgrade/adoption-execute.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof run?.runUpgradeOnce, 'function', 'upgrade once runner required');
  assert.equal(typeof execute?.executeAdoption, 'function', 'adoption executor required');
  return { ...run, ...execute };
}
function rig(t, buildId = 'target') {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-pilot-force-'));
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
  return { session, store, upgradeId: 'run', target, launcherSource, managedDir, commandPath, exclusion };
}
function attempt(fn) {
  try { return { result: fn() }; } catch (error) { return { error }; }
}

test('F should force an occupied command link through the pilot only on explicit override', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  fs.writeFileSync(r.commandPath, 'operator file\n');
  assert.throws(() => runUpgradeOnce(r), /bootstrap_launcher_command_occupied/);
  assert.equal(fs.existsSync(join(r.store.state, 'upgrade/transactions/run.json')), true);
  const f = rig(t, 'forced');
  fs.writeFileSync(f.commandPath, 'operator file\n');
  const forced = attempt(() => runUpgradeOnce({ ...f, explicit: true }));
  assert.equal(forced.error, undefined);
  assert.equal(forced.result.completed, true);
  assert.equal(forced.result.installation.forced, true);
  assert.equal(fs.readlinkSync(f.commandPath), join(f.managedDir, 'launcher', 'h2a.mjs'));
});

test('F should refuse a non-boolean pilot override instead of guessing', async t => {
  const { runUpgradeOnce, executeAdoption } = await api(), r = rig(t);
  assert.throws(() => runUpgradeOnce({ ...r, explicit: 'yes' }), /upgrade_run_invalid/);
  assert.throws(() => executeAdoption({ ...r, explicit: 1 }), /adoption_execute_invalid/);
  assert.throws(() => executeAdoption({ ...r, explicit: 'yes' }), /adoption_execute_invalid/);
});

test('F should run the pilot unforced without overriding', async t => {
  const { runUpgradeOnce } = await api(), r = rig(t);
  const done = runUpgradeOnce(r);
  assert.equal(done.completed, true);
  assert.equal(done.installation.forced, false);
  assert.equal(r.store.status('run').installationState, 'SELECTED');
});
