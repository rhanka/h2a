import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, ORACLE_SOURCES } from './xcli-lab.mjs';
import { installNpmOracles } from './xcli-npm-oracles.mjs';

test('native npm oracles remain mandatory when npm omits optional packages', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-oracle-test-'));
  try {
    const env = environment(join(root, 'env'));
    fs.writeFileSync(join(env.HOME, '.npmrc'), 'omit=optional\n');
    const installed = installNpmOracles(root);
    assert.equal(installed.env.HOME, env.HOME);
    for (const [family, source] of installed.npmFamilies) {
      const probe = spawnSync(join(installed.bin, source.bin), ['--version'], {
        cwd: root, env, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(probe.status, 0, `${family}: ${probe.stderr}`);
      assert.equal(probe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0], ORACLE_SOURCES[family].pin);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
