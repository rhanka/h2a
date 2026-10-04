import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnMcp, callRpc, waitForIdentity, collectFrames, stopChildren } from '../packages/h2a/test/helpers/mcp-fix-lab.js';
import { fixture, lab, memorySampler } from './launch-perf-safety.mjs';

const { root, output } = fixture(process.argv[2], process.argv[3]);
const n = Number(process.argv[4] ?? 1);
if (![1, 4, 17].includes(n)) throw new Error('Supported concurrency: 1, 4, 17');
const holdMs = Number(process.argv.find(arg => arg.startsWith('--hold-ms='))?.split('=')[1] ?? 0);
if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 30_000) throw new Error('Hold duration must be 0..30000 ms');
const home = join(output, 'home'), runtime = join(output, 'runtime');
for (const dir of [home, runtime]) mkdirSync(dir, { recursive: true, mode: 0o700 });
const start = performance.now();
const handles = Array.from({ length: n }, (_, i) => spawnMcp({ root,
  bin: process.env.H2A_PERF_BIN,
  nodeArgs: process.argv.includes('--cpu-prof') ? ['--cpu-prof', `--cpu-prof-dir=${output}`] : [],
  args: ['--auto-open', '--host', 'claude', '--auto-upgrade'], trace: true,
  env: { HOME: home, XDG_RUNTIME_DIR: runtime, H2A_ROOT: root,
    ...(process.argv.includes('--mesh') ? { H2A_MESSAGE_BACKEND: 'cluster-mesh', H2A_CLUSTER_MESH_MODULE: resolve('scripts/launch-perf-mesh.mjs') } : {}),
    CLAUDE_CODE_SESSION_ID: process.env.H2A_PERF_SESSION ?? `perf-${Date.now()}-${i}`,
    H2A_PERF_LAB: lab, H2A_PERF_OUTPUT: output,
    NODE_OPTIONS: `--require=${resolve('scripts/launch-perf-preload.cjs')}` }
}));
const rows = [];
const sampler = memorySampler(handles.map(h => h.child));
let memory;
try {
  await Promise.all(handles.map(async (handle, i) => {
    await callRpc(handle, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    const initializeMs = performance.now() - start;
    const status = await waitForIdentity(handle, s => ['identity_ready', 'identity_failed'].includes(s.state), { timeoutMs: 60000, pollMs: 20 });
    sampler.sample();
    const rssKiB = Number(readFileSync(`/proc/${handle.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
    const identityMs = performance.now() - start;
    let postDiscover;
    if (process.argv.includes('--discover')) {
      const begin = performance.now();
      const response = await callRpc(handle, { jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'h2a_discover_instances', arguments: {} } });
      sampler.sample();
      postDiscover = { elapsedMs: performance.now() - begin, frameBytes: response.bytes,
        rssKiB: Number(readFileSync(`/proc/${handle.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) };
    }
    let postHold;
    if (holdMs) {
      await new Promise(resolve => setTimeout(resolve, holdMs));
      sampler.sample();
      postHold = { elapsedMs: holdMs, rssKiB: Number(readFileSync(`/proc/${handle.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) };
    }
    rows.push({ i, pid: handle.pid, rssKiB, initializeMs, identityMs, postDiscover, postHold, status: status?.state, frames: collectFrames(handle) });
  }));
} finally {
  memory = sampler.stop();
  await stopChildren(...handles);
  await sampler.waitForExit();
  for (const [i, h] of handles.entries()) writeFileSync(join(output, `server-${i}.log`), h.stderr);
}
const summaries = readdirSync(output).filter(f => /^\d+\.jsonl$/.test(f)).flatMap(f => readFileSync(join(output, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const result = { root, n, rows, summaries, memory };
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ n, rows: rows.map(({ frames, ...row }) => row) }));
if (rows.some(row => row.status !== 'identity_ready')) process.exitCode = 1;
