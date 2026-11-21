// Run exactly the original M17 case under D16 confinement; publish acceptance
// on the host ONLY after real unmount and host cleanup (N3).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { m17Context, verifyM17Envelope, M17_FILE } from './m17-ci-evidence.mjs';
import { verifySandboxConfinement } from './test-sandbox-contract.mjs';

process.umask(0o022);
const root = fileURLToPath(new URL('..', import.meta.url));
const context = m17Context(root), directory = process.env.H2A_TEST_CI_M17_OUTPUT;
assert.ok(directory && resolve(directory).startsWith(join(root, 'tmp') + '/'), 'private checkout-local output required');
const pendingPath = join(directory, 'pending.json'), finalPath = join(directory, 'proof.json');

function alive(row) {
  assert.ok(Number.isSafeInteger(row.pid) && row.pid > 0 && /^\d+$/.test(row.birth), 'invalid owned-process identity');
  try {
    const stat = fs.readFileSync(`/proc/${row.pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
    assert.ok(fields.length >= 20 && /^\d+$/.test(fields[19]), 'unreadable owned-process birth');
    return fields[0] !== 'Z' && fields[19] === row.birth;
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
}

function publishAtomically(destPath, content) {
  const dir = dirname(destPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.proof-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
    fs.linkSync(tmp, destPath);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

if (process.argv[2] === 'run') {
  const receipt = verifySandboxConfinement(process.env);
  assert.ok(process.env.H2A_TEST_M17_TMPDIR, 'qualified private data volume required');
  assert.ok(
    resolve(process.env.H2A_TEST_M17_TMPDIR).startsWith(resolve(receipt.root) + '/'),
    'M17 tmpfs volume must be mounted inside attested D16 root R',
  );
  assert.ok(!fs.existsSync(directory), 'stale M17 output refused');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const stateRel = process.env.H2A_TEST_M17_STATE_REL;
  const state = stateRel
    ? join(receipt.root, stateRel)
    : fs.mkdtempSync(join(tmpdir(), 'm17-ci-run-'));
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const ledger = join(state, 'children.jsonl'), hook = join(state, 'owned-process.mjs');
  const ownedRows = () =>
    fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let child, closed, timer;
  try {
    fs.writeFileSync(
      hook,
      `import fs from 'node:fs';\nconst s=fs.readFileSync('/proc/self/stat','utf8');\nfs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify({pid:process.pid,birth:s.slice(s.lastIndexOf(') ')+2).split(' ')[19]})+'\\n');\n`,
    );
    const env = { ...process.env, NODE_OPTIONS: `--max-old-space-size=768 --import=${hook}` };
    for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'H2A_ROOT', 'TMPDIR']) {
      env[name] = join(state, name.toLowerCase());
      fs.mkdirSync(env[name], { recursive: true, mode: 0o700 });
    }
    const reportPath = join(state, 'report.json'), backend = [];
    child = spawn(
      process.execPath,
      [
        'scripts/run-node-tests.mjs',
        '--test',
        '--test-reporter=spec',
        `--test-reporter=${join(root, 'scripts/node-evidence-reporter.mjs')}`,
        '--test-reporter-destination=stdout',
        `--test-reporter-destination=${reportPath}`,
        M17_FILE,
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let text = '';
    child.stdout.on('data', (bytes) => { text += bytes; process.stdout.write(bytes); });
    child.stderr.on('data', (bytes) => process.stderr.write(bytes));
    closed = new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => done({ code, signal }));
    });
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('M17 exceeded its 1350-second producer backstop')), 1_350_000);
      }),
    ]);
    clearTimeout(timer);
    const rows = ownedRows();
    const survivors = rows.filter(alive);
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(survivors.length, 0, 'M17 left owned processes alive');
    assert.ok(rows.length >= 10, 'runner, test and eight actors must be observed');
    for (const line of text.split('\n')) {
      try {
        const row = JSON.parse(line);
        if (row.domains) backend.push(row);
      } catch { /* Spec reporter/progress text. */ }
    }
    assert.equal(backend.length, 1, 'exactly one complete backend reconciliation required');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.testResults.length, 1);
    assert.equal(report.testResults[0].name, join(root, M17_FILE));
    report.testResults[0].name = M17_FILE;
    const envelope = {
      schema: 1,
      context,
      report,
      backend: backend[0],
      exit: { ...result, survivingOwnedProcesses: 0 },
      cleanup: { volumeRemoved: true, privateStateRemoved: true },
    };
    verifyM17Envelope(envelope, context);
    // Provisional only inside the sandbox view; host launcher validates and
    // copies into host control dir C after namespace exit.
    fs.writeFileSync(
      pendingPath,
      JSON.stringify({ envelope, stateRel: stateRel ?? null, observedOwnedCount: rows.length }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    clearTimeout(timer);
    const signal = (row, name) => {
      try { if (alive(row)) process.kill(row.pid, name); }
      catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    };
    const remaining = () => ownedRows().filter(alive);
    for (const row of remaining()) signal(row, 'SIGTERM');
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const grace = performance.now() + 1000;
    while (remaining().length && performance.now() < grace) await new Promise((done) => setTimeout(done, 10));
    for (const row of remaining()) signal(row, 'SIGKILL');
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    const deadline = performance.now() + 3000;
    while (remaining().length && performance.now() < deadline) await new Promise((done) => setTimeout(done, 10));
    assert.equal(remaining().length, 0, 'owned M17 process did not stop after SIGKILL');
    if (closed) {
      let closeTimer;
      try {
        await Promise.race([
          closed.catch(() => {}),
          new Promise((_, reject) => {
            closeTimer = setTimeout(() => reject(Error('owned M17 runner did not close')), 1000);
          }),
        ]);
      } finally {
        clearTimeout(closeTimer);
      }
    }
    fs.rmSync(state, { recursive: true, force: true });
  }
} else if (process.argv[2] === 'finalize') {
  assert.ok(process.env.RUNNER_TEMP, 'M17 finalize requires RUNNER_TEMP');
  const base = fs.realpathSync(process.env.RUNNER_TEMP);
  const activePointer = join(base, 'h2a-m17-active.json');
  const finalizePointer = join(base, 'h2a-m17-finalize.json');
  const pointer = JSON.parse(fs.readFileSync(finalizePointer, 'utf8'));
  const controlDir = pointer.controlDir;
  try {
    assert.ok(!fs.existsSync(activePointer), 'active M17 mount reservation must be removed before finalize');
    assert.ok(!fs.existsSync(join(controlDir, 'run-failed.json')), 'refusing to publish M17 proof after failed run');
    const setupReceipt = JSON.parse(fs.readFileSync(join(controlDir, 'setup-receipt.json'), 'utf8'));
    const runReceipt = JSON.parse(fs.readFileSync(join(controlDir, 'run-receipt.json'), 'utf8'));
    const cleanupReceipt = JSON.parse(fs.readFileSync(join(controlDir, 'cleanup-receipt.json'), 'utf8'));
    const provisional = JSON.parse(fs.readFileSync(join(controlDir, 'm17-provisional.json'), 'utf8'));

    assert.equal(pointer.nonce, setupReceipt.nonce);
    assert.equal(runReceipt.nonce, setupReceipt.nonce);
    assert.equal(cleanupReceipt.nonce, setupReceipt.nonce);
    assert.equal(runReceipt.initExited, true);
    assert.equal(cleanupReceipt.unmounted, true);
    assert.equal(cleanupReceipt.hostRootRemoved, true);
    assert.equal(process.env.H2A_TEST_M17_TMPDIR, setupReceipt.volumePath);

    assert.ok(!fs.existsSync(setupReceipt.hostRoot), 'M17 host root H must be removed before proof publication');
    assert.ok(!fs.existsSync(setupReceipt.volumePath), 'real volume cleanup must precede proof publication');
    assert.ok(!fs.existsSync(join(setupReceipt.hostRoot, runReceipt.stateRel)), 'private runner state must be removed');

    verifyM17Envelope(provisional.envelope, context);
    publishAtomically(finalPath, JSON.stringify(provisional.envelope) + '\n');
    console.log('M17 same-run acceptance proof published after successful cleanup: ' + finalPath);
  } finally {
    try { fs.rmSync(controlDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(finalizePointer, { force: true }); } catch { /* best effort */ }
  }
} else {
  throw Error('usage: node scripts/ci-m17-proof.mjs run|finalize');
}
