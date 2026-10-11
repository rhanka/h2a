import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { lab, rpc, until, sleep } from './lab.mjs';
import { historicalAttach, adapter } from './historical-attach.mjs';

test('should reconnect the actual 0.98.5 runAttach source and a new observer across exec', async t => {
  const l = lab(); t.after(() => l.cleanup()); l.launch('activate.mjs');
  const socket = path.join(l.root, 'owner.sock');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  for (let id = 0; id < 2; id++) await rpc(socket, { op: 'create' });
  await until(() => fs.existsSync(path.join(l.root, 'identity-1.json')));
  await l.rememberGuardians();
  const extracted = await historicalAttach(l.root);
  const stdin = new PassThrough(), stdout = new PassThrough(); let rendered = '';
  stdout.on('data', b => { rendered += b; });
  const counts = { connects: 0, lastSeq: 0 };
  const attached = extracted.runAttach('0', { connect: adapter(socket, counts), stdin, stdout,
    now: Date.now, delay: sleep, onResize() {}, offResize() {} });
  await until(() => counts.lastSeq > 0);
  let cursor = 0; const bytes = [];
  for (let generation = 1; generation <= 6; generation++) {
    await rpc(socket, { op: 'exec' });
    await until(async () => {
      try { const s = await rpc(socket, { op: 'status' }); return s.generation === generation && s.build.startsWith(`N${generation % 2}:`); }
      catch { return false; }
    });
    const replay = await rpc(socket, { op: 'read', id: 1, after: cursor });
    assert.equal(replay.gap, false); cursor = replay.next;
    bytes.push(...replay.chunks.map(c => Buffer.from(c.data, 'base64')));
    await sleep(150);
  }
  await sleep(150); stdin.write(Buffer.from([0x1c]));
  const code = await attached;
  assert.equal(code, 0); assert.ok(counts.connects > 1); assert.match(rendered, /native terminal reconnected/);
  assert.doesNotMatch(rendered, /attach stopped|no longer available/);
  const matches = [...rendered.matchAll(/COUNT:0:(\d+):é🙂/g)].map(m => +m[1]);
  assert.ok(matches.length > 5);
  assert.deepEqual(matches, Array.from({ length: matches.length }, (_, n) => n));
  const modern = [...Buffer.concat(bytes).toString().matchAll(/COUNT:1:(\d+):é🙂/g)].map(m => +m[1]);
  assert.deepEqual(modern, Array.from({ length: modern.length }, (_, n) => n));
  t.diagnostic(JSON.stringify({ node: process.version, code, transitions: 6, counts,
    historicalCounters: matches.length, newObserverCounters: modern.length,
    sourceSha256: extracted.sourceSha256, limitation: extracted.limitation }));
});
