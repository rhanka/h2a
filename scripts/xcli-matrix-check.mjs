// Lot L11 (SPEC v3 §5.4): machine check of docs/cross-cli-matrix.json.
// Re-derives the expected 16 profile pairs from the runtime CLIS ground
// truth plus the owner seated roster — never from the manifest itself — so
// a hand-edited or confusable-typed pair fails closed. Probe rows must name
// a profile pair with tiers S/C/R1 and the three probe tools; every other
// row must declare a NOT-covered status with blocker and owning lot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { CLIS } from './xcli-lab.mjs';

// Owner roster of seated families. Gemini and vibe hold no seat.
export const SEATED_FAMILIES = Object.freeze(['claude', 'codex', 'muse', 'agy']);

export const PROBE_TOOLS = Object.freeze(['h2a_identity_status', 'h2a_inbox', 'h2a_send']);

export function checkMatrixManifest(manifest) {
  assert.equal(manifest.version, 1, 'matrix manifest version must be 1');
  for (const family of SEATED_FAMILIES) {
    assert.ok(CLIS.includes(family), `seated family '${family}' must be a known CLI id`);
  }
  const expected = SEATED_FAMILIES.flatMap(a => SEATED_FAMILIES.map(b => `${a}:${b}`));
  assert.deepEqual([...manifest.profilePairs].sort(), [...expected].sort(),
    'profilePairs must be exactly the 16 seated cross-product pairs');
  assert.deepEqual(manifest.probeTools, [...PROBE_TOOLS], 'probeTools must be the three probe tools');
  for (const gate of ['merge', 'release']) {
    const listed = (manifest.mandatory?.[gate] ?? []).map(row => `${row.scenario}:${row.pair}`).sort();
    const wanted = expected.map(pair => `probe:${pair}`).sort();
    assert.deepEqual(listed, wanted, `mandatory.${gate} must require the probe on all 16 pairs`);
  }
  const pairs = new Set(manifest.profilePairs);
  for (const row of manifest.rows) {
    if (row.scenario === 'probe') {
      assert.ok(pairs.has(row.pair), `probe row names an unknown pair: ${row.pair}`);
      assert.deepEqual(row.tiers, ['S', 'C', 'R1'], `probe row ${row.pair} runs tiers S/C/R1`);
      assert.deepEqual(row.tools, [...PROBE_TOOLS], `probe row ${row.pair} covers the three probe tools`);
    } else {
      assert.equal(row.status, 'not-covered', `row ${row.scenario} must declare not-covered`);
      assert.ok(typeof row.blocker === 'string' && row.blocker.length > 0, `row ${row.scenario} needs a blocker`);
      assert.match(row.owner ?? '', /^L1[2-5]$/, `row ${row.scenario} needs an owning lot L12-L15`);
    }
  }
  return { pairs: expected.length };
}

const invokedAsCli = process.argv[1] === new URL(import.meta.url).pathname;
if (invokedAsCli) {
  const file = process.argv[2] ?? join(new URL('..', import.meta.url).pathname, 'docs/cross-cli-matrix.json');
  const result = checkMatrixManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`matrix-ok pairs=${result.pairs} file=${file}`);
}
