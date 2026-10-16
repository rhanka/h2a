// Run from the clean umask-022 qualification archive. All targets are local
// source bytes; the existing isolated runner starts only temporary participants.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
if (![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw new Error('Node 22/24 required');
const path = 'packages/h2a/src/runtime/mcp-central.ts';
const cases = {
  'successor-control': ["          if (stoppedControl.value.sourceGeneration !== marker.generation ||\n              digest(stoppedControl.value.ownerIdentity) !== digest(identity)) return;", ''],
  'published-source-authority': ['if (!liveSource?.verifyAuthority(tx)) compareMarker(markerPath, claim);', 'compareMarker(markerPath, claim);']
};
const selected = process.argv.slice(2), names = selected.length ? selected : Object.keys(cases);
if (names.some(name => !cases[name])) throw new Error('unknown_mutation');
const major = process.versions.node.split('.')[0], evidence = 'docs/plan/mh-l2/evidence';
const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(`${evidence}/owner-A-node${major}-${label}.log`, `command: ${process.execPath} ${args.join(' ')}\nnode: ${process.version}\n${result.stdout}${result.stderr}\nexitCode: ${result.status}\n`);
  return { code: result.status, output: result.stdout + result.stderr };
};
const compile = label => {
  const result = run(['node_modules/typescript/bin/tsc', '-b', 'packages/h2a', 'packages/h2a-runtime', '--pretty', 'false'], label);
  if (result.code !== 0) throw new Error('mutation_build_failed');
};
for (const name of names) {
  const source = fs.readFileSync(path, 'utf8'), [before, after] = cases[name];
  if (source.split(before).length !== 2) throw new Error('mutation_anchor_not_unique');
  let red;
  try {
    fs.writeFileSync(path, source.replace(before, after)); compile(name + '-mutant-build');
    red = run(['scripts/mh-l2-test.mjs', 'packages/h2a/test/mh-l2-live-central.test.js', `owner-A-node${major}-${name}-red`], name + '-red-receipt');
  } finally { fs.writeFileSync(path, source); compile(name + '-restored-build'); }
  if (red.code !== 1 || !red.output.includes('ERR_ASSERTION')) throw new Error('mutation_survived_or_failed_abnormally:' + name);
  const green = run(['scripts/mh-l2-test.mjs', 'packages/h2a/test/mh-l2-live-central.test.js', `owner-A-node${major}-${name}-green`], name + '-green-receipt');
  if (green.code !== 0) throw new Error('restored_source_failed:' + name);
  process.stdout.write(`node${major} real source ${name}: mutant=1 (assertion), restored=0\n`);
}
