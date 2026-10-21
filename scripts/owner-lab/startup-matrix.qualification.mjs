// Mandatory startup qualification. No provider CLI, real user bus or owner state.
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fixture, eventually, usable } from '../../packages/h2a/test/helpers/restart-lab.js';
import { NativeTerminalClient } from '../../packages/h2a-runtime/dist/native-terminal/client.js';

const repo = resolve(import.meta.dirname, '../..');
// R4 (conductor decision 21/10): BLOCKING non-regression baselines at the
// level measured on this head (startup-baselines.json: CI run, head,
// medians/p95 per mode/state/concurrency at empty registry + explicit
// margin). Native-CLI parity (median <= +250 ms, p95 <= +500 ms) is a
// REPORTED tracked objective owned by spec/open-parity — published by every
// cell, never asserted here. It becomes blocking when that lane lands.
const baselines = JSON.parse(readFileSync(join(repo, 'scripts/owner-lab/startup-baselines.json'), 'utf8'));
const PARITY_TARGET_MEDIAN_MS = 250;
const PARITY_TARGET_P95_MS = 500;
let parityHeaderWritten = false;
function reportParity(entry) {
  const line = `| ${entry.mode} | ${entry.concurrency} | ${entry.host} | ${entry.rows} | ${entry.isolation} | ${entry.pairedMedianMs} | ${entry.pairedP95Ms} | ${entry.pairedMedianMs - PARITY_TARGET_MEDIAN_MS} | ${entry.pairedP95Ms - PARITY_TARGET_P95_MS} |`;
  try {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    if (!parityHeaderWritten) {
      appendFileSync(summary, '### Native-CLI parity — REPORTED tracked objective (spec/open-parity, non-blocking)\n\n| mode | concurrency | host | rows | path | paired median ms | paired p95 ms | Δ median vs +250 | Δ p95 vs +500 |\n|---|---|---|---|---|---|---|---|---|\n');
      parityHeaderWritten = true;
    }
    appendFileSync(summary, line + '\n');
  } catch { /* Local runs have no step summary; the diagnostic below still publishes. */ }
}
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');
const cli = join(repo, 'packages/h2a/dist/bin.js');
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];

