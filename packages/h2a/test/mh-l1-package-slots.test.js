/**
 * M0-L1 unit probe for the candidate-pack slot planner
 * (`scripts/mh-l1-package-prototype.mjs`).
 *
 * Synthetic maps only: no payload tree, no pack, no install, no network.
 * Covers the round-2 findings on PR #411:
 * - P1: the verified `node-pty` prebuild registers its `slotSource` entry,
 *   so `claimDirect` reuses the visible slot instead of force-copying the
 *   raw workspace `node-pty`.
 * - P2: `reservationFor` looks up ancestors *above* the enquiring parent
 *   (the parent's own scope no longer shadows every lookup), and
 *   `slotVisibleFrom` refuses a slot masked by an intermediate record or
 *   reservation holding another source.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deferredChildSource,
  recordNativeSlot,
  reservationFor,
  slotVisibleFrom,
} from '../../../scripts/mh-l1-package-prototype.mjs';

const maps = () => ({
  records: new Map(),
  bySource: new Map(),
  top: new Map(),
  slotSource: new Map(),
  reservations: new Map(),
});

test('P1: native prebuild registration records the slot source', () => {
  const m = maps();
  const nativeInfo = { name: 'node-pty', version: '1.0.0' };
  recordNativeSlot(m, 'node_modules/node-pty', '/repo/node_modules/node-pty', nativeInfo);
  assert.equal(m.records.get('node_modules/node-pty'), nativeInfo);
  assert.equal(m.top.get('node-pty'), 'node_modules/node-pty');
  assert.equal(m.bySource.get('/repo/node_modules/node-pty'), 'node_modules/node-pty');
  // The round-2 P1 line: without this entry `claimDirect` force-copies the
  // raw workspace tree under the runtime destination.
  assert.equal(m.slotSource.get('node_modules/node-pty'), '/repo/node_modules/node-pty');
});

test('P2: reservationFor skips the parent own scope and returns the ancestor claim', () => {
  const reservations = new Map();
  const parent = 'node_modules/@sentropic/h2a-runtime';
  reservations.set(parent, new Map([['commander', {
    path: `${parent}/node_modules/commander`, source: '/repo/commander-14',
  }]]));
  reservations.set('', new Map([['commander', {
    path: 'node_modules/commander', source: '/repo/commander-12',
  }]]));
  const found = reservationFor(reservations, parent, 'commander');
  assert.ok(found, 'an ancestor reservation exists');
  assert.equal(found.owner, '', 'the parent own scope must not shadow the ancestor');
  assert.equal(found.claim.source, '/repo/commander-12');
  assert.equal(found.claim.path, 'node_modules/commander');
});

test('P2: reservationFor prefers the nearest reserving ancestor', () => {
  const reservations = new Map();
  reservations.set('', new Map([['left-pad', { path: 'node_modules/left-pad', source: '/root' }]]));
  reservations.set('node_modules/a', new Map([['left-pad', { path: 'node_modules/a/node_modules/left-pad', source: '/mid' }]]));
  const found = reservationFor(reservations, 'node_modules/a/node_modules/b', 'left-pad');
  assert.equal(found.owner, 'node_modules/a');
  assert.equal(found.claim.source, '/mid');
});

test('P2: reservationFor returns undefined without an ancestor reservation', () => {
  const reservations = new Map();
  reservations.set('node_modules/a', new Map([['left-pad', { path: 'node_modules/a/node_modules/left-pad', source: '/mid' }]]));
  assert.equal(reservationFor(reservations, 'node_modules/a', 'unrelated'), undefined);
  assert.equal(reservationFor(new Map(), 'node_modules/a', 'left-pad'), undefined);
  assert.equal(reservationFor(reservations, '', 'left-pad'), undefined);
});

test('P2: slotVisibleFrom accepts the unmasked top-level slot', () => {
  const m = maps();
  m.records.set('node_modules/commander', { name: 'commander', version: '14.0.0' });
  m.slotSource.set('node_modules/commander', '/repo/commander-14');
  assert.equal(
    slotVisibleFrom(m.records, m.slotSource, m.reservations, 'node_modules/@sentropic/h2a-runtime', 'node_modules/commander', 'commander', '/repo/commander-14'),
    true,
  );
});

test('P2: slotVisibleFrom refuses a slot masked by an intermediate record', () => {
  const m = maps();
  m.records.set('node_modules/commander', { name: 'commander', version: '14.0.0' });
  m.slotSource.set('node_modules/commander', '/repo/commander-14');
  const dest = 'node_modules/@sentropic/h2a-runtime/node_modules/@sentropic/engram';
  m.records.set(`${dest}/node_modules/commander`, { name: 'commander', version: '12.0.0' });
  m.slotSource.set(`${dest}/node_modules/commander`, '/repo/commander-12');
  assert.equal(
    slotVisibleFrom(m.records, m.slotSource, m.reservations, dest, 'node_modules/commander', 'commander', '/repo/commander-14'),
    false,
  );
});

test('P2: slotVisibleFrom refuses a slot masked by an intermediate reservation', () => {
  const m = maps();
  const dest = 'node_modules/@sentropic/h2a-runtime/node_modules/@sentropic/engram';
  m.reservations.set('node_modules/@sentropic/h2a-runtime', new Map([['commander', {
    path: 'node_modules/@sentropic/h2a-runtime/node_modules/commander', source: '/repo/commander-12',
  }]]));
  assert.equal(
    slotVisibleFrom(m.records, m.slotSource, m.reservations, dest, 'node_modules/commander', 'commander', '/repo/commander-14'),
    false,
  );
});

test('P2: slotVisibleFrom accepts an ancestor slot from below with the same source', () => {
  const m = maps();
  const base = 'node_modules/@sentropic/h2a-runtime';
  const child = `${base}/node_modules/commander`;
  m.records.set(child, { name: 'commander', version: '12.0.0' });
  m.slotSource.set(child, '/repo/commander-12');
  assert.equal(
    slotVisibleFrom(m.records, m.slotSource, m.reservations, `${child}/node_modules/engram`, child, 'commander', '/repo/commander-12'),
    true,
  );
});

test('P2: slotVisibleFrom refuses sibling-subtree slots', () => {
  const m = maps();
  assert.equal(
    slotVisibleFrom(m.records, m.slotSource, m.reservations, 'node_modules/a', 'node_modules/b/node_modules/commander', 'commander', '/s'),
    false,
  );
  assert.equal(
    slotVisibleFrom(m.records, m.slotSource, m.reservations, 'node_modules/a', 'node_modules/other', 'commander', '/s'),
    false,
  );
});

test('P2: deferredChildSource honours the recorded slot, else the ancestor claim, else undefined', () => {
  const m = maps();
  m.slotSource.set('node_modules/commander', '/repo/commander-14');
  assert.equal(
    deferredChildSource(m.slotSource, m.reservations, 'node_modules/@sentropic/h2a', 'node_modules/commander', 'commander'),
    '/repo/commander-14',
  );
  const m2 = maps();
  m2.reservations.set('', new Map([['commander', { path: 'node_modules/commander', source: '/repo/commander-12' }]]));
  assert.equal(
    deferredChildSource(m2.slotSource, m2.reservations, 'node_modules/@sentropic/h2a-runtime', 'node_modules/commander', 'commander'),
    '/repo/commander-12',
  );
  assert.equal(
    deferredChildSource(m2.slotSource, m2.reservations, 'node_modules/@sentropic/h2a-runtime', 'node_modules/@sentropic/h2a/node_modules/commander', 'commander'),
    undefined,
  );
});
