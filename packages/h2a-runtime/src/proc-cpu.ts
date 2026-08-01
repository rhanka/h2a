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

import { readFileSync } from "node:fs";

export const DEFAULT_CLOCK_TICKS_PER_SECOND = 100;

export type ProcEntry = {
  readonly pid: number;
  readonly ppid: number;
  readonly cpuMs: number;
  /** /proc stat field 22: ticks since boot, preserved as a string. */
  readonly startTime: string;
};

export type WorkerAttribution = {
  readonly pid: number;
  readonly startTime: string;
  readonly bootId: string;
};

export type ProcIdentity = {
  readonly pid: number;
  readonly startTime: string;
};

/** One fleet-wide /proc view, suitable for pure lease projections. */
export type ProcView = {
  readonly currentBootId: string;
  readonly processes:
    | ReadonlyMap<number, { readonly startTime: string }>
    | ReadonlyArray<ProcIdentity>;
  /** The parsed snapshot is retained so a pane worker can be resolved without
   * another /proc walk during a supervising pass. */
  readonly entries?: ReadonlyArray<ProcEntry>;
};

/**
 * Parse one /proc/<pid>/stat line. `comm` may contain spaces and parentheses,
 * so every field is read AFTER the last ')' — splitting on whitespace from the
 * start silently shifts every index for a process named "(my app)".
 */
export function parseProcStat(
  content: string,
  clockTicksPerSecond = DEFAULT_CLOCK_TICKS_PER_SECOND,
): { readonly ppid: number; readonly cpuMs: number; readonly startTime: string } | undefined {
  const close = content.lastIndexOf(")");
  if (close === -1) return undefined;
  const fields = content.slice(close + 1).trim().split(/\s+/);
  // After comm: [0]=state, [1]=ppid … [11]=utime, [12]=stime (procfs 3,4,14,15).
  const ppid = Number.parseInt(fields[1] ?? "", 10);
  const utime = Number.parseInt(fields[11] ?? "", 10);
  const stime = Number.parseInt(fields[12] ?? "", 10);
  const startTime = fields[19];
  if (
    !Number.isInteger(ppid) ||
    !Number.isInteger(utime) ||
    !Number.isInteger(stime) ||
    startTime === undefined ||
    !/^\d+$/.test(startTime)
  ) {
    return undefined;
  }
  return {
    ppid,
    cpuMs: ((utime + stime) / clockTicksPerSecond) * 1000,
    startTime,
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

/**
 * The descendant actually doing the work.
 *
 * Measured 2026-07-29: a launch reported pid 3392709 (the `node` wrapper) with
 * 0s of CPU after 37s while its child `codex` (3392862) had burned 13s. A
 * liveness check on the REPORTED pid therefore returns a false negative on a
 * perfectly healthy agent, and would call a live wrapper with a dead worker
 * alive. Returns the busiest process in the tree, or the root when it is alone.
 */
export function busiestDescendant(
  rootPid: number,
  entries: Iterable<ProcEntry>,
): number | undefined {
  const list = [...entries];
  const byPid = new Map(list.map((entry) => [entry.pid, entry]));
  const root = byPid.get(rootPid);
  if (!root) return undefined;
  const byParent = new Map<number, ProcEntry[]>();
  for (const entry of list) {
    const siblings = byParent.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else byParent.set(entry.ppid, [entry]);
  }
  let best = rootPid;
  let bestCpu = root.cpuMs;
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of byParent.get(pid) ?? []) {
      if (child.cpuMs > bestCpu) {
        bestCpu = child.cpuMs;
        best = child.pid;
      }
      queue.push(child.pid);
    }
  }
  return best;
}

export type ProcReaderDeps = {
  readonly listPids: () => ReadonlyArray<number>;
  readonly readStat: (pid: number) => string | undefined;
  /** Optional injection point for tests; the default reads kernel boot_id. */
  readonly readBootId?: () => string | undefined;
  readonly clockTicksPerSecond?: number;
};

