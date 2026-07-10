// Objective-loop tick — IO ADAPTERS (imperative shell).
//
// This is the ONLY loop-engine file allowed to reach `@sentropic/h2a-runtime`
// (lazy import). `decision.ts` and `tick.ts` stay runtime-free; the golden-rule
// scan in `remote-facade.test.js` enforces it. Consuming the TYPED projection
// (not parsed CLI stdout) is a double-consensus ruling (2026-07-02).

import { spawnSync } from "node:child_process";

import type { H2ALaunchContext } from "../../../session.js";
import { localTmuxDriver, type H2ADriver } from "../../drive/index.js";
import { listDrumbeat, type H2ADrumbeatEntry } from "../../drumbeat/registry.js";
import { createLocalStore } from "../../local-files/store.js";
import { listPresence } from "../../local-files/presence.js";
import { listLoopEvents, readObjectiveLoop, updateObjectiveLoopStatus, type H2AObjectiveLoop } from "../index.js";
import { loopRefLocator, type AgentsSnapshot, type InboxSnapshot, type PendingDecision, type PresenceSnapshot, type PresenceView, type ProjectedAgent, type RefsRollup, type RefStatus } from "./decision.js";
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

// --- Presence adapter (independent of runtime agents projection) --------------
// Interactive Claude/Codex sessions are often present on the h2a bus without
// being runtime-launched agents. The pure core needs that presence as plain data
// so it can plan a wake instead of an ask-only launch request.

/**
 * Resolve the self-declared work status the pure R3 idle gate consumes. The
 * presence FILE never carries `workStatus`: the host stop hook records it in the
 * durable drumbeat REGISTRY (`h2a drumbeat record --status …` → `recordStop`),
 * NOT in presence (see drumbeat/registry.ts). Without folding the registry back
 * in, the R3 gate's `paused`/`out-of-tokens` fast-path is permanently dead and a
 * just-stopped agent is never relanced until 15 min of MCP silence — the bug
 * behind "the objective-loop does not relance like /loop".
 *
 * A durable stop entry is honored ONLY when it is not terminal (an
 * escalated/rerouted stop is resolved) AND has NOT been superseded by fresher MCP
 * activity: if the agent has made a tool call since it declared the stop
 * (`lastMcpActivityAt > stoppedAt`) it has resumed, so the sticky `paused` entry
 * must NOT re-wake it — that is exactly the over-wake the R3 gate guards against.
 * A live presence `workStatus` (should the presence layer ever set one) always
 * wins over the registry. PURE: timestamps in, status out.
 */
export function resolveDeclaredWorkStatus(
  entry: H2ADrumbeatEntry | undefined,
  lastActivityAtMs: number | undefined
): string | undefined {
  if (!entry || entry.terminal !== undefined) return undefined;
  const stoppedAtMs = Date.parse(entry.stoppedAt);
  if (Number.isNaN(stoppedAtMs)) return undefined;
  if (lastActivityAtMs !== undefined && lastActivityAtMs > stoppedAtMs) return undefined;
  return entry.workStatus;
}

