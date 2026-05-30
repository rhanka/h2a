/**
 * EVO-9 — VALEUR (chaîne de valeur). A pure, total derivation of the value
 * chain an ENGAGEMENT participates in, by traversing the optional `aval`
 * (downstream) link as a linked list. The chain is **never a stored object**:
 * it is the *linkable, named finalité* the existing INTENTION/`successCriteria`
 * already express, surfaced by calculation (declare → derive). The frozen
 * surface touch is the single additive optional `aval`/`finaliteAmont` pair on
 * {@link H2AEngagement} (`types.ts`), which passes the contractual
 * collapse-guard (`contractual.ts`).
 *
 * Cross-organization links resolve through the existing disclosure ladder
 * (`disclosure.ts`): an onward `aval` whose target is not in the supplied set,
 * under an **opaque** disclosure mode, is a boundary we cannot see past. Per the
 * stabilization review (Fork A / F8) we do **not** silently return a partial
 * chain as if it were complete — we mark the terminal node `boundaryOpaque`.
 *
 * Pure and total: no I/O, no clock, never throws, deterministic.
 */

import type { H2ADisclosureMode } from "./disclosure.js";
import type { H2AEngagement } from "./types.js";

/**
 * One node of a derived value chain: the engagement's id and its VALEUR links,
 * plus a `boundaryOpaque` marker set on a terminal node whose onward `aval`
 * crosses an undisclosed/opaque boundary (the link exists but cannot be
 * followed under the active disclosure mode).
 */
export interface H2AValueChainNode {
  readonly id: string;
  /** The downstream engagement id this node feeds, if declared. */
  readonly aval?: string;
  /** The upstream finalité this node serves, if declared. */
  readonly finaliteAmont?: string;
  /**
   * True only on a terminal node whose `aval` points past a boundary we cannot
   * resolve under the active disclosure mode (so the chain is truncated, not
   * complete). Absent otherwise.
   */
  readonly boundaryOpaque?: true;
}

export interface H2ADeriveValueChainOptions {
  /**
   * The disclosure mode governing cross-boundary resolution. Any mode other
   * than `full-view` is treated as **opaque**: an unresolved onward `aval` then
   * marks the terminal node `boundaryOpaque`. When omitted, no opacity is
   * asserted (a same-context derivation) and an unresolved link simply ends the
   * chain.
   */
  readonly disclosureMode?: H2ADisclosureMode;
}

/** A disclosure mode is opaque iff it is anything other than a full view. */
function isOpaqueDisclosure(mode: H2ADisclosureMode | undefined): boolean {
  return mode !== undefined && mode !== "full-view";
}

/**
 * Derive the value chain reachable from `fromId` by following the `aval`
 * (downstream) link. Returns the chain as an ordered linked list starting at
 * `fromId`. Total and deterministic:
 *
 *  - an unknown `fromId` yields `[]`;
 *  - a node with no `aval` terminates the chain cleanly;
 *  - an `aval` whose target is absent from `engagements` terminates the chain;
 *    if `disclosureMode` is opaque, the terminal node is marked
 *    `boundaryOpaque: true` (the link exists but crosses a boundary we cannot
 *    follow — never silently presented as complete);
 *  - a cycle (incl. a self-loop) is guarded by a visited set, so traversal
 *    always terminates and never revisits a node.
 */
export function deriveValueChain(
  engagements: readonly H2AEngagement[] | undefined,
  fromId: string,
  options: H2ADeriveValueChainOptions = {}
): H2AValueChainNode[] {
  const list = Array.isArray(engagements) ? engagements : [];
  const byId = new Map<string, H2AEngagement>();
  for (const eng of list) {
    if (eng && typeof eng.id === "string" && !byId.has(eng.id)) {
      byId.set(eng.id, eng);
    }
  }

  const opaque = isOpaqueDisclosure(options.disclosureMode);
  const chain: H2AValueChainNode[] = [];
  const visited = new Set<string>();

  let currentId: string | undefined = fromId;
  while (currentId !== undefined && !visited.has(currentId)) {
    const eng = byId.get(currentId);
    if (!eng) break;
    visited.add(currentId);

    const aval = typeof eng.aval === "string" ? eng.aval : undefined;
    const finaliteAmont =
      typeof eng.finaliteAmont === "string" ? eng.finaliteAmont : undefined;

    // Decide whether this node is a truncated terminal at an opaque boundary:
    // it has an onward link, that link is unresolved in the supplied set, and
    // the active disclosure mode is opaque.
    const onwardUnresolved = aval !== undefined && !byId.has(aval);
    const boundaryOpaque = opaque && onwardUnresolved;

    chain.push({
      id: eng.id,
      ...(aval !== undefined ? { aval } : {}),
      ...(finaliteAmont !== undefined ? { finaliteAmont } : {}),
      ...(boundaryOpaque ? { boundaryOpaque: true as const } : {})
    });

    currentId = aval;
  }

  return chain;
}
