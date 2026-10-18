import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as controller from '../src/vuln-fix/controller.mjs';
import { command, checked } from '../src/vuln-fix/process.mjs';
import { validateLockChange } from '../src/vuln-fix/policy.mjs';
import { acquire, readState, writeJson } from '../src/vuln-fix/state.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lock = version => ({ lockfileVersion: 3, packages: {
  '': { name: 'qualification-fixture', version: '1.0.0' },
  'node_modules/fixture': { version, integrity: `sha512-fixture-${version}`,
    resolved: `https://registry.npmjs.org/fixture/-/fixture-${version}.tgz` },
} });
const identity = (id, profile, role) => ({ id, profile, model: `fixture-${id}`,
  usages: ['vulnerability-remediation'], roles: [role] });

async function fixture(t, { regression = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vuln-merge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'repo'), remote = join(root, 'remote.git'), stateDir = join(root, 'state');
  for (const name of ['repo', 'home', 'runtime', 'tmp', 'config']) mkdirSync(join(root, name));
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'runtime'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: stateDir, TMPDIR: join(root, 'tmp'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Qualification', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Qualification', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const execute = (cmd, args, options = {}) => command(cmd, args, { ...options, env });
  const git = (args, cwd = path, input) => checked('git', args, { cwd, input }, execute);
  await git(['init', '--bare', remote], root);
  await git(['init', '-b', 'main']);
  writeFileSync(join(path, 'package-lock.json'), JSON.stringify(lock('1.0.0')));
  writeFileSync(join(path, 'fixture.test.cjs'), "const {test}=require('node:test'); const assert=require('node:assert/strict'); const lock=require('./package-lock.json'); test('qualified dependency behavior',()=>assert.equal(" +
    (regression === true ? "lock.packages['node_modules/fixture'].version,'1.0.1'" : "lock.lockfileVersion,3") + '));\n' +
    (regression === 'unrelated' ? "test('unrelated assertion',()=>assert.equal(lock.packages['node_modules/fixture'].version,'1.0.1'));\n" : ''));
  await git(['add', 'package-lock.json', 'fixture.test.cjs']);
  await git(['commit', '-m', 'test: create controlled dependency fixture']);
  await git(['remote', 'add', 'origin', remote]);
  await git(['push', 'origin', 'main']);
  const base = await git(['rev-parse', 'HEAD']);
  const testSpec = { command: 'node', args: ['--test', 'fixture.test.cjs'],
    ...(regression ? { redBefore: true, regression: { id: 'fixture-version', assertion: 'qualified dependency behavior' } } : {}) };
  const testsBefore = [{ ...testSpec, ...await execute('node', testSpec.args, { cwd: path }),
    ...(regression ? { failureKind: 'assertion', regressionId: 'fixture-version' } : {}) }];
  const branch = 'security/daily-vuln-qualification';
  await git(['checkout', '-b', branch]);
  writeFileSync(join(path, 'package-lock.json'), JSON.stringify(lock('1.0.1')));
  await git(['add', 'package-lock.json']);
  await git(['commit', '-m', 'fix(security): update controlled dependency fixture']);
  const sha = await git(['rev-parse', 'HEAD']);
  await git(['push', 'origin', branch]);
  const testsAfter = [{ ...testSpec, ...await execute('node', testSpec.args, { cwd: path }) }];
  const before = { complete: true, findings: [{ source: 'qualification', id: 'fixture-high', severity: 'high' }] };
  const after = { complete: true, findings: [] };
  const candidate = { version: 1, repository: 'rhanka/qualification-fixture',
    pr: 'https://github.com/rhanka/qualification-fixture/pull/1', branch, base, sha,
    status: 'ready', author: identity('author', 'muse', 'author'),
    reviewers: [identity('review-a', 'codex', 'reviewer'), identity('review-b', 'codex', 'reviewer')],
    requiredChecks: ['targeted-tests'], tests: [testSpec], targets: before.findings,
    proofDigests: { guard: digest('guard'), tests: digest([testSpec]), verification: digest({ before, after, testsBefore, testsAfter }) } };
  const evidence = { base, sha, before, after, testsBefore, testsAfter,
    lockPolicy: { lockOnly: true, compatible: true, noMajors: true, noNewPackages: true },
    modifiedPackages: ['fixture@1.0.1'], packages: [{ name: 'fixture', version: '1.0.1', publishedAt: '2026-10-01T00:00:00Z',
      integrityVerified: true, signatureVerified: true, provenanceVerified: true }] };
  const observation = { ownership: { repository: candidate.repository, pr: candidate.pr, branch, base, sha },
    proofDigests: candidate.proofDigests,
    reviews: candidate.reviewers.map(seat => ({ ...seat, sha, approved: true, findings: [], receiptId: `review:${seat.id}` })),
    checks: [{ name: 'targeted-tests', sha, status: 'completed', conclusion: 'success' }],
    blockingThreads: 0, rules: { satisfied: true, method: 'merge', adminBypass: false }, evidence };
  let merges = 0, observations = 0, loseAcknowledgement = false;
  const adapter = {
    observe: async () => {
      observations++;
      const head = await git(['rev-parse', `refs/heads/${branch}`], remote);
      const target = await git(['rev-parse', 'refs/heads/main'], remote);
      const parents = (await git(['show', '-s', '--format=%P', target], remote)).split(' ');
      const merged = parents.length === 2 && parents[0] === base && parents[1] === sha;
      validateLockChange(lock('1.0.0'), lock('1.0.1'));
      assert.equal(await git(['diff', '--name-only', base, sha]), 'package-lock.json');
      return { ...structuredClone(observation),
        ownership: { ...observation.ownership, sha: head, base: merged ? base : target },
        mergeState: merged ? 'merged' : 'not-started', ...(merged ? { mergeSha: target } : {}) };
    },
    merge: async (saved, options) => {
      assert.equal(options.expectedHead, sha); assert.equal(options.expectedBase, base);
      assert.equal(options.method, 'merge');
      const persisted = readState(stateDir).candidates[saved.pr];
      assert.equal(persisted.status, 'merge-pending');
      assert.equal(persisted.mergeIntent.id, options.intentId);
      const tree = await git(['rev-parse', `${sha}^{tree}`], remote);
      const mergeSha = await git(['commit-tree', tree, '-p', base, '-p', sha, '-m', 'fix(security): merge qualified dependency fixture'], remote);
      // One atomic transaction protects BOTH expected refs on the temporary remote.
      await git(['update-ref', '--stdin'], remote,
        `start\nverify refs/heads/${branch} ${sha}\nupdate refs/heads/main ${mergeSha} ${base}\nprepare\ncommit\n`);
      merges++;
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('lost merge acknowledgement'); }
      return { mergeSha };
    },
  };
  const state = { ...readState(stateDir), candidates: { [candidate.pr]: candidate }, uses: { '2026-10-17/codex': 2, '2026-10-17/muse': 1 } };
  writeJson(join(stateDir, 'state.json'), state);
  const run = async (now = '2026-10-17T23:59:00Z', options = {}) => {
    assert.equal(typeof controller.reconcileCandidate, 'function', 'placement-independent merge reconciliation must exist');
    const release = await acquire(stateDir);
    try {
      const current = readState(stateDir);
      return await controller.reconcileCandidate(current.candidates[candidate.pr], adapter, next => {
        current.candidates[candidate.pr] = next;
        writeJson(join(stateDir, 'state.json'), current);
      }, { now: new Date(now), admissionsOpen: true, ...options });
    } finally { await release(); }
  };
  return { root, path, remote, stateDir, git, candidate, observation, adapter, run,
    loseAcknowledgement: () => { loseAcknowledgement = true; }, counts: () => ({ merges, observations }),
    saved: () => readState(stateDir).candidates[candidate.pr] };
}

