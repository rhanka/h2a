/**
 * Governance primitive: append-only conductor-claims store (WP-G1b).
 *
 * A claim event signals that an instance is asserting the conductor role for
 * a workspace; a release event cancels it. The store is a plain JSONL file at
 * `<root>/.h2a/governance/conductor-claims.jsonl`. The fold over events is
 * `activeConductorClaims`: an instance has an active claim iff its latest event
 * (by `at`) for (workspaceId, instance) is a `claim` (a `release` cancels it).
 *
 * This is additive/reversible — append-only, no deletion, no enforcement.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalAddress, localStorePaths } from "../local-files/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConductorClaimEvent {
  readonly type: "claim" | "release";
  readonly workspaceId: string;
  readonly instance: string;
  /** ISO 8601 timestamp of the event. */
  readonly at: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function governanceDir(root: string): string {
  return join(localStorePaths(root).root, "governance");
}

function claimsFile(root: string): string {
  return join(governanceDir(root), "conductor-claims.jsonl");
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

/**
 * Append a conductor claim or release event to the JSONL store.
 * Creates the governance directory if it does not exist.
 */
export function appendConductorClaim(
  root: string,
  event: ConductorClaimEvent
): void {
  const dir = governanceDir(root);
  mkdirSync(dir, { recursive: true });
  appendFileSync(claimsFile(root), `${JSON.stringify(event)}\n`, "utf8");
}

/**
 * Read all conductor claim/release events from the store.
 * Returns an empty array if the file does not exist. Skips malformed lines.
 */
export function listConductorClaims(root: string): ConductorClaimEvent[] {
  const file = claimsFile(root);
  if (!existsSync(file)) return [];
  const out: ConductorClaimEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ConductorClaimEvent);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/**
 * Fold the claim/release log to find active claimants for a workspace.
 *
 * An instance has an **active** claim for `workspaceId` iff its latest event
 * (by `at`) for the pair `(workspaceId, instance)` is a `claim` (a subsequent
 * `release` cancels it).
 *
 * Returns active claimants sorted by their claim `at` ASCENDING (earliest
 * claimant first — the tiebreaker for the conductor election).
 */
export function activeConductorClaims(
  root: string,
  workspaceId: string
): Array<{ instance: string; at: string }> {
  const events = listConductorClaims(root);

  // Compare workspace ids CANONICALLY so a claim stored raw still matches a
  // canonicalized lookup (conductorFor passes canonicalAddress(workspaceId)).
  const wantWs = canonicalAddress(workspaceId);

  // Build a map: instance → { type, at } of the LATEST event for this workspaceId.
  const latest = new Map<string, { type: "claim" | "release"; at: string }>();
  for (const ev of events) {
    if (canonicalAddress(ev.workspaceId) !== wantWs) continue;
    const prev = latest.get(ev.instance);
    if (!prev || ev.at >= prev.at) {
      latest.set(ev.instance, { type: ev.type, at: ev.at });
    }
  }

  // Retain only instances whose latest event is a `claim`.
  const active: Array<{ instance: string; at: string }> = [];
  for (const [instance, { type, at }] of latest) {
    if (type === "claim") {
      active.push({ instance, at });
    }
  }

  // Sort ascending by `at` so the earliest claimant is first.
  active.sort((a, b) => a.at.localeCompare(b.at));
  return active;
}
