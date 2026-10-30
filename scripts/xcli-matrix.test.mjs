// Lot L11: matrix manifest test. Red while the manifest is absent, drifts
// from the 16 seated pairs, or lets a row slip through unowned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkMatrixManifest } from './xcli-matrix-check.mjs';
import { SCENARIO_ROWS, CLI_VERBS } from './xcli-scenarios.mjs';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const manifest = JSON.parse(fs.readFileSync(join(repo, 'docs/cross-cli-matrix.json'), 'utf8'));

test('L11: the matrix manifest covers exactly the 16 seated profile pairs', () => {
  const result = checkMatrixManifest(manifest);
  assert.equal(result.pairs, 16);
});

test('L11: a manifest with a dropped pair fails closed', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'xcli-matrix-'));
  const tampered = { ...manifest, profilePairs: manifest.profilePairs.slice(1) };
  assert.throws(() => checkMatrixManifest(tampered), /exactly the 16/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('L12/L13: mandated rows are defined; every scenario is defined or explicitly owned', () => {
  const rows = new Map(manifest.rows.filter(row => row.scenario !== 'probe').map(row => [row.scenario, row]));
  for (const scenario of manifest.simulationMandatory.scenarios) {
    const row = rows.get(scenario);
    assert.ok(row, `${scenario} is defined`);
    assert.equal(row.status, 'covered-simulated');
    assert.deepEqual(row.tiers, ['S']);
  }
  for (const scenario of SCENARIO_ROWS) {
    const row = rows.get(scenario);
    assert.ok(row, `${scenario} is tracked`);
    const owned = row.status === 'covered-simulated' ||
      (row.status === 'not-covered' && /^L1[2-5]$/.test(row.owner ?? '') && (row.blocker ?? '').length > 0);
    assert.ok(owned, `${scenario} is defined or explicitly owned`);
  }
  assert.equal(manifest.simulationMandatory.pairs, 'all-36');
});

// R15 (P2-4, SPEC v3 §5.1): every cross-CLI verb is either covered by a
// scenario row or explicitly not-covered with blocker and owning lot —
// never silently absent from the manifest. Red on current code: no
// cli-verb row exists at all.
test('L15 R15: every §5.1 CLI verb is covered or explicitly not-covered', () => {
  const rows = new Map(manifest.rows.map(row => [row.scenario, row]));
  assert.equal(CLI_VERBS.length, 9, 'the §5.1 verb subset is enumerated once');
  for (const verb of CLI_VERBS) {
    const row = rows.get(`cli-verb:${verb}`);
    assert.ok(row, `cli-verb:${verb} is tracked in the manifest`);
    const owned = row.status === 'covered-simulated' ||
      (row.status === 'not-covered' && /^L1[2-5]$/.test(row.owner ?? '') && (row.blocker ?? '').length > 0);
    assert.ok(owned, `cli-verb:${verb} is covered or explicitly owned`);
  }
});

test('L11: a probe row on an unknown pair fails closed', () => {
  const tampered = {
    ...manifest,
    rows: [...manifest.rows, { scenario: 'probe', pair: 'vibe:vibe', tiers: ['S', 'C', 'R1'],
      tools: ['h2a_identity_status', 'h2a_inbox', 'h2a_send'] }],
  };
  assert.throws(() => checkMatrixManifest(tampered), /unknown pair/);
});
