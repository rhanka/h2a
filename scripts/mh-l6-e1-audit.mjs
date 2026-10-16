import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildManagedLauncher } from './build-managed-launcher.mjs';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/src/runtime/upgrade/image-policy.js', 'packages/h2a/src/runtime/upgrade/h4-store.js',
  'packages/h2a/src/runtime/upgrade/managed-launcher.js', 'packages/h2a/test/mh-l6-image-policy.test.js',
  'packages/h2a/test/mh-l6-launcher.test.js', 'packages/h2a/test/mh-l6-selection.test.js', 'packages/h2a/test/mh-l6-delegation.test.js',
  ...['mh-l6-image-reader.mjs', 'mh-l6-installation.js', 'mh-l6-controller.mjs'].map(name => `packages/h2a/test/helpers/${name}`),
  ...['mh-l6-test.mjs', 'mh-l6-image-mutate.mjs', 'build-managed-launcher.mjs', 'mh-l0-native-prototype.mjs'].map(name => `scripts/${name}`),
  'package-lock.json', ...['authority', 'state', 'selection', 'image', 'formats', 'wire', 'schemas'].map(name => `packages/h2a/src/runtime/handover/${name}.js`)];
const files = paths.map(path => {
  const sha256 = hash(fs.readFileSync(path)); assert.equal(hash(fs.readFileSync(join(source, path))), sha256, path);
  return { path, sha256 };
});
const receipt = log => {
  const output = fs.readFileSync(log, 'utf8'), r = JSON.parse(output.split('\nreceipt: ').at(-1));
  assert.equal(r.invalid, false, log); assert.equal(r.signal, null, log); assert.equal(r.leftovers.length, 0, log);
  return { log, sha256: hash(output), ...r };
};
const profiles = [];
for (const major of [22, 24]) {
  const logs = ['image-policy', 'launcher', 'selection', 'delegation'].map(name =>
    receipt(`docs/plan/mh-l6/evidence/mh-l6-${name}.test.js-node${major}-final-E1.log`));
  for (const r of logs) assert.equal(r.code, 0, r.log);
  assert.equal(logs.reduce((n, r) => n + r.tests, 0), 47);
  const mutations = JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-image-node${major}.json`, 'utf8'));
  assert.equal(mutations.results.length, 11);
  for (const file of mutations.files) assert.equal(file.sha256, hash(fs.readFileSync(join(source, file.path))), file.path);
  for (const m of mutations.results) {
    assert.equal(m.restored, true);
    const red = receipt(m.red), green = receipt(m.green), output = fs.readFileSync(m.red, 'utf8');
    assert.equal(red.code, 1); assert.equal(red.tests, 1); assert.ok(output.includes('ERR_ASSERTION'));
    assert.ok(output.includes(m.name === 'preselection-runtime' ? 'Missing expected exception' : '0 !== 1'), m.name);
    assert.equal(green.code, 0); assert.equal(green.tests, 1);
  }
  profiles.push({ major, tests: 47, mutationPairs: 11, logs });
}
let bundle;
try {
  bundle = await buildManagedLauncher();
  const other = await import(pathToFileURL(join(source, 'scripts/build-managed-launcher.mjs')).href);
  assert.equal((await other.buildManagedLauncher()).digest, bundle.digest);
  assert.ok(bundle.imports.every(path => path.startsWith('node:')));
} finally {
  createRequire(import.meta.url)('esbuild').stop(); createRequire(join(source, 'package.json'))('esbuild').stop();
}
const artifact = 'docs/plan/mh-l6/artifacts/h2a-launcher-E1.mjs'; fs.writeFileSync(artifact, bundle.code);
fs.writeFileSync('docs/plan/mh-l6/artifacts/launcher-E1-manifest.json', JSON.stringify({ schemaVersion: 1, artifact,
  digest: bundle.digest, imports: bundle.imports, sourceFiles: files, standalone: true, releaseQualified: false,
  imagePolicyCoverage: 'selected-entry-process-only' }, null, 2) + '\n');
const compiled = ['image-policy', 'managed-launcher', 'h4-store'].map(name => {
  const path = `packages/h2a/dist/runtime/upgrade/${name}.js`; return { path, sha256: hash(fs.readFileSync(join(source, path))) };
});
fs.writeFileSync('docs/plan/mh-l6/proof-E1.json', JSON.stringify({ source, files, compiled, profiles, artifact, digest: bundle.digest }, null, 2) + '\n');
process.stdout.write(`E1: ${files.length} files, 3 compiled; 47 tests + 11 killed/restored pairs per Node 22/24; ${bundle.digest}; zero skips/leftovers\n`);
