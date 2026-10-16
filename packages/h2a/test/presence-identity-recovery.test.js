import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMcpServer, listPresence } from '../dist/index.js';
import { createIdentityController } from '../dist/runtime/mcp/identity-state.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, budget = 5000) {
  const deadline = Date.now() + budget;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail(`condition not reached within ${budget}ms: ${JSON.stringify(value)}`);
}

test('status-only retry recovers a real dead-holder v2 lock using real identity workers', { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'h2a-presence-recovery-'));
  const processes = [];
  const exits = [];
  const fork = childProcess.fork;
  t.mock.method(childProcess, 'fork', (...args) => {
    const child = fork(...args);
    processes.push(child);
    // IPC EPIPE during cooperative cancellation is handled by the production
    // fork wrapper. Await exit without turning that diagnostic event into an
    // unrelated, temporarily unhandled promise rejection in the fixture.
    exits.push(new Promise(resolve => child.once('exit', resolve)));
    return child;
  });
  syncBuiltinESMExports();
  let controller;
  let server;
  try {
    assert.ok(new Set([0xef53, 0x58465342, 0x9123683e, 0xf2f52010]).has(statfsSync(root).type >>> 0),
      'recovery-qualified filesystem is mandatory; no skip');
    const home = join(root, 'home');
    mkdirSync(home);
    const lock = join(root, 'identity', '.lock');
    const holder = childProcess.fork(new URL('./helpers/presence-identity-holder.mjs', import.meta.url), [lock],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    assert.deepEqual((await once(holder, 'message'))[0], { ready: true });
    const bytes = readFileSync(lock);
    const logs = [];
    controller = createIdentityController({ request: { root, cwd: root, host: 'claude', name: 'isolated-retry',
      providerEnv: { HOME: home, XDG_CONFIG_HOME: home, XDG_STATE_HOME: home, CLAUDE_CODE_SESSION_ID: 'presence-retry' } },
      timeoutMs: 1500, retryMinIntervalMs: 0, log: line => logs.push(line),
      activate: identity => ({ ok: true, sessionId: server.sessions.open({ instance: identity.instance }).sessionId }) });
    server = createMcpServer({ root, identity: controller, sessions: { autoHeartbeat: false } });
    controller.start();
    const failed = await until(() => controller.status(), state => state.state === 'identity_failed');
    assert.equal(failed.cause, 'identity_timeout', logs.join('\n'));
    assert.equal(failed.retryable, true);
    assert.equal(failed.diagnostic.reasonCode, 'holder-live');
    holder.kill('SIGKILL');
    await exits[0];
    assert.deepEqual(readFileSync(lock), bytes, 'death leaves the actual original lock untouched');
    await server.callTool('h2a_identity_status', {});
    assert.equal(controller.status().state, 'identity_pending', 'status alone must relaunch identity');
    await until(async () => {
      await server.callTool('h2a_identity_status', {});
      return controller.status();
    }, state => state.state === 'identity_ready');
    assert.equal(existsSync(lock), false, '0.98.6 recovery retires and releases the ghost fence');
    assert.equal(listPresence(root).length, 1);
    assert.equal(readFileSync(join(root, 'identity', 'bindings.jsonl'), 'utf8').trim().split('\n').length, 1,
      'one binding, no duplicate mint');
    assert.equal(processes.length, 3, 'one holder + exactly two real worker attempts');
  } finally {
    controller?.cancel('test complete');
    server?.sessions.closeAll();
    // Cooperative worker cancellation first; terminate only this test's forks
    // if a failed assertion interrupted a live fixture.
    await delay(100);
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    await Promise.all(exits);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
