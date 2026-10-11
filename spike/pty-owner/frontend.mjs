import fs from 'node:fs';
import path from 'node:path';
import { serve, rpc, json, identity, fds } from './lab.mjs';

const root = process.env.SPIKE_ROOT;
const generation = +process.argv[2];
const activated = process.env.SPIKE_B_ACTIVATION !== '0';
const candidate = path.join(root, `front-${generation}.sock`);
const publicPath = path.join(root, 'front.sock');
const server = serve(activated ? 0 : candidate, async request => {
  if (request.op === 'frontend-status') return { frontend: identity(process.pid), generation, fds: fds() };
  return rpc(path.join(root, 'owner.sock'), request);
});
server.on('error', error => { throw error; });
server.on('listening', () => {
  if (activated) fs.linkSync(publicPath, candidate);
  fs.renameSync(candidate, publicPath);
  fs.chmodSync(publicPath, 0o600);
  json(path.join(root, `front-ready-${generation}.json`), {
    birth: identity(process.pid), activated, inode: fs.statSync(publicPath).ino,
  });
});
