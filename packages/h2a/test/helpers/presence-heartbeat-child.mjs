import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

const root = process.argv[2];
const rename = fs.renameSync;
let failNext = false;
fs.renameSync = (from, to) => {
  if (failNext && String(from).startsWith(root + '/presence/')) {
    failNext = false;
    throw Object.assign(new Error('injected transient presence I/O failure'), { code: 'EIO' });
  }
  return rename(from, to);
};
syncBuiltinESMExports();
const { runMcpStdio, listPresence } = await import('../../dist/index.js');
const stdin = new PassThrough();
const stdout = new PassThrough();
const stderr = new PassThrough();
let diagnostics = '';
let frames = '';
stderr.on('data', chunk => { diagnostics += chunk; });
stdout.on('data', chunk => { frames += chunk; });
const running = runMcpStdio({ root, workspaceRoot: root, stdin, stdout, stderr,
  autoOpen: { instance: 'claude:heartbeat:111111111111', host: 'claude' }, heartbeatIntervalMs: 20 });
const session = listPresence(root)[0];
process.send({ sessionId: session.sessionId });
process.on('message', async message => {
  if (message === 'fail') {
    failNext = true;
    setTimeout(() => {
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'initialize' }) + '\n');
      setTimeout(() => process.send({ recovered: listPresence(root)[0], diagnostics, frames }), 20);
    }, 120);
  } else if (message === 'stop') {
    stdin.end();
    await running;
    process.disconnect();
  }
});
