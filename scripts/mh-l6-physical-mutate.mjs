// Mutate only the private qualification copy; never mutate a running test/build.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw Error('private_qualification_copy_required');
const path = 'packages/h2a/src/runtime/upgrade/physical-installation.js';
const compiled = path.replace('/src/', '/dist/'), file = 'packages/h2a/test/mh-l6-physical.test.js';
const name = suffix => 'U07 should ' + suffix;
const cases = [
  ['caller-prefix', [['if (candidate.dev !== actual.dev || candidate.ino !== actual.ino)', 'if (false)'],
    ['prefixLayout(prefix, legacyPrefix, process.getuid())', 'prefixLayout(layout.canonicalPrefix, legacyPrefix, process.getuid())']], name('accept physical prefix aliases but reject a different caller npm prefix')],
  ['legacy-prefix', [['prefixLayout(match[1], legacyPrefix, process.getuid())', 'prefixLayout(match[1], match[1], process.getuid())'],
    ['prefixLayout(prefix, legacyPrefix, process.getuid())', 'prefixLayout(prefix, prefix, process.getuid())']], name('reject a different physical prefix used by the legacy engine')],
  ['package-metadata', [["!['dist/bin.js', './dist/bin.js'].includes(bin)) throw new Error('legacy_package_metadata_invalid');", "!['dist/bin.js', './dist/bin.js'].includes(bin)) {}"]], name('verify the npm package identity and declared command entry')],
  ['hardlink', [['info.nlink !== 1 ||', '']], name('reject hardlinked npm code before adoption')],
  ['file-mode', [["!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o022)", "!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()"]], name('reject writable npm metadata and entry bytes')],
  ['directory-mode', [["!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022)", "!info.isDirectory() || info.uid !== process.getuid()"]], name('reject a writable physical package directory')],
  ['direct-command', [['resolve(dirname(path), target) !== entrypoint ||', '']], name('require the current command to be the direct original npm symlink')],
  ['command-target', [['resolve(dirname(path), target) !== entrypoint || fs.realpathSync(path) !== entrypoint', 'false']], name('reject a shadowed npm command even when the chosen entry is real')],
  ['revalidate', [['if (!same(observed, evidence)) changed();', '']], name('detect changed entry bytes before a subsequent adoption mutation')],
  ['command-inode', [['return { ...stamp(info), target };', 'return { target };']], name('detect an identical-byte inode replacement of the original command')],
  ['opened-file', [['if (!same(observed, qualify(fs.fstatSync(fd)))) changed();', ''],
    ['if (!same(observed, qualify(fs.fstatSync(fd))) || !same(observed, qualify(fs.lstatSync(path)))) changed();', ''],
    ['!same(withoutBytes(metadata), withoutBytes(file(metadataPath))) ||', '']], name('not accept a same-path substituted file between lstat and read')],
  ['metadata-reread', [['!same(withoutBytes(metadata), withoutBytes(file(metadataPath))) ||', '']], name('recheck metadata after observing the command link')],
  ['prefix-reread', [["const final = prefixLayout(prefix, legacyPrefix, process.getuid());", 'const final = layout;']], name('recheck the legacy prefix alias before returning an observation')],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = [path, compiled].map(path => ({ path, bytes: fs.readFileSync(path) }));
const major = process.versions.node.split('.')[0], results = [];
for (const [name, changes, scenario] of cases) {
  const run = color => {
    const label = `physical-${name}-${color}`;
    const r = spawnSync(process.execPath, ['scripts/mh-l6-test.mjs', file, label], {
      env: { ...process.env, MH_L6_CASE: scenario }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/mh-l6-physical.test.js-node${major}-${label}.log`;
    const text = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
    if (r.status !== (color === 'red' ? 1 : 0) || receipt.invalid || receipt.signal || receipt.tests !== 1 ||
      (color === 'red' && !text.includes('ERR_ASSERTION'))) throw Error(`invalid_mutation:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    for (const original of originals) {
      let text = original.bytes.toString();
      for (const [from, to] of changes) {
        const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
        if ([...text.matchAll(re)].length !== 1) throw Error(`mutation_not_unique:${name}:${original.path}`);
        text = text.replace(re, () => to);
      }
      fs.writeFileSync(original.path, text);
    }
    red = run('red');
  } finally { for (const original of originals) fs.writeFileSync(original.path, original.bytes); }
  const green = run('green');
  for (const original of originals) if (hash(fs.readFileSync(original.path)) !== hash(original.bytes)) throw Error('restore_failed');
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-physical-node${major}.json`, JSON.stringify({ node: process.version,
    files: originals.map(o => ({ path: o.path, sha256: hash(o.bytes) })), results }, null, 2) + '\n');
  process.stdout.write(name + ': assertion red, restored green\n');
}
