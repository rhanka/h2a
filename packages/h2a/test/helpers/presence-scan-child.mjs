import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
const root = process.argv[2];
const readdir = fs.readdirSync;
let fail = false, failures = 0;
fs.readdirSync = (path, ...args) => {
  if (fail && path === root + '/presence') {
    fail = false; failures++;
    throw Object.assign(new Error('injected presence scan EIO'), { code: 'EIO' });
  }
  return readdir(path, ...args);
};
syncBuiltinESMExports();
const { runMcpStdio, listPresence, writePresence } = await import('../../dist/index.js');
const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
let diagnostics = '', frames = '';
stderr.on('data', chunk => { diagnostics += chunk; });
stdout.on('data', chunk => { frames += chunk; });
const running = runMcpStdio({ root, workspaceRoot: root, stdin, stdout, stderr,
  autoOpen: { instance: 'claude:scan:111111111111', host: 'claude' },
  heartbeatIntervalMs: 10, notifyIntervalMs: 10 });
process.send({ session: listPresence(root)[0] });
process.on('message', async message => {
  if (message === 'fail') {
    const now = new Date().toISOString();
    writePresence(root, { instance: 'codex:peer:222222222222', sessionId: 'sess:peer', pid: process.pid,
      startedAt: now, heartbeatAt: now, state: 'live', interests: { scopes: [], negotiations: [] }, subscribedTopics: [] });
    fail = true;
    const deadline = Date.now() + 2000;
    while (!failures || !frames.includes('presence.peer_joined')) {
      if (Date.now() > deadline) throw new Error('scan recovery deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'initialize' }) + '\n');
    while (!frames.includes('"id":42')) {
      if (Date.now() > deadline) throw new Error('MCP response deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    process.send({ failures, diagnostics, frames, sessions: listPresence(root) });
  } else if (message === 'stop') {
    stdin.end(); await running; process.disconnect();
  }
});
