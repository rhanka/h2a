import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marker, identity } from './helpers/mh-l0-fixtures.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('M04 should release its abstract preclaim while a spawned child remains alive without inheriting the descriptor', async () => {
  const { prepareAuthority, currentIdentity } = await import('../src/runtime/handover/admission.js');
  const { acquirePreclaim } = await import('../src/runtime/handover/authority.js');
  const { classifyDurableProcFrame } = await import('../src/runtime/handover/proc-identity.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-fd-'));
  let first, next, child;
  try {
    const frame = currentIdentity(), authority = await prepareAuthority({ directory: dir, root: dir, physicalPrefix: dir, frame });
    first = await acquirePreclaim(authority.domain, frame, authority.lockKey, classifyDurableProcFrame);
    child = spawn(process.execPath, ['-e', "process.stdin.resume(); process.stdout.write('ready');"], { stdio: ['pipe', 'pipe', 'pipe'] });
    await once(child.stdout, 'data');
    await first.release();
    next = await acquirePreclaim(authority.domain, frame, authority.lockKey, classifyDurableProcFrame);
    assert.equal(child.exitCode, null);
  } finally {
    await next?.release(); await first?.release();
    if (child && child.exitCode === null) { const ended = once(child, 'close'); child.stdin.end(); await ended; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M04 should refuse HTTP-based reclaim, hold preclaim through ready and compare epoch plus inode', async () => {
  const { ownerLiveness, prepareAuthority, admitGeneration, removeMarker } = await import('../src/runtime/handover/admission.js');
  const frame = { ...identity };
  for (const http of ['timeout', '503', 'wrong-generation', 'ECONNREFUSED']) {
    assert.equal(ownerLiveness({ ...marker(), processIdentity: identity }, frame, () => ({ startTime: identity.startTime }), http), 'alive');
  }
  assert.equal(ownerLiveness(marker(), frame, () => ({ absent: true, visible: true })), 'dead');
  assert.equal(ownerLiveness(marker(), frame, () => ({ absent: true, visible: false })), 'unknown');
  assert.equal(ownerLiveness(marker(), frame, () => ({ startTime: 999 })), 'dead');
  assert.equal(ownerLiveness(marker(), { ...frame, machineId: '2'.repeat(32) }, () => ({ absent: true, visible: true })), 'unknown');
  assert.equal(ownerLiveness(marker(), { ...frame, bootId: '44444444-4444-4444-8444-444444444444' }, () => { throw Error('must not inspect PID'); }), 'dead');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-authority-'));
  try {
    const options = { directory: dir, root: dir, physicalPrefix: dir, frame, observe: () => ({ startTime: identity.startTime }) };
    const authority = await prepareAuthority(options);
    const m = { ...marker(), root: dir, uid: process.getuid(), prefixId: authority.domain.prefixId,
      namespaceId: authority.domain.namespaceId, stateDirectory: dir, pid: identity.pid,
      processIdentity: identity, token: 'decoy', authKeyReference: authority.authKeyReference };
    let writable = false;
    const result = await admitGeneration(authority, async publicationEpoch => {
      writable = true;
      await assert.rejects(admitGeneration(authority, async () => m), /authority_lock_unavailable/);
      assert.equal(fs.existsSync(join(dir, 'marker.json')), false);
      return { ...m, publicationEpoch };
    });
    assert.equal(writable, true);
    assert.equal(result.value.generation, m.generation);
    assert.notEqual(authority.rootKey.toString('hex'), m.token);
    assert.notDeepEqual(authority.rootKey, authority.lockKey);
    await assert.rejects(admitGeneration(authority, async () => { throw Error('writer must not run'); }), /owner_alive/);
    assert.throws(() => removeMarker(join(dir, 'marker.json'), { ...result, value: { ...result.value, publicationEpoch: { ...result.value.publicationEpoch, counter: 2 } } }), /marker_compare_failed/);
    const bytes = fs.readFileSync(join(dir, 'marker.json'));
    fs.renameSync(join(dir, 'marker.json'), join(dir, 'old-marker.json'));
    fs.writeFileSync(join(dir, 'marker.json'), bytes, { mode: 0o600 });
    assert.throws(() => removeMarker(join(dir, 'marker.json'), result), /marker_compare_failed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
