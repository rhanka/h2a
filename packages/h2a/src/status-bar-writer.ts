import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  readStatusSnapshot,
  renderStatusBar,
  renderWorkloadBar,
  type StatusSurfaceStreams,
} from "./status-surface.js";

/**
 * Single background producer of tmux status-bar text.
 *
 * The 2026-07-31 spawn storm: the installed surface embedded
 * `#(h2a status --bar ...)` in status-left AND status-right, and tmux re-runs
 * both commands once per status-interval for EVERY session — two node
 * startups per session per 5s (~16/s at 40 sessions, measured load 197). The
 * surface now embeds only `#(cat <file>)`; this writer is the one process
 * that computes every session's bar text and publishes it to those files.
 *
 * Self-limiting by construction: a lease makes it single-instance per h2a
 * root, it exits once no installed session remains, and each tick costs two
 * bounded tmux list calls plus in-process rendering — never a subprocess per
 * session.
 */

/** Duplicated in @sentropic/h2a-runtime (tmux.ts): the CLI is a peer, not an import. */
export const STATUS_BAR_WRITER_LOCK_FILE = "writer.lock";

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_STALE_MS = 60_000;

export interface WriterLeaseProbe {
  readonly pid: number;
  readonly isAlive: (pid: number) => boolean;
  readonly staleMs?: number;
}

/**
 * Take the single-writer lease. A held lock only blocks us while its holder
 * is alive AND fresh: liveness alone is not enough (pid reuse after a crash),
 * freshness alone is not enough (a hung writer keeps refreshing nothing).
 */
export function acquireStatusBarWriterLease(
  dir: string,
  probe: WriterLeaseProbe,
): boolean {
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
  const payload = JSON.stringify({
    pid: probe.pid,
    acquiredAt: new Date().toISOString(),
  });
  const tryExclusive = (): boolean => {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, payload);
      } finally {
        closeSync(fd);
      }
      return true;
    } catch {
      return false;
    }
  };
  if (tryExclusive()) return true;
  try {
    const fresh =
      Date.now() - statSync(lockPath).mtimeMs <=
      (probe.staleMs ?? DEFAULT_STALE_MS);
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: number;
    };
    if (fresh && typeof holder.pid === "number" && probe.isAlive(holder.pid)) {
      return false;
    }
  } catch {
    // Unreadable lock: treat as stale.
  }
  try {
    unlinkSync(lockPath);
  } catch {
    // Lost the removal race; the winner holds a valid lease.
  }
  return tryExclusive();
}

/** Touch the lock so ensure-side staleness checks see a live writer. */
export function refreshStatusBarWriterLease(dir: string, pid: number): boolean {
  const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: number;
    };
    if (holder.pid !== pid) return false;
    const now = new Date();
    utimesSync(lockPath, now, now);
    return true;
  } catch {
    return false;
  }
}

export function releaseStatusBarWriterLease(dir: string, pid: number): void {
  const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: number;
    };
    if (holder.pid !== pid) return;
    unlinkSync(lockPath);
  } catch {
    // Already gone.
  }
}

interface StatusBarTarget {
  readonly session: string;
  readonly ownerInstance?: string;
  readonly clientWidth?: number;
}

interface StatusBarRuntime {
  readonly listStatusBarTargets: () => StatusBarTarget[];
  readonly statusBarFilesForSession: (
    session: string,
    root?: string,
  ) => { readonly left: string; readonly right: string };
  readonly statusBarRoot: (root?: string) => string;
}

async function loadStatusBarRuntime(): Promise<StatusBarRuntime | undefined> {
  try {
    const packageName: string = "@sentropic/h2a-runtime";
    const runtime = (await import(packageName)) as Partial<StatusBarRuntime>;
    if (
      typeof runtime.listStatusBarTargets !== "function" ||
      typeof runtime.statusBarFilesForSession !== "function" ||
      typeof runtime.statusBarRoot !== "function"
    ) {
      return undefined;
    }
    return runtime as StatusBarRuntime;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function writeAtomic(path: string, text: string): void {
  const tmp = join(dirname(path), `.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => finish();
    const timer = setTimeout(finish, ms);
    if (signal?.aborted) finish();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function renderLeftBar(
  root: string,
  target: StatusBarTarget,
): Promise<string> {
  const snapshot = await readStatusSnapshot({
    root,
    tmuxSession: target.session,
    ...(target.ownerInstance ? { ownerInstance: target.ownerInstance } : {}),
    includeGateway: false,
    includeManagedInventory: false,
    includePresence: false,
  });
  return renderWorkloadBar(snapshot);
}

async function renderRightBar(
  root: string,
  target: StatusBarTarget,
): Promise<string> {
  const snapshot = await readStatusSnapshot({
    root,
    tmuxSession: target.session,
    includePresence: false,
    includeDelegations: false,
    includeManagedInventory: false,
    includeInbox: false,
    includeLoops: false,
  });
  // Mirror the CLI bar: reserve room for the static left marker and clock;
  // the route is omitted rather than silently cut when it cannot fit.
  const gatewayWidth = target.clientWidth === undefined
    ? undefined
    : Math.max(0, target.clientWidth - 32);
  return renderStatusBar(snapshot, "gateway", gatewayWidth);
}

export interface StatusBarWriterOptions {
  readonly root: string;
  readonly signal?: AbortSignal;
  readonly intervalMs?: number;
}

export async function runStatusBarWriter(
  options: StatusBarWriterOptions,
  streams: StatusSurfaceStreams,
): Promise<number> {
  const runtime = await loadStatusBarRuntime();
  if (!runtime) {
    streams.stderr.write(
      "h2a status --write-bars: @sentropic/h2a-runtime is unavailable; bars keep their static placeholders\n",
    );
    return 1;
  }
  const dir = runtime.statusBarRoot(options.root);
  const pid = process.pid;
  if (!acquireStatusBarWriterLease(dir, { pid, isAlive: processIsAlive })) {
    // Another live writer already produces the bars; arriving second is the
    // normal outcome of every install calling ensure.
    return 0;
  }
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const written = new Set<string>();
  let emptyTicks = 0;
  try {
    while (!options.signal?.aborted) {
      const targets = runtime.listStatusBarTargets();
      if (targets.length === 0) {
        emptyTicks += 1;
        // Self-limiting: two consecutive empty ticks mean no installed
        // session remains, so the writer leaves instead of idling forever.
        if (emptyTicks >= 2) break;
      } else {
        emptyTicks = 0;
      }
      const current = new Set<string>();
      for (const target of targets) {
        const files = runtime.statusBarFilesForSession(
          target.session,
          options.root,
        );
        current.add(files.left);
        current.add(files.right);
        try {
          writeAtomic(files.left, await renderLeftBar(options.root, target));
          writeAtomic(files.right, await renderRightBar(options.root, target));
          written.add(files.left);
          written.add(files.right);
        } catch {
          // One session's failed render keeps its previous text for a tick;
          // absence still degrades to the static placeholder, never a spawn.
        }
      }
      for (const file of [...written]) {
        if (current.has(file)) continue;
        try {
          unlinkSync(file);
        } catch {
          // Already gone.
        }
        written.delete(file);
      }
      refreshStatusBarWriterLease(dir, pid);
      await delay(interval, options.signal);
    }
    return 0;
  } finally {
    // Leave placeholders, not last-known lies: a stopped writer must not
    // freeze yesterday's counts on the bar.
    for (const file of written) {
      try {
        unlinkSync(file);
      } catch {
        // Already gone.
      }
    }
    releaseStatusBarWriterLease(dir, pid);
  }
}
