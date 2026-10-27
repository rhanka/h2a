// R5 blocking incident cell: 20 concurrent resumes over Sol's owner-shaped
// registry (214 rows incl. 100 dead background rows, host SIGKILLED).
// R6: the absolute wall-time ceiling stays (catastrophic-regression ceiling,
// CI-anchored at the slow-runner max), but the +1 s catcher is now a
// self-calibrating RELATIVE gate: bin.js `--version` startup against a
// same-run `node -e` control. The sleep after the shebang shifts every bin.js
// invocation by +1000 ms while the control never crosses bin.js, so the
// difference shifts by the full +1000 ms — twice the margin — while runner
// speed cancels out. Batch wall and per-request overhead both inherit
// host-election contention noise (the R5 blind spot); bare process startup
// varies by ~±100 ms, so no committed per-runner numbers are needed.
// Isolated lab only: deterministic CLI, private HOME/XDG/socket, no provider,
// no user bus, no owner state. Run after the build with a private TMPDIR.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import test from 'node:test';
import { NativeTerminalClient } from '../../h2a-runtime/dist/native-terminal/client.js';
import { fixture, eventually, usable } from './helpers/restart-lab.js';

const repo = resolve(import.meta.dirname, '../../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');
const baselines = JSON.parse(
  readFileSync(join(repo, 'scripts/owner-lab/startup-baselines.json'), 'utf8'),
);
const loadProfile = process.env.H2A_LAB_INCIDENT_LOAD_PROFILE || 'default';
assert.ok(['default', '8x20/8cpu'].includes(loadProfile), `unknown incident load profile: ${loadProfile}`);
if (loadProfile === '8x20/8cpu') assert.equal(availableParallelism(), 8, 'eight-instance baseline requires eight CPUs');

const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];

