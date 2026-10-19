import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/npm-command.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.assessNpmCommand, 'function', 'npm command assessor required');
  return module;
}
function layout(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'mh-l6-npm-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managedLauncher = join(root, 'managed', 'launcher', 'h2a.mjs');
  const legacyEntry = join(root, 'prefix', 'lib/node_modules/pkg/dist/bin.js');
  for (const dir of [dirname(managedLauncher), dirname(legacyEntry), join(root, 'bin')]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  fs.writeFileSync(managedLauncher, 'export const launcher = true;\n');
  fs.writeFileSync(legacyEntry, '#!/usr/bin/env node\n');
  return { root, managedLauncher, legacyEntry, commandPath: join(root, 'bin/h2a') };
}

test('D should report a managed command link', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  fs.symlinkSync(f.managedLauncher, f.commandPath);
  const verdict = assessNpmCommand({ commandPath: f.commandPath, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry });
  assert.deepEqual(verdict, { state: 'managed', action: 'none' });
  assert.equal(Object.isFrozen(verdict), true);
});

test('D should report a legacy command link awaiting adoption', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  fs.symlinkSync(f.legacyEntry, f.commandPath);
  const verdict = assessNpmCommand({ commandPath: f.commandPath, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry });
  assert.deepEqual(verdict, { state: 'legacy', action: 'adopt' });
});

test('D should report a missing command link after uninstall', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  const verdict = assessNpmCommand({ commandPath: f.commandPath, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry });
  assert.deepEqual(verdict, { state: 'missing', action: 'install' });
});

test('D should report a foreign command link for diagnosis', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  const other = join(f.root, 'other.js'); fs.writeFileSync(other, 'x');
  fs.symlinkSync(other, f.commandPath);
  const verdict = assessNpmCommand({ commandPath: f.commandPath, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry });
  assert.equal(verdict.state, 'foreign');
  assert.equal(verdict.action, 'diagnose');
  assert.equal(verdict.actual, other);
});

test('D should report a dangling command link for diagnosis', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  const gone = join(f.root, 'gone.js');
  fs.symlinkSync(gone, f.commandPath);
  const verdict = assessNpmCommand({ commandPath: f.commandPath, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry });
  assert.equal(verdict.state, 'dangling');
  assert.equal(verdict.action, 'diagnose');
  assert.equal(verdict.actual, gone);
});

test('D should require force where a plain file occupies the command path', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  for (const occupant of ['file', 'dir']) {
    const path = join(f.root, `bin-${occupant}`);
    if (occupant === 'file') fs.writeFileSync(path, 'foreign binary');
    else fs.mkdirSync(path, { mode: 0o755 });
    const verdict = assessNpmCommand({ commandPath: path, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry });
    assert.equal(verdict.state, 'occupied');
    assert.equal(verdict.action, 'force-required');
    assert.equal(verdict.kind, occupant);
  }
});

test('D should refuse an invalid command assessment envelope', async t => {
  const { assessNpmCommand } = await api(), f = layout(t);
  const valid = { commandPath: f.commandPath, managedLauncher: f.managedLauncher, legacyEntry: f.legacyEntry };
  for (const args of [null, 42, 'assess', [], { ...valid, commandPath: 'relative/h2a' },
    { ...valid, managedLauncher: null }, { ...valid, legacyEntry: 42 }]) {
    assert.throws(() => assessNpmCommand(args), /npm_command_invalid/);
  }
  for (const path of [f.commandPath, f.managedLauncher, f.legacyEntry]) assert.equal(isAbsolute(path), true);
});

test('D should classify a genuine npm-installed link as legacy', async t => {
  const { assessNpmCommand } = await api();
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'mh-l6-npm-real-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'pkg');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'h2a-fixture-bin', version: '0.0.0', bin: { h2a: 'bin.js' } }));
  fs.writeFileSync(join(pkg, 'bin.js'), '#!/usr/bin/env node\nprocess.stdout.write("fixture");\n', { mode: 0o755 });
  const packed = execFileSync('npm', ['pack', '--pack-destination', root, '--no-audit', '--no-fund', '--loglevel', 'error'], { cwd: pkg, encoding: 'utf8', timeout: 120000 }).trim().split('\n').at(-1);
  const prefix = join(root, 'prefix');
  execFileSync('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--no-save', '--loglevel', 'error', join(root, packed)], { encoding: 'utf8', timeout: 180000 });
  const commandPath = join(prefix, 'node_modules', '.bin', 'h2a');
  const legacyEntry = join(prefix, 'node_modules', 'h2a-fixture-bin', 'bin.js');
  assert.equal(fs.lstatSync(commandPath).isSymbolicLink(), true);
  const verdict = assessNpmCommand({ commandPath, managedLauncher: join(root, 'managed', 'h2a.mjs'), legacyEntry });
  assert.equal(verdict.state, 'legacy');
  assert.equal(verdict.action, 'adopt');
});
