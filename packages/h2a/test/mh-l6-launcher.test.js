import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';
const { buildManagedLauncher } = await import('../../../scripts/build-managed-launcher.mjs').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {};
});
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
async function fixture(t) {
  assert.equal(typeof buildManagedLauncher, 'function', 'standalone same-process launcher required');
  const f = installationFixture(); t.after(() => f.close());
  const target = f.image('launcher-selected', 1, `process.stdout.write(JSON.stringify({selected:true,pid:process.pid,entry:process.argv[1],nodePath:process.env.NODE_PATH??null})+'\\n');\n`);
  const store = new UpgradeStore(f.layout); store.begin({ upgradeId: 'one', target }); store.prepare('one'); store.select('one');
  const directory = join(f.layout.managedRoot, 'launcher'); fs.mkdirSync(directory, { mode: 0o700 });
  const launcher = join(directory, 'h2a.mjs'), bundle = await buildManagedLauncher();
  fs.writeFileSync(launcher, bundle.code, { mode: 0o700 });
  fs.mkdirSync(join(f.layout.canonicalPrefix, 'bin'), { mode: 0o700 });
  fs.symlinkSync(launcher, join(f.layout.canonicalPrefix, 'bin/h2a'));
  const run = (args = ['--json'], extra = {}, execArgs = []) => {
    const env = { ...process.env, PATH: join(f.layout.canonicalPrefix, 'bin') + ':/usr/bin', ...extra };
    delete env.NODE_OPTIONS; if (extra.NODE_OPTIONS) env.NODE_OPTIONS = extra.NODE_OPTIONS;
    const result = spawnSync(process.execPath, [...execArgs, launcher, ...args], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.signal, null, result.stderr); assert.equal(result.error, undefined, result.stderr);
    return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : undefined };
  };
  return { ...f, target, store, launcher, bundle, run };
}

test('U04 should import the verified absolute image in the launcher PID without npm imports', async t => {
  const f = await fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.selected, true);
  assert.equal(result.json.pid, result.pid);
  assert.equal(result.json.entry, join(f.target.root, f.target.entrypoint));
  assert.ok(f.bundle.imports.length > 0);
  assert.equal(f.bundle.imports.every(i => i.startsWith('node:')), true);
  const second = await buildManagedLauncher(); assert.equal(second.digest, f.bundle.digest);
});

test('U12 should remove NODE_PATH and refuse external loading flags from env or node argv', async t => {
  const f = await fixture(t);
  assert.equal(f.run([], { NODE_PATH: join(f.layout.canonicalPrefix, 'decoy') }).json.nodePath, null);
  const decoy = join(f.layout.canonicalPrefix, 'loader.mjs'); fs.writeFileSync(decoy, 'export {};');
  for (const result of [f.run(['--json'], { NODE_OPTIONS: `--import=${decoy}` }), f.run(['--json'], {}, ['--import', decoy])]) {
    assert.equal(result.status, 1);
    assert.equal(result.json.reason, 'external_loader_unqualified');
    assert.equal(result.json.selected, undefined);
  }
});

test('U06 should keep status read-only and use verified history only for diagnostics when selection is corrupt', async t => {
  const f = await fixture(t), path = join(f.state, 'selected-build.json'); fs.writeFileSync(path, '{');
  const before = fs.readFileSync(path), tx = fs.readFileSync(join(f.state, 'upgrade/transactions/one.json'));
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.selectionState, 'unreadable');
  assert.equal(status.json.recoveryCandidate.manifestDigest, f.target.manifestDigest);
  assert.equal(status.json.mutationsAllowed, false);
  assert.deepEqual(fs.readFileSync(path), before);
  assert.deepEqual(fs.readFileSync(join(f.state, 'upgrade/transactions/one.json')), tx);
  const serve = f.run(['mcp-serve', '--json']);
  assert.equal(serve.status, 1);
  assert.equal(serve.json.reason, 'selection_unreadable');
  assert.equal(serve.json.selected, undefined);
});

test('U06 should reject altered payload and foreign selection before importing code', async t => {
  const f = await fixture(t); fs.appendFileSync(join(f.target.root, f.target.entrypoint), '\n// changed');
  const tampered = f.run(); assert.equal(tampered.status, 1); assert.equal(tampered.json.reason, 'payload_mismatch');
  const path = join(f.state, 'selected-build.json'), record = readState(path, 'selection');
  replaceState(path, { ...record.value, prefixId: 'sha256:' + 'f'.repeat(64) }, 'selection', record);
  const foreign = f.run(); assert.equal(foreign.status, 1); assert.equal(foreign.json.reason, 'foreign_installation_authority');
});

