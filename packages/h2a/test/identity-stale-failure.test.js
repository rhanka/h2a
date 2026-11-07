import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentityController } from '../dist/runtime/mcp/identity-state.js';
import { createMcpServer } from '../dist/runtime/mcp/server.js';

for (const change of ['lock-vanished', 'succ-vanished', 'succ-replaced', 'succ-corrupted', 'unknown-generation-vanished']) {
  for (const tool of ['h2a_identity_status', 'h2a_send']) {
    test(`${tool}: refreshes retryable failure on ${change} in one call, without extra workers`, async t => {
      const dir = mkdtempSync(join(tmpdir(), 'h2a-stale-failure-'));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const lock = join(dir, 'identity', '.lock'); mkdirSync(join(dir, 'identity'));
      const generation = 'a'.repeat(32), successor = 'b'.repeat(32), succ = `${lock}.succ.${generation}`;
      writeFileSync(lock, JSON.stringify({ token: generation }));
      writeFileSync(succ, JSON.stringify({ token: successor, target: generation }));
      let spawns = 0, error;
      const controller = createIdentityController({
        request: { root: dir, host: 'test', cwd: dir }, timeoutMs: 5000, retryMinIntervalMs: 30000,
        spawnWorker: () => { spawns++; return { onResolved() {}, onError(cb) { error = cb; }, onExitWithoutResult() {}, cancel() {} }; },
        activate: () => ({ ok: true, sessionId: 'sess:test' })
      });
      t.after(() => controller.cancel('transport_closed'));
      controller.start();
      error('identity_timeout', 'blocked', { lock: 'identity/.lock', generation: change.startsWith('unknown') ? 'unknown' : successor,
        target: generation, blockerType: 'SUCC', retryCondition: 'blocker-change', reason: 'blocked', reasonCode: 'succ-chain-exhausted',
        elapsedMs: 5000, budgetMs: 5000, pid: process.pid, machineClass: 'local', bootClass: 'current', ns: 'unknown', start: 'unknown' });
      const failedAttempt = controller.status().attemptId;
      const server = createMcpServer({ root: dir, storeInitialize: false, identity: controller });
      const call = () => server.callTool(tool, tool === 'h2a_send' ? { to: 'nobody', body: 'test' } : {});
      const kept = JSON.parse((await call()).content[0].text);
      assert.equal(kept.state ?? kept.error, 'identity_failed', 'standing SUCC must not be mistaken for a changed LOCK generation');
      assert.equal(spawns, 1);
      if (change.includes('lock-vanished') || change.startsWith('unknown')) unlinkSync(lock);
      else if (change === 'succ-vanished') unlinkSync(succ);
      else if (change === 'succ-corrupted') writeFileSync(succ, '{replaced');
      else writeFileSync(succ, JSON.stringify({ token: 'c'.repeat(32), target: generation }));
      const fresh = JSON.parse((await call()).content[0].text);
      assert.equal(fresh.state ?? fresh.error, 'identity_pending');
      assert.notEqual(fresh.attemptId, failedAttempt);
      assert.equal(fresh.attemptId, controller.status().attemptId, 'guarded calls expose the fresh attemptId too');
      assert.equal(spawns, 2);
      for (let i = 0; i < 20; i++) await call();
      assert.equal(spawns, 2, 'pending calls never start parallel attempts');
    });
  }
}