test('incident-20-resume: 20 concurrent resumes over 214 owner-shaped rows with 100 dead background rows, host SIGKILLed', { timeout: 180000 }, async t => {
  async function round(serial, unrelatedCount) {
    // Fresh isolated fixture per round (same pattern as the startup matrix):
    // sessions never accumulate across rounds.
    const f = fixture(t);
    const project = join(f.env.HOME, 'src', 'owner-project');
    mkdirSync(project, { recursive: true });

    // 100 dead background rows (background class, ended: never live, never probed).
    const deadBackground = Array.from({ length: 100 }, (_, i) => ({
      id: `dead-bg-${i}`, tool: 'codex', kind: 'local-native', cwd: project,
      tmuxSession: `h2a-dead-bg-${i}`, convId: `dead-bg-${i}`, source: 'run',
      sessionClass: 'background', delegationOrigin: 'mcp:h2a_run',
      endedAt: new Date().toISOString(),
      enrolledAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
    }));
    // 94 further unrelated owner-shaped rows (human/background/legacy/exited mix).
    const others = f.mixed(94).map((row, i) => ({ ...row, id: `other-${i}`, tmuxSession: `h2a-other-${i}` }));
    const unrelated = unrelatedCount === 0 ? [] : [...deadBackground, ...others];
    const targets = Array.from({ length: 20 }, (_, i) => ({
      ...f.entries(1)[0],
      id: `target-${serial}-${i}`, label: `target-${serial}-${i}`, tmuxSession: `h2a-target-${serial}-${i}`,
      cwd: project, convId: `00000000-0000-4000-8000-${String(serial * 20 + i).padStart(12, '0')}`,
      bare: true, gatewayMode: 'direct',
    }));
    f.save([...unrelated, ...targets]);
    // Sol's precondition: the host is SIGKILLed before the 20 relaunchers arrive.
    const host = f.start(['--socket', f.env.H2A_NATIVE_SOCKET, '--registry-path', f.registry], hostEntry);
    const client = await eventually(() => NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET), Boolean);
    await client.ping();
    client.close();
    host.child.kill('SIGKILL');
    await host.done;

    const begun = performance.now();
    const results = await Promise.all(targets.map(target =>
      f.start(['run', 'codex', project, '--resume', target.convId, '--name', target.label,
        '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done));
    assert.ok(results.every(r => r.code === 0), JSON.stringify(results.map(r => ({ code: r.code, stderr: r.stderr.slice(-300) }))));
    await Promise.all(targets.map(target => usable(f, target.tmuxSession)));
    const usableMs = Math.round(performance.now() - begun);

    const check = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
    try {
      assert.equal((await check.list()).filter(row => row.status === 'running').length, 20);
      const candidates = f.recorded().filter(row => row.args[1] === hostEntry);
      assert.equal(candidates.length, 2, 'startup must elect one replacement, without spawning losing hosts');
      const probes = f.recorded().filter(row => row.args[1]?.endsWith('/native-terminal/op.js') && row.args[2] === 'probe');
      assert.equal(probes.length, 0, 'the same target name must reuse its in-process proof, without probe helpers');
      assert.equal(f.recorded().filter(row => row.args[1]?.endsWith('/native-terminal/op.js') && row.args[2] === 'launch').length,
        0, 'launch must share the CLI process that already loaded its native client');
      const liveHosts = candidates.filter(row => {
        try { return !/\) [ZX] /.test(readFileSync(`/proc/${row.pid}/stat`, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
      assert.deepEqual(liveHosts.map(row => row.pid), [(await check.ping()).hostPid]);
      assert.equal(liveHosts.length, 1, 'concurrent starters left more than one live host');
    } finally { check.close(); }
    // No publication-lock contention timeout may hide in a relaunch log.
    for (const r of results) assert.doesNotMatch(r.stderr + r.stdout, /timed out/i);
    // Finish this fixture before the next measurement. t.after remains the
    // failure-path cleanup; retaining its agents would turn the fifth cell
    // into a different load from the reference (100 agents per instance).
    await f.dispose();
    return usableMs;
  }

  // R6 +1 s catcher FIRST (fail-fast): bin.js startup probe against a
  // same-run unmutated control. The sleep after the shebang shifts EVERY
  // bin.js invocation by +1000 ms — including `--version`, which otherwise
  // parses argv and exits without touching the registry, the host election,
  // or any session. The control (`node -e`, same runner, same minute) never
  // crosses bin.js, so a uniform CLI slowdown shifts the difference by the
  // full +1000 ms — twice the margin — while runner speed cancels out. Batch
  // wall and per-request overhead both inherit host-election contention
  // noise (locally ±400 ms, ±1500 ms across CI runners: the R5 blind spot),
  // but bare process startup varies by ~±100 ms, so no committed per-runner
  // numbers are needed. Cheap and deterministic, so it runs before the
  // expensive 20-way rounds. Only the median blocks: the sleep moves the
  // whole distribution, so the median moves with it, while a lone scheduler
  // spike on a loaded runner can take p95 alone (reported, not blocking).
  const { spawnSync } = await import('node:child_process');
  const binJs = join(repo, 'packages/h2a/dist/bin.js');
  function startupSample(args) {
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const begun = performance.now();
      const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
      assert.equal(result.error, undefined, `startup probe infrastructure error: ${result.error}`);
      assert.equal(result.status, 0, `startup probe failed: ${result.stderr}`);
      samples.push(performance.now() - begun);
    }
    return samples;
  }
  const probe = startupSample([binJs, '--version']);
  const control = startupSample(['-e', '']);
  const probeMedian = quantile(probe, 0.5);
  const probeP95 = quantile(probe, 0.95);
  const controlMedian = quantile(control, 0.5);
  const controlP95 = quantile(control, 0.95);
  const startupOverheadMedian = Math.round(probeMedian - controlMedian);
  const startupOverheadP95 = Math.round(probeP95 - controlP95);
  t.diagnostic(JSON.stringify({ scenario: 'incident-20-startup-probe', probeMedianMs: Math.round(probeMedian),
    probeP95Ms: Math.round(probeP95), controlMedianMs: Math.round(controlMedian),
    controlP95Ms: Math.round(controlP95), startupOverheadMedianMs: startupOverheadMedian,
    startupOverheadP95Ms: startupOverheadP95 }));
  assert.ok(startupOverheadMedian <= baselines.margin.medianMs,
    `incident-20 bin.js startup overhead median ${startupOverheadMedian} exceeds same-run control + ${baselines.margin.medianMs} ms`);
  // p95 stays REPORTED (diagnostic above): a lone spike trips it on loaded
  // runners while the median — which the mutation moves by the full shift —
  // stays put.

  // Warmup round (discarded): the first fixture pays one-time costs (module
  // hook compilation, tmpdir creation) that would otherwise inflate whichever
  // round runs first.
  await round(999, 0);
  // Empty-registry reference (paired gross-blowup gate, budget +1500 ms —
  // see the assertion below for why fine-grained scaling lives elsewhere).
  const emptyMs = await round(0, 0);
  // Three loaded rounds: wall against the catastrophic ceiling.
  const loaded = [];
  for (const serial of [1, 2, 3]) loaded.push(await round(serial, 194));
  const medianMs = quantile(loaded, 0.5);
  const p95Ms = quantile(loaded, 0.95);
  const deltaMs = medianMs - emptyMs;
  t.diagnostic(JSON.stringify({ scenario: 'incident-20-resume', rows: 214, deadBackground: 100, concurrency: 20,
    loadProfile,
    host: 'killed', emptyMs, loadedMs: loaded, medianMs, p95Ms, deltaMs, registryBudgetMs: 1500,
    usable: '20/20', hosts: 1, lockTimeouts: 0 }));

  // Registry-delta bound (R6: widened 500 → 1500 ms on CI evidence). At
  // 20-way with host-kill the wall is election-dominated (~5 s absolutes)
  // and the same code measured -1182..+774 ms across local and shared-CI
  // runs — the 500 ms budget was luck-of-scheduling, not a code property.
  // Uniform slowdowns are owned by the startup probe above (2× margin) and
  // fine-grained registry scaling by the matrix 10-way cells (stable,
  // per-runner-proven 500/800); this bound only guards a gross registry
  // blowup at 20-way, which still trips it by an order of magnitude.
  assert.ok(deltaMs <= 1500, `20 resumes added ${deltaMs} ms over 214 rows (budget +1500 ms)`);
  // The original CI/default ceiling remains unchanged. The 160-request stress
  // profile has its own frozen five-round measurement, with the SAME 500/800
  // margins. Registry delta, startup probe and every correctness assertion are
  // shared. See the R10 review dossier for the measured acceptance proposal.
  const base = loadProfile === '8x20/8cpu' ? baselines.incident20Loaded8 : baselines.incident20;
  assert.ok(base, 'no committed 20-request incident baseline; refusing to pass without one');
  // Catastrophic ceiling (unchanged R5 absolute, slow-CI max): a gross stall
  // trips the cell even if the startup probe somehow did not.
  assert.ok(medianMs <= base.medianMs + baselines.margin.medianMs,
    `incident-20 median ${medianMs} exceeds committed ceiling ${base.medianMs} + ${baselines.margin.medianMs} ms`);
  assert.ok(p95Ms <= base.p95Ms + baselines.margin.p95Ms,
    `incident-20 p95 ${p95Ms} exceeds committed ceiling ${base.p95Ms} + ${baselines.margin.p95Ms} ms`);
});
