// Objective-loop tick — ACTION EXECUTOR (imperative shell).
//
// Thin orchestrator: takes a decided `TickPlan` + an injected `ActionSink`, runs
// each action through the sink, and records a per-action event. It performs NO
// tmux/store IO itself (only `appendLoopEvent`) — all effects live behind the
// sink (real impl in `adapters.ts::buildActionSink`, fakes in tests). Must NOT
// import `@sentropic/h2a-runtime` (only `adapters.ts` may); the golden-rule scan
// enforces it.
//
// Double-consensus (opus-4-8 + codex xhigh, 2026-07-02): tranche 1 executes ONLY
// `close`; wake/request-launch/route-decision are wired to the sink but return
// `skipped` ("not-enabled") until their guarded slices land. A `degraded` plan
// executes NOTHING.

import { appendLoopEvent } from "../index.js";
import type { TickAction, TickPlan } from "./decision.js";

export type ActionOutcome = "done" | "deferred" | "skipped" | "failed";

export interface ActionContext {
  readonly root: string;
  readonly loopId: string;
  readonly now: number;
}

export interface ActionSink {
  close(action: TickAction, ctx: ActionContext): Promise<ActionOutcome>;
  requestLaunch(action: TickAction, ctx: ActionContext): Promise<ActionOutcome>;
  wake(action: TickAction, ctx: ActionContext): Promise<ActionOutcome>;
  routeDecision(action: TickAction, ctx: ActionContext): Promise<ActionOutcome>;
}

export interface ActionResult {
  readonly type: TickAction["type"];
  readonly agentId?: string;
  readonly outcome: ActionOutcome;
  readonly reason: string;
}

export interface ExecReport {
  readonly loopId: string;
  readonly executed: boolean;
  readonly results: readonly ActionResult[];
  readonly counts: Record<ActionOutcome, number>;
}

/** Stable idempotency key for an action (used by sinks + event journal). */
export function actionKey(a: TickAction, loopId: string): string {
  return `${a.type}:${a.agentId ?? a.decisionId ?? a.refLocator ?? loopId}`;
}

const EVENT_FOR: Record<ActionOutcome, string> = {
  done: "loop.action.applied",
  deferred: "loop.action.deferred",
  failed: "loop.action.failed",
  skipped: "loop.action.skipped"
};

/**
 * Execute a plan through the sink. A `degraded` plan runs NOTHING (safety). Each
 * executed action appends a `loop.action.*` event. Returns a typed report.
 */
export async function executePlan(
  root: string,
  loopId: string,
  plan: TickPlan,
  sink: ActionSink,
  now: number
): Promise<ExecReport> {
  const ctx: ActionContext = { root, loopId, now };
  const results: ActionResult[] = [];
  const counts: Record<ActionOutcome, number> = { done: 0, deferred: 0, skipped: 0, failed: 0 };
  const at = new Date(now).toISOString();

  const actions = plan.degraded ? [] : plan.actions;
  for (const a of actions) {
    let outcome: ActionOutcome;
    switch (a.type) {
      case "close":
        outcome = await sink.close(a, ctx);
        break;
      case "request-launch":
        outcome = await sink.requestLaunch(a, ctx);
        break;
      case "wake":
        outcome = await sink.wake(a, ctx);
        break;
      case "route-decision":
        outcome = await sink.routeDecision(a, ctx);
        break;
      default:
        continue; // noop
    }
    counts[outcome] += 1;
    results.push({
      type: a.type,
      ...(a.agentId !== undefined ? { agentId: a.agentId } : {}),
      outcome,
      reason: a.reason
    });
    appendLoopEvent(root, {
      type: EVENT_FOR[outcome],
      loopId,
      at,
      payload: { action: a.type, key: actionKey(a, loopId), reason: a.reason }
    });
  }

  return { loopId, executed: true, results, counts };
}
