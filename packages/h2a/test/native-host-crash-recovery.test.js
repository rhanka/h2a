// Isolated incident lab: no installed h2a, provider, user bus or owner process.
// Mandatory Node discovery/release regression. Run after the build with a private TMPDIR.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { acquireFileLock, releaseFileLock } from '../../h2a-runtime/dist/file-lock.js';
import { NativeTerminalClient } from '../../h2a-runtime/dist/native-terminal/client.js';
import { convOwners } from '../../h2a-runtime/dist/conv-guard.js';

import { fixture, eventually, usable } from './helpers/restart-lab.js';
const repo = resolve(import.meta.dirname, '../../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');

test('incident lab waits for its recorded descendants to exit before deleting their HOME', async t => {
  const f = fixture(t);
  const descendant = join(f.root, 'descendant.mjs'), launcher = join(f.root, 'launcher.mjs');
  writeFileSync(descendant, 'setInterval(() => {}, 1000);');
  writeFileSync(launcher, `import {spawn} from 'node:child_process';spawn(process.execPath,[${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();`);
  assert.equal((await f.start([], launcher).done).code, 0);
  const record = await eventually(() => f.recorded().find(row => row.args[1] === descendant), Boolean);
  const live = () => {
    try { const stat = readFileSync(`/proc/${record.pid}/stat`, 'utf8').split(') ')[1].split(' ');
      return stat[19] === record.start && !['Z', 'X'].includes(stat[0]);
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const kill = process.kill.bind(process);
  let requested;
  const signalled = new Promise(resolve => { requested = resolve; });
  const mock = t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === record.pid && signal === 'SIGKILL') { requested(); return true; }
    return kill(pid, signal);
  });
  const disposing = f.dispose();
  try {
    await signalled;
    await pause(20); // Model a signal request whose process has not exited yet.
    assert.equal(live(), true);
    assert.equal(existsSync(f.root), true, 'a pending descendant can still write into its HOME');
  } finally {
    mock.mock.restore();
    if (live()) kill(record.pid, 'SIGKILL');
    await eventually(live, value => !value);
    await disposing;
  }
  assert.equal(existsSync(f.root), false);
});

test('crash-recovery: contended registry creation keeps the host responsive without spawning an unrecorded PTY', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save([]);
  f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
  const client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
  const observer = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
  const fd = acquireFileLock(f.registry);
  assert.notEqual(fd, undefined);
  let held = true;
  const release = () => { if (held) { held = false; releaseFileLock(fd, f.registry); } };
  const timer = setTimeout(release, 800);
  const creating = client.create({ id: 'blocked', command: process.execPath, args: [join(f.root, 'agent.mjs')],
    cwd: f.env.HOME, env: f.env, cols: 80, rows: 24 });
  let listed;
  const listing = client.list().then(sessions => { listed = sessions; return sessions; });
  try {
    await pause(100);
    await observer.ping(250);
    assert.equal(held, true, 'the host must answer while another registry writer still owns the lock');
    assert.equal(listed, undefined, 'one connection must retain request ordering while create waits');
    assert.equal(f.recorded().filter(row => row.args[1] === join(f.root, 'agent.mjs')).length, 0,
      'waiting for the registry must precede spawning the PTY');
    release();
    assert.equal((await creating).id, 'blocked');
    assert.deepEqual((await listing).map(session => session.id), ['blocked']);
    await usable(f, 'blocked');
  } finally {
    clearTimeout(timer); release();
    await creating.catch(() => {});
    await listing.catch(() => {});
    client.close(); observer.close();
  }
});

test('crash-recovery: a disconnected creation waiter never spawns after the registry lock is released', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save([]);
  f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
  const client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
  const observer = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
  const fd = acquireFileLock(f.registry);
  assert.notEqual(fd, undefined);
  let held = true;
  try {
    const result = client.create({ id: 'cancelled', command: process.execPath, args: [join(f.root, 'agent.mjs')],
      cwd: f.env.HOME, env: f.env, cols: 80, rows: 24 }).catch(error => error);
    await pause(100);
    client.close();
    assert.match((await result).message, /closed/);
    await pause(50);
    releaseFileLock(fd, f.registry); held = false;
    await pause(100);
    assert.deepEqual(await observer.list(), []);
    assert.equal(f.recorded().filter(row => row.args[1] === join(f.root, 'agent.mjs')).length, 0);
  } finally {
    if (held) releaseFileLock(fd, f.registry);
    client.close(); observer.close();
  }
});

