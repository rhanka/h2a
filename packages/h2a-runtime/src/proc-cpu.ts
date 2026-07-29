/**
 * CPU time of a process TREE, from /proc.
 *
 * Liveness in this repo is CPU time, never a PID: a lane blocked on a modal
 * shows a perfectly healthy process with 1s of CPU in 33 minutes. The tree
 * matters because a launch wrapper may keep a shell as the pane's process while
 * the agent runs as its child.
 *
 * The values are a SIGNAL, not an exact accounting: clock ticks are assumed to
 * be the Linux default of 100 Hz, and only live descendants are counted (a
 * finished child's time is not reclaimed here). Callers compare deltas well
 * above that noise, so the approximation never decides anything on its own.
 */

export const DEFAULT_CLOCK_TICKS_PER_SECOND = 100;

export type ProcEntry = {
  readonly pid: number;
  readonly ppid: number;
  readonly cpuMs: number;
};

/**
 * Parse one /proc/<pid>/stat line. `comm` may contain spaces and parentheses,
 * so every field is read AFTER the last ')' — splitting on whitespace from the
 * start silently shifts every index for a process named "(my app)".
 */
export function parseProcStat(
  content: string,
  clockTicksPerSecond = DEFAULT_CLOCK_TICKS_PER_SECOND,
): { readonly ppid: number; readonly cpuMs: number } | undefined {
  const close = content.lastIndexOf(")");
  if (close === -1) return undefined;
  const fields = content.slice(close + 1).trim().split(/\s+/);
  // After comm: [0]=state, [1]=ppid … [11]=utime, [12]=stime (procfs 3,4,14,15).
  const ppid = Number.parseInt(fields[1] ?? "", 10);
  const utime = Number.parseInt(fields[11] ?? "", 10);
  const stime = Number.parseInt(fields[12] ?? "", 10);
  if (!Number.isInteger(ppid) || !Number.isInteger(utime) || !Number.isInteger(stime)) {
    return undefined;
  }
  return {
    ppid,
    cpuMs: ((utime + stime) / clockTicksPerSecond) * 1000,
  };
}

/**
 * Total CPU of `rootPid` plus every live descendant. Returns undefined when the
 * root itself is unknown, so "cannot tell" is never reported as "idle".
 */
export function sumTreeCpuMs(
  rootPid: number,
  entries: Iterable<ProcEntry>,
): number | undefined {
  const byParent = new Map<number, ProcEntry[]>();
  const byPid = new Map<number, ProcEntry>();
  for (const entry of entries) {
    byPid.set(entry.pid, entry);
    const siblings = byParent.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else byParent.set(entry.ppid, [entry]);
  }
  const root = byPid.get(rootPid);
  if (!root) return undefined;
  let total = 0;
  const queue: number[] = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue; // a /proc snapshot can race into a cycle
    seen.add(pid);
    total += byPid.get(pid)?.cpuMs ?? 0;
    for (const child of byParent.get(pid) ?? []) queue.push(child.pid);
  }
  return total;
}

export type ProcReaderDeps = {
  readonly listPids: () => ReadonlyArray<number>;
  readonly readStat: (pid: number) => string | undefined;
  readonly clockTicksPerSecond?: number;
};

/** Snapshot /proc and total the tree rooted at `rootPid`. */
export function readProcessTreeCpuMs(
  rootPid: number,
  deps: ProcReaderDeps,
): number | undefined {
  const entries: ProcEntry[] = [];
  for (const pid of deps.listPids()) {
    const raw = deps.readStat(pid);
    if (raw === undefined) continue; // exited between listing and reading
    const parsed = parseProcStat(raw, deps.clockTicksPerSecond);
    if (!parsed) continue;
    entries.push({ pid, ppid: parsed.ppid, cpuMs: parsed.cpuMs });
  }
  return sumTreeCpuMs(rootPid, entries);
}