/** Snapshot /proc once, parsed into entries. */
export function snapshotProc(deps: ProcReaderDeps): ProcEntry[] {
  const entries: ProcEntry[] = [];
  for (const pid of deps.listPids()) {
    const raw = deps.readStat(pid);
    if (raw === undefined) continue; // exited between listing and reading
    const parsed = parseProcStat(raw, deps.clockTicksPerSecond);
    if (!parsed) continue;
    entries.push({
      pid,
      ppid: parsed.ppid,
      cpuMs: parsed.cpuMs,
      startTime: parsed.startTime,
    });
  }
  return entries;
}

const DEFAULT_BOOT_ID_READER = (): string | undefined => {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
};

// A reader function is stable for the lifetime of a process. WeakMap keeps
// injected readers isolated in tests while preserving the production contract:
// boot_id is read once per process, regardless of how many lease passes run.
const bootIdCache = new WeakMap<() => string | undefined, string | undefined>();

function cachedBootId(reader: () => string | undefined): string | undefined {
  if (bootIdCache.has(reader)) return bootIdCache.get(reader);
  const value = reader();
  bootIdCache.set(reader, value);
  return value;
}

function bootIdReader(deps: ProcReaderDeps): () => string | undefined {
  return deps.readBootId ?? DEFAULT_BOOT_ID_READER;
}

/** Snapshot /proc once and retain both CPU/process-tree and identity facts. */
export function snapshotProcView(deps: ProcReaderDeps): {
  readonly entries: ProcEntry[];
  readonly view: ProcView;
} {
  const entries = snapshotProc(deps);
  const processes = new Map<number, { readonly startTime: string }>();
  for (const entry of entries) processes.set(entry.pid, { startTime: entry.startTime });
  const currentBootId = cachedBootId(bootIdReader(deps));
  return {
    entries,
    view: {
      currentBootId: currentBootId ?? "",
      processes,
      entries,
    },
  };
}

/** Snapshot /proc once for the liveness predicate. */
export function readProcView(deps: ProcReaderDeps): ProcView {
  return snapshotProcView(deps).view;
}

/** Resolve a worker from an already captured snapshot; performs no syscalls. */
export function resolveWorkerAttributionFromView(
  rootPid: number,
  view: ProcView,
): WorkerAttribution | undefined {
  if (!view.entries) return undefined;
  const workerPid = busiestDescendant(rootPid, view.entries);
  if (workerPid === undefined) return undefined;
  const worker = view.entries.find((entry) => entry.pid === workerPid);
  if (!worker || !view.currentBootId) return undefined;
  return { pid: worker.pid, startTime: worker.startTime, bootId: view.currentBootId };
}

/** Resolve the worker once from a pane pid, including its composite identity. */
export function readWorkerAttribution(
  rootPid: number,
  deps: ProcReaderDeps,
): WorkerAttribution | undefined {
  const { view } = snapshotProcView(deps);
  return resolveWorkerAttributionFromView(rootPid, view);
}

/** Descriptive alias for callers that prefer resolver terminology. */
export const resolveWorkerAttribution = readWorkerAttribution;

export type ProcessObservation = {
  readonly cpuMs: number | undefined;
  readonly worker: WorkerAttribution | undefined;
  readonly procView: ProcView;
};

/** CPU + worker observation sharing exactly one /proc snapshot. */
export function readProcessObservation(
  rootPid: number,
  deps: ProcReaderDeps,
): ProcessObservation {
  const { entries, view } = snapshotProcView(deps);
  return {
    cpuMs: sumTreeCpuMs(rootPid, entries),
    worker: resolveWorkerAttributionFromView(rootPid, view),
    procView: view,
  };
}

/** Snapshot /proc and total the tree rooted at `rootPid`. */
export function readProcessTreeCpuMs(
  rootPid: number,
  deps: ProcReaderDeps,
): number | undefined {
  return sumTreeCpuMs(rootPid, snapshotProc(deps));
}

/** Snapshot /proc and name the process actually doing the work. */
export function readWorkerPid(
  rootPid: number,
  deps: ProcReaderDeps,
): number | undefined {
  return busiestDescendant(rootPid, snapshotProc(deps));
}
