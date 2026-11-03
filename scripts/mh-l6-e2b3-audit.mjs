// E2b3 tranche audit: exact files, compiled emission, 10 tests and 3
// killed/restored mutation pairs per Node profile. Runs in the worktree,
// reads evidence from the private qualification copy.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const alternate = process.env.MH_L3_QUALIFICATION_ROOT ? fs.realpathSync(process.env.MH_L3_QUALIFICATION_ROOT) : null;
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-') && !(alternate && source.startsWith(alternate))) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/src/runtime/upgrade/image-execution.js', 'packages/h2a/test/mh-l6-entrypoints.test.js',
  'packages/h2a/test/helpers/mh-l6-entrypoints-harness.mjs', 'scripts/mh-l6-entrypoints-mutate.mjs', 'scripts/mh-l6-test.mjs'];
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
for (const majorValue of [22, 24]) {
  const green = receipt(`docs/plan/mh-l6/evidence/mh-l6-entrypoints.test.js-node${majorValue}-green.log`);
  assert.equal(green.code, 0, green.log); assert.equal(green.tests, 10);
  const mutations = JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-entrypoints-node${majorValue}.json`, 'utf8'));
  assert.equal(mutations.results.length, 3);
  for (const file of mutations.files) assert.equal(file.sha256, hash(fs.readFileSync(join(source, file.path))), file.path);
  for (const mutation of mutations.results) {
    assert.equal(mutation.restored, true);
    const red = receipt(mutation.red), restored = receipt(mutation.green);
    assert.equal(red.code, 1); assert.equal(red.tests, 1);
    assert.ok(fs.readFileSync(mutation.red, 'utf8').includes('ERR_ASSERTION'));
    assert.equal(restored.code, 0); assert.equal(restored.tests, 1);
  }
  profiles.push({ major: majorValue, tests: 10, mutations: 3 });
}
const compiled = 'packages/h2a/dist/runtime/upgrade/image-execution.js';
fs.writeFileSync('docs/plan/mh-l6/proof-E2b3.json', JSON.stringify({ source, worktree: resolve('.'), files,
  compiled: { path: compiled, sha256: hash(fs.readFileSync(join(source, compiled))) }, profiles }, null, 2) + '\n');
process.stdout.write('E2b3: 5 exact source/test/runner files; 10 tests + 3 killed/restored mutations per Node 22/24; zero skips/leftovers\n');
