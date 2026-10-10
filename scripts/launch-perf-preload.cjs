// Opt-in lab instrumentation. Emits operation names/counts/timings, never data.
const fs = require('node:fs');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { basename, dirname, join } = require('node:path');
const start = performance.now();
const summary = {};
const operations = [];
const append = fs.appendFileSync;
const record = (key, ms, bytes = 0) => {
  const entry = summary[key] ??= { calls: 0, ms: 0, bytes: 0 };
  entry.calls++; entry.ms += ms; entry.bytes += bytes;
};
for (const name of ['readFileSync', 'readdirSync']) {
  const original = fs[name];
  fs[name] = function (...args) {
    const begin = performance.now();
    let result;
    try { return result = original.apply(this, args); }
    finally {
      const path = String(args[0]);
      if (basename(path) === 'ready.json' && result) {
        const ack = JSON.parse(result.toString());
        record(`readiness_ack_pid:${ack.pid}`, performance.now() - begin);
      }
      if (path.startsWith(process.env.H2A_PERF_LAB)) {
        const group = basename(dirname(path)) === 'presence' ? 'presence' : path.includes('.launch-index-v1/') ? 'launch-index' : basename(path);
        record(`${name}:${group}`, performance.now() - begin, typeof result === 'string' || Buffer.isBuffer(result) ? Buffer.byteLength(result) : 0);
      }
    }
  };
}
const spawnSync = cp.spawnSync;
cp.spawnSync = function (command, args, ...rest) {
  const begin = performance.now();
  let result;
  try { return result = spawnSync.call(this, command, args, ...rest); }
  finally {
    const op = args?.[0]?.endsWith('/native-terminal/op.js') ? args[1] : basename(String(command));
    record(`spawnSync:${op}`, performance.now() - begin);
    if (args?.[0]?.endsWith('/native-terminal/op.js')) {
      const id = args.includes('--id') ? args[args.indexOf('--id') + 1] : undefined;
      let state;
      try { state = JSON.parse(result?.stdout ?? '{}')?.state; } catch {}
      operations.push({ op, component: id?.endsWith('.h2a') ? 'sidecar' : id ? 'agent' : 'host',
        beginMs: begin - start, endMs: performance.now() - start, pid: state?.pid });
    }
  }
};
syncBuiltinESMExports();
process.once('exit', () => {
  if (process.env.H2A_PERF_OUTPUT)
    append(join(process.env.H2A_PERF_OUTPUT, `${process.pid}.jsonl`), JSON.stringify({ pid: process.pid, elapsedMs: performance.now() - start, memory: process.resourceUsage(), summary, operations }) + '\n');
});
