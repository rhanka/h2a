// Objective-loop tick — IO ADAPTERS (imperative shell).
//
// This is the ONLY loop-engine file allowed to reach `@sentropic/h2a-runtime`
// (lazy import). `decision.ts` and `tick.ts` stay runtime-free; the golden-rule
// scan in `remote-facade.test.js` enforces it. Consuming the TYPED projection
// (not parsed CLI stdout) is a double-consensus ruling (2026-07-02).

import { spawnSync } from "node:child_process";

import { createLocalStore } from "../../local-files/store.js";
import type { H2AObjectiveLoop } from "../index.js";
import { loopRefLocator, type AgentsSnapshot, type InboxSnapshot, type PendingDecision, type ProjectedAgent, type RefsRollup, type RefStatus } from "./decision.js";

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
