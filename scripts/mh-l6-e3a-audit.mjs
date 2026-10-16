import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { digest } from '../packages/h2a/src/runtime/handover/wire.js';
const worktree = resolve(new URL('../', import.meta.url).pathname), source = fs.realpathSync(process.argv[2]);
const assets = fs.realpathSync(process.argv[3]);
if (!source.startsWith('/tmp/mh-l3-qualification-') || !assets.startsWith('/tmp/mh-l6-toolchain-')) throw Error('private_qualification_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['scripts/build-release-native.mjs', 'scripts/release/native-toolchain.lock.json',
  'scripts/release/artifacts/node-pty-linux-x64-gnu-napi8.tgz', 'packages/h2a/test/mh-l6-native.test.js',
  'packages/h2a/test/mh-l6-physical.test.js', 'scripts/mh-l6-test.mjs', 'scripts/mh-l6-native-mutate.mjs',
  'scripts/mh-l6-e3a-audit.mjs', 'packages/h2a/src/runtime/handover/wire.js', 'package-lock.json'].map(path => {
    const bytes = fs.readFileSync(join(worktree, path));
    if (!bytes.equals(fs.readFileSync(join(source, path)))) throw Error('copy_mismatch:' + path);
    return { path, sha256: hash(bytes) };
  });
const directory = 'docs/plan/mh-l6/', evidence = directory + 'evidence/';
const lock = JSON.parse(fs.readFileSync(join(worktree, 'scripts/release/native-toolchain.lock.json')));
if (lock.artifact.recipeDigest !== digest(lock.recipe) || files.find(f => f.path.endsWith('.tgz')).sha256 !== lock.archive.sha256) throw Error('release_pin_mismatch');
const inputs = lock.recipe.archives.map(input => {
  const bytes = fs.readFileSync(join(assets, input.name));
  if (hash(bytes) !== input.sha256) throw Error('input_drift:' + input.name);
  const name = { 'node-pty.tgz': 'node-pty', 'node-addon-api.tgz': 'node-addon-api' }[input.name];
  const dependency = name && JSON.parse(fs.readFileSync(join(worktree, 'package-lock.json'))).packages['node_modules/' + name];
  const integrity = dependency ? 'sha512-' + createHash('sha512').update(bytes).digest('base64') : null;
  if (dependency && dependency.integrity !== integrity) throw Error('npm_source_integrity_mismatch');
  return { ...input, bytes: bytes.length, npmLockIntegrity: integrity };
});
const log = (path, code, tests) => {
  const bytes = fs.readFileSync(join(source, path)), text = bytes.toString(), receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
  if (receipt.code !== code || receipt.tests !== tests || receipt.invalid || receipt.signal || receipt.leftovers.length ||
    /# (?:skipped|cancelled|todo) [1-9]/.test(text)) throw Error('invalid_receipt:' + path);
  return { path, sha256: hash(bytes), ...receipt };
};
const profiles = [22, 24].map(major => {
  const native = log(evidence + `mh-l6-native.test.js-node${major}-final-E3a-15.log`, 0, 15);
  const physical = log(evidence + `mh-l6-physical.test.js-node${major}-final-E3a.log`, 0, 20);
  const text = fs.readFileSync(join(source, native.path), 'utf8');
  const rebuilt = JSON.parse(text.split('\n').find(line => line.startsWith('# {"root":')).slice(2));
  if (digest(rebuilt.artifact) !== digest(lock.artifact) || !rebuilt.testedHost.node.startsWith(`v${major}.`) ||
    rebuilt.commands.length !== 1 || rebuilt.commands[0].code !== 0 || rebuilt.commands[0].stdout || rebuilt.commands[0].stderr) throw Error('rebuild_mismatch');
  const path = directory + `mutations-native-node${major}.json`, mutations = JSON.parse(fs.readFileSync(join(source, path)));
  if (mutations.results.length !== 13 || !mutations.node.startsWith(`v${major}.`)) throw Error('mutation_count');
  for (const file of mutations.files) if (hash(fs.readFileSync(join(source, file.path))) !== file.sha256) throw Error('restore_failed');
  const pairs = mutations.results.map(row => {
    if (!row.restored) throw Error('restore_missing');
    const red = log(row.red, 1, 1), green = log(row.green, 0, 1), text = fs.readFileSync(join(source, row.red), 'utf8');
    if (!text.includes('ERR_ASSERTION')) throw Error('nonassertion_red');
    if (row.name === 'archive-pin' && !text.includes('unverified compiler must never execute')) throw Error('untrusted_code_oracle_missing');
    if (row.name === 'ambient-fallback' && !text.includes('a consumer must not recreate the missing ELF')) throw Error('fallback_oracle_missing');
    return { name: row.name, red, green };
  });
  return { node: mutations.node, native, physical, rebuilt, pairs };
});
const comparison = JSON.parse(fs.readFileSync(join(worktree, evidence + 'native-published-six-diagnostic.json')));
if (comparison.rows.length !== 6 || comparison.rows.filter(row => !row.equal).length !== 5) throw Error('native_byte_gate_changed');
const proof = { baseCommit: 'f5b33b7789b602a55d6bac80621cc787c3e939ce', source, assets, files, inputs,
  lock, profiles, hostRuntimeQualified: { platform: 'linux', arch: 'x64', glibc: '2.43' },
  targetBaseline: 'glibc 2.31; not executed on 2.31', actualLegacyRequireAndPty: true,
  nativeByteComparison: comparison, frozenClosureQualified: false, publishedH2aPayloadQualified: false,
  closureProducer: false, bootstrapActivation: false, releaseQualified: false };
fs.writeFileSync(join(worktree, directory + 'proof-E3a.json'), JSON.stringify(proof, null, 2) + '\n');
console.log('E3a: 10 identical files; pinned archives + shipped prebuild; 35 targeted tests and 13 killed/restored configurations per Node 22/24; real PTY, same ELF/payload across build roots; zero skips/leftovers; .6 freeze and h2a release remain unqualified');
