import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { legacy } from './helpers/mh-l5-v1.js';
import { marker, hash } from './helpers/mh-l0-fixtures.js';
import { Participants } from '../dist/runtime/handover/participants.js';
import { createLocalStore } from '../dist/runtime/local-files/store.js';

for (const version of ['0.98.5', '0.98.6']) test(`M17 ${version} inherited writer must block freezing until death and maintained admission closure are both proved`, async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l5-inherited-')), root = join(dir, 'store'), directory = join(dir, 'state');
  for (const path of [root, directory]) fs.mkdirSync(path, { mode: 0o700 });
  let child, admissionClosed = false;
  try {
    child = legacy(version, 'writer', dir, 'unused'); assert.equal((await child.response('ready')).kind, 'writer');
    const proof = { evidenceDigest: hash, verify: () => child.child.exitCode === null && child.child.signalCode === null
      ? 'legacy_writer_unfenced' : admissionClosed ? 'qualified' : 'store_writer_set_unknown' };
    const participants = new Participants({ root, directory, marker: marker(), writerProof: proof });
    assert.throws(() => participants.barrier('h'), /legacy_writer_unfenced/);
    assert.equal(participants.writerControl().gate, 'OPEN');
    assert.deepEqual(participants.inventory().writerRestrictions, ['legacy_writer_unfenced']);
    child.send({ id: 'legacy-write', instance: 'legacy-row' }); assert.equal((await child.response('legacy-write')).registered, true);
    const store = createLocalStore({ root }); assert.equal(store.findInstance('legacy-row').id, 'legacy-row');
    await child.close();
    assert.throws(() => participants.barrier('h'), /store_writer_set_unknown/, 'a zero-process snapshot cannot prove future admission closure');
    admissionClosed = true; // Test policy now permanently excludes another legacy spawn.
    participants.barrier('h'); assert.equal(participants.writerControl().gate, 'BARRIER');
    assert.equal(participants.freeze('h').frozen, true);
    assert.throws(() => store.registerInstance({ id: 'late' }), /store_admission_closed/);
    assert.equal(store.findInstance('legacy-row').id, 'legacy-row');
    assert.equal(participants.checkpoint('h').references.length, 1);
    participants.abort('h'); assert.equal(participants.writerControl().gate, 'OPEN');
  } finally { await child?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
