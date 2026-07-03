// Objective-loop tick — IO ADAPTERS (imperative shell).
//
// This is the ONLY loop-engine file allowed to reach `@sentropic/h2a-runtime`
// (lazy import). `decision.ts` and `tick.ts` stay runtime-free; the golden-rule
// scan in `remote-facade.test.js` enforces it. Consuming the TYPED projection
// (not parsed CLI stdout) is a double-consensus ruling (2026-07-02).

import { spawnSync } from "node:child_process";

import type { H2ALaunchContext } from "../../../session.js";
import { localTmuxDriver } from "../../drive/index.js";
import { createLocalStore } from "../../local-files/store.js";
import { listPresence } from "../../local-files/presence.js";
import { listLoopEvents, readObjectiveLoop, updateObjectiveLoopStatus, type H2AObjectiveLoop } from "../index.js";
import { loopRefLocator, type AgentsSnapshot, type InboxSnapshot, type PendingDecision, type ProjectedAgent, type RefsRollup, type RefStatus } from "./decision.js";
import type { ActionSink } from "./execute.js";

// --- Agents adapter (lazy runtime; degraded-clean on absence/failure) ---------
export async function readAgents(): Promise<AgentsSnapshot> {
  // Variable-typed specifier defeats tsc static resolution: `@sentropic/h2a`
  // must NEVER hard-depend on the heavy runtime (same trick as bin.ts).
  const RUNTIME_PKG: string = "@sentropic/h2a-runtime";
  try {
    const rt = (await import(RUNTIME_PKG)) as {
      projectAgentsForH2a?: () => { version?: number; agents?: unknown[] };
    };
    if (typeof rt.projectAgentsForH2a !== "function") {
      return { degraded: true, agents: [] };
    }
    const env = rt.projectAgentsForH2a();
    const agents = Array.isArray(env.agents) ? (env.agents as ProjectedAgent[]) : [];
    return {
      degraded: false,
      ...(typeof env.version === "number" ? { version: env.version } : {}),
      agents,
    };
  } catch {
    // Runtime not installed or failed → degraded; NEVER invent agent state.
    return { degraded: true, agents: [] };
  }
}

// --- Track refs rollup adapter (READ-ONLY; single-writer preserved) -----------
// Resolves each declared loop ref to a status via the `track` CLI read seam
// (`track query --format json`, one query per loop repo, indexed by id). No
// writes → the append-only single-writer contract is never touched. Track absent
// / no repo answered → `degraded:true` (the pure core then never auto-closes).

/** Shape of a `track query --format json` row we consume. */
interface TrackQueryRow {
  readonly id?: string;
  readonly bucket?: string;
  readonly realization?: string;
  readonly acceptance?: string;
}

/**
 * PURE mapping: a track item's (bucket, realization, acceptance) → loop RefStatus.
 * Buckets: AWAITED | DROPPED | DONE | TO-DO. Conservative + unit-tested so the
 * semantics stay explicit and easy to tune. Unknown/missing → "unknown" (the
 * core treats that as NOT satisfied → never auto-closes on it).
 */
export function mapTrackAggregateToRefStatus(item: TrackQueryRow | undefined): RefStatus {
  if (!item) return "unknown";
  const bucket = (item.bucket ?? "").toUpperCase();
  const acceptance = (item.acceptance ?? "").toLowerCase();
  const realization = (item.realization ?? "").toLowerCase();
  if (bucket === "DONE") {
    return acceptance === "accepted" || acceptance === "pass" ? "accepted" : "done";
  }
  if (bucket === "DROPPED" || realization === "cancelled") return "rejected";
  if (bucket === "AWAITED" || bucket === "TO-DO") return "pending";
  return "unknown";
}

