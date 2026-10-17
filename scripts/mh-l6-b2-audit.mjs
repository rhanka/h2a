import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/test/mh-l6-exclusion.test.js', 'packages/h2a/src/runtime/upgrade/legacy-exclusion.js', 'scripts/mh-l6-mutate.mjs', 'scripts/mh-l6-test.mjs'];
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
const profiles = [];
for (const major of [22, 24]) {
  const green = receipt(`docs/plan/mh-l6/evidence/mh-l6-exclusion.test.js-node${major}-final-B2-1.log`);
  assert.equal(green.code, 0, green.log);
  assert.equal(green.tests, 8);
  const mutations = JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-exclusion-node${major}.json`, 'utf8'));
  assert.equal(mutations.results.length, 8);
  for (const file of mutations.files) assert.equal(file.sha256, hash(fs.readFileSync(join(source, file.path))), file.path);
  for (const mutation of mutations.results) {
    assert.equal(mutation.restored, true);
    const red = receipt(mutation.red), restored = receipt(mutation.green);
    assert.equal(red.code, 1); assert.equal(red.tests, 1);
    assert.ok(fs.readFileSync(mutation.red, 'utf8').includes('ERR_ASSERTION'));
    assert.equal(restored.code, 0); assert.equal(restored.tests, 1);
  }
  profiles.push({ major, tests: 8, mutations: 8 });
}
const compiled = 'packages/h2a/dist/runtime/upgrade/legacy-exclusion.js';
fs.writeFileSync('docs/plan/mh-l6/proof-B2-1.json', JSON.stringify({ source, worktree: resolve('.'), files,
  compiled: { path: compiled, sha256: hash(fs.readFileSync(join(source, compiled))) }, profiles }, null, 2) + '\n');
process.stdout.write('B2-1: 4 exact source/test/runner files; 8 tests + 8 killed/restored mutations per Node 22/24; zero skips/leftovers\n');
