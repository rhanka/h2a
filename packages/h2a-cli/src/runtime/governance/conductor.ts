/**
 * Governance primitive: conductor/owner resolver for a workspace.
 *
 * WP-G1 — Read-only, pure over presence + registry. No writes.
 *
 * The "CONDUCTOR of workspace W" is the live session whose instance is
 * registered with role CONDUCTOR and whose presence workspace.id ===
 * (canonical) workspaceId. If several qualify, the earliest startedAt wins.
 * If none qualify, conductor = null (correct: today agents auto-register as
 * AGENTS, so this is the common/expected state, not an error).
 */

import { canonicalAddress, listPresence } from "../local-files/index.js";
import { createLocalStore } from "../local-files/store.js";

/** One live in-workspace agent. */
export interface ConductorCandidate {
  /** Perennial instance id (host:slug:uuid12). */
  readonly instance: string;
  /** Host (claude, codex, gemini, agy, remote, …). */
  readonly host?: string;
  /** Display name, if set on the session. */
  readonly name?: string;
  /**
   * Roles from the registry registration. Empty array if the instance has no
   * registration (unregistered presence).
   */
  readonly roles: string[];
  /** ISO timestamp when the session was opened. */
  readonly startedAt: string;
  /** ISO timestamp of the last heartbeat. */
  readonly heartbeatAt: string;
}

export interface ConductorResolution {
  /** The workspace id that was resolved (canonical form). */
  readonly workspaceId: string;
  /**
   * The live CONDUCTOR: the candidate whose registration includes role
   * "CONDUCTOR", or null if no candidate holds that role.
   */
  readonly conductor: string | null;
  /**
   * All live sessions whose workspace.id matches (canonical-compared) the
   * requested workspaceId. The conductor (if any) is also in this list.
   */
  readonly candidates: ConductorCandidate[];
  /** true if at least one candidate is live (candidates.length > 0). */
  readonly live: boolean;
}

export interface ConductorForOptions {
  readonly root: string;
  readonly workspaceId: string;
  /** Optional: override the freshness expiry window in ms (default 90000). */
  readonly expiryMs?: number;
  /** Optional: reference instant for freshness (default Date.now()). */
  readonly now?: number;
}

/**
 * Resolve the live conductor/owner of a workspace.
 *
 * Algorithm:
 * 1. List all fresh presence records (90s freshness by default).
 * 2. Retain sessions whose `workspace.id` matches the requested workspaceId
 *    (case-insensitive / slug-stable via canonicalAddress on both sides).
 * 3. For each candidate, look up the registry to read its roles.
 * 4. conductor = the FIRST (by startedAt) candidate whose roles include
 *    "CONDUCTOR"; null if none.
 * 5. live = candidates.length > 0.
 */
export function conductorFor(opts: ConductorForOptions): ConductorResolution {
  const { root, expiryMs, now } = opts;
  const targetId = canonicalAddress(opts.workspaceId);

  // Read live sessions
  const sessions = listPresence(root, {
    ...(expiryMs !== undefined ? { expiryMs } : {}),
    ...(now !== undefined ? { now } : {})
  });

  // Filter to sessions in the target workspace
  const inWorkspace = sessions.filter((s) => {
    if (!s.workspace?.id) return false;
    return canonicalAddress(s.workspace.id) === targetId;
  });

  // Read registry lazily (only if there are candidates; avoids I/O on empty)
  // Build a map: canonical(instance) → roles[]
  const rolesMap = new Map<string, string[]>();
  if (inWorkspace.length > 0) {
    try {
      const store = createLocalStore({ root, allowVersionMismatch: true });
      for (const reg of store.listInstances()) {
        rolesMap.set(canonicalAddress(reg.id), reg.roles ?? []);
      }
    } catch {
      // If the store is unreadable, proceed with empty roles
    }
  }

  // Build candidates
  const candidates: ConductorCandidate[] = inWorkspace.map((s) => ({
    instance: s.instance,
    ...(s.host !== undefined ? { host: s.host } : {}),
    ...(s.name !== undefined ? { name: s.name } : {}),
    roles: rolesMap.get(canonicalAddress(s.instance)) ?? [],
    startedAt: s.startedAt,
    heartbeatAt: s.heartbeatAt
  }));

  // Find the conductor: earliest-startedAt candidate with role CONDUCTOR
  const conductorCandidates = candidates
    .filter((c) => c.roles.includes("CONDUCTOR"))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const conductor = conductorCandidates.length > 0
    ? conductorCandidates[0].instance
    : null;

  return {
    workspaceId: targetId,
    conductor,
    candidates,
    live: candidates.length > 0
  };
}
