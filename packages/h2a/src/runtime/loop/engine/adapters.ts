// Objective-loop tick — IO ADAPTERS (imperative shell).
//
// This is the ONLY loop-engine file allowed to reach `@sentropic/h2a-runtime`
// (lazy import). `decision.ts` and `tick.ts` stay runtime-free; the golden-rule
// scan in `remote-facade.test.js` enforces it. Consuming the TYPED projection
// (not parsed CLI stdout) is a double-consensus ruling (2026-07-02).

import type { H2AObjectiveLoop } from "../index.js";
import { loopRefLocator, type AgentsSnapshot, type InboxSnapshot, type ProjectedAgent, type RefsRollup } from "./decision.js";

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

// --- Track refs rollup adapter (read-only) ------------------------------------
// SLICE-1 CONSERVATIVE: we do not yet resolve live track statuses (that needs the
// read-only `track` query seam, wired in the next slice). Declared refs are
// reported as `unknown` — which the pure core treats as NOT-satisfied, so the
// loop can never auto-close on an unresolved ref. Source is reachable → not
// degraded. TODO(slice-2): resolve each ref via `track` shell-out (read-only).
export function readRefsRollup(loop: H2AObjectiveLoop): RefsRollup {
  return {
    degraded: false,
    refs: loop.refs.map((r) => ({ locator: loopRefLocator(r), status: "unknown" as const })),
  };
}

// --- Inbox adapter ------------------------------------------------------------
// SLICE-1 STUB: no pending decisions surfaced yet. TODO(slice-2): read the h2a
// inbox for decisions awaiting a human/agent answer.
export function readInbox(_loop: H2AObjectiveLoop): InboxSnapshot {
  return { pendingDecisions: [] };
}
