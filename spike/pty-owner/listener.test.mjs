import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lab, rpc, until } from './lab.mjs';

test('should preserve the activated listener using Node execve stdio guarantees', async t => {
  const l = lab(); t.after(() => l.cleanup());
  l.env.SPIKE_DIRECT_LISTENER = process.env.SPIKE_DIRECT_LISTENER ?? '0';
  l.launch('activate.mjs');
  await until(() => fs.existsSync(path.join(l.root, 'ready.json')));
  const status = await rpc(path.join(l.root, 'owner.sock'), { op: 'status' });
  t.diagnostic(JSON.stringify({ node: process.version, listenerFlags: status.listenerFlags, fd: status.fd }));
  if (l.env.SPIKE_DIRECT_LISTENER === '1') assert.equal(status.listenerFlags & 0o2000000, 0);
  else {
    assert.equal(status.listenerFD, 0);
    const result = await rpc(path.join(l.root, 'owner.sock'), { op: 'exec' });
    assert.equal(result.ok, true);
    await until(async () => {
      try { return (await rpc(path.join(l.root, 'owner.sock'), { op: 'status' })).generation === 1; }
      catch { return false; }
    });
  }
});
