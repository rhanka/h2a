import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runDaily } from '../src/vuln-fix/controller.mjs';

const seats = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, profile: index % 2 ? 'claude' : 'codex', model: `model-${id}`, effort: 'high' }));
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vuln-controller-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [], sha = 'a'.repeat(40);
  const config = { stateDir: root, repositories: [{ path: '/repo', github: 'rhanka/fixture', tests: [{ command: 'node', args: ['--test', 'fixture.test.js'] }] }], seats };
  const runner = {
    available: async seat => { calls.push(`admit:${seat.id}`); return { available: true, guardQualified: true, reservePercent: 50, remainingUnits: 10 }; },
    run: async task => { calls.push(`${task.kind}:${task.seat.id}:${task.workspace}`);
      if (task.kind === 'author') {
        assert.equal(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).attempts['rhanka/fixture/2026-10-17'].status, 'claimed');
        return { code: 0 };
      }
      return { code: 0, stdout: JSON.stringify({ approved: true, sha, findings: [] }) };
    }, ...overrides.runner,
  };
  let scanCount = 0;
  const repo = {
    workspace: '/repo/tmp/worktrees/author', locks: ['package-lock.json'],
    prepare: async () => { calls.push('prepare'); return 'b'.repeat(40); },
    scan: async () => ({ complete: true, errors: [], findings: scanCount++ ? [] : [{ id: 'CVE-fixture', severity: 'high' }] }),
    existingPr: async () => undefined,
    install: async () => [], tests: async () => [{ ok: true, code: 0 }],
    begin: async () => { calls.push('begin'); return 'security/daily-vuln-fixture'; },
    generateFix: async () => [], authorContext: async () => '.h2a/vuln-fix-author/findings.json', seal: async () => sha,
    supplyChain: async () => ({ ok: true }),
    assertHead: async () => {},
    openDraft: async () => { calls.push('draft'); return 'https://github.com/rhanka/fixture/pull/1'; },
    reviewWorkspace: async index => `/repo/tmp/worktrees/review-${index}`,
    ready: async () => { calls.push('ready'); }, cleanup: async () => { calls.push('cleanup'); },
    ...overrides.repo,
  };
  const options = { runner, repository: () => repo, now: () => new Date('2026-10-17T03:00:00Z') };
  return { root, calls, config, options, repo, runner, sha };
}

test('should reserve before inference and ready only after two blind reviews on distinct workspaces', async t => {
  const f = fixture(t);
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'ready');
  assert.equal(report.ok, true);
  assert.ok(f.calls.indexOf('draft') < f.calls.findIndex(x => x.startsWith('review:')));
  assert.equal(f.calls.filter(x => x.startsWith('review:')).length, 2);
  assert.notEqual(f.calls.filter(x => x.startsWith('review:'))[0].split(':').at(-1), f.calls.filter(x => x.startsWith('review:'))[1].split(':').at(-1));
  assert.match(readFileSync(join(f.root, 'latest.json'), 'utf8'), /findings=1 prs=1/);
});

test('should dry-run scans without admission, inference, publication or durable claims', async t => {
  const f = fixture(t);
  const report = await runDaily(f.config, { ...f.options, dryRun: true });
  assert.equal(report.repositories[0].status, 'would-attempt');
  assert.deepEqual(f.calls, ['prepare', 'cleanup']);
  assert.throws(() => readFileSync(join(f.root, 'state.json')));
  assert.match(readFileSync(join(f.root, 'latest-dry-run.json'), 'utf8'), /dry-run/);
});

test('should retain the daily claim after author failure and never dispatch a second attempt', async t => {
  const f = fixture(t, { runner: { run: async task => { if (task.kind === 'author') throw new Error('author crashed'); } } });
  const first = await runDaily(f.config, f.options);
  assert.equal(first.repositories[0].status, 'failed');
  f.repo.scan = async () => first.repositories[0].before;
  const second = await runDaily(f.config, f.options);
  assert.equal(second.repositories[0].status, 'already-attempted');
  assert.equal(f.calls.filter(x => x === 'begin').length, 1);
});

test('should persist rotation across UTC days and account for unavailable seats', async t => {
  const f = fixture(t);
  await runDaily(f.config, f.options);
  f.repo.scan = async () => ({ complete: true, errors: [], findings: [{ severity: 'critical' }] });
  const next = await runDaily(f.config, { ...f.options, now: () => new Date('2026-10-18T03:00:00Z') });
  assert.equal(next.repositories[0].author.id, 'b');
  assert.equal(JSON.parse(readFileSync(join(f.root, 'state.json'), 'utf8')).cursor, 2);
});

