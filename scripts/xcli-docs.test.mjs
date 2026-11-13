// Lot L10: documentation truth test. The entry doc must state the current
// measured balance and link the latest per-tier tables. Red while it claims
// zero real cells or omits the balance, the tiers, the seat entry, the
// campaign lane, or the NOT-covered list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const raw = fs.readFileSync(join(repo, 'docs/cross-cli-qualification.md'), 'utf8');
const doc = raw.replace(/\s+/g, ' ');

test('L10: the entry doc states the measured balance and links per-tier evidence', () => {
  assert.ok(!doc.includes("Aucune cellule réelle n'est qualifiée"), 'the stale zero-real-cells claim is gone');
  assert.ok(doc.includes('1/36'), 'the measured balance 1/36 is stated');
  assert.ok(doc.includes('Claude'), 'the qualified diagonal names its family');
  assert.ok(/aucune paire inter-CLI réelle|no real inter-CLI pair/i.test(doc), 'no qualified real inter-CLI pair is stated');
  assert.ok(doc.includes('2026-10-15-cross-cli-phase1.md'), 'the phase-1 table is linked as history');
  assert.ok(doc.includes('2026-10-16-cross-cli-resume.md'), 'the resume evidence is linked');
  for (const tier of ['S', 'C', 'R1', 'R2']) {
    assert.ok(doc.includes(`tier ${tier}`) || doc.includes(`(${tier})`), `tier ${tier} is described`);
  }
  assert.ok(doc.includes('--seat-manifest'), 'the seat manifest entry is documented');
  assert.ok(doc.includes('cross-cli-messaging'), 'the campaign lane is referenced');
  for (const state of ['not covered', 'partial', 'source-gap']) {
    assert.ok(doc.includes(state), `NOT-covered state '${state}' is used`);
  }
});