test('crash-recovery: an overflowing creation queue is disconnected without spawning queued PTYs', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save([]);
  f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
  const observer = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
  const fd = acquireFileLock(f.registry);
  assert.notEqual(fd, undefined);
  const socket = createConnection(f.env.H2A_NATIVE_SOCKET);
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write(Array.from({ length: 65 }, (_, i) => JSON.stringify({ version: 1, id: String(i), operation: 'create',
      params: { id: 'overflow-' + i, command: process.execPath, args: [join(f.root, 'agent.mjs')],
        cwd: f.env.HOME, env: f.env, cols: 80, rows: 24 } }) + '\n').join(''));
    await eventually(() => socket.destroyed, Boolean);
    await observer.ping(250);
  } finally { releaseFileLock(fd, f.registry); socket.destroy(); }
  try {
    await pause(100);
    assert.deepEqual(await observer.list(), []);
    assert.equal(f.recorded().filter(row => row.args[1] === join(f.root, 'agent.mjs')).length, 0);
  } finally { observer.close(); }
});

test('startup-latency: a direct native resume does not initialize account enrollment or screen rendering', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save([]);
  const guard = join(f.root, 'unused-components.mjs');
  writeFileSync(guard, `import {registerHooks} from 'node:module';
    registerHooks({resolve(specifier,context,next){
      if(['@sentropic/cluster-mesh/llm-mesh/facade','@xterm/headless','@hono/node-server','hono','hono/streaming'].includes(specifier))
        throw new Error('unneeded startup component: '+specifier);
      return next(specifier,context);
    }});`);
  const result = await f.start(['run', 'codex', f.env.HOME, '--resume', '00000000-0000-4000-8000-000000000073',
    '--name', 'direct', '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare'], undefined,
    { NODE_OPTIONS: f.env.NODE_OPTIONS + ' --import=' + pathToFileURL(guard).href }).done;
  assert.equal(result.code, 0, result.stderr);
  await usable(f, 'h2a-direct');
});

test('crash-recovery: async probe closes a timed-out list connection and exits after a successful retry', { timeout: 12000 }, async t => {
  const f = fixture(t);
  const sockets = new Set();
  let lists = 0;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (request.operation === 'list' && ++lists === 1) continue;
        const result = request.operation === 'ping'
          ? { protocolVersion: 1, generation: 'private-host', hostPid: process.pid }
          : [];
        socket.write(JSON.stringify({ version: 1, id: request.id, ok: true, result }) + '\n');
      }
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(f.env.H2A_NATIVE_SOCKET);
  await once(server, 'listening');
  chmodSync(f.env.H2A_NATIVE_SOCKET, 0o600);
  const entry = join(f.root, 'probe.mjs');
  writeFileSync(entry, `import {probeNativeSession} from ${JSON.stringify(pathToFileURL(join(repo, 'packages/h2a-runtime/dist/native-terminal/op.js')).href)};
    console.log(JSON.stringify(await probeNativeSession('missing',process.env.H2A_NATIVE_SOCKET)));`);
  const probe = f.start([], entry);
  await eventually(() => probe.output().stdout, output => output.includes('"verdict":"dead"'), 8000);
  assert.ok(lists >= 2, 'the first list must time out and a successor must answer');
  await eventually(() => sockets.size, count => count === 0, 500);
  const result = await probe.done;
  assert.equal(result.code, 0, result.stderr);
});

test('startup-latency: conversation guard probes only the requested conversation among 500 rows', t => {
  const f = fixture(t); f.save([...f.entries(499), { ...f.entries(1)[0], id: 'target', convId: 'target-conversation' }]);
  const probes = [];
  assert.deepEqual(convOwners('target-conversation', { registryPath: f.registry,
    nativeSessionLiveness: name => { probes.push(name); return false; } }), []);
  assert.equal(probes.length, 1, `Probed ${probes.length} sessions for one conversation`);
  assert.equal(probes[0], 'h2a-old-0');
});

