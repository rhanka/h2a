import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { lab, proc, alive } from './support.mjs';

test('should preserve live terminal I/O and receive guardian-reaped exits in owner 2 after batched moves', async t => {
  let running = true, trafficError, traffic = Promise.resolve();
  t.after(async () => { running = false; await traffic; });
  const l = await lab(t);
  const all = [];
  for (let n = 0; n < 12; n++) all.push(await l.create(`s${n}`));
  const bash = await l.create('bash', 'bash'); all.push(bash);
  const sent = new Map(all.slice(0, 12).map(s => [s.id, 0]));
  traffic = (async () => {
    while (running) {
      await Promise.all([...sent].map(async ([id, n]) => {
        sent.set(id, n + 1);
        await l.rpc('write', { id, data: `IN ${n} payload-${id}-${n}\n` });
      }));
      await pause(3);
    }
  })().catch(error => { trafficError = error; });
  await l.rpc('write', { id: 'bash', data: "printf '__BASH_%s__\\n' 0\n" });
  await l.wait(() => /^__BASH_0__\r?$/m.test(l.text('bash')), 'interactive Bash command before handover');

  const first = all.slice(0, 4).map(s => s.id);
  const stageDelay = Number(process.env.SPIKE_STAGE_DELAY ?? 25);
  assert.equal((await l.rpc('move', { ids: first, stageDelay })).ok, true);
  const unaffectedBefore = [...l.text('s0').matchAll(/^TICK s0 (\d+)\r?$/gm)].length;
  const oldUnaffectedBefore = [...l.text('s8').matchAll(/^TICK s8 (\d+)\r?$/gm)].length;
  const failed = await l.rpc('move', { ids: ['s4', 's5'], fault: 'reject', stageDelay: 80 });
  assert.equal(failed.ok, false);
  const unaffectedAfter = [...l.text('s0').matchAll(/^TICK s0 (\d+)\r?$/gm)].length;
  assert.ok(unaffectedAfter > unaffectedBefore, 'an unrelated migrated session keeps producing during a failed batch');
  const oldUnaffectedAfter = [...l.text('s8').matchAll(/^TICK s8 (\d+)\r?$/gm)].length;
  assert.ok(oldUnaffectedAfter > oldUnaffectedBefore, 'an unrelated owner 1 session also keeps producing during a failed batch');
  const badfd = await l.rpc('move', { ids: ['s6'], fault: 'ebadf' });
  assert.equal(badfd.ok, false);
  assert.match(badfd.why, /sendmsg SCM_RIGHTS: Bad file descriptor/);
  assert.equal((await l.rpc('move', { ids: all.slice(4, 8).map(s => s.id), stageDelay })).ok, true);
  assert.equal((await l.rpc('move', { ids: all.slice(8).map(s => s.id), stageDelay })).ok, true);
  const oldExit = await l.wait(() => l.events.find(e => e.event === 'old-exit'), 'owner 1 exits automatically when empty');
  assert.equal(oldExit.code, 0);
  assert.ok(l.events.some(e => e.event === 'empty' && e.owner === 1));
  // New input after old-owner death is a positive liveness proof, not just kill(pid,0).
  for (const s of all) {
    assert.ok(alive(s.pid), `CLI ${s.id} survived owner 1 exit`);
    assert.equal(proc(s.pid).start, s.start, `same CLI birth for ${s.id}`);
    assert.equal(proc(s.pid).ppid, s.guardian, `guardian ${s.id} remains the CLI parent`);
    assert.notEqual(proc(s.guardian).ppid, l.owners.newPid, 'owner 2 is not an adopting subreaper');
  }
  await l.rpc('write', { id: 'bash', data: "printf '__BASH_%s__\\n' 1\n" });
  await l.wait(() => /^__BASH_1__\r?$/m.test(l.text('bash')), 'Bash/readline still interactive after old-owner death');
  running = false; await traffic; assert.equal(trafficError, undefined);
  await l.wait(() => [...sent].every(([id, n]) =>
    [...l.text(id).matchAll(new RegExp(`^ACK ${id} IN (\\d+) payload-${id}-\\d+\\r?$`, 'gm'))].length >= n), 'all numbered inputs acknowledged');
  for (const [id, n] of sent) {
    const acks = [...l.text(id).matchAll(new RegExp(`^ACK ${id} IN (\\d+) payload-${id}-(\\d+)\\r?$`, 'gm'))];
    assert.deepEqual(acks.map(m => [+m[1], +m[2]]), Array.from({ length: n }, (_, k) => [k, k]), `${id}: no lost, duplicate or reordered input`);
  }
  for (const s of all) await l.rpc('resize', { id: s.id, rows: 37, cols: 109 });
  await l.wait(() => [...sent.keys()].every(id => l.text(id).includes(`SIZE ${id} 37 109`)), 'SIGWINCH and sizes after move');
  await l.rpc('write', { id: 'bash', data: 'stty size\n' });
  await l.wait(() => /^37 109\r?$/m.test(l.text('bash')), 'real Bash/stty sees resized kernel terminal');

  const codes = [0, 7, 23, 143];
  for (const [n, s] of all.entries()) {
    await l.rpc('write', { id: s.id, data: s.id === 'bash' ? 'exit 19\n' : n === 11 ? 'SIGNAL\n' : `EXIT ${codes[n % codes.length]}\n` });
  }
  await l.wait(() => l.events.filter(e => e.event === 'exit').length === all.length, 'all CLI statuses delivered');
  await l.wait(() => all.every(s => !alive(s.guardian)), 'all guardians collected by supervisor/launchd');
  await l.wait(() => l.events.filter(e => e.event === 'terminal-eof').length === all.length, 'all final output drained');
  for (const [n, s] of all.entries()) {
    const exit = l.events.filter(e => e.event === 'exit' && e.id === s.id);
    assert.equal(exit.length, 1, 'single exit notification');
    assert.equal(exit[0].owner, 2);
    assert.equal(exit[0].guardian, s.guardian, 'real CLI parent reports its waitpid result');
    assert.equal(exit[0].ownerWait, -1, 'new owner cannot waitpid the CLI (ECHILD)');
    assert.equal(exit[0].code, s.id === 'bash' ? 19 : n === 11 ? -1 : codes[n % codes.length]);
    assert.equal(exit[0].signal, n === 11 ? 15 : 0);
    assert.equal(exit[0].raw, n === 11 ? 15 : exit[0].code << 8);
    if (s.id !== 'bash') {
      const ticks = [...l.text(s.id).matchAll(new RegExp(`^TICK ${s.id} (\\d+)\\r?$`, 'gm'))].map(m => +m[1]);
      assert.ok(ticks.length > 10, 'autonomous program output spans the handover');
      assert.deepEqual(ticks, Array.from({ length: ticks.length }, (_, k) => k), `${s.id}: output continuous without duplicates`);
      if (n !== 11) {
        await l.wait(() => l.text(s.id).includes(`FINAL ${s.id} ${ticks.length}`), 'complete final output drained');
      }
    }
    assert.equal(alive(s.pid), false);
    assert.equal(alive(s.guardian), false);
  }
  console.log(JSON.stringify({ proof: 'batched-live-io', sessions: all.length,
    inputs: [...sent.values()].reduce((a, b) => a + b, 0),
    batches: l.events.filter(e => e.event === 'batch'),
    failedBatches: l.events.filter(e => e.event === 'batch-failed'),
    unrelatedTicksDuringRejectedBatch: unaffectedAfter - unaffectedBefore,
    unrelatedOwner1TicksDuringRejectedBatch: oldUnaffectedAfter - oldUnaffectedBefore, stageDelay,
    exits: l.events.filter(e => e.event === 'exit').map(({ id, code, signal, owner }) => ({ id, code, signal, owner })),
    reapedByGuardian: all.length, receivedByNewOwner: all.length,
    newOwnerWaitpid: 'ECHILD', bash: 'readline + stty',
    parentExitDetection: process.platform === 'darwin' ? 'kqueue NOTE_EXIT' : 'Node child exit', leftoverPids: 0 }));
  if (process.platform === 'darwin') await l.wait(() => l.events.some(e => e.event === 'kqueue-NOTE_EXIT' && e.pid === l.owners.oldPid), 'macOS parent-death observation');
});

