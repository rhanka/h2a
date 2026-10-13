import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../src/runtime/handover/wire.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';

test('QF A+B starters should verify absolute selected entry, reject pause and refuse implicit old-image fallback', async () => {
  const { resolveSelectedEntry, starterPlan } = await import('../src/runtime/handover/selection.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-selection-'));
  try {
    const images = join(dir, 'images'), state = join(dir, 'state');
    fs.mkdirSync(images, { mode: 0o700 }); fs.mkdirSync(state, { mode: 0o700 });
    const payload = join(dir, 'payload'); fs.mkdirSync(payload, { mode: 0o700 });
    fs.writeFileSync(join(payload, 'entry.js'), 'export const value=1;\n', { mode: 0o600 });
    const manifest = createManifest(payload, { packageVersion: '0.98.7', buildId: 'target', profile: {
      platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
      entrypoints: { cli: 'entry.js' }, startupWaitBudgetMs: 10000, maxAttachments: 32, nativeArtifacts: [] });
    const hash = digest(manifest), image = join(images, hash.slice(7));
    fs.renameSync(payload, image); fs.writeFileSync(join(image, 'manifest.json'), JSON.stringify(manifest));
    const installation = { canonicalPrefix: dir, managedRoot: dir, uid: process.getuid(), prefixId: digest({ canonicalPrefix: dir, uid: process.getuid() }) };
    const selection = { schemaVersion: 1, prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(), selectionEpoch: 2,
      packageVersion: '0.98.7', buildId: 'target', manifestDigest: hash, entrypoint: 'entry.js', previousSelectionReference: null, upgradeId: 'u' };
    publishState(join(state, 'selected-build.json'), selection, 'selection');
    const current = resolveSelectedEntry(installation);
    assert.equal(current.entrypoint, join(image, 'entry.js'));
    for (const kind of ['shim', 'run', 'restore', 'auto-serve', 'explicit-serve', 'controller']) {
      assert.equal(starterPlan({ installation, directory: state, kind, fallbackEntry: '/old/bin.js' }).entrypoint, current.entrypoint);
    }
    publishState(join(state, 'operator-stop.json'), { schemaVersion: 1, revision: 1, paused: true, requestedAt: 1, generation: null }, 'pause');
    for (const kind of ['shim', 'run', 'restore', 'auto-serve', 'controller']) assert.throws(() => starterPlan({ installation, directory: state, kind, fallbackEntry: '/old/bin.js' }), /deferred_paused/);
    assert.equal(starterPlan({ installation, directory: state, kind: 'explicit-serve', fallbackEntry: '/old/bin.js' }).requiresExplicitResume, true);
    fs.writeFileSync(join(state, 'selected-build.json'), '{broken', { mode: 0o600 });
    assert.throws(() => starterPlan({ installation, directory: state, kind: 'explicit-serve', fallbackEntry: '/old/bin.js' }), /selection_unreadable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
