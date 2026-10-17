import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openBootstrapSession } from '../dist/runtime/upgrade/bootstrap-session.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { digest } from '../src/runtime/handover/wire.js';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/adoption-image.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.prepareAdoptionImage, 'function', 'adoption image preparer required');
  return module;
}
const PROFILE = { platform: 'linux', arch: process.arch, libc: 'glibc',
  nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules };
function legacy(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-adoption-image-'));
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
function stage(t, root, buildId = 'target', profile = PROFILE, mutateManifest = null) {
  const dir = fs.mkdtempSync(join(root, 'stage-'));
  fs.writeFileSync(join(dir, 'entry.mjs'), `export const buildId=${JSON.stringify(buildId)};\n`);
  fs.writeFileSync(join(dir, 'controller.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, entrypoint: 'entry.mjs' }));
  let manifest = createManifest(dir, { packageVersion: '0.98.7', buildId, profile,
    entrypoints: { controller: 'entry.mjs', shim: 'entry.mjs' }, startupWaitBudgetMs: 10000, maxAttachments: 64, nativeArtifacts: [] });
  if (mutateManifest) manifest = mutateManifest(manifest);
  fs.writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { dir, manifestDigest: digest(manifest) };
}
function setup(t) {
  const f = legacy(t);
  const target = { manifestDigest: `sha256:${'e'.repeat(64)}`, packageVersion: '0.98.7', entrypoint: 'entry.mjs' };
  const session = openBootstrapSession({ prefix: f.prefix, entrypoint: f.command, legacyPrefix: f.prefix, target });
  t.after(() => session.release());
  const imagesDir = join(f.root, 'images'); fs.mkdirSync(imagesDir, { mode: 0o700 });
  return { ...f, session, imagesDir };
}

test('C2b should prepare a verified adoption image under the session', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const { dir, manifestDigest } = stage(t, s.root);
  const prepared = prepareAdoptionImage({ session: s.session, stageDir: dir, imagesDir: s.imagesDir, expectedDigest: manifestDigest });
  assert.equal(prepared.manifestDigest, manifestDigest);
  assert.equal(prepared.imageDir, join(s.imagesDir, manifestDigest.slice(7)));
  assert.equal(fs.existsSync(dir), false);
  assert.equal(JSON.parse(fs.readFileSync(join(prepared.imageDir, 'manifest.json'), 'utf8')).packageVersion, '0.98.7');
});

test('C2b should refuse a stage whose digest differs from the expected image', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const { dir } = stage(t, s.root);
  fs.appendFileSync(join(dir, 'entry.mjs'), 'export const tampered=true;\n');
  assert.throws(() => prepareAdoptionImage({ session: s.session, stageDir: dir, imagesDir: s.imagesDir,
    expectedDigest: `sha256:${'e'.repeat(64)}` }), /adoption_image_digest_mismatch/);
  assert.equal(fs.existsSync(dir), true);
  assert.equal(fs.readdirSync(s.imagesDir).length, 0);
});

test('C2b should refuse an image outside the qualified runtime profile', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const { dir } = stage(t, s.root, 'future');
  const tampered = { ...JSON.parse(fs.readFileSync(join(dir, 'manifest.json'), 'utf8')),
    profile: { ...PROFILE, arch: process.arch === 'x64' ? 'arm64' : 'x64' } };
  fs.writeFileSync(join(dir, 'manifest.json'), JSON.stringify(tampered));
  assert.throws(() => prepareAdoptionImage({ session: s.session, stageDir: dir, imagesDir: s.imagesDir, expectedDigest: digest(tampered) }),
    /image_loader_unqualified/);
  assert.equal(fs.readdirSync(s.imagesDir).length, 0);
});

test('C2b should refuse a conflicting image already occupying the digest address', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const first = stage(t, s.root);
  prepareAdoptionImage({ session: s.session, stageDir: first.dir, imagesDir: s.imagesDir, expectedDigest: first.manifestDigest });
  const clash = join(s.imagesDir, first.manifestDigest.slice(7));
  fs.writeFileSync(join(clash, 'entry.mjs'), 'export const rogue=true;\n');
  const second = stage(t, s.root);
  assert.throws(() => prepareAdoptionImage({ session: s.session, stageDir: second.dir, imagesDir: s.imagesDir, expectedDigest: second.manifestDigest }),
    /payload_mismatch/);
});

test('C2b should prepare nothing when the installation drifted since the session opened', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const { dir, manifestDigest } = stage(t, s.root);
  fs.appendFileSync(s.entry, 'export const drifted=true;\n');
  assert.throws(() => prepareAdoptionImage({ session: s.session, stageDir: dir, imagesDir: s.imagesDir, expectedDigest: manifestDigest }),
    /legacy_installation_changed/);
  assert.equal(fs.existsSync(dir), true);
  assert.equal(fs.readdirSync(s.imagesDir).length, 0);
});

test('C2b should reuse an identical image already prepared at its digest address', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const first = stage(t, s.root);
  const once = prepareAdoptionImage({ session: s.session, stageDir: first.dir, imagesDir: s.imagesDir, expectedDigest: first.manifestDigest });
  const second = stage(t, s.root);
  const twice = prepareAdoptionImage({ session: s.session, stageDir: second.dir, imagesDir: s.imagesDir, expectedDigest: second.manifestDigest });
  assert.deepEqual(twice, once);
  assert.equal(fs.existsSync(second.dir), true);
});

test('C2b should refuse an invalid image preparation envelope', async t => {
  const { prepareAdoptionImage } = await api(), s = setup(t);
  const { dir, manifestDigest } = stage(t, s.root);
  const valid = { session: s.session, stageDir: dir, imagesDir: s.imagesDir, expectedDigest: manifestDigest };
  for (const args of [null, 42, 'prepare', [], { ...valid, session: null }, { ...valid, stageDir: 'relative' },
    { ...valid, imagesDir: join(s.root, 'no-such-dir') }, { ...valid, expectedDigest: 'sha256:short' }]) {
    assert.throws(() => prepareAdoptionImage(args), /adoption_image_invalid/);
  }
});
