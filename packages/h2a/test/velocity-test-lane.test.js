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
