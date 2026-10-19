import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as E from '@sentropic/focus/editing';
import { join } from 'node:path';
import { fixture } from './helpers/focus-edit-fixture.js';
test('should recover after source publication, replay by digest and revoke across consumer restarts', () => fixture(({ source, stateDir, freeze, consume }) => {
  const r1 = freeze({ 0: 'B', 1: 'Y' });
  assert.throws(() => consume(r1, { afterSourcePublish() { throw new Error('simulated stop after source publish'); } }), /simulated stop/);
  const replay = consume(r1); assert.equal(replay.receipt.status, 'already-processed');
  const partial = freeze({ 1: 'Y' }, r1, 'R2'); assert.equal(consume(partial).receipt.status, 'revocation-applied');
  assert.equal(JSON.parse(readFileSync(source, 'utf8')).sections[0].markdown, 'A\n\nY');
  const r3 = freeze({}, partial, 'R3'); assert.equal(consume(r3).receipt.status, 'revocation-applied');
  assert.equal(JSON.parse(readFileSync(source, 'utf8')).sections[0].markdown, 'A\n\nX');
  const state = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
  assert.deepEqual(state.lineage.tombstones, ['R1', 'R2']);
}));
test('should persist inverted delivery and transitive tombstones without receiving intermediate R2', () => fixture(({ source, stateDir, freeze, consume }) => {
  const r1 = freeze({ 0: 'B' }), r2 = freeze({ 0: 'C' }, r1, 'R2'), r3 = freeze({}, r2, 'R3');
  assert.equal(consume(r3).ok, true); assert.equal(consume(r1).receipt.status, 'superseded');
  const unrelated = freeze({ 0: 'D' }, undefined, 'unrelated'); assert.equal(consume(unrelated).receipt.status, 'lineage-order-indeterminate');
  assert.equal(JSON.parse(readFileSync(source, 'utf8')).sections[0].markdown, 'A\n\nX');
  const state = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
  assert.equal(state.lineage.head.returnId, 'R3'); assert.deepEqual(state.lineage.tombstones, ['R2', 'R1']);
}));
test('should consume through separate checkout CLI processes with no live producer', () => fixture(({ root, source, stateDir, freeze }) => {
  const r1 = freeze({ 0: 'B' }), r2 = freeze({}, r1, 'R2'), input = join(root, 'return.json');
  const run = value => {
    writeFileSync(input, E.encodeReturn(value));
    return spawnSync(process.execPath, [fileURLToPath(new URL('../dist/bin.js', import.meta.url)), 'focus', 'feedback', 'apply', input, '--state', stateDir], {
      cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_CACHE_HOME: root, XDG_RUNTIME_DIR: root, H2A_ROOT: join(root, 'h2a') },
    });
  };
  const first = run(r2); assert.equal(first.status, 0, first.stderr);
  const late = run(r1); assert.equal(late.status, 1, late.stderr); assert.equal(JSON.parse(late.stdout).status, 'superseded');
  assert.equal(JSON.parse(readFileSync(source, 'utf8')).sections[0].markdown, 'A\n\nX');
}));
