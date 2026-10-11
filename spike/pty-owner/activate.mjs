import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { here, json, identity } from './lab.mjs';

const root = process.env.SPIKE_ROOT;
const seed = path.join(root, 'seed.sock');
const socket = path.join(root, 'owner.sock');
const server = net.createServer();
server.listen(seed, () => {
  // A hard link keeps the pathname while libuv unlinks seed.sock on close.
  fs.linkSync(seed, socket);
  fs.chmodSync(socket, 0o600);
  const child = spawn(process.execPath, [path.join(here, 'image-0.mjs')], {
    cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit', server._handle.fd],
  });
  child.on('spawn', () => {
    json(path.join(root, 'owner-birth.json'), identity(child.pid));
    server.close();
  });
  child.on('error', error => { console.error(error); process.exit(1); });
  child.on('exit', (code, signal) => {
    console.log(JSON.stringify({ ownerExit: { code, signal } })); process.exit(code ?? 1);
  });
});