test('should merge a qualified audit RED to GREEN candidate once with ordinary tests GREEN to GREEN', async t => {
  const f = await fixture(t);
  assert.equal(f.observation.evidence.testsBefore[0].code, 0);
  assert.equal(f.observation.evidence.testsAfter[0].code, 0);
  const merged = await f.run();
  assert.equal(merged.status, 'merged', merged.reason);
  assert.match(merged.mergeSha, /^[a-f0-9]{40}$/);
  assert.equal((await f.git(['show', '-s', '--format=%P', merged.mergeSha], f.remote)).split(' ').length, 2);
  await f.run();
  assert.equal(f.counts().merges, 1);
  assert.deepEqual(readState(f.stateDir).uses, { '2026-10-17/codex': 2, '2026-10-17/muse': 1 });
});

test('should persist pending checks then resume after restart and UTC rollover without repeating completed work', async t => {
  const f = await fixture(t);
  f.observation.checks[0].status = 'in_progress'; f.observation.checks[0].conclusion = null;
  assert.equal((await f.run()).status, 'waiting-checks');
  assert.match(f.saved().nextAttemptAt, /^2026-10-18T/);
  assert.equal(f.counts().merges, 0);
  f.observation.checks[0].status = 'completed'; f.observation.checks[0].conclusion = 'success';
  assert.equal((await f.run('2026-10-18T00:05:00Z')).status, 'merged');
  await f.run('2026-10-18T00:06:00Z');
  assert.equal(f.counts().merges, 1);
  assert.equal(readState(f.stateDir).uses['2026-10-17/codex'], 2);
  assert.equal(readState(f.stateDir).uses['2026-10-18/codex'], undefined);
});

