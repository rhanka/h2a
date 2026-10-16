import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { identityKeyPaths, resolveLiveIdentityAsync } from '../dist/runtime/identity/live.js';
import { establishWriterControl, updateWriterControl, withWriterMutation, writerDirectory } from '../dist/runtime/handover/mutation.js';

const test = (name, fn) => {
  if (!process.env.MH_L2_IDENTITY_CASE || name === process.env.MH_L2_IDENTITY_CASE) nodeTest(name, fn);
};
function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l2-identity-'));
  const root = join(directory, 'store'), state = join(directory, 'state');
  fs.mkdirSync(root); fs.mkdirSync(state, { mode: 0o700 });
  establishWriterControl(root, state);
  return { directory, root, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('identity should generate Ed25519 keys outside the global writer lock and recheck the gate before publishing', async t => {
  for (const closeGate of [false, true]) {
    const f = fixture(), generate = crypto.generateKeyPairSync;
    let generated = 0;
    try {
      t.mock.method(crypto, 'generateKeyPairSync', (...args) => {
        generated++;
        const probe = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', join(writerDirectory(f.root), '.mutation.lock'), '/usr/bin/true']);
        assert.equal(probe.status, 0, 'key generation must not hold the global writer lock');
        if (closeGate) updateWriterControl(f.root, { gate: 'BARRIER', handoverId: 'h' });
        return generate(...args);
      });
      syncBuiltinESMExports();
      const resolve = () => resolveLiveIdentityAsync({ root: f.root, host: 'claude', cwd: f.directory, name: 'contention' });
      if (closeGate) {
        await assert.rejects(resolve, /store_admission_closed/);
        assert.equal(fs.existsSync(join(f.root, 'keys')), false, 'a new barrier must prevent key publication');
      } else {
        const identity = await resolve();
        assert.ok(fs.existsSync(identity.privateKeyPath));
        const privateKey = fs.readFileSync(identity.privateKeyPath), publicKey = fs.readFileSync(identity.publicKeyPath);
        assert.ok(crypto.verify(null, Buffer.from('proof'), publicKey, crypto.sign(null, Buffer.from('proof'), privateKey)));
      }
      assert.equal(generated, 1);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.close(); }
  }
});

test('identity should preserve a competing keypair published while its candidate is generated', async t => {
  const f = fixture(), generate = crypto.generateKeyPairSync;
  const winner = generate('ed25519'), instance = 'claude:competing-key';
  const privatePem = winner.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicPem = winner.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const paths = identityKeyPaths(f.root, instance);
  try {
    t.mock.method(crypto, 'generateKeyPairSync', (...args) => {
      withWriterMutation(f.root, 'registry', () => {
        fs.mkdirSync(join(f.root, 'keys'), { recursive: true });
        fs.writeFileSync(paths.privateKeyPath, privatePem, { mode: 0o600 });
        fs.writeFileSync(paths.publicKeyPath, publicPem);
      });
      return generate(...args);
    });
    syncBuiltinESMExports();
    const resolved = await resolveLiveIdentityAsync({ root: f.root, host: 'claude', cwd: f.directory, name: 'contending' },
      { mintMemo: { value: { instance, agentUuid: crypto.randomUUID() } } });
    assert.equal(resolved.instance, instance);
    assert.equal(fs.readFileSync(resolved.privateKeyPath, 'utf8'), privatePem);
    assert.equal(fs.readFileSync(resolved.publicKeyPath, 'utf8'), publicPem);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.close(); }
});

async function stop(child, closed) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await closed;
}

for (const exhausted of [false, true]) {
  test(`identity worker should ${exhausted ? 'classify exhausted mutation contention as identity_timeout' : 'retry mutation contention within its identity budget'}`, async () => {
    const f = fixture();
    let holder, holderClosed, worker, workerClosed;
    try {
      // A real, owned child holds the same OFD lock used by the worker. No
      // production timeout or lock implementation is replaced for this repro.
      const holderPath = join(f.directory, 'holder.mjs');
      const mutation = new URL('../dist/runtime/handover/mutation.js', import.meta.url).href;
      fs.writeFileSync(holderPath, `import { mutationLock } from ${JSON.stringify(mutation)};
        mutationLock(process.argv[2], () => { process.send('locked');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 7000); });
        process.disconnect();`);
      holder = fork(holderPath, [writerDirectory(f.root)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      holderClosed = once(holder, 'close');
      assert.equal((await Promise.race([once(holder, 'message'), holderClosed.then(() => { throw new Error('lock holder exited before readiness'); })]))[0], 'locked');
      worker = fork(fileURLToPath(new URL('../dist/runtime/identity/worker.js', import.meta.url)), [], {
        env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'mh-l2-contention' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      });
      workerClosed = once(worker, 'close');
      let stderr = ''; worker.stderr.on('data', bytes => { stderr += bytes; });
      const response = Promise.race([once(worker, 'message'), workerClosed.then(() => { throw new Error('worker exited before result: ' + stderr); })]);
      worker.send({ kind: 'resolve_identity', v: 1, budgetMs: exhausted ? 100 : 15000,
        request: { root: f.root, host: 'claude', cwd: f.directory, name: 'contention' } });
      const [message] = await response;
      if (exhausted) {
        assert.equal(message.kind, 'identity_error');
        assert.equal(message.cause, 'identity_timeout', JSON.stringify(message));
      } else {
        assert.equal(message.kind, 'identity_resolved', JSON.stringify(message));
        assert.ok(fs.existsSync(message.identity.privateKeyPath));
      }
      await workerClosed;
    } finally {
      if (worker) await stop(worker, workerClosed);
      if (holder) await stop(holder, holderClosed);
      f.close();
    }
  });
}
