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
test('should keep a replayed refusal unsuccessful with its conflicts at the CLI', () => fixture(({ root, source, stateDir, freeze, consume, consumer }) => {
  assert.equal(consume(freeze({ 0: 'B' })).ok, true);
  // A coherent third-party change: source and manifest advance together
  // through the same pure core, so the refusal is paragraph-level.
  const state = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
  const base = E.readParagraphs(state.current.document, state.current.manifest);
  const third = structuredClone(base); third[0].text = 'Z';
  const diverged = E.applyParagraphChanges(state.current.document, state.current.manifest, [E.diffParagraphs(base, third, 'tiers')]);
  writeFileSync(source, JSON.stringify(diverged.document));
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ ...state, current: { document: diverged.document, manifest: diverged.manifest } }));
  const r1 = freeze({ 0: 'B' }), r2 = freeze({ 0: 'C' }, r1, 'R2');
  const refused = consume(r2);
  assert.equal(refused.ok, false); assert.equal(refused.receipt.status, 'conflict');
  assert.ok(refused.receipt.conflicts.length > 0);
  const input = join(root, 'replay.json'); writeFileSync(input, E.encodeReturn(r2));
  let stdout = '', stderr = '';
  const streams = { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } };
  assert.equal(consumer.runFocusFeedbackCli(['apply', input, '--state', stateDir], streams), 1, stdout + stderr);
  const replay = JSON.parse(stdout);
  assert.equal(replay.status, 'already-processed'); assert.equal(replay.previousStatus, 'conflict');
  assert.equal(replay.conflicts.length, refused.receipt.conflicts.length);
  assert.equal(replay.conflicts[0].requested, 'C');
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
