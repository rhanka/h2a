import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/test/mh-l6-dist-freeze.test.js', 'scripts/mh-l6-mutate.mjs',
  'scripts/mh-l6-test.mjs', 'scripts/mh-l6-e3c-freeze.mjs', 'scripts/mh-l6-legacy-fixtures.mjs',
  'docs/plan/mh-l6/legacy-integrity.json', 'docs/plan/mh-l6/dist-freeze-0986.json'];
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
const ledger = JSON.parse(fs.readFileSync('docs/plan/mh-l6/dist-freeze-0986.json', 'utf8'));
assert.equal(Object.keys(ledger.publishedRuntimeDist).length, 400);
assert.equal(Object.keys(ledger.publishedH2aUpgrade).length, 4);
assert.deepEqual(ledger.sixEntryComparison.map(row => row.outcome),
  ['identical', 'differing', 'differing', 'differing', 'differing', 'differing']);
assert.equal(ledger.sixEntryComparison[0].name, 'launch-guard.js');
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
const profiles = [];
for (const majorValue of [22, 24]) {
  const green = receipt(`docs/plan/mh-l6/evidence/mh-l6-dist-freeze.test.js-node${majorValue}-final-E3c.log`);
  assert.equal(green.code, 0, green.log); assert.equal(green.tests, 3);
  checkMutations(majorValue, 'dist-freeze', 4);
  profiles.push({ major: majorValue, tests: 3, mutations: 4 });
}
fs.writeFileSync('docs/plan/mh-l6/proof-E3c.json', JSON.stringify({ source, worktree: resolve('.'), files,
  frozen: { runtimeFiles: 400, upgradeFiles: 4, identical: ['launch-guard.js'] }, profiles }, null, 2) + '\n');
process.stdout.write('E3c: 7 exact test/runner/fixture/ledger files; 400+4 frozen published files, 3 tests + 4 killed/restored mutations per Node 22/24; zero skips/leftovers\n');