test('startup-latency: real run --resume probes one matching owner and no foreign conversation', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const target = { ...f.entries(1)[0], id: 'target', tmuxSession: 'h2a-target',
    convId: '00000000-0000-4000-8000-000000000071' };
  f.save([...f.mixed(499), target]);
  const run = f.resume(71);
  await eventually(() => ({ code: run.child.exitCode,
    ownerProbes: f.recorded().filter(r => r.args[2] === 'probe').map(r => r.args[4]) }), r => r.code !== null);
  const result = await run.done;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  await usable(f, 'h2a-lab-71');
  const owners = f.recorded().filter(r => r.args[1]?.endsWith('/op.js') && r.args[2] === 'probe' && r.args[4] !== 'h2a-lab-71');
  assert.deepEqual(owners.map(r => r.args[4]), ['h2a-target']);
  t.diagnostic(JSON.stringify({ rows: 500, ownerProbes: owners.length, cliExchange: true }));
});

test('startup-latency: real resume refuses an unreadable matching row before starting a CLI', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save([...f.mixed(499), { id: 'broken', convId: '00000000-0000-4000-8000-000000000072' }]);
  const result = await f.resume(72).done;
  assert.equal(result.code, 1, result.stderr + result.stdout);
  assert.match(result.stderr, /unreadable|unknown/i);
  assert.equal(f.recorded().filter(r => r.args[1] === join(f.root, 'agent.mjs')).length, 0);
});

