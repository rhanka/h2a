// Reversible faults run only in the private qualification copy, one explicit
// test file/case per pair. Baseline source bytes are restored even on failure.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw Error('private_qualification_copy_required');
const phase = process.argv[2] ?? '';
if (phase && !/^[A-Za-z0-9-]+$/.test(phase)) throw Error('invalid_evidence_phase');
const stem = 'packages/h2a/', published = stem + 'src/runtime/upgrade/published-payload.js', policy = stem + 'src/runtime/upgrade/image-policy.js';
const gate = 'scripts/check-publish-payload.mjs', native = 'scripts/build-release-native.mjs', prepare = 'scripts/prepare-workspace-native.mjs';
const test = name => stem + 'test/mh-l6-' + name + '.test.js', u10 = text => 'U10 should ' + text, u12 = text => 'U12 should ' + text;
const cases = [
  ['profile-identity', published, [["    if (codeDigest && current !== codeDigest) throw Error('published_payload_profiles_disagree');", '']], test('published'), u10('refuse contradictory build identities between profiles with identical code')],
  ['other-profile-integrity', published, [['    verifyImage(root, candidate, digest(candidate));', "    if (candidate === manifest) verifyImage(root, candidate, digest(candidate));"]], test('published'), u10('refuse corrupt code claims in a nonselected published profile')],
  ['published-version', published, [["  if (pkg.version !== manifest.packageVersion) throw Error('published_package_version_mismatch');", '']], test('published'), u10('bind published version metadata to the actual package version')],
  ['copied-image-integrity', published, [['    verifyImage(destination, published.manifest, published.manifestDigest);', '', 2]], test('published'), u10('remove only its own new destination when source code changes during the copy')],
  ['independent-image-links', published, [['verbatimSymlinks: true, ', '']], test('published'), u10('preserve internal link bytes and execute the copied image after the mutable source disappears')],
  ['image-parent-fsync', published, [['fs.fsyncSync(parentFd);', '']], test('published'), u10('durably publish the image directory entry before returning and refuse a failed parent sync')],
  ['payload-fsync', published, [['    syncTree(destination);', '']], test('published'), u10('refuse image preparation when a durable payload sync fails')],
  ['root-sdk-esm', policy, [['const bindRoot = fromImage &&', 'const bindRoot = false &&']], test('image-policy'), u12('bind the image root SDK and its public subpath for an internal ESM dependency')],
  ['root-sdk-cjs', policy, [["if (context.conditions?.includes('require'))", 'if (false)']], test('image-policy'), u12('preserve require conditions when an internal dependency loads the image root SDK')],
  ['root-sdk-provenance', policy, [['const bindRoot = fromImage &&', 'const bindRoot =']], test('image-policy'), u12('refuse a forged external require base even when its package name matches the image root SDK')],
  ['root-sdk-exports', policy, [["    metadataFor(rootPackagePath);", "    return {url: pathToFileURL(join(root, 'private.mjs')).href, shortCircuit: true};\n    metadataFor(rootPackagePath);"]], test('image-policy'), u12('preserve root SDK export restrictions instead of loading a declared private file')],
  ['root-dependency-lookup', gate, [["cursor = dirname(cursor) === '.' ? '' : dirname(cursor)", 'cursor = dirname(cursor)']], test('publish-gate'), u10('accept an independently verified exact bundled dependency cycle')],
  ['dependency-exactness', gate, [['target === undefined || lock.packages[target]?.version !== version', 'target === undefined']], test('publish-gate'), u10('reject a loose dependency range even when npm could satisfy it locally')],
  ['installation-script', gate, [["['scripts', 'peerDependencies'", "['peerDependencies'"]], test('publish-gate'), u10('reject executable installation scripts in a hashed bundled package')],
  ['bundle-completeness', gate, [["  if (JSON.stringify([...(pkg.bundleDependencies ?? [])].sort()) !== JSON.stringify(Object.keys(pkg.dependencies ?? {}).sort())) throw Error('release_bundle_incomplete');", '']], test('publish-gate'), u10('reject missing bundled choices and shrinkwrap metadata drift')],
  ['runtime-exactness', gate, [["  if (pkg.dependencies[sibling] !== pkg.version) throw Error('release_runtime_not_lockstep');", '']], test('publish-gate'), u10('reject a sibling runtime whose exact version differs from the core')],
  ['native-copy-pin', native, [["  if (hash(archive) !== 'sha256:' + release.archive.sha256) throw Error('native_archive_mismatch');", '']], test('native-copy'), u10('reject altered release archive bytes before extracting anything into a payload')],
  ['native-copy-destination', native, [["  if (fs.readdirSync(destination).length) throw Error('native_destination_must_be_empty');", '']], test('native-copy'), u10('never overwrite an existing native copy destination')],
  ['workspace-shared-native', prepare, [["  if (!target.startsWith(repo + sep)) throw Error('workspace_native_target_external');", '']], test('native-copy'), u10('refuse a shared workspace dependency and leave the outside target untouched')],
  ['workspace-native-javascript', prepare, [["else if (!fs.readFileSync(path).equals(fs.readFileSync(join(target, 'lib', next)))) throw Error('workspace_native_source_mismatch');", '']], test('native-copy'), u10('refuse mismatched workspace JavaScript before changing its native binding')],
  ['workspace-native-cleanup', prepare, [['fs.rmSync(temporaryBinary, { force: true });', '']], test('native-copy'), u10('preserve the previous binding and remove its temporary file when native replacement fails')],
  ['version-peer-migration', 'scripts/release.mjs', [['  requireExactRuntime(parsed, newVersion);', '']], stem + 'test/release-script.test.js', undefined, 21],
  ['version-lock-migration', 'scripts/release.mjs', [['      requireExactRuntime(pkg, newVersion);', '']], stem + 'test/release-script.test.js', undefined, 21],
  ['closed-publication', '.github/workflows/release.yml', [['npm publish "$RUNNER_TEMP/h2a-closed/h2a/artifacts/sentropic-h2a-${v}.tgz"', 'npm publish --workspace @sentropic/h2a']], stem + 'test/release-workflow-publish-order.test.js', undefined, 9],
  ['prototype-entrypoint', 'scripts/mh-l1-package-prototype.mjs', [["shim: release ? atCore('dist/bin.js') : 'dist/bin.js'", "shim: atCore('dist/bin.js')"]], test('entry'), undefined, 8],
  ['release-native-source-fallback', 'scripts/mh-l1-package-prototype.mjs', [['release ? await copyReleaseNative(root) : await buildNativePrototype(root)', 'await buildNativePrototype(root)']], test('package'), 'U10 should build the actual closed dependency graph from pinned prebuilds before invoking npm'],
];
const paths = [...new Set(cases.map(row => row[1]))], originals = new Map(paths.map(path => [path, fs.readFileSync(path)]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), results = [], major = process.versions.node.split('.')[0];
for (const [name, path, changes, file, scenario, count = 1] of cases) {
  const run = color => {
    const label = `${phase ? phase + '-' : ''}payload-${name}-${color}`, result = spawnSync(process.execPath, ['scripts/mh-l6-test.mjs', file, label], {
      env: { ...process.env, ...(scenario ? { MH_L6_CASE: scenario } : {}) }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/${file.split('/').at(-1)}-node${major}-${label}.log`, text = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
    if (result.status !== (color === 'red' ? 1 : 0) || receipt.code !== result.status || receipt.invalid || receipt.signal || receipt.tests !== count ||
      (color === 'red' && !text.includes('ERR_ASSERTION'))) throw Error(`invalid_mutation:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    let bytes = originals.get(path).toString();
    for (const [from, to, count = 1] of changes) {
      if (bytes.split(from).length - 1 !== count) throw Error('mutation_not_unique:' + name + ':' + from);
      bytes = bytes.replaceAll(from, to);
    }
    fs.writeFileSync(path, bytes); red = run('red');
  } finally { for (const [path, bytes] of originals) fs.writeFileSync(path, bytes); }
  const green = run('green');
  for (const [path, bytes] of originals) if (hash(fs.readFileSync(path)) !== hash(bytes)) throw Error('restore_failed:' + path);
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-payload-${phase ? phase + '-' : ''}node${major}.json`, JSON.stringify({ node: process.version,
    files: [...originals].map(([path, bytes]) => ({ path, sha256: hash(bytes) })), results }, null, 2) + '\n');
  process.stdout.write(name + ': assertion red, restored green\n');
}
