import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync, symlinkSync, writeFileSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readState, publishState, replaceState } from '../src/runtime/handover/state.js';
import { marker } from './helpers/mh-l0-fixtures.js';

test('U05 foundation: exclusive durable publication and inode/epoch compare preserve current marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-state-'));
  try {
    const path = join(dir, 'marker.json'); const m = { ...marker(), uid: process.getuid() };
    assert.equal(readState(path, 'marker'), undefined);
    publishState(path, m, 'marker');
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const observed = readState(path, 'marker');
    assert.deepEqual(observed.value, m);
    assert.throws(() => publishState(path, m, 'marker'), /EEXIST/);
    const next = { ...m, publicationEpoch: { ...m.publicationEpoch, counter: 2 } };
    replaceState(path, next, 'marker', observed);
    assert.throws(() => replaceState(path, m, 'marker', observed), /state_compare_failed/);
    assert.equal(readState(path, 'marker').value.publicationEpoch.counter, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('U06 foundation: corruption, unknown schema, symlinks, wrong owner/modes never become empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-state-'));
  try {
    const path = join(dir, 'marker.json');
    writeFileSync(path, '{', { mode: 0o600 });
    assert.throws(() => readState(path, 'marker'));
    writeFileSync(path, '{"schemaVersion":99}');
    assert.throws(() => readState(path, 'marker'));
    chmodSync(path, 0o644); assert.throws(() => readState(path, 'marker'), /private_state_required/);
    chmodSync(path, 0o600); assert.throws(() => readState(path, 'marker', process.getuid() + 1));
    symlinkSync(path, join(dir, 'link.json'));
    assert.throws(() => readState(join(dir, 'link.json'), 'marker'), /private_state_required/);
    assert.throws(() => publishState(join(dir, 'link.json'), marker(), 'marker'));
    chmodSync(dir, 0o755); assert.throws(() => readState(path, 'marker'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('U05 foundation: fsync failure before/after publication has no false success', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-state-'));
  try {
    const m = marker();
    assert.throws(() => publishState(join(dir, 'bad.json'), { ...m, schemaVersion: 99 }, 'marker'));
    assert.equal(readState(join(dir, 'bad.json'), 'marker'), undefined);
    const sync = fs.fsyncSync;
    for (const failAt of [1, 2]) {
      let count = 0;
      t.mock.method(fs, 'fsyncSync', (fd) => { if (++count === failAt) throw new Error('injected_fsync'); sync(fd); });
      const path = join(dir, `fault-${failAt}.json`);
      assert.throws(() => publishState(path, m, 'marker'), failAt === 1 ? /injected_fsync/ : /persistence_indeterminate/);
      t.mock.restoreAll();
      assert.equal(Boolean(readState(path, 'marker')), failAt === 2);
    }
    publishState(join(dir, 'ok.json'), m, 'marker');
    assert.equal(readFileSync(join(dir, 'ok.json'), 'utf8').endsWith('\n'), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('same-boot publication counter cannot regress under a fresh inode compare', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-epoch-'));
  try {
    const path = join(dir, 'marker.json');
    const m = marker(); m.publicationEpoch = { ...m.publicationEpoch, counter: 2 };
    const observed = publishState(path, m, 'marker');
    assert.throws(() => replaceState(path, { ...m, publicationEpoch: { ...m.publicationEpoch, counter: 1 } },
      'marker', observed), /state_epoch_regression/);
    assert.equal(readState(path, 'marker').value.publicationEpoch.counter, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
