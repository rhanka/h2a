import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assessLegacyExclusion } from '../dist/runtime/upgrade/legacy-exclusion.js';
import { verifyLegacyRoot, observeLegacyClosures } from '../dist/runtime/upgrade/legacy-observers.js';

const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
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

// Managed command surface: launcher file + command link resolving to it,
// legacy entry pointing at the real published installer bytes.
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
  return { managedDir, managedLauncher, commandPath, legacyEntry, workDir, homeDir };
}

async function fenced(t, version) {
  const legacyRoot = legacyTree(t, version);
  const managed = managedSurface(t, legacyRoot);
  const evidence = await observeLegacyClosures({ legacyRoot, version, ...managed });
  for (const key of ['workersTerminated', 'relaunchSourcesClosed', 'futureStartsRouted', 'installerReintroductionBarred']) {
    assert.equal(evidence[key].established, true, `${key}: ${evidence[key].detail}`);
    assert.ok(evidence[key].detail.includes(version), `${key} detail must cite the observed version`);
  }
  const verdict = assessLegacyExclusion(evidence);
  assert.equal(verdict.fenced, true);
  assert.equal(verdict.reason, 'legacy_exclusion_verified');
  return { legacyRoot, managed };
}

test('B2 should observe four live legacy closures on the real published 0.98.5 and fence', async t => {
  await fenced(t, '0.98.5');
});

test('B2 should observe four live legacy closures on the real published 0.98.6 and fence', async t => {
  await fenced(t, '0.98.6');
});

test('B2 should refuse an invalid observer envelope instead of observing', async () => {
  assert.equal(typeof observeLegacyClosures, 'function', 'legacy closure observers required');
  await assert.rejects(observeLegacyClosures(undefined), /legacy_observer_invalid/);
  await assert.rejects(observeLegacyClosures([]), /legacy_observer_invalid/);
});

test('B2 should refuse a legacy tree outside the expected published version', t => {
  const legacyRoot = legacyTree(t, '0.98.6');
  assert.throws(() => verifyLegacyRoot(legacyRoot, '0.98.5'), /legacy_observer_unexpected_legacy/);
  assert.throws(() => verifyLegacyRoot(join(legacyRoot, 'dist'), '0.98.6'), /legacy_observer_unexpected_legacy/);
  const forged = fs.mkdtempSync(join(tmpdir(), 'mh-l6-legacy-forged-'));
  t.after(() => fs.rmSync(forged, { recursive: true, force: true }));
  fs.writeFileSync(join(forged, 'package.json'), JSON.stringify({ name: '@sentropic/h2a', version: '0.98.6' }));
  fs.mkdirSync(join(forged, 'dist/runtime/upgrade'), { recursive: true });
  fs.writeFileSync(join(forged, 'dist/runtime/upgrade/index.js'), 'export const defaultUpgradeRuntime = {}; export function assessLegacyExclusion() {}\n');
  fs.writeFileSync(join(forged, 'dist/bin.js'), 'installer\n');
  assert.throws(() => verifyLegacyRoot(forged, '0.98.6'), /legacy_observer_unexpected_legacy/);
});

test('B2 should record owner_liveness_unknown for the published .5 and .6 without inventing provenance', t => {
  for (const version of ['0.98.5', '0.98.6']) {
    const legacyRoot = legacyTree(t, version);
    const identity = verifyLegacyRoot(legacyRoot, version);
    assert.equal(identity.ownerLiveness, 'owner_liveness_unknown');
    const bytes = fs.readFileSync(join(legacyRoot, 'dist/runtime/upgrade/index.js'), 'utf8');
    assert.ok(bytes.includes('defaultUpgradeRuntime'));
    assert.equal(bytes.includes('assessLegacyExclusion'), false);
    assert.equal(bytes.includes('bootId'), false);
  }
});

test('B2 should report unfenced while a live legacy worker still holds the tree', async t => {
  const legacyRoot = legacyTree(t, '0.98.6');
  const managed = managedSurface(t, legacyRoot);
  const sleeper = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000);'], { cwd: legacyRoot, stdio: 'ignore' });
  t.after(() => {
    try { sleeper.kill('SIGKILL'); } catch {}
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  const evidence = await observeLegacyClosures({ legacyRoot, version: '0.98.6', ...managed });
  assert.equal(evidence.workersTerminated.established, false);
  assert.match(evidence.workersTerminated.detail, /live worker pids/);
  const verdict = assessLegacyExclusion(evidence);
  assert.equal(verdict.fenced, false);
  assert.deepEqual(verdict.missing, ['workersTerminated']);
});

test('B2 should report unfenced when a relaunch source still references the legacy root', async t => {
  const legacyRoot = legacyTree(t, '0.98.6');
  const managed = managedSurface(t, legacyRoot);
  const autostart = join(managed.homeDir, '.config/autostart');
  fs.mkdirSync(autostart, { recursive: true, mode: 0o700 });
  fs.writeFileSync(join(autostart, 'legacy.desktop'), `[Desktop Entry]\nExec=${legacyRoot}/dist/bin.js\n`);
  const evidence = await observeLegacyClosures({ legacyRoot, version: '0.98.6', ...managed });
  assert.equal(evidence.relaunchSourcesClosed.established, false);
  const verdict = assessLegacyExclusion(evidence);
  assert.equal(verdict.fenced, false);
  assert.deepEqual(verdict.missing, ['relaunchSourcesClosed']);
});

test('B2 should report unfenced when future starts still resolve to the legacy entry', async t => {
  const legacyRoot = legacyTree(t, '0.98.6');
  const managed = managedSurface(t, legacyRoot);
  fs.unlinkSync(managed.commandPath);
  fs.symlinkSync(managed.legacyEntry, managed.commandPath);
  const evidence = await observeLegacyClosures({ legacyRoot, version: '0.98.6', ...managed });
  assert.equal(evidence.futureStartsRouted.established, false);
  const verdict = assessLegacyExclusion(evidence);
  assert.equal(verdict.fenced, false);
  assert.deepEqual(verdict.missing, ['futureStartsRouted']);
});

test('B2 should report unfenced when the managed tree reaches back into the legacy installer', async t => {
  const legacyRoot = legacyTree(t, '0.98.6');
  const managed = managedSurface(t, legacyRoot);
  fs.symlinkSync(join(legacyRoot, 'dist/bin.js'), join(managed.managedDir, 'launcher', 'legacy-alias.mjs'));
  const evidence = await observeLegacyClosures({ legacyRoot, version: '0.98.6', ...managed });
  assert.equal(evidence.installerReintroductionBarred.established, false);
  const verdict = assessLegacyExclusion(evidence);
  assert.equal(verdict.fenced, false);
  assert.deepEqual(verdict.missing, ['installerReintroductionBarred']);
});
