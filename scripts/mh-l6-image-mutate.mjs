// Image reader faults, actual Node loaders, exact private-source restoration.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_qualification_copy_required');
const phase = process.argv[2] ?? '';
if (phase && !/^[A-Za-z0-9-]+$/.test(phase)) throw new Error('invalid_evidence_phase');
const stem = 'packages/h2a/', policy = stem + 'src/runtime/upgrade/image-policy.js';
const launcher = stem + 'src/runtime/upgrade/managed-launcher.js', h4 = stem + 'src/runtime/upgrade/h4-store.js';
const test = stem + 'test/mh-l6-image-policy.test.js', launchTest = stem + 'test/mh-l6-launcher.test.js';
const lookup = "const row = entries.get(relative(root, path).split(sep).join('/'));";
const cases = [
  ['native-integrity', policy, "if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== row.digest) fail('image_module_integrity');", '', test, 'U10 should load the real node-pty probe and its ABI-qualified addon through the image reader'],
  ['esm-boundary', policy, 'const hooks = Module.registerHooks({', 'const hooks = (() => Module.registerHooks({ resolve(s,c,n){ return n(s,c); }, load(u,c,n){ return n(u,c); } }))({', test, 'U12 should refuse a parent npm decoy after a verified ESM dependency disappears'],
  ['cjs-boundary', policy, 'const hooks = Module.registerHooks({', 'const hooks = (() => Module.registerHooks({ resolve(s,c,n){ return n(s,c); }, load(u,c,n){ return n(u,c); } }))({', test, 'U12 should refuse a NODE_PATH decoy through createRequire after its internal package disappears'],
  ['external-require-base', policy, 'const hooks = Module.registerHooks({', 'const hooks = (() => Module.registerHooks({ resolve(s,c,n){ return n(s,c); }, load(u,c,n){ return n(u,c); } }))({', test, 'U12 should refuse createRequire pointed at an external base by image code'],
  ['module-integrity', policy, "if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== row.digest) fail('image_module_integrity');", '', test, 'U12 should recheck late module bytes and isolate the manifest snapshot from its caller'],
  ['manifest-snapshot', policy, 'const snapshot = structuredClone(manifest);', 'const snapshot = manifest;', test, 'U12 should recheck late module bytes and isolate the manifest snapshot from its caller'],
  ['manifest-mode', policy, lookup, "let row = entries.get(relative(root, path).split(sep).join('/')); if (row) row = { ...row, mode: fs.statSync(path).mode & 0o777 };", test, 'U12 should reject late module mode changes even when the bytes are unchanged'],
  ['package-metadata', policy, 'const metadataFor = file => {', 'const metadataFor = file => { return;', test, 'U12 should reject altered package metadata before executing an otherwise unchanged module'],
  ['unrecorded-code', policy, lookup, "const row = entries.get(relative(root, path).split(sep).join('/')) ?? { type: 'file', mode: fs.statSync(path).mode & 0o777, digest: 'sha256:' + createHash('sha256').update(fs.readFileSync(path)).digest('hex') };", test, 'U12 should refuse code added inside the image after its manifest was verified'],
  ['launcher-binding', launcher, 'installImageExecutionPolicy(current.imageRoot, current.manifest, current.selection.manifestDigest, loader);', '', launchTest, 'U12 should install the closed reader before the selected entry can import outside its image'],
  ['preselection-runtime', h4, 'assertImageRuntime(manifest);', '', test, 'U10 should refuse selection before journaling when the runtime has no qualified image reader'],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), major = process.versions.node.split('.')[0];
const paths = [policy, launcher, h4, h4.replace('/src/', '/dist/')];
const originals = paths.map(path => ({ path, bytes: fs.readFileSync(path) })), results = [];
for (const [name, path, from, to, file, scenario] of cases) {
  const targets = path === h4 ? [h4, h4.replace('/src/', '/dist/')] : [path];
  const run = color => {
    const label = `${phase ? phase + '-' : ''}mutation-${name}-${color}`;
    const result = spawnSync(process.execPath, ['scripts/mh-l6-test.mjs', file, label],
      { env: { ...process.env, MH_L6_CASE: scenario }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/${file.split('/').at(-1)}-node${major}-${label}.log`, output = fs.readFileSync(log, 'utf8');
    const r = JSON.parse(output.split('\nreceipt: ').at(-1));
    if (result.status !== (color === 'red' ? 1 : 0) || r.invalid || r.signal || r.tests !== 1 ||
      (color === 'red' && !output.includes('ERR_ASSERTION'))) throw new Error(`invalid_mutation:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    for (const target of targets) {
      const bytes = originals.find(o => o.path === target).bytes;
      const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
      if ([...bytes.toString().matchAll(pattern)].length !== 1) throw new Error('mutation_not_unique:' + name + ':' + target);
      fs.writeFileSync(target, bytes.toString().replace(pattern, () => to));
    }
    red = run('red');
  } finally { for (const { path, bytes } of originals) fs.writeFileSync(path, bytes); }
  const green = run('green');
  for (const o of originals) if (hash(fs.readFileSync(o.path)) !== hash(o.bytes)) throw new Error('restore_failed');
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-image-${phase ? phase + '-' : ''}node${major}.json`, JSON.stringify({ node: process.version,
    files: originals.map(o => ({ path: o.path, sha256: hash(o.bytes) })), results }, null, 2) + '\n');
  process.stdout.write(`${name}: killed by assertion and restored\n`);
}
