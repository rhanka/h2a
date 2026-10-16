import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  let module;
  try { module = await import('../src/runtime/upgrade/physical-installation.js'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof module?.inspectLegacyInstallation, 'function', 'physical npm evidence must exist before adoption');
  return module;
}
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-physical-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = join(root, 'prefix'), pkg = join(prefix, 'lib/node_modules/@sentropic/h2a');
  fs.mkdirSync(join(pkg, 'dist'), { recursive: true, mode: 0o755 });
  fs.mkdirSync(join(prefix, 'bin'), { mode: 0o755 });
  const entry = join(pkg, 'dist/bin.js'), meta = join(pkg, 'package.json'), command = join(prefix, 'bin/h2a');
  fs.writeFileSync(entry, '#!/usr/bin/env node\nprocess.stdout.write("must never execute");\n', { mode: 0o755 });
  const metadata = { name: '@sentropic/h2a', version: '0.98.7', bin: { h2a: 'dist/bin.js' } };
  fs.writeFileSync(meta, JSON.stringify(metadata), { mode: 0o644 });
  fs.symlinkSync('../lib/node_modules/@sentropic/h2a/dist/bin.js', command);
  return { root, prefix, pkg, entry, meta, command, metadata,
    options: { prefix, entrypoint: command, legacyPrefix: prefix } };
}

