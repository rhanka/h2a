import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMcpServer } from '../dist/index.js';

function rootFor(t) {
  const root = mkdtempSync(join(tmpdir(), 'h2a-scan-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('MCP survives a periodic presence scan EIO and resumes notifications and heartbeats', { timeout: 6000 }, async t => {
  const root = rootFor(t);
  const child = fork(new URL('./helpers/presence-scan-child.mjs', import.meta.url), [root],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  const next = () => Promise.race([
    once(child, 'message').then(([message]) => message),
    exited.then(() => { throw new Error('MCP exited during scan: ' + stderr); })
  ]);
  const { session } = await next();
  child.send('fail');
  const reply = await next();
  assert.equal(reply.failures, 1, 'the scan really failed');
  assert.match(reply.diagnostics, /notification scan failed; retrying next tick.*injected presence scan EIO/);
  const frames = reply.frames.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(frames.some(frame => frame.id === 42 && frame.result), 'MCP still responds');
  assert.ok(frames.some(frame => frame.params?.topic === 'presence.peer_joined' && frame.params.data.peer.sessionId === 'sess:peer'), 'missed diff is retried');
  assert.ok(Date.parse(reply.sessions.find(s => s.sessionId === session.sessionId).heartbeatAt) > Date.parse(session.heartbeatAt));
  child.send('stop'); await exited;
  assert.equal(child.exitCode, 0);
});

test('periodic dispatcher retries when the sink and its error reporter throw', { timeout: 2000 }, async t => {
  const root = rootFor(t);
  let attempts = 0, diagnostics = 0;
  let resolve;
  const recovered = new Promise(done => { resolve = done; });
  const server = createMcpServer({ root, notifications: { intervalMs: 5,
    onError: () => { diagnostics++; throw new Error('broken diagnostic'); },
    sink: () => { if (++attempts === 1) throw new Error('broken sink'); resolve(); }
  } });
  const own = server.sessions.open({ instance: 'claude:self:111111111111' });
  const peer = server.sessions.open({ instance: 'codex:peer:222222222222' });
  t.after(() => { server.notifications.stop(); server.sessions.close(own.sessionId); server.sessions.close(peer.sessionId); });
  server.notifications.start();
  let timer;
  try { await Promise.race([recovered, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no retry')), 500); })]); }
  finally { clearTimeout(timer); }
  assert.equal(diagnostics, 1);
  assert.ok(attempts >= 2);
});
