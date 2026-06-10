/**
 * Governance primitive: conductor/owner resolver for a workspace.
 *
 * WP-G1 — Read-only, pure over presence + registry + claims. No writes.
 *
 * The "CONDUCTOR of workspace W" is resolved in precedence order:
 * 1. The EARLIEST active-claim instance (from activeConductorClaims) that is
 *    also a live in-workspace candidate (WP-G1b — claim-based election).
 * 2. (back-compat) A live candidate whose registration roles include
 *    "CONDUCTOR" (WP-G1a — role-based).
 * 3. null (the common state: agents auto-register as AGENTS).
 */

import { canonicalAddress, listPresence } from "../local-files/index.js";
import { createLocalStore } from "../local-files/store.js";
import { activeConductorClaims } from "./claims.js";

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
   * The live CONDUCTOR: resolved in precedence order (claim > role > null).
   * null if no live in-workspace candidate holds either a claim or the role.
   */
  readonly conductor: string | null;
  /**
   * The instance that holds an active claim and is live in-workspace, or null
   * if the conductor was resolved by role or is null. Exposes claim provenance.
   */
  readonly claimedBy: string | null;
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
 * 4. Read active conductor claims for the workspace.
 * 5. conductor =
 *    a. The EARLIEST active-claim instance (by claim `at`) that is also a
 *       live in-workspace candidate (claim-based election, WP-G1b); OR
 *    b. (back-compat) the FIRST (by startedAt) live candidate whose roles
 *       include "CONDUCTOR" (role-based, WP-G1a); OR
 *    c. null.
 * 6. claimedBy = the instance resolved via path (a), or null.
 * 7. live = candidates.length > 0.
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

  // Build a set of live in-workspace instance canonical ids for quick lookup.
  const liveSet = new Set(candidates.map((c) => canonicalAddress(c.instance)));

  // 5a. Claim-based election: earliest active claim from a live candidate.
  let conductor: string | null = null;
  let claimedBy: string | null = null;
  try {
    const claims = activeConductorClaims(root, targetId);
    for (const claim of claims) {
      if (liveSet.has(canonicalAddress(claim.instance))) {
        conductor = claim.instance;
        claimedBy = claim.instance;
        break;
      }
    }
  } catch {
    // If claims are unreadable, fall through to role-based resolution
  }

  // 5b. Role-based election (back-compat): earliest-startedAt with role CONDUCTOR.
  if (conductor === null) {
    const conductorCandidates = candidates
      .filter((c) => c.roles.includes("CONDUCTOR"))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    if (conductorCandidates.length > 0) {
      conductor = conductorCandidates[0].instance;
    }
  }

  return {
    workspaceId: targetId,
    conductor,
    claimedBy,
    candidates,
    live: candidates.length > 0
  };
}
