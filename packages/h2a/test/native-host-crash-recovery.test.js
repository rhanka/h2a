// Isolated incident lab: no installed h2a, provider, user bus or owner process.
// Mandatory Node discovery/release regression. Run after the build with a private TMPDIR.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { NativeTerminalClient } from '../../h2a-runtime/dist/native-terminal/client.js';
import { convOwners } from '../../h2a-runtime/dist/conv-guard.js';

import { fixture, eventually, usable } from './helpers/restart-lab.js';
const repo = resolve(import.meta.dirname, '../../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');

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
  const resumed = await f.resume(451).done;
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
