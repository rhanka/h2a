// Lot L11: matrix manifest test. Red while the manifest is absent, drifts
// from the 16 seated pairs, or lets a row slip through unowned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkMatrixManifest } from './xcli-matrix-check.mjs';
import { SCENARIO_ROWS } from './xcli-scenarios.mjs';

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

test('L12: scenario-2 rows are defined with S coverage, not free-floating', () => {
  const rows = new Map(manifest.rows.filter(row => row.scenario !== 'probe').map(row => [row.scenario, row]));
  for (const scenario of SCENARIO_ROWS) {
    const row = rows.get(scenario);
    assert.ok(row, `${scenario} is defined`);
    assert.equal(row.status, 'covered-simulated');
    assert.deepEqual(row.tiers, ['S']);
  }
  assert.deepEqual([...manifest.simulationMandatory.scenarios].sort(), [...SCENARIO_ROWS].sort());
  assert.equal(manifest.simulationMandatory.pairs, 'all-36');
});

test('L11: a probe row on an unknown pair fails closed', () => {
  const tampered = {
    ...manifest,
    rows: [...manifest.rows, { scenario: 'probe', pair: 'vibe:vibe', tiers: ['S', 'C', 'R1'],
      tools: ['h2a_identity_status', 'h2a_inbox', 'h2a_send'] }],
  };
  assert.throws(() => checkMatrixManifest(tampered), /unknown pair/);
});
