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

export interface PresenceView {
  readonly instance: string;
  readonly liveSession: boolean;
  readonly hasTmuxLaunchContext: boolean;
  /** Drumbeat self-declared work status (DEC-084): working | paused | done |
   *  blocked | out-of-tokens. Optional (only set when the agent records it). */
  readonly workStatus?: string;
  /** Epoch ms of the last MCP activity (from `lastMcpActivityAt`). Proxy for
   *  "the agent is doing work via tool calls" vs "silent/waiting". */
  readonly lastActivityAtMs?: number;
}

export interface PresenceSnapshot {
  readonly byInstance: ReadonlyMap<string, PresenceView>;
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
  readonly presence: PresenceSnapshot;
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
  readonly degradedSources?: {
    readonly agents: boolean;
    readonly refs: boolean;
  };
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

/** h2a addressing is case-insensitive/slug-stable (0.40.0) — fold the key so an
 *  enrolment whose casing differs from the presence record still matches. The
 *  adapter keys `byInstance` with the same fold. */
function foldInstance(instance: string): string {
  return instance.toLowerCase();
}

function findPresence(
  loopAgent: H2AObjectiveLoop["agents"][number],
  presence: PresenceSnapshot,
): PresenceView | undefined {
  return loopAgent.h2aInstance === undefined
    ? undefined
    : presence.byInstance.get(foldInstance(loopAgent.h2aInstance));
}

function presenceCanWake(presence: PresenceView | undefined): boolean {
  return presence?.liveSession === true && presence.hasTmuxLaunchContext === true;
}

/**
 * R3 gate (double-consensus Fable5 + Codex-5.5-xhigh, 2026-07-09): a live,
 * tmux-wakeable presence is NOT sufficient to wake — presence proves liveness,
 * not idleness. Waking an agent that is actively mid-tool-call is a real (bounded)
 * hazard the human-typing guard does not cover. Require independent idle/stall
 * evidence before a presence-driven wake:
 *  - `workStatus === working|blocked|done` → never wake (busy / not a relance target);
 *  - `workStatus === paused|out-of-tokens`  → wake (explicit relance candidate);
 *  - otherwise → wake only if MCP activity has been silent longer than `idleMs`.
 * Unknown status + recent activity ⇒ noop (do not over-wake). Pure: uses `now` +
 * `idleMs` passed as data (both already in TickInput / loop.policy).
 */
function presenceIdleEnoughToWake(presence: PresenceView, now: number, idleMs: number): boolean {
  const ws = presence.workStatus;
  if (ws === "working" || ws === "blocked" || ws === "done") return false;
  if (ws === "paused" || ws === "out-of-tokens") return true;
  if (presence.lastActivityAtMs === undefined) return false; // can't prove idle → do not over-wake
  return now - presence.lastActivityAtMs > idleMs;
}

/**
 * Pure objective-loop tick decision. Deterministic; no IO. Implements the spec
 * (2026-06-26 §Relaunch + §C completion) at MVP scope: degraded short-circuit,
 * multi-ref completion rollup, and conservative launch/wake/route intents.
 *
 * The shell never auto-closes unless `close===true` (policy.closeWhenRefsSatisfied).
 */
export function planLoopTick(input: TickInput): TickPlan {
  const { loop, agents, presence, refs, inbox } = input;
  const reasons: string[] = [];
  const actions: TickAction[] = [];

  // 1) DEGRADED — track refs are closure-critical, so a degraded track source
  //    remains a hard safety stop. A degraded runtime projection is softer:
  //    presence is an independent source and may still prove a live tmux-wakeable
  //    session. The shell uses `degradedSources.refs` as the no-execute guard.
  if (refs.degraded) {
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
    return {
      loopId: loop.id,
      degraded: true,
      degradedSources: { agents: agents.degraded, refs: true },
      outcome: "degraded",
      close: false,
      actions,
      reasons
    };
  }

  if (agents.degraded) {
    reasons.push("agents source unreachable (runtime absent/degraded); evaluating presence-only wake path");
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
  // Advisory gates still reach the owner stack, but do not stop the loop's
  // work-progress outcome. All-go-or-waived gates remain blocking.
  const blockingDecisionGates = loop.policy.decisionGatePolicy === "advisory-only"
    ? []
    : openDecisionGates;
  const hasOpenDecision = inbox.pendingDecisions.length > 0 || blockingDecisionGates.length > 0;

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

  // An empty loop is recoverable through join, but it is not healthy progress.
  // Preserve stronger ref/decision outcomes (failed, blocker-stalled,
  // waiting-human, eligible-for-close); only replace a progress-waiting/running
  // projection. Do NOT persist a terminal status: a later join recovers it.
  if (loop.agents.length === 0 && (outcome === "running" || outcome === "waiting-agent")) {
    outcome = "stalled";
    reasons.push("no agents enrolled; call h2a_loop_join (or report with explicit autoJoin:true and instance)");
  }

  // 4) DECISIONS — surface pending human decisions (route only; no injection here).
  if (outcome !== "failed") {
    for (const ref of openDecisionGates) {
      // A persisted legacy ref without structured payload remains visible as
      // waiting-human, but cannot honestly be materialized as a blank Track
      // card. New decision-gate refs carry this shape at creation time.
      if (ref.decisionGate === undefined) {
        reasons.push(`decision gate ${loopRefLocator(ref)} has no structured payload`);
        continue;
      }
      actions.push(
        action({
          type: "route-decision",
          decisionId: ref.decisionGate.id,
          refLocator: loopRefLocator(ref),
          reason: "open decision gate",
        }),
      );
    }
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
      const projected = agents.degraded ? undefined : findProjected(a, agents.agents);
      const livePresence = findPresence(a, presence);
      if (presenceCanWake(livePresence)) {
        // Presence proves the agent is reachable; the R3 gate proves it is
        // idle/stalled (not mid-work) BEFORE we inject. A present-but-busy agent
        // is left alone (noop) — no wake, no launch.
        if (
          (!projected || DEAD_STATES.has(projected.state) || IDLE_STATES.has(projected.state)) &&
          presenceIdleEnoughToWake(livePresence as PresenceView, input.now, loop.policy.idleMs)
        ) {
          actions.push(action({ type: "wake", agentId: a.id, reason: "agent idle/stalled in h2a presence while work pending" }));
        }
        continue;
      }
      // Live on the bus but NOT tmux-wakeable (no launchContext.tmux): it is not
      // "missing/dead" — do not emit a false request-launch (which would burn the
      // relance budget for a live agent). Leave it as a noop.
      if (livePresence?.liveSession === true) {
        continue;
      }
      if (!projected || DEAD_STATES.has(projected.state)) {
        if (agents.degraded) continue;
        if (a.launch === undefined) {
          reasons.push(`agent ${a.id} is missing/dead but has no complete launch spec`);
          continue;
        }
        actions.push(
          action({ type: "request-launch", agentId: a.id, reason: "enrolled agent missing/dead while work pending" }),
        );
        continue;
      }
      if (IDLE_STATES.has(projected.state)) {
        actions.push(action({ type: "wake", agentId: a.id, reason: "agent idle while work pending" }));
      }
    }
  }

  if (actions.length === 0) {
    actions.push(action({
      type: "noop",
      reason: loop.agents.length === 0
        ? "no agents enrolled; join with h2a_loop_join"
        : reasons.at(-1) ?? "nothing to do this tick"
    }));
  }

  return {
    loopId: loop.id,
    degraded: agents.degraded,
    ...(agents.degraded ? { degradedSources: { agents: true, refs: false } } : {}),
    outcome,
    close,
    actions,
    reasons
  };
}
