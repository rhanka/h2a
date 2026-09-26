// Child worker for the multi-process prefix-lock test. Optionally waits on a
// wall-clock BARRIER (startAtMs) so all racers attempt acquisition at the same
// instant — this is what forces the dangerous stale-reclaim window to overlap
// (a plain spawn staggers children out of it). Acquires the lock, prints
// {acquired} as one JSON line, then HOLDS until SIGTERM so the acquirer count is
// a true measure of mutual exclusion, not of timing.
// Usage: node upgrade-lock-child.mjs <prefix> [startAtMs]
import { defaultUpgradeRuntime } from "../dist/index.js";

const [prefix, startAtRaw] = process.argv.slice(2);
const startAt = startAtRaw ? Number.parseInt(startAtRaw, 10) : 0;

function attempt() {
  try {
    const lock = defaultUpgradeRuntime.acquirePrefixLock(prefix);
    process.stdout.write(`${JSON.stringify({ acquired: lock.acquired, pid: process.pid })}\n`);
    if (!lock.acquired) {
      process.exit(0);
    }
    const release = () => {
      try { lock.release(); } catch { /* best-effort */ }
      process.exit(0);
    };
    process.on("SIGTERM", release);
    process.on("SIGINT", release);
    setInterval(() => {}, 1 << 30); // keepalive until killed
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ acquired: false, error: String(e) })}\n`);
    process.exit(0);
  }
}

if (startAt > 0) {
  const spinTo = startAt;
  const coarse = spinTo - Date.now() - 5;
  const spin = () => {
    while (Date.now() < spinTo) { /* tight spin for a few ms to align racers */ }
    attempt();
  };
  if (coarse > 0) setTimeout(spin, coarse);
  else spin();
} else {
  attempt();
}