test('U07 should derive physical prefix and original npm link without preparing managed state', async t => {
  const { inspectLegacyInstallation, assertLegacyInstallationUnchanged } = await api(), f = fixture(t);
  const before = fs.readdirSync(f.prefix).sort();
  const evidence = inspectLegacyInstallation(f.options);
  assert.equal(evidence.canonicalPrefix, f.prefix);
  assert.equal(evidence.entrypoint, f.entry);
  assert.equal(evidence.packageVersion, '0.98.7');
  assert.equal(evidence.command.target, '../lib/node_modules/@sentropic/h2a/dist/bin.js');
  assert.match(evidence.metadata.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.entry.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence.lateLoadSafety, 'unverified');
  assert.equal(evidence.managedImage, false);
  assert.equal(Object.isFrozen(evidence.command), true);
  assert.deepEqual(assertLegacyInstallationUnchanged(evidence), evidence);
  assert.deepEqual(fs.readdirSync(f.prefix).sort(), before);
  assert.equal(fs.existsSync(join(f.prefix, 'h2a-managed')), false);
  assert.equal(fs.existsSync(join(f.prefix, '.h2a-upgrade.lock')), false);
});
test('U07 should accept physical prefix aliases but reject a different caller npm prefix', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), alias = join(f.root, 'alias');
  fs.symlinkSync(f.prefix, alias);
  const evidence = inspectLegacyInstallation({ prefix: alias, entrypoint: join(alias, 'bin/h2a'), legacyPrefix: alias });
  assert.equal(evidence.canonicalPrefix, f.prefix);
  assert.throws(() => inspectLegacyInstallation({ ...f.options, prefix: f.root }), /legacy_prefix_mismatch/);
});
test('U07 should reject a different physical prefix used by the legacy engine', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t);
  assert.throws(() => inspectLegacyInstallation({ ...f.options, legacyPrefix: f.root }), /legacy_prefix_mismatch/);
});
test('U07 should verify the npm package identity and declared command entry', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t);
  for (const change of [{ name: '@other/h2a' }, { version: 'latest' }, { bin: { h2a: 'other.js' } }]) {
    fs.writeFileSync(f.meta, JSON.stringify({ ...f.metadata, ...change }));
    assert.throws(() => inspectLegacyInstallation(f.options), /legacy_package_metadata_invalid/);
  }
  fs.writeFileSync(f.meta, JSON.stringify({ ...f.metadata, version: '17.42.9-preview.2+future', bin: './dist/bin.js' }));
  assert.equal(inspectLegacyInstallation(f.options).packageVersion, '17.42.9-preview.2+future');
});
test('U07 should reject a metadata file alias even when it names identical bytes', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), copy = join(f.root, 'copied-package.json');
  fs.renameSync(f.meta, copy); fs.symlinkSync(copy, f.meta);
  assert.throws(() => inspectLegacyInstallation(f.options), /legacy_file_unqualified/);
});
test('U07 should reject hardlinked npm code before adoption', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t);
  fs.linkSync(f.entry, join(f.root, 'shared-code.js'));
  assert.throws(() => inspectLegacyInstallation(f.options), /legacy_file_unqualified/);
});
test('U07 should reject a code directory alias to an external installation', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), outside = join(f.root, 'outside-dist');
  fs.renameSync(join(f.pkg, 'dist'), outside); fs.symlinkSync(outside, join(f.pkg, 'dist'));
  assert.throws(() => inspectLegacyInstallation(f.options), /legacy_entry_location_invalid/);
});
test('U07 should reject a writable physical package directory', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t);
  fs.chmodSync(f.pkg, 0o775);
  assert.throws(() => inspectLegacyInstallation(f.options), /legacy_directory_unqualified/);
});
test('U07 should reject writable npm metadata and entry bytes', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t);
  for (const file of [f.meta, f.entry]) {
    const mode = fs.statSync(file).mode & 0o777;
    fs.chmodSync(file, mode | 0o020);
    assert.throws(() => inspectLegacyInstallation(f.options), /legacy_file_unqualified/);
    fs.chmodSync(file, mode);
  }
});
test('U07 should require the current command to be the direct original npm symlink', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t);
  fs.unlinkSync(f.command); fs.copyFileSync(f.entry, f.command);
  assert.throws(() => inspectLegacyInstallation({ ...f.options, entrypoint: f.entry }), /legacy_command_unqualified/);
  fs.unlinkSync(f.command); fs.symlinkSync(f.entry, join(f.root, 'indirect')); fs.symlinkSync(join(f.root, 'indirect'), f.command);
  assert.throws(() => inspectLegacyInstallation(f.options), /legacy_command_unqualified/);
});
test('U07 should preserve physical evidence when compatible lock and staging directories are created', async t => {
  const { inspectLegacyInstallation, assertLegacyInstallationUnchanged } = await api(), f = fixture(t);
  const evidence = inspectLegacyInstallation(f.options);
  fs.writeFileSync(join(f.prefix, '.h2a-upgrade.lock'), 'not a real lease');
  fs.mkdirSync(join(f.prefix, 'h2a-managed'), { mode: 0o700 });
  assert.deepEqual(assertLegacyInstallationUnchanged(evidence), evidence);
});
test('U07 should derive evidence from a real private offline global npm install', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), source = join(f.root, 'source');
  fs.mkdirSync(source); fs.mkdirSync(join(source, 'dist'));
  fs.writeFileSync(join(source, 'dist/bin.js'), fs.readFileSync(f.entry), { mode: 0o755 });
  fs.writeFileSync(join(source, 'package.json'), JSON.stringify({ ...f.metadata, files: ['dist'] }));
  const config = join(f.root, 'npmrc'), globalConfig = join(f.root, 'global-npmrc');
  fs.writeFileSync(config, ''); fs.writeFileSync(globalConfig, '');
  const env = { ...process.env, npm_config_cache: join(f.root, 'npm-cache'), npm_config_userconfig: config,
    npm_config_globalconfig: globalConfig, npm_config_update_notifier: 'false', npm_config_prefix: f.root };
  // npm's PATH/Node comes from the qualification profile; it never uses a live
  // owner prefix, registry, configuration or package script.
  const npm = args => execFileSync('npm', args, { cwd: f.root, env, encoding: 'utf8', timeout: 30000 });
  const packed = JSON.parse(npm(['pack', source, '--offline', '--ignore-scripts', '--json']))[0];
  const prefix = join(f.root, 'npm-global');
  const installed = npm(['install', '-g', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(f.root, packed.filename)]);
  t.diagnostic(`npm ${npm(['--version']).trim()}: pack/install --offline --ignore-scripts => ${installed.trim()}`);
  const evidence = inspectLegacyInstallation({ prefix, legacyPrefix: prefix, entrypoint: join(prefix, 'bin/h2a') });
  assert.equal(evidence.canonicalPrefix, prefix);
  assert.equal(evidence.packageVersion, '0.98.7');
  assert.equal(evidence.entrypoint, join(prefix, 'lib/node_modules/@sentropic/h2a/dist/bin.js'));
  assert.equal(evidence.managedImage, false);
});
test('U07 should reject a shadowed npm command even when the chosen entry is real', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), other = join(f.root, 'other.js');
  fs.writeFileSync(other, 'throw Error("external");'); fs.unlinkSync(f.command); fs.symlinkSync(other, f.command);
  assert.throws(() => inspectLegacyInstallation({ ...f.options, entrypoint: f.entry }), /legacy_command_unqualified/);
});
test('U07 should detect changed entry bytes before a subsequent adoption mutation', async t => {
  const { inspectLegacyInstallation, assertLegacyInstallationUnchanged } = await api(), f = fixture(t);
  const evidence = inspectLegacyInstallation(f.options); fs.appendFileSync(f.entry, '// late npm replacement\n');
  assert.throws(() => assertLegacyInstallationUnchanged(evidence), /legacy_installation_changed/);
});
test('U07 should detect an identical-byte inode replacement of the original command', async t => {
  const { inspectLegacyInstallation, assertLegacyInstallationUnchanged } = await api(), f = fixture(t);
  const evidence = inspectLegacyInstallation(f.options), replacement = join(f.prefix, 'bin/replacement');
  fs.symlinkSync(fs.readlinkSync(f.command), replacement); fs.renameSync(replacement, f.command);
  assert.throws(() => assertLegacyInstallationUnchanged(evidence), /legacy_installation_changed/);
});
test('U07 should detect alias retargeting after a physical observation', async t => {
  const { inspectLegacyInstallation, assertLegacyInstallationUnchanged } = await api(), f = fixture(t), alias = join(f.root, 'alias');
  fs.symlinkSync(f.prefix, alias);
  const evidence = inspectLegacyInstallation({ ...f.options, legacyPrefix: alias });
  fs.unlinkSync(alias); fs.symlinkSync(f.root, alias);
  assert.throws(() => assertLegacyInstallationUnchanged(evidence), /legacy_installation_changed/);
});
test('U07 should not accept a same-path substituted file between lstat and read', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), original = fs.openSync;
  let substituted = false;
  fs.openSync = function(path, ...args) {
    if (path === f.meta && !substituted) {
      substituted = true;
      fs.renameSync(f.meta, f.meta + '.old'); fs.writeFileSync(f.meta, JSON.stringify(f.metadata));
    }
    return original.call(this, path, ...args);
  };
  try { assert.throws(() => inspectLegacyInstallation(f.options), /legacy_installation_changed/); }
  finally { fs.openSync = original; }
  assert.equal(substituted, true);
});
test('U07 should recheck metadata after observing the command link', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), original = fs.readlinkSync;
  let changed = false;
  fs.readlinkSync = function(path, ...args) {
    const value = original.call(this, path, ...args);
    if (path === f.command && !changed) { changed = true; fs.appendFileSync(f.meta, '\n'); }
    return value;
  };
  try { assert.throws(() => inspectLegacyInstallation(f.options), /legacy_installation_changed/); }
  finally { fs.readlinkSync = original; }
  assert.equal(changed, true);
});
test('U07 should recheck the legacy prefix alias before returning an observation', async t => {
  const { inspectLegacyInstallation } = await api(), f = fixture(t), original = fs.readlinkSync;
  const alias = join(f.root, 'alias'); fs.symlinkSync(f.prefix, alias);
  let changed = false;
  fs.readlinkSync = function(path, ...args) {
    const value = original.call(this, path, ...args);
    if (path === f.command && !changed) {
      changed = true; fs.unlinkSync(alias); fs.symlinkSync(f.root, alias);
    }
    return value;
  };
  try { assert.throws(() => inspectLegacyInstallation({ ...f.options, legacyPrefix: alias }), /legacy_installation_changed/); }
  finally { fs.readlinkSync = original; }
  assert.equal(changed, true);
});
test('U07 should detect replaced npm metadata even when its version remains identical', async t => {
  const { inspectLegacyInstallation, assertLegacyInstallationUnchanged } = await api(), f = fixture(t);
  const evidence = inspectLegacyInstallation(f.options), replacement = f.meta + '.new';
  fs.writeFileSync(replacement, fs.readFileSync(f.meta)); fs.renameSync(replacement, f.meta);
  assert.throws(() => assertLegacyInstallationUnchanged(evidence), /legacy_installation_changed/);
});