export function readRefsRollup(loop: H2AObjectiveLoop): RefsRollup {
  // No refs declared → nothing to resolve; not degraded (no track call).
  if (loop.refs.length === 0) return { degraded: false, refs: [] };

  const cwds = loop.repos.map((r) => r.path).filter((p): p is string => !!p);
  if (cwds.length === 0) cwds.push(process.cwd());

  const itemsById = new Map<string, TrackQueryRow>();
  let anyQueryOk = false;
  for (const cwd of cwds) {
    const res = spawnSync("track", ["query", "--format", "json"], { cwd, encoding: "utf8" });
    if (res.error || res.status !== 0 || !res.stdout) continue;
    try {
      const rows = JSON.parse(res.stdout) as unknown;
      if (Array.isArray(rows)) {
        anyQueryOk = true;
        for (const row of rows as TrackQueryRow[]) {
          if (row && typeof row.id === "string") itemsById.set(row.id, row);
        }
      }
    } catch {
      // non-JSON output → ignore this repo
    }
  }

  // `track` unreachable in every repo → degraded (do not invent ref state).
  if (!anyQueryOk) return { degraded: true, refs: [] };

  return {
    degraded: false,
    refs: loop.refs.map((r) => ({
      locator: loopRefLocator(r),
      status: mapTrackAggregateToRefStatus(itemsById.get(r.aggregateId)),
    })),
  };
}

// --- Inbox adapter (READ-ONLY) ------------------------------------------------
// The h2a bus is a negotiation protocol (register/propose/accept/reject/counter/
// withdraw/event/escalate). The clearest "needs a human/agent decision" signal is
// an `escalate` envelope sitting in an enrolled agent's inbox. We surface those as
// pending decisions so the loop reports `waiting-human` and routes them.
// TODO(next): also correlate unresolved `propose` (no matching accept/reject).

/** PURE: escalations in an inbox → pending decisions for `agentId`. */
export function pendingDecisionsFromInbox(
  envelopes: readonly { readonly id: string; readonly type: string }[],
  agentId: string,
): PendingDecision[] {
  return envelopes
    .filter((e) => e.type === "escalate")
    .map((e) => ({ id: e.id, forAgent: agentId }));
}

export function readInbox(loop: H2AObjectiveLoop, root: string): InboxSnapshot {
  const enrolled = loop.agents
    .map((a) => ({ agentId: a.id, instance: a.h2aInstance }))
    .filter((x): x is { agentId: string; instance: string } => typeof x.instance === "string");
  if (enrolled.length === 0) return { pendingDecisions: [] };

  let store: ReturnType<typeof createLocalStore>;
  try {
    store = createLocalStore({ root });
  } catch {
    return { pendingDecisions: [] };
  }

  const pending: PendingDecision[] = [];
  const seen = new Set<string>();
  for (const { agentId, instance } of enrolled) {
    let envelopes: Array<{ id: string; type: string }>;
    try {
      envelopes = store.readInbox(instance) as Array<{ id: string; type: string }>;
    } catch {
      continue;
    }
    for (const d of pendingDecisionsFromInbox(envelopes, agentId)) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        pending.push(d);
      }
    }
  }
  return { pendingDecisions: pending };
}

// --- Wake targeting (PURE decision; the tmux send is delegated to the driver) --
export type WakePlan =
  | {
      readonly kind: "wake";
      readonly instance: string;
      readonly host?: string;
      readonly launchContext: H2ALaunchContext;
      readonly instructionLine: string;
    }
  | { readonly kind: "skip"; readonly reason: string };

const WAKE_COOLDOWN_FLOOR_MS = 300_000; // 5 min

/**
 * PURE: given the loop, a target agent id, the FRESH sessions (already
 * expiry-filtered by listPresence) and prior wake timestamps, decide whether to
 * wake (and with what launchContext/line) or skip (and why). No IO. Freshness +
 * cooldown are the safety gates BEFORE the driver's own human-typing guard.
 */
