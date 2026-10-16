import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw Error('private_qualification_copy_required');
const path = 'scripts/build-release-native.mjs', original = fs.readFileSync(path), file = 'packages/h2a/test/mh-l6-native.test.js';
const name = suffix => 'U10 should ' + suffix;
const cases = [
  ['archive-pin', [["if (hash(bytes) !== 'sha256:' + input.sha256) throw Error('native_input_digest_mismatch:' + input.name);", '']], name('reject an unpinned compiler archive before its first instruction executes')],
  ...[['elf', 'refuse altered precompiled binary bytes before they reach require'], ['javascript', 'refuse altered real node-pty JavaScript even if the ELF is intact'],
    ['inventory', 'refuse an unrecorded file and a changed payload mode']].map(([label, scenario]) => [label,
    [[' || digest(observed) !== digest(artifact)', '']], name(scenario)]),
  ['descriptor-pin', [['digest(stored) !== digest(artifact) || ', '']], name('refuse an altered or extended artifact descriptor')],
  ['hardlink', [[' || info.nlink !== 1', '']], name('refuse a hardlinked precompiled artifact rather than sharing mutable ELF bytes')],
  // Following links defeats both the inventory type guard and O_NOFOLLOW reads;
  // this is a combined configuration, not a claim that either alone is absent.
  ['symlink', [['fs.lstatSync(', 'fs.statSync(', 5], [' | fs.constants.O_NOFOLLOW', '']], name('refuse a symlinked binary pointing outside the precompiled payload')],
  ['architecture', [[" || process.arch !== 'x64'", '']], name('reject an unqualified architecture before consuming the artifact or compiling')],
  ['major', [["!recipe.nodeMajors.includes(Number(process.versions.node.split('.')[0])) ||", '']], name('reject an unqualified Node major before consuming the artifact or compiling')],
  ['abi', [['!recipe.nodeAbis.includes(process.versions.modules) ||', '']], name('reject an unqualified Node ABI before consuming the artifact or compiling')],
  ['napi', [['Number(process.versions.napi) < recipe.napiVersion', 'false']], name('reject an unqualified N-API level before consuming the artifact or compiling')],
  ['libc', [["if (major < 2 || (major === 2 && minor < 31)) throw Error('native_profile_unqualified');", '']], name('reject a libc below the target baseline before consuming the artifact or compiling')],
  ['ambient-fallback', [['export function verifyReleaseNative(root) {', "export function verifyReleaseNative(root) {\n  if (!fs.existsSync(join(root, 'payload', binaryPath))) fs.copyFileSync(join(process.env.MH_L6_NATIVE_ASSETS, 'primary/payload', binaryPath), join(root, 'payload', binaryPath));"]], name('reject a missing precompiled binary without falling back to sources or scripts')],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), results = [], major = process.versions.node.split('.')[0];
for (const [name, changes, scenario] of cases) {
  const run = color => {
    const label = `native-${name}-${color}`, r = spawnSync(process.execPath, ['scripts/mh-l6-test.mjs', file, label], {
      env: { ...process.env, MH_L6_CASE: scenario }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/mh-l6-native.test.js-node${major}-${label}.log`, text = fs.readFileSync(log, 'utf8');
    const receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
    if (r.status !== (color === 'red' ? 1 : 0) || receipt.invalid || receipt.signal || receipt.tests !== 1 ||
      (color === 'red' && !text.includes('ERR_ASSERTION'))) throw Error(`invalid_mutation:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    let bytes = original.toString();
    for (const [from, to, count = 1] of changes) {
      if (bytes.split(from).length - 1 !== count) throw Error('mutation_not_unique:' + name + ':' + from);
      bytes = bytes.replaceAll(from, to);
    }
    fs.writeFileSync(path, bytes); red = run('red');
  } finally { fs.writeFileSync(path, original); }
  const green = run('green');
  if (hash(fs.readFileSync(path)) !== hash(original)) throw Error('restore_failed');
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-native-node${major}.json`, JSON.stringify({ node: process.version,
    files: [{ path, sha256: hash(original) }], results }, null, 2) + '\n');
  console.log(name + ': assertion red, restored green');
}
