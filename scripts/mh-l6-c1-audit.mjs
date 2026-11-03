import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { buildManagedLauncher } from './build-managed-launcher.mjs';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['packages/h2a/src/runtime/upgrade/managed-launcher.js', 'scripts/build-managed-launcher.mjs',
  'packages/h2a/test/mh-l6-launcher.test.js', 'scripts/mh-l6-test.mjs', 'scripts/mh-l6-mutate.mjs',
  ...['authority', 'state', 'selection', 'image', 'formats', 'wire', 'schemas'].map(name => `packages/h2a/src/runtime/handover/${name}.js`)]
  .map(path => {
    const sha256 = hash(fs.readFileSync(path)); assert.equal(hash(fs.readFileSync(join(source, path))), sha256, path);
    return { path, sha256 };
  });
const receipt = log => {
  const output = fs.readFileSync(log, 'utf8'), r = JSON.parse(output.split('\nreceipt: ').at(-1));
  assert.equal(r.invalid, false); assert.equal(r.signal, null); assert.equal(r.leftovers.length, 0);
  return { log, sha256: hash(output), ...r };
};
const profiles = [];
for (const major of [22, 24]) {
  const full = receipt(`docs/plan/mh-l6/evidence/mh-l6-launcher.test.js-node${major}-final-C1.log`);
  assert.equal(full.code, 0); assert.equal(full.tests, 10);
  const mutations = JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-launcher-node${major}.json`, 'utf8'));
  assert.equal(mutations.results.length, 13);
  for (const file of mutations.files) assert.equal(file.sha256, hash(fs.readFileSync(file.path)));
  for (const m of mutations.results) {
    assert.equal(m.restored, true);
    const red = receipt(m.red), green = receipt(m.green);
    assert.equal(red.code, 1); assert.equal(red.tests, 1);
    assert.ok(fs.readFileSync(m.red, 'utf8').includes('ERR_ASSERTION'));
    assert.equal(green.code, 0); assert.equal(green.tests, 1);
  }
  profiles.push({ major, tests: 10, mutations: 13, full });
}
let bundle;
try {
  bundle = await buildManagedLauncher();
  const other = await import(pathToFileURL(join(source, 'scripts/build-managed-launcher.mjs')).href);
  assert.equal((await other.buildManagedLauncher()).digest, bundle.digest);
  assert.equal(bundle.imports.every(path => path.startsWith('node:')), true);
} finally {
  createRequire(import.meta.url)('esbuild').stop();
  createRequire(join(source, 'package.json'))('esbuild').stop();
}
const artifact = 'docs/plan/mh-l6/artifacts/h2a-launcher.mjs';
fs.mkdirSync('docs/plan/mh-l6/artifacts', { recursive: true }); fs.writeFileSync(artifact, bundle.code);
const manifest = { schemaVersion: 1, artifact, digest: bundle.digest, imports: bundle.imports,
  standalone: true, releaseQualified: false, sourceFiles: files };
fs.writeFileSync('docs/plan/mh-l6/artifacts/launcher-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync('docs/plan/mh-l6/proof-C1.json', JSON.stringify({ source, files, profiles, artifact, digest: bundle.digest }, null, 2) + '\n');
process.stdout.write(`C1: ${files.length} files; 10 tests + 13 killed/restored mutations per Node 22/24; standalone ${bundle.digest}; zero skips/leftovers\n`);
