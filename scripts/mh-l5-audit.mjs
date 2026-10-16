// Audit exact source bytes, restored mutant bytes and every targeted receipt.
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const copy = process.argv[2];
if (!copy?.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_copy_required');
const base = '7a8129ea4120e6202e5f825ebbc5101289090daf';
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const changed = [...new Set([...execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).trim().split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n')])];
const paths = changed.filter(p => p.startsWith('packages/h2a/src/') || p.startsWith('packages/h2a/test/') || p.startsWith('scripts/')).sort();
const files = paths.map(path => {
  if (hash(path) !== hash(join(copy, path))) throw new Error('qualification_byte_mismatch:' + path);
  return { path, sha256: hash(path) };
});
const compiled = files.filter(f => f.path.startsWith('packages/h2a/src/')).map(f => {
  const path = f.path.replace('/src/', '/dist/').replace(/\.ts$/, '.js'); return { path, sha256: hash(join(copy, path)) };
});
const receipt = log => {
  const text = fs.readFileSync(log, 'utf8'), value = JSON.parse(text.split('\nreceipt: ').at(-1));
  if (value.invalid || value.signal || !value.tests || value.leftovers.length || /# (skipped|cancelled|todo) [1-9]/.test(text)) throw new Error('invalid_receipt:' + log);
  return { text, value };
};
const planned = [...fs.readFileSync('scripts/mh-l5-mutate.mjs', 'utf8').matchAll(/^  \['(transport|cold|oracles)', '([^']+)'/gm)].map(m => ({ group: m[1], name: m[2] }));
const profiles = [];
for (const major of [22, 24]) {
  const regressions = JSON.parse(fs.readFileSync(`docs/plan/mh-l5/regressions-node${major}.json`));
  if (regressions.results.length !== 30 || new Set(regressions.results.map(r => r.file)).size !== 30) throw new Error('targeted_reference_gap');
  let tests = 0;
  for (const result of regressions.results) { const r = receipt(result.log).value; if (r.code !== 0) throw new Error('regression_not_green'); tests += r.tests; }
  const loadLog = `docs/plan/mh-l5/evidence/mh-l5-concurrency.test.js-node${major}-qualified.log`;
  const load = receipt(loadLog); if (load.value.code !== 0 || load.value.tests !== 1) throw new Error('load_not_green');
  const counts = JSON.parse(load.text.split('\n').find(line => line.startsWith('# {"domains"')).slice(2));
  if (Object.keys(counts.domains).length !== 7 || Object.values(counts.domains).some(n => n < 10000) || counts.duplicates !== 0 || counts.acknowledged !== 10000) throw new Error('normative_load_gap');
  const mutations = [];
  for (const group of ['transport', 'cold', 'oracles']) {
    const proof = JSON.parse(fs.readFileSync(`docs/plan/mh-l5/mutations-${group}-node${major}.json`));
    const expected = planned.filter(p => p.group === group);
    if (proof.results.length !== expected.length || expected.some(p => !proof.results.some(r => r.name === p.name))) throw new Error('mutation_coverage_gap');
    for (const r of proof.results) {
      const red = receipt(r.red), green = receipt(r.green);
      if (red.value.code !== 1 || !red.text.includes('ERR_ASSERTION') || green.value.code !== 0 || !r.restored) throw new Error('mutation_not_proved');
      for (const f of r.files) if (hash(join(copy, f.path)) !== f.sha256) throw new Error('mutation_byte_mismatch:' + r.name + ':' + f.path);
      mutations.push(r.name);
    }
  }
  profiles.push({ node: regressions.node, explicitFiles: 31, tests: tests + 1, mutationPairs: mutations.length,
    mutations, domains: counts.domains, skipped: 0, cancelled: 0, remainingOwnChildren: 0 });
}
const audit = { base, qualificationCopy: copy, files, compiled, profiles,
  limitations: ['prototype .7 image; final release artifacts belong to MH-L8', 'synthetic backend writers for the 80,000-mutation campaign',
    'fixture H4 controller/closure proof; product H4 belongs to MH-L6', 'process-crash cuts, not power-loss certification',
    'no real Claude, semantic verifier, registry discovery, product live coordinator or real .7-to-.8 qualification'] };
fs.writeFileSync('docs/plan/mh-l5/proof-audit.json', JSON.stringify(audit, null, 2) + '\n');
process.stdout.write(JSON.stringify(profiles, null, 2) + '\n');
