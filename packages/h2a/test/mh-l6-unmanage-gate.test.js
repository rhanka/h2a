import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';

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
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-unmanage-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const originalTarget = join(root, 'original-h2a.js');
  fs.writeFileSync(originalTarget, '#!/usr/bin/env node\nprocess.stdout.write("original");\n', { mode: 0o755 });
  const managedDir = join(root, 'managed'); fs.mkdirSync(managedDir, { mode: 0o700 });
  const commandPath = join(root, 'bin/h2a'); fs.mkdirSync(join(root, 'bin'), { mode: 0o755 });
  const managedLauncher = join(managedDir, 'launcher', 'h2a.mjs');
  fs.mkdirSync(join(managedDir, 'launcher'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(managedLauncher, 'export const launcher = true;\n', { mode: 0o755 });
  fs.symlinkSync(managedLauncher, commandPath);
  store.begin({ upgradeId: 'one', target });
  store.prepare('one'); store.select('one');
  const run = { store, commandPath, originalTarget, managedDir };
  return { f, store, target, root, originalTarget, managedDir, commandPath, managedLauncher, run };
}
function attempt(fn) {
  try { return { result: fn() }; } catch (error) { return { error }; }
}

test('D should refuse a foreign command link instead of replacing it', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  const other = join(m.root, 'other-tool.js');
  fs.writeFileSync(other, 'operator tool\n');
  fs.unlinkSync(m.commandPath); fs.symlinkSync(other, m.commandPath);
  assert.throws(() => unmanageInstallation(m.run), /unmanage_command_foreign/);
  assert.equal(fs.readlinkSync(m.commandPath), other);
  assert.equal(fs.existsSync(join(m.managedDir, 'unmanaged.json')), false);
});

test('D should refuse an occupied command link without touching it', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  fs.unlinkSync(m.commandPath); fs.writeFileSync(m.commandPath, 'operator file\n');
  assert.throws(() => unmanageInstallation(m.run), /unmanage_command_occupied/);
  assert.equal(fs.readFileSync(m.commandPath, 'utf8'), 'operator file\n');
  assert.equal(fs.existsSync(join(m.managedDir, 'unmanaged.json')), false);
});

test('D should refuse a dangling command link for diagnosis', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  fs.unlinkSync(m.commandPath); fs.symlinkSync(join(m.root, 'gone.js'), m.commandPath);
  assert.throws(() => unmanageInstallation(m.run), /unmanage_command_dangling/);
  assert.equal(fs.lstatSync(m.commandPath).isSymbolicLink(), true);
  assert.equal(fs.existsSync(join(m.managedDir, 'unmanaged.json')), false);
});

test('D should restore over missing, managed and already-original links', async t => {
  const { unmanageInstallation } = await api();
  const missing = managed(t);
  fs.unlinkSync(missing.commandPath);
  assert.equal(unmanageInstallation(missing.run).restored, true);
  assert.equal(fs.readlinkSync(missing.commandPath), missing.originalTarget);
  const current = managed(t);
  assert.equal(unmanageInstallation(current.run).restored, true);
  const original = managed(t);
  fs.unlinkSync(original.commandPath); fs.symlinkSync(original.originalTarget, original.commandPath);
  assert.equal(unmanageInstallation(original.run).restored, true);
  assert.equal(fs.readlinkSync(original.commandPath), original.originalTarget);
});

test('D should restore a foreign link only on explicit override', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  const other = join(m.root, 'other-tool.js');
  fs.writeFileSync(other, 'operator tool\n');
  fs.unlinkSync(m.commandPath); fs.symlinkSync(other, m.commandPath);
  for (const explicit of ['yes', 1]) {
    assert.throws(() => unmanageInstallation({ ...m.run, explicit }), /unmanage_install_invalid/);
  }
  assert.throws(() => unmanageInstallation({ ...m.run, explicit: false }), /unmanage_command_foreign/);
  const forced = attempt(() => unmanageInstallation({ ...m.run, explicit: true }));
  assert.equal(forced.error, undefined);
  assert.equal(forced.result.restored, true);
  assert.equal(forced.result.forced, true);
  assert.equal(fs.readlinkSync(m.commandPath), m.originalTarget);
  const marker = JSON.parse(fs.readFileSync(join(m.managedDir, 'unmanaged.json'), 'utf8'));
  assert.equal(marker.reason, 'operator_unmanage');
  assert.equal(marker.forced, true);
});

test('D should record an unforced restoration without overriding', async t => {
  const { unmanageInstallation } = await api(), m = managed(t);
  const done = unmanageInstallation(m.run);
  assert.equal(done.restored, true);
  assert.equal(done.forced, false);
  const marker = JSON.parse(fs.readFileSync(join(m.managedDir, 'unmanaged.json'), 'utf8'));
  assert.equal(marker.forced, false);
});
