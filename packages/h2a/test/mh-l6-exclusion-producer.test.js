// M18 producer: observe the four live legacy closures on the real
// published .5/.6, persist the exclusion-evidence.json the real bootstrap
// path consumes, and return the assessed verdict. The file is a truthful
// record: an unfenced observation is persisted as observed (selection
// then defers), never upgraded into a proof.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { produceLegacyExclusionEvidence } from '../src/runtime/upgrade/legacy-observers.js';
import { assessLegacyExclusion } from '../src/runtime/upgrade/legacy-exclusion.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function legacyTree(t, version) {
  assert.ok(process.env.MH_L5_ARTIFACTS, 'official published legacy fixtures mandatory; never skip');
  const root = fs.realpathSync(process.env.MH_L5_ARTIFACTS);
  const file = `sentropic-h2a-${version}.tgz`;
  const receipt = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
  const record = receipt.verified.find(row => row.file === file);
  assert.ok(record, `receipt must list ${file}`);
  const archive = join(root, file);
  assert.equal(hash(fs.readFileSync(archive)), record.sha256, 'execute the actual published tarball bytes');
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l6-legacy-live-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  cp.execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', directory]);
  return join(directory, 'package');
}

function managedSurface(t, legacyRoot) {
  const base = fs.mkdtempSync(join(tmpdir(), 'mh-l6-legacy-managed-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const managedDir = join(base, 'managed'), launcherDir = join(managedDir, 'launcher');
  fs.mkdirSync(launcherDir, { recursive: true, mode: 0o700 });
  const managedLauncher = join(launcherDir, 'h2a.mjs');
  fs.writeFileSync(managedLauncher, 'export const managed = true;\n', { mode: 0o755 });
  const commandPath = join(base, 'h2a');
  fs.symlinkSync(managedLauncher, commandPath);
  const legacyEntry = join(legacyRoot, 'dist/bin.js');
  assert.equal(fs.statSync(legacyEntry).isFile(), true);
  const workDir = join(base, 'work'), homeDir = join(base, 'home');
  fs.mkdirSync(workDir, { mode: 0o700 }); fs.mkdirSync(homeDir, { mode: 0o700 });
  const managedRoot = join(base, 'root');
  fs.mkdirSync(managedRoot, { mode: 0o700 });
  return { managedDir, managedLauncher, commandPath, legacyEntry, workDir, homeDir, managedRoot };
}

for (const version of ['0.98.5', '0.98.6']) {
  test(`M18 producer persists observed exclusion proof for real legacy ${version}`, async t => {
    const legacyRoot = legacyTree(t, version);
    const surface = managedSurface(t, legacyRoot);
    const produced = await produceLegacyExclusionEvidence({ legacyRoot, version, ...surface });
    assert.equal(produced.path, join(surface.managedRoot, 'exclusion-evidence.json'));
    assert.ok(fs.existsSync(produced.path), 'observed proof is persisted before verdict');
    assert.equal(produced.verdict.fenced, true);
    assert.equal(produced.verdict.reason, 'legacy_exclusion_verified');
    const persisted = JSON.parse(fs.readFileSync(produced.path, 'utf8'));
    for (const key of ['workersTerminated', 'relaunchSourcesClosed', 'futureStartsRouted', 'installerReintroductionBarred']) {
      assert.equal(persisted[key]?.established, true, `${key} observed and persisted`);
      assert.ok(typeof persisted[key]?.detail === 'string' && persisted[key].detail.length > 0);
    }
    assert.equal(assessLegacyExclusion(persisted).fenced, true);
  });
}

test('M18 producer refuses an invalid envelope before observing anything', async t => {
  await assert.rejects(() => produceLegacyExclusionEvidence(), /legacy_observer_invalid/);
  await assert.rejects(() => produceLegacyExclusionEvidence({}), /legacy_observer_invalid/);
  await assert.rejects(() => produceLegacyExclusionEvidence({ legacyRoot: '/nope', version: '' }), /legacy_observer_invalid/);
});

test('M18 producer persists an unfenced observation truthfully and reports it', async t => {
  const legacyRoot = legacyTree(t, '0.98.6');
  const surface = managedSurface(t, legacyRoot);
  // Route future starts at the legacy installer: the closure cannot be
  // established, but the observation is still persisted as observed.
  const produced = await produceLegacyExclusionEvidence({ legacyRoot, version: '0.98.6', ...surface, commandPath: join(legacyRoot, 'dist/bin.js') });
  assert.ok(fs.existsSync(produced.path), 'unfenced observations are persisted truthfully');
  assert.equal(produced.verdict.fenced, false);
  assert.ok(produced.verdict.missing.includes('futureStartsRouted'));
  const persisted = JSON.parse(fs.readFileSync(produced.path, 'utf8'));
  assert.equal(persisted.futureStartsRouted.established, false);
  assert.equal(assessLegacyExclusion(persisted).fenced, false);
});
