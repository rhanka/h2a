// Lot L11 RED set (SPEC v3 §7.1, R18 cyber-seat custody): dummy receipts in
// temp dirs, no secrets. Each refusal carries its distinct classified code;
// the all-green exact-SHA fixture passes. The receipt comes only from the
// protected campaign lane for the exact SHA (provenance by delivery); the
// removed --fetch-trusted/--content-only paths refuse.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { checkReceipt, computeHarnessDigests, loadMatrixManifest, STAGE_KEYS } from './xcli-receipt-check.mjs';
import { buildCampaignReceipt } from './xcli-ci-check.mjs';
import { environment, ORACLE_SOURCES } from './xcli-lab.mjs';
import { parse } from 'yaml';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SHA = 'a'.repeat(40);

function runReceiptWorkflow(baseRef, presentedReceipt = null, gate = 'merge') {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'xcli-receipt-clean-'));
  try {
    fs.cpSync(join(repo, 'scripts'), join(root, 'scripts'), { recursive: true });
    fs.copyFileSync(join(repo, 'package.json'), join(root, 'package.json'));
    fs.mkdirSync(join(root, 'docs'));
    fs.copyFileSync(join(repo, 'docs/cross-cli-matrix.json'), join(root, 'docs/cross-cli-matrix.json'));
    const receiptFile = join(root, 'presented.json');
    fs.writeFileSync(receiptFile, JSON.stringify(presentedReceipt));
    const env = { ...environment(join(root, 'env')), CANDIDATE_SHA: SHA, GITHUB_REPOSITORY: 'rhanka/h2a' };
    // Simulate the dependency installation without network or a second copy
    // of node_modules. The real receipt checker runs against the clean tree.
    fs.writeFileSync(join(root, 'env/bin/npm'), `#!${process.execPath}\n
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      assert.deepEqual(process.argv.slice(2), ${JSON.stringify(gate === 'release' ? ['ci'] : ['ci', '--ignore-scripts'])});
      fs.symlinkSync(${JSON.stringify(join(repo, 'node_modules'))}, ${JSON.stringify(join(root, 'node_modules'))}, 'dir');
    `, { mode: 0o700 });
    fs.writeFileSync(join(root, 'env/bin/gh'), `#!${process.execPath}\n
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { spawnSync } from 'node:child_process';
      const args = process.argv.slice(2);
      if (args[0] === 'api') {
        assert.equal(args[1], 'repos/rhanka/h2a/actions/runs?head_sha=${SHA}&status=success&per_page=100');
        const runs = ${presentedReceipt ? JSON.stringify([
          { id: 99, path: '.github/workflows/ci.yml', conclusion: 'success' },
          { id: 124, path: '.github/workflows/cross-cli-campaign.yml', conclusion: 'failure' },
          { id: 123, path: '.github/workflows/cross-cli-campaign.yml', conclusion: 'success' },
        ]) : '[]'};
        const selected = spawnSync('/usr/bin/jq', ['-r', args[args.indexOf('--jq') + 1]], {
          input: JSON.stringify({workflow_runs:runs}), encoding:'utf8',
        });
        assert.equal(selected.status, 0, selected.stderr);
        process.stdout.write(selected.stdout);
      } else if (args[0] === 'run' && args[1] === 'download') {
        assert.deepEqual(args.slice(0, 5), ['run', 'download', '123', '-n', 'xcli-campaign-${SHA}']);
        assert.ok(args.length === 5 || (args.length === 7 && args[5] === '-D'));
        // gh extracts a single named artifact into cwd unless -D is explicit.
        const destination = args.length === 7 ? args[6] : '.';
        fs.mkdirSync(destination, { recursive: true });
        fs.copyFileSync(${JSON.stringify(receiptFile)}, destination + '/campaign-receipt.json');
      } else if (args[0] === 'run' && args[1] === 'list') {
        console.error('HTTP 404: workflow not found on the default branch');
        process.exitCode = 1;
      } else throw new Error('unexpected GitHub operation');
    `, { mode: 0o700 });
    const workflow = parse(fs.readFileSync(join(repo, gate === 'release'
      ? '.github/workflows/release.yml' : '.github/workflows/cross-cli-messaging.yml'), 'utf8'));
    const steps = gate === 'release' ? workflow.jobs.verify.steps.filter(step =>
      /^npm ci(?:\s|$)/.test(step.run ?? '') || step.name === 'Require the campaign receipt for the exact release SHA')
      : workflow.jobs['receipt-check'].steps.filter(step => step.run);
    const commands = steps.map(step => step.run.replaceAll('${{ github.base_ref }}', baseRef)
      .replaceAll('${{ needs.resolve-release-sha.outputs.release-sha }}', SHA)).join('\n');
    return spawnSync('/bin/bash', ['-e', '-c', commands], {
      cwd: root, env, encoding: 'utf8', timeout: 10000,
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('receipt workflow provisions dependencies before reporting qualification on a clean checkout', () => {
  const out = runReceiptWorkflow('feature');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /qualification: open/);
});

test('receipt workflow fails closed with a typed absent receipt for a branch-only campaign', () => {
  const out = runReceiptWorkflow('main');
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /code=receipt-absent/);
  assert.doesNotMatch(out.stderr, /HTTP 404/);
});

test('receipt workflow selects the successful campaign and validates its downloaded exact-head artifact', () => {
  const out = runReceiptWorkflow('main', goodReceipt());
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, new RegExp('receipt-check: pass gate=merge cells=16 sha=' + SHA));
});

