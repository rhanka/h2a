// Isolated incident lab: no installed h2a, provider, user bus or owner process.
// Mandatory Node discovery/release regression. Run after the build with a private TMPDIR.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { NativeTerminalClient } from '../../../h2a-runtime/dist/native-terminal/client.js';

const repo = resolve(import.meta.dirname, '../../../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');
const cli = join(repo, 'packages/h2a/dist/bin.js');
const tracker = `import {appendFileSync,readFileSync,symlinkSync} from 'node:fs';import {registerHooks} from 'node:module';
if(process.env.LAB_BASELINE_GUARD)registerHooks({load(url,context,next){
  return url.endsWith('/conv-guard.js')?{format:'module',source:readFileSync(process.env.LAB_BASELINE_GUARD,'utf8'),shortCircuit:true}:next(url,context);
}});
const start=readFileSync('/proc/self/stat','utf8').split(') ')[1].split(' ')[19];
appendFileSync(process.env.LAB_PIDS,JSON.stringify({pid:process.pid,start,args:process.argv,cgroup:readFileSync('/proc/self/cgroup','utf8')})+'\\n');
try{symlinkSync('/proc/'+process.pid,process.env.H2A_TEST_PROC_ROOT+'/'+process.pid)}catch(e){if(e.code!=='EEXIST')throw e}
`;

export function fixture(t) {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== '/tmp', 'Supply a disposable TMPDIR');
  const root = mkdtempSync(join(tmpdir(), 'r-'));
  const env = { PATH: join(root, 'bin') + ':/usr/bin:/bin', HOME: join(root, 'home'), TMPDIR: root,
    XDG_RUNTIME_DIR: root, TMUX_TMPDIR: root, TMUX: '', XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'), REMOTE_CLI_CONFIG_HOME: join(root, 'config'),
    H2A_ROOT: join(root, 'store'), H2A_MCP_CENTRAL: 'off', H2A_NATIVE_SOCKET: join(root, 'h'), H2A_TEST_PROC_ROOT: join(root, 'proc'),
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(root, 'no-bus'), LAB_PIDS: join(root, 'pids'), TERM: 'xterm-256color',
    LAB_BASELINE_GUARD: process.env.H2A_LAB_BASELINE_GUARD ?? '',
    NODE_OPTIONS: '--import=' + pathToFileURL(join(root, 'track.mjs')).href };
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'H2A_TEST_PROC_ROOT'])
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'track.mjs'), tracker);
  writeFileSync(join(root, 'agent.mjs'), "process.stdout.write('agent-ready\\n');process.stdin.on('data',b=>process.stdout.write('ack:'+b));setInterval(()=>{},1000);\n");
  writeFileSync(join(root, 'bin/codex'), `#!/bin/sh\nexec '${process.execPath}' '${join(root, 'agent.mjs')}' "$@"\n`, { mode: 0o700 });
  const registry = join(env.REMOTE_CLI_CONFIG_HOME, '.config/sentropic/h2a/registry.json');
  mkdirSync(resolve(registry, '..'), { recursive: true });
  const children = [];
  function start(args, entry = cli, extra = {}) {
    const child = spawn(process.execPath, [entry, ...args], { cwd: env.HOME, env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
    return { child, done, output: () => ({ stdout, stderr }) };
  }
  const recorded = () => existsSync(env.LAB_PIDS) ? readFileSync(env.LAB_PIDS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let disposed = false;
  const dispose = async () => {
    if (disposed) return; disposed = true;
    for (const { pid, start } of recorded().reverse()) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
        if (stat[19] === start && !['Z', 'X'].includes(stat[0])) process.kill(pid, 'SIGKILL');
      } catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
    }
    await Promise.all(children.map(child => child.exitCode === null && child.signalCode === null ? once(child, 'close') : undefined));
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  };
  t.after(dispose);
  const entries = n => Array.from({ length: n }, (_, i) => ({ id: `old-${i}`, tool: 'codex', kind: 'local-native',
    cwd: env.HOME, tmuxSession: `h2a-old-${i}`, convId: `other-${i}`, source: 'run', sessionClass: 'human',
    enrolledAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }));
  const save = rows => writeFileSync(registry, JSON.stringify({ version: 1, entries: rows }));
  const resume = i => start(['run', 'codex', env.HOME, '--resume', `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    '--name', `lab-${i}`, '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']);
  const mixed = n => entries(n).map((row, i) => ({ ...row,
    cwd: join(env.HOME, 'src', i % 6 === 4 ? 'project/tmp/worktrees/agent' : 'project'),
    ...(i % 6 === 1 ? { sessionClass: 'background', delegationOrigin: 'mcp:h2a_run' } : {}),
    ...(i % 6 === 2 ? { sessionClass: undefined } : {}),
    ...(i % 6 === 3 ? { endedAt: new Date().toISOString() } : {}),
    ...(i % 6 === 4 ? { parent: 'conductor' } : {}),
    ...(i % 6 === 5 ? { ownerHostPid: 2147483647 } : {}),
  }));
  return { root, env, registry, start, recorded, entries, mixed, save, resume, dispose };
}

export async function usable(f, id, token = 'lab-exchange') {
  const client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
  try {
    await eventually(() => client.readOutput(id, 0), r => r.chunks.some(c => c.data.includes('agent-ready')));
    const lease = await client.acquireController(id, 'lab-' + id);
    try {
      await client.write(lease, token + '\n');
      await eventually(() => client.readOutput(id, 0), r => r.chunks.some(c => c.data.includes('ack:' + token)));
    } finally { await client.releaseController(lease); }
  } finally { client.close(); }
}

export async function eventually(read, predicate, ms = 5000) {
  const deadline = performance.now() + ms;
  let value;
  do { try { value = await read(); if (predicate(value)) return value; } catch { /* Retry readiness only. */ }
    await pause(10);
  } while (performance.now() < deadline);
  assert.fail(`Readiness did not converge: ${JSON.stringify(value)}`);
}
