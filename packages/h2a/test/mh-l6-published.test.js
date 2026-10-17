import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createManifest, verifyImage } from '../src/runtime/handover/image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { readPublishedPayload, preparePublishedImage } from '../src/runtime/upgrade/published-payload.js';
const test = (name, body) => { if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body); };
function fixture(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l6-published-')), root = join(directory, 'package');
  fs.mkdirSync(root, { mode: 0o755 }); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(join(root, 'package.json'), '{"name":"@fixture/sdk","version":"0.98.7","type":"module"}');
  fs.writeFileSync(join(root, 'entry.mjs'), 'export default 42;');
  const base = createManifest(root, { packageVersion: '0.98.7', buildId: 'future-published-build',
    profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: 22, nodeAbi: '127' },
    entrypoints: { main: 'entry.mjs' }, startupWaitBudgetMs: 10000, maxAttachments: 64, nativeArtifacts: [] });
  const matrix = { schemaVersion: 1, kind: 'h2a-published-payload', manifests: {
    '22': base, '24': { ...base, profile: { ...base.profile, nodeMajor: 24, nodeAbi: '137' } }
  } };
  const path = join(root, 'manifest.json'), write = value => fs.writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); write(matrix);
  return { directory, root, path, matrix, write, destination: join(directory, 'image') };
}
test('U10 should choose the current Node profile from one immutable published payload', t => {
  const f = fixture(t), bytes = fs.readFileSync(f.path), observed = readPublishedPayload(f.root);
  assert.equal(observed.manifest.profile.nodeMajor, Number(process.versions.node.split('.')[0]));
  assert.equal(observed.manifest.profile.nodeAbi, process.versions.modules);
  assert.equal(observed.manifestDigest, digest(f.matrix.manifests[process.versions.node.split('.')[0]]));
  assert.deepEqual(fs.readFileSync(f.path), bytes);
});
test('U10 should prepare a private durable image by changing only excluded manifest metadata', t => {
  const f = fixture(t), before = fs.readFileSync(f.path), source = readPublishedPayload(f.root);
  const image = preparePublishedImage(f.root, f.destination), stored = JSON.parse(fs.readFileSync(join(f.destination, 'manifest.json')));
  assert.deepEqual(stored, source.manifest); assert.equal(image.manifestDigest, source.manifestDigest);
  assert.equal(fs.statSync(f.destination).mode & 0o777, 0o700);
  assert.equal(verifyImage(f.destination, image.manifest, image.manifestDigest).verified, true);
  for (const row of image.manifest.files) if (row.type === 'file') assert.deepEqual(fs.readFileSync(join(f.root, row.path)), fs.readFileSync(join(f.destination, row.path)));
  assert.deepEqual(fs.readFileSync(f.path), before);
  assert.equal(fs.existsSync(join(f.directory, 'h2a-managed')), false);
});
test('U10 should refuse an absent Node profile before any image is prepared', t => {
  const f = fixture(t); delete f.matrix.manifests[process.versions.node.split('.')[0]]; f.write(f.matrix);
  assert.throws(() => preparePublishedImage(f.root, f.destination), /published_profile_absent/);
  assert.equal(fs.existsSync(f.destination), false);
});
test('U10 should refuse corrupt code claims in a nonselected published profile', t => {
  const f = fixture(t), other = process.versions.node.startsWith('22.') ? '24' : '22';
  f.matrix.manifests[other] = structuredClone(f.matrix.manifests[other]);
  f.matrix.manifests[other].files.find(row => row.path === 'entry.mjs').digest = 'sha256:' + '0'.repeat(64); f.write(f.matrix);
  assert.throws(() => preparePublishedImage(f.root, f.destination), /payload_mismatch/);
  assert.equal(fs.existsSync(f.destination), false);
});
test('U10 should refuse contradictory build identities between profiles with identical code', t => {
  const f = fixture(t); f.matrix.manifests['24'] = { ...f.matrix.manifests['24'], buildId: 'different-build' }; f.write(f.matrix);
  assert.throws(() => readPublishedPayload(f.root), /published_payload_profiles_disagree/);
});
test('U10 should refuse an unsupported or incorrectly bound profile and unknown envelope fields', t => {
  const f = fixture(t), original = structuredClone(f.matrix);
  for (const bad of [null, { ...original, unknown: true }, { ...original, manifests: { '25': original.manifests['24'] } },
    { ...original, manifests: { '22': original.manifests['24'], '24': original.manifests['22'] } }]) {
    f.write(bad); assert.throws(() => readPublishedPayload(f.root), /published_manifest_invalid|published_profile_unknown|published_profile_mismatch|image_loader_unqualified/);
  }
});
test('U10 should bind published version metadata to the actual package version', t => {
  const f = fixture(t);
  for (const manifest of Object.values(f.matrix.manifests)) manifest.packageVersion = '0.98.8'; f.write(f.matrix);
  assert.throws(() => readPublishedPayload(f.root), /published_package_version_mismatch/);
});
test('U10 should remove only its own new destination when source code changes during the copy', t => {
  const f = fixture(t), original = fs.cpSync;
  fs.cpSync = function(source, ...args) { if (source === f.root) fs.appendFileSync(join(f.root, 'entry.mjs'), '\n// changed after verification'); return original.call(this, source, ...args); };
  try { assert.throws(() => preparePublishedImage(f.root, f.destination), /payload_mismatch/); }
  finally { fs.cpSync = original; }
  assert.equal(fs.existsSync(f.destination), false); assert.equal(fs.existsSync(f.path), true);
});
test('U10 should never overwrite or remove a preexisting image destination', t => {
  const f = fixture(t); fs.mkdirSync(f.destination); fs.writeFileSync(join(f.destination, 'sentinel'), 'preserve');
  assert.throws(() => preparePublishedImage(f.root, f.destination), /EEXIST/);
  assert.equal(fs.readFileSync(join(f.destination, 'sentinel'), 'utf8'), 'preserve');
});
test('U10 should refuse image preparation when a durable payload sync fails', t => {
  const f = fixture(t), original = fs.fsyncSync, before = fs.readFileSync(f.path);
  fs.fsyncSync = fd => { if (fs.fstatSync(fd).isFile()) throw Error('injected_payload_sync'); return original(fd); };
  try { assert.throws(() => preparePublishedImage(f.root, f.destination), /injected_payload_sync/); }
  finally { fs.fsyncSync = original; }
  assert.equal(fs.existsSync(f.destination), false); assert.deepEqual(fs.readFileSync(f.path), before);
});

