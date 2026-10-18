// Run exactly the original M17 case; publish acceptance only after cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { m17Context, verifyM17Envelope, M17_FILE } from './m17-ci-evidence.mjs';

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
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return false; throw error; }
}
if (process.argv[2] === 'run') {
  assert.ok(process.env.H2A_TEST_M17_TMPDIR, 'qualified private data volume required');
  assert.ok(!fs.existsSync(directory), 'stale M17 output refused');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state = fs.mkdtempSync(join(tmpdir(), 'm17-ci-run-'));
  const ledger = join(state, 'children.jsonl'), hook = join(state, 'owned-process.mjs');
  const ownedRows = () => fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let child, closed, timer;
  try {
  fs.writeFileSync(hook, `import fs from 'node:fs';\nconst s=fs.readFileSync('/proc/self/stat','utf8');\nfs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify({pid:process.pid,birth:s.slice(s.lastIndexOf(') ')+2).split(' ')[19]})+'\\n');\n`);
  const env = { ...process.env, NODE_OPTIONS: `--max-old-space-size=768 --import=${hook}` };
  for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'H2A_ROOT', 'TMPDIR']) {
    env[name] = join(state, name.toLowerCase()); fs.mkdirSync(env[name], { mode: 0o700 });
  }
  const reportPath = join(state, 'report.json'), backend = [];
  child = spawn(process.execPath, ['scripts/run-node-tests.mjs', '--test', '--test-reporter=spec',
    `--test-reporter=${join(root, 'scripts/node-evidence-reporter.mjs')}`, '--test-reporter-destination=stdout',
    `--test-reporter-destination=${reportPath}`, M17_FILE], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', bytes => { text += bytes; process.stdout.write(bytes); });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  closed = new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); });
  const result = await Promise.race([closed, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('M17 exceeded its unchanged 1200-second backstop')), 1_200_000);
  })]);
  clearTimeout(timer);
  const rows = ownedRows();
  const survivors = rows.filter(alive);
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(survivors.length, 0, 'M17 left owned processes alive');
    assert.ok(rows.length >= 10, 'runner, test and eight actors must be observed');
    for (const line of text.split('\n')) {
      try { const row = JSON.parse(line); if (row.domains) backend.push(row); } catch { /* Spec reporter/progress text. */ }
    }
    assert.equal(backend.length, 1, 'exactly one complete backend reconciliation required');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.testResults.length, 1);
    assert.equal(report.testResults[0].name, join(root, M17_FILE));
    report.testResults[0].name = M17_FILE;
    const envelope = { schema: 1, context, report, backend: backend[0],
      exit: { ...result, survivingOwnedProcesses: 0 }, cleanup: { volumeRemoved: true, privateStateRemoved: true } };
    verifyM17Envelope(envelope, context);
    // This is provisional, never accepted by consumers or uploaded as proof.
    fs.writeFileSync(pendingPath, JSON.stringify({ envelope, volume: process.env.H2A_TEST_M17_TMPDIR, state, rows }) + '\n', { flag: 'wx', mode: 0o600 });
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
    while (remaining().length && performance.now() < grace) await new Promise(done => setTimeout(done, 10));
    for (const row of remaining()) signal(row, 'SIGKILL');
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    const deadline = performance.now() + 3000;
    while (remaining().length && performance.now() < deadline) await new Promise(done => setTimeout(done, 10));
    assert.equal(remaining().length, 0, 'owned M17 process did not stop after SIGKILL');
    if (closed) {
      let closeTimer;
      try { await Promise.race([closed.catch(() => {}), new Promise((_, reject) => {
        closeTimer = setTimeout(() => reject(Error('owned M17 runner did not close')), 1000);
      })]); } finally { clearTimeout(closeTimer); }
    }
    fs.rmSync(state, { recursive: true, force: true });
  }
} else if (process.argv[2] === 'finalize') {
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  assert.equal(pending.volume, process.env.H2A_TEST_M17_TMPDIR);
  assert.ok(!fs.existsSync(pending.volume), 'real volume cleanup must precede proof publication');
  assert.ok(!fs.existsSync(pending.state), 'private runner state must be removed');
  assert.equal(pending.rows.filter(alive).length, 0);
  verifyM17Envelope(pending.envelope, context);
  fs.writeFileSync(finalPath + '.tmp', JSON.stringify(pending.envelope) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(finalPath + '.tmp', finalPath); fs.unlinkSync(pendingPath);
  console.log('M17 same-run acceptance proof published after successful cleanup: ' + finalPath);
} else throw Error('usage: node scripts/ci-m17-proof.mjs run|finalize');