test('should retain exact statuses for exits before, during and after a move', async t => {
  const l = await lab(t);
  const pre = await l.create('pre'), during = await l.create('during'), after = await l.create('after');
  await l.rpc('write', { id: pre.id, data: 'EXIT 7\n' });
  await l.wait(() => l.events.find(e => e.event === 'guardian-reaped' && e.id === pre.id), 'exit before transfer collected in owner 1');
  assert.equal((await l.rpc('move', { ids: [pre.id] })).ok, true);
  const moving = l.rpc('move', { ids: [during.id, after.id], stageDelay: 80 });
  await l.wait(() => l.events.find(e => e.event === 'staged' && e.ids.includes(during.id)), 'descriptors staged, no receiver reads yet');
  process.kill(during.pid, 'SIGTERM');
  assert.equal((await moving).ok, true);
  await l.wait(() => l.events.find(e => e.event === 'old-exit'), 'old owner empty');
  await l.rpc('write', { id: after.id, data: 'EXIT 143\n' });
  await l.wait(() => l.events.filter(e => e.event === 'exit').length === 3, 'all exit channels delivered');
  await l.wait(() => [pre, during, after].every(s => !alive(s.guardian)), 'all guardians collected');
  for (const [id, code, signal] of [['pre', 7, 0], ['during', -1, 15], ['after', 143, 0]]) {
    const exits = l.events.filter(e => e.event === 'exit' && e.id === id);
    assert.equal(exits.length, 1);
    assert.equal(exits[0].code, code); assert.equal(exits[0].signal, signal);
    assert.equal(exits[0].raw, signal || (code << 8));
    assert.equal(exits[0].ownerWait, -1);
  }
  assert.equal(l.events.find(e => e.event === 'exit' && e.id === 'during').owner, 2);
  console.log(JSON.stringify({ proof: 'exit-boundaries', statuses: l.events.filter(e => e.event === 'exit') }));
});

test('should confine a session on last-owner EOF while another session continues', async t => {
  const l = await lab(t);
  const dropped = await l.create('dropped'), kept = await l.create('kept');
  assert.equal((await l.rpc('move', { ids: [dropped.id, kept.id] })).ok, true);
  await l.wait(() => l.events.find(e => e.event === 'old-exit'), 'old owner exited');
  await l.rpc('drop', { id: dropped.id });
  await l.wait(() => !alive(dropped.pid) && !alive(dropped.guardian), 'EOF guardian and CLI collected');
  await l.rpc('write', { id: kept.id, data: 'still-alive\n' });
  await l.wait(() => l.text(kept.id).includes('ACK kept still-alive'), 'unrelated terminal remains interactive');
  await l.rpc('write', { id: kept.id, data: 'EXIT 0\n' });
  await l.wait(() => l.events.find(e => e.event === 'exit' && e.id === kept.id), 'last CLI status received');
  console.log(JSON.stringify({ proof: 'last-owner-containment', droppedGone: true, unrelated: 'ACK kept still-alive' }));
});