test('should mature trusted packages across restart without a new author or reviews', async t => {
  const f = await fixture(t);
  f.observation.evidence.packages[0].publishedAt = '2026-10-11T00:00:00Z';
  assert.equal((await f.run()).status, 'waiting-age');
  assert.equal(f.saved().nextAttemptAt, '2026-10-18T00:00:00.000Z');
  assert.equal((await f.run('2026-10-18T00:00:00Z')).status, 'merged');
  assert.equal(f.counts().merges, 1);
  assert.equal(readState(f.stateDir).uses['2026-10-17/codex'], 2);
});

test('should reconcile a lost merge acknowledgement before a duplicate completion event', async t => {
  const f = await fixture(t);
  f.loseAcknowledgement();
  assert.equal((await f.run()).status, 'merge-pending');
  assert.ok(f.saved().mergeIntent.id);
  assert.equal((await f.run('2026-10-18T00:05:00Z')).status, 'merged');
  await f.run('2026-10-18T00:06:00Z');
  assert.equal(f.counts().merges, 1);
});

test('should accept an applicable named assertion RED separately from ordinary tests', async t => {
  const f = await fixture(t, { regression: true });
  assert.equal(f.observation.evidence.testsBefore[0].code, 1);
  assert.equal(f.observation.evidence.testsAfter[0].code, 0);
  assert.equal((await f.run()).status, 'merged');
});

test('should reject an unrelated assertion failure even when the named regression passes', async t => {
  const f = await fixture(t, { regression: 'unrelated' });
  assert.equal((await f.run()).status, 'needs-revalidation');
  assert.equal(f.counts().merges, 0);
});

test('should require actual HIGH or CRITICAL baseline detection rather than a declared target severity', async t => {
  const f = await fixture(t);
  f.observation.evidence.before.findings[0].severity = 'low';
  assert.equal((await f.run()).status, 'needs-revalidation');
  assert.equal(f.counts().merges, 0);
});

test('should reconcile owned durable candidates before a clean scan and an existing daily claim', async t => {
  const f = await fixture(t);
  const state = readState(f.stateDir);
  state.attempts['rhanka/qualification-fixture/2026-10-17'] = { status: 'ready' };
  writeJson(join(f.stateDir, 'state.json'), state);
  const repo = { observeCandidate: f.adapter.observe, mergeCandidate: f.adapter.merge,
    prepare: async () => f.candidate.base, scan: async () => ({ complete: true, findings: [] }), cleanup: async () => {} };
  const report = await controller.runDaily({ stateDir: f.stateDir, seats: [], admissionsOpen: true,
    repositories: [{ path: f.path, github: f.candidate.repository, tests: f.candidate.tests }] }, {
    repository: () => repo, runner: { run: () => assert.fail('completed inference must never rerun') },
    now: () => new Date('2026-10-17T23:59:00Z'),
  });
  assert.equal(f.saved().status, 'merged');
  assert.equal(report.repositories[0].candidates[0].status, 'merged');
  assert.equal(f.counts().merges, 1);
});

