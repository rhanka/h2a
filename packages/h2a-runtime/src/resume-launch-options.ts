/**
 * Pinned launch options for `runtime:run --resume` — recovery + SELF-HEAL of
 * the conflicting-rows outage (2026-10): two registry rows for one
 * convId/cwd/tool with different bare/gatewayMode pins used to be a bare fatal
 * ("cannot recover pinned launch options: conflicting registry rows") that
 * blocked EVERY resume of that conversation, even when all but one row
 * provably described a dead session.
 *
 * The resolution: probe each conflicting row with the SAME 3-state vocabulary
 * as the managed-host resolver (`probeManagedRowLiveness`). A row whose
 * session is PROVABLY dead (dead probe, or positively ended) is pruned from
 * the registry under the lock (`removeRegistryRowsById`); a live or UNKNOWN
 * row stays (fail closed — a probe failure is never death). When one row (or
 * none) remains, the resume continues normally with it; a still-conflicting
 * set stays a fatal, but now naming the ids in cause and the repair action
 * instead of leaving the operator to guess.
 */

import {
  isManagedLocalKind,
  loadRegistry,
  probeManagedRowLiveness,
  removeRegistryRowsById,
  resolveRegistryPath,
  type ManagedHostProbeResult,
  type RegistryEntry,
} from "./registry.js";

/** Injectable session probes (tests stay deterministic, no tmux/host needed). */
export type ResumeLaunchProbes = {
  readonly native?: (name: string) => ManagedHostProbeResult;
  readonly tmux?: (name: string) => ManagedHostProbeResult;
};

/**
 * Same conflict predicate as the pre-self-heal fatal: any row pinning launch
 * options (bare/gatewayMode) that differ from the first row's. All rows in the
 * set share convId/cwd/tool, so ANY difference poisons the whole set.
 */
export function pinnedLaunchOptionsConflict(
  entries: readonly RegistryEntry[],
): boolean {
  return entries.some((entry) =>
    entry.bare !== entries[0]?.bare || entry.gatewayMode !== entries[0]?.gatewayMode,
  );
}

/** Actionable fatal for a conflict that survived the self-heal. */
export function conflictingRowsReason(ids: readonly string[]): string {
  return (
    "cannot recover pinned launch options: conflicting registry rows: ids " +
    `${ids.join(", ")} — stop the stale session or remove its row`
  );
}

export type PinnedLaunchResolution =
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "conflict"; readonly reason: string; readonly ids: readonly string[] }
  | { readonly state: "ok"; readonly entries: RegistryEntry[]; readonly prunedIds: readonly string[] };

/**
 * Resolve the rows that pin launch options for a resume of `convId` in `cwd`
 * under tool `tool`: read the registry (3-state), keep only managed local rows
 * for this conversation, self-heal a conflicting set by pruning provably-dead
 * rows, and report what remains. Pure over injectable probes; the registry
 * write (pruning) goes through the registry lock.
 */
export function resolvePinnedLaunchEntries(args: {
  readonly convId: string;
  readonly cwd: string;
  readonly tool: string;
  /** Defaults to the canonical registry path (honors REMOTE_CLI_CONFIG_HOME). */
  readonly registryPath?: string;
  readonly probes?: ResumeLaunchProbes;
}): PinnedLaunchResolution {
  const registryPath = args.registryPath ?? resolveRegistryPath();
  const read = loadRegistry(registryPath);
  if (read.state === "unknown") {
    return { state: "unreadable", reason: read.reason };
  }
  let entries = read.entries.filter((entry) =>
    isManagedLocalKind(entry.kind) && entry.convId === args.convId &&
    entry.cwd === args.cwd && entry.tool === args.tool,
  );
  if (!pinnedLaunchOptionsConflict(entries)) {
    return { state: "ok", entries, prunedIds: [] };
  }
  const deadIds = entries
    .filter((entry) => probeManagedRowLiveness(entry, args.probes) === "dead")
    .map((entry) => entry.id);
  if (deadIds.length > 0) {
    removeRegistryRowsById(deadIds, registryPath);
    const pruned = new Set(deadIds);
    entries = entries.filter((entry) => !pruned.has(entry.id));
  }
  if (pinnedLaunchOptionsConflict(entries)) {
    const ids = entries.map((entry) => entry.id);
    return { state: "conflict", ids, reason: conflictingRowsReason(ids) };
  }
  return { state: "ok", entries, prunedIds: deadIds };
}
