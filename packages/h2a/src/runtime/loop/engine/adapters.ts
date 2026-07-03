// Objective-loop tick — IO ADAPTERS (imperative shell).
//
// This is the ONLY loop-engine file allowed to reach `@sentropic/h2a-runtime`
// (lazy import). `decision.ts` and `tick.ts` stay runtime-free; the golden-rule
// scan in `remote-facade.test.js` enforces it. Consuming the TYPED projection
// (not parsed CLI stdout) is a double-consensus ruling (2026-07-02).

import { spawnSync } from "node:child_process";

import type { H2AObjectiveLoop } from "../index.js";
import { loopRefLocator, type AgentsSnapshot, type InboxSnapshot, type ProjectedAgent, type RefsRollup, type RefStatus } from "./decision.js";

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

// --- Inbox adapter ------------------------------------------------------------
// SLICE-1 STUB: no pending decisions surfaced yet. TODO(slice-2): read the h2a
// inbox for decisions awaiting a human/agent answer.
export function readInbox(_loop: H2AObjectiveLoop): InboxSnapshot {
  return { pendingDecisions: [] };
}
