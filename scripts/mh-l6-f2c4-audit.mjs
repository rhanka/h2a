import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/test/mh-l6-command-gate.test.js', 'packages/h2a/src/runtime/upgrade/launcher-install.js',
  'scripts/mh-l6-mutate.mjs', 'scripts/mh-l6-test.mjs'];
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
  const green = receipt(`docs/plan/mh-l6/evidence/mh-l6-command-gate.test.js-node${majorValue}-final-F-2c4.log`);
  assert.equal(green.code, 0, green.log); assert.equal(green.tests, 8);
  for (const [file, count] of [['mh-l6-launcher-install.test.js', 6], ['mh-l6-adoption.test.js', 13], ['mh-l6-npm.test.js', 8]]) {
    const requal = receipt(`docs/plan/mh-l6/evidence/${file}-node${majorValue}-requal-F-2c4.log`);
    assert.equal(requal.code, 0, requal.log); assert.equal(requal.tests, count);
  }
  const pairs = [];
  for (const [group, count] of [['command-gate', 4], ['command-force', 4]]) {
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
    pairs.push({ group, mutations: count });
  }
  profiles.push({ major: majorValue, tests: 8, requalified: [6, 13, 8], pairs });
}
const compiled = 'packages/h2a/dist/runtime/upgrade/launcher-install.js';
fs.writeFileSync('docs/plan/mh-l6/proof-F-2c4.json', JSON.stringify({ source, worktree: resolve('.'), files,
  compiled: { path: compiled, sha256: hash(fs.readFileSync(join(source, compiled))) }, profiles }, null, 2) + '\n');
process.stdout.write('F-2c4: 4 exact source/test/runner files; 8 tests + 6/13/8 requalified + 4+4 killed/restored mutations per Node 22/24; zero skips/leftovers\n');
