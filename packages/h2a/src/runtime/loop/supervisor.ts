/**
 * Durable objective-loop supervisor (L1 Lot 1b).
 *
 * THIS is the piece that makes an h2a objective loop auto-relaunch on its own,
 * the way `/loop` does on Claude — but server-side and host-agnostic. Each beat
 * it takes the loops that have OPTED IN (`policy.autoTick`, Lot 1a) and, for
 * each one it can lease as the SINGLE writer (`acquireLoopExecutorLease`, Lot 0),
 * runs exactly one `tick + execute` of the existing engine under that lease,
 * then releases it. It reuses the engine — it does not re-implement ticking.
 *
 * Safety, per the double-opus B′ consensus (tmp/L1-decision-reconciled.md):
 *  - OPT-IN ONLY: `listAutoTickLoops` already filters to opted-in, LIVE loops;
 *    a global kill-switch (`H2A_LOOP_AUTOTICK_OFF`) freezes every beat.
 *  - SINGLE-WRITER: a loop is ticked only while its per-loop lease is held, so
 *    the dozen `mcp-serve` processes on a host cannot double-tick a loop.
 *  - FAIL-CLOSED ISOLATION: one loop throwing never aborts the beat or the
 *    supervisor; that loop simply goes un-ticked this beat and its heartbeat
 *    goes stale, which the read-side `loopAttendance` surfaces as `unattended`.
 *  - HONEST ATTENDANCE: each successful tick stamps an executor heartbeat;
 *    `loopAttendance` is a pure read-side predicate ANY reader (status/doctor)
 *    can evaluate — an opted-in loop with no fresh heartbeat reads `unattended`
 *    (fail-closed: missing/stale ⇒ unattended), so a down supervisor is visible.
 *
 * Golden rule: this module must NOT statically import `@sentropic/h2a-runtime`.
 * It imports only the loop store, the executor lease, and the engine tick (which
 * is itself adapters-gated). Imported constants are referenced at CALL time, not
 * aliased at module-eval, to avoid any import-cycle temporal-dead-zone.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { localStorePaths, safePathSegment } from "../local-files/paths.js";
import {
  autoTickGloballyDisabled,
  isLoopAutoTickEligible,
  listAutoTickLoops,
  type H2AObjectiveLoop
} from "./index.js";
import { acquireLoopExecutorLease } from "./executor-lease.js";
import { runTick } from "./engine/tick.js";

/** Default supervisor beat interval. Each eligible loop is ticked every beat. */
export const DEFAULT_SUPERVISOR_INTERVAL_MS = 30000;

/**
 * How many of a loop's own `tickMs` may elapse with no executor heartbeat before
 * an opted-in loop is judged `unattended`. K=3 tolerates a couple of missed
 * beats (a busy host, a lease held by a slow peer) before raising the flag.
 */
export const DEFAULT_UNATTENDED_TICKS = 3;

/** Fallback per-loop cadence when a loop's policy carries no `tickMs`. */
const FALLBACK_TICK_MS = 60000;

/** Executor heartbeat: proof that SOME live executor ticked this loop, and when. */
export interface ExecutorHeartbeat {
  readonly at: string;
  readonly holder: string;
  readonly fencingToken: number;
}

/** Absolute path of a loop's executor heartbeat file. */
export function loopExecutorHeartbeatPath(root: string, loopId: string): string {
  return join(
    localStorePaths(root).root,
    "loops",
    safePathSegment(loopId),
    "executor.heartbeat"
  );
}

/**
 * Record that an executor just ticked `loopId`. Written after a successful tick,
 * inside the loop's own dir (created by the lease acquisition). Best-effort: a
 * write failure must not crash the beat, so callers wrap it — but it throws
 * nothing on the happy path.
 */
export function stampExecutorHeartbeat(
  root: string,
  loopId: string,
  entry: { readonly holder: string; readonly fencingToken: number; readonly at?: number }
): void {
  const hb: ExecutorHeartbeat = {
    at: new Date(entry.at ?? Date.now()).toISOString(),
    holder: entry.holder,
    fencingToken: entry.fencingToken
  };
  writeFileSync(loopExecutorHeartbeatPath(root, loopId), JSON.stringify(hb));
}

/** Read a loop's executor heartbeat, or `null` if absent/unparseable. */
export function readExecutorHeartbeat(
  root: string,
  loopId: string
): ExecutorHeartbeat | null {
  let raw: string;
  try {
    raw = readFileSync(loopExecutorHeartbeatPath(root, loopId), "utf8");
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(raw) as Partial<ExecutorHeartbeat>;
    if (typeof p.at === "string" && typeof p.holder === "string" && typeof p.fencingToken === "number") {
      return { at: p.at, holder: p.holder, fencingToken: p.fencingToken };
    }
  } catch {
    /* malformed — treat as absent */
  }
  return null;
}

export type LoopAttendance = "attended" | "unattended" | "not-applicable";

/**
 * Read-side, fail-closed attendance of an opted-in loop. Any reader can call
 * this without a supervisor running:
 *  - `not-applicable`  — the loop is not auto-tick eligible (not opted-in,
 *                        terminal, or the kill-switch is on): nothing should tick
 *                        it, so attendance is moot.
 *  - `unattended`      — eligible but NO fresh executor heartbeat (missing,
 *                        malformed, or older than K×tickMs). This is the
 *                        fail-closed default: absence of proof ⇒ unattended, so a
 *                        down/absent supervisor is visible.
 *  - `attended`        — eligible and a heartbeat exists within K×tickMs.
 */
