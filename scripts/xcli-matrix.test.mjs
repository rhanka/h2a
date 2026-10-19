// Lot L11: matrix manifest test. Red while the manifest is absent, drifts
// from the 16 seated pairs, or lets a row slip through unowned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkMatrixManifest } from './xcli-matrix-check.mjs';

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

test('L11: a probe row on an unknown pair fails closed', () => {
  const tampered = {
    ...manifest,
    rows: [...manifest.rows, { scenario: 'probe', pair: 'vibe:vibe', tiers: ['S', 'C', 'R1'],
      tools: ['h2a_identity_status', 'h2a_inbox', 'h2a_send'] }],
  };
  assert.throws(() => checkMatrixManifest(tampered), /unknown pair/);
});
