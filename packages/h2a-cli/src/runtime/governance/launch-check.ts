/**
 * Governance D3 — Conductor Launch Check (DRY-RUN, read-only).
 *
 * h2a polls `track workspace-activity` and RECOMMENDS launching a conductor
 * where work is durably stalled and no conductor is live.
 *
 * The module has two layers:
 *
 * 1. `recommendConductorLaunch` — pure function, no I/O.  Derives the
 *    recommendation from two booleans: whether a conductor is already live and
 *    how many stalled items were found.
 *
 * 2. `conductorLaunchCheck` — the I/O gatherer.  Calls `track
 *    workspace-activity`, calls `conductorFor`, computes the recommendation,
 *    and returns a single result object.  Never writes, never spawns.
 *
 * IMPORTANT — DRY-RUN policy
 * --------------------------
 * h2a does NOT spawn anything.  A `recommendation === "launch"` output is
 * purely advisory.  The actual conductor launch is **parked** pending a
 * spawn-policy decision and remote-trigger support.
 */

import { execFileSync } from "node:child_process";
import { conductorFor } from "./conductor.js";

// ---------------------------------------------------------------------------
// Pure recommendation layer
// ---------------------------------------------------------------------------

export interface RecommendConductorLaunchOpts {
  /** true when conductorFor returned a non-null conductor that is live. */
  readonly conductorLive: boolean;
  /** Number of stalled items returned by track workspace-activity. */
  readonly stalledCount: number;
}

export interface ConductorLaunchRecommendation {
  /** "launch" = h2a recommends someone starts a conductor; "none" = no action needed. */
  readonly recommendation: "launch" | "none";
  /** Human-readable reason behind the recommendation. */
  readonly reason: string;
  /** Preferred host order for the launch (only present when recommendation === "launch"). */
  readonly suggestedHosts?: string[];
}

/**
 * Pure function: derive a conductor-launch recommendation from pre-gathered
 * facts.  No I/O.
 *
 * Rules (in precedence order):
 * 1. conductorLive === true → none (a live conductor already owns the workspace).
 * 2. conductorLive === false AND stalledCount > 0 → launch.
 * 3. else → none (no stalled work detected).
 */
export function recommendConductorLaunch(
  opts: RecommendConductorLaunchOpts
): ConductorLaunchRecommendation {
  const { conductorLive, stalledCount } = opts;

  if (conductorLive) {
    return {
      recommendation: "none",
      reason: "a live conductor already owns this workspace"
    };
  }

  if (stalledCount > 0) {
    return {
      recommendation: "launch",
      reason: `${stalledCount} stalled item(s) and no live conductor`,
      suggestedHosts: ["claude", "codex", "agy"]
    };
  }

  return {
    recommendation: "none",
    reason: "no stalled work"
  };
}

// ---------------------------------------------------------------------------
// Stalled item shape (subset of what track workspace-activity returns)
// ---------------------------------------------------------------------------

export interface StalledItem {
  readonly id?: string;
  readonly title?: string;
  readonly reason?: string;
  readonly since?: string;
}

// ---------------------------------------------------------------------------
// I/O gatherer
// ---------------------------------------------------------------------------

export interface ConductorLaunchCheckOpts {
  /** h2a store root (the `.h2a` directory). */
  readonly root: string;
  /** Workspace id in `ws:<uuid>` form. */
  readonly workspaceId: string;
  /** Idle threshold passed to `track workspace-activity --idle-ms`. Default 86400000 (24h). */
  readonly idleMs?: number;
  /** Override `Date.now()` for test determinism. */
  readonly now?: () => number;
  /**
   * Injectable replacement for the real `track workspace-activity` call.
   * When absent, the default implementation runs the `track` binary.
   * Return `undefined` to signal that track is unavailable / errored.
   */
  readonly runTrackActivity?: (
    workspaceId: string,
    idleMs: number
  ) => { pending: number; stalled: StalledItem[]; latestEventAt?: string } | undefined;
}

export interface ConductorLaunchCheckResult {
  readonly workspaceId: string;
  /** false when track is absent or errored (graceful degradation). */
  readonly trackAvailable: boolean;
  /** The live conductor instance id, or null. */
  readonly conductor: string | null;
  readonly conductorLive: boolean;
  readonly pending: number;
  readonly stalled: StalledItem[];
  readonly latestEventAt?: string;
  readonly recommendation: "launch" | "none";
  readonly reason: string;
  readonly suggestedHosts?: string[];
}

/**
 * Default implementation: run the `track` binary and parse the JSON output.
 * Returns `undefined` on any error (track absent, non-zero exit, invalid JSON).
 * Never throws.
 */
function defaultRunTrackActivity(
  workspaceId: string,
  idleMs: number
): { pending: number; stalled: StalledItem[]; latestEventAt?: string } | undefined {
  try {
    const out = execFileSync(
      "track",
      [
        "workspace-activity",
        "--workspace",
        workspaceId,
        "--idle-ms",
        String(idleMs),
        "--format",
        "json"
      ],
      { encoding: "utf8" }
    );
    return JSON.parse(out) as { pending: number; stalled: StalledItem[]; latestEventAt?: string };
  } catch {
    return undefined;
  }
}

/**
 * Gather all facts and derive a conductor-launch recommendation.
 *
 * Read-only: no writes, no spawns.
 */
export function conductorLaunchCheck(opts: ConductorLaunchCheckOpts): ConductorLaunchCheckResult {
  const {
    root,
    workspaceId,
    idleMs = 86_400_000,
    now,
    runTrackActivity = defaultRunTrackActivity
  } = opts;

  // 1. Gather track activity (graceful — track may not be installed in CI).
  const activityRaw = runTrackActivity(workspaceId, idleMs);
  const trackAvailable = activityRaw !== undefined;
  const activity = activityRaw ?? { pending: 0, stalled: [] };

  // 2. Resolve the live conductor.
  const resolution = conductorFor({
    root,
    workspaceId,
    ...(now !== undefined ? { now: now() } : {})
  });
  const conductor = resolution.conductor;
  const conductorLive = conductor !== null;

  // 3. Compute recommendation.
  const rec = recommendConductorLaunch({
    conductorLive,
    stalledCount: activity.stalled.length
  });

  return {
    workspaceId,
    trackAvailable,
    conductor,
    conductorLive,
    pending: activity.pending,
    stalled: activity.stalled,
    ...(activity.latestEventAt !== undefined ? { latestEventAt: activity.latestEventAt } : {}),
    recommendation: rec.recommendation,
    reason: rec.reason,
    ...(rec.suggestedHosts !== undefined ? { suggestedHosts: rec.suggestedHosts } : {})
  };
}
