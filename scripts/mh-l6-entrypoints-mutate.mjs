// E2b3 mutants: every new guard dies by assertion on its own oracle, then
// is restored byte-identical. Runs only inside the private qualification
// copy (MH_L3_QUALIFICATION_ROOT override allowed); forwards the
// MH_L5_ARTIFACTS roots for the published-legacy oracle.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const qualAlternate = process.env.MH_L3_QUALIFICATION_ROOT ? fs.realpathSync(process.env.MH_L3_QUALIFICATION_ROOT) : null;
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-') && !(qualAlternate && fs.realpathSync('.').startsWith(qualAlternate))) throw Error('private_qualification_copy_required');
const base = 'packages/h2a/', policy = base + 'src/runtime/upgrade/image-execution.js';
const file = base + 'test/mh-l6-entrypoints.test.js';
const cases = [
  ['exec-wrap', policy, "for (const key of ['exec', 'execSync']) {", 'for (const key of []) {',
    'E2b3 should refuse an image entry through sync shell exec'],
  ['shell-scan', policy, 'return command.includes(join(managedRoot, \'images\') + sep);', 'return false;',
    'E2b3 should refuse an image entry through async shell exec'],
  ['bare-guard', policy, "if (shellReferencesImage(command, bareCwd(options))) throw new Error('image_child_entry_unqualified');", '',
    'E2b3 should refuse a bare image entry through spawn'],
];
const compiled = path => path.replace('/src/', '/dist/');
const paths = [policy, compiled(policy)].flatMap(p => [p]);
const originals = paths.map(path => ({ path, bytes: fs.readFileSync(path) }));
const hash = b => createHash('sha256').update(b).digest('hex');
const major = process.versions.node.split('.')[0], results = [];
const forward = {};
for (const key of ['MH_L5_ARTIFACTS', 'MH_L5_ARTIFACTS_ROOT']) if (process.env[key]) forward[key] = process.env[key];
for (const [name, path, from, to, scenario] of cases) {
  const run = color => {
    const label = `entrypoints-${name}-${color}`;
    const r = spawnSync(process.execPath, ['scripts/mh-l6-test.mjs', file, label],
      { env: { ...process.env, ...forward, MH_L6_CASE: scenario }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/mh-l6-entrypoints.test.js-node${major}-${label}.log`;
    const text = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
    if (r.status !== (color === 'red' ? 1 : 0) || receipt.invalid || receipt.signal || receipt.tests !== 1 ||
      (color === 'red' && !text.includes('ERR_ASSERTION'))) throw Error(`invalid_mutation:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    for (const target of [path, compiled(path)]) {
      const bytes = originals.find(o => o.path === target).bytes;
      const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
      if ([...bytes.toString().matchAll(re)].length !== 1) throw Error('mutation_not_unique:' + name + ':' + target);
      fs.writeFileSync(target, bytes.toString().replace(re, () => to));
    }
    red = run('red');
  } finally { for (const o of originals) fs.writeFileSync(o.path, o.bytes); }
  const green = run('green');
  for (const o of originals) if (hash(fs.readFileSync(o.path)) !== hash(o.bytes)) throw Error('restore_failed');
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-entrypoints-node${major}.json`, JSON.stringify({ node: process.version,
    files: originals.map(o => ({ path: o.path, sha256: hash(o.bytes) })), results }, null, 2) + '\n');
  process.stdout.write(name + ': killed by assertion and restored\n');
}
