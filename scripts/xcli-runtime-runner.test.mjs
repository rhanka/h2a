import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repo, removeCampaignRoot } from './xcli-lab.mjs';

test('runtime runner exposes suite preparation failures even with zero failed assertions', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-runner-test-'));
  let evidence = null;
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
    // The subprocess mints its own admitted sibling root outside TMPDIR and
    // reports it in its JSON summary. Recover that exact root — never sweep.
    for (const line of String(out.stdout ?? '').split('\n')) {
      try {
        const summary = JSON.parse(line);
        if (summary && typeof summary.evidence === 'string') evidence = summary.evidence;
      } catch { /* non-JSON log lines carry no root */ }
    }
    assert.ok(evidence, 'the runtime suite reports its evidence root');
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /beforeAll: PREPARATION_FAILURE_CANARY/);
    assert.match(out.stderr, /fixture preparation failed/);
    assert.match(out.stdout, /"failed":0/);
    assert.match(out.stdout, /"exitCode":1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    // removeCampaignRoot admits only the qualification base and removes the
    // exact reported root, including on assertion failure above.
    if (evidence) removeCampaignRoot(evidence);
  }
  assert.equal(fs.existsSync(root), false, 'the calling test removes its own root');
  if (evidence) assert.equal(fs.existsSync(evidence), false, 'the subprocess evidence root leaves no residue');
});
