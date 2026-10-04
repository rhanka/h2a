// Only synthetic roots created by this lab are admissible. No ambient HOME.
import { mkdirSync, readFileSync, realpathSync, existsSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const lab = resolve('tmp/launch-lab');
export function fixture(root, output) {
  root = realpathSync(root);
  output = resolve(output);
  for (const path of [root, output])
    if (!path.startsWith(lab + sep)) throw new Error('Experiment must be inside tmp/launch-lab');
  const corpus = JSON.parse(readFileSync(join(root, '.launch-perf-synthetic.json'), 'utf8'));
  if (existsSync(output)) throw new Error('Use a fresh experiment output directory');
  // Previous cohorts have exited before another starts. Remove only their
  // presence files inside this marker-proven synthetic root, so the next
  // cohort starts with exactly the declared presence workload.
  for (const name of readdirSync(join(root, 'presence')))
    if (name.endsWith('.json') && !/^synthetic-presence-\d+\.json$/.test(name))
      unlinkSync(join(root, 'presence', name));
  // Keep the fixed presence workload fresh across sequential experiments.
  for (let i = 0; i < corpus.counts.presence; i++) {
    const file = join(root, 'presence', `synthetic-presence-${i}.json`);
    const session = JSON.parse(readFileSync(file, 'utf8'));
    session.heartbeatAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
  }
  // Exercise the real cache-hit check on every run, including long campaigns;
  // an expired fixture cache must never turn a lab run into an installation.
  writeFileSync(join(root, 'upgrade-check.json'), JSON.stringify({ checkedAt: Date.now(), latest: '0.98.1' }), { mode: 0o600 });
  mkdirSync(output, { recursive: true, mode: 0o700 });
  return { root, output };
}

// Sample only descendants of handles this experiment started. No process
// inventory, command line or environment from unrelated/live owner sessions.
export function memorySampler(children) {
  const peaks = new Map();
  let treePeakKiB = 0, cgroupPeakBytes = 0;
  const cgroup = readFileSync('/proc/self/cgroup', 'utf8').trim().split('::')[1];
  const memoryPath = join('/sys/fs/cgroup', cgroup, 'memory.current');
  const limit = Number(readFileSync(join('/sys/fs/cgroup', cgroup, 'memory.max'), 'utf8'));
  if (!Number.isFinite(limit) || limit > 8 * 1024 ** 3) throw new Error('An <=8 GiB memory scope is required');
  const sample = () => {
    let total = 0;
    const seen = new Set();
    const visit = pid => {
      if (!pid || seen.has(pid)) return;
      seen.add(pid);
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        const rssKiB = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
        const hwmKiB = Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0);
        const comm = status.match(/^Name:\s+(.+)$/m)?.[1];
        const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const startTicks = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
        const peak = peaks.get(pid) ?? { pid, comm, startTicks, rssPeakKiB: 0 };
        peak.rssPeakKiB = Math.max(peak.rssPeakKiB, rssKiB, hwmKiB);
        peaks.set(pid, peak);
        total += rssKiB;
        for (const child of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/)) visit(Number(child));
      } catch { /* a child completed between samples */ }
    };
    for (const child of children) if (child.exitCode === null && child.signalCode === null) visit(child.pid);
    treePeakKiB = Math.max(treePeakKiB, total);
    cgroupPeakBytes = Math.max(cgroupPeakBytes, Number(readFileSync(memoryPath, 'utf8')));
    if (cgroupPeakBytes > limit * 0.85) {
      // Safety shutdown affects only handles we own, never a global pkill.
      for (const child of children) child.kill('SIGTERM');
      process.stderr.write('Experiment exceeded the 85% memory safety budget; terminating owned handles\n');
      process.exitCode = 1;
    }
  };
  const timer = setInterval(sample, 20);
  return {
    sample,
    async waitForExit() {
      // Detached upgrade workers are still experiment-owned descendants. Wait
      // for their bounded cache-hit work too, rather than leaving them behind.
      const deadline = Date.now() + 5_000;
      while (true) {
        const live = [...peaks.values()].filter(({ pid, startTicks }) => {
          try {
            const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
            return fields[19] === startTicks && !['Z', 'X'].includes(fields[0]);
          } catch { return false; }
        });
        if (!live.length) return;
        if (Date.now() >= deadline) throw new Error('Owned descendants still live; refusing to finish this experiment');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    stop() { clearInterval(timer); sample(); return { processes: [...peaks.values()], treePeakKiB, cgroupPeakBytes, limit }; }
  };
}
