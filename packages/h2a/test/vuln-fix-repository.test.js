import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { command, checked } from '../src/vuln-fix/process.mjs';
import { Repository } from '../src/vuln-fix/repository.mjs';
import { runDaily } from '../src/vuln-fix/controller.mjs';

const lock = version => ({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: {
  '': { name: 'fixture', version: '1.0.0' }, 'node_modules/unsafe': {
    version, integrity: `sha512-fixture-${version}`, resolved: `https://registry.npmjs.org/unsafe/-/unsafe-${version}.tgz`,
  },
} });

async function fixture(t, { nested = false, badScope = false, major = false, remoteChanged = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vuln-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'repo'), remote = join(root, 'origin.git'), runtime = join(root, 'runtime');
  mkdirSync(path); mkdirSync(runtime);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'), H2A_ROOT: join(root, 'h2a') };
  const raw = (cmd, args, opts = {}) => command(cmd, args, { ...opts, env: { ...env, ...opts.env } });
  const git = (args, cwd = path) => checked('git', args, { cwd }, raw);
  await git(['init', '--bare', remote], root);
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']); await git(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(path, '.gitignore'), 'tmp/\nnode_modules/\n.h2a/\n');
  writeFileSync(join(path, 'package.json'), '{"name":"fixture","version":"1.0.0","type":"module"}\n');
  writeFileSync(join(path, 'package-lock.json'), JSON.stringify(lock('1.0.0')));
  writeFileSync(join(path, 'fixture.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('fixture', () => assert.equal(1+1, 2));\n");
  if (nested) {
    mkdirSync(join(path, 'apps', 'a'), { recursive: true });
    writeFileSync(join(path, 'apps/a/package.json'), '{"name":"nested","version":"1.0.0"}');
    writeFileSync(join(path, 'apps/a/package-lock.json'), JSON.stringify(lock('1.0.0')));
  }
  await git(['add', '.gitignore', 'package.json', 'package-lock.json', 'fixture.test.js', ...(nested ? ['apps'] : [])]);
  await git(['commit', '-m', 'test: create isolated fixture']);
  await git(['remote', 'add', 'origin', remote]); await git(['push', 'origin', 'main']);
  const baseline = await git(['rev-parse', 'HEAD']);
  const calls = [];
  const execute = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (cmd === 'git' && args[0] === 'remote' && args[1] === 'get-url') return { code: 0, stdout: 'https://github.com/rhanka/fixture.git\n', stderr: '' };
    if (cmd === 'npm') {
      if (args[0] === 'audit' && args[1] === 'fix') {
        writeFileSync(join(opts.cwd, 'package-lock.json'), JSON.stringify(lock(major ? '2.0.0' : '1.0.1')));
        if (badScope) writeFileSync(join(opts.cwd, 'package.json'), '{"name":"outside-scope"}');
        return { code: 0, stdout: 'compatible lock update', stderr: '' };
      }
      if (args[0] === 'audit' && args[1] === '--json') {
        const version = JSON.parse(readFileSync(join(opts.cwd, 'package-lock.json'), 'utf8')).packages['node_modules/unsafe'].version;
        return { code: version === '1.0.0' ? 1 : 0, stdout: JSON.stringify({ vulnerabilities: version === '1.0.0' ? {
          unsafe: { name: 'unsafe', severity: 'high', nodes: ['node_modules/unsafe'], via: [{ source: 42 }] },
        } : {} }), stderr: '' };
      }
      if (args[0] === 'view') return { code: 0, stdout: JSON.stringify({ time: { '1.0.1': '2026-10-01' }, dist: {
        integrity: 'sha512-fixture-1.0.1', signatures: [{ sig: 'fixture' }], attestations: { provenance: { predicateType: 'fixture' } },
      } }), stderr: '' };
      return { code: 0, stdout: 'fixture npm verification', stderr: '' };
    }
    if (cmd === 'gh') {
      if (args[1] === 'list') return { code: 0, stdout: '[]', stderr: '' };
      if (args[1] === 'create') {
        assert.equal(args.includes('--draft'), true);
        assert.match(readFileSync(args[args.indexOf('--body-file') + 1], 'utf8'), /Merge remains/);
        return { code: 0, stdout: 'https://github.com/rhanka/fixture/pull/1', stderr: '' };
      }
      if (args[1] === 'view') return { code: 0, stdout: JSON.stringify({ headRefOid: remoteChanged ? 'changed' : await git(['rev-parse', 'HEAD'], opts.cwd), isDraft: true }), stderr: '' };
      if (args[1] === 'ready') return { code: 0, stdout: '', stderr: '' };
      throw new Error('unexpected gh operation');
    }
    return raw(cmd, args, opts);
  };
  const spec = { path, github: 'rhanka/fixture', osv: false, tests: [{ command: 'node', args: ['--test', 'fixture.test.js'] }] };
  const config = { stateDir: join(root, 'controller'), repositories: [spec], seats: [
    { id: 'a', profile: 'codex', model: 'author', effort: 'high' },
    { id: 'b', profile: 'claude', model: 'review1', effort: 'high' },
    { id: 'c', profile: 'claude', model: 'review2', effort: 'high' },
  ] };
  const runner = {
    available: async () => ({ available: true, guardQualified: true, reservePercent: 50, remainingUnits: 10 }),
    run: async task => {
      calls.push({ cmd: 'seat', task });
      assert.ok(task.workspace.startsWith(join(path, 'tmp/worktrees/')));
      return { code: 0, stdout: JSON.stringify({ approved: true, sha: task.sha, findings: [] }) };
    },
  };
  const repo = new Repository(spec, { execute });
  const options = { runner, repository: () => repo, now: () => new Date('2026-10-17T03:00:00Z') };
  return { path, root, git, baseline, calls, repo, config, options };
}

test('should fix nested lock domains in isolated worktrees and publish a reviewed fixed SHA', async t => {
  const f = await fixture(t, { nested: true });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'ready', JSON.stringify(report.failures));
  assert.equal(report.repositories[0].before.findings.length, 2);
  assert.equal(report.repositories[0].after.findings.length, 0);
  assert.equal(report.repositories[0].testsBefore[0].code, 0);
  assert.equal(report.repositories[0].testsAfter[0].code, 0);
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.baseline);
  assert.equal(await f.git(['branch', '--show-current']), 'main');
  assert.equal(JSON.parse(readFileSync(join(f.path, 'package-lock.json'), 'utf8')).packages['node_modules/unsafe'].version, '1.0.0');
  assert.equal(f.calls.filter(x => x.cmd === 'gh' && x.args[1] === 'ready').length, 1);
  assert.ok(f.calls.every(x => x.cmd !== 'gh' || !x.args.includes('merge')));
  const worktrees = await f.git(['worktree', 'list', '--porcelain']);
  assert.equal((worktrees.match(/^worktree /gm) ?? []).length, 1);
});

