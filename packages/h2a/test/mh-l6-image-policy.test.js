import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Module from 'node:module';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { buildNativePrototype } from '../../../scripts/mh-l0-native-prototype.mjs';
const { installImagePolicy } = await import('../src/runtime/upgrade/image-policy.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {};
});
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
function fixture(t, files) {
  assert.equal(typeof installImagePolicy, 'function', 'closed image reader required');
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l6-image-policy-')), root = join(directory, 'image');
  fs.mkdirSync(root, { mode: 0o700 }); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [path, bytes] of Object.entries({ 'package.json': '{"type":"module"}', ...files })) {
    fs.mkdirSync(join(root, path, '..'), { recursive: true }); fs.writeFileSync(join(root, path), bytes);
  }
  const manifest = createManifest(root, { packageVersion: '0.98.7', buildId: 'image-policy-fixture',
    profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
    entrypoints: { main: 'entry.mjs' }, startupWaitBudgetMs: 10000, maxAttachments: 64, nativeArtifacts: [] });
  fs.writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  const marker = join(directory, 'decoy-loaded');
  const decoy = (base, type = 'module') => {
    fs.mkdirSync(join(base, 'dep'), { recursive: true });
    fs.writeFileSync(join(base, 'dep/package.json'), JSON.stringify({ name: 'dep', type, main: './index.js' }));
    fs.writeFileSync(join(base, 'dep/index.js'), `requireOrImportMarker();\n`.replace('requireOrImportMarker();', type === 'module'
      ? `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'loaded');export default 'DECOY';`
      : `require('node:fs').writeFileSync(${JSON.stringify(marker)},'loaded');module.exports='DECOY';`));
  };
  const run = (action = 'none', envExtra = {}) => {
    const env = { ...process.env, ...envExtra }; delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/mh-l6-image-reader.mjs', import.meta.url)), root, digest(manifest), action],
      { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined, result.stderr); assert.equal(result.signal, null, result.stderr);
    assert.ok(result.stdout.trim(), result.stderr);
    return { ...result, json: JSON.parse(result.stdout) };
  };
  return { directory, root, manifest, marker, decoy, run, native(artifact) {
    Object.assign(manifest, createManifest(root, { ...manifest, nativeArtifacts: [{
      path: 'node_modules/node-pty/build/Release/pty.node', digest: artifact.binaryDigest,
      nodeAbi: process.versions.modules, arch: process.arch, libc: 'glibc', toolchainDigest: artifact.toolchainDigest,
      probePath: 'node_modules/node-pty' }] }));
    fs.writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  } };
}
const dep = { 'node_modules/dep/package.json': '{"name":"dep","type":"module","main":"./index.js"}',
  'node_modules/dep/index.js': "export default 'internal';" };

