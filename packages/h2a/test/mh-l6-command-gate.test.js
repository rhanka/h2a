import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-command-gate-'));
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

test('F should refuse a plain-file occupant instead of replacing it', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  fs.writeFileSync(commandPath, 'operator file, must survive\n');
  assert.throws(() => installManagedLauncher({ session, launcherSource: source, managedDir, commandPath }),
    /bootstrap_launcher_command_occupied/);
  assert.equal(fs.readFileSync(commandPath, 'utf8'), 'operator file, must survive\n');
  assert.equal(fs.existsSync(join(managedDir, 'launcher')), false);
});

test('F should refuse a directory occupant as force-required', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  fs.mkdirSync(commandPath, { mode: 0o755 });
  assert.throws(() => installManagedLauncher({ session, launcherSource: source, managedDir, commandPath }),
    /bootstrap_launcher_command_occupied/);
  assert.equal(fs.statSync(commandPath).isDirectory(), true);
});

test('F should refuse a foreign command link instead of replacing it', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  fs.symlinkSync(source, commandPath);
  assert.throws(() => installManagedLauncher({ session, launcherSource: source, managedDir, commandPath }),
    /bootstrap_launcher_command_foreign/);
  assert.equal(fs.readlinkSync(commandPath), source);
  assert.equal(fs.existsSync(join(managedDir, 'launcher')), false);
});

test('F should refuse a dangling command link for diagnosis', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  fs.symlinkSync(join(managedDir, 'missing-target.mjs'), commandPath);
  assert.throws(() => installManagedLauncher({ session, launcherSource: source, managedDir, commandPath }),
    /bootstrap_launcher_command_dangling/);
  assert.equal(fs.lstatSync(commandPath).isSymbolicLink(), true);
});

test('F should adopt the legacy link and reinstall the managed link', async t => {
  const { installManagedLauncher, session, managedDir, source, f } = await setup(t);
  // Production topology: the managed command IS the legacy link itself
  // (prefix/bin/h2a resolving to the legacy entry), not a chained link
  // pointing at it. A chained link now classifies foreign (fail-closed).
  const commandPath = f.command;
  const before = fs.readFileSync(f.entry, 'utf8');
  const installed = installManagedLauncher({ session, launcherSource: source, managedDir, commandPath });
  assert.equal(fs.readlinkSync(commandPath), installed.launcherPath);
  assert.equal(fs.readFileSync(f.entry, 'utf8'), before);
  // No second call in this session: swapping the session's own observed link
  // correctly trips assertBootstrapSessionUnchanged (fail-closed). Managed-
  // link reinstall idempotency is covered by mh-l6-launcher-install.test.js
  // on the separate command path.
});

function attempt(args) {
  try { return { result: args.install(args.envelope) }; } catch (error) { return { error }; }
}

test('F should force an occupied command link only on explicit override', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  const run = envelope => attempt({ install: installManagedLauncher, envelope });
  fs.writeFileSync(commandPath, 'operator file\n');
  const base = { session, launcherSource: source, managedDir, commandPath };
  assert.throws(() => installManagedLauncher(base), /bootstrap_launcher_command_occupied/);
  for (const explicit of ['yes', 1, 0]) {
    assert.throws(() => installManagedLauncher({ ...base, explicit }), /bootstrap_launcher_install_invalid/);
  }
  assert.throws(() => installManagedLauncher({ ...base, explicit: false }), /bootstrap_launcher_command_occupied/);
  const forced = run({ ...base, explicit: true });
  assert.equal(forced.error, undefined);
  assert.equal(forced.result.forced, true);
  assert.equal(fs.readlinkSync(commandPath), forced.result.launcherPath);
  assert.equal(fs.existsSync(join(managedDir, 'launcher', 'h2a.mjs')), true);
});

test('F should force foreign and dangling links only on explicit override', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  const run = envelope => attempt({ install: installManagedLauncher, envelope });
  const base = { session, launcherSource: source, managedDir, commandPath };
  fs.symlinkSync(source, commandPath);
  const foreign = run({ ...base, explicit: true });
  assert.equal(foreign.error, undefined);
  assert.equal(foreign.result.forced, true);
  fs.unlinkSync(commandPath);
  fs.symlinkSync(join(managedDir, 'missing-target.mjs'), commandPath);
  const dangling = run({ ...base, explicit: true });
  assert.equal(dangling.error, undefined);
  assert.equal(dangling.result.forced, true);
  assert.equal(fs.readlinkSync(commandPath), dangling.result.launcherPath);
});

test('F should record an unforced installation without overriding', async t => {
  const { installManagedLauncher, session, managedDir, source, commandPath } = await setup(t);
  const installed = installManagedLauncher({ session, launcherSource: source, managedDir, commandPath });
  assert.equal(installed.forced, false);
});
