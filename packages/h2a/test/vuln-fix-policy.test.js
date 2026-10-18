import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { validateConfig, validateLockChange, selectSeats } from '../src/vuln-fix/policy.mjs';
import { acquire, readState, writeJson } from '../src/vuln-fix/state.mjs';

const pkg = version => ({ lockfileVersion: 3, packages: { '': { name: 'fixture' },
  'node_modules/a': { version, resolved: `https://registry.npmjs.org/a/-/a-${version}.tgz` } } });
const seat = (id, profile, model) => ({ id, profile, model, effort: 'high' });
const seats = [seat('a', 'codex', 'author'), seat('b', 'claude', 'review1'), seat('c', 'claude', 'review2'), seat('d', 'codex', 'other')];

test('should reject major, ambiguous, root, registry and new dependency changes', () => {
  assert.doesNotThrow(() => validateLockChange(pkg('1.0.0'), pkg('1.0.1')));
  for (const version of ['2.0.0', 'invalid', '1.1.0-beta.1']) assert.throws(() => validateLockChange(pkg('1.0.0'), pkg(version)));
  const root = pkg('1.0.1'); root.packages[''].name = 'changed';
  assert.throws(() => validateLockChange(pkg('1.0.0'), root), /workspace/);
  const registry = pkg('1.0.1'); registry.packages['node_modules/a'].resolved = 'https://evil.example/a.tgz';
  assert.throws(() => validateLockChange(pkg('1.0.0'), registry), /registry/);
  const added = pkg('1.0.1'); added.packages['node_modules/new'] = { version: '1.0.0' };
  assert.throws(() => validateLockChange(pkg('1.0.0'), added), /new dependency/);
});

test('should rotate authors while requiring two distinct complementary review pairs', () => {
  const selected = selectSeats(seats, 0);
  assert.equal(selected.author.id, 'a');
  assert.deepEqual(selected.reviewers.map(x => x.id), ['b', 'c']);
  assert.equal(selectSeats(seats, selected.cursor).author.id, 'b');
  assert.throws(() => selectSeats(seats.slice(0, 2), 0), /review/);
  assert.throws(() => selectSeats([seats[0], seats[1], { ...seats[1], id: 'alias' }], 0), /distinct/);
});

test('should reject unsafe configuration and full-suite test commands', () => {
  const config = { stateDir: '/state', repositories: [{ path: '/repo', github: 'rhanka/example',
    tests: [{ command: 'node', args: ['--test', 'test/fixture.test.js'] }] }], seats };
  assert.doesNotThrow(() => validateConfig(config));
  for (const tests of [[], [{ command: 'npm', args: ['test'] }], [{ command: 'node', args: ['--test'] }],
    [{ command: 'npx', args: ['vitest', 'run'] }]]) {
    assert.throws(() => validateConfig({ ...config, repositories: [{ ...config.repositories[0], tests }] }));
  }
  assert.throws(() => validateConfig({ ...config, repositories: [config.repositories[0], config.repositories[0]] }), /duplicate/);
});

test('should serialize controllers and persist state without resetting claims', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vuln-state-'));
  try {
    const release = await acquire(root);
    await assert.rejects(acquire(root), /locked/);
    writeJson(join(root, 'state.json'), { version: 1, cursor: 2, attempts: { 'repo/2026-10-17': { status: 'claimed' } }, uses: {} });
    await release();
    assert.equal(readState(root).cursor, 2);
    assert.equal(readState(root).attempts['repo/2026-10-17'].status, 'claimed');
    await (await acquire(root))();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('should reject a major bump of one occurrence even when another baseline path already uses that major', () => {
  const before = pkg('1.0.0'), after = pkg('2.0.1');
  before.packages['node_modules/parent/node_modules/a'] = pkg('2.0.0').packages['node_modules/a'];
  after.packages['node_modules/parent/node_modules/a'] = before.packages['node_modules/parent/node_modules/a'];
  assert.throws(() => validateLockChange(before, after), /major bump/);
});

test('should skip infeasible authors instead of getting stuck after the first UTC day', () => {
  const three = seats.slice(0, 3);
  assert.equal(selectSeats(three, 1).author.id, 'a');
  assert.equal(selectSeats(three, 2).author.id, 'a');
});

test('should refuse broad test selectors appended alongside a targeted test file', () => {
  const config = { stateDir: '/state', seats, repositories: [{ path: '/repo', github: 'rhanka/fixture',
    tests: [{ command: 'npx', args: ['--no-install', 'vitest', 'run', 'one.test.js', 'test'] }] }] };
  assert.throws(() => validateConfig(config), /targeted/);
});

test('should release the controller lock after its own process crashes without clearing daily claims', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vuln-crash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const module = new URL('../src/vuln-fix/state.mjs', import.meta.url).href;
  const source = `import {acquire} from ${JSON.stringify(module)}; await acquire(${JSON.stringify(root)}); process.stdout.write('locked'); process.stdin.resume();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, XDG_RUNTIME_DIR: root } });
  await once(child.stdout, 'data');
  const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
  let release;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { release = await acquire(root); break; } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  await release();
});