test('U12 should bind the image root SDK and its public subpath for an internal ESM dependency', t => {
  const f = fixture(t, {
    'package.json': JSON.stringify({ name: 'dep', type: 'module', exports: { '.': './sdk.mjs', './public': './public.mjs' } }),
    'entry.mjs': "export {default} from './node_modules/consumer/index.mjs';",
    'sdk.mjs': "export default 'root-sdk';", 'public.mjs': "export default 'root-public';",
    'node_modules/consumer/package.json': '{"name":"consumer","type":"module"}',
    'node_modules/consumer/index.mjs': "export default [(await import('dep')).default,(await import('dep/public')).default];"
  });
  f.decoy(join(f.directory, 'node_modules'));
  fs.writeFileSync(join(f.directory, 'node_modules/dep/public.js'), `import fs from'node:fs';fs.writeFileSync(${JSON.stringify(f.marker)},'loaded');export default 'outside';`);
  const result = f.run(); assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.deepEqual(result.json.value, ['root-sdk', 'root-public']); assert.equal(fs.existsSync(f.marker), false);
});
test('U12 should preserve require conditions when an internal dependency loads the image root SDK', t => {
  const f = fixture(t, {
    'package.json': JSON.stringify({ name: 'dep', type: 'module', exports: { '.': { import: './sdk.mjs', require: './sdk.cjs' } } }),
    'entry.mjs': "export {default} from './node_modules/consumer/index.mjs';",
    'sdk.mjs': "export default 'esm';", 'sdk.cjs': "module.exports='root-require';",
    'node_modules/consumer/package.json': '{"name":"consumer","type":"module"}',
    'node_modules/consumer/index.mjs': "import{createRequire}from'node:module';export default createRequire(import.meta.url)('dep');"
  });
  f.decoy(join(f.directory, 'node_modules'), 'commonjs');
  const result = f.run(); assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.equal(result.json.value, 'root-require'); assert.equal(fs.existsSync(f.marker), false);
});
test('U12 should refuse a forged external require base even when its package name matches the image root SDK', t => {
  const f = fixture(t, {
    'package.json': '{"name":"dep","exports":"./sdk.cjs"}', 'sdk.cjs': "module.exports='root';",
    'entry.mjs': "import{createRequire}from'node:module';export default createRequire(process.env.IMAGE_REQUIRE_BASE)('dep');"
  });
  f.decoy(join(f.directory, 'node_modules'), 'commonjs');
  const result = f.run('none', { IMAGE_REQUIRE_BASE: join(f.directory, 'external.cjs') });
  assert.equal(result.status, 1); assert.match(result.json.error, /image_external_module/);
  assert.equal(fs.existsSync(f.marker), false);
});
test('U12 should preserve root SDK export restrictions instead of loading a declared private file', t => {
  const f = fixture(t, {
    'package.json': '{"name":"dep","type":"module","exports":{".":"./sdk.mjs"}}',
    'entry.mjs': "export {default} from './node_modules/consumer/index.mjs';", 'sdk.mjs': 'export default 1;',
    'private.mjs': "import fs from'node:fs';fs.writeFileSync(process.env.IMAGE_PRIVATE_MARKER,'loaded');export default 'private';",
    'node_modules/consumer/package.json': '{"name":"consumer","type":"module"}',
    'node_modules/consumer/index.mjs': "export default (await import('dep/private.js')).default;"
  });
  f.decoy(join(f.directory, 'node_modules'));
  fs.writeFileSync(join(f.directory, 'node_modules/dep/private.js'), `import fs from'node:fs';fs.writeFileSync(${JSON.stringify(f.marker)},'loaded');export default 'outside';`);
  const result = f.run('none', { IMAGE_PRIVATE_MARKER: f.marker });
  assert.equal(result.status, 1); assert.equal(fs.existsSync(f.marker), false);
  assert.match(result.json.error, /image_external_module|image_dependency_missing/);
});

test('U12 should load verified relative and package modules through the real ESM and CJS readers', t => {
  const f = fixture(t, { 'entry.mjs': "import value from 'dep';import cjs from './local.cjs';export default [value,cjs];",
    'local.cjs': "module.exports=require('node:path').basename('/a/b');", ...dep });
  const result = f.run(); assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.deepEqual(result.json.value, ['internal', 'b']);
});

