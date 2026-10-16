import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { sourceBuild, environment, cliPath, privateExecutable } from './xcli-lab.mjs';

// Explicit local qualification: the real Muse parser is mandatory, no skip or
// login/model call. CI's model-free matrix keeps its own simulated Muse peer.
test('native Muse accepts product-rendered and product-written settings', async t => {
  const installed = cliPath('muse', process.env.PATH ?? '/usr/bin:/bin');
  assert.ok(installed, 'native Muse is required for this local qualification');
  const root = fs.mkdtempSync('/tmp/h2a-qual-');
  try {
    const build = sourceBuild(root);
    const programRoot = join(root, 'program');
    fs.mkdirSync(programRoot);
    const program = privateExecutable('muse', installed, programRoot);
    for (const mode of ['print', 'write']) await t.test(mode, () => {
      const cwd = join(root, mode), env = environment(cwd);
      const settings = join(env.XDG_CONFIG_HOME, 'muse/settings.json');
      fs.mkdirSync(dirname(settings), { recursive: true });
      const setup = spawnSync(process.execPath, [join(build.path, 'packages/h2a/dist/bin.js'),
        'host', 'setup', '--host', 'muse', '--root', env.H2A_ROOT,
        ...(mode === 'print' ? ['--print'] : ['--write', settings])],
      { cwd, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
      assert.equal(setup.status, 0, 'source product setup must finish');
      if (mode === 'print') fs.writeFileSync(settings, setup.stdout, { mode: 0o600 });
      const status = spawnSync(program.path, ['config', 'status'],
        { cwd, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
      assert.equal(status.status, 0, 'native Muse rejected product settings (no login or model involved)');
      assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).schema_version, 1);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
