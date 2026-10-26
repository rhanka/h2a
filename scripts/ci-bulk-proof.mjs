// Execute all nine original files; publish only after process/state cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BULK_FILES, bulkContext, bulkInventory, verifyBulkEnvelope } from './bulk-ci-evidence.mjs';

process.umask(0o022);
const root = fileURLToPath(new URL('..', import.meta.url)), context = bulkContext(root);
assert.equal(process.env.MH_L6_CASE, undefined, 'partial bulk selectors are forbidden');
const output = process.env.H2A_TEST_CI_BULK_OUTPUT;
assert.ok(output && resolve(output).startsWith(join(root, 'tmp') + '/'));
assert.ok(!fs.existsSync(output), 'stale bulk output refused');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const inventory = bulkInventory(root), state = fs.mkdtempSync(join(tmpdir(), 'bulk-ci-run-'));
const ledger = join(state, 'children.jsonl');
const rows = () => fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
function alive(row) {
  assert.ok(Number.isSafeInteger(row.pid) && row.pid > 0 && /^\d+$/.test(row.birth));
  try {
    const text = fs.readFileSync(`/proc/${row.pid}/stat`, 'utf8'), fields = text.slice(text.lastIndexOf(') ') + 2).split(' ');
    assert.ok(fields.length >= 20 && /^\d+$/.test(fields[19]));
    return fields[0] !== 'Z' && fields[19] === row.birth;
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return false; throw error; }
}
let child, closed, timer, fixtures = [], result, report;
try {
  fs.writeFileSync(ledger, '', {flag:'wx',mode:0o600});
  const env = { ...process.env, H2A_TEST_CI_OWNED_LEDGER: ledger };
  delete env.NODE_OPTIONS;
  delete env.H2A_TEST_CI_M17_REPORT; delete env.H2A_TEST_CI_BULK_REPORT;
  for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'H2A_ROOT', 'TMPDIR']) {
    env[name] = join(state, name.toLowerCase()); fs.mkdirSync(env[name], { mode: 0o700 });
  }
  const prepared = spawnSync(process.execPath, ['scripts/prepare-mh-test-fixtures.mjs'], {
    cwd: root, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(prepared.error, undefined); assert.equal(prepared.signal, null);
  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);
  assert.ok(Array.isArray(preparation.owned));
  for (const path of preparation.owned) {
    const info = fs.lstatSync(path);
    assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700);
    assert.ok(path.startsWith(state + '/') || /^\/tmp\/mh-l[56]-[A-Za-z0-9-]+$/.test(path), 'unowned bulk fixture refused');
    fixtures.push(path);
  }
  assert.ok(preparation.env && typeof preparation.env === 'object');
  for (const [name, path] of Object.entries(preparation.env)) {
    assert.ok(['MH_L5_ARTIFACTS', 'MH_L6_NATIVE_ASSETS'].includes(name));
    assert.ok(typeof path === 'string' && fixtures.some(root => path === root || path.startsWith(root + '/')));
    env[name] = path;
  }
  const reportPath = join(state, 'report.json');
  child = spawn(process.execPath, ['scripts/run-node-tests.mjs', '--test', '--test-reporter=spec',
    `--test-reporter=${join(root, 'scripts/node-evidence-reporter.mjs')}`, '--test-reporter-destination=stdout',
    `--test-reporter-destination=${reportPath}`, ...BULK_FILES], { cwd: root, env, stdio: 'inherit' });
  closed = new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); });
  result = await Promise.race([closed, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('bulk exceeded the unchanged 1200-second Node backstop')), 1_200_000);
  })]);
  clearTimeout(timer);
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(rows().filter(alive).length, 0, 'bulk left owned processes alive');
  assert.ok(rows().length >= BULK_FILES.length, 'all file processes must be observed');
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const row of report.testResults) {
    assert.ok(BULK_FILES.some(file => row.name === join(root, file)), 'foreign producer file');
    row.name = row.name.slice(root.length);
  }
} finally {
  clearTimeout(timer);
  const signal = (row, name) => { try { if (alive(row)) process.kill(row.pid, name); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; } };
  for (const row of rows().filter(alive)) signal(row, 'SIGTERM');
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const grace = performance.now() + 1000;
  while (rows().some(alive) && performance.now() < grace) await new Promise(done => setTimeout(done, 10));
  for (const row of rows().filter(alive)) signal(row, 'SIGKILL');
  const end = performance.now() + 3000;
  while (rows().some(alive) && performance.now() < end) await new Promise(done => setTimeout(done, 10));
  assert.equal(rows().filter(alive).length, 0, 'owned bulk process did not stop');
  if (closed) { let closeTimer; try { await Promise.race([closed.catch(() => {}), new Promise((_, reject) => {
    closeTimer = setTimeout(() => reject(Error('owned bulk runner did not close')), 1000);
  })]); } finally { clearTimeout(closeTimer); } }
  for (const path of fixtures) fs.rmSync(path, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
}
assert.ok(!fs.existsSync(state) && fixtures.every(path => !fs.existsSync(path)));
assert.deepEqual(bulkContext(root), context, 'source changed during qualification');
const envelope = { schema: 1, context, report, exit: { ...result, survivingOwnedProcesses: 0 },
  cleanup: { privateStateRemoved: true, fixturesRemoved: true } };
verifyBulkEnvelope(envelope, context, inventory);
fs.writeFileSync(join(output, 'proof.json.tmp'), JSON.stringify(envelope) + '\n', { flag: 'wx', mode: 0o600 });
fs.renameSync(join(output, 'proof.json.tmp'), join(output, 'proof.json'));
console.log('Bulk same-run acceptance proof published after successful cleanup: ' + join(output, 'proof.json'));
