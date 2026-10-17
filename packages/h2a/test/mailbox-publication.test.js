import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalStore } from '../dist/index.js';

const envelope = {
  protocol: 'sentropic.h2a', version: '0.1', id: 'env-atomic',
  from: 'codex:sender', to: ['claude:reader'], subject: 'atomic delivery',
  type: 'event', actor: { instance: 'codex:sender', role: 'AGENTS', scope: 'scope:default' },
  body: { text: 'complete message' }, createdAt: '2026-10-17T00:00:00.000Z',
};

for (const box of ['Inbox', 'Outbox']) {
  test(`${box}: readers see only complete messages during first publication and replacement`, t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'mailbox-publication-'));
    const store = createLocalStore({ root });
    const actor = 'claude:reader';
    const put = value => store[`put${box}Message`](actor, value);
    const read = () => store[`read${box}`](actor);
    const write = fs.writeFileSync;
    let observed = 0, before = [];
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });
    t.mock.method(fs, 'writeFileSync', (path, data, options) => {
      if (typeof data !== 'string' || !data.includes('"id": "env-atomic"')) return write(path, data, options);
      // Deterministically observe the same partial-write window seen by the CI reader.
      const middle = Math.floor(data.length / 2);
      write(path, data.slice(0, middle), options);
      observed++;
      assert.deepEqual(read(), before, 'an in-progress write must preserve the previous snapshot');
      return write(path, typeof path === 'number' ? data.slice(middle) : data, options);
    });
    syncBuiltinESMExports();
    put(envelope);
    assert.deepEqual(read(), [envelope]);
    before = [envelope];
    const replacement = { ...envelope, body: { text: 'replacement' } };
    put(replacement);
    assert.deepEqual(read(), [replacement]);
    assert.equal(observed, 2, 'both writes reached the partial-write barrier');
  });

  for (const failure of ['writeFileSync', 'renameSync']) {
    test(`${box}: failed ${failure} preserves the previous message and removes staging bytes`, t => {
      const root = fs.mkdtempSync(join(tmpdir(), 'mailbox-failure-'));
      const store = createLocalStore({ root });
      const actor = 'reader';
      const put = value => store[`put${box}Message`](actor, value);
      const read = () => store[`read${box}`](actor);
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });
      put(envelope);
      const original = fs[failure];
      t.mock.method(fs, failure, (...args) => {
        if (failure === 'writeFileSync' && !String(args[1]).includes('"id": "env-atomic"')) return original(...args);
        if (failure === 'writeFileSync') original(args[0], '{', args[2]);
        throw new Error('injected publication failure');
      });
      syncBuiltinESMExports();
      assert.throws(() => put({ ...envelope, body: { text: 'lost replacement' } }), /injected publication failure/);
      assert.deepEqual(read(), [envelope]);
      const dir = join(root, box.toLowerCase(), actor);
      assert.deepEqual(fs.readdirSync(dir), ['env-atomic.json'], 'no staging file or writer lock survives');
    });
  }
}
