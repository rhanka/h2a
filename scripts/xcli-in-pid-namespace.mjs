#!/usr/bin/env node
// CI-only boundary for old producers whose procfs readers predate test roots.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { repo, resolveNodeHeaders } from './xcli-lab.mjs';
import { ensureHistoricalGitRef, LEGACY_HOST_REF } from './historical-test-ref.mjs';

// Lot L2 gate mode: confine the pinned npm-test h2a-runtime suites to the
// private PID namespace. Closed policy — only the pinned runtime config,
// plus optional trailing suite-file filters. Anything else is refused.
// The gate's execution proof keeps working across the boundary: the
// H2A_TEST_REPORT_PATH the gate runner exports is forwarded into the
// namespace, so the pinned config writes its JSON report where the runner
// verifies it. Off Linux this mode executes the pinned command directly
// (the guarded fixture skips by platform there); on Linux the namespace is
// mandatory and direct execution is never a fallback.
const PINNED_RUNTIME_CONFIG = 'packages/h2a-runtime/vitest.config.ts';
if (process.argv[2] === '--gate') {
  const config = process.argv[3];
  assert.equal(config, PINNED_RUNTIME_CONFIG, 'gate mode only serves the pinned runtime config');
  const filters = process.argv.slice(4);
  for (const file of filters) {
    assert.match(file, /^packages\/h2a-runtime\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.ts$/,
      `gate mode only accepts runtime suite files, refusing: ${file}`);
    assert.ok(!file.includes('..') && existsSync(resolve(repo, file)), `gate mode refuses unknown suite file: ${file}`);
  }
  const vitestArgs = ['run', '--config', config, ...filters];
  if (process.platform !== 'linux') {
    const direct = spawnSync(resolve(repo, 'node_modules/.bin/vitest'), vitestArgs,
      { cwd: repo, stdio: 'inherit', env: process.env });
    process.exitCode = direct.status ?? 1;
  } else {
    const root = mkdtempSync('/tmp/xcli-pid-init-');
    const init = join(root, 'init');
    const compiled = spawnSync('/usr/bin/g++', ['-std=c++17', '-O2', resolve(repo, 'scripts/xcli-pid-init.cc'), '-o', init], { stdio: 'inherit' });
    assert.equal(compiled.status, 0, 'private PID namespace init must compile');
    const child = spawn('/usr/bin/sudo', ['-n', '/usr/bin/env',
      `XCLI_PARENT_PID_NS=${readlinkSync('/proc/self/ns/pid')}`,
      `XCLI_NODE_HEADERS=${resolveNodeHeaders()}`,
      ...(process.env.H2A_TEST_REPORT_PATH ? [`H2A_TEST_REPORT_PATH=${process.env.H2A_TEST_REPORT_PATH}`] : []),
      ...(process.env.XCLI_SOURCE_TMP_PARENT ? [`XCLI_SOURCE_TMP_PARENT=${process.env.XCLI_SOURCE_TMP_PARENT}`] : []),
      `PATH=${process.env.PATH ?? '/usr/bin:/bin'}`,
      'GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', `GIT_CONFIG_VALUE_0=${repo}`,
      '/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc',
      init, process.execPath, resolve(repo, 'node_modules/vitest/vitest.mjs'), ...vitestArgs], { stdio: 'inherit' });
    child.once('error', () => { process.exitCode = 1; });
    child.once('close', code => { rmSync(root, { recursive: true, force: true }); process.exitCode = code ?? 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  }
} else {
  const target = process.argv[2];
  assert.ok(['scripts/xcli-runtime-tests.mjs', 'scripts/xcli-source-tests.mjs'].includes(target));
  const args = process.argv.slice(3);
  if (args.includes('packages/h2a/test/native-inventory-absence.test.js')) ensureHistoricalGitRef(repo, LEGACY_HOST_REF);
  const root = mkdtempSync('/tmp/xcli-pid-init-');
  const evidence = mkdtempSync('/tmp/xcli-evidence-');
  const init = join(root, 'init');
  const compiled = spawnSync('/usr/bin/g++', ['-std=c++17', '-O2', resolve(repo, 'scripts/xcli-pid-init.cc'), '-o', init], { stdio: 'inherit' });
  assert.equal(compiled.status, 0, 'private PID namespace init must compile');
  const child = spawn('/usr/bin/sudo', ['-n', '/usr/bin/env',
    `XCLI_PARENT_PID_NS=${readlinkSync('/proc/self/ns/pid')}`,
    `XCLI_NODE_HEADERS=${resolveNodeHeaders()}`,
    `XCLI_EVIDENCE_EXPORT_DIR=${evidence}`,
    ...(process.env.XCLI_SOURCE_TMP_PARENT ? [`XCLI_SOURCE_TMP_PARENT=${process.env.XCLI_SOURCE_TMP_PARENT}`] : []),
    `PATH=${process.env.PATH ?? '/usr/bin:/bin'}`,
    'GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', `GIT_CONFIG_VALUE_0=${repo}`,
    '/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc',
    init, process.execPath, resolve(repo, target), ...args], { stdio: 'inherit' });
  child.once('error', () => { process.exitCode = 1; });
  child.once('close', code => { rmSync(root, { recursive: true, force: true }); process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
}
