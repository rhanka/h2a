// Audit the reserve closure separately from the historical MH-L5 qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const copy = fs.realpathSync(process.argv[2]);
if (!copy.startsWith('/tmp/mh-l3-qualification-') || !copy.endsWith('/source')) throw new Error('private_copy_required');
const base = '4a4ca76c88aa47f49a780f63242680dbbc499d48';
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const changed = new Set([
  ...execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).trim().split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n')
]);
const files = [...changed].filter(path => /^(packages\/h2a\/(src|test)\/|scripts\/)/.test(path)).sort().map(path => {
  assert.equal(hash(path), hash(join(copy, path)), `qualification_source_mismatch:${path}`);
  return { path, sha256: hash(path) };
});
const compiled = files.filter(file => file.path.startsWith('packages/h2a/src/')).map(file => {
  const path = file.path.replace('/src/', '/dist/');
  return { path, sha256: hash(join(copy, path)), sourceSha256: file.sha256 };
});
const receipt = (log, code) => {
  const text = fs.readFileSync(log, 'utf8'), value = JSON.parse(text.split('\nreceipt: ').at(-1));
  assert.equal(value.code, code, log); assert.equal(value.signal, null, log);
  assert.equal(value.invalid, false, log); assert.ok(value.tests > 0, log);
  assert.deepEqual(value.leftovers, [], log);
  assert.ok(!/# (skipped|cancelled|todo) [1-9]/.test(text), log);
  if (code === 1) assert.ok(text.includes('ERR_ASSERTION'), log);
  return { ...value, log, sha256: hash(log) };
};
const names = [...fs.readFileSync('scripts/mh-l5-argon-check.mjs', 'utf8')
  .match(/const names = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => `packages/h2a/test/${match[1]}.test.js`).sort();
const planned = [...fs.readFileSync('scripts/mh-l5-mutate.mjs', 'utf8')
  .matchAll(/^  \['(argon|oracles)', '([^']+)'/gm)].map(match => ({ group: match[1], name: match[2] }));
const profiles = [];
for (const major of [22, 24]) {
  const checks = JSON.parse(fs.readFileSync(`docs/plan/mh-l5/argon-check-node${major}.json`));
  assert.deepEqual(checks.results.map(result => result.file).sort(), names);
  const tests = checks.results.map(result => {
    assert.equal(result.runnerExit, 0, result.file);
    return receipt(result.log, 0);
  });
  const mutations = [];
  for (const group of ['argon', 'oracles']) {
    const proof = JSON.parse(fs.readFileSync(`docs/plan/mh-l5/mutations-${group}-node${major}.json`));
    assert.deepEqual(proof.results.map(result => result.name).sort(), planned.filter(row => row.group === group).map(row => row.name).sort());
    for (const result of proof.results) {
      const red = receipt(result.red, 1), green = receipt(result.green, 0);
      assert.equal(result.restored, true);
      for (const file of result.files) assert.equal(hash(join(copy, file.path)), file.sha256, `mutation_restore:${result.name}:${file.path}`);
      mutations.push({ name: result.name, red, green });
    }
  }
  profiles.push({ node: checks.node, explicitFiles: tests.length, tests: tests.reduce((sum, row) => sum + row.tests, 0),
    mutationPairs: mutations.length, skipped: 0, cancelled: 0, remainingOwnChildren: 0, receipts: tests, mutations });
}
const baseline = ['mh-l5-shim-recovery', 'mh-l5-concurrency-oracles'].map(name => ({
  red: receipt(`docs/plan/mh-l5/evidence/${name}.test.js-node22-argon-before.log`, 1),
  green: receipt(`docs/plan/mh-l5/evidence/${name}.test.js-node22-argon-after.log`, 0)
}));
const buildLog = 'docs/plan/mh-l5/evidence/argon-typecheck.log';
assert.match(fs.readFileSync(buildLog, 'utf8'), /exit=0\s*$/);
const audit = { base, qualificationCopy: copy, files, compiled, profiles, baseline,
  typecheck: { log: buildLog, sha256: hash(buildLog) },
  M17: { qualified: false, coverage: 'backend-only', deferredGate: 'docs/plan/mh-l8/BRANCH.md', longBackendCampaignRerun: false },
  M18: { productH4ProducerDelivered: false, trackedIn: 'docs/plan/mh-l6/BRANCH.md' },
  diagnostics: ['parallel Node 22/24 attachments attempts: EADDRINUSE on the fixed fixture port; sequential reruns retained separately',
    'source and TypeScript emission have different formatting and separate hashes; only source/copy hashes are compared for equality'],
  independentReReview: 'conductor; not claimed by builder' };
fs.writeFileSync('docs/plan/mh-l5/argon-proof-audit.json', JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ files: files.length, compiled: compiled.length, profiles: profiles.map(({ node, explicitFiles, tests, mutationPairs, skipped, cancelled, remainingOwnChildren }) =>
  ({ node, explicitFiles, tests, mutationPairs, skipped, cancelled, remainingOwnChildren })), M17: audit.M17, M18: audit.M18 }, null, 2));
