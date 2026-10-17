import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const worktree = resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = fs.realpathSync(process.argv[2]);
assert.ok(source.startsWith('/tmp/mh-l3-qualification-'));
const directory = 'docs/plan/mh-l6/', evidence = directory + 'evidence/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' });
assert.equal(listed.status, 0); assert.equal(listed.signal, null);
const inventory = listed.stdout.split('\0').filter(path => /\.[cm]?[jt]sx?$/.test(path));
assert.ok(inventory.includes('packages/h2a/src/runtime/local-files/succession-lock.ts'));
for (const path of inventory) assert.deepEqual(fs.readFileSync(join(source, path)), fs.readFileSync(join(worktree, path)), path);
const names = [['mh-l6-package', 5], ['mh-l6-published', 14],
  ['succession-lock-seam-guard', 5], ['mh-l6-image-policy', 16], ['mh-l6-launcher', 25],
  ['mh-l6-entry', 8], ['mh-l6-components', 23], ['package-plugin-manifest', 1],
  ['mh-l6-native-copy', 7], ['mh-l6-publish-gate', 8], ['release-script', 21], ['release-workflow-publish-order', 9]];
const paths = ['packages/h2a/src/runtime/upgrade/image-policy.js', 'packages/h2a/src/runtime/upgrade/published-payload.js', 'scripts/mh-l1-package-prototype.mjs',
  'scripts/mh-l6-test.mjs', 'scripts/mh-l6-e3b2-audit.mjs', 'scripts/mh-l6-e3b2-campaign.mjs', 'scripts/mh-l6-image-mutate.mjs',
  'scripts/mh-l6-payload-mutate.mjs', 'packages/h2a/test/mh-l6-preparation-profile.test.js',
  'packages/h2a/test/helpers/mh-l6-package-mutate.mjs', ...names.map(([name]) => 'packages/h2a/test/' + name + '.test.js')];
