import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const worktree = resolve(new URL('../', import.meta.url).pathname), source = fs.realpathSync(process.argv[2]);
if (!source.startsWith('/tmp/mh-l3-qualification-')) throw Error('private_qualification_copy_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Error(message); };
const files = ['packages/h2a/src/runtime/upgrade/physical-installation.js', 'packages/h2a/test/mh-l6-physical.test.js',
  'packages/h2a/test/mh-l0-authority.test.js', 'packages/h2a/test/helpers/mh-l0-proc-frame.js',
  'packages/h2a/src/runtime/handover/authority.js', 'scripts/mh-l6-physical-mutate.mjs', 'scripts/mh-l6-test.mjs',
  'scripts/mh-l6-c2a-audit.mjs', 'package-lock.json'].map(path => {
    const bytes = fs.readFileSync(join(worktree, path));
    if (!bytes.equals(fs.readFileSync(join(source, path)))) fail('copy_mismatch:' + path);
    return { path, sha256: hash(bytes) };
  });
const directory = 'docs/plan/mh-l6/', evidence = directory + 'evidence/';
const log = (path, code, tests) => {
  const bytes = fs.readFileSync(join(source, path)), text = bytes.toString();
  const receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
  if (receipt.code !== code || receipt.tests !== tests || receipt.invalid || receipt.signal || receipt.leftovers.length ||
    !receipt.command.includes('--test') || /# (?:skipped|cancelled|todo) [1-9]/.test(text)) fail('invalid_receipt:' + path);
  return { path, sha256: hash(bytes), ...receipt };
};
const profiles = [22, 24].map(major => {
  const initial = log(evidence + `mh-l6-physical.test.js-node${major}-physical-initial-red.log`, 1, 1);
  const tests = [log(evidence + `mh-l6-physical.test.js-node${major}-final-C2a.log`, 0, 20),
    log(evidence + `mh-l0-authority.test.js-node${major}-final-C2a-git-object.log`, 0, 2)];
  const path = directory + `mutations-physical-node${major}.json`, mutations = JSON.parse(fs.readFileSync(join(source, path)));
  if (mutations.results.length !== 13 || !mutations.node.startsWith(`v${major}.`)) fail('invalid_mutation_count');
  for (const file of mutations.files) if (hash(fs.readFileSync(join(source, file.path))) !== file.sha256) fail('restoration_failed');
  const pairs = mutations.results.map(row => {
    if (!row.restored) fail('restoration_missing');
    const red = log(row.red, 1, 1), green = log(row.green, 0, 1);
    if (!fs.readFileSync(join(source, row.red), 'utf8').includes('ERR_ASSERTION')) fail('nonassertion_red');
    return { name: row.name, red, green };
  });
  return { node: mutations.node, initialFeatureAbsence: initial, tests, pairs };
});
const build = JSON.parse(fs.readFileSync(join(source, evidence + 'build-C2a.log')));
if (build.code !== 0 || build.signal || build.stdout || build.stderr) fail('build_not_clean');
const proof = { baseCommit: 'ea81a335eaca324ae7988bf5dee2a1bd702a642f', source, files,
  compiled: { path: 'packages/h2a/dist/runtime/upgrade/physical-installation.js',
    sha256: hash(fs.readFileSync(join(source, 'packages/h2a/dist/runtime/upgrade/physical-installation.js'))) },
  build, profiles, coverage: 'read-only physical npm evidence; source tests and compiled emission',
  closureProducer: false, bootstrapActivation: false, releaseQualified: false };
fs.writeFileSync(join(worktree, directory + 'proof-C2a.json'), JSON.stringify(proof, null, 2) + '\n');
console.log('C2a: 9 identical files; build exit 0; 22 targeted tests + 13 killed/restored fault configurations per Node 22/24; zero skips/leftovers; bootstrap/closure/release remain unqualified');
