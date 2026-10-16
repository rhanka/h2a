import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const copy = process.argv[2];
if (!copy?.startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_copy_required');
const base = '513312b88766852572f515b3d3a7b71a0fcc2c27';
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const paths = [...new Set([...execFileSync('git', ['diff', '--name-only', base], { encoding:'utf8' }).trim().split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding:'utf8' }).trim().split('\n')])]
  .filter(p => p === 'package.json' || p === 'docs/plan/mh-l0/schemas.json' || p.startsWith('packages/h2a/src/') || p.startsWith('packages/h2a/test/') || p.startsWith('scripts/')).sort();
const files = paths.map(path => {
  const worktree = hash(path), qualification = hash(join(copy,path));
  if (worktree !== qualification) throw new Error('qualification_byte_mismatch:' + path);
  return { path, sha256: worktree };
});
const planned = [...fs.readFileSync('scripts/mh-l3-mutate.mjs','utf8').matchAll(/^\s*,?\['([^']+)',/gm)].map(m=>m[1]);
if (new Set(planned).size !== planned.length) throw new Error('duplicate_mutation');
const profiles = [];
for (const major of [22,24]) {
  const directory = join(copy,'docs/plan/mh-l3');
  const mutations = JSON.parse(fs.readFileSync(join(directory,`mutations-node${major}.json`)));
  if (mutations.results.length !== planned.length || planned.some(n=>!mutations.results.some(r=>r.name===n))) throw new Error('mutation_coverage_gap:' + major);
  for (const r of mutations.results) {
    if (!r.restored || r.sourceSha256 !== hash(r.path)) throw new Error('mutation_source_mismatch:'+r.name);
    for (const [path,code] of [[r.red,1],[r.green,0]]) {
      const output = fs.readFileSync(join(copy,path),'utf8');
      const receipt = JSON.parse(output.split('\nreceipt: ').at(-1));
      if (receipt.code !== code || receipt.invalid || receipt.signal || receipt.tests !== 1 || receipt.leftovers.length ||
          (code === 1 && !output.includes('ERR_ASSERTION'))) throw new Error('mutation_receipt_invalid:'+path);
    }
  }
  const regressions = JSON.parse(fs.readFileSync(join(directory,`regressions-node${major}.json`)));
  const formatPath = `docs/plan/mh-l3/evidence/mh-l0-formats.test.js-node${major}-qualified.log`;
  const formatOutput = fs.readFileSync(formatPath,'utf8');
  const format = JSON.parse(formatOutput.split('\nreceipt: ').at(-1));
  if (format.code !== 0 || format.invalid || format.signal || format.leftovers.length || format.tests !== 4) throw new Error('git_format_receipt_invalid');
  if (regressions.results.length !== regressions.files.length-1) throw new Error('regression_coverage_gap');
  for (const r of regressions.results) if (r.code !== 0 || r.invalid || r.signal || !r.tests || r.leftovers.length) throw new Error('regression_receipt_invalid:'+r.file);
  profiles.push({ node: regressions.node, explicitFiles: regressions.files.length,
    tests: regressions.results.reduce((a,r)=>a+r.tests,format.tests), mutationPairs: mutations.results.length,
    skipped: 0, cancelled: 0, remainingOwnChildren: 0, gitDependentLog: formatPath });
}
const compiled = files.filter(f=>f.path.startsWith('packages/h2a/src/')).map(f=>{
  const path=f.path.replace('/src/','/dist/').replace(/\.ts$/,'.js');
  if (hash(path)!==hash(join(copy,path))) throw new Error('compiled_byte_mismatch:'+path);
  return {path,sha256:hash(path)};
});
const result = { base, qualificationCopy:copy, files, compiled, profiles };
fs.writeFileSync('docs/plan/mh-l3/proof-audit.json',JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify(profiles,null,2)+'\n');
