import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { here, json, identity } from './lab.mjs';

const root = process.env.SPIKE_ROOT;
const seed = path.join(root, 'seed.sock');
const socket = path.join(root, 'owner.sock');
const server = net.createServer();
const publicServer = net.createServer();
if (process.env.SPIKE_B === '1') {
  await new Promise(resolve => publicServer.listen(path.join(root, 'public-seed.sock'), resolve));
  fs.linkSync(path.join(root, 'public-seed.sock'), path.join(root, 'front.sock'));
}
server.listen(seed, () => {
  // A hard link keeps the pathname while libuv unlinks seed.sock on close.
  fs.linkSync(seed, socket);
  fs.chmodSync(socket, 0o600);
  const child = spawn(process.execPath, [path.join(here, 'image-0.mjs')], {
    cwd: root, env: process.env, stdio: process.env.SPIKE_B === '1'
      ? [server._handle.fd, 'inherit', 'inherit', publicServer._handle.fd]
      : process.env.SPIKE_DIRECT_LISTENER === '1'
      ? ['ignore', 'inherit', 'inherit', server._handle.fd]
      : [server._handle.fd, 'inherit', 'inherit'],
  });
  child.on('spawn', () => {
    json(path.join(root, 'owner-birth.json'), identity(child.pid));
    server.close();
    if (process.env.SPIKE_B === '1') publicServer.close();
  });
  child.on('error', error => { console.error(error); process.exit(1); });
  child.on('exit', (code, signal) => {
    console.log(JSON.stringify({ ownerExit: { code, signal } })); process.exit(code ?? 1);
  });
});