const files = paths.map(path => {
  const bytes = fs.readFileSync(join(worktree, path));
  assert.deepEqual(fs.readFileSync(join(source, path)), bytes, path);
  return { path, sha256: hash(bytes) };
});
function copy(path) {
  const bytes = fs.readFileSync(join(source, path));
  fs.mkdirSync(dirname(join(worktree, path)), { recursive: true }); fs.writeFileSync(join(worktree, path), bytes);
  return { path, sha256: hash(bytes) };
}
function log(path, code, count) {
  const row = copy(path), text = fs.readFileSync(join(worktree, path), 'utf8');
  const receipt = JSON.parse(text.split('\nreceipt: ').at(-1));
  assert.equal(receipt.code, code, path); assert.equal(receipt.signal, null, path);
  assert.equal(receipt.invalid, false, path); assert.deepEqual(receipt.leftovers, [], path);
  if (count !== undefined) assert.equal(receipt.tests, count, path);
  assert.doesNotMatch(text, /# (?:skipped|cancelled|todo) [1-9]/);
  return { ...row, ...receipt };
}
const profiles = [22, 24].map(major => {
  const logs = names.map(([name, count, label = 'final-E3b2a']) => log(evidence + `${name}.test.js-node${major}-${label}.log`, 0, count));
  const mutations = ['package-E3b2', 'image-E3b2a', 'payload-E3b2a'].map(group => {
    const path = directory + `mutations-${group}-node${major}.json`, row = copy(path);
    const record = JSON.parse(fs.readFileSync(join(worktree, path)));
    assert.equal(record.results.length, group === 'package-E3b2' ? 7 : group === 'image-E3b2a' ? 11 : 26);
    for (const file of record.files) {
      if (file.privateFixture) assert.equal(file.path, '.git/index');
      assert.equal(hash(fs.readFileSync(join(source, file.path))), file.sha256, file.path);
      if (file.mode !== undefined) assert.equal(fs.statSync(join(source, file.path)).mode & 0o777, file.mode, file.path);
      if (!file.privateFixture && !file.path.includes('/dist/')) assert.equal(hash(fs.readFileSync(join(worktree, file.path))), file.sha256, file.path);
    }
    const pairs = record.results.map(pair => {
      assert.equal(pair.restored, true);
      const red = log(pair.red, 1), green = log(pair.green, 0); assert.equal(red.tests, green.tests);
      const output = fs.readFileSync(join(worktree, pair.red), 'utf8'); assert.match(output, /ERR_ASSERTION/);
      if (pair.name === 'distributed-seam') assert.match(output, /h2a-seam-pack-[^/\n]+\/package\/dist\/runtime\/local-files\/[^\n]+\.mjs/);
      if (pair.name === 'nonempty-source-inventory') assert.match(output, /the source inventory must include the real lock implementation/);
      return { name: pair.name, red, green };
    });
    return { ...row, ...record, pairs };
  });
  const packaging = fs.readFileSync(join(source, logs[0].path), 'utf8');
  assert.equal((packaging.match(/scripts-enabled positive control/g) ?? []).length, 4);
  assert.match(packaging, /actual published 0\.98\.5: stageInstall/);
  assert.match(packaging, /actual published 0\.98\.6: stageInstall/);
  assert.equal((packaging.match(/actual installed corrected MCP transport/g) ?? []).length, 2);
  assert.equal((packaging.match(/fixture control: incompatible linux\/x64 package rejected with EBADPLATFORM/g) ?? []).length, 2);
  assert.equal((packaging.match(/no foreign runtime executed/g) ?? []).length, 4);
  const images = packaging.split('\n').filter(line => line.startsWith('# same actual npm tar => managed SDK and PTY ')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.equal(images.length, major === 22 ? 4 : 2);
  for (const image of images) { assert.equal(image.native, true); assert.equal(image.sdk, 531); assert.ok(image.prepareMs >= 0); assert.ok(image.sdkMs >= 0); }
  const buildPath = evidence + `build-E3b2a-node${major}.json`, build = JSON.parse(fs.readFileSync(join(source, buildPath)));
  assert.equal(build.code, 0); assert.equal(build.signal, null); assert.equal(build.stdout, ''); assert.equal(build.stderr, ''); copy(buildPath);
  return { major, logs, tests: logs.reduce((n, row) => n + row.tests, 0), mutationPairs: 44, mutations, images, build };
});
assert.equal(profiles[0].images[1].manifest, profiles[1].images[0].manifest);
assert.equal(profiles[0].images[3].manifest, profiles[1].images[1].manifest);
const regressions = [22, 24].flatMap(major => [['mh-l6-published', 'E3b2-libc-red', 1],
  ['mh-l6-package', 'E3b2-plugin-version-red', 1], ['mh-l6-package', 'E3b2-required-profile-red', 1],
  ['succession-lock-seam-guard', 'E3b2-inventory-red', 5], ['succession-lock-seam-guard', 'E3b2-seam-initial-red', 5]
].map(([name, label, count]) => log(evidence + `${name}.test.js-node${major}-${label}.log`, 1, count)));
const failedCampaigns = [22, 24].map(major => log(evidence + `mh-l6-package.test.js-node${major}-E3b2-package-first-green.log`, 1, 5));
failedCampaigns.push(log(evidence + 'mh-l6-package.test.js-node24-E3b2-serial.log', 1, 5));
failedCampaigns.push(log(evidence + 'mh-l6-published.test.js-node22-E3b2a-payload-independent-image-links-raw-error-diagnostic.log', 1, 1));
const diagnostics = ['E3b2-preparation-cost', 'E3b2-preparation-async'].map(label => log(evidence + `mh-l6-preparation-profile.test.js-node24-${label}.log`, 0, 1));
const compiled = ['image-policy', 'published-payload'].map(name => { const path = `packages/h2a/dist/runtime/upgrade/${name}.js`; return { path, sha256: hash(fs.readFileSync(join(source, path))) }; });
const temporary = fs.mkdtempSync('/tmp/mh-l6-tool-versions-');
let toolVersions;
try {
  const env = { LANG: 'C.UTF-8' };
  for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
    env[key] = join(temporary, key); fs.mkdirSync(env[key], { mode: 0o700 });
  }
  for (const key of ['npm_config_userconfig', 'npm_config_globalconfig']) { env[key] = join(temporary, key); fs.writeFileSync(env[key], ''); }
  env.npm_config_cache = join(temporary, 'cache');
  toolVersions = [
    { major: 22, path: '/usr/local/bin:/usr/bin:/bin' },
    { major: 24, path: '/tmp/mh-l5-artifacts-shD7Sf/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin' }
  ].map(profile => {
    const result = spawnSync('npm', ['--version'], { cwd: temporary, env: { ...env, PATH: profile.path }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr, '');
    return { nodeMajor: profile.major, command: ['npm', '--version'], PATH: profile.path, stdout: result.stdout, code: result.status };
  });
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
fs.writeFileSync(join(worktree, directory + 'proof-E3b2a.json'), JSON.stringify({ baseCommit: '64cb946d0badc66de661c0010a04be13b7534651', source,
  files, sourceInventoryCount: inventory.length, compiled, profiles, regressions, failedCampaigns, diagnostics, toolVersions, rejectedAsyncExperiment: copy(evidence + 'rejected-async-preparation.json'),
  runtimeQualification: 'Linux x64 glibc 2.43 only; 2.31 baseline targeted, not executed',
  foreignProfileQualification: 'npm required-package eligibility fixture with EBADPLATFORM positive control; no macOS or Windows runtime executed',
  reviewStatus: 'selection-failed', releaseQualified: false,
  remaining: ['E3b2b smoke/backfills/final version', 'B2', 'C2b', 'D', 'E2b3', 'E3c', 'F', 'M18', 'MH-L8'] }, null, 2) + '\n');
console.log(`E3b2a: ${files.length} identical sources; ${profiles[0].tests} targeted tests and 44 assertion-red/restored-green pairs per Node 22/24; zero skips/leftovers; foreign hardware and release not qualified.`);