test('sessions-never-start: fresh and resume reach CLI I/O with 451 owner-shaped mixed rows', { timeout: 10000 }, async t => {
  const f = fixture(t); f.save(f.mixed(451));
  const begun = performance.now();
  const fresh = await f.start(['run', 'codex', f.env.HOME, '--name', 'fresh-owner',
    '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done;
  assert.equal(fresh.code, 0, fresh.stderr);
  await usable(f, 'h2a-fresh-owner');
  const freshMs = Math.round(performance.now() - begun);
  const resumeBegun = performance.now();
  const run = f.resume(451);
  await eventually(() => ({ code: run.child.exitCode,
    probes: f.recorded().filter(r => r.args[2] === 'probe').map(r => r.args[4]) }), r => r.code !== null);
  const resumed = await run.done;
  assert.equal(resumed.code, 0, resumed.stderr);
  await usable(f, 'h2a-lab-451');
  assert.ok(f.recorded().filter(r => r.args[2] === 'probe').every(r => ['h2a-fresh-owner', 'h2a-lab-451'].includes(r.args[4])));
  t.diagnostic(JSON.stringify({ rows: 451, classes: 'human/background/legacy/exited/worktree/undetermined', freshMs,
    resumeMs: Math.round(performance.now() - resumeBegun), cliExchanges: 2 }));
});

test('crash-recovery: ten concurrent read-only absence proofs converge after SIGKILL', { timeout: 12000 }, async t => {
  const f = fixture(t); f.save([]);
  const old = f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
  const client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean); await client.ping(); client.close();
  old.child.kill('SIGKILL'); await old.done;
  const entry = join(f.root, 'absence.mjs');
  writeFileSync(entry, `import {proveNativeTerminalEndpointAbsent} from ${JSON.stringify(pathToFileURL(join(repo, 'packages/h2a-runtime/dist/native-terminal/server.js')).href)};
    if(!await proveNativeTerminalEndpointAbsent(process.env.H2A_NATIVE_SOCKET,{code:'ECONNREFUSED'}))process.exitCode=1;`);
  const begun = performance.now();
  const results = await Promise.all(Array.from({ length: 10 }, () => f.start([], entry).done));
  t.diagnostic(JSON.stringify({ absenceProofs: 10, elapsedMs: Math.round(performance.now() - begun), codes: results.map(r => r.code) }));
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  assert.ok(existsSync(f.env.H2A_NATIVE_SOCKET), 'A read-only proof must not unlink the socket');
});

test('oom-isolation: a refused session scope never executes a worker inside the host scope', async t => {
  const f = fixture(t);
  const marker = join(f.root, 'worker-started');
  const worker = join(f.root, 'worker.mjs');
  writeFileSync(worker, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unsafe');`);
  const entry = join(repo, 'packages/h2a-runtime/dist/native-terminal/session-scope.js');
  const result = await f.start([process.execPath, worker], entry).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /session memory isolation failed/);
  assert.equal(existsSync(marker), false);
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
  await Promise.all(Array.from({ length: 5 }, (_, i) => usable(f, `h2a-lab-${i + 1}`)));
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

test('cleanup: wait for the recorded detached writer to die before deleting its fixture', async t => {
  const f = fixture(t), writer = join(f.root, 'detached-writer.mjs');
  writeFileSync(writer, `import {mkdirSync} from 'node:fs';
    setInterval(() => mkdirSync(${JSON.stringify(join(f.root, 'late-write'))}, {recursive:true}), 1);`);
  const parent = join(f.root, 'parent.mjs');
  writeFileSync(parent, `import {spawn} from 'node:child_process';
    const child = spawn(process.execPath, [${JSON.stringify(writer)}], {env:process.env, detached:true, stdio:'ignore'});
    child.unref();`);
  assert.equal((await f.start([], parent).done).code, 0);
  const row = await eventually(() => f.recorded().find(r => r.args[1] === writer), Boolean);
  const live = () => {
    try {
      const stat = readFileSync('/proc/' + row.pid + '/stat', 'utf8').split(') ')[1].split(' ');
      return stat[19] === row.start && !['Z', 'X'].includes(stat[0]);
    } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return false; throw error; }
  };
  const kill = process.kill;
  let delayed;
  t.after(async () => {
    process.kill = kill;
    clearTimeout(delayed);
    if (live()) kill(row.pid, 'SIGKILL');
    await eventually(() => !live(), Boolean);
    rmSync(f.root, { recursive:true, force:true });
  });
  // Make signal delivery asynchronous, as for the CI race. Only our own
  // generation-checked detached child is affected; direct children are reaped.
  process.kill = function(pid, signal) {
    if (pid === row.pid && signal === 'SIGKILL') {
      delayed = setTimeout(() => { if (live()) kill(pid, signal); }, 50);
      return true;
    }
    return kill(pid, signal);
  };
  try {
    await f.dispose();
    assert.equal(live(), false, 'a signal request is not proof that the detached writer has stopped');
    assert.equal(existsSync(f.root), false);
  } finally { process.kill = kill; }
});

test('cleanup: a writer registering after convergence is reaped and cannot keep the fixture', async t => {
  const f = fixture(t);
  // Bulk so removal is still walking the tree when the late writer starts.
  const bulk = join(f.root, 'bulk');
  mkdirSync(bulk, { recursive: true });
  for (let i = 0; i < 30000; i++) writeFileSync(join(bulk, `f-${i}`), 'x');
  const writer = join(f.root, 'late-writer.mjs');
  writeFileSync(writer, `import {mkdirSync} from 'node:fs';
    const dir = ${JSON.stringify(join(f.root, 'late-write'))};
    setInterval(() => { try { mkdirSync(dir, { recursive: true }); } catch {} }, 1);`);
  const parent = join(f.root, 'parent.mjs');
  // The writer registers only when its import hook runs: the shell delay puts
  // that registration after dispose converged on the recorded pids, the CI
  // race (job 124193907640 ENOTEMPTY), not before it.
  writeFileSync(parent, `import {spawn} from 'node:child_process';
    const child = spawn('/bin/sh', ['-c', 'sleep 0.1; exec "$0" "$@"', ${JSON.stringify(process.execPath)}, ${JSON.stringify(writer)}],
      {env: process.env, detached: true, stdio: 'ignore'});
    child.unref();`);
  assert.equal((await f.start([], parent).done).code, 0);
  await f.dispose();
  assert.equal(existsSync(f.root), false);
});
