import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { listPresenceWithDiagnostics, readPresence, writePresence } from '../dist/runtime/local-files/presence.js';

for (const kind of ['expired', 'malformed', 'unreadable']) {
  test('scan preserves a fresh publication replacing an ' + kind + ' snapshot', t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'h2a-sweep-race-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const now = Date.now();
    const fresh = { instance: 'claude:race:111111111111', sessionId: 'sess:race', pid: process.pid,
      startedAt: new Date(now - 120000).toISOString(), heartbeatAt: new Date(now).toISOString(),
      state: 'live', interests: { scopes: [], negotiations: [] }, subscribedTopics: [] };
    const { path } = writePresence(root, { ...fresh, heartbeatAt: fresh.startedAt });
    if (kind === 'malformed') fs.writeFileSync(path, '{');
    const read = fs.readFileSync;
    let replaced = false;
    fs.readFileSync = (file, ...args) => {
      const old = read(file, ...args);
      if (file === path && !replaced) {
        replaced = true;
        writePresence(root, fresh);
        assert.deepEqual(readPresence(root, fresh.sessionId), fresh, 'fresh publication exists before scan continues');
        if (kind === 'unreadable') throw Object.assign(new Error('injected read EIO'), { code: 'EIO' });
      }
      return old;
    };
    syncBuiltinESMExports();
    try {
      const scan = listPresenceWithDiagnostics(root);
      assert.equal(replaced, true, 'race was exercised');
      assert.deepEqual(scan.sessions, [], 'stale snapshot is never announced as live');
      if (kind !== 'expired') assert.equal(scan.warnings.length, 1);
      assert.deepEqual(readPresence(root, fresh.sessionId), fresh, 'scan must not delete the newer heartbeat');
      assert.deepEqual(listPresenceWithDiagnostics(root).sessions, [fresh], 'next scan rediscovers the fresh session');
    } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
  });
}
