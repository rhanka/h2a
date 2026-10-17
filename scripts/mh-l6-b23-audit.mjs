import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/test/mh-l6-observers.test.js', 'packages/h2a/src/runtime/upgrade/legacy-observers.js',
  'packages/h2a/src/runtime/upgrade/legacy-exclusion.js', 'scripts/mh-l6-mutate.mjs', 'scripts/mh-l6-test.mjs',
  'scripts/mh-l6-legacy-fixtures.mjs', 'docs/plan/mh-l6/legacy-integrity.json'];
const files = paths.map(path => {
  const sha256 = hash(fs.readFileSync(path));
  assert.equal(hash(fs.readFileSync(join(source, path))), sha256, path);
  return { path, sha256 };
});
const receipt = log => {
  const output = fs.readFileSync(log, 'utf8');
  const result = JSON.parse(output.split('\nreceipt: ').at(-1));
  assert.equal(result.invalid, false, log); assert.equal(result.signal, null, log);
  assert.equal(result.leftovers.length, 0, log); assert.ok(result.tests > 0, log);
  return { log, sha256: hash(output), ...result };
};
const checkMutations = (majorValue, group, count) => {
  const mutations = JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-${group}-node${majorValue}.json`, 'utf8'));
  assert.equal(mutations.results.length, count);
  for (const file of mutations.files) assert.equal(file.sha256, hash(fs.readFileSync(join(source, file.path))), file.path);
  for (const mutation of mutations.results) {
    assert.equal(mutation.restored, true);
    const red = receipt(mutation.red), restored = receipt(mutation.green);
    assert.equal(red.code, 1); assert.equal(red.tests, 1);
    assert.ok(fs.readFileSync(mutation.red, 'utf8').includes('ERR_ASSERTION'));
    assert.equal(restored.code, 0); assert.equal(restored.tests, 1);
  }
};
const integrity = JSON.parse(fs.readFileSync('docs/plan/mh-l6/legacy-integrity.json', 'utf8'));
assert.equal(Object.keys(integrity.files).length, 8);
for (const [file, record] of Object.entries(integrity.files)) {
  assert.match(record.integrity, /^sha512-/);
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
}
const profiles = [];
for (const majorValue of [22, 24]) {
  const green = receipt(`docs/plan/mh-l6/evidence/mh-l6-observers.test.js-node${majorValue}-final-B2-3.log`);
  assert.equal(green.code, 0, green.log); assert.equal(green.tests, 9);
  const requal = receipt(`docs/plan/mh-l6/evidence/mh-l6-exclusion.test.js-node${majorValue}-requal-B2-3.log`);
  assert.equal(requal.code, 0, requal.log); assert.equal(requal.tests, 11);
  checkMutations(majorValue, 'observers', 7);
  profiles.push({ major: majorValue, tests: 20, mutations: 7 });
}
const compiled = ['packages/h2a/dist/runtime/upgrade/legacy-observers.js', 'packages/h2a/dist/runtime/upgrade/legacy-exclusion.js']
  .map(path => ({ path, sha256: hash(fs.readFileSync(join(source, path))) }));
fs.writeFileSync('docs/plan/mh-l6/proof-B2-3.json', JSON.stringify({ source, worktree: resolve('.'), files,
  compiled, integrity: integrity.files['sentropic-h2a-0.98.6.tgz'], profiles }, null, 2) + '\n');
process.stdout.write('B2-3: 7 exact source/test/runner/fixture files; 9 live-observer tests + 11 exclusion requal + 7 killed/restored mutations per Node 22/24; zero skips/leftovers\n');
