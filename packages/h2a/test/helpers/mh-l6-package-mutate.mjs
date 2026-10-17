import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw Error('private_qualification_copy_required');
const policy = 'packages/h2a/src/runtime/upgrade/image-policy.js', factory = 'scripts/mh-l1-package-prototype.mjs', index = '.git/index';
const published = 'packages/h2a/test/mh-l6-published.test.js', packageTest = 'packages/h2a/test/mh-l6-package.test.js', seamTest = 'packages/h2a/test/succession-lock-seam-guard.test.js';
const cases = [
  ['minimum-libc', policy, [['Number(libc[1]) < 2 || (Number(libc[1]) === 2 && Number(libc[2]) < 31) ||', '']], published, 'U10 should reject a libc below the pinned native baseline before any image preparation'],
  ['unsupported-platform', policy, [[" || process.platform !== 'linux'", '']], published, 'U10 should reject unsupported platform and architecture before creating an image directory'],
  ['unsupported-architecture', policy, [['manifest.profile.arch !== process.arch || ', '']], published, 'U10 should reject unsupported platform and architecture before creating an image directory'],
  ['plugin-version', factory, [['plugin.version = releaseVersion; ', '']], packageTest, 'U10 should build the actual closed dependency graph from pinned prebuilds before invoking npm'],
  ['diagnostic-installability', factory, [["    engines: { node: release ?", "    ...(release ? { os: ['linux'], cpu: ['x64'] } : {}),\n    engines: { node: release ?"]], packageTest, 'U10 should install @sentropic/h2a for off-profile diagnostics while refusing H4 preparation'],
  ['distributed-seam', factory, [['  const manifest = createManifest(root, {', "  if (release) cpSync(join(repo, 'packages/h2a/test/succession-lock-test-seam.mjs'), join(root, corePath, 'dist/runtime/local-files/succession-lock-test-seam.mjs'));\n  const manifest = createManifest(root, {"]], seamTest, undefined, 5],
  ['nonempty-source-inventory', index, [], seamTest, undefined, 5],
];
const originals = new Map([...new Set(cases.map(row => row[1]))].map(path => [path, fs.readFileSync(path)]));
const modes = new Map([...originals.keys()].map(path => [path, fs.statSync(path).mode & 0o777]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), major = process.versions.node.split('.')[0], results = [];
for (const [name, path, changes, file, scenario, count = 1] of cases) {
  const run = color => {
    const label = `E3b2-${name}-${color}`, result = spawnSync(process.execPath, ['scripts/mh-l6-test.mjs', file, label], {
      env: { ...process.env, ...(scenario ? { MH_L6_CASE: scenario } : {}) }, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/${file.split('/').at(-1)}-node${major}-${label}.log`, text = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
    if (result.status !== (color === 'red' ? 1 : 0) || receipt.code !== result.status || receipt.invalid || receipt.signal || receipt.tests !== count ||
      (color === 'red' && !text.includes('ERR_ASSERTION'))) throw Error(`invalid_mutation:${name}:${color}:${log}`);
    if (name === 'distributed-seam' && color === 'red' && !text.includes('succession-lock-test-seam.mjs')) throw Error('seam_oracle_not_reached');
    return log;
  };
  let red;
  try {
    if (path === index) fs.unlinkSync(index); // Empty inventory, not a corrupt Git index.
    else {
      let bytes = originals.get(path).toString();
      for (const [from, to] of changes) { if (bytes.split(from).length !== 2) throw Error('mutation_not_unique:' + name); bytes = bytes.replace(from, to); }
      fs.writeFileSync(path, bytes);
    }
    red = run('red');
  } finally { for (const [path, bytes] of originals) { fs.writeFileSync(path, bytes); fs.chmodSync(path, modes.get(path)); } }
  const green = run('green');
  for (const [path, bytes] of originals) if (hash(fs.readFileSync(path)) !== hash(bytes)) throw Error('restore_failed:' + path);
  for (const [path, mode] of modes) if ((fs.statSync(path).mode & 0o777) !== mode) throw Error('mode_restore_failed:' + path);
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-package-E3b2-node${major}.json`, JSON.stringify({ node: process.version,
    files: [...originals].map(([path, bytes]) => ({ path, sha256: hash(bytes), mode: modes.get(path), privateFixture: path === index })), results }, null, 2) + '\n');
  console.log(name + ': assertion red, restored green');
}