export function planWakeTarget(input: {
  readonly loop: H2AObjectiveLoop;
  readonly agentId: string;
  readonly freshSessions: readonly { readonly instance: string; readonly launchContext?: H2ALaunchContext }[];
  readonly priorWakeAtByAgent: ReadonlyMap<string, number>;
  readonly now: number;
}): WakePlan {
  const agent = input.loop.agents.find((a) => a.id === input.agentId);
  if (!agent || agent.h2aInstance === undefined) return { kind: "skip", reason: "no-h2a-instance" };
  const cooldownMs = Math.max(input.loop.policy.tickMs, WAKE_COOLDOWN_FLOOR_MS);
  const last = input.priorWakeAtByAgent.get(input.agentId);
  if (last !== undefined && input.now - last < cooldownMs) return { kind: "skip", reason: "cooldown" };
  const session = input.freshSessions.find((s) => s.instance === agent.h2aInstance);
  if (!session || !session.launchContext || !session.launchContext.tmux) {
    return { kind: "skip", reason: "no-fresh-tmux-session" };
  }
  const instructionLine =
    `[h2a-wake reason=loop loopId=${input.loop.id} at=${new Date(input.now).toISOString()}] ` +
    `reprends l'objectif: ${input.loop.goal}`;
  return {
    kind: "wake",
    instance: agent.h2aInstance,
    ...(agent.host !== undefined ? { host: agent.host } : {}),
    launchContext: session.launchContext,
    instructionLine
  };
}

/** PURE: latest applied-wake epoch ms per agent, from the loop event journal. */
export function priorWakeAtByAgent(
  events: readonly { readonly type: string; readonly at: string; readonly payload?: unknown }[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "loop.action.applied") continue;
    const p = e.payload as { action?: string; key?: string } | undefined;
    if (!p || p.action !== "wake" || typeof p.key !== "string" || !p.key.startsWith("wake:")) continue;
    const agentId = p.key.slice("wake:".length);
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) continue;
    const prev = out.get(agentId);
    if (prev === undefined || at > prev) out.set(agentId, at);
  }
  return out;
}

// --- Action sink (effects for `--execute`) ------------------------------------
// `close` = idempotent store status flip (ZERO injection). `wake` = fresh-session
// + cooldown gated localTmuxDriver (which re-checks the human-typing guard at the
// last moment; defer → "deferred", stays pending). request-launch / route-decision
// still `skipped` (their guarded slices land next). NEVER chain/headless/auto — a
// defer must not fall back to a headless injection (double-consensus RISK #1).
export function buildActionSink(): ActionSink {
  return {
    async close(_action, ctx) {
      const { changed } = updateObjectiveLoopStatus(ctx.root, ctx.loopId, "done", {
        now: ctx.now,
        reason: "objective-loop tick: all primary/target refs satisfied"
      });
      return changed ? "done" : "skipped";
    },
    async requestLaunch() {
      return "skipped";
    },
    async wake(action, ctx) {
      const loop = readObjectiveLoop(ctx.root, ctx.loopId);
      const freshSessions = listPresence(ctx.root, { now: ctx.now }).map((s) => ({
        instance: s.instance,
        ...(s.launchContext !== undefined ? { launchContext: s.launchContext } : {})
      }));
      const plan = planWakeTarget({
        loop,
        agentId: action.agentId ?? "",
        freshSessions,
        priorWakeAtByAgent: priorWakeAtByAgent(listLoopEvents(ctx.root, ctx.loopId)),
        now: ctx.now
      });
      if (plan.kind === "skip") return "skipped";
      // localTmuxDriver ONLY — never chain/headless/auto (RISK #1). It applies the
      // human-typing guard at the last moment and DEFERS (false) if a human is
      // active in the pane; a defer stays pending and re-fires next tick.
      const ok = await localTmuxDriver().drive({
        to: plan.instance,
        ...(plan.host !== undefined ? { host: plan.host } : {}),
        instructionLine: plan.instructionLine,
        launchContext: plan.launchContext
      });
      return ok ? "done" : "deferred";
    },
    async routeDecision() {
      return "skipped";
    }
  };
}
