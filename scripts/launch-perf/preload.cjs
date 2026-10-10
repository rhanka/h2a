// Measurement-only preload; events contain names and timings, never payloads.
const fs = require('node:fs');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { basename, join } = require('node:path');
const output = process.env.LAUNCH_PERF_OUTPUT;
const append = fs.appendFileSync;
const event = (name, fields = {}) => {
  if (!output) return;
  try { append(join(output, `trace-${process.pid}.jsonl`), JSON.stringify({ pid: process.pid, at: performance.timeOrigin + performance.now(), name, ...fields }) + '\n'); } catch {}
};
globalThis.__launchPerfEvent = event;
const rename = fs.renameSync;
fs.renameSync = function(source, target, ...args) {
  const value = rename.call(this, source, target, ...args);
  if (String(target).endsWith('/launch.json')) {
    try {
      const receipt = JSON.parse(fs.readFileSync(target, 'utf8'));
      event('receipt_publication', { session: basename(require('node:path').dirname(target)),
        state: receipt.state, resultState: receipt.result?.state,
        completeResult: receipt.result?.kind === 'h2a.run.result', submitAttempted: receipt.submitAttempted });
    } catch {}
  }
  return value;
};
event('node_preload', { entry: basename(process.argv[1] || ''), role: process.env.LAUNCH_PERF_ROLE,
  ...(process.argv[1]?.endsWith('/native-terminal/op.js') ? { operation: process.argv[2], session: process.argv[process.argv.indexOf('--id')+1] } : {}) });
for (const method of ['spawn', 'spawnSync', 'execFileSync', 'execFile']) {
  const original = cp[method];
  cp[method] = function(command, args, ...rest) {
    const operation = Array.isArray(args) && args[0]?.endsWith('/native-terminal/op.js') ? args[1] : basename(String(command));
    const t = performance.now();
    event(method + '_begin', { operation });
    let result;
    try { return result = original.call(this, command, args, ...rest); }
    finally { event(method + '_end', { operation, durationMs: performance.now() - t, childPid: result?.pid }); }
  };
}
const stderr = process.stderr.write.bind(process.stderr);
let partial = '';
process.stderr.write = function(chunk, ...args) {
  partial += chunk.toString();
  const lines = partial.split('\n'); partial = lines.pop();
  for (const line of lines) if (line.startsWith('h2a.mcp.phase ')) {
        try { const p = JSON.parse(line.slice(14)); event('mcp_phase', { phase: p.phase, kind: p.event, durationMs: p.durationMs, code: p.code }); } catch {}
  }
  return stderr(chunk, ...args);
};
syncBuiltinESMExports();
process.once('exit', () => event('node_exit', { usage: process.resourceUsage() }));
