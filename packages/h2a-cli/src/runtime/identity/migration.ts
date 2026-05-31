/**
 * Transparent migration dual-read (DEC-116).
 *
 * After the identity fix, an agent's perennial inbox lives under its new
 * uuid-bearing instance id, while messages addressed before the migration sit
 * under the old label-derived instance dir(s). Migration must be transparent
 * and immediate: the agent keeps receiving everything with no manual move. The
 * read path therefore unions the current inbox with one or more legacy inbox
 * locations, deduplicated by envelope id — equivalent to reading several dirs
 * as if they were one (same id-sorted order as the single-dir reader).
 *
 * Pure + total: the impure part (which dirs to read) belongs to the caller; this
 * is the deterministic merge that is unit-tested in isolation.
 */

import type { H2AEnvelope } from "@sentropic/h2a";

/**
 * Merge envelope sets, deduplicated by `envelope.id`. Pass the CURRENT inbox
 * first: on an id collision the earlier set wins (identical content is expected,
 * but precedence is defined). Entries without a string `id` are skipped. The
 * result is sorted by `id` ascending, matching the single-dir reader's
 * filename `.sort()`, so a dual-read is indistinguishable from one merged dir.
 */
export function mergeInboxDedup(
  sets: ReadonlyArray<readonly H2AEnvelope[]>
): H2AEnvelope[] {
  const byId = new Map<string, H2AEnvelope>();
  for (const set of sets) {
    for (const env of set) {
      const id = (env as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || byId.has(id)) continue;
      byId.set(id, env);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface LegacyAdoptionInput {
  /** Has some agent already inherited this legacy id's keyring (single-inheritor lock)? */
  readonly legacyAlreadyAdopted: boolean;
  /** Did this connector prove possession of one of the legacy keyring's keys? */
  readonly provedLegacyPossession: boolean;
}

export interface LegacyAdoptionDecision {
  /** Adopt the legacy id as an alias of this agent's perennial uuid + inherit its keyring. */
  readonly adopt: boolean;
  /** Mint a fresh key for this agent (honest re-key for de-collided peers). */
  readonly netNewKeys: boolean;
  readonly reason: string;
}

/**
 * Ratified migration rule (DEC-116, spec §Migration F4): the FIRST agent to
 * prove possession of a legacy key inherits the legacy keyring and adopts the
 * legacy id as an alias of its new perennial uuid; every de-collided peer mints
 * **net-new keys** (honest re-key, surfaced in the migration notice). No proof
 * → no inheritance. Pure + total. The adoption record + keyring copy are the
 * caller's (impure, locked) job; this is the deterministic decision.
 */
export function decideLegacyAdoption(input: LegacyAdoptionInput): LegacyAdoptionDecision {
  if (!input.provedLegacyPossession) {
    return {
      adopt: false,
      netNewKeys: true,
      reason: "no proof of possession of a legacy key — mint net-new keys"
    };
  }
  if (input.legacyAlreadyAdopted) {
    return {
      adopt: false,
      netNewKeys: true,
      reason: "legacy id already adopted by a peer — de-collided peer mints net-new keys"
    };
  }
  return {
    adopt: true,
    netNewKeys: false,
    reason: "first to prove possession — inherits legacy keyring, legacy id becomes an alias"
  };
}
