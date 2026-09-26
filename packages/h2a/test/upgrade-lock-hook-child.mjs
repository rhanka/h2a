// Hook-aware lock child for the DETERMINISTIC gate test. It acquires the prefix
// lock while pausing at a named critical-section hook until a sentinel file
// appears — this forces an exact interleave (no timing luck) against another
// racer. Prints {acquired} as one JSON line, then holds until SIGTERM.
// Usage: node upgrade-lock-hook-child.mjs <prefix> <hookName> <pauseSentinel> <reachedSentinel>
import { existsSync, writeFileSync } from "node:fs";
import { defaultUpgradeRuntime } from "../dist/index.js";

const [prefix, hookName, pauseSentinel, reachedSentinel] = process.argv.slice(2);

// Busy-wait (with tiny yields) until the sentinel file exists — a synchronous
// rendezvous, because acquirePrefixLock is synchronous.
function waitForSentinel() {
  writeFileSync(reachedSentinel, "reached", "utf8"); // signal we hit the hook
  const spinEnd = Date.now() + 15000;
  while (!existsSync(pauseSentinel) && Date.now() < spinEnd) {
    // brief blocking sleep via Atomics to avoid pegging the CPU
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

const hooks = { [hookName]: () => waitForSentinel() };

try {
  const lock = defaultUpgradeRuntime.acquirePrefixLock(prefix, hooks);
  process.stdout.write(`${JSON.stringify({ acquired: lock.acquired, pid: process.pid })}\n`);
  if (!lock.acquired) process.exit(0);
  const release = () => { try { lock.release(); } catch {} process.exit(0); };
  process.on("SIGTERM", release);
  process.on("SIGINT", release);
  setInterval(() => {}, 1 << 30);
} catch (e) {
  process.stdout.write(`${JSON.stringify({ acquired: false, error: String(e) })}\n`);
  process.exit(0);
}
