// Objective-loop tick — IMPERATIVE SHELL.
//
// Gathers inputs via adapters, calls the PURE core `planLoopTick`, and (SLICE-1)
// only OBSERVES: it records a `loop.tick` event and returns the plan. It executes
// NO injection/relaunch/close yet — those land in the next slice behind the
// human-typing guard. This file must NOT import `@sentropic/h2a-runtime`
// (only `adapters.ts` may); `remote-facade.test.js` enforces it.

import { appendLoopEvent, readObjectiveLoop } from "../index.js";
import { planLoopTick, type TickPlan } from "./decision.js";
import { buildActionSink, readAgents, readInbox, readPresenceSnapshot, readRefsRollup } from "./adapters.js";
import { executePlan, type ExecReport } from "./execute.js";

export interface RunTickResult {
  readonly plan: TickPlan;
  readonly exec?: ExecReport;
}

const TERMINAL_LOOP_STATUSES = new Set(["done", "failed", "cancelled", "stopped"]);

function loopIsTerminal(root: string, loopId: string): boolean {
  try {
    return TERMINAL_LOOP_STATUSES.has(readObjectiveLoop(root, loopId).status);
  } catch {
    return true;
  }
}

/**
 * One tick: gather → decide → record observation → return the plan. DRY-RUN by
 * default (executes nothing). With `execute:true`, runs the plan through the
 * action sink (tranche 1: only `close` acts; a `degraded` plan executes nothing).
 */
export async function runTick(
  root: string,
  loopId: string,
  opts: { now?: number; execute?: boolean } = {},
): Promise<RunTickResult> {
  const now = opts.now ?? Date.now();
  const loop = readObjectiveLoop(root, loopId); // throws if missing → shell maps to exit code
  const plan: TickPlan = loop.status === "stopped"
    ? {
        loopId,
        degraded: false,
        outcome: "stopped",
        close: false,
        actions: [],
        reasons: ["loop is stopped"]
      }
    : planLoopTick({
        loop,
        agents: await readAgents(),
        presence: readPresenceSnapshot(root, now),
        refs: readRefsRollup(loop),
        inbox: readInbox(loop, root),
        now
      });

  appendLoopEvent(root, {
    type: "loop.tick",
    loopId,
    at: new Date(now).toISOString(),
    payload: {
      outcome: plan.outcome,
      degraded: plan.degraded,
      actions: plan.actions.map((a) => a.type),
      dryRun: !opts.execute,
    },
  });

  if (!opts.execute) return { plan };
  const exec = await executePlan(root, loopId, plan, buildActionSink(), now);
  return { plan, exec };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res) => {
    if (signal?.aborted) return res();
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      res();
    }, { once: true });
  });
}

export interface WatchOptions {
  readonly intervalMs?: number;
  readonly max?: number;
  readonly execute?: boolean;
  readonly signal?: AbortSignal;
  readonly stdout: { write(s: string): void };
}

/** Periodic objective-loop runner. MVP requirement: while the loop is not
 * terminal/done, each beat must execute guarded relance actions by default so
 * agents do not silently stall. `--dry-run` is the opt-in observation mode. The
 * cadence defaults to the loop policy (`policy.tickMs`) and can be overridden by
 * `--interval-ms` for operators adapting the loop to the enjeu. */
export async function runLoopWatch(
  root: string,
  loopId: string,
  opts: WatchOptions,
): Promise<number> {
  let n = 0;
  for (;;) {
    const loop = readObjectiveLoop(root, loopId);
    const interval = opts.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : loop.policy.tickMs;
    const execute = opts.execute !== false;
    const result = await runTick(root, loopId, { execute });
    opts.stdout.write(`${JSON.stringify(result.exec ? { ...result.plan, exec: result.exec } : result.plan)}\n`);
    n += 1;
    if (loopIsTerminal(root, loopId)) return 0;
    if (opts.max !== undefined && n >= opts.max) return 0;
    if (opts.signal?.aborted) return 0;
    await delay(interval, opts.signal);
    if (opts.signal?.aborted) return 0;
  }
}
