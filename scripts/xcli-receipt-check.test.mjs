// Lot L11 RED set (SPEC v3 §7.1): dummy receipts in temp dirs, no secrets.
// Each refusal carries its distinct classified code; the all-green
// exact-SHA fixture passes. Red while xcli-receipt-check.mjs is absent or
// misses the merge-scope R2 ratchet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkReceipt, computeHarnessDigests, loadMatrixManifest } from './xcli-receipt-check.mjs';
import { buildCampaignReceipt } from './xcli-ci-check.mjs';
import { ORACLE_SOURCES } from './xcli-lab.mjs';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SHA = 'a'.repeat(40);

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
    harnessDigests: computeHarnessDigests(repo),
    seatManifestDigest: 'f'.repeat(64),
    cliVersions: cliVersions(),
    matrixVersion: manifest.version,
    mandatory: manifest.mandatory.merge,
    cells: manifest.mandatory.merge.map(row => ({ scenario: 'probe', pair: row.pair,
      status: 'measured-OK', simulated: false, blocker: null,
      stages: { sent: true, delivered: true }, caps: { sessionsDebited: 1 },
      cleanup: { secretWipe: true } })),
    caps: { sessionsDebited: 16, wallClockSpentMs: 1000 },
    cleanup: { secretWipeProven: true },
    ...overrides,
  };
}

const ctx = (overrides = {}) => ({ sha: SHA, gate: 'merge', repoRoot: repo, ...overrides });

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
      cells: manifest.mandatory.merge.map(row => {
        const [sender, receiver] = row.pair.split(':');
        return { sender, receiver, status: 'measured-OK', blocker: null, secretWipe: true };
      }) };
    fs.writeFileSync(join(dir, 'qualification.json'), JSON.stringify(qualifyOutput));
    fs.writeFileSync(join(dir, 'campaign-ledger.json'), JSON.stringify({ version: 1,
      caps: { launchedSessions: 32, mcpCallsPerSession: 60, wallClockMs: 7200000 },
      sessionsDebited: 16, perSeatDebited: {}, wallClockSpentMs: 1000, attempts: {}, mcpRefusals: [] }));
    const receipt = buildCampaignReceipt({ campaignRoot: dir, sha: SHA, gate: 'merge',
      repoRoot: repo, cliVersions: cliVersions(), seatManifestDigest: 'f'.repeat(64) });
    assert.equal(checkReceipt(receipt, ctx()).cells, 16);
    const blocked = { ...qualifyOutput, cells: qualifyOutput.cells.map((cell, index) =>
      index === 0 ? { ...cell, status: 'blocked', blocker: 'seat-blocked', secretWipe: true } : cell) };
    fs.writeFileSync(join(dir, 'qualification.json'), JSON.stringify(blocked));
    assert.throws(() => checkReceipt(buildCampaignReceipt({ campaignRoot: dir, sha: SHA,
      gate: 'merge', repoRoot: repo, cliVersions: cliVersions(), seatManifestDigest: 'f'.repeat(64) }), ctx()), /cell-blocked/);
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
        blocker: null, stages: {}, caps: {}, cleanup: { secretWipe: true } }] });
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