const guards = [
  ['one review', f => { f.observation.reviews.pop(); }, 'blocked-review'],
  ['stale review SHA', f => { f.observation.reviews[0].sha = 'f'.repeat(40); }, 'blocked-review'],
  ['blocking review', f => { f.observation.reviews[0].approved = false; }, 'blocked-review'],
  ['blocking thread', f => { f.observation.blockingThreads = 1; }, 'blocked-review'],
  ['test-only reviewer', f => { f.observation.reviews[0].usages = ['test-cli']; }, 'blocked-review'],
  ['duplicate review receipt', f => { f.observation.reviews[1].receiptId = f.observation.reviews[0].receiptId; }, 'blocked-review'],
  ['missing check', f => { f.observation.checks = []; }, 'waiting-checks'],
  ['skipped check', f => { f.observation.checks[0].conclusion = 'skipped'; }, 'waiting-checks'],
  ['red check', f => { f.observation.checks[0].conclusion = 'failure'; }, 'waiting-checks'],
  ['stale check SHA', f => { f.observation.checks[0].sha = 'f'.repeat(40); }, 'waiting-checks'],
  ['duplicate check name', f => { f.observation.checks.push(f.observation.checks[0]); }, 'waiting-checks'],
  ['changed proof digest', f => { f.observation.proofDigests.guard = 'f'.repeat(64); }, 'needs-revalidation'],
  ['incomplete scan', f => { f.observation.evidence.after.complete = false; }, 'needs-revalidation'],
  ['target still present', f => { f.observation.evidence.after.findings = f.candidate.targets; }, 'needs-revalidation'],
  ['new high finding', f => { f.observation.evidence.after.findings = [{ source: 'qualification', id: 'new-high', severity: 'high' }]; }, 'needs-revalidation'],
  ['unknown severity', f => { f.observation.evidence.after.findings = [{ source: 'qualification', id: 'unknown', severity: 'unknown' }]; }, 'needs-revalidation'],
  ['manifest change', f => { f.observation.evidence.lockPolicy.lockOnly = false; }, 'needs-revalidation'],
  ['major upgrade', f => { f.observation.evidence.lockPolicy.noMajors = false; }, 'needs-revalidation'],
  ['new package', f => { f.observation.evidence.lockPolicy.noNewPackages = false; }, 'needs-revalidation'],
  ['bad provenance', f => { f.observation.evidence.packages[0].provenanceVerified = false; }, 'needs-revalidation'],
  ['missing modified package metadata', f => { f.observation.evidence.packages = []; }, 'needs-revalidation'],
  ['skipped candidate test', f => { f.observation.evidence.testsAfter[0].stdout += '\n# skipped 1\n'; }, 'needs-revalidation'],
  ['TODO candidate test', f => { f.observation.evidence.testsAfter[0].stdout += '\n# todo 1\n'; }, 'needs-revalidation'],
  ['test execution absent', f => { f.observation.evidence.testsAfter[0].stdout = 'command succeeded'; }, 'needs-revalidation'],
  ['ordinary baseline test red', f => { f.observation.evidence.testsBefore[0].code = 1; }, 'needs-revalidation'],
  ['candidate test red', f => { f.observation.evidence.testsAfter[0].code = 1; }, 'needs-revalidation'],
  ['admin bypass', f => { f.observation.rules.adminBypass = true; }, 'needs-revalidation'],
  ['squash method', f => { f.observation.rules.method = 'squash'; }, 'needs-revalidation'],
  ['foreign PR', f => { f.observation.ownership.pr += '0'; }, 'quarantine'],
  ['ambiguous branch', f => { f.observation.ownership.branch += '-other'; }, 'quarantine'],
  ['malformed review observation', f => { f.observation.reviews[0] = null; }, 'blocked-review'],
  ['malformed package observation', f => { f.observation.evidence.packages[0] = null; }, 'needs-revalidation'],
  ['malformed check observation', f => { f.observation.checks[0] = null; }, 'waiting-checks'],
  ['malformed permission array', f => { f.observation.reviews[0].roles = 'reviewer'; }, 'blocked-review'],
];
for (const [name, change, expected] of guards) test(`should refuse autonomous merge with ${name}`, async t => {
  const f = await fixture(t);
  await change(f);
  assert.equal((await f.run()).status, expected);
  assert.equal(f.counts().merges, 0);
  assert.equal(await f.git(['rev-parse', 'refs/heads/main'], f.remote), f.candidate.base);
});