async function sample(t, rows, concurrency, state, mode, serial, isolation = "fallback") {
  const f = fixture(t);
  // R3 P2 effective-systemd path: on the disposable CI VM, use the real user
  // manager bus so the host/workers land in their own scopes; the fallback
  // (no-bus) remains the separate witness. Systemd samples assert the
  // effective cgroups, not only systemd-run arguments.
  if (isolation === "systemd") {
    assert.equal(process.env.GITHUB_ACTIONS, "true", "systemd matrix requires a disposable GitHub hosted VM");
    assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "self-hosted workstations are forbidden");
    const bus = process.env.H2A_LAB_DISPOSABLE_BUS;
    assert.ok(bus?.startsWith("unix:path=/run/user/"), "the disposable VM must supply its user manager bus");
    f.env.DBUS_SESSION_BUS_ADDRESS = bus;
    // Explicit worker ceiling (same mechanism as isolation.qualification):
    // proves per-session scopes + bounds the disposable VM. The tiny
    // deterministic CLI needs a few MiB; 512 MiB never OOMs it.
    f.env.H2A_NATIVE_SESSION_MEMORY_MAX = String(512 * 1024 ** 2);
  }
  try {
    const project = join(f.env.HOME, 'src/owner-project'); mkdirSync(project, { recursive: true });
    const targets = Array.from({ length: concurrency }, (_, i) => ({
      ...f.entries(1)[0], id: `target-${i}`, label: `target-${i}`, tmuxSession: `h2a-target-${i}`,
      cwd: project, convId: `00000000-0000-4000-8000-${String(serial * 10 + i).padStart(12, '0')}`,
      bare: true, gatewayMode: 'direct',
    }));
    // The 0/50/500 axis counts unrelated historical rows. Restore additionally
    // needs N durable human targets; its exact total is emitted, never hidden.
    f.save([...f.mixed(rows), ...(mode === 'restore' ? targets : [])]);
    if (mode === 'restore') {
      writeFileSync(join(resolve(f.registry, '..'), 'config.json'), JSON.stringify({ layout: {
        groups: [{ title: 'qualification-owner', projects: ['owner-project'] }],
      } }));
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
      const result = await f.start(['restore', 'qualification-owner', '--no-gw']).done;
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
      if (isolation === "systemd") {
        const cgroupOf = (pid) => readFileSync(`/proc/${pid}/cgroup`, "utf8").trim().split("::")[1] ?? "";
        const hostGroup = cgroupOf(hostPid);
        assert.match(hostGroup, /\/h2a-native-.*\.scope$/, `host not in its own scope: ${hostGroup}`);
        // R4: client.state().pid is the PTY guardian, which stays with its
        // host BY DESIGN (host-death trap); the session WORKER is its child,
        // moved by session-scope.js into its own scope before exec — the same
        // resolution isolation.qualification uses. Asserting the guardian
        // here proved only the launcher path, never the `h2a run` worker.
        const workerCeiling = Number(f.env.H2A_NATIVE_SESSION_MEMORY_MAX);
        assert.ok(Number.isSafeInteger(workerCeiling) && workerCeiling > 0, "matrix systemd run requires an explicit worker ceiling");
        for (const target of targets) {
          const st = await client.state(target.tmuxSession);
          const kids = readFileSync(`/proc/${st.pid}/task/${st.pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean);
          assert.equal(kids.length, 1, `session ${target.tmuxSession} has ${kids.length} guardian children, expected the single worker`);
          const workerPid = Number(kids[0]);
          const workerGroup = cgroupOf(workerPid);
          assert.match(workerGroup, /\/h2a-session-.*\.scope$/, `worker not in its own scope: ${workerGroup}`);
          assert.notEqual(workerGroup, hostGroup, "worker shares the host scope");
          const controller = join("/sys/fs/cgroup", workerGroup);
          assert.equal(Number(readFileSync(join(controller, "memory.max"), "utf8")), workerCeiling,
            `worker ${workerPid} ceiling is not the matrix ceiling`);
          assert.equal(Number(readFileSync(join(controller, "memory.swap.max"), "utf8")), 0,
            `worker ${workerPid} swap is not bounded`);
        }
        t.diagnostic(JSON.stringify({ scenario: "startup-matrix-cgroups", mode, concurrency, host: state, rows, hostGroup, workerCeiling }));
      }
    } finally { client.close(); }
    return { unrelatedRows: rows, totalRegistryRowsAtStart: rows + (mode === 'restore' ? concurrency : 0),
      concurrency, host: state, mode, directMs, usableMs, overheadMs: usableMs - directMs,
      probes: probes.length, opHelpers: helpers.length, nodeProcesses: recorded.length };
  } finally { await f.dispose(); }
}

let serial = 1;
async function matrix(t, mode, concurrency, host, isolation = "fallback") {
  const samples = new Map([0, 50, 500].map(rows => [rows, []]));
  // Alternate registry sizes in paired rounds, avoiding a warmed-only full registry.
  for (let round = 0; round < 3; round++) for (const rows of round % 2 ? [500, 50, 0] : [0, 50, 500]) {
    const result = await sample(t, rows, concurrency, host, mode, serial++, isolation);
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
    const pairedMedianMs = quantile(values.map(s => s.overheadMs), .5);
    const pairedP95Ms = quantile(values.map(s => s.overheadMs), .95);
    // R4 (a): BLOCKING non-regression gate at the empty-registry level
    // measured on this head, for the stable CLI-launch paths (fresh/resume).
    // The 1 s bin.js sleep mutation shifts every sample by +1000 ms, so it
    // still fails this gate (median margin 500, p95 margin 800). Restore is
    // recorded but not baseline-gated (runner-sensitive absolute at 5/10 —
    // see baselines.json); it keeps the delta gate below. The systemd path
    // has its own cost profile (scope creation); it keeps the cgroup
    // assertions above plus the delta gate, and reports its timings below.
    if (rows === 0 && isolation === "fallback" && baselines.gatedModes.includes(mode)) {
      const key = `${mode}/${concurrency}/${host}`;
      const base = baselines.cells[key];
      assert.ok(base, `${key}: no committed non-regression baseline; refusing to pass without one`);
      assert.ok(medianMs <= base.medianMs + baselines.margin.medianMs,
        `${key}/0: non-regression overhead median ${medianMs} exceeds committed baseline ${base.medianMs} + ${baselines.margin.medianMs} ms`);
      assert.ok(p95Ms <= base.p95Ms + baselines.margin.p95Ms,
        `${key}/0: non-regression overhead p95 ${p95Ms} exceeds committed baseline ${base.p95Ms} + ${baselines.margin.p95Ms} ms`);
    }
    // R4 (b): native-CLI parity stays a REPORTED check — published paired
    // overhead and delta to target for every mode (fresh/resume/restore) and
    // both paths, marked as tracked objective in the job summary and docs
    // (spec/open-parity). Never asserted, never skipped.
    t.diagnostic(JSON.stringify({ scenario: "startup-matrix-parity-report", mode, concurrency, host, rows, isolation,
      pairedOverheadMedianMs: pairedMedianMs, pairedOverheadP95Ms: pairedP95Ms,
      parityTargetMedianMs: PARITY_TARGET_MEDIAN_MS, parityTargetP95Ms: PARITY_TARGET_P95_MS,
      deltaToTargetMedianMs: pairedMedianMs - PARITY_TARGET_MEDIAN_MS,
      deltaToTargetP95Ms: pairedP95Ms - PARITY_TARGET_P95_MS,
      status: "reported-tracked-objective" }));
    reportParity({ mode, concurrency, host, rows, isolation, pairedMedianMs, pairedP95Ms });
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
// R3 P2 effective-systemd path (disposable CI VM only): same budgets plus
// effective cgroup readout. The no-systemd fallback above stays the witness.
test("startup-matrix-systemd: fresh, 1 requests, host live, registry 0/50/500", { timeout: 180000 }, t => matrix(t, "fresh", 1, "live", "systemd"));
test("startup-matrix-systemd: fresh, 1 requests, host killed, registry 0/50/500", { timeout: 180000 }, t => matrix(t, "fresh", 1, "killed", "systemd"));
test("startup-matrix-systemd: resume, 1 requests, host live, registry 0/50/500", { timeout: 180000 }, t => matrix(t, "resume", 1, "live", "systemd"));
test("startup-matrix-systemd: resume, 1 requests, host killed, registry 0/50/500", { timeout: 180000 }, t => matrix(t, "resume", 1, "killed", "systemd"));