export function readPresenceSnapshot(root: string, now: number): PresenceSnapshot {
  const byInstance = new Map<string, PresenceView>();
  // Fold the durable drumbeat stop registry (keyed case-insensitively, like h2a
  // addressing) so the pure core sees self-declared stop status as plain data.
  const stopByInstance = new Map<string, H2ADrumbeatEntry>();
  try {
    for (const entry of listDrumbeat(root)) stopByInstance.set(entry.instance.toLowerCase(), entry);
  } catch {
    // registry unreadable → no self-declared status; the activity gate still applies.
  }
  for (const session of listPresence(root, { now })) {
    const lastActivityAtMs =
      session.lastMcpActivityAt === undefined ? undefined : Date.parse(session.lastMcpActivityAt);
    const safeLastActivityAtMs =
      lastActivityAtMs !== undefined && !Number.isNaN(lastActivityAtMs) ? lastActivityAtMs : undefined;
    // Presence's own workStatus wins; otherwise fold in the durable stop registry.
    const workStatus =
      session.workStatus ??
      resolveDeclaredWorkStatus(stopByInstance.get(session.instance.toLowerCase()), safeLastActivityAtMs);
    const view: PresenceView = {
      instance: session.instance,
      liveSession: true,
      hasTmuxLaunchContext: session.launchContext?.tmux !== undefined,
      // Drumbeat self-declared status (DEC-084) feeds the R3 idle gate in the core.
      ...(workStatus !== undefined ? { workStatus } : {}),
      ...(safeLastActivityAtMs !== undefined ? { lastActivityAtMs: safeLastActivityAtMs } : {})
    };
    // Key by folded instance: h2a addressing is case-insensitive/slug-stable
    // (0.40.0), so an enrolment whose casing differs from the presence record
    // must still resolve. The decision core folds the lookup identically.
    const key = session.instance.toLowerCase();
    const existing = byInstance.get(key);
    if (existing?.hasTmuxLaunchContext === true && !view.hasTmuxLaunchContext) continue;
    if (
      existing?.hasTmuxLaunchContext === view.hasTmuxLaunchContext &&
      existing.lastActivityAtMs !== undefined &&
      (view.lastActivityAtMs === undefined || existing.lastActivityAtMs > view.lastActivityAtMs)
    ) {
      continue;
    }
    byInstance.set(key, view);
  }
  return { byInstance };
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
  const session = input.freshSessions.find(
    (s) => s.instance === agent.h2aInstance && s.launchContext?.tmux !== undefined
  );
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

// --- Launch request targeting (PURE; ASK not spawn) ---------------------------
export type LaunchPlan =
  | { readonly kind: "emit"; readonly host?: string; readonly reason: string }
  | { readonly kind: "skip"; readonly reason: string };

/**
 * PURE: decide whether to ASK for a launch of a missing enrolled agent. Bounded
 * by `policy.maxRelaunches` (stop asking after N) + a per-agent cooldown. h2a
 * ASKS (records in the loop journal / — later — an envelope to a remote); it
 * NEVER spawns arbitrary agents itself (spec objective-loop §Non-goals).
 */
export function planLaunchTarget(input: {
  readonly loop: H2AObjectiveLoop;
  readonly agentId: string;
  readonly priorCount: number;
  readonly priorLatestAt?: number;
  readonly now: number;
}): LaunchPlan {
  const agent = input.loop.agents.find((a) => a.id === input.agentId);
  if (!agent) return { kind: "skip", reason: "unknown-agent" };
  if (input.priorCount >= input.loop.policy.maxRelaunches) return { kind: "skip", reason: "max-relaunches" };
  const cooldownMs = Math.max(input.loop.policy.tickMs, WAKE_COOLDOWN_FLOOR_MS);
  if (input.priorLatestAt !== undefined && input.now - input.priorLatestAt < cooldownMs) {
    return { kind: "skip", reason: "cooldown" };
  }
  return {
    kind: "emit",
    ...(agent.host !== undefined ? { host: agent.host } : {}),
    reason: "enrolled agent missing while work pending"
  };
}

/** PURE: prior launch-request count + latest epoch ms per agent, from the journal. */
export function priorLaunchByAgent(
  events: readonly { readonly type: string; readonly at: string; readonly payload?: unknown }[]
): Map<string, { count: number; latestAt?: number }> {
  const out = new Map<string, { count: number; latestAt?: number }>();
  for (const e of events) {
    if (e.type !== "loop.action.applied") continue;
    const p = e.payload as { action?: string; key?: string } | undefined;
    if (!p || p.action !== "request-launch" || typeof p.key !== "string" || !p.key.startsWith("request-launch:")) {
      continue;
    }
    const agentId = p.key.slice("request-launch:".length);
    const at = Date.parse(e.at);
    const cur = out.get(agentId) ?? { count: 0 };
    cur.count += 1;
    if (!Number.isNaN(at) && (cur.latestAt === undefined || at > cur.latestAt)) cur.latestAt = at;
    out.set(agentId, cur);
  }
  return out;
}

// --- Action sink (effects for `--execute`) ------------------------------------
// `close` = idempotent store status flip (ZERO injection). `wake` = fresh-session
// + cooldown gated localTmuxDriver (which re-checks the human-typing guard at the
// last moment; defer → "deferred", stays pending). request-launch / route-decision
// still `skipped` (their guarded slices land next). NEVER chain/headless/auto — a
// defer must not fall back to a headless injection (double-consensus RISK #1).
export function buildActionSink(opts: { driver?: H2ADriver } = {}): ActionSink {
  // Injectable driver seam: production defaults to the guarded local-tmux driver
  // (which re-checks the human-typing guard at the last moment). Tests pass a fake
  // driver so the wake glue (planWakeTarget → drive) is covered WITHOUT any real
  // `tmux send-keys` into a live pane.
  const driver = opts.driver ?? localTmuxDriver();
  return {
    async close(_action, ctx) {
      const { changed } = updateObjectiveLoopStatus(ctx.root, ctx.loopId, "done", {
        now: ctx.now,
        reason: "objective-loop tick: all primary/target refs satisfied"
      });
      return changed ? "done" : "skipped";
    },
    async requestLaunch(action, ctx) {
      const loop = readObjectiveLoop(ctx.root, ctx.loopId);
      const prior = priorLaunchByAgent(listLoopEvents(ctx.root, ctx.loopId)).get(action.agentId ?? "") ?? { count: 0 };
      const plan = planLaunchTarget({
        loop,
        agentId: action.agentId ?? "",
        priorCount: prior.count,
        ...(prior.latestAt !== undefined ? { priorLatestAt: prior.latestAt } : {}),
        now: ctx.now
      });
      // ASK, never spawn (spec §Non-goals: "h2a asks remote/runtime to spawn").
      // MVP: record the request in the loop journal (loop.action.applied
      // {request-launch}) — a conductor/remote consumes it. TODO: also emit a
      // conductor-launch-request envelope to a live remote (createEnvelope +
      // putInboxMessage) once actor-instance + workspace resolution is settled.
      return plan.kind === "emit" ? "done" : "skipped";
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
      const ok = await driver.drive({
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
