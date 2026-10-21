import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { selectFiles, createLane, commandPlan, checkReport, executeLane } from '../../../scripts/velocity-test-lane.mjs';

const root = resolve(import.meta.dirname, '../../..');
const file = 'test/velocity-test-lane.test.js';
const selected = { package: 'h2a', files: [file] };
function temporary(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'velocity-meta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(t) {
  const dir = temporary(t);
  for (const name of ['packages/h2a/test/helpers', 'packages/agent-stats/tests/fixtures/velocity', 'scripts', 'docs/contracts/golden', 'knowledge/contracts', 'packages/h2a/src']) fs.mkdirSync(join(dir, name), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json']) fs.writeFileSync(join(dir, name), '{}');
  fs.writeFileSync(join(dir, 'packages/h2a/test/velocity-test-lane.test.js'), "import test from 'node:test'; test('fixture only', () => {});\n");
  fs.writeFileSync(join(dir, 'packages/h2a/test/unselected.test.js'), "throw Error('unselected test ran');");
  fs.writeFileSync(join(dir, 'packages/h2a/src/candidate.ts'), 'export const candidate = 42;');
  fs.writeFileSync(join(dir, 'packages/agent-stats/tests/fixtures/velocity/input.json'), '{"measured":true}');
  fs.writeFileSync(join(dir, 'docs/contracts/golden/cli-verbs.json'), '["fixture"]');
  fs.writeFileSync(join(dir, 'knowledge/contracts/contract.json'), '{"upstream":true}');
  fs.copyFileSync(join(root, 'packages/h2a/test/helpers/identity-isolation-guard.mjs'), join(dir, 'packages/h2a/test/helpers/identity-isolation-guard.mjs'));
  for (const script of ['node-evidence-reporter.mjs', 'test-execution-evidence.mjs', 'test-non-tests-0986.json']) fs.copyFileSync(join(root, 'scripts', script), join(dir, 'scripts', script));
  fs.mkdirSync(join(dir, 'packages/h2a/dist'));
  fs.writeFileSync(join(dir, 'packages/h2a/dist/stale.js'), 'throw Error("stale build");');
  return dir;
}

test('should retain only exact named selectors', () => {
  assert.deepEqual(selectFiles(['--package', 'h2a', '--file', file, '--file', 'test/cli-contract.test.js']), { package: 'h2a', files: [file, 'test/cli-contract.test.js'] });
});
for (const [name, args] of [
  ['empty selection', []], ['package without files', ['--package', 'h2a']],
  ['glob', ['--package', 'h2a', '--file', 'test/*.test.js']],
  ['traversal', ['--package', 'h2a', '--file', '../test/cli-contract.test.js']],
  ['absolute path', ['--package', 'h2a', '--file', '/tmp/probe.test.js']],
  ['suite shortcut', ['--package', 'h2a', '--file', 'test']],
  ['unknown package', ['--package', 'runtime', '--file', 'src/foo.test.ts']],
  ['mixed public contract', ['--public-contract', '--package', 'h2a', '--file', file]],
  ['duplicate selector', ['--package', 'h2a', '--file', file, '--file', file]],
  ['unknown option', ['--package', 'h2a', '--all', '--file', file]],
]) test(`should reject ${name} before creating a child`, () => assert.throws(() => selectFiles(args)));

test('should copy candidate sources, fixtures and goldens without stale build or unselected tests', t => {
  const sourceRoot = fixture(t);
  const lane = createLane({ sourceRoot, selection: selected });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  for (const name of ['packages/h2a/src/candidate.ts', 'packages/h2a/test/velocity-test-lane.test.js', 'packages/agent-stats/tests/fixtures/velocity/input.json', 'docs/contracts/golden/cli-verbs.json', 'knowledge/contracts/contract.json']) assert.equal(fs.readFileSync(join(lane.checkout, name), 'utf8'), fs.readFileSync(join(sourceRoot, name), 'utf8'));
  for (const name of ['packages/h2a/dist/stale.js', 'packages/h2a/test/unselected.test.js']) assert.equal(fs.existsSync(join(lane.checkout, name)), false);
});
test('should create every private directory and drop inherited owner/session/provider hints', t => {
  const sourceRoot = fixture(t);
  const lane = createLane({ sourceRoot, selection: selected, inheritedEnv: { PATH: process.env.PATH, H2A_NATIVE_SOCKET: '/synthetic/socket', CODEX_HOME: '/synthetic/codex', CLAUDE_CONFIG_DIR: '/synthetic/claude', NODE_OPTIONS: '--require=/synthetic/preload', OPENAI_API_KEY: 'synthetic-secret', SSH_AUTH_SOCK: '/synthetic/agent' } });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  for (const key of ['HOME', 'TMPDIR', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'H2A_ROOT', 'IDLOCK_LANE', 'H2A_TEST_PROC_ROOT', 'H2A_BUS_DIR']) {
    assert.ok(lane.env[key].startsWith(lane.path));
    assert.equal(fs.statSync(lane.env[key]).isDirectory(), true);
    assert.equal(fs.statSync(lane.env[key]).mode & 0o777, 0o700);
  }
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'OPENAI_API_KEY', 'SSH_AUTH_SOCK']) assert.equal(lane.env[key], undefined);
  assert.ok(!lane.env.NODE_OPTIONS.includes('/synthetic'));
  assert.ok(lane.env.H2A_NATIVE_SOCKET.startsWith(lane.path + '/'));
});
test('should fail on a missing exact file without silently skipping', t => {
  const sourceRoot = fixture(t);
  assert.throws(() => createLane({ sourceRoot, selection: { package: 'h2a', files: ['test/missing.test.js'] } }), /missing.*file/i);
});
test('should reject a symlink selector before copying it', t => {
  const sourceRoot = fixture(t);
  fs.symlinkSync(join(sourceRoot, 'packages/h2a/test/velocity-test-lane.test.js'), join(sourceRoot, 'packages/h2a/test/link.test.js'));
  assert.throws(() => createLane({ sourceRoot, selection: { package: 'h2a', files: ['test/link.test.js'] } }), /symlink/i);
});
test('should omit unrelated documentation links while retaining contract goldens', t => {
  const sourceRoot = fixture(t);
  fs.mkdirSync(join(sourceRoot, 'docs/focus'), { recursive: true });
  fs.symlinkSync('missing-unrelated-page.html', join(sourceRoot, 'docs/focus/index.html'));
  const lane = createLane({ sourceRoot, selection: selected });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  assert.equal(fs.existsSync(join(lane.checkout, 'docs/focus')), false);
  assert.equal(fs.readFileSync(join(lane.checkout, 'docs/contracts/golden/cli-verbs.json'), 'utf8'), '["fixture"]');
});
test('should build source dependencies before the exact Node test and preserve the guard preload', () => {
  const commands = commandPlan({ path: '/lane', checkout: '/lane/checkout', selection: selected });
  assert.deepEqual(commands.map(c => c.args.slice(0, 6)), [
    ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    ['npm', 'run', 'build', '-w', '@sentropic/agent-stats'],
    ['npm', 'run', 'build', '-w', '@sentropic/track'],
    ['npm', 'run', 'build:h2a'],
    ['node', '--import', './packages/h2a/test/helpers/identity-isolation-guard.mjs', '--test', '--test-reporter=spec', '--test-reporter-destination=stdout'],
  ]);
  assert.ok(commands.at(-1).args.includes('packages/h2a/' + file));
});
test('should select the package Vitest config and only the requested file', () => {
  const lane = { path: '/lane', checkout: '/lane/checkout', selection: { package: 'agent-stats', files: ['tests/velocity-contract.test.ts'] } };
  const command = commandPlan(lane).at(-1);
  assert.equal(command.cwd, '/lane/checkout/packages/agent-stats');
  assert.deepEqual(command.args.slice(0, 7), ['npx', '--no-install', 'vitest', 'run', '--config', 'vitest.config.ts', 'tests/velocity-contract.test.ts']);
});
function report(status = 'passed', name = 'required test') {
  return { success: true, numTotalTests: 1, numPassedTests: status === 'passed' ? 1 : 0, numFailedTests: 0, numPendingTests: status === 'skipped' ? 1 : 0, numTodoTests: 0, testResults: [{ name: '/lane/checkout/packages/h2a/' + file, status: 'passed', assertionResults: [{ fullName: name, status }] }] };
}
test('should reject a missing execution report and zero executed tests', () => {
  assert.throws(() => checkReport(null, ['/lane/checkout/packages/h2a/' + file], []), /report/i);
  assert.throws(() => checkReport({ ...report(), testResults: [] }, ['/lane/checkout/packages/h2a/' + file], []), /NEVER EXECUTED/);
});
test('should reject unlisted skips instead of claiming green', () => assert.throws(() => checkReport(report('skipped'), ['/lane/checkout/packages/h2a/' + file], []), /not an authorized|ZERO tests/));
test('should count passed assertions and separately list exact authorized non-tests', () => {
  const data = report();
  data.testResults[0].assertionResults.push({ fullName: 'owner placeholder', status: 'skipped' });
  data.numTotalTests++; data.numPendingTests++;
  assert.deepEqual(checkReport(data, ['/lane/checkout/packages/h2a/' + file], [{ file: '/lane/checkout/packages/h2a/' + file, fullName: 'owner placeholder', status: 'skipped', reason: 'explicit owner non-test' }]), { passed: 1, excluded: 1 });
});
test('should reject a renamed non-test and dishonest totals', () => {
  const changed = { ...report(), numPassedTests: 99 };
  assert.throws(() => checkReport(changed, ['/lane/checkout/packages/h2a/' + file], []), /counts/);
  assert.throws(() => checkReport(report('skipped', 'renamed'), ['/lane/checkout/packages/h2a/' + file], [{ file: '/lane/checkout/packages/h2a/' + file, fullName: 'original', status: 'skipped' }]), /not an authorized|disappeared/);
});
test('should execute a controlled child under the guard and reject synthetic state before access', t => {
  const lane = createLane({ sourceRoot: fixture(t), selection: selected });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  const code = `import fs from 'node:fs'; import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process';
    const forbidden=process.env.HOME+'/.config/sentropic/h2a/synthetic-missing';
    assert.throws(()=>fs.readFileSync(forbidden), /forbidden h2a state/);
    const child=spawnSync(process.execPath,['-e','process.stdout.write("controlled child")'],{env:process.env,encoding:'utf8'});
    assert.equal(child.status,0); assert.equal(child.stdout,'controlled child');
    assert.ok(fs.readFileSync(process.env.IDLOCK_LANE+'/owned-pids.txt','utf8').includes(String(child.pid)));
    process.stdout.write('confined');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: lane.checkout, env: lane.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'confined');
});
test('should allow a relative build write inside the lane while refusing a relative state escape', t => {
  const lane = createLane({ sourceRoot: fixture(t), selection: selected });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs'; import assert from 'node:assert/strict';
    fs.mkdirSync('build-output'); fs.writeFileSync('build-output/proof.txt','private');
    assert.throws(()=>fs.writeFileSync('../../outside-lane.txt','forbidden'), /outside isolated lane/);
    assert.throws(()=>fs.readFileSync('../home/.config/sentropic/h2a/synthetic'), /forbidden h2a state/);`], { cwd: lane.checkout, env: lane.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.readFileSync(join(lane.checkout, 'build-output/proof.txt'), 'utf8'), 'private');
});
test('should stop at the first build failure and never reach the test process', t => {
  const dir = temporary(t); const calls = [];
  const lane = { path: dir, checkout: dir, selection: selected, env: {} };
  assert.throws(() => executeLane(lane, { run: (command, args) => { calls.push(args); return { status: calls.length === 2 ? 7 : 0, stdout: '', stderr: '' }; } }), /build.*7/);
  assert.equal(calls.length, 2);
});
test('should fail when a successful build command did not produce checkout dist', t => {
  const dir = temporary(t); let calls = 0;
  const lane = { path: dir, checkout: dir, selection: selected, env: {} };
  assert.throws(() => executeLane(lane, { run: () => { calls++; return { status: 0, stdout: '', stderr: '' }; } }), /missing.*build/i);
  assert.equal(calls, 4);
});
test('should require source fixtures rather than inventing a successful fixture run', t => {
  const sourceRoot = fixture(t);
  fs.writeFileSync(join(sourceRoot, 'packages/h2a/test/velocity-test-lane.test.js'), "import test from 'node:test'; import fs from 'node:fs'; test('missing fixture fails', () => fs.readFileSync(new URL('./fixtures/absent.json', import.meta.url)));\n");
  const lane = createLane({ sourceRoot, selection: selected });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  // Unit adapter supplies build artifacts, then executes the real named Node test.
  const run = (command, args, options) => {
    if (args[0] !== 'node' && command !== 'node' && command !== process.execPath) {
      for (const entry of ['agent-stats/dist/index.js', 'h2a/dist/bin.js', 'h2a-runtime/dist/index.js']) {
        const target = join(lane.checkout, 'packages', entry);
        fs.mkdirSync(resolve(target, '..'), { recursive: true }); fs.writeFileSync(target, '');
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    return spawnSync(command, args, options);
  };
  assert.throws(() => executeLane(lane, { run }), /test.*failed|did not pass|failed assertion/i);
  assert.match(fs.readFileSync(join(lane.path, 'command-4.log'), 'utf8'), /ENOENT.*absent\.json/s);
});
test('should use the same direct tools and execution proof when RTK is unavailable on CI', t => {
  const lane = createLane({ sourceRoot: fixture(t), selection: selected });
  t.after(() => fs.rmSync(lane.path, { recursive: true, force: true }));
  const calls = [];
  const run = (command, args, options) => {
    calls.push([command, ...args]);
    if (command === 'rtk') return { status: null, error: { code: 'ENOENT' } };
    if (command === process.execPath || command === 'node') return spawnSync(command, args, options);
    for (const entry of ['agent-stats/dist/index.js', 'h2a/dist/bin.js', 'h2a-runtime/dist/index.js']) {
      const target = join(lane.checkout, 'packages', entry);
      fs.mkdirSync(resolve(target, '..'), { recursive: true }); fs.writeFileSync(target, '');
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.deepEqual(executeLane(lane, { run }), { passed: 1, excluded: 0 });
  assert.equal(calls.filter(call => call[0] === 'npm').length, 4);
  assert.equal(calls.filter(call => call[0] === process.execPath || call[0] === 'node').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(join(lane.path, 'commands.json'), 'utf8')).at(-1).command, process.execPath);
});
