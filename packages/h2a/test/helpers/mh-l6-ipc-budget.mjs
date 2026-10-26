// Shared IPC budget oracle for MH-L6 controller children.
//
// The 5000 ms budget is unchanged: on expiry the promise still rejects with
// a `controller_reply_budget_exceeded` error, never retries, never extends.
// What changed (H1 causal correction of the recorded intermittent timeout):
// the rejection now carries synchronously sampled liveness evidence so a
// healthy-but-unscheduled child is no longer reported identically to a
// stuck or dead one. Under host contention the product legitimately waits
// inside `spawnSync(flock --timeout 5)` guard chains; the previous bare
// timeout conflated that scheduling delay with a product hang and was
// dismissed as "transient load" after a lucky rerun.
import { readdirSync, readFileSync } from 'node:fs';

export const CONTROLLER_REPLY_BUDGET_MS = 5000;

// Single /proc read per pid: parent pid plus (comm) name.
function procFamily(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    if (open < 0 || close <= open) return undefined;
    const after = text.slice(close + 1).trim().split(/\s+/);
    // after[0] is state (field 3), after[1] is ppid (field 4),
    // after[11]/after[12] are utime/stime (fields 14/15).
    if (after.length < 20) return undefined;
    const ppid = Number(after[1]);
    const utime = Number(after[11]);
    const stime = Number(after[12]);
    if (!Number.isSafeInteger(ppid) || !Number.isSafeInteger(utime) || !Number.isSafeInteger(stime)) return undefined;
    return { state: after[0], ppid, cpuTicks: utime + stime, comm: text.slice(open + 1, close) };
  } catch {
    return undefined;
  }
}

// True when a live `flock` process descends from the controller: the
// signature of a legitimate product guard wait inside mutationLock, which
// spawns `flock --exclusive --timeout 5`. Best effort; false negatives
// stay silent rather than inventing evidence.
function flockWaiterDescendant(rootPid) {
  try {
    const family = new Map();
    for (const name of readdirSync('/proc')) {
      if (!/^[0-9]+$/.test(name)) continue;
      const pid = Number(name);
      const info = procFamily(pid);
      if (info) family.set(pid, info);
    }
    for (const [pid, info] of family) {
      if (info.comm !== 'flock') continue;
      let current = info.ppid;
      let depth = 0;
      while (current !== undefined && current !== 0 && depth < 64) {
        if (current === rootPid) return true;
        current = family.get(current)?.ppid;
        depth += 1;
      }
    }
  } catch {
    // Best effort only.
  }
  return false;
}

function loadAverage() {
  try {
    return readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/, 3).join(' ');
  } catch {
    return 'unknown';
  }
}

export function describeControllerWait(child, armedCpuTicks, waitedMs) {
  const stat = child.pid !== undefined ? procFamily(child.pid) : undefined;
  let alive = child.exitCode === null && child.signalCode === null;
  if (alive && child.pid !== undefined) {
    try {
      process.kill(child.pid, 0);
    } catch {
      alive = false;
    }
  }
  return {
    budgetMs: CONTROLLER_REPLY_BUDGET_MS,
    waitedMs,
    alive,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    cpuTicksAtArm: armedCpuTicks ?? null,
    cpuTicksAtExpiry: stat?.cpuTicks ?? null,
    controllerState: stat?.state ?? null,
    guardWait: alive ? flockWaiterDescendant(child.pid) : false,
    loadavg: loadAverage()
  };
}

export function replyWithBudget(child, budgetMs = CONTROLLER_REPLY_BUDGET_MS) {
  return new Promise((resolve, reject) => {
    const armedAt = Date.now();
    const armedCpu = child.pid !== undefined ? procFamily(child.pid)?.cpuTicks : undefined;
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', message);
      child.off('close', close);
      child.off('error', error);
    };
    const message = (value) => {
      cleanup();
      resolve(value);
    };
    const close = () => {
      cleanup();
      reject(new Error('controller_closed_before_reply'));
    };
    const error = (value) => {
      cleanup();
      reject(value);
    };
    const timer = setTimeout(() => {
      const evidence = describeControllerWait(child, armedCpu, Date.now() - armedAt);
      cleanup();
      reject(new Error(`controller_reply_budget_exceeded ${JSON.stringify(evidence)}`));
    }, budgetMs);
    child.once('message', message);
    child.once('close', close);
    child.once('error', error);
  });
}
