import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/launcher-install.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.installManagedLauncher, 'function', 'managed launcher installer required');
  const bootstrap = await import('../dist/runtime/upgrade/bootstrap-session.js');
  return { ...module, openBootstrapSession: bootstrap.openBootstrapSession };
}
function legacy(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-launcher-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = join(root, 'prefix'), pkg = join(prefix, 'lib/node_modules/@sentropic/h2a');
  fs.mkdirSync(join(pkg, 'dist'), { recursive: true, mode: 0o755 });
  fs.mkdirSync(join(prefix, 'bin'), { mode: 0o755 });
  const entry = join(pkg, 'dist/bin.js');
  fs.writeFileSync(entry, '#!/usr/bin/env node\nprocess.stdout.write("must never execute");\n', { mode: 0o755 });
  fs.writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@sentropic/h2a', version: '0.98.6', bin: { h2a: 'dist/bin.js' } }), { mode: 0o644 });
  const command = join(prefix, 'bin/h2a');
  fs.symlinkSync('../lib/node_modules/@sentropic/h2a/dist/bin.js', command);
  return { root, prefix, entry, command };
}
async function setup(t) {
  const { installManagedLauncher, openBootstrapSession } = await api();
  const f = legacy(t);
  const target = { manifestDigest: `sha256:${'d'.repeat(64)}`, packageVersion: '0.98.7', entrypoint: 'entry.mjs' };
  const session = openBootstrapSession({ prefix: f.prefix, entrypoint: f.command, legacyPrefix: f.prefix, target });
  t.after(() => session.release());
  const managedDir = join(f.root, 'managed');
  fs.mkdirSync(managedDir, { mode: 0o700 });
  const source = join(f.root, 'launcher-source.mjs');
  fs.writeFileSync(source, 'export const launcher = true;\n');
  const commandPath = join(f.root, 'bin/h2a');
  fs.mkdirSync(join(f.root, 'bin'), { mode: 0o755 });
  return { installManagedLauncher, session, managedDir, source, commandPath, f };
}
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

test('C2b should install the managed launcher and link the command atomically', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  const installed = installManagedLauncher({ session, launcherSource: source, managedDir, commandPath });
  assert.equal(installed.launcherPath, join(managedDir, 'launcher', 'h2a.mjs'));
  assert.equal(installed.commandPath, commandPath);
  assert.equal(installed.digest, sha256(fs.readFileSync(source)));
  assert.equal(fs.readlinkSync(commandPath), installed.launcherPath);
  assert.equal(fs.statSync(installed.launcherPath).mode & 0o777, 0o755);
  assert.equal(fs.statSync(join(managedDir, 'launcher')).mode & 0o777, 0o700);
  const again = installManagedLauncher({ session, launcherSource: source, managedDir, commandPath });
  assert.deepEqual(again, installed);
});

test('C2b should replace a pre-existing command link without touching npm bytes', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath, f } = await setup(t);
  const before = fs.readFileSync(f.entry, 'utf8');
  const installed = installManagedLauncher({ session, launcherSource: source, managedDir, commandPath });
  assert.equal(fs.readlinkSync(commandPath), installed.launcherPath);
  assert.equal(fs.readFileSync(f.entry, 'utf8'), before);
});

test('C2b should write nothing when the installation drifted since the session opened', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath, f } = await setup(t);
  fs.appendFileSync(f.entry, 'export const drifted=true;\n');
  assert.throws(() => installManagedLauncher({ session, launcherSource: source, managedDir, commandPath }), /legacy_installation_changed/);
  assert.equal(fs.existsSync(join(managedDir, 'launcher')), false);
  assert.equal(fs.existsSync(commandPath), false);
});

test('C2b should refuse an unreadable launcher source before touching the command', async t => {
  const { installManagedLauncher, session, managedDir, commandPath } = await setup(t);
  for (const launcherSource of [join(managedDir, 'missing.mjs'), managedDir]) {
    assert.throws(() => installManagedLauncher({ session, launcherSource, managedDir, commandPath }), /bootstrap_launcher_source_invalid/);
  }
  assert.equal(fs.existsSync(commandPath), false);
});

test('C2b should record the exact digest of the installed launcher bytes', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  const installed = installManagedLauncher({ session, launcherSource: source, managedDir, commandPath });
  assert.equal(installed.digest, sha256(fs.readFileSync(installed.launcherPath)));
  assert.match(installed.digest, /^sha256:[0-9a-f]{64}$/);
});

test('C2b should refuse an invalid launcher installation envelope', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  for (const args of [null, 42, 'install', [], { session, launcherSource: source, managedDir },
    { session, launcherSource: source, managedDir, commandPath: join(managedDir, 'no-such-dir/h2a') }]) {
    assert.throws(() => installManagedLauncher(args), /bootstrap_launcher_(install_invalid|command_unusable)/);
  }
});