test('should reject out-of-scope and major patches before pushing a branch', async t => {
  for (const flags of [{ badScope: true }, { major: true }]) {
    const f = await fixture(t, flags);
    const report = await runDaily(f.config, f.options);
    assert.equal(report.repositories[0].status, 'failed');
    assert.match(report.repositories[0].error, /scope|major bump/);
    assert.ok(!f.calls.some(x => x.cmd === 'gh' && x.args[1] === 'create'));
  }
});

test('should refuse ready when GitHub head changes after independent review', async t => {
  const f = await fixture(t, { remoteChanged: true });
  const report = await runDaily(f.config, f.options);
  assert.match(report.repositories[0].error, /PR head/);
  assert.ok(!f.calls.some(x => x.cmd === 'gh' && x.args[1] === 'ready'));
});

test('should refuse a symlinked lock or mismatched remote before running scanners', async t => {
  const f = await fixture(t);
  const original = f.repo.execute;
  f.repo.execute = async (cmd, args, opts) => cmd === 'git' && args[0] === 'remote'
    ? { code: 0, stdout: 'https://github.com/foreign/fixture.git', stderr: '' } : original(cmd, args, opts);
  await assert.rejects(f.repo.prepare(), /origin/);
  assert.ok(!f.calls.some(x => x.cmd === 'npm'));
  f.repo.execute = original;
  await f.repo.prepare();
  rmSync(join(f.repo.workspace, 'package-lock.json'));
  symlinkSync(join(f.path, 'package-lock.json'), join(f.repo.workspace, 'package-lock.json'));
  assert.throws(() => f.repo.file('package-lock.json'), /unsafe/);
  await f.repo.cleanup();
});

test('should fail targeted verification when a command succeeds without evidence of executed tests', async t => {
  const f = await fixture(t);
  await f.repo.prepare();
  const original = f.repo.execute;
  f.repo.execute = async (cmd, args, opts) => cmd === 'node' ? { code: 0, stdout: '', stderr: '' } : original(cmd, args, opts);
  await assert.rejects(f.repo.tests('before'), /verification/);
  await f.repo.cleanup();
});

test('should fail the strict gate on vitest todo output despite exit 0', async () => {
  const repo = Object.create(Repository.prototype);
  repo.spec = { tests: [{ command: 'node', args: ['--test', 'fixture.test.js'] }] };
  repo.workspace = '/fixture';
  repo.file = () => '/fixture/fixture.test.js';
  repo.execute = async () => ({ code: 0, stdout: 'Test Files 1 passed (1)\nTests 1 passed | 1 todo (2)\n', stderr: '', signal: null });
  const results = await repo.tests('after');
  assert.equal(results[0].ok, false);
  await assert.rejects((async () => {
    repo.execute = async () => ({ code: 0, stdout: 'Test Files 1 passed (1)\nTests 1 passed | 1 todo (2)\n', stderr: '', signal: null });
    await repo.tests('before');
  })(), /verification/);
});

