// Objective-loop tick — PURE decision core.
//
// GOLDEN RULE: this module has ZERO IO and NEVER imports `@sentropic/h2a-runtime`,
// node-pty, tmux, k8s or the track CLI. It only sees plain data. The imperative
// shell (`tick.ts`) gathers inputs via adapters and EXECUTES the plan — the
// human-typing guard is re-checked there, at the last moment before any tmux
// injection, NOT here (the core's view can be stale).
//
// Double-consensus (opus-4-8 + codex xhigh, 2026-07-02): option (c) —
// functional core / imperative shell. `remote-facade.test.js` scans this file to
// forbid any runtime import (see RISK #1).

import type { H2AObjectiveLoop, H2ALoopTrackRef } from "../index.js";

// --- Local mirror of the runtime `remote-agents-list` envelope (v1) ----------
// We keep a LOCAL type (never import the runtime type) and carry `version` so the
// shell can flag drift. Only the fields the core reasons about are mirrored.
export interface ProjectedAgent {
  readonly id: string;
  readonly tool: string;
  readonly state: string; // running | idle | throttled | done | failed | attached | detached | live | pending
  readonly cwd: string;
  readonly tmuxSession?: string;
  readonly jobId?: string;
  readonly h2aInstance?: string;
  readonly capabilities: {
    readonly attach: boolean;
    readonly logs: boolean;
    readonly remote: boolean;
  };
}

export interface AgentsSnapshot {
  readonly degraded: boolean; // true when the runtime was unreachable
  readonly version?: number;
  readonly agents: readonly ProjectedAgent[];
}

export type RefStatus =
  | "accepted"
  | "done"
  | "pending"
  | "rejected"
  | "blocked"
  | "stale"
  | "unknown";

export interface RolledRef {
  readonly locator: string; // stable key, must equal loopRefLocator(ref)
  readonly status: RefStatus;
}

export interface RefsRollup {
  readonly degraded: boolean; // true when the track source was unreachable
  readonly refs: readonly RolledRef[];
}

export interface PendingDecision {
  readonly id: string;
  readonly forAgent?: string;
}

export interface InboxSnapshot {
  readonly pendingDecisions: readonly PendingDecision[];
}

export interface TickInput {
  readonly loop: H2AObjectiveLoop;
  readonly agents: AgentsSnapshot;
  readonly refs: RefsRollup;
  readonly inbox: InboxSnapshot;
  readonly now: number;
}

export type TickActionType =
  | "request-launch"
  | "wake"
  | "route-decision"
  | "close"
  | "noop";

export interface TickAction {
  readonly type: TickActionType;
  readonly reason: string;
  readonly agentId?: string; // loop agent id
  readonly refLocator?: string;
  readonly decisionId?: string;
}

export type TickOutcome =
  | "running"
  | "waiting-human"
  | "waiting-agent"
  | "stalled"
  | "degraded"
  | "eligible-for-close"
  | "stopped"
  | "failed";

export interface TickPlan {
  readonly loopId: string;
  readonly degraded: boolean;
  readonly outcome: TickOutcome;
  readonly close: boolean; // shell may write loop.status=done only if this is true
  readonly actions: readonly TickAction[];
  readonly reasons: readonly string[];
}

const TARGET_ROLES = new Set(["primary", "target"]);

/** Stable join key for a declared loop track-ref. Adapters MUST use the same. */
export function loopRefLocator(ref: H2ALoopTrackRef): string {
  return `${ref.system}:${ref.repoKey}:${ref.workspace}:${ref.aggregateKind}:${ref.aggregateId}`;
}

function action(a: TickAction): TickAction {
  return a;
}

/** True if the loop agent is present & not dead in the runtime projection. */
function findProjected(
  loopAgent: H2AObjectiveLoop["agents"][number],
  projected: readonly ProjectedAgent[],
): ProjectedAgent | undefined {
  return projected.find(
    (p) =>
      (loopAgent.h2aInstance !== undefined && p.h2aInstance === loopAgent.h2aInstance) ||
      (loopAgent.remoteJobId !== undefined && p.jobId === loopAgent.remoteJobId) ||
      (loopAgent.remoteAgentId !== undefined && p.id === loopAgent.remoteAgentId),
  );
}

const DEAD_STATES = new Set(["dead", "failed", "done"]);
const IDLE_STATES = new Set(["idle", "detached"]);

/**
 * Pure objective-loop tick decision. Deterministic; no IO. Implements the spec
 * (2026-06-26 §Relaunch + §C completion) at MVP scope: degraded short-circuit,
 * multi-ref completion rollup, and conservative launch/wake/route intents.
 *
 * The shell never auto-closes unless `close===true` (policy.closeWhenRefsSatisfied).
 */
