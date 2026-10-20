import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Lab, json, readJson } from './support.mjs';
import { registry } from './registry.mjs';
import { guardScenarios } from './guards.mjs';
import { nativeScenarios } from './native.mjs';

const config = readJson(process.argv[2]);
const lab = new Lab(config);
const phase = process.argv[3];
const packages = ['h2a', 'h2a-runtime', 'h2a-cli', 'track', 'focus'];
let server;
let results = [];
async function setup() {
  symlinkSync('/lab-tools/npm.mjs', join(lab.root, 'bin/npm'));
  if (lab.mode === 'source') {
    console.log(`Building candidate ${lab.sha}`);
    await lab.run('/usr/bin/npm', ['ci', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund'], { cwd: lab.source, timeout: 300000, label: 'build-install' });
    // npm 9 tries to chmod workspace bins before their first build. Link only the
    // external build tool, leaving unbuilt workspace bin targets alone.
    for (const dir of [lab.source, join(lab.source, 'packages/track')]) {
      const require = createRequire(join(dir, 'package.json'));
      const tsc = join(require.resolve('typescript/package.json'), '../bin/tsc');
      mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
      symlinkSync(tsc, join(dir, 'node_modules/.bin/tsc'));
    }
    await lab.run('/usr/bin/npm', ['run', 'build'], { cwd: lab.source, timeout: 300000, label: 'build' });
    mkdirSync(join(lab.root, 'tarballs'));
    for (const pkg of packages) await lab.run('/usr/bin/npm', ['pack', '--ignore-scripts=false', '--workspace', `@sentropic/${pkg}`, '--pack-destination', join(lab.root, 'tarballs')], { cwd: lab.source });
  } else if (lab.mode === 'rc') {
    mkdirSync(join(lab.root, 'tarballs'));
    for (const pkg of packages.slice(0, 4)) await lab.run('/usr/bin/npm', ['pack', `@sentropic/${pkg}@${lab.rc}`, '--pack-destination', join(lab.root, 'tarballs')]);
    const coreFile = readdirSync(join(lab.root, 'tarballs')).find(f => f.startsWith('sentropic-h2a-') && !f.startsWith('sentropic-h2a-runtime-') && !f.startsWith('sentropic-h2a-cli-'));
    const m = JSON.parse((await lab.run('tar', ['-xOf', join(lab.root, 'tarballs', coreFile), 'package/package.json'])).stdout);
    await lab.run('/usr/bin/npm', ['pack', `@sentropic/focus@${m.dependencies['@sentropic/focus']}`, '--pack-destination', join(lab.root, 'tarballs')]);
  }
  const manifests = [];
  for (const file of readdirSync(join(lab.root, 'tarballs')).filter(f => f.endsWith('.tgz'))) {
    const path = join(lab.root, 'tarballs', file);
    const manifest = JSON.parse((await lab.run('tar', ['-xOf', path, 'package/package.json'])).stdout);
    manifests.push({ file, manifest, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), upgrade: false });
  }
  for (const name of packages) assert.equal(manifests.filter(m => m.manifest.name === `@sentropic/${name}`).length, 1, `Exactly one @sentropic/${name} tarball required`);
  const core = manifests.find(m => m.manifest.name === '@sentropic/h2a');
  for (const name of packages.slice(1, 4)) assert.equal(manifests.find(m => m.manifest.name === `@sentropic/${name}`).manifest.version, core.manifest.version, 'Lockstep mismatch');
  cpSync(join(lab.root, 'tarballs'), join(lab.evidence, 'artifacts'), { recursive: true });
  // A future release fixture changes ONLY package.json.version. The upgrade code under test
  // is the unmodified candidate, and performs its real fetch/stage/probe/swap against this fixture.
  const future = join(lab.root, 'future'); mkdirSync(future);
  await lab.run('tar', ['-xf', join(lab.root, 'tarballs', core.file), '-C', future]);
  const futureManifest = { ...core.manifest, version: '9999.0.0' };
  assert.notEqual(core.manifest.version, futureManifest.version);
  json(join(future, 'package/package.json'), futureManifest);
  const futureFile = 'owner-lab-upgrade-fixture.tgz';
  await lab.run('tar', ['-czf', join(lab.root, 'tarballs', futureFile), '-C', future, 'package']);
  manifests.push({ file: futureFile, manifest: futureManifest, upgrade: true,
    sha256: createHash('sha256').update(readFileSync(join(lab.root, 'tarballs', futureFile))).digest('hex') });
  json(join(lab.root, 'manifests.json'), manifests);
  json(join(lab.evidence, 'candidate.json'), { sha: lab.sha, ref: lab.ref, mode: lab.mode, node: process.version, manifests });
  server = await registry(lab, manifests);
  console.log(`Installing isolated candidate ${core.manifest.version}`);
  await lab.run('npm', ['install', '-g', '--prefix', lab.prefix, join(lab.root, 'tarballs', core.file)], { timeout: 300000, label: 'candidate-install' });
  // The old host is optional via --previous; its runtime is still an actual published artifact.
  await lab.run('npm', ['install', '--prefix', join(lab.root, 'previous'), `@sentropic/h2a-runtime@${lab.previous}`], { env: { ...lab.env, npm_config_registry: 'https://registry.npmjs.org' }, timeout: 300000, label: 'previous-install' });
  json(join(lab.root, 'remote/.config/sentropic/remote-cli/config.json'), { h2a: { enabled: true, central: { enabled: false } }, llmMesh: { enabled: false }, layout: { multiSessionDefault: 0 } });
  // Prewarm the exact self-contained staging topology while network access exists.
  const stage = join(lab.root, 'prewarm');
  await lab.run('npm', ['install', '-g', '--prefix', stage, join(lab.root, 'tarballs', futureFile)], { timeout: 300000, label: 'upgrade-prewarm' });
}
try {
  if (phase === 'setup') await setup();
  else {
    assert.equal(phase, 'scenarios');
    const manifests = readJson(join(lab.root, 'manifests.json'));
    server = await registry(lab, manifests, { offline: true, upgrade: true });
    lab.core = join(lab.prefix, 'lib/node_modules/@sentropic/h2a');
    const require = createRequire(join(lab.core, 'package.json'));
    lab.runtime = join(require.resolve('@sentropic/h2a-runtime/package.json'), '..');
    for (const name of ['h2a-runtime', 'track', 'focus']) {
      const path = require.resolve(`@sentropic/${name}/package.json`);
      assert.ok(path.startsWith(lab.prefix + '/'), `Dependency escaped prefix: ${path}`);
      assert.equal(readJson(path).version, manifests.find(m => m.manifest.name === `@sentropic/${name}`).manifest.version);
    }
    async function scenario(id, name, action) {
      if (lab.only && !lab.only.includes(id)) {
        results.push({ id, name, verdict: 'FAIL', error: 'Not selected for this diagnostic run; no qualification evidence' });
        return;
      }
      console.log(`Running ${id}: ${name}`);
      const before = Date.now();
      try { const detail = await action(); results.push({ id, name, verdict: 'PASS', detail, durationMs: Date.now() - before }); }
      catch (error) { results.push({ id, name, verdict: 'FAIL', error: error.message, stack: error.stack, durationMs: Date.now() - before }); }
      json(join(lab.evidence, 'verdicts.json'), results);
    }
    await guardScenarios(lab, scenario);
    // A private, otherwise empty legacy server makes its inventory positively
    // known. The native attach resolver refuses UNKNOWN legacy inventories.
    await lab.run('/usr/bin/tmux', ['-f', '/dev/null', 'new-session', '-d', '-s', 'owner-lab-sentinel', process.execPath, '-e', 'setInterval(() => {}, 1000)'], { label: 'private-tmux-start' });
    try { await nativeScenarios(lab, scenario); }
    finally { await lab.run('/usr/bin/tmux', ['kill-server'], { check: false, label: 'private-tmux-stop' }); }
    assert.equal(results.length, 7);
    const table = ['| # | Owner workflow | Verdict | Evidence |', '|---|---|---|---|', ...results.map(r => `| ${r.id} | ${r.name} | ${r.verdict} | ${r.verdict === 'PASS' ? r.detail : r.error.replaceAll('|', '/').replaceAll('\n', ' ').slice(0, 500)} |`)].join('\n');
    console.log(table); writeFileSync(join(lab.evidence, 'verdicts.md'), table + '\n');
    process.exitCode = results.every(r => r.verdict === 'PASS') ? 0 : 1;
  }
} catch (error) {
  console.error(error.stack); json(join(lab.evidence, `${phase}-error.json`), { error: error.message, stack: error.stack });
  process.exitCode = 1;
} finally { await lab.close(); await server?.close(); }
