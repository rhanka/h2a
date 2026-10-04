// Aggregate only experiment-owned evidence; never consult a configured store.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { lab } from './launch-perf-safety.mjs';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const round = value => Math.round(value * 1000) / 1000;
function mcp(name) {
  const data = read(join(lab, name, 'result.json'));
  const frames = data.rows.flatMap(row => row.frames);
  const server = frames.filter(frame => frame.role === 'server');
  const phases = {};
  for (const frame of frames.filter(frame => frame.event === 'end'))
    phases[frame.phase] = round((phases[frame.phase] ?? 0) + frame.durationMs);
  const io = {};
  for (const process of data.summaries) for (const [name, entry] of Object.entries(process.summary)) {
    const total = io[name] ??= { calls: 0, ms: 0, bytes: 0 };
    for (const field of ['calls', 'ms', 'bytes']) total[field] += entry[field];
  }
  for (const entry of Object.values(io)) entry.ms = round(entry.ms);
  const at = phase => server.find(frame => frame.phase === phase)?.monotonicMs;
  const childPids = new Set(frames.filter(frame => frame.role === 'identity-child').map(frame => frame.pid));
  const peaks = data.memory.processes.filter(process => childPids.has(process.pid)).map(process => process.rssPeakKiB / 1024);
  return { initializeMs: data.rows[0].initializeMs, identityMs: data.rows[0].identityMs,
    serverRssMiB: data.rows[0].rssKiB / 1024, identityWorkerPeakMiB: Math.max(0, ...peaks),
    postDiscover: data.rows[0].postDiscover, postHold: data.rows[0].postHold, phases, io,
    moduleLoadMs: at('process_start'),
    sessionOpenAtMs: at('session_open'),
    serverActivationMs: at('identity_ready') - at('session_open'),
    messagingMs: at('messaging_bound') === undefined ? 0 : at('messaging_bound') - at('messaging_bind'),
    registryHoldMs: Math.max(0, ...frames.filter(f => f.phase === 'lock_released' && f.tool === 'registry').map(f => f.holdMs)),
    bindingHoldMs: Math.max(0, ...frames.filter(f => f.phase === 'binding_lock_released').map(f => f.holdMs)),
    registryWaitMs: Math.max(0, ...frames.filter(f => f.phase === 'lock_acquired' && f.tool === 'registry').map(f => f.waitMs)) };
}
function runtime(name) {
  const directory = join(lab, name);
  const data = read(join(directory, 'runtime-result.json'));
  const operations = {};
  for (const file of readdirSync(directory).filter(name => /^\d+\.jsonl$/.test(name)))
    for (const process of readFileSync(join(directory, file), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))
      for (const [name, entry] of Object.entries(process.summary).filter(([key]) => key.startsWith('spawnSync:'))) {
        const total = operations[name] ??= { calls: 0, ms: 0 };
        total.calls += entry.calls; total.ms += entry.ms;
      }
  return { operations, promptWaitMs: data.results.map(row => row.receipt.result.prompt?.waitedMs),
    hostMs: data.results[0].hostMs };
}
function profiles(name) {
  return readdirSync(join(lab, name)).filter(name => name.endsWith('.cpuprofile')).flatMap(file => {
    const profile = read(join(lab, name, file));
    const counts = new Map();
    for (let i = 0; i < profile.samples.length; i++)
      counts.set(profile.samples[i], (counts.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
    return profile.nodes.filter(node => node.callFrame.url.includes('/packages/h2a/') || node.callFrame.url.includes('/packages/h2a-runtime/'))
      .map(node => ({ file, function: node.callFrame.functionName, url: node.callFrame.url.replace('file://' + resolve('.') + '/', ''),
        line: node.callFrame.lineNumber + 1, selfMs: round((counts.get(node.id) ?? 0) / 1000) }))
      .filter(node => node.selfMs > 0).sort((a, b) => b.selfMs - a.selfMs).slice(0, 12);
  }).sort((a, b) => b.selfMs - a.selfMs);
}
const evidence = { baselineRef: readFileSync(join(lab, 'baseline-build/baseline-ref.txt'), 'utf8').trim(),
  nodeVersion: process.version, candidateSourceSha256: Object.fromEntries([
    'packages/h2a/src/runtime/local-files/launch-index.ts', 'packages/h2a/src/runtime/local-files/store.ts',
    'packages/h2a/src/runtime/identity/bindings.ts', 'packages/h2a/src/runtime/identity/migration.ts',
    'packages/h2a/src/cli.ts', 'packages/h2a/src/cli-contract.ts',
    'packages/h2a-runtime/src/native-host.ts', 'packages/h2a-runtime/src/tmux.ts'
  ].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  scale: read(join(lab, 'large-v2/.launch-perf-synthetic.json')),
  matrices: {}, phases: {}, additional: {}, runtime: {}, cpu: {} };
for (const variant of ['before', 'after']) for (const path of ['mcp', 'runtime']) {
  evidence.matrices[`${variant}-${path}`] = read(join(lab, `matrix-${variant}-${path}.json`)).map(row => {
    if (path === 'mcp') {
      const detail = mcp(row.output.slice(lab.length + 1));
      row.identityWorkerPeakMiB = detail.identityWorkerPeakMiB;
      row.registryWaitMs = detail.registryWaitMs;
      row.registryHoldMs = detail.registryHoldMs;
    }
    delete row.output;
    return row;
  });
}
for (const variant of ['before', 'after']) {
  for (const size of ['small', 'large']) for (const cache of ['cold', 'warm']) {
    const name = `phases-${variant}-${size}-${cache}${variant === 'before' ? '-valid' : '-final'}`;
    evidence.phases[`${variant}-${size}-${cache}`] = mcp(name);
    if (size === 'large' && cache === 'warm') evidence.cpu[variant] = profiles(name);
  }
  for (const mode of ['mesh', 'discover', 'reclaim', 'idle']) {
    const name = `extra-${variant}-${mode}${variant === 'after' ? '-final' : ''}`;
    evidence.additional[`${variant}-${mode}`] = mcp(name);
  }
  for (const size of ['small', 'large']) for (const mode of ['mesh', 'discover']) {
    const name = `extra-${variant}-${mode}-${size === 'small' ? 'small' : ''}`.replace(/-$/, '') + (variant === 'after' ? '-final' : '');
    if (existsSync(join(lab, name))) evidence.additional[`${variant}-${mode}-${size}`] = mcp(name);
  }
  evidence.runtime[variant] = runtime(`matrix-${variant}-runtime-large-warm-n1`);
  evidence.runtime[`${variant}-17`] = runtime(`matrix-${variant}-runtime-large-cold-n17`);
}
const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/launch-perf-report.mjs <output-json>');
writeFileSync(target, JSON.stringify(evidence, null, 2) + '\n');
console.log(target);
