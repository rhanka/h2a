import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnShim } from './helpers/mh-l1-shim.js';
import { hash } from './helpers/mh-l0-fixtures.js';
import { readState } from '../src/runtime/handover/state.js';
const test = (name, fn) => { if (!process.env.MH_L5_CASE || process.env.MH_L5_CASE === name) nodeTest(name, fn); };
const worker = fileURLToPath(new URL('./helpers/mh-l5-cold-worker.mjs', import.meta.url));
const spawn = (directory, mode) => spawnShim(worker, [directory, ...(mode ? [mode] : [])], process.env, directory);
const fixture = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l5-cold-'));
  fs.writeFileSync(join(dir, 'clock.json'), '1000'); fs.writeFileSync(join(dir, 'calls.json'), '0'); return dir;
};
let sequence = 0;
const call = async (child, operation, payload, options = {}) => {
  const id = String(++sequence); child.send({ id, operation, payload, ...options }); return child.response(id);
};
async function reserved(dir, child) {
  const ready = await child.response('ready'), m = ready.source;
  const target = { packageVersion: '0.98.7', buildId: 'next', manifestDigest: hash, entrypoint: join(dir, 'next.js') };
  assert.equal((await call(child, 'reserve', { target, selectionEpoch: 2, precheckEvidenceDigest: hash })).result.state, 'PRECHECKED');
  const barrier = (await call(child, 'barrier', { deadline: 2000 })).result;
  return { m, target, commit: { sourceGeneration: m.generation, sourceProcessIdentity: m.processIdentity, barrierId: barrier.barrierId,
    expectedDrainRevision: 1, expectedInventoryRevision: 1, targetBuildId: target.buildId, targetManifestDigest: hash,
    targetEntrypoint: target.entrypoint, selectionEpoch: 2, precheckEvidenceDigest: hash } };
}
for (const stage of ['before-file-sync', 'after-file-sync', 'after-rename', 'after-directory-sync', 'listener-close', 'marker-cleanup']) {
  test(`M23 M24 cold process crash at ${stage} must preserve the irreversible boundary`, async () => {
    const dir = fixture(); let child;
    try {
      child = spawn(dir); const { commit } = await reserved(dir, child);
      child.send({ id: 'commit', operation: 'commit-stop', payload: commit, cut: stage });
      assert.equal((await child.response('cut')).stage, stage);
      await child.close(); child = spawn(dir); await child.response('ready');
      const recovered = await call(child, 'reconcile'); assert.equal(recovered.error, undefined);
      const committed = !['before-file-sync', 'after-file-sync'].includes(stage);
      assert.equal(recovered.status.state, committed ? 'STOP_COMMITTED' : 'BARRIER');
      if (committed) {
        assert.equal(recovered.open, false); assert.equal(fs.existsSync(join(dir, 'marker.json')), false);
        assert.equal((await call(child, 'abort')).error, 'stop_irreversible');
        fs.writeFileSync(join(dir, 'clock.json'), '3000');
        assert.equal((await call(child, 'expire')).result, false);
        assert.equal((await call(child, 'resume')).open, false);
        const ack = await call(child, 'commit-stop', commit, { stepId: 'commit-stop' });
        assert.equal(ack.result.state, 'STOP_COMMITTED');
      } else {
        fs.writeFileSync(join(dir, 'clock.json'), '3000');
        assert.equal((await call(child, 'expire')).result, true);
        assert.equal((await call(child, 'commit-stop', commit)).error, 'transaction_aborted');
        assert.equal(fs.existsSync(join(dir, 'closed.jsonl')), false);
      }
      assert.equal(fs.existsSync(join(dir, 'operator-stop.json')), committed, 'resume writes pause=false only on the committed branch');
    } finally { await child?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
test('M22 pause during a barrier must stay armed through restart and stop only after the admitted call drains', async () => {
  const dir = fixture(); let child;
  try {
    child = spawn(dir); await reserved(dir, child); fs.writeFileSync(join(dir, 'calls.json'), '1');
    const pause = await call(child, 'pause'); assert.equal(pause.result.state, 'pause_active_stop_deferred'); assert.equal(pause.open, false);
    await child.close(); child = spawn(dir); await child.response('ready');
    assert.equal((await call(child, 'reconcile')).status.paused, true);
    assert.equal(fs.existsSync(join(dir, 'closed.jsonl')), false);
    fs.writeFileSync(join(dir, 'calls.json'), '0');
    assert.equal((await call(child, 'pause')).result.state, 'STOP_COMMITTED');
    assert.equal((await call(child, 'resume')).open, false);
  } finally { await child?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('M24 M25 eight starters must share a crash-consumed three-attempt budget and refuse an unknown candidate', async () => {
  const dir = fixture(); let admin; const children = [];
  try {
    admin = spawn(dir); const { commit } = await reserved(dir, admin);
    assert.equal((await call(admin, 'commit-stop', commit)).result.state, 'STOP_COMMITTED');
    await admin.close(); admin = spawn(dir); await admin.response('ready');
    const control = readState(join(dir, 'component-control.json'), 'componentControl').value;
    const path = join(dir, control.activeTransaction);
    fs.writeFileSync(join(dir, 'attempt-config.json'), JSON.stringify({ path, root: join(dir, 'store') }));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const round = Array.from({ length: 8 }, () => { const child = spawn(dir, 'attempt'); children.push(child); return child; });
      const responses = await Promise.all(round.map(child => child.response('ready')));
      const grants = responses.filter(r => r.ticket); assert.equal(grants.length, 1, JSON.stringify(responses));
      assert.equal(grants[0].ticket.attempt, attempt);
      assert.ok(responses.filter(r => r.error).every(r => /candidate_liveness_unknown|authority_lock_unavailable/.test(r.error)));
      assert.equal(readState(path, 'componentTransaction').value.successorReservation.attempts, attempt);
      assert.equal((await call(admin, 'fail', undefined, { path, ticket: grants[0].ticket })).error, undefined);
      await Promise.all(round.map(child => child.close()));
    }
    assert.equal(readState(path, 'componentTransaction').value.state, 'SUCCESSOR_FAILED');
    const last = spawn(dir, 'attempt'); children.push(last);
    assert.equal((await last.response('ready')).error, 'successor_failed');
    assert.equal(fs.existsSync(join(dir, 'marker.json')), false);
  } finally { await admin?.close(); await Promise.all(children.map(child => child.close())); fs.rmSync(dir, { recursive: true, force: true }); }
});
