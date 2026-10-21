// Mandatory startup qualification. No provider CLI, real user bus or owner state.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fixture, eventually, usable } from '../../packages/h2a/test/helpers/restart-lab.js';
import { NativeTerminalClient } from '../../packages/h2a-runtime/dist/native-terminal/client.js';

const repo = resolve(import.meta.dirname, '../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');
const cli = join(repo, 'packages/h2a/dist/bin.js');
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];

async function sample(t, rows, concurrency, state, mode, serial) {
  const f = fixture(t);
  try {
    const project = join(f.env.HOME, 'src/project'); mkdirSync(project, { recursive: true });
    const targets = Array.from({ length: concurrency }, (_, i) => ({
      ...f.entries(1)[0], id: `target-${i}`, label: `target-${i}`, tmuxSession: `h2a-target-${i}`,
      cwd: project, convId: `00000000-0000-4000-8000-${String(serial * 10 + i).padStart(12, '0')}`,
      bare: true, gatewayMode: 'direct',
    }));
    // The 0/50/500 axis counts unrelated historical rows. Restore additionally
    // needs N durable human targets; its exact total is emitted, never hidden.
    f.save([...f.mixed(rows).map(row => ({ ...row, lastSeenAt: '2020-01-01T00:00:00Z' })), ...(mode === 'restore' ? targets : [])]);
    if (mode === 'restore') {
      // Replace only the GUI boundary. Execute the actual commands emitted by
      // restore, via a private h2a shim, on the real run/PTY implementation.
      writeFileSync(join(f.root, 'bin/h2a'), `#!/bin/sh\nexec '${process.execPath}' '${cli}' "$@" --background --no-attach --no-h2a\n`, { mode: 0o700 });
      writeFileSync(join(f.root, 'terminal.mjs'), `import {readFileSync} from 'node:fs';import {spawn} from 'node:child_process';
        const map=process.argv.at(-1);
        for(const line of readFileSync(map,'utf8').trim().split('\\n')) {
          const [cwd,command]=line.split('\\t');
          const child=spawn('/bin/bash',['-c',command],{cwd,env:process.env,stdio:'inherit'});
          child.on('exit',code=>{if(code)process.exitCode=code;});
        }\n`);
      writeFileSync(join(f.root, 'bin/gnome-terminal'), `#!/bin/sh\nexec '${process.execPath}' '${join(f.root, 'terminal.mjs')}' "$@"\n`, { mode: 0o700 });
    }
    if (state !== 'absent') {
      const host = f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
      const client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
      await client.ping(); // Health, including durable owner publication, precedes SIGKILL.
      client.close();
      if (state === 'killed') { host.child.kill('SIGKILL'); await host.done; }
    }
    // Paired direct comparison: identical deterministic CLI and first I/O.
    const directBegun = performance.now();
    const direct = Array.from({ length: concurrency }, () => f.start([], join(f.root, 'agent.mjs')));
    await Promise.all(direct.map(async run => {
      await eventually(run.output, o => o.stdout.includes('agent-ready'));
      run.child.stdin.write('direct-exchange\n');
      await eventually(run.output, o => o.stdout.includes('ack:direct-exchange'));
    }));
    const directMs = Math.round(performance.now() - directBegun);
    for (const run of direct) { run.child.kill('SIGTERM'); await run.done; }
    const before = f.recorded().length;
    const begun = performance.now();
    if (mode === 'restore') {
      const result = await f.start(['restore', '--no-gw']).done;
      assert.equal(result.code, 0, result.stderr + result.stdout);
    } else {
      const results = await Promise.all(targets.map(target => f.start(['run', 'codex', project,
        ...(mode === 'resume' ? ['--resume', target.convId] : []), '--name', target.label,
        '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done));
      assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
    }
    await Promise.all(targets.map(target => usable(f, target.tmuxSession)));
    const usableMs = Math.round(performance.now() - begun);
    const recorded = f.recorded().slice(before);
    const helpers = recorded.filter(r => r.args[1]?.endsWith('/native-terminal/op.js'));
    const probes = helpers.filter(r => r.args[2] === 'probe');
    assert.ok(helpers.length <= concurrency * 8 + 1, JSON.stringify({ rows, helpers: helpers.map(r => r.args.slice(2)) }));
    assert.ok(probes.every(r => targets.some(target => r.args[4] === target.tmuxSession)), JSON.stringify(probes));
    assert.ok(probes.length <= concurrency * 5, 'Owner probes must stay bounded by requested targets');
    const client = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
    try {
      assert.equal((await client.list()).filter(row => row.status === 'running').length, concurrency);
      const hostPid = (await client.ping()).hostPid;
      const liveHosts = f.recorded().filter(row => row.args[1] === hostEntry).filter(row => {
        try { return !/\) [ZX] /.test(readFileSync(`/proc/${row.pid}/stat`, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
      assert.deepEqual(liveHosts.map(row => row.pid), [hostPid]);
    } finally { client.close(); }
    return { unrelatedRows: rows, totalRegistryRowsAtStart: rows + (mode === 'restore' ? concurrency : 0),
      concurrency, host: state, mode, directMs, usableMs, overheadMs: usableMs - directMs,
      probes: probes.length, opHelpers: helpers.length, nodeProcesses: recorded.length };
  } finally { await f.dispose(); }
}

let serial = 1;
async function matrix(t, mode, concurrency, host) {
  const samples = new Map([0, 50, 500].map(rows => [rows, []]));
  // Alternate registry sizes in paired rounds, avoiding a warmed-only full registry.
  for (let round = 0; round < 3; round++) for (const rows of round % 2 ? [500, 50, 0] : [0, 50, 500]) {
    const result = await sample(t, rows, concurrency, host, mode, serial++);
    samples.get(rows).push(result);
    t.diagnostic(JSON.stringify({ scenario: 'startup-matrix-sample', ...result }));
  }
  const empty = quantile(samples.get(0).map(s => s.usableMs), .5);
  for (const [rows, values] of samples) {
    const medianMs = quantile(values.map(s => s.usableMs), .5);
    const p95Ms = quantile(values.map(s => s.usableMs), .95);
    const deltaMs = medianMs - empty;
    t.diagnostic(JSON.stringify({ scenario: 'startup-matrix-summary', mode, concurrency, host, rows,
      medianMs, p95Ms, directMedianMs: quantile(values.map(s => s.directMs), .5),
      pairedOverheadMedianMs: quantile(values.map(s => s.overheadMs), .5),
      pairedOverheadP95Ms: quantile(values.map(s => s.overheadMs), .95), deltaMs, registryBudgetMs: 500,
      probes: values.map(s => s.probes), opHelpers: values.map(s => s.opHelpers), nodeProcesses: values.map(s => s.nodeProcesses) }));
    assert.ok(deltaMs <= 500, `${mode}/${concurrency}/${host}/${rows}: registry overhead ${deltaMs} > 500 ms`);
  }
}

test("startup-matrix: fresh, 1 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 1, "live"));
test("startup-matrix: fresh, 1 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 1, "absent"));
test("startup-matrix: fresh, 1 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 1, "killed"));
test("startup-matrix: fresh, 5 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 5, "live"));
test("startup-matrix: fresh, 5 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 5, "absent"));
test("startup-matrix: fresh, 5 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 5, "killed"));
test("startup-matrix: fresh, 10 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 10, "live"));
test("startup-matrix: fresh, 10 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 10, "absent"));
test("startup-matrix: fresh, 10 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "fresh", 10, "killed"));
test("startup-matrix: resume, 1 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 1, "live"));
test("startup-matrix: resume, 1 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 1, "absent"));
test("startup-matrix: resume, 1 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 1, "killed"));
test("startup-matrix: resume, 5 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 5, "live"));
test("startup-matrix: resume, 5 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 5, "absent"));
test("startup-matrix: resume, 5 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 5, "killed"));
test("startup-matrix: resume, 10 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 10, "live"));
test("startup-matrix: resume, 10 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 10, "absent"));
test("startup-matrix: resume, 10 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "resume", 10, "killed"));
test("startup-matrix: restore, 1 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 1, "live"));
test("startup-matrix: restore, 1 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 1, "absent"));
test("startup-matrix: restore, 1 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 1, "killed"));
test("startup-matrix: restore, 5 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 5, "live"));
test("startup-matrix: restore, 5 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 5, "absent"));
test("startup-matrix: restore, 5 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 5, "killed"));
test("startup-matrix: restore, 10 requests, host live, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 10, "live"));
test("startup-matrix: restore, 10 requests, host absent, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 10, "absent"));
test("startup-matrix: restore, 10 requests, host killed, registry 0/50/500", { timeout: 120000 }, t => matrix(t, "restore", 10, "killed"));
