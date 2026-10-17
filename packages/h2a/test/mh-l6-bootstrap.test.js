import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquirePrefixLock } from '../dist/runtime/local-files/succession-lock.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/bootstrap-session.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.openBootstrapSession, 'function', 'bootstrap session opener required');
  return module;
}
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = join(root, 'prefix'), pkg = join(prefix, 'lib/node_modules/@sentropic/h2a');
  fs.mkdirSync(join(pkg, 'dist'), { recursive: true, mode: 0o755 });
  fs.mkdirSync(join(prefix, 'bin'), { mode: 0o755 });
  const entry = join(pkg, 'dist/bin.js'), meta = join(pkg, 'package.json'), command = join(prefix, 'bin/h2a');
  fs.writeFileSync(entry, '#!/usr/bin/env node\nprocess.stdout.write("must never execute");\n', { mode: 0o755 });
  fs.writeFileSync(meta, JSON.stringify({ name: '@sentropic/h2a', version: '0.98.6', bin: { h2a: 'dist/bin.js' } }), { mode: 0o644 });
  fs.symlinkSync('../lib/node_modules/@sentropic/h2a/dist/bin.js', command);
  const target = { manifestDigest: `sha256:${'a'.repeat(64)}`, packageVersion: '0.98.7', entrypoint: 'entry.mjs' };
  return { root, prefix, pkg, entry, meta, command, target,
    options: { prefix, entrypoint: command, legacyPrefix: prefix, target } };
}

test('C2b should open a protected bootstrap session on a verified physical installation', async t => {
  const { openBootstrapSession } = await api(), f = fixture(t);
  const session = openBootstrapSession(f.options);
  t.after(() => session.release());
  assert.equal(session.canonicalPrefix, f.prefix);
  assert.equal(session.evidence.packageVersion, '0.98.6');
  assert.deepEqual({ ...session.target }, f.target);
  assert.equal(Object.isFrozen(session), true);
});

test('C2b should refuse a prefix that does not resolve to the observed installation', async t => {
  const { openBootstrapSession } = await api(), f = fixture(t);
  assert.throws(() => openBootstrapSession({ ...f.options, prefix: f.root, legacyPrefix: f.root }), /legacy_prefix_mismatch/);
  const competing = acquirePrefixLock(f.prefix);
  assert.equal(competing.acquired, true);
  competing.release();
});

test('C2b should hold compatible exclusion while the session is open', async t => {
  const { openBootstrapSession } = await api(), f = fixture(t);
  const session = openBootstrapSession(f.options);
  try {
    const competing = acquirePrefixLock(f.prefix);
    assert.equal(competing.acquired, false);
    if (competing.acquired) competing.release();
  } finally { session.release(); }
  const after = acquirePrefixLock(f.prefix);
  assert.equal(after.acquired, true);
  after.release();
});

test('C2b should lock the verified canonical prefix even through a caller alias', async t => {
  const { openBootstrapSession } = await api(), f = fixture(t), alias = join(f.root, 'alias');
  fs.symlinkSync(f.prefix, alias);
  const session = openBootstrapSession({ prefix: alias, entrypoint: join(alias, 'bin/h2a'), legacyPrefix: alias, target: f.target });
  t.after(() => session.release());
  assert.equal(session.canonicalPrefix, f.prefix);
  const competing = acquirePrefixLock(f.prefix);
  assert.equal(competing.acquired, false);
  if (competing.acquired) competing.release();
});

test('C2b should refuse drift observed after the session opened', async t => {
  const { openBootstrapSession, assertBootstrapSessionUnchanged } = await api(), f = fixture(t);
  const session = openBootstrapSession(f.options);
  t.after(() => session.release());
  assert.equal(typeof assertBootstrapSessionUnchanged, 'function');
  fs.appendFileSync(f.entry, 'export const drifted=true;\n');
  assert.throws(() => assertBootstrapSessionUnchanged(session), /legacy_installation_changed/);
});

test('C2b should refuse an ineligible bootstrap target before holding anything', async t => {
  const { openBootstrapSession } = await api(), f = fixture(t);
  for (const target of [{ ...f.target, manifestDigest: 'sha256:short' }, { ...f.target, packageVersion: 'latest' },
    { ...f.target, entrypoint: '' }, null]) {
    assert.throws(() => openBootstrapSession({ ...f.options, target }), /bootstrap_target_invalid/);
  }
  const competing = acquirePrefixLock(f.prefix);
  assert.equal(competing.acquired, true);
  competing.release();
});
