import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createManifest } from '../src/runtime/handover/image.js';
import { verifyPublishablePayload } from '../../../scripts/check-publish-payload.mjs';
const test = (name, body) => { if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body); };
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-publish-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = { name: '@sentropic/h2a', version: '0.98.7', dependencies: { '@sentropic/h2a-runtime': '0.98.7', fixture: '1.2.3' }, bundleDependencies: ['@sentropic/h2a-runtime', 'fixture'] };
  const runtime = { name: '@sentropic/h2a-runtime', version: '0.98.7', dependencies: { '@sentropic/h2a': '0.98.7' } };
  const dep = { name: 'fixture', version: '1.2.3', dependencies: {} };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { ...pkg },
    'node_modules/@sentropic/h2a-runtime': { ...runtime }, 'node_modules/fixture': { ...dep } } };
  const write = (path, value) => { fs.mkdirSync(join(root, path, '..'), { recursive: true }); fs.writeFileSync(join(root, path), JSON.stringify(value)); };
  const seal = () => {
    write('package.json', pkg); write('node_modules/@sentropic/h2a-runtime/package.json', runtime); write('node_modules/fixture/package.json', dep); write('npm-shrinkwrap.json', lock);
    fs.writeFileSync(join(root, 'entry.mjs'), 'export default 42;');
    const base = createManifest(root, { packageVersion: pkg.version, buildId: 'publish-fixture',
      profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: 22, nodeAbi: '127' }, entrypoints: { main: 'entry.mjs' }, startupWaitBudgetMs: 10000, maxAttachments: 64, nativeArtifacts: [] });
    write('manifest.json', { schemaVersion: 1, kind: 'h2a-published-payload', manifests: { '22': base, '24': { ...base, profile: { ...base.profile, nodeMajor: 24, nodeAbi: '137' } } } });
  };
  seal(); return { root, pkg, runtime, dep, lock, seal };
}
test('U10 should accept an independently verified exact bundled dependency cycle', t => {
  const f = fixture(t); f.runtime.dependencies.fixture = '1.2.3'; f.seal();
  let observed; assert.doesNotThrow(() => { observed = verifyPublishablePayload(f.root); });
  assert.equal(observed.packageName, '@sentropic/h2a');
});
test('U10 should refuse raw workspace publication before npm can construct a tarball', () => {
  for (const directory of ['packages/h2a', 'packages/h2a-runtime']) {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: directory, env: { ...process.env, npm_config_offline: 'true' }, encoding: 'utf8', timeout: 30000 });
    // Exercise both npm's real lifecycle and the gate's workspace diagnostic.
    const actual = spawnSync(process.execPath, [new URL('../../../scripts/check-publish-payload.mjs', import.meta.url).pathname], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, 'raw workspace npm pack must be blocked by its real prepack lifecycle'); assert.equal(actual.status, 1); assert.match(actual.stderr, /Publish requires the closed payload tarball/);
  }
});
test('U10 should reject a shrinkwrap dependency that is present but resolves to another version', t => {
  const f = fixture(t); f.runtime.dependencies.fixture = '1.2.2'; f.lock.packages['node_modules/@sentropic/h2a-runtime'].dependencies = { ...f.runtime.dependencies }; f.seal();
  assert.throws(() => verifyPublishablePayload(f.root), /release_dependency_not_exact:fixture/);
});
test('U10 should reject a loose dependency range even when npm could satisfy it locally', t => {
  const f = fixture(t); f.pkg.dependencies.fixture = '^1.2.3'; f.seal();
  assert.throws(() => verifyPublishablePayload(f.root), /release_dependency_not_exact:fixture/);
});
test('U10 should reject executable installation scripts in a hashed bundled package', t => {
  const f = fixture(t); f.dep.scripts = { install: 'node forbidden.cjs' }; f.seal();
  assert.throws(() => verifyPublishablePayload(f.root), /release_dependency_metadata_invalid/);
});
test('U10 should reject missing bundled choices and shrinkwrap metadata drift', t => {
  const f = fixture(t); f.pkg.bundleDependencies.pop(); f.seal(); assert.throws(() => verifyPublishablePayload(f.root), /release_bundle_incomplete/);
  f.pkg.bundleDependencies.push('fixture'); f.lock.packages['node_modules/fixture'].version = '1.2.4'; f.seal(); assert.throws(() => verifyPublishablePayload(f.root), /release_dependency_not_exact|release_dependency_metadata_invalid/);
});
test('U10 should reject shrinkwrap traversal and an unrecorded dependency package', t => {
  const f = fixture(t); f.lock.packages['node_modules/../escape'] = {}; f.seal(); assert.throws(() => verifyPublishablePayload(f.root), /release_shrinkwrap_path_invalid/);
  delete f.lock.packages['node_modules/../escape']; f.lock.packages['node_modules/missing'] = { name: 'missing', version: '1.0.0' }; f.seal(); assert.throws(() => verifyPublishablePayload(f.root), /release_dependency_unrecorded/);
});
test('U10 should reject a sibling runtime whose exact version differs from the core', t => {
  const f = fixture(t); f.pkg.dependencies['@sentropic/h2a-runtime'] = '0.98.6'; f.runtime.version = '0.98.6'; f.lock.packages['node_modules/@sentropic/h2a-runtime'].version = '0.98.6'; f.seal();
  assert.throws(() => verifyPublishablePayload(f.root), /release_runtime_not_lockstep/);
});
