/**
 * EVO-9 — MUTUALISATION. The **positive mirror of NHI9** (`nhi.ts`): where NHI9
 * flags a *credential* reused across instances as a risk, MUTUALISATION flags a
 * *scope* held by two or more instances as a **capitalisation opportunity** — a
 * place where effort, artefacts or learning could be shared. It feeds the MIT
 * librarisation goal.
 *
 * Like `nhiInventory`, it is a **pure derived advisory**: it surfaces candidates
 * and **obligates nothing** (the engine never judges legitimacy, never acts). It
 * reuses the {@link H2AOrgRegisteredInstance} shape (`instance` + `scopes`) the
 * registry already produces (`effectiveOrgInstances`, `org.ts`).
 *
 * Pure, total, deterministic: no I/O, no clock, never throws; output ordered by
 * scope then by instance id, independent of input order.
 */

import type { H2AOrgRegisteredInstance } from "./org.js";

/**
 * One capitalisation candidate: a single `scope` that two or more `instances`
 * share. Advisory only — naming where mutualisation *could* happen, never an
 * obligation to mutualise.
 */
export interface H2AMutualisationOpportunity {
  readonly scope: string;
  /** The (≥2) instances sharing this scope, sorted by id. */
  readonly instances: readonly string[];
}

/**
 * Derive the mutualisation opportunities across a set of registry instances:
 * one opportunity per scope held by ≥2 distinct instances. Single-instance
 * scopes are ignored (nothing to mutualise). Total and deterministic:
 *
 *  - empty / single-instance input → `[]`;
 *  - a scope an instance lists more than once does not self-overlap;
 *  - opportunities are ordered by `scope`, and each opportunity's `instances`
 *    are sorted, so the result is independent of input order;
 *  - malformed rows (missing/!array `scopes`, non-string ids) are skipped.
 */
export function deriveMutualisationOpportunities(
  instances: readonly H2AOrgRegisteredInstance[] | undefined
): H2AMutualisationOpportunity[] {
  const rows = Array.isArray(instances) ? instances : [];

  // scope → set of distinct instance ids that hold it.
  const scopeToInstances = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || typeof row.instance !== "string" || row.instance.length === 0) {
      continue;
    }
    if (!Array.isArray(row.scopes)) continue;
    for (const scope of row.scopes) {
      if (typeof scope !== "string" || scope.length === 0) continue;
      const holders = scopeToInstances.get(scope) ?? new Set<string>();
      holders.add(row.instance);
      scopeToInstances.set(scope, holders);
    }
  }

  const opportunities: H2AMutualisationOpportunity[] = [];
  for (const [scope, holders] of scopeToInstances) {
    if (holders.size < 2) continue; // single-instance scope: nothing to mutualise
    opportunities.push({
      scope,
      instances: [...holders].sort()
    });
  }
  opportunities.sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  return opportunities;
}