test('release receipt workflow provisions dependencies and validates the exact-head artifact', () => {
  const out = runReceiptWorkflow('main', goodReceipt(), 'release');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, new RegExp('receipt-check: pass gate=release cells=16 sha=' + SHA));
});

test('release receipt workflow refuses absent qualification with its typed cause', () => {
  const out = runReceiptWorkflow('main', null, 'release');
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /code=receipt-absent/);
  assert.doesNotMatch(out.stderr, /HTTP 404|ERR_MODULE_NOT_FOUND/);
});

test('R18: the removed trusted-fetch paths refuse with a typed code', () => {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'xcli-receipt-removed-'));
  try {
    for (const flag of ['--fetch-trusted', '--content-only']) {
      const out = spawnSync(process.execPath, [join(repo, 'scripts/xcli-receipt-check.mjs'),
        flag, '--sha', SHA, '--gate', 'merge'], {
        env: { ...environment(join(root, 'env')) }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(out.status, 1, out.stderr);
      assert.match(out.stdout, /code=trusted-receipt-path-removed/);
      assert.doesNotMatch(out.stdout, /receipt-check: pass/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
const stages = () => Object.fromEntries(STAGE_KEYS.map(key => [key, true]));
const replications = () => [20000, 28000, 24000].map(releaseAt => ({ woke: true,
  budgetMs: 45000, startedAt: new Date(0).toISOString(), noPostSendHarnessInput: true,
  wakeWindows: { barrierAt: 0, deliveryAt: 10000, releaseAt, wakeAt: releaseAt + 1000, firstReadAt: releaseAt + 2000,
    w0Ms: 10000, w1Ms: 10000, dMs: 3000, withholdAt: 0, releaseOffsetMs: releaseAt - 20000,
    notifyIntervalMs: 100, timestampUncertaintyMs: 1, preBarrierReads: 0, baselineReads: 0, withheldReads: 0,
    inputJournal: { correlated: true, onlyWakeInput: true, writes: 2, lineAt: releaseAt + 900, submitAt: releaseAt + 1000 } } }));

function cliVersions() {
  return {
    codex: { version: ORACLE_SOURCES.codex.pin, binaryDigest: 'b'.repeat(64) },
    claude: { version: ORACLE_SOURCES.claude.pin, binaryDigest: 'c'.repeat(64) },
    vibe: { version: ORACLE_SOURCES.vibe.pin, binaryDigest: 'f'.repeat(64) },
    muse: { version: '9.9.9-R1', binaryDigest: 'd'.repeat(64) },
    agy: { version: '8.8.8', binaryDigest: 'e'.repeat(64) },
  };
}

function goodReceipt(overrides = {}) {
  const manifest = loadMatrixManifest(join(repo, 'docs/cross-cli-matrix.json'));
  return {
    version: 1,
    lane: 'campaign',
    sha: SHA,
    source: { sha: SHA, digest: 'a'.repeat(64) },
    provenance: { runId: 123, runAttempt: 1 },
    harnessDigests: computeHarnessDigests(repo),
    seatManifestDigest: 'f'.repeat(64),
    cliVersions: cliVersions(),
    matrixVersion: manifest.version,
    mandatory: manifest.mandatory.merge,
    cells: manifest.mandatory.merge.map(row => ({ scenario: 'probe', pair: row.pair,
      status: 'measured-OK', simulated: false, blocker: null,
      sourceSha: SHA, stages: stages(), proof: { identitiesReady: true, idleBarrier: true }, noPostSendHarnessInput: true, wakeReplications: replications(), caps: { sessionsDebited: 6 },
      cleanup: { secretWipe: true, processRecovery: true } })),
    caps: { sessionsDebited: 200, wallClockSpentMs: 1000 },
    cleanup: { secretWipeProven: true, processRecoveryProven: true },
    ...overrides,
  };
}

const ctx = (overrides = {}) => ({ sha: SHA, gate: 'merge', repoRoot: repo, ...overrides });

test('R18 review: a receipt without its producing-run binding refuses (provenance by delivery)', () => {
  assert.throws(() => checkReceipt(goodReceipt({ provenance: undefined }), ctx()), /provenance-missing/);
  assert.throws(() => checkReceipt(goodReceipt({ provenance: { runId: 0, runAttempt: 1 } }), ctx()), /provenance-missing/);
  assert.throws(() => checkReceipt(goodReceipt({ provenance: { runId: 123 } }), ctx()), /provenance-missing/);
  assert.equal(checkReceipt(goodReceipt(), ctx()).cells, 16);
});

test('L11 review: false stages, a blocker, failed process recovery and zero debits each refuse', () => {
  for (const mutation of [
    r => { r.cells[0].stages = { sent: false, delivered: false }; },
    r => { r.cells[0].blocker = 'owned-process-cleanup-failed'; },
    r => { r.cells[0].cleanup.processRecovery = false; },
    r => { r.caps.sessionsDebited = 0; },
  ]) {
    const receipt = goodReceipt(); mutation(receipt);
    assert.throws(() => checkReceipt(receipt, ctx()));
  }
});

test('L11 review: source SHA and (scenario,pair) are required, a probe cannot manufacture a loop', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'xcli-receipt-'));
  try {
    const manifest = loadMatrixManifest(join(repo, 'docs/cross-cli-matrix.json'));
    const row = { scenario: 'loop:lifecycle', pair: 'claude:codex' };
    const file = join(dir, 'matrix.json');
    fs.writeFileSync(file, JSON.stringify({ ...manifest, mandatory: { merge: [...manifest.mandatory.merge, row] } }));
    const qualify = { version: 1, mode: 'real-cli', sha: SHA, cells: manifest.mandatory.merge.map(r => {
      const [sender, receiver] = r.pair.split(':');
      return { sender, receiver, scenario: 'probe', status: 'measured-OK', secretWipe: true };
    }) };
    fs.writeFileSync(join(dir, 'qualification.json'), JSON.stringify(qualify));
    fs.writeFileSync(join(dir, 'campaign-ledger.json'), '{"sessionsDebited":32}');
    const assemble = () => buildCampaignReceipt({ campaignRoot: dir, sha: SHA, gate: 'merge', manifestFile: file, repoRoot: repo,
      cliVersions: cliVersions(), seatManifestDigest: 'f'.repeat(64), provenance: { runId: 7, runAttempt: 1 } });
    assert.equal(assemble().cells.at(-1).status, 'blocked', 'loop was never run');
    qualify.sha = 'b'.repeat(40);
    fs.writeFileSync(join(dir, 'qualification.json'), JSON.stringify(qualify));
    assert.throws(assemble, /source-sha-mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L11: the all-green exact-SHA fixture passes', () => {
  const result = checkReceipt(goodReceipt(), ctx());
  assert.equal(result.cells, 16);
});

test('L11: absent receipt file refuses with receipt-absent', () => {
  assert.throws(() => checkReceipt(undefined, ctx()), /receipt-absent/);
});

test('L11: receipt for another SHA refuses with sha-mismatch', () => {
  assert.throws(() => checkReceipt(goodReceipt({ sha: 'b'.repeat(40) }), ctx()), /sha-mismatch/);
});

test('L11: stale harness digests refuse with harness-digest-stale', () => {
  const receipt = goodReceipt();
  receipt.harnessDigests['scripts/xcli-lab.mjs'] = '0'.repeat(64);
  assert.throws(() => checkReceipt(receipt, ctx()), /harness-digest-stale/);
});

test('L11: stale CLI version refuses with cli-version-stale', () => {
  const receipt = goodReceipt();
  receipt.cliVersions.codex.version = '0.0.0';
  assert.throws(() => checkReceipt(receipt, ctx()), /cli-version-stale/);
});

test('L11: stale matrix version refuses with matrix-version-stale', () => {
  assert.throws(() => checkReceipt(goodReceipt({ matrixVersion: 0 }), ctx()), /matrix-version-stale/);
});

test('L11: blocked mandatory cell refuses with cell-blocked', () => {
  const receipt = goodReceipt();
  receipt.cells[0] = { ...receipt.cells[0], status: 'blocked', blocker: 'seat-blocked' };
  assert.throws(() => checkReceipt(receipt, ctx()), /cell-blocked:probe:claude:claude/);
});

test('L11: missing mandatory row refuses with cell-missing', () => {
  const receipt = goodReceipt();
  receipt.cells = receipt.cells.slice(1);
  assert.throws(() => checkReceipt(receipt, ctx()), /cell-missing:probe:claude:claude/);
});

test('L11: simulated cell at an R gate refuses with cell-simulated', () => {
  const receipt = goodReceipt();
  receipt.cells[1] = { ...receipt.cells[1], status: 'simulated-OK', simulated: true };
  assert.throws(() => checkReceipt(receipt, ctx()), /cell-simulated:probe:claude:codex/);
});

test('L11: unproven secret wipe refuses with cleanup-unproven', () => {
  const receipt = goodReceipt();
  receipt.cells[2].cleanup.secretWipe = false;
  assert.throws(() => checkReceipt(receipt, ctx()), /cleanup-unproven:probe:claude:muse/);
});

test('L11: any secret-wipe-unproven marker refuses', () => {
  const receipt = goodReceipt();
  receipt.cells[3].note = 'secret-wipe-unproven on resume';
  assert.throws(() => checkReceipt(receipt, ctx()), /secret-wipe-unproven/);
});

test('L11: the lane-built receipt for an all-green campaign passes the check', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'xcli-receipt-'));
  try {
    const manifest = loadMatrixManifest(join(repo, 'docs/cross-cli-matrix.json'));
    const qualifyOutput = { version: 1, mode: 'real-cli', sha: SHA,
      cells: manifest.mandatory.merge.flatMap(row => replications().map(rep => {
        const [sender, receiver] = row.pair.split(':');
        return { sender, receiver, scenario: 'probe', status: 'measured-OK', blocker: null, secretWipe: true, parentSecretWipe: true,
          processRecovery: true, parentProcessRecovery: true, ...stages(), ...rep, noPostSendHarnessInput: true,
          evidence: [{ event: 'identity', role: 'sender', ok: true, ready: true, instance: 'sender:fixture' },
            { event: 'identity', role: 'receiver', ok: true, ready: true, instance: 'receiver:fixture' },
            { event: 'receiver-idle-barrier', at: rep.wakeWindows.barrierAt }] };
      })) };
    fs.writeFileSync(join(dir, 'qualification.json'), JSON.stringify(qualifyOutput));
    fs.writeFileSync(join(dir, 'campaign-ledger.json'), JSON.stringify({ version: 1,
      caps: { launchedSessions: 32, mcpCallsPerSession: 60, wallClockMs: 7200000 },
      sessionsDebited: 96, perSeatDebited: {}, wallClockSpentMs: 1000, attempts: {}, mcpRefusals: [] }));
    const receipt = buildCampaignReceipt({ campaignRoot: dir, sha: SHA, gate: 'merge',
      repoRoot: repo, cliVersions: cliVersions(), seatManifestDigest: 'f'.repeat(64), provenance: { runId: 7, runAttempt: 1 } });
    assert.equal(checkReceipt(receipt, ctx()).cells, 16);
    const blocked = { ...qualifyOutput, cells: qualifyOutput.cells.map((cell, index) =>
      index === 0 ? { ...cell, status: 'blocked', blocker: 'seat-blocked', secretWipe: true } : cell) };
    fs.writeFileSync(join(dir, 'qualification.json'), JSON.stringify(blocked));
    assert.throws(() => checkReceipt(buildCampaignReceipt({ campaignRoot: dir, sha: SHA,
      gate: 'merge', repoRoot: repo, cliVersions: cliVersions(), seatManifestDigest: 'f'.repeat(64), provenance: { runId: 7, runAttempt: 1 } }), ctx()), /cell-blocked/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L11: merge refuses an absent then blocked ratcheted R2 row', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'xcli-receipt-'));
  try {
    const manifest = loadMatrixManifest(join(repo, 'docs/cross-cli-matrix.json'));
    const r2 = { scenario: 'loop', pair: 'claude:codex' };
    const ratcheted = { ...manifest,
      mandatory: { merge: [...manifest.mandatory.merge, r2], release: [...manifest.mandatory.release, r2] } };
    const file = join(dir, 'matrix.json');
    fs.writeFileSync(file, JSON.stringify(ratcheted));
    const base = goodReceipt({ mandatory: ratcheted.mandatory.merge,
      cells: [...goodReceipt().cells, { ...r2, status: 'measured-OK', simulated: false,
        blocker: null, sourceSha: SHA, scenarioExecuted: true, stages: {}, caps: { sessionsDebited: 2 }, cleanup: { secretWipe: true, processRecovery: true } }] });
    assert.equal(checkReceipt(base, { ...ctx(), manifestFile: file }).cells, 17);
    const missing = { ...base, cells: base.cells.filter(c => c.scenario !== 'loop') };
    assert.throws(() => checkReceipt(missing, { ...ctx(), manifestFile: file }), /cell-missing:loop:claude:codex/);
    const blocked = { ...base, cells: base.cells.map(c => c.scenario === 'loop'
      ? { ...c, status: 'blocked', blocker: 'loop-unproven' } : c) };
    assert.throws(() => checkReceipt(blocked, { ...ctx(), manifestFile: file }), /cell-blocked:loop:claude:codex/);
    const subset = { ...base, mandatory: manifest.mandatory.merge };
    assert.throws(() => checkReceipt(subset, { ...ctx(), manifestFile: file }), /mandatory-set-mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
