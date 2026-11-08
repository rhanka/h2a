// Closed CI shard contract. This is execution evidence, never an optional skip.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { verifyExecutionReport } from './test-execution-evidence.mjs';

export const M17_FILE = 'packages/h2a/test/mh-l5-concurrency.test.js';
export const M17_TITLE = 'M17 backend stress should reconcile 10,000 mutations per domain without claiming eight protocol surfaces';
const DOMAINS = ['presence', 'registry', 'inbox', 'negotiations', 'blockage', 'launches', 'payloads'];
const INPUTS = ['package-lock.json', M17_FILE, 'packages/h2a/test/helpers/mh-l5-campaign.js',
  'packages/h2a/test/helpers/mh-l5-writer.mjs', 'scripts/node-evidence-reporter.mjs',
  'scripts/m17-ci-evidence.mjs', 'scripts/ci-m17-proof.mjs'];
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());

export function m17Context(root, env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'M17 imported proof is GitHub-only');
  assert.equal(process.platform, 'linux');
  assert.equal(env.GITHUB_REPOSITORY, 'rhanka/h2a');
  assert.ok(['ci', 'release'].includes(env.GITHUB_WORKFLOW),
    'imported companion proofs are sealed and consumed inside the ci and release workflows only');
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9]\d*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9]\d*$/);
  // ci checks out the PR merge commit, so GITHUB_SHA == HEAD. The release
  // workflow checks out the gated release SHA while GitHub keeps GITHUB_SHA
  // at the default-branch head on a backfill dispatch, so verify passes the
  // one resolved SHA through H2A_TEST_EXPECTED_SHA.
  const expected = env.H2A_TEST_EXPECTED_SHA ?? env.GITHUB_SHA;
  assert.match(expected ?? '', /^[a-f0-9]{40}$/, 'the expected checkout SHA must be a full object ID');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(head, expected, 'proof binds the actual gated checkout HEAD, not only a mutable workflow context');
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: root });
  assert.ok([22, 24].includes(Number(process.versions.node.split('.')[0])));
  return { repository: env.GITHUB_REPOSITORY, workflow: env.GITHUB_WORKFLOW,
    runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, sha: head,
    platform: process.platform, arch: process.arch, node: process.version,
    inputs: Object.fromEntries(INPUTS.map(file => [file,
      createHash('sha256').update(fs.readFileSync(join(root, file))).digest('hex')])) };
}

/**
 * A rerun-partial consumer (GITHUB_RUN_ATTEMPT=2) may import a producer proof
 * sealed on an earlier attempt ("1"): the artifact names no longer carry the
 * attempt, so the check admits any positive-integer attempt at or below the
 * expected one and compares the rest of the context strictly. A future or
 * non-integer attempt is a foreign proof and stays fatal.
 */
export function verifyProofContext(actual, expected, message) {
  const { attempt: actualAttempt, ...actualRest } = actual ?? {};
  const { attempt: expectedAttempt, ...expectedRest } = expected ?? {};
  assert.deepEqual(actualRest, expectedRest, message);
  const seen = Number(actualAttempt);
  const bound = Number(expectedAttempt);
  assert.ok(Number.isSafeInteger(seen) && seen >= 1 && Number.isSafeInteger(bound) && seen <= bound,
    `${message}: proof attempt ${JSON.stringify(actualAttempt)} must be a positive integer <= ${JSON.stringify(expectedAttempt)}`);
}

export function verifyM17Envelope(envelope, expected) {
  keys(envelope, ['schema', 'context', 'report', 'backend', 'exit', 'cleanup']);
  assert.equal(envelope.schema, 1);
  verifyProofContext(envelope.context, expected, 'M17 proof provenance/source inputs differ');
  assert.deepEqual(envelope.exit, { code: 0, signal: null, survivingOwnedProcesses: 0 });
  assert.deepEqual(envelope.cleanup, { volumeRemoved: true, privateStateRemoved: true });
  const report = envelope.report;
  assert.equal(report.success, true);
  assert.equal(report.testResults.length, 1);
  assert.equal(report.testResults[0].name, M17_FILE, 'only the exact relative M17 identity can be imported');
  assert.deepEqual(report.testResults[0].assertionResults, [{ fullName: M17_TITLE, status: 'passed' }]);
  assert.deepEqual(verifyExecutionReport(report, [M17_FILE]), []);
  const backend = envelope.backend;
  keys(backend, ['domains', 'acknowledged', 'duplicates', 'actors', 'coverage', 'minimumLockAcquisitionsPerIteration', 'storage']);
  keys(backend.domains, DOMAINS);
  assert.ok(DOMAINS.every(name => Number.isSafeInteger(backend.domains[name]) && backend.domains[name] >= 10000));
  assert.equal(backend.acknowledged, 10000);
  assert.equal(backend.duplicates, 0);
  assert.deepEqual(backend.actors, Array.from({ length: 8 }, (_, n) => `backend${n + 1}`));
  assert.equal(backend.coverage, 'backend-only');
  assert.ok(Number.isSafeInteger(backend.minimumLockAcquisitionsPerIteration) && backend.minimumLockAcquisitionsPerIteration >= 8);
  assert.deepEqual(backend.storage, { type: 0x01021994, configured: true });
  return report;
}

export function m17Partition(files, envelope, context, root) {
  const full = files.map(file => resolve(root, file));
  assert.equal(new Set(full).size, full.length, 'duplicate full inventory identity');
  const external = resolve(root, M17_FILE);
  assert.equal(full.filter(file => file === external).length, 1, 'M17 must occur once in full discovery');
  const report = verifyM17Envelope(envelope, context);
  const local = files.filter(file => resolve(root, file) !== external);
  assert.equal(local.length + report.testResults.length, files.length);
  assert.equal(new Set([...local.map(file => resolve(root, file)), external]).size, files.length,
    'local/external partitions must be disjoint and exhaustive');
  return { local, report: { ...report, testResults: report.testResults.map(row => ({ ...row, name: external })) } };
}

export function loadM17Partition(files, root, env = process.env) {
  if (env.H2A_TEST_CI_M17_REPORT === undefined) return { local: files, report: null };
  assert.ok(env.H2A_TEST_CI_M17_REPORT, 'explicit empty M17 proof configuration');
  const context = m17Context(root, env), path = env.H2A_TEST_CI_M17_REPORT;
  const info = fs.lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'M17 proof must be a regular file');
  return m17Partition(files, JSON.parse(fs.readFileSync(path, 'utf8')), context, root);
}
