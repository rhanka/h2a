// R5 blocking incident cell: 20 concurrent resumes over Sol's owner-shaped
// registry (214 rows incl. 100 dead background rows, host SIGKILLed).
// Isolated lab only: deterministic CLI, private HOME/XDG/socket, no provider,
// no user bus, no owner state. Run after the build with a private TMPDIR.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NativeTerminalClient } from '../../h2a-runtime/dist/native-terminal/client.js';
import { fixture, eventually, usable } from './helpers/restart-lab.js';

const repo = resolve(import.meta.dirname, '../../..');
const hostEntry = join(repo, 'packages/h2a-runtime/dist/native-terminal/process.js');
const baselines = JSON.parse(
  readFileSync(join(repo, 'scripts/owner-lab/startup-baselines.json'), 'utf8'),
);

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
      const liveHosts = f.recorded().filter(row => row.args[1] === hostEntry).filter(row => {
        try { return !/\) [ZX] /.test(readFileSync(`/proc/${row.pid}/stat`, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
      assert.deepEqual(liveHosts.map(row => row.pid), [(await check.ping()).hostPid]);
      assert.equal(liveHosts.length, 1, 'concurrent starters left more than one live host');
    } finally { check.close(); }
    // No publication-lock contention timeout may hide in a relaunch log.
    for (const r of results) assert.doesNotMatch(r.stderr + r.stdout, /timed out/i);
    return usableMs;
  }

  // Warmup round (discarded): the first fixture pays one-time costs (module
  // hook compilation, tmpdir creation) that would otherwise inflate whichever
  // round runs first.
  await round(999, 0);
  // Empty-registry reference (paired delta gate, budget +500 ms).
  const emptyMs = await round(0, 0);
  // Three loaded rounds: median/p95 against the committed incident baseline.
  const loaded = [];
  for (const serial of [1, 2, 3]) loaded.push(await round(serial, 194));
  const medianMs = quantile(loaded, 0.5);
  const p95Ms = quantile(loaded, 0.95);
  const deltaMs = medianMs - emptyMs;
  t.diagnostic(JSON.stringify({ scenario: 'incident-20-resume', rows: 214, deadBackground: 100, concurrency: 20,
    host: 'killed', emptyMs, loadedMs: loaded, medianMs, p95Ms, deltaMs, registryBudgetMs: 500,
    usable: '20/20', hosts: 1, lockTimeouts: 0 }));

  assert.ok(deltaMs <= 500, `20 resumes added ${deltaMs} ms over 214 rows (budget +500 ms)`);
  const base = baselines.incident20;
  assert.ok(base, 'no committed 20-request incident baseline; refusing to pass without one');
  assert.ok(medianMs <= base.medianMs + baselines.margin.medianMs,
    `incident-20 median ${medianMs} exceeds committed baseline ${base.medianMs} + ${baselines.margin.medianMs} ms`);
  assert.ok(p95Ms <= base.p95Ms + baselines.margin.p95Ms,
    `incident-20 p95 ${p95Ms} exceeds committed baseline ${base.p95Ms} + ${baselines.margin.p95Ms} ms`);
});
