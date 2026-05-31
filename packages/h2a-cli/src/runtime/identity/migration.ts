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