test('U09 should diagnose PATH shadowing and a changed command link without rewriting either', async t => {
  const f = await fixture(t), rogue = join(f.layout.canonicalPrefix, 'rogue'); fs.mkdirSync(rogue, { mode: 0o700 });
  fs.writeFileSync(join(rogue, 'h2a'), '#!/bin/sh\nexit 97\n', { mode: 0o700 });
  const shadow = f.run(['--json'], { PATH: rogue + ':' + join(f.layout.canonicalPrefix, 'bin') });
  assert.equal(shadow.status, 1); assert.equal(shadow.json.reason, 'path_shadowing');
  const link = join(f.layout.canonicalPrefix, 'bin/h2a'); fs.unlinkSync(link); fs.symlinkSync(join(rogue, 'h2a'), link);
  const changed = f.run(['upgrade', 'status', '--json']);
  assert.equal(changed.status, 0); assert.equal(changed.json.externalInstallDetected, true);
  assert.equal(fs.readlinkSync(link), join(rogue, 'h2a'));
  const empty = join(f.layout.canonicalPrefix, 'empty'); fs.mkdirSync(empty, { mode: 0o700 });
  const launch = f.run(['--json'], { PATH: empty });
  assert.equal(launch.status, 1); assert.equal(launch.json.reason, 'external_install_detected');
});

test('U06 should never import an older fallback during an engaged selection transaction', async t => {
  const f = await fixture(t), path = join(f.state, 'selected-build.json'); fs.writeFileSync(path, 'null\n');
  const result = f.run(['upgrade', 'resume', 'one', '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.json.reason, 'selection_unreadable');
  assert.equal(result.json.selected, undefined);
  assert.equal(f.store.status('one').installationState, 'SELECTED');
});

test('U06 should reject a corrupt history payload as a diagnostic recovery candidate', async t => {
  const f = await fixture(t); fs.writeFileSync(join(f.state, 'selected-build.json'), '{');
  fs.appendFileSync(join(f.target.root, f.target.entrypoint), '\n// history payload changed');
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 0);
  assert.equal(status.json.recoveryCandidate, null);
  assert.equal(status.json.mutationsAllowed, false);
});

test('U06 should keep an in-progress selection available only for diagnosis until reconciled', async t => {
  const f = await fixture(t), path = join(f.state, 'upgrade/transactions/one.json'), record = readState(path, 'upgradeTransaction');
  replaceState(path, { ...record.value, revision: record.value.revision + 1, installationState: 'SELECTING' }, 'upgradeTransaction', record);
  const result = f.run(); assert.equal(result.status, 1); assert.equal(result.json.reason, 'selection_recovery_required');
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 0); assert.equal(status.json.transactions[0].phase, 'SELECTING');
  assert.equal(readState(path, 'upgradeTransaction').value.installationState, 'SELECTING');
});

test('U06 should refuse to claim a reliable status for an unknown journal without repairing it', async t => {
  const f = await fixture(t), path = join(f.state, 'upgrade/transactions/one.json');
  const bytes = JSON.stringify({ ...readState(path, 'upgradeTransaction').value, schemaVersion: 999 }) + '\n'; fs.writeFileSync(path, bytes);
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 1); assert.equal(status.json.ok, false);
  assert.match(status.json.reason, /invalid_format/);
  assert.equal(fs.readFileSync(path, 'utf8'), bytes);
});

test('U10 should refuse a runtime outside the qualified glibc profile before importing any image', async t => {
  const f = await fixture(t), { launchManaged } = await import('../src/runtime/upgrade/managed-launcher.js');
  const argv = [...process.argv], path = process.env.PATH, options = process.env.NODE_OPTIONS;
  t.after(() => { process.argv = argv; process.env.PATH = path;
    if (options === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = options; });
  process.env.PATH = join(f.layout.canonicalPrefix, 'bin'); delete process.env.NODE_OPTIONS;
  t.mock.method(process.report, 'getReport', () => ({ header: {} }));
  await assert.rejects(launchManaged(pathToFileURL(f.launcher).href), /authority_profile_unqualified/);
});
