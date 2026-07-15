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

export interface ActionEffect {
  readonly outcome: ActionOutcome;
  readonly detail?: string;
  /** False means the external result is ambiguous/incompatible; never retry blindly. */
  readonly retrySafe?: boolean;
}

export type ActionEffectResult = ActionOutcome | ActionEffect;

export interface ActionContext {
  readonly root: string;
  readonly loopId: string;
  readonly now: number;
}

export interface ActionSink {
  close(action: TickAction, ctx: ActionContext): Promise<ActionEffectResult>;
  requestLaunch(action: TickAction, ctx: ActionContext): Promise<ActionEffectResult>;
  wake(action: TickAction, ctx: ActionContext): Promise<ActionEffectResult>;
  routeDecision(action: TickAction, ctx: ActionContext): Promise<ActionEffectResult>;
}

export interface ActionResult {
  readonly type: TickAction["type"];
  readonly agentId?: string;
  readonly outcome: ActionOutcome;
  readonly reason: string;
  readonly detail?: string;
  readonly retrySafe?: boolean;
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
 * Execute a plan through the sink. A track-degraded plan runs NOTHING (safety).
 * Runtime-agent degradation alone can still execute presence-proven wakes. Each
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

  const refsDegraded = plan.degradedSources?.refs === true;
  const legacyDegradedWithoutSources = plan.degraded && plan.degradedSources === undefined;
  const actions = refsDegraded || legacyDegradedWithoutSources ? [] : plan.actions;
  for (const a of actions) {
    let effect: ActionEffectResult;
    switch (a.type) {
      case "close":
        effect = await sink.close(a, ctx);
        break;
      case "request-launch":
        effect = await sink.requestLaunch(a, ctx);
        break;
      case "wake":
        effect = await sink.wake(a, ctx);
        break;
      case "route-decision":
        effect = await sink.routeDecision(a, ctx);
        break;
      default:
        continue; // noop
    }
    const normalized: ActionEffect = typeof effect === "string" ? { outcome: effect } : effect;
    const outcome = normalized.outcome;
    counts[outcome] += 1;
    results.push({
      type: a.type,
      ...(a.agentId !== undefined ? { agentId: a.agentId } : {}),
      outcome,
      reason: a.reason,
      ...(normalized.detail !== undefined ? { detail: normalized.detail } : {}),
      ...(normalized.retrySafe !== undefined ? { retrySafe: normalized.retrySafe } : {})
    });
    appendLoopEvent(root, {
      type: EVENT_FOR[outcome],
      loopId,
      at,
      payload: {
        action: a.type,
        key: actionKey(a, loopId),
        reason: a.reason,
        ...(normalized.detail !== undefined ? { detail: normalized.detail } : {}),
        ...(normalized.retrySafe !== undefined ? { retrySafe: normalized.retrySafe } : {})
      }
    });
  }

  return { loopId, executed: true, results, counts };
}
