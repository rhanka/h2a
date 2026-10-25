import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, sourceBuild, repo } from './xcli-lab.mjs';
import { parseWakeWindows } from './qualify-cross-cli.mjs';
import { verifyWakePhases } from './xcli-ci-check.mjs';

// A real startup dialog may render its choice before it starts accepting keys.
// No login or provider is used; after consent this runs the signed product path.
test('a partially rendered Cancel-focused trust dialog completes before the live round trip', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-qual-'));
  try {
    const built = sourceBuild(root);
    const fixture = join(root, 'startup.mjs');
    fs.writeFileSync(fixture, `import { pathToFileURL } from 'node:url';
process.stdin.setRawMode(true);
process.stdin.resume();
let accepting = false, complete = false;
process.stdout.write('Quick safety check: Is this a project you trust?\\r\\nNo, exit\\r\\nYes, I trust this folder\\r\\n');
const timer = setTimeout(() => {
  accepting = true;
  process.stdout.write('Enter to confirm\\r\\n');
}, 600);
async function input(bytes) {
  if (!accepting || complete || !bytes.toString().includes('\\x1b[B\\r')) return;
  complete = true;
  clearTimeout(timer);
  process.stdin.off('data', input);
  process.stdout.write('\\x1b[2J\\x1b[H');
  await import(pathToFileURL(${JSON.stringify(join(repo, 'scripts/xcli-simulated-model.mjs'))}));
}
process.stdin.on('data', input);
`);
    const syntax = spawnSync(process.execPath, ['--check', fixture], { env: environment(join(root, 'syntax')), encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const executables = {};
    for (const cli of ['claude']) {
      const executable = join(root, cli);
      fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' '${cli}' "$@"\n`, { mode: 0o700 });
      executables[cli] = executable;
    }
    let worker = join(repo, 'scripts/qualify-cross-cli.mjs');
    if (process.env.XCLI_STARTUP_BASELINE) {
      const baseline = spawnSync('git', ['show', process.env.XCLI_STARTUP_BASELINE + ':scripts/qualify-cross-cli.mjs'],
        { cwd: repo, encoding: 'utf8' });
      assert.equal(baseline.status, 0);
      let source = baseline.stdout;
      for (const name of ['xcli-lab.mjs', 'xcli-terminal.mjs'])
        source = source.replace("'./" + name + "'", JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href));
      worker = join(root, 'baseline-worker.mjs');
      fs.writeFileSync(worker, source);
    }
    const result = spawnSync(process.execPath, [worker, '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
        executables, timeoutMs: 60000, simulated: true,
        wake: parseWakeWindows(undefined, true), releaseOffsetMs: 0 }),
      encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0);
    const cell = JSON.parse(result.stdout);
    assert.notEqual(cell.cleanupFailed, true, JSON.stringify(cell.cleanupErrors));
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('c-')).length, 0);
    assert.equal(cell.status, 'simulated-OK', JSON.stringify(cell));
    assert.deepEqual(verifyWakePhases(cell), [], 'the startup consumer must fund and witness all cell-level phases');
    assert.equal(cell.noPostSendHarnessInput, true);
    assert.deepEqual(cell.evidence.filter(e => e.event === 'startup-ui').map(e => e.action),
      ['trust-empty-workspace', 'trust-empty-workspace']);
    assert.equal(cell.replyDelivered, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
