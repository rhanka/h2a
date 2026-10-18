import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { M17_FILE, M17_TITLE, verifyM17Envelope, m17Partition, loadM17Partition, m17Context } from '../../../scripts/m17-ci-evidence.mjs';
import { verifyExecutionReport } from '../../../scripts/test-execution-evidence.mjs';
import { spawnSync } from 'node:child_process';

const context = { repository: 'rhanka/h2a', workflow: 'ci', runId: '123', attempt: '2',
  sha: 'a'.repeat(40), node: process.version, platform: 'linux', arch: process.arch,
  inputs: { 'package-lock.json': 'b'.repeat(64), [M17_FILE]: 'c'.repeat(64) } };
function proof() {
  return { schema: 1, context: structuredClone(context), report: {
    success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{ name: M17_FILE, status: 'passed', assertionResults: [{ fullName: M17_TITLE, status: 'passed' }] }] },
  backend: { domains: { presence: 10000, registry: 10000, inbox: 10000, negotiations: 10000, blockage: 10000, launches: 10000, payloads: 30000 },
    acknowledged: 10000, duplicates: 0, actors: Array.from({ length: 8 }, (_, n) => `backend${n + 1}`),
    coverage: 'backend-only', minimumLockAcquisitionsPerIteration: 10, storage: { type: 0x01021994, configured: true } },
  exit: { code: 0, signal: null, survivingOwnedProcesses: 0 }, cleanup: { volumeRemoved: true, privateStateRemoved: true } };
}
test('M17 companion evidence is exact and the default path executes the entire inventory', () => {
  assert.deepEqual(verifyM17Envelope(proof(), context), proof().report);
  const files = [M17_FILE, 'packages/h2a/test/other.test.js'];
  assert.deepEqual(loadM17Partition(files, process.cwd(), {}), { local: files, report: null });
  assert.throws(() => loadM17Partition(files, process.cwd(), { H2A_TEST_CI_M17_REPORT: '' }));
  assert.throws(() => loadM17Partition(files, process.cwd(), { H2A_TEST_CI_M17_REPORT: '/absent' }), /GitHub-only/);
});
function rejectContext(key) {
  const value = proof(); value.context[key] = key === 'inputs' ? {} : 'foreign';
  assert.throws(() => verifyM17Envelope(value, context));
}
test("M17 companion rejects stale or foreign repository", () => rejectContext("repository"));
test("M17 companion rejects stale or foreign workflow", () => rejectContext("workflow"));
test("M17 companion rejects stale or foreign runId", () => rejectContext("runId"));
test("M17 companion rejects stale or foreign attempt", () => rejectContext("attempt"));
test("M17 companion rejects stale or foreign sha", () => rejectContext("sha"));
test("M17 companion rejects stale or foreign platform", () => rejectContext("platform"));
test("M17 companion rejects stale or foreign arch", () => rejectContext("arch"));
test("M17 companion rejects stale or foreign node", () => rejectContext("node"));
test("M17 companion rejects stale or foreign inputs", () => rejectContext("inputs"));
const corruptions = {
  'unknown envelope field': value => { value.optionalSkip = true; },
  'unknown schema': value => { value.schema = 2; },
  'failed process': value => { value.exit.code = 1; },
  'cancelled process': value => { value.exit.signal = 'SIGTERM'; },
  'live child': value => { value.exit.survivingOwnedProcesses = 1; },
  'missing cleanup': value => { delete value.cleanup; },
  'failed volume cleanup': value => { value.cleanup.volumeRemoved = false; },
  'remaining private state': value => { value.cleanup.privateStateRemoved = false; },
  'failed suite': value => { value.report.testResults[0].status = 'failed'; },
  'report failure': value => { value.report.success = false; },
  'skipped case': value => { value.report.testResults[0].assertionResults[0].status = 'skipped'; },
  'TODO case': value => { value.report.testResults[0].assertionResults[0].status = 'todo'; },
  'duplicate suite': value => { value.report.testResults.push(structuredClone(value.report.testResults[0])); },
  'duplicate case': value => { value.report.testResults[0].assertionResults.push(structuredClone(value.report.testResults[0].assertionResults[0])); },
  'missing case': value => { value.report.testResults[0].assertionResults = []; },
  'different case': value => { value.report.testResults[0].assertionResults[0].fullName = 'short sample'; },
  'absolute path': value => { value.report.testResults[0].name = resolve(M17_FILE); },
  'traversal path': value => { value.report.testResults[0].name = 'other/../' + M17_FILE; },
  'foreign file': value => { value.report.testResults[0].name = 'elsewhere/' + M17_FILE; },
  'false counts': value => { value.report.numTotalTests = 2; },
  'unhandled error': value => { value.report.unhandledErrors = ['error']; },
  'partial mutation count': value => { value.backend.domains.presence = 9999; },
  'missing domain': value => { delete value.backend.domains.inbox; },
  'unknown domain': value => { value.backend.domains.invented = 10000; },
  'noninteger count': value => { value.backend.domains.presence = 10000.5; },
  'partial ACK': value => { value.backend.acknowledged = 9999; },
  'duplicate ACK': value => { value.backend.duplicates = 1; },
  'missing actor': value => { value.backend.actors.pop(); },
  'duplicate actor': value => { value.backend.actors[1] = value.backend.actors[0]; },
  'no kernel observation': value => { value.backend.minimumLockAcquisitionsPerIteration = 0; },
  'disk fallback': value => { value.backend.storage.type = 0; },
  'unconfigured tmpfs': value => { value.backend.storage.configured = false; },
};
function rejectCorruption(name) {
  const value = proof(); corruptions[name](value); assert.throws(() => verifyM17Envelope(value, context));
}
test("M17 companion rejects unknown envelope field", () => rejectCorruption("unknown envelope field"));
test("M17 companion rejects unknown schema", () => rejectCorruption("unknown schema"));
test("M17 companion rejects failed process", () => rejectCorruption("failed process"));
test("M17 companion rejects cancelled process", () => rejectCorruption("cancelled process"));
test("M17 companion rejects live child", () => rejectCorruption("live child"));
test("M17 companion rejects missing cleanup", () => rejectCorruption("missing cleanup"));
test("M17 companion rejects failed volume cleanup", () => rejectCorruption("failed volume cleanup"));
test("M17 companion rejects remaining private state", () => rejectCorruption("remaining private state"));
test("M17 companion rejects failed suite", () => rejectCorruption("failed suite"));
test("M17 companion rejects report failure", () => rejectCorruption("report failure"));
test("M17 companion rejects skipped case", () => rejectCorruption("skipped case"));
test("M17 companion rejects TODO case", () => rejectCorruption("TODO case"));
test("M17 companion rejects duplicate suite", () => rejectCorruption("duplicate suite"));
test("M17 companion rejects duplicate case", () => rejectCorruption("duplicate case"));
test("M17 companion rejects missing case", () => rejectCorruption("missing case"));
test("M17 companion rejects different case", () => rejectCorruption("different case"));
test("M17 companion rejects absolute path", () => rejectCorruption("absolute path"));
test("M17 companion rejects traversal path", () => rejectCorruption("traversal path"));
test("M17 companion rejects foreign file", () => rejectCorruption("foreign file"));
test("M17 companion rejects false counts", () => rejectCorruption("false counts"));
test("M17 companion rejects unhandled error", () => rejectCorruption("unhandled error"));
test("M17 companion rejects partial mutation count", () => rejectCorruption("partial mutation count"));
test("M17 companion rejects missing domain", () => rejectCorruption("missing domain"));
test("M17 companion rejects unknown domain", () => rejectCorruption("unknown domain"));
test("M17 companion rejects noninteger count", () => rejectCorruption("noninteger count"));
test("M17 companion rejects partial ACK", () => rejectCorruption("partial ACK"));
test("M17 companion rejects duplicate ACK", () => rejectCorruption("duplicate ACK"));
test("M17 companion rejects missing actor", () => rejectCorruption("missing actor"));
test("M17 companion rejects duplicate actor", () => rejectCorruption("duplicate actor"));
test("M17 companion rejects no kernel observation", () => rejectCorruption("no kernel observation"));
test("M17 companion rejects disk fallback", () => rejectCorruption("disk fallback"));
test("M17 companion rejects unconfigured tmpfs", () => rejectCorruption("unconfigured tmpfs"));
test('M17 partition is disjoint/exhaustive and the unchanged inventory checker rejects merge holes', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'm17-proof-partition-'));
  try {
    const other = 'packages/h2a/test/other.test.js', files = [other, M17_FILE];
    const selected = m17Partition(files, proof(), context, root);
    assert.deepEqual(selected.local, [other]);
    assert.equal(selected.report.testResults[0].name, resolve(root, M17_FILE));
    assert.throws(() => m17Partition([other], proof(), context, root));
    assert.throws(() => m17Partition([...files, M17_FILE], proof(), context, root));
    const merged = structuredClone(selected.report);
    merged.testResults.push({ name: resolve(root, other), status: 'passed', assertionResults: [{ fullName: 'other', status: 'passed' }] });
    merged.numTotalTests++; merged.numPassedTests++;
    const required = files.map(file => resolve(root, file));
    assert.deepEqual(verifyExecutionReport(merged, required), []);
    const duplicate = structuredClone(merged); duplicate.testResults.push(structuredClone(merged.testResults[0]));
    assert.ok(verifyExecutionReport(duplicate, required).some(error => error.includes('duplicate suite')));
    merged.testResults.pop(); merged.numTotalTests--; merged.numPassedTests--;
    assert.ok(verifyExecutionReport(merged, required).some(error => error.includes('NEVER EXECUTED')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('M17 context refuses a configured proof outside the disposable GitHub runner', () => {
  assert.throws(() => m17Context(process.cwd(), {}), /GitHub-only/);
});

test('M17 producer seals only a successful same-run report after owned-process and volume cleanup', () => {
  // Synthetic producer contract fixture, NOT a backend stress qualification.
  // The real producer, public Node runner, reporter and preload execute eight
  // real, short-lived children in a private committed fixture checkout.
  const root = fs.mkdtempSync(join(tmpdir(), 'm17-producer-contract-'));
  const source = process.cwd();
  const copied = ['scripts/m17-ci-evidence.mjs', 'scripts/ci-m17-proof.mjs', 'scripts/run-node-tests.mjs',
    'scripts/node-evidence-reporter.mjs', 'scripts/test-execution-evidence.mjs',
    'packages/h2a/test/helpers/native-isolation.js', ...['image', 'wire', 'formats', 'schemas'].map(name => `packages/h2a/src/runtime/handover/${name}.js`)];
  const run = (command, args, env = process.env) => spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const git = (...args) => { const result = run('git', args); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout.trim(); };
  try {
    for (const file of copied) { fs.mkdirSync(join(root, file, '..'), { recursive: true }); fs.copyFileSync(join(source, file), join(root, file)); }
    for (const file of ['package-lock.json', 'packages/h2a/test/helpers/mh-l5-campaign.js', 'packages/h2a/test/helpers/mh-l5-writer.mjs']) fs.copyFileSync(join(source, file), join(root, file));
    fs.writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(join(root, M17_FILE), `import test from 'node:test';import {spawn} from 'node:child_process';\nimport {once} from 'node:events';\ntest(${JSON.stringify(M17_TITLE)},async()=>{\nawait Promise.all(Array.from({length:8},()=>{const c=spawn(process.execPath,['-e','process.exit(0)'],{env:process.env,stdio:'ignore'});return once(c,'close');}));\nconsole.log(${JSON.stringify(JSON.stringify(proof().backend))});\n});\n`);
    git('init', '--quiet'); git('config', 'user.name', 'M17 contract fixture'); git('config', 'user.email', 'm17-fixture@example.invalid');
    git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'test: create the private M17 producer contract fixture');
    const volume = join(root, 'volume'); fs.mkdirSync(volume, { mode: 0o700 });
    const output = join(root, 'tmp/export');
    const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'rhanka/h2a', GITHUB_WORKFLOW: 'ci',
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: git('rev-parse', 'HEAD'),
      H2A_TEST_CI_M17_OUTPUT: output, H2A_TEST_M17_TMPDIR: volume };
    delete env.H2A_TEST_CI_M17_REPORT;
    delete env.NODE_TEST_CONTEXT;
    const result = run(process.execPath, ['scripts/ci-m17-proof.mjs', 'run'], env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(join(output, 'proof.json')), false, 'successful test alone cannot publish acceptance');
    assert.equal(fs.existsSync(join(output, 'pending.json')), true);
    const early = run(process.execPath, ['scripts/ci-m17-proof.mjs', 'finalize'], env);
    assert.notEqual(early.status, 0, 'a remaining volume must block publication');
    assert.match(early.stderr, /real volume cleanup must precede/);
    fs.rmdirSync(volume);
    const final = run(process.execPath, ['scripts/ci-m17-proof.mjs', 'finalize'], env);
    assert.equal(final.status, 0, final.stdout + final.stderr);
    const value = JSON.parse(fs.readFileSync(join(output, 'proof.json'), 'utf8'));
    assert.equal(value.context.sha, env.GITHUB_SHA);
    assert.deepEqual(value.exit, { code: 0, signal: null, survivingOwnedProcesses: 0 });
    assert.deepEqual(value.cleanup, { volumeRemoved: true, privateStateRemoved: true });
    assert.equal(fs.existsSync(join(output, 'pending.json')), false);
    const imported = loadM17Partition([M17_FILE, 'other.test.js'], root, { ...env, H2A_TEST_CI_M17_REPORT: join(output, 'proof.json') });
    assert.deepEqual(imported.local, ['other.test.js']);
    assert.equal(imported.report.testResults[0].name, join(root, M17_FILE));
    fs.symlinkSync(join(output, 'proof.json'), join(output, 'alias.json'));
    assert.throws(() => loadM17Partition([M17_FILE], root, { ...env, H2A_TEST_CI_M17_REPORT: join(output, 'alias.json') }), /regular file/);
    fs.appendFileSync(join(root, 'packages/h2a/test/helpers/mh-l5-writer.mjs'), '\n// dirty fixture\n');
    assert.throws(() => loadM17Partition([M17_FILE], root, { ...env, H2A_TEST_CI_M17_REPORT: join(output, 'proof.json') }), 'dirty tracked helpers cannot reuse an old proof');
    git('restore', 'packages/h2a/test/helpers/mh-l5-writer.mjs');
    const replay = run(process.execPath, ['scripts/ci-m17-proof.mjs', 'run'], env);
    assert.notEqual(replay.status, 0, 'stale producer output must not be reused');
    assert.match(replay.stderr, /stale M17 output refused/);
    // Real failed-producer teardown: a child outlives its passing synthetic
    // case, ignores TERM, and must be birth-verified gone after KILL.
    const witness = join(root, 'late-child.json');
    const program = `import fs from 'node:fs';const s=fs.readFileSync('/proc/self/stat','utf8');fs.writeFileSync(${JSON.stringify(witness)},JSON.stringify({pid:process.pid,birth:s.slice(s.lastIndexOf(') ')+2).split(' ')[19]}));process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);`;
    fs.writeFileSync(join(root, M17_FILE), `import test from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';\ntest(${JSON.stringify(M17_TITLE)},async()=>{const c=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(program)}],{env:process.env,stdio:['ignore','pipe','ignore']});await once(c.stdout,'data');c.stdout.destroy();c.unref();console.log(${JSON.stringify(JSON.stringify(proof().backend))});});\n`);
    git('add', M17_FILE); git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'test: expose an owned child surviving the producer fixture');
    const failedEnv = { ...env, GITHUB_SHA: git('rev-parse', 'HEAD'), H2A_TEST_CI_M17_OUTPUT: join(root, 'tmp/failed') };
    fs.mkdirSync(volume, { mode: 0o700 });
    const failed = run(process.execPath, ['scripts/ci-m17-proof.mjs', 'run'], failedEnv);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /M17 left owned processes alive/);
    assert.equal(fs.existsSync(join(failedEnv.H2A_TEST_CI_M17_OUTPUT, 'proof.json')), false);
    assert.equal(fs.existsSync(join(failedEnv.H2A_TEST_CI_M17_OUTPUT, 'pending.json')), false);
    const owned = JSON.parse(fs.readFileSync(witness, 'utf8'));
    try {
      const stat = fs.readFileSync(`/proc/${owned.pid}/stat`, 'utf8').split(') ')[1].split(' ');
      assert.ok(stat[0] === 'Z' || stat[19] !== owned.birth, 'failed producer must stop its actual owned child');
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
