import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repo } from './xcli-lab.mjs';

test('runtime runner exposes suite preparation failures even with zero failed assertions', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-runner-test-'));
  try {
    const preload = join(root, 'vitest-failure.mjs');
    fs.writeFileSync(preload, `
      import cp from 'node:child_process';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const spawn = cp.spawnSync;
      cp.spawnSync = (command, args, options) => {
        if (!args?.some(arg => arg.endsWith('/vitest/vitest.mjs'))) return spawn(command, args, options);
        const report = args.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
        fs.writeFileSync(report, JSON.stringify({ numTotalTests: 3, numPassedTests: 0,
          numFailedTests: 0, numPendingTests: 3, testResults: [] }));
        return { status: 1, stdout: 'beforeAll: PREPARATION_FAILURE_CANARY\\n', stderr: 'fixture preparation failed\\n' };
      };
      syncBuiltinESMExports();
    `);
    const out = spawnSync(process.execPath, ['--import', preload, join(repo, 'scripts/xcli-runtime-tests.mjs'),
      'packages/h2a-runtime/src/agents-projection.test.ts'], {
      cwd: repo, env: { ...process.env, TMPDIR: root }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /beforeAll: PREPARATION_FAILURE_CANARY/);
    assert.match(out.stderr, /fixture preparation failed/);
    assert.match(out.stdout, /"failed":0/);
    assert.match(out.stdout, /"exitCode":1/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
