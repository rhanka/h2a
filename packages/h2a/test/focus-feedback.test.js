import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as E from '@sentropic/focus/editing';
import { fixture } from './helpers/focus-edit-fixture.js';
test('should apply a complete manual file with no live agent and retain exact notes, IDs and actual digests', () => fixture(({ source, stateDir, retained, freeze, consume }) => {
  const value = freeze({ 0: 'Correction 😀\n' + 'texte  '.repeat(20000) });
  // A paragraph may contain soft line breaks and has no historical note truncation.
  const result = consume(value); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(JSON.parse(readFileSync(source, 'utf8')).sections[0].markdown.split('\n\n')[0], value.editReturn.transactions[0].changes[0].after);
  assert.equal(result.receipt.returnId, value.returnId); assert.equal(result.receipt.baseHash, E.baseDigest(retained.document));
  const stored = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
  assert.deepEqual(stored.returns[0].notes, value.notes); assert.equal(stored.returns[0].digest, value.digest);
  assert.equal(result.receipt.transactions[0].changeIds[0], value.editReturn.transactions[0].changes[0].changeId);
}));
test('should refuse a wrong generation, unknown version, malformed data and a concurrent write before publication', () => fixture(({ root, stateDir, consumer, source, freeze, consume }) => {
  const value = freeze({ 0: 'B' }), wrong = structuredClone(value); wrong.production.generationId = 'wrong'; wrong.digest = E.returnDigest(wrong);
  assert.equal(consume(wrong).receipt.status, 'generation-mismatch');
  const before = readFileSync(source, 'utf8');
  for (const invalid of [{ ...value, schemaVersion: 99 }, { editReturn: { transactions: [null] } }]) {
    const input = join(root, 'invalid.json'); writeFileSync(input, JSON.stringify(invalid));
    assert.equal(consumer.importFocusFeedback({ stateDir, input }).receipt.status, 'unsupported-or-invalid-return');
    assert.equal(readFileSync(source, 'utf8'), before);
  }
  const result = consume(value, { beforePublish() { const newer = JSON.parse(before); newer.sections[0].markdown = 'Third party'; writeFileSync(source, JSON.stringify(newer)); } });
  assert.equal(result.ok, false); assert.equal(result.receipt.status, 'concurrent-source-change');
  assert.equal(result.receipt.transactions[0].status, 'concurrent-source-change');
  assert.notEqual(readFileSync(source, 'utf8'), before); assert.match(readFileSync(source, 'utf8'), /Third party/);
}));
