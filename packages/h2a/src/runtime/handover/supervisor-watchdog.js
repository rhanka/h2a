import { writeSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export const DEFAULT_WATCHDOG_INTERVAL_MS = 2_000;
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 1_000;
export const DEFAULT_WATCHDOG_MAX_FAILURES = 3;

const WATCHDOG_MESSAGE = 'h2a mcp-central-serve: event_loop_unresponsive (watchdog), exiting 1 for supervisor restart\n';

if (!isMainThread && workerData && workerData.__h2aSupervisorWatchdog === true) {
  const {
    endpoint,
    intervalMs = DEFAULT_WATCHDOG_INTERVAL_MS,
    timeoutMs = DEFAULT_WATCHDOG_TIMEOUT_MS,
    maxFailures = DEFAULT_WATCHDOG_MAX_FAILURES,
    forceKillGraceMs = 150
  } = workerData;
  const pingUrl = new URL('/_h2a-central/ping', endpoint).href;
  let stopping = false;
  let consecutiveFailures = 0;
  let timer = null;

  parentPort?.on('message', (msg) => {
    if (msg && msg.type === 'stop') {
      stopping = true;
      if (timer) clearTimeout(timer);
      process.exit(0);
    }
  });

  const schedule = (ms) => {
    if (stopping) return;
    timer = setTimeout(probe, ms);
  };

  const triggerFailureExit = () => {
    if (stopping) return;
    stopping = true;
    try { writeSync(2, WATCHDOG_MESSAGE); } catch { /* ignore stderr write failure */ }
    try { parentPort?.postMessage({ type: 'unresponsive' }); } catch { /* ignore */ }
    // Give a responsive main thread a brief window to call process.exit(1) cleanly;
    // if the main thread is synchronously frozen (Atomics.wait / CPU spin), Node's
    // Worker process.exit(1) only exits the worker thread, so escalate to SIGKILL
    // on the process so systemd Restart=on-failure restarts the unit within < 7s.
    setTimeout(() => {
      try { process.kill(process.pid, 'SIGKILL'); } catch { /* ignore */ }
      process.exit(1);
    }, forceKillGraceMs);
  };

  const probe = async () => {
    timer = null;
    if (stopping) return;
    try {
      const response = await fetch(pingUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body && typeof body.generation === 'string' && body.generation.length > 0) {
          consecutiveFailures = 0;
          schedule(intervalMs);
          return;
        }
      }
      consecutiveFailures++;
    } catch {
      consecutiveFailures++;
    }
    if (stopping) return;
    if (consecutiveFailures >= maxFailures) {
      triggerFailureExit();
      return;
    }
    schedule(Math.min(500, intervalMs));
  };

  schedule(intervalMs);
}

/**
 * Start an OS-thread Worker watchdog probing `/_h2a-central/ping` on loopback.
 * Runs in its own libuv loop independent of main-thread freezes.
 */
export function startSupervisorWatchdog({
  endpoint,
  intervalMs = DEFAULT_WATCHDOG_INTERVAL_MS,
  timeoutMs = DEFAULT_WATCHDOG_TIMEOUT_MS,
  maxFailures = DEFAULT_WATCHDOG_MAX_FAILURES,
  onUnresponsive = undefined
}) {
  const execArgv = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === '--input-type' || arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print') {
      i++;
      continue;
    }
    if (arg.startsWith('--input-type=') || arg.startsWith('--eval=') || arg.startsWith('--print=')) continue;
    execArgv.push(arg);
  }
  const worker = new Worker(new URL(import.meta.url), {
    execArgv,
    workerData: {
      __h2aSupervisorWatchdog: true,
      endpoint,
      intervalMs,
      timeoutMs,
      maxFailures
    }
  });
  let stopped = false;
  worker.on('message', (msg) => {
    if (stopped || !msg || msg.type !== 'unresponsive') return;
    if (typeof onUnresponsive === 'function') onUnresponsive();
    else process.exit(1);
  });
  worker.unref();
  return {
    worker,
    async stop() {
      if (stopped) return;
      stopped = true;
      try { worker.postMessage({ type: 'stop' }); } catch { /* ignore */ }
      await worker.terminate().catch(() => {});
    }
  };
}