test('U10 should preserve internal link bytes and execute the copied image after the mutable source disappears', async t => {
  const f = fixture(t); fs.symlinkSync('./entry.mjs', join(f.root, 'alias.mjs'));
  for (const key of Object.keys(f.matrix.manifests)) f.matrix.manifests[key] = createManifest(f.root, f.matrix.manifests[key]);
  f.write(f.matrix);
  let image; assert.doesNotThrow(() => { image = preparePublishedImage(f.root, f.destination); });
  assert.equal(fs.readlinkSync(join(f.destination, 'alias.mjs')), './entry.mjs');
  fs.rmSync(f.root, { recursive: true });
  assert.equal(verifyImage(f.destination, image.manifest, image.manifestDigest).verified, true);
  assert.equal((await import(pathToFileURL(join(f.destination, 'alias.mjs')))).default, 42);
});

test('U10 should durably publish the image directory entry before returning and refuse a failed parent sync', t => {
  const f = fixture(t), parent = fs.statSync(f.directory), original = fs.fsyncSync;
  let observed = false, fail = false;
  fs.fsyncSync = fd => {
    const info = fs.fstatSync(fd);
    if (info.dev === parent.dev && info.ino === parent.ino) {
      observed = true;
      if (fail) throw Error('injected_image_parent_sync');
    }
    return original(fd);
  };
  try {
    preparePublishedImage(f.root, f.destination);
    assert.equal(observed, true, 'syncing files and the image itself does not persist its entry in the parent directory');
    fail = true; const next = join(f.directory, 'second-image');
    assert.throws(() => preparePublishedImage(f.root, next), /injected_image_parent_sync/);
    assert.equal(fs.existsSync(next), false); assert.equal(fs.existsSync(f.destination), true);
  } finally { fs.fsyncSync = original; }
});
