import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function identity(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { pid, state: fields[0], ppid: +fields[1], pgid: +fields[2],
    sid: +fields[3], tty: +fields[4], start: fields[19], exit: +fields[49] };
}
export function sameBirth(before) {
  try { return identity(before.pid).start === before.start; } catch { return false; }
}
export function fdFlags(fd, pid = process.pid) {
  const text = fs.readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8');
  return parseInt(text.match(/^flags:\s+(\d+)/m)[1], 8);
}
export function fds(pid = process.pid) {
  return fs.readdirSync(`/proc/${pid}/fd`).flatMap(fd => {
    try { return [{ fd: +fd, target: fs.readlinkSync(`/proc/${pid}/fd/${fd}`),
      flags: fdFlags(fd, pid) }]; } catch { return []; }
  });
}
export async function until(probe, ms = 5000) {
  const deadline = Date.now() + ms;
  do { const value = await probe(); if (value) return value; await sleep(5); }
  while (Date.now() < deadline);
  throw new Error(`fixture deadline exceeded (${ms}ms)`);
}
export function json(file, value) {
  fs.writeFileSync(`${file}.new`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${file}.new`, file);
}
export function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function rpc(socket, request, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const client = net.connect(socket);
    const timer = setTimeout(() => client.destroy(new Error('RPC deadline')), timeout);
    let buffer = '';
    client.on('connect', () => client.end(`${JSON.stringify(request)}\n`));
    client.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      clearTimeout(timer); client.destroy();
      try { resolve(JSON.parse(buffer.split('\n')[0])); } catch (error) { reject(error); }
    });
    client.on('error', error => { clearTimeout(timer); reject(error); });
    client.on('close', () => {
      clearTimeout(timer);
      if (!buffer.includes('\n')) reject(new Error('RPC closed without response'));
    });
  });
}
export function lab(node = process.execPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-spike-'));
  fs.chmodSync(root, 0o700);
  const env = { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root,
    XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root,
    H2A_ROOT: root, TERM: 'xterm-256color', SPIKE_ROOT: root };
  const children = [], guardians = [];
  let out = '';
  function launch(file, args = [], stdio = ['ignore', 'pipe', 'pipe']) {
    const child = spawn(node, [path.join(here, file), ...args], {
      cwd: root, env, stdio,
    });
    child.on('error', error => { out += `${error.stack}\n`; });
    children.push(child);
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', b => { out += b; });
    return child;
  }
  async function rememberGuardians() {
    for (const name of fs.readdirSync(root).filter(n => /^identity-\d+\.json$/.test(n))) {
      const info = read(path.join(root, name));
      if (!guardians.some(g => g.pid === info.guardian.pid)) guardians.push(info.guardian);
    }
  }
  async function cleanup() {
    await rememberGuardians();
    const ownerFile = path.join(root, 'owner-birth.json');
    if (fs.existsSync(ownerFile)) {
      const owner = read(ownerFile);
      if (sameBirth(owner)) { try { process.kill(owner.pid, 'SIGKILL'); } catch {} }
    }
    // Only direct children started above, then guardian births recorded by our stubs.
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const guardian of guardians) {
      if (sameBirth(guardian)) { try { process.kill(guardian.pid, 'SIGUSR1'); } catch {} }
    }
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null
      ? undefined : new Promise(resolve => child.once('exit', resolve))));
    await sleep(30);
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { root, env, launch, cleanup, rememberGuardians, log: () => out };
}
export function serve(fdOrPath, handler) {
  const server = fdOrPath instanceof net.Server ? fdOrPath : net.createServer({ allowHalfOpen: true });
  server.allowHalfOpen = true;
  server.on('connection', client => {
    let buffer = '';
    client.on('error', () => {});
    client.on('end', () => { if (!buffer.includes('\n')) client.end(); });
    client.on('data', async chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      try { client.end(`${JSON.stringify(await handler(JSON.parse(buffer.split('\n')[0])))}\n`); }
      catch (error) { client.end(`${JSON.stringify({ error: error.message })}\n`); }
    });
  });
  if (!(fdOrPath instanceof net.Server)) server.listen(typeof fdOrPath === 'number' ? { fd: fdOrPath } : fdOrPath);
  return server;
}