test('should invalidate reviews and evidence after an actual candidate push', async t => {
  const f = await fixture(t);
  await f.git(['commit', '--allow-empty', '-m', 'test: change candidate head']);
  await f.git(['push', 'origin', f.candidate.branch]);
  assert.equal((await f.run()).status, 'needs-revalidation');
  assert.equal(f.counts().merges, 0);
});

test('should invalidate evidence when the target branch moves', async t => {
  const f = await fixture(t);
  const tree = await f.git(['rev-parse', `${f.candidate.base}^{tree}`], f.remote);
  const next = await f.git(['commit-tree', tree, '-p', f.candidate.base, '-m', 'test: move qualification base'], f.remote);
  await f.git(['update-ref', 'refs/heads/main', next, f.candidate.base], f.remote);
  assert.equal((await f.run()).status, 'needs-revalidation');
  assert.equal(f.counts().merges, 0);
});

test('should suspend merges when admissions are closed and resume without new work', async t => {
  const f = await fixture(t);
  assert.equal((await f.run(undefined, { admissionsOpen: false })).status, 'waiting-admission');
  assert.equal(f.counts().merges, 0);
  assert.equal((await f.run()).status, 'merged');
  assert.equal(f.counts().merges, 1);
});

test('should retain ambiguous intent through an API outage then observe the completed effect', async t => {
  const f = await fixture(t);
  f.loseAcknowledgement();
  await f.run();
  const observe = f.adapter.observe;
  f.adapter.observe = async () => { throw new Error('synthetic temporary API outage'); };
  assert.equal((await f.run()).status, 'merge-pending');
  f.adapter.observe = observe;
  assert.equal((await f.run()).status, 'merged');
  assert.equal(f.counts().merges, 1);
});

test('should retry a definitively unstarted merge using the same durable intent', async t => {
  const f = await fixture(t);
  const merge = f.adapter.merge;
  f.adapter.merge = async () => { throw new Error('synthetic refusal before dispatch'); };
  assert.equal((await f.run()).status, 'merge-pending');
  const intentId = f.saved().mergeIntent.id;
  f.adapter.merge = merge;
  assert.equal((await f.run()).status, 'merged');
  assert.equal(f.saved().mergeIntent.id, intentId);
  assert.equal(f.counts().merges, 1);
});

test('should stop before merge when its durable intent cannot be saved', async t => {
  const f = await fixture(t);
  await assert.rejects(controller.reconcileCandidate(f.candidate, f.adapter,
    async () => { throw new Error('synthetic disk failure'); }, { admissionsOpen: true, now: new Date('2026-10-17') }), /disk failure/);
  assert.equal(f.counts().merges, 0);
});

test('should serialize concurrent reconciliation through the existing controller lock', async t => {
  const f = await fixture(t);
  const outcomes = await Promise.allSettled([f.run(), f.run()]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(x => x.status === 'rejected').reason.message, /locked/);
  assert.equal(f.counts().merges, 1);
});

test('should reject corrupt candidate state instead of silently dropping ownership', async t => {
  const f = await fixture(t);
  const state = readState(f.stateDir);
  state.candidates[f.candidate.pr].sha = 'unknown';
  writeJson(join(f.stateDir, 'state.json'), state);
  assert.throws(() => readState(f.stateDir), /invalid durable candidate/);
  assert.equal(f.counts().merges, 0);
});
