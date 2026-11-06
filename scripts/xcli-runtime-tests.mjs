#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, sourceBuild, environment, compliantQualificationRoot } from './xcli-lab.mjs';
import { exportEvidence } from './xcli-export-evidence.mjs';

const requested = process.argv.slice(2);
const rootIndex = requested.indexOf('--campaign-root');
const requestedRoot = rootIndex < 0 ? null : requested.splice(rootIndex, 2)[1];
const root = compliantQualificationRoot(requestedRoot);
const built = sourceBuild(root);
for (const pkg of ['h2a-runtime', 'h2a', 'track', 'remote-protocol']) {
  fs.cpSync(join(repo, 'packages', pkg, 'src'), join(built.path, 'packages', pkg, 'src'), { recursive: true });
}
fs.copyFileSync(join(repo, 'vitest.config.mjs'), join(built.path, 'vitest.config.mjs'));
fs.copyFileSync(join(repo, 'packages/h2a-runtime/vitest.native-isolation.mjs'), join(built.path, 'packages/h2a-runtime/vitest.native-isolation.mjs'));
fs.copyFileSync(join(repo, 'package.json'), join(built.path, 'package.json'));
fs.cpSync(join(repo, 'packages/h2a-runtime/test'), join(built.path, 'packages/h2a-runtime/test'), { recursive: true });
fs.cpSync(join(repo, 'scripts'), join(built.path, 'scripts'), { recursive: true });
const files = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith('.test.ts') && /["'](?:\.\.?\/)+(?:registry|delegate|h2a-jobs|index|restore|op)\.js["']/.test(fs.readFileSync(path, 'utf8'))) {
      files.push(path.slice(repo.length + 1));
    } else if (path.endsWith('/native-terminal/terminal-modes.functional.test.ts')) {
      files.push(path.slice(repo.length + 1));
    }
  }
}
visit(join(repo, 'packages/h2a-runtime/src'));
assert.ok(files.length > 0);
const report = join(root, 'vitest.json');
const npmLocation = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' });
assert.equal(npmLocation.status, 0, 'npm build toolchain must be available');
const env = { ...environment(join(root, 'runner')), H2A_TEST_QUALIFICATION_ROOT: root,
  npm_config_ignore_scripts: 'true',
  npm_execpath: fs.realpathSync(npmLocation.stdout.trim()),
  ...(process.env.XCLI_PARENT_PID_NS ? { XCLI_PARENT_PID_NS: process.env.XCLI_PARENT_PID_NS } : {}),
  ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
const selected = requested.length ? files.filter(file => requested.includes(file)) : files;
assert.equal(selected.length, requested.length || files.length, 'unknown requested runtime test file');
if (selected.includes('packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts')) {
  // Closed release packaging requires the checkout's Git identity, shipped
  // assets and internal dependency closure. The thin source build deliberately
  // links external dependencies and cannot serve as a closed release source.
  // Compile this checkout first; the upgrade test still installs its candidate
  // tarballs into private prefixes and never executes an installed owner CLI.
  const prepared = spawnSync(process.execPath, [fs.realpathSync(npmLocation.stdout.trim()), 'run', 'build'], {
    cwd: repo, env: { ...environment(join(root, 'candidate-build')), npm_config_ignore_scripts: 'true' },
    encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(prepared.status, 0, `checkout candidate build failed: ${prepared.stdout ?? ''}${prepared.stderr ?? ''}`);
  env.H2A_TEST_UPGRADE_WORKSPACE = join(repo, 'packages/h2a-runtime');
}
const args = [join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=1',
  '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile=${report}`, ...selected];
const result = spawnSync(process.execPath, args, { cwd: built.path, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
let unexpectedNonTest = false;
fs.writeFileSync(join(root, 'runner.log'), (result.stdout ?? '') + (result.stderr ?? ''));
// Vitest reports beforeAll/collection failures at suite level, even when
// numFailedTests is zero. Keep that cause visible in the job log.
if (result.status !== 0) process.stderr.write((result.stdout ?? '') + (result.stderr ?? ''));
if (fs.existsSync(report)) {
  const json = JSON.parse(fs.readFileSync(report, 'utf8'));
  const declared = JSON.parse(fs.readFileSync(join(repo, 'scripts/test-non-tests-0986.json'), 'utf8')).entries;
  const summary = { files: selected, tests: json.numTotalTests, passed: json.numPassedTests, failed: json.numFailedTests,
    pending: json.numPendingTests, evidence: root, exitCode: result.status };
  fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(summary, null, 2) + '\n');
  exportEvidence(root, ['receipt.json']);
  console.log(JSON.stringify(summary));
  for (const suite of json.testResults) {
    for (const assertion of suite.assertionResults) if (assertion.status !== 'passed') {
      if (assertion.status !== 'failed' && !declared.some(entry =>
        suite.name.endsWith('/' + entry.file) && entry.fullName === assertion.fullName && entry.status === assertion.status)) unexpectedNonTest = true;
      console.log(JSON.stringify({ suite: suite.name, name: assertion.fullName, status: assertion.status, failures: assertion.failureMessages }));
    }
  }
} else console.log(JSON.stringify({ exitCode: result.status, evidence: root, reportMissing: true }));
process.exitCode = unexpectedNonTest ? 1 : result.status ?? 1;
