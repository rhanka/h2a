import fs from 'node:fs';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { digest } from '../packages/h2a/src/runtime/handover/wire.js';
import { buildManagedLauncher } from './build-managed-launcher.mjs';
const worktree = resolve(fileURLToPath(new URL('../', import.meta.url))), source = fs.realpathSync(process.argv[2]);
assert.ok(source.startsWith('/tmp/mh-l3-qualification-')); assert.ok(process.versions.node.startsWith('22.'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), directory = 'docs/plan/mh-l6/', evidence = directory + 'evidence/';
const names = [['mh-l6-package', 3], ['mh-l6-published', 12], ['mh-l6-image-policy', 16], ['mh-l6-native-copy', 7],
  ['mh-l6-publish-gate', 8], ['release-script', 21], ['release-workflow-publish-order', 9], ['mh-l6-launcher', 25],
  ['mh-l6-entry', 8, 'prototype-entry-green'], ['mh-l6-components', 23], ['mh-l6-native', 15], ['mh-l1-package', 1]];
const paths = ['.github/workflows/release.yml', 'package.json', 'package-lock.json', 'packages/h2a/package.json', 'packages/h2a-runtime/package.json',
  ...['image-policy', 'published-payload', 'image-execution', 'image-entry', 'managed-launcher'].map(name => `packages/h2a/src/runtime/upgrade/${name}.js`),
  ...['wire', 'image', 'selection', 'authority', 'state'].map(name => `packages/h2a/src/runtime/handover/${name}.js`),
  ...names.map(([name]) => `packages/h2a/test/${name}.test.js`),
  ...['mh-l5-image.js', 'mh-l1-transport.js'].map(name => 'packages/h2a/test/helpers/' + name),
  ...['release.mjs', 'build-managed-launcher.mjs', 'build-release-native.mjs', 'mh-l1-package-prototype.mjs', 'mh-l0-native-prototype.mjs',
    'check-publish-payload.mjs', 'package-release.mjs', 'prepare-workspace-native.mjs', 'mh-l6-test.mjs',
    'mh-l6-payload-mutate.mjs', 'mh-l6-image-mutate.mjs', 'mh-l6-e3b-audit.mjs', 'release/native-toolchain.lock.json',
    'release/artifacts/node-pty-linux-x64-gnu-napi8.tgz'].map(name => 'scripts/' + name)];
const files = paths.map(path => {
  const bytes = fs.readFileSync(join(worktree, path)); assert.deepEqual(fs.readFileSync(join(source, path)), bytes, path);
  return { path, sha256: hash(bytes) };
});
function copy(path) {
  const bytes = fs.readFileSync(join(source, path)); fs.mkdirSync(join(worktree, path, '..'), { recursive: true }); fs.writeFileSync(join(worktree, path), bytes);
  return { path, sha256: hash(bytes) };
}
function log(path, code, count) {
  const row = copy(path), text = fs.readFileSync(join(worktree, path), 'utf8'), receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
  assert.equal(receipt.code, code, path); assert.equal(receipt.signal, null, path); assert.equal(receipt.invalid, false, path);
  assert.deepEqual(receipt.leftovers, [], path); if (count !== undefined) assert.equal(receipt.tests, count, path);
  assert.doesNotMatch(text, /# (?:skipped|cancelled|todo) [1-9]/);
  return { ...row, ...receipt };
}
const profiles = [22, 24].map(major => {
  const logs = names.map(([name, count, label = 'final-E3b']) => log(evidence + `${name}.test.js-node${major}-${label}.log`, 0, count));
  assert.equal(logs.reduce((n, row) => n + row.tests, 0), 148);
  const mutations = ['payload', 'image-E3b'].map(group => {
    const path = directory + `mutations-${group}-node${major}.json`, row = copy(path), record = JSON.parse(fs.readFileSync(join(worktree, path)));
    assert.equal(record.results.length, group === 'payload' ? 26 : 11);
    for (const file of record.files) assert.equal(hash(fs.readFileSync(join(source, file.path))), file.sha256, file.path);
    const pairs = record.results.map(pair => {
      assert.equal(pair.restored, true); const red = log(pair.red, 1), green = log(pair.green, 0);
      assert.equal(red.tests, green.tests); assert.match(fs.readFileSync(join(worktree, pair.red), 'utf8'), /ERR_ASSERTION/);
      return { name: pair.name, red, green };
    });
    return { ...row, ...record, pairs };
  });
  const buildPath = evidence + `build-E3b-node${major}.json`, build = JSON.parse(fs.readFileSync(join(source, buildPath)));
  assert.equal(build.code, 0); assert.equal(build.signal, null); assert.equal(build.stdout, ''); assert.equal(build.stderr, ''); copy(buildPath);
  const packaging = fs.readFileSync(join(source, logs[0].path), 'utf8');
  assert.equal((packaging.match(/scripts-enabled positive control/g) ?? []).length, 2);
  assert.match(packaging, /actual published 0\.98\.5: stageInstall/); assert.match(packaging, /actual published 0\.98\.6: stageInstall/);
  assert.equal((packaging.match(/actual installed corrected MCP transport/g) ?? []).length, 2);
  const images = packaging.split('\n').filter(line => line.startsWith('# same actual npm tar => managed SDK and PTY ')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.equal(images.length, major === 22 ? 4 : 2); for (const image of images) { assert.equal(image.native, true); assert.equal(image.sdk, 531); }
  return { major, logs, tests: 148, mutationPairs: 37, mutations, build, images };
});
assert.equal(profiles[0].images[1].manifest, profiles[1].images[0].manifest);
assert.equal(profiles[0].images[3].manifest, profiles[1].images[1].manifest);
// Preserve genuine initial regressions separately from intermediate diagnostics.
const regressions = [22, 24].flatMap(major => [
  ['release-script', 'exact-runtime-initial-red', 21], ['release-workflow-publish-order', 'closed-publish-initial-red', 9],
  ['mh-l6-publish-gate', 'raw-prepack-initial-red', 1], ['mh-l6-published', 'independent-links-initial-red', 1],
  ['mh-l6-published', 'parent-sync-initial-red', 1], ['mh-l6-image-policy', 'root-sdk-initial-red', 1],
  ['mh-l6-image-policy', 'root-require-initial-red', 1], ['mh-l6-entry', 'final-E3b', 8]
].map(([name, label, count]) => { const row = log(evidence + `${name}.test.js-node${major}-${label}.log`, 1, count); assert.match(fs.readFileSync(join(worktree, row.path), 'utf8'), /ERR_ASSERTION/); return row; }));
const compiled = ['packages/h2a/dist/bin.js', 'packages/h2a/dist/index.js', 'packages/h2a-runtime/dist/index.js',
  ...['image-policy', 'published-payload', 'image-entry', 'image-execution'].map(name => `packages/h2a/dist/runtime/upgrade/${name}.js`)].map(path => ({ path, sha256: hash(fs.readFileSync(join(source, path))) }));
const temporary = fs.mkdtempSync('/tmp/mh-l6-e3b-audit-'), saved = new Map(), children = [], originalSpawn = cp.spawn;
for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
  saved.set(key, process.env[key]); process.env[key] = join(temporary, key); fs.mkdirSync(process.env[key], { mode: 0o700 });
}
cp.spawn = function(...args) { const child = originalSpawn.apply(this, args); children.push({ child, closed: new Promise(resolve => child.once('close', resolve)) }); return child; }; syncBuiltinESMExports();
let bundle, reproduced, toolVersions;
try {
  bundle = await buildManagedLauncher(); const other = await import(pathToFileURL(join(source, 'scripts/build-managed-launcher.mjs')));
  const second = await other.buildManagedLauncher(); assert.equal(bundle.digest, second.digest); assert.equal(bundle.loader.digest, second.loader.digest);
  assert.ok([...bundle.imports, ...bundle.loader.imports].every(name => name.startsWith('node:')));
  const { buildReleasePayload } = await import(pathToFileURL(join(source, 'scripts/mh-l1-package-prototype.mjs')));
  reproduced = [];
  for (const [i, packageName] of ['@sentropic/h2a', '@sentropic/h2a-runtime'].entries()) {
    const payload = await buildReleasePayload(join(temporary, 'payload-' + i), { packageName, version: '0.98.7', buildId: 'mh-l6-release-cohort' });
    const matrix = JSON.parse(fs.readFileSync(join(payload.root, 'manifest.json'))), row = { packageName,
      node22: digest(matrix.manifests['22']), node24: digest(matrix.manifests['24']), loaderDigest: payload.execution.digest, native: payload.native.binaryDigest };
    // The prototype-only shim repair happened during the final reference replay.
    // Rebuild the exact release trees and match their complete scalar manifests
    // to the already tested actual npm artifacts; do not infer output equality.
    assert.equal(row.node22, profiles[0].images[i * 2].manifest); assert.equal(row.node24, profiles[1].images[i].manifest);
    assert.equal(row.loaderDigest, bundle.loader.digest); reproduced.push(row);
  }
  toolVersions = [
    { major: 22, path: '/usr/local/bin:/usr/bin:/bin' },
    { major: 24, path: '/tmp/mh-l5-artifacts-shD7Sf/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin' }
  ].map(profile => {
    const result = cp.spawnSync('npm', ['--version'], { env: { ...process.env, PATH: profile.path }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr, '');
    return { nodeMajor: profile.major, command: ['npm', '--version'], PATH: profile.path, stdout: result.stdout, code: result.status };
  });
} finally {
  for (const { child } of children) { if (child.exitCode === null && child.signalCode === null) child.ref(); for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.ref?.(); }
  createRequire(import.meta.url)('esbuild').stop(); createRequire(join(source, 'package.json'))('esbuild').stop();
  await Promise.all(children.map(row => row.closed)); cp.spawn = originalSpawn; syncBuiltinESMExports(); fs.rmSync(temporary, { recursive: true, force: true });
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
const artifact = directory + 'artifacts/h2a-launcher-E3b.mjs', loaderArtifact = directory + 'artifacts/' + bundle.loader.filename;
fs.writeFileSync(join(worktree, artifact), bundle.code); fs.writeFileSync(join(worktree, loaderArtifact), bundle.loader.code);
fs.writeFileSync(join(worktree, directory + 'proof-E3b.json'), JSON.stringify({ baseCommit: 'bcbbfc915eabc5171660b5970c28a5657b772c19', source,
  files, compiled, profiles, regressions, reproduced, toolVersions, artifact, launcherDigest: bundle.digest, loaderArtifact, loaderDigest: bundle.loader.digest,
  noPublishedAction: true, releaseQualified: false, nativeByteFreezeQualified: false, h4BootstrapQualified: false,
  hostProfile: { platform: 'linux', arch: 'x64', glibc: '2.43', targetedBaseline: '2.31, not executed' },
  reviewStatus: 'selection-failed', remaining: ['E3b2', 'B2', 'C2b', 'D', 'E2b3', 'E3c', 'F', 'M18', 'MH-L8'] }, null, 2) + '\n');
console.log(`E3b: ${files.length} identical source files, ${compiled.length} compiled; 148 targeted tests + 37 killed/restored pairs per Node 22/24; two actual npm payloads reproduced; builtin-only launcher/loader reproduced; zero skips/leftovers; no publication or release verdict.`);
