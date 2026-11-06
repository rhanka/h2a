import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repo, removeCampaignRoot, compliantQualificationRoot } from './xcli-lab.mjs';

test('runtime upgrade qualification builds the checkout candidate before running the installed-artifact test', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-upgrade-preparation-'));
  const inheritedRoot = process.env.XCLI_RUNNER_TEST_ROOT;
  const campaignRoot = compliantQualificationRoot(inheritedRoot ?? null);
  const preload = join(root, 'preparation.mjs');
  try {
    fs.writeFileSync(preload, `
      import assert from 'node:assert/strict';
      import cp from 'node:child_process';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const spawn = cp.spawnSync;
      let built = false;
      cp.spawnSync = (command, args, options) => {
        if (args?.includes('build') && args.includes('run')) {
          assert.equal(options.cwd, ${JSON.stringify(repo)});
          built = true;
          return { status: 0, stdout: '', stderr: '' };
        }
        if (!args?.some(arg => arg.endsWith('/vitest/vitest.mjs'))) return spawn(command, args, options);
        assert.equal(built, true, 'the release candidate must be freshly compiled');
        assert.equal(options.env.H2A_TEST_UPGRADE_WORKSPACE, ${JSON.stringify(join(repo, 'packages/h2a-runtime'))});
        const report = args.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
        fs.writeFileSync(report, JSON.stringify({ numTotalTests: 1, numPassedTests: 1,
          numFailedTests: 0, numPendingTests: 0, testResults: [] }));
        return { status: 0, stdout: '', stderr: '' };
      };
      syncBuiltinESMExports();
    `);
    const out = spawnSync(process.execPath, ['--import', preload, join(repo, 'scripts/xcli-runtime-tests.mjs'),
      '--campaign-root', campaignRoot, 'packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts'], {
      cwd: repo, env: process.env, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (!inheritedRoot) removeCampaignRoot(campaignRoot);
  }
});

test('runtime runner exposes suite preparation failures even with zero failed assertions', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-runner-test-'));
  const inheritedRoot = process.env.XCLI_RUNNER_TEST_ROOT;
  const campaignRoot = compliantQualificationRoot(inheritedRoot ?? null);
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
      '--campaign-root', campaignRoot, 'packages/h2a-runtime/src/agents-projection.test.ts'], {
      cwd: repo, env: { ...process.env, TMPDIR: root }, encoding: 'utf8', timeout: 120000,
    });
    // The subprocess reports its admitted root, including when the caller
    // supplied one to keep the entire test run inside one disk budget.
    for (const line of String(out.stdout ?? '').split('\n')) {
      try {
        const summary = JSON.parse(line);
        if (summary && typeof summary.evidence === 'string') evidence = summary.evidence;
      } catch { /* non-JSON log lines carry no root */ }
    }
    assert.ok(evidence, 'the runtime suite reports its evidence root');
    assert.equal(evidence, campaignRoot);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /beforeAll: PREPARATION_FAILURE_CANARY/);
    assert.match(out.stderr, /fixture preparation failed/);
    assert.match(out.stdout, /"failed":0/);
    assert.match(out.stdout, /"exitCode":1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    // removeCampaignRoot admits only the qualification base and removes the
    // exact reported root, including on assertion failure above.
    if (!inheritedRoot) removeCampaignRoot(campaignRoot);
  }
  assert.equal(fs.existsSync(root), false, 'the calling test removes its own root');
  if (evidence && !inheritedRoot) assert.equal(fs.existsSync(evidence), false, 'the subprocess evidence root leaves no residue');
});
