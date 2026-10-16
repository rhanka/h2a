#!/usr/bin/env node
// Install only parser oracles in a private prefix. No login or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { environment } from './xcli-lab.mjs';

assert.equal(process.platform, 'linux');
const root = fs.mkdtempSync('/tmp/xcli-oracles-');
const env = environment(join(root, 'env'));
const location = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' });
assert.equal(location.status, 0);
const npm = fs.realpathSync(location.stdout.trim());
const packages = ['@openai/codex@0.162.1', '@anthropic-ai/claude-code@2.1.301'];
const install = spawnSync(process.execPath, [npm, 'install', '--prefix', root, '--ignore-scripts',
  '--no-audit', '--no-fund', ...packages], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(install.status, 0, 'private oracle installation must succeed');

// The reviewed Claude 2.1.301 bootstrap only places its already downloaded
// optional native package under this node_modules tree (no subprocess on Linux).
// Keep every other npm lifecycle script disabled, including node-gyp/Python.
const bootstrap = join(root, 'node_modules/@anthropic-ai/claude-code/install.cjs');
assert.equal(createHash('sha256').update(fs.readFileSync(bootstrap)).digest('hex'),
  '32a7b2429d7447c5aa043e383bcf9a72e0b233dff66336ea4b5b32531da981ad', 'only the reviewed Node bootstrap may execute');
const prepared = spawnSync(process.execPath, [bootstrap], { cwd: root, env, encoding: 'utf8', maxBuffer: 65536 });
assert.equal(prepared.status, 0, 'private Claude native bootstrap must succeed');
const bin = join(root, 'node_modules/.bin');
for (const [cli, version] of [['codex', '0.162.1'], ['claude', '2.1.301']]) {
  const probe = spawnSync(join(bin, cli), ['--version'], { env, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  assert.equal(probe.status, 0, `${cli} native executable must exist before config tests`);
  assert.equal(probe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0], version);
}
if (process.env.GITHUB_PATH) fs.appendFileSync(process.env.GITHUB_PATH, bin + '\n');
console.log(JSON.stringify({ bin, versions: { codex: '0.162.1', claude: '2.1.301' }, installScripts: false, reviewedNodeBootstrap: true }));