test('should refuse inference when quota is unknown, reserve is 20 percent, or reviewers are unavailable', async t => {
  const f = fixture(t, { runner: { available: async seat => seat.id === 'a'
    ? { available: true, guardQualified: true, remainingUnits: 5, reservePercent: 50 }
    : { available: true, guardQualified: true, remainingUnits: 5, reservePercent: 20 } } });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'failed');
  assert.ok(!f.calls.some(x => x.startsWith('author:')));
  assert.throws(() => readFileSync(join(f.root, 'state.json')));
});

test('should leave draft when a reviewer rejects or returns a receipt for another SHA', async t => {
  const f = fixture(t);
  const original = f.runner.run;
  f.runner.run = async task => task.kind === 'author' ? original(task)
    : { code: 0, stdout: JSON.stringify({ approved: true, sha: 'wrong-sha', findings: [] }) };
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'draft-blocked');
  assert.ok(!f.calls.includes('ready'));
  assert.equal(report.ok, false);
});

test('should block ready on failed tests, unresolved findings, incomplete scan or missing provenance', async t => {
  for (const failure of ['tests', 'findings', 'incomplete', 'provenance']) {
    const f = fixture(t);
    if (failure === 'tests') f.repo.tests = async phase => [{ ok: phase === 'before' }];
    if (failure === 'findings') f.repo.scan = async () => ({ complete: true, findings: [{ severity: 'high' }] });
    if (failure === 'incomplete') { let i = 0; f.repo.scan = async () => ({ complete: i++ === 0, findings: [{ severity: 'high' }], errors: ['network'] }); }
    if (failure === 'provenance') f.repo.supplyChain = async () => ({ ok: false, errors: ['missing provenance'] });
    const report = await runDaily(f.config, f.options);
    assert.equal(report.repositories[0].status, 'draft-blocked', failure);
    assert.ok(!f.calls.includes('ready'), failure);
  }
});

test('should reject changes to the verified candidate before publication', async t => {
  const f = fixture(t, { repo: { assertHead: async () => { throw new Error('candidate changed'); } } });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'failed');
  assert.ok(!f.calls.includes('draft'));
});

test('should reconcile an existing PR before any inference', async t => {
  const f = fixture(t, { repo: { existingPr: async () => ({ url: 'https://github.com/rhanka/fixture/pull/9', headRefOid: 'sha' }) } });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'existing-pr');
  assert.deepEqual(f.calls, ['prepare', 'cleanup']);
});

test('should block ambiguous prior publication rather than create another PR the next day', async t => {
  const f = fixture(t, { repo: { openDraft: async () => { throw new Error('lost create response'); } } });
  await runDaily(f.config, f.options);
  f.repo.scan = async () => ({ complete: true, findings: [{ severity: 'high' }] });
  const report = await runDaily(f.config, { ...f.options, now: () => new Date('2026-10-18') });
  assert.match(report.repositories[0].error, /publication requires reconciliation/);
  assert.equal(f.calls.filter(x => x === 'begin').length, 1);
});

test('should continue other repositories and expose cleanup failures', async t => {
  const f = fixture(t, { repo: { scan: async () => ({ complete: false, findings: [], errors: ['bad audit'] }), cleanup: async () => { throw new Error('busy'); } } });
  f.config.repositories.push({ ...f.config.repositories[0], path: '/repo2', github: 'rhanka/fixture2' });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories.length, 2);
  assert.equal(report.failures.length, 4);
  assert.equal(report.ok, false);
});

test('should refuse a concurrent controller without deleting its lock', async t => {
  const f = fixture(t);
  let continueScan, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.repo.scan = async () => { entered(); await new Promise(resolve => { continueScan = resolve; }); return { complete: true, findings: [] }; };
  const first = runDaily(f.config, f.options);
  await started;
  await assert.rejects(runDaily(f.config, f.options), /locked/);
  assert.ok(readFileSync(join(f.root, 'controller.lock')).length);
  continueScan();
  await first;
});

test('should keep an existing unverified draft visibly blocked on later nights', async t => {
  const f = fixture(t, { repo: { existingPr: async () => ({ url: 'https://github.com/rhanka/fixture/pull/9', headRefOid: 'sha', isDraft: true }) } });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.ok, false);
  assert.match(report.summary, /blocked=1/);
});

test('should reserve a shared CLI budget rather than count each model as a separate daily budget', async t => {
  const f = fixture(t, { runner: { available: async () => ({ available: true, guardQualified: true, reservePercent: 50, remainingUnits: 1 }) } });
  const report = await runDaily(f.config, f.options);
  assert.equal(report.repositories[0].status, 'failed');
  assert.ok(!f.calls.some(x => x.startsWith('author:')));
});
