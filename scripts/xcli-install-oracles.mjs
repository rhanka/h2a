#!/usr/bin/env node
// Install only parser oracles in a private prefix. No login or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { environment, ORACLE_SOURCES } from './xcli-lab.mjs';

assert.equal(process.platform, 'linux');
const root = fs.mkdtempSync('/tmp/xcli-oracles-');
const env = environment(join(root, 'env'));
const location = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' });
assert.equal(location.status, 0);
const npm = fs.realpathSync(location.stdout.trim());
const npmFamilies = Object.entries(ORACLE_SOURCES).filter(([, source]) => source.kind === 'npm');
const packages = npmFamilies.map(([, source]) => `${source.package}@${source.pin}`);
const install = spawnSync(process.execPath, [npm, 'install', '--prefix', root, '--ignore-scripts',
  '--no-audit', '--no-fund', ...packages], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(install.status, 0, 'private oracle installation must succeed');

// The reviewed Claude 2.1.301 bootstrap only places its already downloaded
// optional native package under this node_modules tree (no subprocess on Linux).
// Keep every other npm lifecycle script disabled, including node-gyp/Python.
const bootstrap = join(root, `node_modules/${ORACLE_SOURCES.claude.package}/install.cjs`);
assert.equal(createHash('sha256').update(fs.readFileSync(bootstrap)).digest('hex'),
  ORACLE_SOURCES.claude.bootstrapSha256, 'only the reviewed Node bootstrap may execute');
const prepared = spawnSync(process.execPath, [bootstrap], { cwd: root, env, encoding: 'utf8', maxBuffer: 65536 });
assert.equal(prepared.status, 0, 'private Claude native bootstrap must succeed');
const bin = join(root, 'node_modules/.bin');
for (const [family, source] of npmFamilies) {
  const probe = spawnSync(join(bin, source.bin), ['--version'], { env, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  assert.equal(probe.status, 0, `${family} native executable must exist before config tests`);
  assert.equal(probe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0], source.pin);
}
if (process.env.GITHUB_PATH) fs.appendFileSync(process.env.GITHUB_PATH, bin + '\n');
// Lot L7 (QO4, section 8.2): tier-C needs the real vendor vibe binary. It is
// a uv-managed Python product (no non-Python backend exists today, section
// 8.2 finding). Resolve it on PATH; install the pinned tool with uv only
// where it is absent (ephemeral CI runners — never where a seat exists, and
// never a Python toolchain we ship). No login or model calls.
const VIBE_PIN = ORACLE_SOURCES.vibe.pin;
const whichVibe = () => {
  const found = spawnSync('/usr/bin/which', ['vibe'], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : null;
};
let vibeEntry = whichVibe();
let vibeInstalledByOracle = false;
if (!vibeEntry) {
  const uv = spawnSync('/usr/bin/which', ['uv'], { encoding: 'utf8' });
  assert.equal(uv.status, 0, 'vibe oracle binary absent and uv unavailable to install it');
  const installed = spawnSync(uv.stdout.trim(), ['tool', 'install', `mistral-vibe==${VIBE_PIN}`],
    { encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024 });
  assert.equal(installed.status, 0, 'pinned vibe tool installation must succeed');
  vibeInstalledByOracle = true;
  vibeEntry = whichVibe();
  assert.ok(vibeEntry, 'installed vibe binary must be on PATH');
}
const vibeProbe = spawnSync(vibeEntry, ['--version'], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
assert.equal(vibeProbe.status, 0, 'native vibe executable must answer --version');
const vibeVersion = vibeProbe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
assert.ok(vibeVersion, 'native vibe version must parse');
if (vibeInstalledByOracle) assert.equal(vibeVersion, VIBE_PIN, 'oracle installs the pinned vibe');
// Classify the launcher as installed (unresolved: uv shims are shell wrappers
// around the tool interpreter, and the wrapper guard sees through them).
const { pythonEntrypoint } = await import('./xcli-lab.mjs');
const vibeRuntime = pythonEntrypoint(vibeEntry) ? 'python (not shipped)' : 'non-python (upstream follow-up)';
const versions = Object.fromEntries(npmFamilies.map(([family, source]) => [family, source.pin]));
console.log(JSON.stringify({ bin, versions, installScripts: false, reviewedNodeBootstrap: true,
  vibe: { path: vibeEntry, version: vibeVersion, vendorRuntime: vibeRuntime, installedByOracle: vibeInstalledByOracle },
  noInstallPath: Object.fromEntries(Object.entries(ORACLE_SOURCES)
    .filter(([, source]) => source.kind === 'none').map(([family, source]) => [family, source.reason])) }));
