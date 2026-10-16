#!/usr/bin/env node
// Run named product suites from a fresh source build, never checkout/installed dist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceBuild, environment, repo } from './xcli-lab.mjs';

const files = process.argv.slice(2);
assert.ok(files.length, 'explicit test files required');
for (const file of files) assert.match(file, /^packages\/h2a\/test\/[a-z0-9-]+\.test\.js$/);
const root = fs.mkdtempSync('/tmp/h2a-qual-');
const built = sourceBuild(root);
fs.cpSync(join(repo, 'packages/h2a/test'), join(built.path, 'packages/h2a/test'), { recursive: true });
const env = { ...environment(join(root, 'runner')), H2A_TEST_QUALIFICATION_ROOT: root };
const args = ['--import', join(built.path, 'packages/h2a/test/helpers/native-isolation.js'),
  '--test', '--test-reporter=tap', '--test-concurrency=1', ...files];
const result = spawnSync(process.execPath, args, { cwd: built.path, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const output = (result.stdout ?? '') + (result.stderr ?? '');
fs.writeFileSync(join(root, 'tests.tap'), output);
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key =>
  [key, Number([...output.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].at(-1)?.[1] ?? -1)]));
fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify({ command: ['node', ...args], counts,
  exitCode: result.status, sourceBuild: built }, null, 2) + '\n');
process.stdout.write(output + `Evidence: ${root}\n`);
process.exitCode = result.status === 0 && counts.tests > 0 && counts.skipped === 0 && counts.todo === 0 && counts.cancelled === 0 ? 0 : 1;
