import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeTerminalClient } from '../../packages/h2a-runtime/src/native-terminal/client.ts';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const poc = fileURLToPath(new URL('./', import.meta.url));
export type Sandbox = { root: string; socket: string; focusSocket: string; hostPid: number; generation: string; token: string };
export function isolatedEnv(root: string): Record<string, string> {
  return { PATH: '/usr/bin:/bin', HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'runtime'),
    XDG_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config'), H2A_ROOT: join(root, 'h2a'),
    H2A_NATIVE_SOCKET: join(root, 'runtime', 'host.sock'), TMPDIR: join(root, 'tmp'),
    H2A_POC_TEMP_PARENT: dirname(root), TSX_DISABLE_CACHE: '1', TERM: 'xterm-256color', LANG: 'C.UTF-8' };
}
export async function readSandbox(path: string): Promise<Sandbox> {
  // Child TMPDIR is sandbox/tmp; preserve the mkdtemp parent explicitly.
  const temp = await realpath(process.env.H2A_POC_TEMP_PARENT ?? tmpdir());
  const root = dirname(resolve(path));
  if (basename(path) !== 'sandbox.json' || dirname(root) !== temp || !/^h2a-mwt-[\w-]+$/.test(basename(root))) {
    throw new Error('sandbox descriptor must be directly inside an isolated h2a-mwt temporary directory');
  }
  if (await realpath(root) !== root || (await lstat(path)).isSymbolicLink()) throw new Error('sandbox symlink refused');
  const info = await lstat(root);
  if (info.mode & 0o077 || info.uid !== process.getuid?.()) throw new Error('sandbox must be private and owned');
  const data = JSON.parse(await readFile(path, 'utf8')) as Sandbox;
  if (data.root !== root || data.socket !== join(root, 'runtime', 'host.sock') ||
      data.focusSocket !== join(root, 'runtime', 'focus.sock') || !Number.isSafeInteger(data.hostPid) || data.hostPid <= 0 ||
      typeof data.generation !== 'string' || !data.generation || typeof data.token !== 'string' || !data.token) {
    throw new Error('invalid sandbox descriptor');
  }
  if (await realpath(join(root, 'runtime')) !== join(root, 'runtime')) throw new Error('sandbox runtime symlink refused');
  for (const endpoint of [data.socket, data.focusSocket]) {
    try {
      const socket = await lstat(endpoint);
      if (!socket.isSocket() || socket.isSymbolicLink() || socket.mode & 0o077 || socket.uid !== process.getuid?.()) {
        throw new Error('sandbox endpoint must be a private owned socket; symlinks refused');
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return data;
}
export async function connectHost(sandbox: Sandbox): Promise<NativeTerminalClient> {
  // Revalidate paths on every connection, and never use runtime default discovery.
  sandbox = await readSandbox(join(sandbox.root, 'sandbox.json'));
  const client = await NativeTerminalClient.connect(sandbox.socket);
  try {
    const ping = await client.ping();
    if (ping.hostPid !== sandbox.hostPid || ping.generation !== sandbox.generation) throw new Error('sandbox host identity mismatch');
    return client;
  } catch (error) { client.close(); throw error; }
}
export async function waitUntil<T>(operation: () => Promise<T | undefined>, milliseconds = 2000): Promise<T> {
  const deadline = Date.now() + milliseconds;
  do {
    const result = await operation();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(`condition failed after ${milliseconds}ms`);
}
export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM'); // Only this function's own spawn receipt.
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}
export async function startSandbox(): Promise<{ sandbox: Sandbox; close(): Promise<void> }> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'h2a-mwt-'));
  for (const dir of ['home', 'runtime', 'state', 'config', 'h2a', 'tmp']) await mkdir(join(root, dir), { mode: 0o700 });
  const generation = randomUUID();
  const socket = join(root, 'runtime', 'host.sock');
  const child = spawn(process.execPath, ['--import', 'tsx', join(repo, 'packages/h2a-runtime/src/native-terminal/process.ts'),
    '--socket', socket, '--generation', generation, '--registry-path', join(root, 'h2a', 'registry.json')],
    { cwd: repo, env: isolatedEnv(root), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout!.on('data', data => { output += data; });
  child.stderr!.on('data', data => { errors += data; });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  try {
    await waitUntil(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`isolated host failed: ${errors}`);
      return output.includes('h2a.native-terminal.ready') ? true : undefined;
    }, 5000);
    const sandbox = { root, socket, focusSocket: join(root, 'runtime', 'focus.sock'), hostPid: child.pid!, generation, token: randomUUID() };
    await writeFile(join(root, 'sandbox.json'), JSON.stringify(sandbox, null, 2), { mode: 0o600 });
    const client = await connectHost(sandbox); client.close();
    return { sandbox, async close() { await stopChild(child); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await stopChild(child); await rm(root, { recursive: true, force: true }); throw error; }
}
