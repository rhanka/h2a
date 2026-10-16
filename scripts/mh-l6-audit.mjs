import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_source_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['packages/h2a/src/runtime/upgrade/h4-store.js', 'packages/h2a/test/mh-l6-selection.test.js',
  'packages/h2a/test/helpers/mh-l6-installation.js', 'scripts/mh-l6-test.mjs', 'scripts/mh-l6-mutate.mjs'];
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
  const logs = [['mh-l6-selection', 'final-A'], ['mh-l0-state', 'selection-regression'],
    ['mh-l0-image', 'selection-regression'], ['mh-l0-authority', 'selection-git-fixture'], ['mh-l0-formats', 'selection-git-fixture']]
    .map(([stem, label]) => receipt(`docs/plan/mh-l6/evidence/${stem}.test.js-node${major}-${label}.log`));
  for (const r of logs) assert.equal(r.code, 0, r.log);
  assert.equal(logs.reduce((n, r) => n + r.tests, 0), 25);
  const mutations = JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-selection-node${major}.json`, 'utf8'));
  assert.equal(mutations.results.length, 14);
  for (const file of mutations.files) assert.equal(file.sha256, hash(fs.readFileSync(join(source, file.path))), file.path);
  for (const mutation of mutations.results) {
    assert.equal(mutation.restored, true);
    const red = receipt(mutation.red), green = receipt(mutation.green);
    assert.equal(red.code, 1); assert.equal(red.tests, 1);
    assert.ok(fs.readFileSync(mutation.red, 'utf8').includes('ERR_ASSERTION'));
    assert.equal(green.code, 0); assert.equal(green.tests, 1);
  }
  profiles.push({ major, tests: 25, mutations: 14, logs });
}
const diagnostics = fs.readdirSync('docs/plan/mh-l6/evidence').filter(p => p.endsWith('.log')).flatMap(name => {
  const path = `docs/plan/mh-l6/evidence/${name}`;
  const text = fs.readFileSync(path, 'utf8');
  if (!text.includes('\nreceipt: ')) return [];
  const r = JSON.parse(text.split('\nreceipt: ').at(-1));
  return r.code && !name.includes('-mutation-') ? [{ path, code: r.code, tests: r.tests, sha256: hash(text) }] : [];
});
const compiled = 'packages/h2a/dist/runtime/upgrade/h4-store.js';
fs.writeFileSync('docs/plan/mh-l6/proof-A.json', JSON.stringify({ source, worktree: resolve('.'), files,
  compiled: { path: compiled, sha256: hash(fs.readFileSync(join(source, compiled))) }, profiles, diagnostics }, null, 2) + '\n');
process.stdout.write('A: 5 exact source/test/runner files; 25 tests + 14 killed/restored mutations per Node 22/24; zero skips/leftovers\n');
