import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, sourceBuild, repo } from './xcli-lab.mjs';

test('an already exited private CLI is blocked without falsely failing its verified cleanup', () => {
  const root = fs.mkdtempSync('/tmp/h2a-qual-');
  const built = sourceBuild(root);
  const fixture = join(root, 'exit.mjs');
  fs.writeFileSync(fixture, 'setTimeout(() => process.exit(0), 500);\n');
  const executable = join(root, 'exiting-cli');
  fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
  let worker = join(repo, 'scripts/qualify-cross-cli.mjs');
  if (process.env.XCLI_CLEANUP_BASELINE) {
    const old = spawnSync('git', ['show', `${process.env.XCLI_CLEANUP_BASELINE}:scripts/qualify-cross-cli.mjs`], { cwd: repo, encoding: 'utf8' });
    assert.equal(old.status, 0);
    worker = join(root, 'baseline-worker.mjs');
    fs.writeFileSync(worker, old.stdout.replace("'./xcli-lab.mjs'", JSON.stringify(pathToFileURL(join(repo, 'scripts/xcli-lab.mjs')).href)));
  }
  const result = spawnSync(process.execPath, [worker, '--worker'], {
    cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
    input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
      executables: { claude: executable }, timeoutMs: 3000, simulated: true }),
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0);
  const cell = JSON.parse(result.stdout);
  assert.equal(cell.blocker, 'cli-exited-before-ready');
  assert.notEqual(cell.cleanupFailed, true);
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith('c-')).length, 0, 'no private CLI state survives verified cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
