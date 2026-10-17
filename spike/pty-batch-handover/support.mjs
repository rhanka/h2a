import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as pause } from 'node:timers/promises';

export async function until(check, label, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await pause(5);
  }
  assert.fail(`timed out: ${label}`);
}
let activeNative;
export function proc(pid) { return activeNative.identity(pid); }
export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
}
export async function lab(t) {
  assert.ok(['linux', 'darwin'].includes(process.platform), 'Linux/macOS required; absent capabilities must fail, never skip');
  const root = mkdtempSync(join(tmpdir(), 'pty-batch-'));
  const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TERM: 'xterm', PS1: 'spike> ',
    ENV: 'test-pty-batch', SPIKE_BUILD: root };
  for (const [key, dir] of Object.entries({ HOME: 'home', TMPDIR: 'tmp', XDG_RUNTIME_DIR: 'run',
    XDG_CONFIG_HOME: 'config', XDG_STATE_HOME: 'state', XDG_CACHE_HOME: 'cache' })) {
    env[key] = join(root, dir); mkdirSync(env[key], { mode: 0o700 });
  }
  env.SPIKE_LEGACY_PARENT_DEATH = process.env.SPIKE_LEGACY_PARENT_DEATH ?? '0';
  env.SPIKE_DISABLE_EXIT_CHANNEL = process.env.SPIKE_DISABLE_EXIT_CHANNEL ?? '0';
  env.SPIKE_STAGE_DELAY = process.env.SPIKE_STAGE_DELAY ?? '25';
  const source = fileURLToPath(new URL('native.c', import.meta.url));
  const headers = [process.env.SPIKE_NODE_INCLUDE, '/usr/include/node', resolve(dirname(process.execPath), '../include/node')]
    .find(path => path && existsSync(join(path, 'node_api.h')));
  assert.ok(headers, 'Node N-API headers required');
  const shared = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC'];
  for (const args of [
    ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', ...shared, `-I${headers}`, source, '-o', join(root, 'native.node'), '-lutil'],
    ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DGUARDIAN_MAIN', source, '-o', join(root, 'guardian')],
  ]) {
    const build = spawnSync('/usr/bin/cc', args, { env, encoding: 'utf8' });
    assert.equal(build.status, 0, `native build failed: ${build.stderr}`);
  }
  const native = createRequire(import.meta.url)(join(root, 'native.node'));
  activeNative = native;
  // Linux test supervisor only: PID 1 in containers need not reap orphans.
  // Neither PTY owner nor session guardian uses a subreaper in the design.
  native.subreaper(); // Darwin no-op: launchd collects orphan guardians.
  const watcher = native.parentWatch();
  const child = fork(fileURLToPath(new URL('owner.mjs', import.meta.url)), ['new'], {
    env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const events = [], output = new Map(), pids = new Set([child.pid]), guardianPids = new Set(), pending = new Map();
  let request = 0, stderr = '', gone = false;
  child.stdout.on('data', data => { stderr += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.on('exit', () => { gone = true; });
  child.on('message', msg => {
    if (msg.reply) {
      const p = pending.get(msg.reply); pending.delete(msg.reply);
      if (msg.error) p?.reject(new Error(msg.error)); else p?.resolve(msg.value);
      return;
    }
    msg.time = Date.now(); events.push(msg);
    if (msg.event === 'owners') {
      pids.add(msg.oldPid); pids.add(msg.newPid);
      if (watcher >= 0) native.watchPid(watcher, msg.oldPid);
    }
    if (msg.event === 'born') { pids.add(msg.pid); pids.add(msg.guardian); guardianPids.add(msg.guardian); }
    if (msg.event === 'output') output.set(msg.id, (output.get(msg.id) ?? '') + Buffer.from(msg.data, 'base64').toString());
  });
  const rpc = (op, values = {}) => new Promise((resolve, reject) => {
    const id = ++request;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout ${op}: ${stderr}`)); }, 4000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: err => { clearTimeout(timeout); reject(err); } });
    child.send({ request: id, op, ...values });
  });
  const check = () => {
    for (const pid of guardianPids) {
      const result = native.wait(pid);
      if (result?.pid > 0) events.push({ event: 'supervisor-reaped', ...result });
    }
    if (watcher >= 0) {
      const pid = native.pollWatch(watcher);
      if (pid) events.push({ event: 'kqueue-NOTE_EXIT', pid });
    }
    const fatal = events.find(e => e.event === 'fatal' || e.event === 'diagnostic');
    assert.equal(fatal, undefined, JSON.stringify(fatal));
    assert.equal(stderr, '', stderr);
  };
  const text = id => output.get(id) ?? '';
  const wait = (fn, label) => until(() => { check(); return fn(); }, label);
  t.after(async () => {
    let forced = false;
    try {
      if (!gone) { await rpc('stop'); await until(() => gone, 'owners shut down'); }
    } catch (error) {
      forced = true;
      console.log(`cleanup fallback: ${error.message}`);
      // Exact registered PIDs only; keep the test subreaper alive to collect orphans.
      for (const pid of [...pids].reverse()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      await until(() => gone, 'coordinator stopped after fallback');
    }
    for (const pid of pids) if (pid !== child.pid) {
      await until(() => { native.wait(pid); return !alive(pid); }, `spawned PID ${pid} reaped`);
    }
    assert.ok([...pids].every(pid => !alive(pid)), 'nothing spawned is left running');
    if (watcher >= 0) native.close(watcher);
    rmSync(root, { recursive: true, force: true });
    assert.equal(forced, false, 'normal cleanup must work');
  });
  await wait(() => events.find(e => e.event === 'owners'), 'both owners started');
  return {
    rpc, events, text, wait, check,
    owners: events.find(e => e.event === 'owners'),
    async create(id, kind = 'fixture') {
      const s = await rpc('create', { values: { id, kind } });
      pids.add(s.guardian); guardianPids.add(s.guardian);
      const born = await wait(() => events.find(e => e.event === 'born' && e.id === id), `${id} born`);
      if (kind === 'fixture') await wait(() => text(id).includes(`READY ${id} ${born.pid} leaked=0`), `${id} real terminal and descriptor hygiene`);
      else await wait(() => text(id).includes('spike>'), 'Bash readline prompt');
      assert.equal(proc(born.pid).ppid, s.guardian, 'guardian is the real CLI parent');
      return { ...s, pid: born.pid, start: proc(born.pid).start };
    },
  };
}
