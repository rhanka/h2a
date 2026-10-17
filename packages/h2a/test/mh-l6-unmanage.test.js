import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { acquirePrefixLock } from '../dist/runtime/local-files/succession-lock.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/unmanage.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.unmanageInstallation, 'function', 'managed unmanage operation required');
  return module;
}
function managed(t) {
  const f = installationFixture(); t.after(() => f.close());
  const store = new UpgradeStore(f.layout), target = f.image();
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-unmanage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const originalTarget = join(root, 'original-h2a.js');
  fs.writeFileSync(originalTarget, '#!/usr/bin/env node\nprocess.stdout.write("original");\n', { mode: 0o755 });
  const managedDir = join(root, 'managed'); fs.mkdirSync(managedDir, { mode: 0o700 });
  const commandPath = join(root, 'bin/h2a'); fs.mkdirSync(join(root, 'bin'), { mode: 0o755 });
  const managedLauncher = join(managedDir, 'launcher', 'h2a.mjs');
  fs.mkdirSync(join(managedDir, 'launcher'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(managedLauncher, 'export const launcher = true;\n', { mode: 0o755 });
  fs.symlinkSync(managedLauncher, commandPath);
  return { f, store, target, root, originalTarget, managedDir, commandPath, managedLauncher };
}

test('D should restore the original command link and mark the installation unmanaged', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  m.store.begin({ upgradeId: 'one', target: m.target });
  m.store.prepare('one'); m.store.select('one');
  const done = unmanageInstallation({ store: m.store, commandPath: m.commandPath,
    originalTarget: m.originalTarget, managedDir: m.managedDir });
  assert.equal(done.restored, true);
  assert.equal(done.commandPath, m.commandPath);
  assert.equal(fs.readlinkSync(m.commandPath), m.originalTarget);
  assert.equal(fs.existsSync(join(m.managedDir, 'unmanaged.json')), true);
  const marker = JSON.parse(fs.readFileSync(join(m.managedDir, 'unmanaged.json'), 'utf8'));
  assert.equal(marker.schemaVersion, 1);
  assert.equal(marker.reason, 'operator_unmanage');
  assert.equal(marker.restoredCommand, m.commandPath);
  assert.equal(fs.existsSync(join(m.f.state, 'pins', 'upgrade-one.json')), true);
  const competing = acquirePrefixLock(m.f.layout.canonicalPrefix);
  assert.equal(competing.acquired, true);
  competing.release();
});

test('D should refuse while a prepared transaction is still engaged', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  m.store.begin({ upgradeId: 'two', target: m.target });
  m.store.prepare('two');
  assert.throws(() => unmanageInstallation({ store: m.store, commandPath: m.commandPath,
    originalTarget: m.originalTarget, managedDir: m.managedDir }), /unmanage_transaction_engaged:PREPARED/);
  assert.equal(fs.readlinkSync(m.commandPath), m.managedLauncher);
  assert.equal(fs.existsSync(join(m.managedDir, 'unmanaged.json')), false);
});

test('D should proceed once the engaged transaction aborted', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  m.store.begin({ upgradeId: 'three', target: m.target });
  m.store.prepare('three'); m.store.abort('three');
  const done = unmanageInstallation({ store: m.store, commandPath: m.commandPath,
    originalTarget: m.originalTarget, managedDir: m.managedDir });
  assert.equal(done.restored, true);
  assert.equal(fs.readlinkSync(m.commandPath), m.originalTarget);
});

test('D should refuse an unrestorable original link without touching the command', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  assert.throws(() => unmanageInstallation({ store: m.store, commandPath: m.commandPath,
    originalTarget: join(m.root, 'gone.js'), managedDir: m.managedDir }), /unmanage_link_unrestorable/);
  assert.equal(fs.readlinkSync(m.commandPath), m.managedLauncher);
  assert.equal(fs.existsSync(join(m.managedDir, 'unmanaged.json')), false);
});

test('D should refuse an invalid unmanage envelope', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  const valid = { store: m.store, commandPath: m.commandPath, originalTarget: m.originalTarget, managedDir: m.managedDir };
  for (const args of [null, 42, 'unmanage', [], { ...valid, store: null }, { ...valid, commandPath: 'relative/h2a' },
    { ...valid, managedDir: join(m.root, 'no-such-dir') }]) {
    assert.throws(() => unmanageInstallation(args), /unmanage_install_invalid/);
  }
});

test('D should report opt-out from the unmanaged marker', async t => {
  const { unmanageInstallation, readManagementOptOut } = await api();
  assert.equal(typeof readManagementOptOut, 'function');
  const m = managed(t);
  assert.deepEqual(readManagementOptOut(m.managedDir), { optedOut: false });
  m.store.begin({ upgradeId: 'one', target: m.target });
  m.store.prepare('one'); m.store.select('one');
  unmanageInstallation({ store: m.store, commandPath: m.commandPath, originalTarget: m.originalTarget, managedDir: m.managedDir });
  const reported = readManagementOptOut(m.managedDir);
  assert.equal(reported.optedOut, true);
  assert.equal(reported.reason, 'operator_unmanage');
  assert.throws(() => readManagementOptOut(null), /unmanage_install_invalid/);
});

test('D should fail closed on an unreadable opt-out marker', async t => {
  const { readManagementOptOut } = await api();
  const m = managed(t);
  fs.writeFileSync(join(m.managedDir, 'unmanaged.json'), 'not json');
  const reported = readManagementOptOut(m.managedDir);
  assert.equal(reported.optedOut, true);
  assert.equal(reported.reason, 'marker_unreadable');
});

test('D should refuse an unsafe journal instead of exiting management blindly', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  const valid = { store: m.store, commandPath: m.commandPath, originalTarget: m.originalTarget, managedDir: m.managedDir };
  fs.writeFileSync(join(m.f.state, 'upgrade/transactions/junk.json'), 'not a journal');
  assert.throws(() => unmanageInstallation(valid), /unmanage_journal_unsafe/);
  assert.equal(fs.readlinkSync(m.commandPath), m.managedLauncher);
});
