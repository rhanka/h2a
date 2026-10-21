// Run only in the disposable CI checkout, after build, before the green lab.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.ok(process.env.TMPDIR);
const runtime = resolve('packages/h2a-runtime/dist');
function red(name, entry, pattern, mutate, expected) {
  const original = readFileSync(entry, 'utf8');
  const changed = mutate(original);
  assert.notEqual(changed, original, `${name}: mutation did not apply`);
  try {
    writeFileSync(entry, changed);
    const args = ['--test', ...(pattern ? ['--test-name-pattern=' + pattern] : []),
      name === 'worker-scope' ? 'scripts/owner-lab/isolation.qualification.mjs' : 'packages/h2a/test/native-host-crash-recovery.test.js'];
    const result = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.error, undefined, `${name}: infrastructure error`);
    assert.notEqual(result.status, 0, `${name}: regression escaped its release gate`);
    assert.match(result.stdout + result.stderr, expected, `${name}: failed for the wrong reason`);
    console.log(`${name}: RED detected (exit ${result.status}); artifact restored`);
  } finally { writeFileSync(entry, original); }
}
red('conversation-filter', join(runtime, 'conv-guard.js'), 'real run --resume',
  code => code.replace('for (const e of read.entries) {', 'for (const e of read.entries.filter(e => isLive(e, opts))) {'),
  /Readiness did not converge.*h2a-old-0/);
red('publication-contention', join(runtime, 'native-terminal/server.js'), 'ten concurrent read-only absence',
  code => code.replace('socketPresent && !provenDeadOwner ? 5 : 1', 'socketPresent ? 5 : 1'),
  /publication lock timed out/);
red('worker-scope', join(runtime, 'native-terminal/process.js'), undefined,
  code => code.replace('spawner: isolation.isolated ?', 'spawner: false ?'),
  /h2a-native-/);
