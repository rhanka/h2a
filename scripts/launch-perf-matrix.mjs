// One bounded experiment at a time; every child driver reaps its own handles.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { lab } from './launch-perf-safety.mjs';

const variant = process.argv[2], path = process.argv[3] ?? 'mcp';
if (!['before', 'after'].includes(variant) || !['mcp', 'runtime'].includes(path))
  throw new Error('Usage: node scripts/launch-perf-matrix.mjs before|after mcp|runtime');
const baseline = join(lab, 'baseline-build');
const run = (command, args, env = process.env) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`Experiment exited ${code}: ${stderr}\n${stdout}`)));
});
function coldHistory(root) {
  root = realpathSync(root);
  if (!root.startsWith(lab + sep) || !existsSync(join(root, '.launch-perf-synthetic.json'))) throw new Error('Synthetic root required');
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.launch-index-v1')) walk(file);
      else if (entry.isFile() && (entry.name.endsWith('.jsonl') || dir.endsWith('.launch-index-v1'))) files.push(file);
    }
  };
  for (const name of ['registry', 'identity']) walk(join(root, name));
  return run(join(lab, 'evict-v2'), files);
}
const summary = [];
let refused17;
for (const size of ['small', 'large']) for (const n of size === 'small' ? [1] : [1, 4, 17]) for (const cache of ['cold', 'warm']) {
  if (n === 17 && refused17) {
    const skipped = { variant, path, size, n, cache, skipped: refused17 };
    summary.push(skipped); console.log(JSON.stringify(skipped)); continue;
  }
  const root = join(lab, size + '-v2');
  const output = join(lab, `matrix-${variant}-${path}-${size}-${cache}-n${n}`);
  const resultFile = join(output, path === 'mcp' ? 'result.json' : 'runtime-result.json');
  const resume = process.argv.includes('--resume') && existsSync(resultFile);
  if (existsSync(output) && !resume) throw new Error('Fresh matrix output directories required');
  if (cache === 'cold' && !resume) await coldHistory(root);
  const env = { ...process.env, ...(variant === 'before'
    ? { H2A_PERF_BIN: join(baseline, 'packages/h2a/dist/bin.js'), H2A_PERF_BUILD: baseline }
    : { H2A_PERF_BIN: resolve('packages/h2a/dist/bin.js'), H2A_PERF_BUILD: resolve('.') }) };
  if (!resume) await run(process.execPath, [resolve(`scripts/launch-perf-${path === 'mcp' ? 'probe' : 'runtime'}.mjs`), root, output, String(n)], env);
  const result = JSON.parse(readFileSync(resultFile));
  const max = key => Math.max(...(result.rows ?? result.results).map(row => row[key]));
  const row = { variant, path, size, n, cache, output,
    ...(path === 'mcp' ? { initializeMs: max('initializeMs'), identityMs: max('identityMs'), serverMaxRssMiB: max('rssKiB') / 1024 }
      : { launchMs: max('elapsedMs') + max('hostMs') }),
    treePeakMiB: result.memory.treePeakKiB / 1024,
    scopePeakMiB: result.memory.cgroupPeakBytes / 1024 ** 2 };
  summary.push(row);
  console.log(JSON.stringify(row));
  // Require measured headroom before progressing from 4 to 17. Charge the
  // sampled cgroup growth above this driver's baseline, with a 25% margin.
  if (n === 4 && cache === 'warm') {
    const cgroup = readFileSync('/proc/self/cgroup', 'utf8').trim().split('::')[1];
    const current = Number(readFileSync(join('/sys/fs/cgroup', cgroup, 'memory.current'), 'utf8'));
    let projected = current + Math.max(0, result.memory.cgroupPeakBytes - current) * 17 / 4 * 1.25;
    if (projected > result.memory.limit * 0.85 && process.argv.includes('--paired-memory-admission') && variant === 'before' && path === 'runtime') {
      // A directly measured runtime cohort at 17 is a better base than a 4→17
      // projection. Charge the measured whole-cohort historical MCP overhead
      // on top, with a 25% margin on that overhead. The live 85% cutoff still
      // applies inside every experiment; this does not raise the memory limit.
      const peak17 = (v, p) => Math.max(...JSON.parse(readFileSync(join(lab, `matrix-${v}-${p}.json`)))
        .filter(row => row.size === 'large' && row.n === 17).map(row => row.scopePeakMiB)) * 1024 ** 2;
      const overhead = Math.max(0, peak17('before', 'mcp') - peak17('after', 'mcp'));
      projected = peak17('after', 'runtime') + overhead * 1.25;
      console.log(JSON.stringify({ admission: 'measured-runtime-17-plus-historical-mcp-overhead', projectedMiB: projected / 1024 ** 2,
        safetyLimitMiB: result.memory.limit * 0.85 / 1024 ** 2 }));
    }
    if (projected > result.memory.limit * 0.85) refused17 = `N=17 refused: projected memory ${Math.round(projected / 1024 ** 2)} MiB`;
  }
}
writeFileSync(join(lab, `matrix-${variant}-${path}.json`), JSON.stringify(summary, null, 2));
