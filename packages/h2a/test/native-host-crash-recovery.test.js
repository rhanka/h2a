// Isolated incident lab: no installed h2a, provider, user bus or owner process.
// Mandatory Node discovery/release regression. Run after the build with a private TMPDIR.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { NativeTerminalClient } from '../../h2a-runtime/dist/native-terminal/client.js';
import { convOwners } from '../../h2a-runtime/dist/conv-guard.js';

const repo = resolve(import.meta.dirname, '../../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');
const cli = join(repo, 'packages/h2a/dist/bin.js');
const tracker = `import {appendFileSync,readFileSync,symlinkSync} from 'node:fs';
const start=readFileSync('/proc/self/stat','utf8').split(') ')[1].split(' ')[19];
appendFileSync(process.env.LAB_PIDS,JSON.stringify({pid:process.pid,start,args:process.argv})+'\\n');
try{symlinkSync('/proc/'+process.pid,process.env.H2A_TEST_PROC_ROOT+'/'+process.pid)}catch(e){if(e.code!=='EEXIST')throw e}
`;

function fixture(t) {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== '/tmp', 'Supply a disposable TMPDIR');
  const root = mkdtempSync(join(tmpdir(), 'r-'));
  const env = { PATH: join(root, 'bin') + ':/usr/bin:/bin', HOME: join(root, 'home'), TMPDIR: root,
    XDG_RUNTIME_DIR: root, TMUX_TMPDIR: root, TMUX: '', XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'), REMOTE_CLI_CONFIG_HOME: join(root, 'config'),
    H2A_ROOT: join(root, 'store'), H2A_MCP_CENTRAL: 'off', H2A_NATIVE_SOCKET: join(root, 'h'), H2A_TEST_PROC_ROOT: join(root, 'proc'),
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(root, 'no-bus'), LAB_PIDS: join(root, 'pids'), TERM: 'xterm-256color',
    NODE_OPTIONS: '--import=' + pathToFileURL(join(root, 'track.mjs')).href };
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'H2A_TEST_PROC_ROOT'])
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'track.mjs'), tracker);
  writeFileSync(join(root, 'agent.mjs'), "process.stdout.write('agent-ready\\n');process.stdin.resume();setInterval(()=>{},1000);\n");
  writeFileSync(join(root, 'bin/codex'), `#!/bin/sh\nexec '${process.execPath}' '${join(root, 'agent.mjs')}' "$@"\n`, { mode: 0o700 });
  const registry = join(env.REMOTE_CLI_CONFIG_HOME, '.config/sentropic/h2a/registry.json');
  mkdirSync(resolve(registry, '..'), { recursive: true });
  const children = [];
  function start(args, entry = cli, extra = {}) {
    const child = spawn(process.execPath, [entry, ...args], { cwd: env.HOME, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
    return { child, done, output: () => ({ stdout, stderr }) };
  }
  const recorded = () => existsSync(env.LAB_PIDS) ? readFileSync(env.LAB_PIDS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  t.after(async () => {
    for (const { pid, start } of recorded().reverse()) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
        if (stat[19] === start && !['Z', 'X'].includes(stat[0])) process.kill(pid, 'SIGKILL');
      } catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
    }
    await Promise.all(children.map(child => child.exitCode === null && child.signalCode === null ? once(child, 'close') : undefined));
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  const entries = n => Array.from({ length: n }, (_, i) => ({ id: `old-${i}`, tool: 'codex', kind: 'local-native',
    cwd: env.HOME, tmuxSession: `h2a-old-${i}`, convId: `other-${i}`, source: 'run', sessionClass: 'human',
    enrolledAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }));
  const save = rows => writeFileSync(registry, JSON.stringify({ version: 1, entries: rows }));
  const resume = i => start(['run', 'codex', env.HOME, '--resume', `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    '--name', `lab-${i}`, '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']);
  return { root, env, registry, start, recorded, entries, save, resume };
}

async function eventually(read, predicate, ms = 5000) {
  const deadline = performance.now() + ms;
  let value;
  do { try { value = await read(); if (predicate(value)) return value; } catch { /* Retry readiness only. */ }
    await pause(10);
  } while (performance.now() < deadline);
  assert.fail(`Readiness did not converge: ${JSON.stringify(value)}`);
}

test('startup-latency: conversation guard probes only the requested conversation among 500 rows', t => {
  const f = fixture(t); f.save([...f.entries(499), { ...f.entries(1)[0], id: 'target', convId: 'target-conversation' }]);
  const probes = [];
  assert.deepEqual(convOwners('target-conversation', { registryPath: f.registry,
    nativeSessionLiveness: name => { probes.push(name); return false; } }), []);
  assert.equal(probes.length, 1, `Probed ${probes.length} sessions for one conversation`);
  assert.equal(probes[0], 'h2a-old-0');
});

test('startup-latency: one resume with 500 registry rows reaches host start within 2 seconds', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save(f.entries(500));
  const begun = performance.now(); const run = f.resume(1);
  try {
    await eventually(f.recorded, rows => rows.some(row => row.args[1] === hostEntry), 2000);
  } finally { t.diagnostic(JSON.stringify({ scenario: 'startup-latency', hostStartMs: Math.round(performance.now() - begun), ...run.output() })); }
  const result = await run.done;
  assert.equal(result.code, 0, result.stderr + result.stdout);
});

test('crash-recovery: five concurrent resume clients recover one SIGKILLed host', { timeout: 20000 }, async t => {
  const f = fixture(t); f.save([]);
  const old = f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
  let client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
  const before = await client.ping(); client.close();
  old.child.kill('SIGKILL'); await old.done;
  const begun = performance.now();
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => f.resume(i + 1).done));
  t.diagnostic(JSON.stringify({ scenario: 'crash-recovery', elapsedMs: Math.round(performance.now() - begun), codes: results.map(r => r.code) }));
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  client = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
  try {
    assert.notEqual((await client.ping()).hostPid, before.hostPid);
    assert.equal((await client.list()).filter(row => row.status === 'running').length, 5);
    const liveHosts = f.recorded().filter(row => row.args[1] === hostEntry).filter(({ pid, start }) => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
        return stat[19] === start && !['Z', 'X'].includes(stat[0]);
      } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    });
    assert.equal(liveHosts.length, 1, 'Concurrent starters left more than one live host');
  } finally { client.close(); }
});

test('startup-latency: restoring ten resumes with 500 registry rows converges within 30 seconds', { timeout: 32000 }, async t => {
  const f = fixture(t); f.save(f.entries(500));
  const begun = performance.now();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => f.resume(i + 20).done));
  const elapsedMs = Math.round(performance.now() - begun);
  t.diagnostic(JSON.stringify({ scenario: 'startup-latency-restore', elapsedMs, codes: results.map(r => r.code) }));
  assert.ok(elapsedMs < 30000, `${elapsedMs} ms`);
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  const client = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
  try { assert.equal((await client.list()).filter(row => row.status === 'running').length, 10); }
  finally { client.close(); }
});

test('oom-isolation: host requests its own protected systemd scope before admitting PTYs', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save([]);
  // An instrumented private busctl records the exact manager request; no real user bus.
  const log = join(f.root, 'systemd-request');
  writeFileSync(join(f.root, 'bin/busctl'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nexit 1\n`, { mode: 0o700 });
  const run = f.resume(80); const result = await run.done;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.ok(existsSync(log), 'Native host did not request an independent systemd scope');
  const args = readFileSync(log, 'utf8');
  assert.match(args, /StartTransientUnit/);
  assert.match(args, /h2a-native-.*\.scope/);
  assert.match(args, /ManagedOOMPreference\ns\navoid/);
  assert.match(args, /MemoryHigh\nt\n/);
  assert.match(args, /PIDs\nau\n1\n\d+/);
  const host = f.recorded().find(row => row.args[1] === hostEntry);
  assert.ok(host);
  assert.ok(args.includes(`PIDs\nau\n1\n${host.pid}\n`), 'Scope must move the host, never the launching CLI');
});

test('startup-latency: fresh, resume and restore add at most 500 ms with 500 mixed rows', { timeout: 60000 }, async t => {
  const f = fixture(t); f.save([]);
  const warmup = await f.resume(900).done;
  assert.equal(warmup.code, 0, warmup.stderr);
  const project = join(f.env.HOME, 'src', 'project');
  mkdirSync(project, { recursive: true });
  const mixed = f.entries(500).map((row, i) => ({ ...row, cwd: project,
    convId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ...(i % 3 === 1 ? { sessionClass: 'background' } : i % 3 === 2 ? { sessionClass: undefined } : {}),
    ...(i % 4 === 0 ? { kind: 'local-tmux', endedAt: new Date().toISOString() } : {}),
  }));
  let index = 1000;
  const commands = {
    fresh: () => f.start(['run', 'codex', f.env.HOME, '--name', `fresh-${index++}`,
      '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']),
    resume: () => f.resume(index++),
    restore: () => f.start(['restore', '--dry-run', '--no-gw']),
  };
  for (const [scenario, run] of Object.entries(commands)) {
    const samples = [[], []];
    for (let round = 0; round < 3; round++) {
      for (const size of [0, 1]) {
        const real = JSON.parse(readFileSync(f.registry, 'utf8')).entries.filter(row => !row.id.startsWith('old-'));
        f.save([...real, ...(size ? mixed : [])]);
        const before = f.recorded().length;
        const begun = performance.now();
        const result = await run().done;
        samples[size].push(Math.round(performance.now() - begun));
        assert.equal(result.code, 0, result.stderr + result.stdout);
        const probes = f.recorded().slice(before).filter(row => row.args[1]?.endsWith('/native-terminal/op.js'));
        assert.ok(probes.length <= 8, `${scenario}: unbounded per-row subprocesses: ${probes.length}`);
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[1];
    const overheadMs = median(samples[1]) - median(samples[0]);
    t.diagnostic(JSON.stringify({ scenario, emptyMs: samples[0], registry500Ms: samples[1], overheadMs }));
    assert.ok(overheadMs <= 500, `${scenario} added ${overheadMs} ms with 500 rows`);
  }
});