export function loopAttendance(
  root: string,
  loop: H2AObjectiveLoop,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  k: number = DEFAULT_UNATTENDED_TICKS
): LoopAttendance {
  if (!isLoopAutoTickEligible(loop, env)) return "not-applicable";
  const hb = readExecutorHeartbeat(root, loop.id);
  if (!hb) return "unattended";
  const at = Date.parse(hb.at);
  if (Number.isNaN(at)) return "unattended";
  const tickMs = loop.policy?.tickMs && loop.policy.tickMs > 0 ? loop.policy.tickMs : FALLBACK_TICK_MS;
  return now - at > k * tickMs ? "unattended" : "attended";
}

/** What one supervisor beat did — for observability / tests, never for control. */
export interface SupervisorBeatSummary {
  /** Loops ticked+executed under a freshly-held lease this beat. */
  readonly ticked: string[];
  /** Loops another live executor already held the lease for (single-writer). */
  readonly skippedLocked: string[];
  /** Loops whose tick threw; isolated so the beat continued. */
  readonly errored: { readonly loopId: string; readonly error: string }[];
  /** True when the global kill-switch froze the whole beat. */
  readonly frozen: boolean;
}

export interface LoopSupervisorOptions {
  /** Beat interval. Default {@link DEFAULT_SUPERVISOR_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /** Abort to stop the loop between/within beats. */
  readonly signal?: AbortSignal;
  /** Stop after this many beats (testing / one-shot). Undefined ⇒ forever. */
  readonly max?: number;
  /** Injectable clock (ms). Default `Date.now`. */
  readonly now?: () => number;
  /** Environment for the kill-switch / eligibility. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Holder label for the lease + heartbeat. Default host:pid via the lease. */
  readonly holder?: string;
  /** Executor lease duration. Default the lease module's own default. */
  readonly leaseMs?: number;
  /** Injectable tick fn (testing). Default the real engine `runTick`. */
  readonly runTickFn?: (
    root: string,
    loopId: string,
    opts: { execute?: boolean }
  ) => Promise<unknown>;
  /** Called after each beat with its summary. */
  readonly onBeat?: (summary: SupervisorBeatSummary) => void | Promise<void>;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run ONE supervisor beat: tick+execute every eligible loop we can lease, in
 * isolation. Exposed so a caller (or a test) can drive a single beat without the
 * timer loop. Never throws: a loop's failure is captured in `errored`.
 */
export async function runSupervisorBeat(
  root: string,
  options: LoopSupervisorOptions = {}
): Promise<SupervisorBeatSummary> {
  const env = options.env ?? process.env;
  const nowFn = options.now ?? ((): number => Date.now());
  const tick = options.runTickFn ?? runTick;

  const ticked: string[] = [];
  const skippedLocked: string[] = [];
  const errored: { loopId: string; error: string }[] = [];

  // Kill-switch: freeze the entire beat, tick nothing. Checked here AND inside
  // listAutoTickLoops (redundant-but-safe) so a race that flips the switch
  // mid-beat still yields an empty set.
  if (autoTickGloballyDisabled(env)) {
    return { ticked, skippedLocked, errored, frozen: true };
  }

  for (const loop of listAutoTickLoops(root, env)) {
    const lease = acquireLoopExecutorLease(root, loop.id, {
      ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
      ...(options.holder !== undefined ? { holder: options.holder } : {})
    });
    if (!lease) {
      skippedLocked.push(loop.id);
      continue;
    }
    try {
      await tick(root, loop.id, { execute: true });
      stampExecutorHeartbeat(root, loop.id, {
        holder: options.holder ?? "supervisor",
        fencingToken: lease.token,
        at: nowFn()
      });
      ticked.push(loop.id);
    } catch (err) {
      // FAIL-CLOSED ISOLATION: this loop is simply not attended this beat; its
      // heartbeat stays stale → surfaced as `unattended`. The beat continues.
      errored.push({ loopId: loop.id, error: err instanceof Error ? err.message : String(err) });
    } finally {
      lease.release();
    }
  }

  return { ticked, skippedLocked, errored, frozen: false };
}

/**
 * Run the durable supervisor until `signal` aborts (or `max` beats elapse). This
 * is what the systemd `--user` unit runs (Lot 1c). It is NEVER on any default
 * code path — existing users see no change until they explicitly launch it.
 */
export async function runLoopSupervisor(
  root: string,
  options: LoopSupervisorOptions = {}
): Promise<number> {
  const intervalMs = options.intervalMs && options.intervalMs > 0
    ? options.intervalMs
    : DEFAULT_SUPERVISOR_INTERVAL_MS;
  let beats = 0;
  for (;;) {
    const summary = await runSupervisorBeat(root, options);
    await options.onBeat?.(summary);
    beats += 1;
    if (options.max !== undefined && beats >= options.max) return beats;
    if (options.signal?.aborted) return beats;
    await delay(intervalMs, options.signal);
    if (options.signal?.aborted) return beats;
  }
}