export function planLoopTick(input: TickInput): TickPlan {
  const { loop, agents, refs, inbox } = input;
  const reasons: string[] = [];
  const actions: TickAction[] = [];

  // 1) DEGRADED — runtime or track source unreachable. Never invent state, never
  //    inject, never close. Only surface pending human decisions (no injection).
  if (agents.degraded || refs.degraded) {
    if (agents.degraded) reasons.push("agents source unreachable (runtime absent/degraded)");
    if (refs.degraded) reasons.push("track refs source unreachable");
    for (const d of inbox.pendingDecisions) {
      actions.push(
        action({
          type: "route-decision",
          decisionId: d.id,
          reason: "pending decision surfaced while degraded",
          ...(d.forAgent !== undefined ? { agentId: d.forAgent } : {}),
        }),
      );
    }
    return { loopId: loop.id, degraded: true, outcome: "degraded", close: false, actions, reasons };
  }

  // 2) REF ROLLUP — join declared loop.refs with the rollup statuses.
  const statusByLocator = new Map(refs.refs.map((r) => [r.locator, r.status] as const));
  const statusOf = (ref: H2ALoopTrackRef): RefStatus =>
    statusByLocator.get(loopRefLocator(ref)) ?? "unknown";

  const targetRefs = loop.refs.filter((r) => TARGET_ROLES.has(r.role));
  const blockerRefs = loop.refs.filter((r) => r.role === "blocker");
  const decisionGateRefs = loop.refs.filter((r) => r.role === "decision-gate");

  const targetStatuses = targetRefs.map(statusOf);
  const anyTargetRejected = targetStatuses.includes("rejected");
  const anyTargetUnresolved = targetStatuses.some((s) =>
    s === "pending" || s === "unknown" || s === "stale" || s === "blocked",
  );
  const allTargetsSatisfied =
    targetRefs.length > 0 && targetStatuses.every((s) => s === "accepted" || s === "done");

  const openBlockers = blockerRefs.filter((r) => {
    const s = statusOf(r);
    return s !== "done" && s !== "accepted";
  });
  const openDecisionGates = decisionGateRefs.filter((r) => {
    const s = statusOf(r);
    return s !== "accepted" && s !== "done";
  });
  const hasOpenDecision = inbox.pendingDecisions.length > 0 || openDecisionGates.length > 0;

  const workPending = !allTargetsSatisfied;

  // 3) OUTCOME — deterministic precedence (spec §C).
  let outcome: TickOutcome;
  let close = false;

  if (anyTargetRejected) {
    outcome = "failed";
    reasons.push("a primary/target ref is rejected/failed");
  } else if (openBlockers.length > 0) {
    outcome = "stalled";
    reasons.push(`${openBlockers.length} open blocker ref(s)`);
  } else if (hasOpenDecision) {
    outcome = "waiting-human";
    reasons.push("open decision gate(s) / pending decision(s)");
  } else if (allTargetsSatisfied) {
    outcome = "eligible-for-close";
    reasons.push("all primary/target refs accepted/done");
    close = loop.policy.closeWhenRefsSatisfied === true;
    if (close) actions.push(action({ type: "close", reason: "refs satisfied and policy.closeWhenRefsSatisfied" }));
  } else if (anyTargetUnresolved) {
    outcome = "waiting-agent";
    reasons.push("primary/target refs still pending");
  } else if (targetRefs.length === 0) {
    outcome = "running";
    reasons.push("no primary/target refs declared");
  } else {
    outcome = "running";
  }

  // 4) DECISIONS — surface pending human decisions (route only; no injection here).
  if (outcome !== "failed") {
    for (const d of inbox.pendingDecisions) {
      actions.push(
        action({
          type: "route-decision",
          decisionId: d.id,
          reason: "pending decision",
          ...(d.forAgent !== undefined ? { agentId: d.forAgent } : {}),
        }),
      );
    }
  }

  // 5) AGENTS — conservative launch/wake INTENTS, only when work is pending and
  //    the objective is not failed/closing. The shell decides feasibility +
  //    re-checks the human-typing guard before any real injection.
  if (workPending && outcome !== "failed" && !close) {
    for (const a of loop.agents) {
      if (a.status === "done" || a.status === "cancelled" || a.status === "failed") continue;
      const projected = findProjected(a, agents.agents);
      if (!projected || DEAD_STATES.has(projected.state)) {
        actions.push(
          action({ type: "request-launch", agentId: a.id, reason: "enrolled agent missing/dead while work pending" }),
        );
        continue;
      }
      if (IDLE_STATES.has(projected.state) || a.status === "idle") {
        actions.push(action({ type: "wake", agentId: a.id, reason: "agent idle while work pending" }));
      }
    }
  }

  if (actions.length === 0) actions.push(action({ type: "noop", reason: "nothing to do this tick" }));

  return { loopId: loop.id, degraded: false, outcome, close, actions, reasons };
}