test('U12 should refuse a parent npm decoy after a verified ESM dependency disappears', t => {
  const f = fixture(t, { 'entry.mjs': "import value from 'dep';export default value;", ...dep });
  f.decoy(join(f.directory, 'node_modules'));
  const result = f.run('remove'); assert.equal(result.status, 1);
  assert.match(result.json.error, /image_external_module|image_dependency_missing/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('U12 should refuse a NODE_PATH decoy through createRequire after its internal package disappears', t => {
  const f = fixture(t, { 'entry.mjs': "import {createRequire}from'node:module';export default createRequire(import.meta.url)('dep');",
    'node_modules/dep/package.json': '{"name":"dep","main":"./index.cjs"}', 'node_modules/dep/index.cjs': "module.exports='internal';" });
  const decoys = join(f.directory, 'node-path'); f.decoy(decoys, 'commonjs');
  const result = f.run('remove', { NODE_PATH: decoys }); assert.equal(result.status, 1);
  assert.match(result.json.error, /image_external_module|image_dependency_missing/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('U12 should refuse an explicit out-of-image dynamic import before any decoy effect', t => {
  const f = fixture(t, { 'entry.mjs': "export default import('../outside.mjs');" });
  fs.writeFileSync(join(f.directory, 'outside.mjs'), `import fs from'node:fs';fs.writeFileSync(${JSON.stringify(f.marker)},'loaded');export default 1;`);
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.json.error, /image_external_module/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('U12 should recheck late module bytes and isolate the manifest snapshot from its caller', t => {
  for (const action of ['alter', 'alter-manifest']) {
    const f = fixture(t, { 'entry.mjs': "export default import('./late.mjs').then(m=>m.default);", 'late.mjs': 'export default 42;' });
    const result = f.run(action); assert.equal(result.status, 1); assert.match(result.json.error, /image_module_integrity/);
  }
});

test('U12 should preserve a missing dependency as a local failure without using HOME packages', t => {
  const f = fixture(t, { 'entry.mjs': "import {createRequire}from'node:module';export default createRequire(import.meta.url)('dep');",
    'node_modules/dep/package.json': '{"name":"dep","main":"./index.cjs"}', 'node_modules/dep/index.cjs': "module.exports='internal';" });
  const home = join(f.directory, 'home'); f.decoy(join(home, '.node_modules'), 'commonjs');
  const result = f.run('remove', { HOME: home }); assert.equal(result.status, 1);
  assert.match(result.json.error, /image_external_module|image_dependency_missing/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('U12 should refuse createRequire pointed at an external base by image code', t => {
  const f = fixture(t, { 'entry.mjs': "import{createRequire}from'node:module';export default createRequire(process.env.IMAGE_REQUIRE_BASE)('dep');" });
  f.decoy(join(f.directory, 'node_modules'), 'commonjs');
  const result = f.run('none', { IMAGE_REQUIRE_BASE: join(f.directory, 'external-base.cjs') });
  assert.equal(result.status, 1); assert.match(result.json.error, /image_external_module/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('U10 should refuse selection before journaling when the runtime has no qualified image reader', t => {
  assert.equal(typeof installImagePolicy, 'function');
  const f = installationFixture(); t.after(() => f.close());
  const target = f.image(), store = new UpgradeStore(f.layout), original = Module.registerHooks;
  try {
    Module.registerHooks = undefined;
    assert.throws(() => store.begin({ upgradeId: 'unsupported', target }), /image_loader_unqualified/);
    assert.equal(fs.existsSync(join(f.state, 'upgrade/transactions/unsupported.json')), false);
  } finally { Module.registerHooks = original; }
});

test('U12 should reject late module mode changes even when the bytes are unchanged', t => {
  const f = fixture(t, { 'entry.mjs': "export default import('./late.mjs').then(m=>m.default);", 'late.mjs': 'export default 42;' });
  const result = f.run('mode'); assert.equal(result.status, 1); assert.match(result.json.error, /image_module_integrity/);
});

test('U12 should reject altered package metadata before executing an otherwise unchanged module', t => {
  const f = fixture(t, { 'entry.mjs': 'export default 42;' });
  const result = f.run('metadata'); assert.equal(result.status, 1); assert.match(result.json.error, /image_module_integrity/);
});

test('U12 should refuse code added inside the image after its manifest was verified', t => {
  const f = fixture(t, { 'entry.mjs': "export default import('./unrecorded.mjs').then(m=>m.default);" });
  const result = f.run('unrecorded'); assert.equal(result.status, 1); assert.match(result.json.error, /image_module_missing/);
});

test('U10 should load the real node-pty probe and its ABI-qualified addon through the image reader', async t => {
  const f = fixture(t, { 'entry.mjs': `import{createRequire}from'node:module';
const pty=createRequire(import.meta.url)('./node_modules/node-pty');
export default await new Promise((resolve,reject)=>{
let output='',terminal;const timeout=setTimeout(()=>{terminal?.kill();reject(Error('fixture_pty_timeout'));},3000);
try{terminal=pty.spawn(process.execPath,['-e',"process.stdout.write('PTY-'+process.pid)"],{cols:80,rows:24,cwd:process.env.HOME,env:process.env});
terminal.onData(bytes=>{output+=bytes;});terminal.onExit(event=>{clearTimeout(timeout);resolve({output,exitCode:event.exitCode});});}
catch(error){clearTimeout(timeout);reject(error);}});` });
  // Functional loader fixture only. E2 still owns the pinned release toolchain.
  const native = await buildNativePrototype(f.root); f.native(native);
  const result = f.run(); assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.equal(result.json.value.exitCode, 0); assert.match(result.json.value.output, /^PTY-[0-9]+$/);
  const changed = f.run('binary-alter'); assert.equal(changed.status, 1);
  assert.equal(changed.json.error, 'Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-' +
    process.arch + ': Error: image_dependency_missing');
  assert.equal(changed.json.value, undefined);
});