test('should never read a test name as a todo counter', async () => {
  const repo = Object.create(Repository.prototype);
  repo.spec = { tests: [{ command: 'node', args: ['--test', 'fixture.test.js'] }] };
  repo.workspace = '/fixture';
  repo.file = () => '/fixture/fixture.test.js';
  const tap = ['TAP version 13', '# Subtest: handles todo 1 correctly', 'ok 1 - handles todo 1 correctly',
    '  ---', '  duration_ms: 1', '  ...', '# tests 1', '# suites 0', '# pass 1', '# fail 0',
    '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 100'].join('\n') + '\n';
  repo.execute = async () => ({ code: 0, stdout: tap, stderr: '', signal: null });
  assert.equal((await repo.tests('after'))[0].ok, true);
  repo.execute = async () => ({ code: 0, stdout: tap.replace('# todo 0', '# todo 2'), stderr: '', signal: null });
  assert.equal((await repo.tests('after'))[0].ok, false);
});

test('should accept the node 24 spec reporter summary as executed evidence', async () => {
  const repo = Object.create(Repository.prototype);
  repo.spec = { tests: [{ command: 'node', args: ['--test', 'fixture.test.js'] }] };
  repo.workspace = '/fixture';
  repo.file = () => '/fixture/fixture.test.js';
  const summary = ['✔ fixture (0.937833ms)', 'ℹ tests 1', 'ℹ suites 0', 'ℹ pass 1', 'ℹ fail 0',
    'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 85.48267'].join('\n') + '\n';
  repo.execute = async () => ({ code: 0, stdout: summary, stderr: '', signal: null });
  assert.equal((await repo.tests('after'))[0].ok, true);
  for (const skipped of ['ℹ skipped 1', 'ℹ todo 2', 'ℹ cancelled 1']) {
    repo.execute = async () => ({ code: 0, stdout: summary.replace('ℹ skipped 0', skipped).replace('ℹ todo 0', skipped), stderr: '', signal: null });
    assert.equal((await repo.tests('after'))[0].ok, false, skipped);
  }
  repo.execute = async () => ({ code: 0, stdout: summary.replace('ℹ tests 1', 'ℹ tests 0').replace('ℹ pass 1', 'ℹ pass 0'), stderr: '', signal: null });
  assert.equal((await repo.tests('after'))[0].ok, false);
});

test('should mask credentials in verification outputs and failure summaries', async () => {
  const repo = Object.create(Repository.prototype);
  repo.spec = { tests: [{ command: 'node', args: ['--test', 'fixture.test.js'] }] };
  repo.workspace = '/fixture';
  repo.file = () => '/fixture/fixture.test.js';
  const raw = 'repo-fake-credential-987654321';
  repo.execute = async () => ({ code: 0, stdout: `# tests 1\n# pass 1\nAuthorization: Bearer ${raw}\n`, stderr: '', signal: null });
  const results = await repo.tests('after');
  assert.equal(results[0].ok, true);
  assert.ok(!JSON.stringify(results).includes(raw));
  repo.execute = async () => ({ code: 0, stdout: `no test evidence; Authorization: Bearer ${raw}\n`, stderr: '', signal: null });
  await assert.rejects(repo.tests('before'), error => !JSON.stringify([error.checks, error.message]).includes(raw));
});

test('should force full dev/optional/peer coverage on install and compatible fix', async () => {
  const repo = Object.create(Repository.prototype);
  repo.locks = ['package-lock.json'];
  repo.workspace = '/fixture';
  const seen = [];
  repo.execute = async (cmd, args, opts) => { seen.push([cmd, args]); return { code: 0, stdout: 'ok', stderr: '' }; };
  await repo.install();
  await repo.generateFix();
  assert.equal(seen.length, 2);
  for (const [, args] of seen) {
    for (const flag of ['--include=dev', '--include=optional', '--include=peer']) assert.ok(args.includes(flag), `npm misses ${flag}`);
  }
});

test('should give a read-only reviewer pinned baseline, candidate, diff and verification artifacts', async t => {
  const f = await fixture(t);
  await f.repo.prepare(); await f.repo.begin('2026-10-17'); await f.repo.generateFix();
  const sha = await f.repo.seal();
  const workspace = await f.repo.reviewWorkspace(0, sha, { note: 'trusted controller evidence' });
  const artifacts = join(workspace, '.h2a/vuln-fix-review');
  assert.match(readFileSync(join(artifacts, 'diff.patch'), 'utf8'), /1\.0\.0/);
  assert.match(readFileSync(join(artifacts, 'diff.patch'), 'utf8'), /1\.0\.1/);
  assert.match(readFileSync(join(artifacts, 'evidence.json'), 'utf8'), /trusted controller evidence/);
  assert.equal(JSON.parse(readFileSync(join(artifacts, 'locks-before.json'), 'utf8'))['package-lock.json'].packages['node_modules/unsafe'].version, '1.0.0');
  await f.repo.cleanup();
});
