import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';

/**
 * Read main-thread CPU usage (falling back to process CPU usage on older Node
 * builds). Main-thread CPU time is immune to OS scheduler preemption on loaded
 * CI runners while still catching synchronous CPU-bound stalls in our code.
 */
export function readThreadCpuUsage(previous = undefined) {
  const usage = typeof process.threadCpuUsage === 'function'
    ? process.threadCpuUsage(previous)
    : process.cpuUsage(previous);
  return {
    raw: usage,
    userMs: usage.user / 1_000,
    systemMs: usage.system / 1_000,
    totalMs: (usage.user + usage.system) / 1_000
  };
}

/** Nearest-rank percentile on a non-empty array of finite numbers. */
export function percentile(values, p) {
  assert.ok(Array.isArray(values) && values.length > 0, 'percentile requires a non-empty array');
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

/**
 * Measure per-window main-thread CPU and event-loop wall-clock lag via a
 * lightweight timer probe (default 5 ms cadence, < 0.2% CPU overhead).
 *
 * Each sample records:
 *  - `cpuMs`: exact main-thread CPU spent between consecutive probe ticks
 *    (immune to OS CFS preemption on loaded CI runners).
 *  - `wallLagMs`: wall-clock overshoot beyond `intervalMs` (catches non-CPU
 *    synchronous stalls such as `Atomics.wait` or blocking syscalls).
 *
 * Always stop the probe in a `finally` block.
 */
export function startEventLoopWorkProbe({ intervalMs = 5 } = {}) {
  let active = true;
  let handle;
  const startedWall = performance.now();
  let lastEndWall = startedWall;
  let lastEndCpu = readThreadCpuUsage().raw;
  const wallLags = [];
  const cpus = [];
  let maxCpuMs = 0;
  let maxWallLagMs = 0;
  let totalCpuMs = 0;

  const recordSample = (expectedDelayMs) => {
    const nowWall = performance.now();
    const cpuDelta = readThreadCpuUsage(lastEndCpu);
    const wallLagMs = Math.max(0, (nowWall - lastEndWall) - expectedDelayMs);
    const cpuMs = cpuDelta.totalMs;
    wallLags.push(wallLagMs);
    cpus.push(cpuMs);
    if (cpuMs > maxCpuMs) maxCpuMs = cpuMs;
    if (wallLagMs > maxWallLagMs) maxWallLagMs = wallLagMs;
    totalCpuMs += cpuMs;
    lastEndWall = performance.now();
    lastEndCpu = readThreadCpuUsage().raw;
  };

  const schedule = () => {
    if (!active) return;
    handle = setTimeout(() => {
      if (!active) return;
      recordSample(intervalMs);
      schedule();
    }, intervalMs);
    handle.unref?.();
  };

  schedule();

  return {
    ticks() {
      return wallLags.length;
    },
    stop() {
      if (active) {
        active = false;
        if (handle !== undefined) clearTimeout(handle);
        // Capture any final synchronous work completed right before stop().
        recordSample(0);
      }
      return {
        ticks: wallLags.length,
        maxCpuMs,
        totalCpuMs,
        p50CpuMs: cpus.length ? percentile(cpus, 0.5) : 0,
        p95CpuMs: cpus.length ? percentile(cpus, 0.95) : 0,
        p50WallLagMs: wallLags.length ? percentile(wallLags, 0.5) : 0,
        p95WallLagMs: wallLags.length ? percentile(wallLags, 0.95) : 0,
        maxWallLagMs,
        totalWallMs: performance.now() - startedWall
      };
    }
  };
}

/**
 * Measure a same-run baseline control probe (e.g. uncontended `/_h2a-central/ping`
 * or a neutral loopback HTTP endpoint) so latency bounds calibrate to the
 * current runner's loopback and scheduler speed.
 */
export async function measureControlProbe(probeFn, samples = 5) {
  await probeFn();
  const latencies = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    await probeFn();
    latencies.push(performance.now() - t0);
  }
  return {
    samples: latencies,
    medianMs: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: Math.max(...latencies)
  };
}

/**
 * Start a tiny neutral loopback HTTP echo server in-process to establish a
 * product-independent control baseline for HTTP loopback latency on the
 * current runner.
 */
export async function measureNeutralLoopbackControl(samples = 5) {
  const srv = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const url = `http://127.0.0.1:${srv.address().port}/control`;
  try {
    return await measureControlProbe(async () => {
      const res = await fetch(url);
      assert.equal(res.status, 200);
      await res.json();
    }, samples);
  } finally {
    await new Promise(resolve => srv.close(resolve));
  }
}

/**
 * Assert that a foreground probe stream remained responsive while an external
 * lock was held, using our own synchronous work + causal ordering + same-run
 * control calibration rather than an uncalibrated absolute max wall-clock cap.
 */
export function assertResponsiveUnderContention({
  label,
  pings,
  pingsBeforeRelease,
  minPingsBeforeRelease = 3,
  control,
  probeSummary,
  holdMs,
  maxTurnCpuMs = 80,
  maxWallLagMs = 180,
  p50FloorMs = 50,
  p50Ratio = 12,
  p95FloorMs = 100,
  p95Ratio = 25,
  maxPingCeilingMs = undefined
}) {
  assert.ok(pings.length > 0, `${label}: expected at least 1 probe sample`);
  assert.ok(
    pingsBeforeRelease >= minPingsBeforeRelease,
    `${label}: causal ordering failed — only ${pingsBeforeRelease} probes completed before lock release (expected >= ${minPingsBeforeRelease})`
  );

  const p50 = percentile(pings, 0.5);
  const p95 = percentile(pings, 0.95);
  const maxPing = Math.max(...pings);
  const p50Limit = Math.max(p50FloorMs, control.medianMs * p50Ratio);
  const p95Limit = Math.max(p95FloorMs, control.medianMs * p95Ratio);
  const ceiling = maxPingCeilingMs ?? (holdMs ? Math.max(250, holdMs * 0.75) : Math.max(250, p95Limit * 2));

  assert.ok(
    probeSummary.maxCpuMs < maxTurnCpuMs,
    `${label}: main-thread turn CPU=${probeSummary.maxCpuMs.toFixed(1)}ms exceeded ${maxTurnCpuMs}ms budget (control p50=${control.medianMs.toFixed(1)}ms)`
  );
  assert.ok(
    probeSummary.maxWallLagMs < maxWallLagMs,
    `${label}: synchronous event-loop lag=${probeSummary.maxWallLagMs.toFixed(1)}ms exceeded ${maxWallLagMs}ms stall ceiling (turnCpu=${probeSummary.maxCpuMs.toFixed(1)}ms)`
  );
  assert.ok(
    p50 < p50Limit,
    `${label}: probe median=${p50.toFixed(1)}ms exceeded ${p50Limit.toFixed(1)}ms (control=${control.medianMs.toFixed(1)}ms, n=${pings.length})`
  );
  assert.ok(
    p95 < p95Limit,
    `${label}: probe p95=${p95.toFixed(1)}ms exceeded ${p95Limit.toFixed(1)}ms (control=${control.medianMs.toFixed(1)}ms, n=${pings.length})`
  );
  assert.ok(
    maxPing < ceiling,
    `${label}: probe max=${maxPing.toFixed(1)}ms exceeded contention ceiling ${ceiling.toFixed(1)}ms (holdMs=${holdMs ?? 'n/a'}, control=${control.medianMs.toFixed(1)}ms)`
  );

  return { p50, p95, maxPing, p50Limit, p95Limit, ceiling };
}
