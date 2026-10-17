import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const test = (name, body) => { if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body); };
async function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-native-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ['scripts/build-release-native.mjs', 'scripts/prepare-workspace-native.mjs', 'scripts/release/native-toolchain.lock.json', 'scripts/release/artifacts/node-pty-linux-x64-gnu-napi8.tgz', 'packages/h2a/src/runtime/handover/wire.js'];
  for (const path of files) { fs.mkdirSync(join(root, path, '..'), { recursive: true }); fs.copyFileSync(new URL('../../../' + path, import.meta.url), join(root, path)); }
  fs.writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const { copyReleaseNative } = await import(pathToFileURL(join(root, files[0])));
  const { prepareWorkspaceNative } = await import(pathToFileURL(join(root, files[1])));
  const destination = join(root, 'payload'); fs.mkdirSync(destination);
  return { root, destination, copyReleaseNative, prepareWorkspaceNative, archive: join(root, files[3]) };
}
test('U10 should copy only the pinned native payload without a compiler or shared ELF inode', async t => {
  const f = await fixture(t), native = await f.copyReleaseNative(f.destination), second = join(f.root, 'second'); fs.mkdirSync(second);
  const copied = await f.copyReleaseNative(second);
  assert.equal(native.qualification, 'release-pinned-prebuild');
  assert.deepEqual(fs.readFileSync(native.binary), fs.readFileSync(copied.binary));
  assert.notEqual(fs.statSync(native.binary).ino, fs.statSync(copied.binary).ino);
  assert.deepEqual(fs.readdirSync(f.destination), ['node_modules']);
  assert.equal(fs.readdirSync(f.root).some(name => name.startsWith('.h2a-native-copy-')), false);
});
test('U10 should reject altered release archive bytes before extracting anything into a payload', async t => {
  const f = await fixture(t); fs.appendFileSync(f.archive, 'not the pinned archive');
  await assert.rejects(f.copyReleaseNative(f.destination), /native_archive_mismatch/);
  assert.deepEqual(fs.readdirSync(f.destination), []);
});
test('U10 should never overwrite an existing native copy destination', async t => {
  const f = await fixture(t); fs.writeFileSync(join(f.destination, 'sentinel'), 'preserve');
  await assert.rejects(f.copyReleaseNative(f.destination), /native_destination_must_be_empty/);
  assert.equal(fs.readFileSync(join(f.destination, 'sentinel'), 'utf8'), 'preserve');
});
test('U10 should prepare the real workspace prebuild idempotently without changing its JavaScript', async t => {
  const f = await fixture(t); await f.copyReleaseNative(f.destination);
  fs.renameSync(join(f.destination, 'node_modules'), join(f.root, 'node_modules'));
  const binary = join(f.root, 'node_modules/node-pty/build/Release/pty.node'), before = fs.readFileSync(join(f.root, 'node_modules/node-pty/lib/index.js'));
  fs.writeFileSync(binary, 'different old native binary');
  const first = await f.prepareWorkspaceNative(); assert.equal(first.changed, true);
  const info = fs.statSync(binary), second = await f.prepareWorkspaceNative(); assert.equal(second.changed, false);
  assert.equal(fs.statSync(binary).ino, info.ino);
  assert.deepEqual(fs.readFileSync(join(f.root, 'node_modules/node-pty/lib/index.js')), before);
});
test('U10 should refuse a shared workspace dependency and leave the outside target untouched', async t => {
  const f = await fixture(t); await f.copyReleaseNative(f.destination);
  fs.mkdirSync(join(f.root, 'node_modules')); fs.symlinkSync(join(f.destination, 'node_modules/node-pty'), join(f.root, 'node_modules/node-pty'));
  // A target elsewhere inside this temporary repo is allowed; outside is not.
  const external = fs.mkdtempSync(join(tmpdir(), 'mh-l6-native-external-')); t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.cpSync(join(f.destination, 'node_modules/node-pty'), external, { recursive: true });
  fs.unlinkSync(join(f.root, 'node_modules/node-pty')); fs.symlinkSync(external, join(f.root, 'node_modules/node-pty'));
  const before = fs.readFileSync(join(external, 'build/Release/pty.node'));
  await assert.rejects(f.prepareWorkspaceNative(), /workspace_native_target_external/);
  assert.deepEqual(fs.readFileSync(join(external, 'build/Release/pty.node')), before);
});
test('U10 should refuse mismatched workspace JavaScript before changing its native binding', async t => {
  const f = await fixture(t); await f.copyReleaseNative(f.destination); fs.renameSync(join(f.destination, 'node_modules'), join(f.root, 'node_modules'));
  const binary = join(f.root, 'node_modules/node-pty/build/Release/pty.node'); fs.writeFileSync(binary, 'preserve old binding');
  fs.appendFileSync(join(f.root, 'node_modules/node-pty/lib/index.js'), '// changed JavaScript');
  await assert.rejects(f.prepareWorkspaceNative(), /workspace_native_source_mismatch/);
  assert.equal(fs.readFileSync(binary, 'utf8'), 'preserve old binding');
});
test('U10 should preserve the previous binding and remove its temporary file when native replacement fails', async t => {
  const f = await fixture(t); await f.copyReleaseNative(f.destination); fs.renameSync(join(f.destination, 'node_modules'), join(f.root, 'node_modules'));
  const binary = join(f.root, 'node_modules/node-pty/build/Release/pty.node'); fs.writeFileSync(binary, 'preserve old binding');
  const original = fs.renameSync; fs.renameSync = () => { throw Error('injected_native_rename'); };
  try { await assert.rejects(f.prepareWorkspaceNative(), /injected_native_rename/); } finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(binary, 'utf8'), 'preserve old binding'); assert.deepEqual(fs.readdirSync(join(binary, '..')), ['pty.node']);
});
