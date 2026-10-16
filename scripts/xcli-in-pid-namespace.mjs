#!/usr/bin/env node
// CI-only boundary for old producers whose procfs readers predate test roots.
import assert from 'node:assert/strict';
import { readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { repo } from './xcli-lab.mjs';
import { ensureHistoricalGitRef, LEGACY_HOST_REF } from './historical-test-ref.mjs';

const target = process.argv[2];
assert.ok(['scripts/xcli-runtime-tests.mjs', 'scripts/xcli-source-tests.mjs'].includes(target));
const args = process.argv.slice(3);
if (args.includes('packages/h2a/test/native-inventory-absence.test.js')) ensureHistoricalGitRef(repo, LEGACY_HOST_REF);
const child = spawn('/usr/bin/sudo', ['-n', '/usr/bin/env',
  `XCLI_PARENT_PID_NS=${readlinkSync('/proc/self/ns/pid')}`,
  `XCLI_NODE_HEADERS=${process.env.XCLI_NODE_HEADERS ?? '/usr/include/node'}`,
  `PATH=${process.env.PATH ?? '/usr/bin:/bin'}`,
  'GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', `GIT_CONFIG_VALUE_0=${repo}`,
  '/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc',
  process.execPath, resolve(repo, target), ...args], { stdio: 'inherit' });
child.once('error', () => { process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
