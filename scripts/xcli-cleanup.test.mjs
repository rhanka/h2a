import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, sourceBuild, repo, compliantQualificationRoot, removeCampaignRoot } from './xcli-lab.mjs';

test('an already exited private CLI is blocked without falsely failing its verified cleanup', () => {
  const root = compliantQualificationRoot();
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

// Lot L5 RED: a lost worker stops the campaign and its secrets are wiped
// regardless. Each case drives the campaign parent with a worker stub (via
// the XCLI_WORKER_STUB seam): the stub reads the worker request on stdin,
// plants dummy login copies in the provided cell (or a fallback dir when the
// parent provides none), then misbehaves per case. Every case asserts the
// campaign stops after one worker run and the planted copies are absent.
const stubHead = `import fs from 'node:fs';
import { join } from 'node:path';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(join(request.root, 'stub-invocations.log'), 'run\\n');
const cell = request.cell ?? fs.mkdtempSync(join(request.root, 'c-stub-'));
// Mirror the real worker layout: login copies live under the role dir.
fs.mkdirSync(join(cell, 'sender', 'home', '.codex'), { recursive: true });
fs.writeFileSync(join(cell, 'sender', 'home', '.codex', 'auth.json'), JSON.stringify({ token: 'stub-canary' }));
fs.writeFileSync(join(request.root, 'stub-ready'), cell);
`;

function runParentWithStub(stubBody, extraArgs = []) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-l5-'));
  const stub = join(dir, 'stub.mjs');
  fs.writeFileSync(stub, stubBody);
  const output = join(dir, 'receipt.json');
  const result = spawnSync(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'),
    '--simulated', '--pair', 'codex:codex', '--wake-release-offsets-ms', '0,100',
    '--timeout-ms', '10000', '--output', output, ...extraArgs],
  { env: { ...process.env, XCLI_WORKER_STUB: stub }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const root = (result.stdout.match(/Private qualification root: (\S+)/) ?? [])[1];
  assert.ok(root, `parent reports its root\n${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
  const invocations = fs.existsSync(join(root, 'stub-invocations.log'))
    ? fs.readFileSync(join(root, 'stub-invocations.log'), 'utf8').trim().split('\n').length : 0;
  const planted = fs.existsSync(join(root, 'stub-ready'))
    ? join(fs.readFileSync(join(root, 'stub-ready'), 'utf8'), 'sender', 'home', '.codex', 'auth.json') : null;
  return { dir, root, receipt, invocations, planted, result };
}

function assertL5StoppedAndWiped({ receipt, invocations, planted }, firstBlocker) {
  assert.equal(receipt.cells.length, 2, 'both campaign runs are recorded');
  assert.equal(receipt.cells[0].blocker, firstBlocker);
  assert.equal(receipt.cells[0].cleanupFailed, true, 'both §6.6 obligations are unproven');
  assert.equal(invocations, 1, 'no further cell runs after the lost worker');
  assert.equal(receipt.cells[1].blocker, 'qualification-cancelled');
  assert.ok(planted, 'the stub planted dummy login copies');
  assert.equal(fs.existsSync(planted), false, 'every recorded login copy is absent afterwards');
}

test('L5: a worker emitting invalid JSON stops the campaign with secrets wiped', () => {
  const run = runParentWithStub(`${stubHead}process.stdout.write('not-json{{{');\n`);
  try {
    assert.equal(run.result.status, 2);
    assertL5StoppedAndWiped(run, 'qualification-worker-failed-cleanup-unproven');
  } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test('L5: a worker exiting without output stops the campaign with secrets wiped', () => {
  const run = runParentWithStub(stubHead);
  try {
    assert.equal(run.result.status, 2);
    assertL5StoppedAndWiped(run, 'qualification-worker-failed-cleanup-unproven');
  } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test('L5: a worker reporting cleanup failure without wiping is wiped by the parent', () => {
  const run = runParentWithStub(`${stubHead}process.stdout.write(JSON.stringify({ sender: request.sender,
    receiver: request.receiver, status: 'blocked', cleanupFailed: true, blocker: 'owned-process-cleanup-failed',
    credentialsCopied: { sender: ['.codex/auth.json'], receiver: [] }, cell, evidence: [], elapsedMs: 1 }));\n`);
  try {
    assert.equal(run.result.status, 2);
    assert.equal(run.invocations, 1, 'no further cell runs after the failed cleanup');
    assert.equal(run.receipt.cells[0].blocker, 'owned-process-cleanup-failed');
    assert.ok(run.planted, 'the stub planted dummy login copies');
    assert.equal(fs.existsSync(run.planted), false, 'the parent wiped the recorded copies itself');
  } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test('L5: cancelling the campaign mid-cell still wipes the cell secrets', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-l5-'));
  const stub = join(dir, 'stub.mjs');
  fs.writeFileSync(stub, `${stubHead}await new Promise(r => setTimeout(r, 60000));\n`);
  const output = join(dir, 'receipt.json');
  const child = spawn(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'),
    '--simulated', '--pair', 'codex:codex', '--timeout-ms', '10000', '--output', output],
  { env: { ...process.env, XCLI_WORKER_STUB: stub }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  const closed = new Promise(r => child.once('close', r));
  const timer = setTimeout(() => child.kill('SIGKILL'), 110000);
  let root = null;
  try {
    root = await new Promise((resolve, reject) => {
      const deadline = Date.now() + 90000;
      const poll = () => {
        const match = stdout.match(/Private qualification root: (\S+)/);
        if (match && fs.existsSync(join(match[1], 'stub-ready'))) resolve(match[1]);
        else if (Date.now() > deadline) reject(new Error('stub never planted its copies'));
        else setTimeout(poll, 100);
      };
      poll();
    });
    child.kill('SIGTERM');
    await closed;
    clearTimeout(timer);
    assert.equal(child.exitCode, 2, 'cancelled campaign exits 2');
    const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(receipt.cells[0].cleanupFailed, true);
    const planted = join(fs.readFileSync(join(root, 'stub-ready'), 'utf8'), 'sender', 'home', '.codex', 'auth.json');
    assert.equal(fs.existsSync(planted), false, 'cancellation still wipes the cell secrets');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    if (typeof root === 'string' && root) removeCampaignRoot(root);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
