/**
 * NoteBuilder — maps an h2a episode to a `MemoryNoteInput` (vendored v1 port,
 * {@link ../memory/port-v1.ts}). WP11 slice 2 (see the build brief). h2a authors
 * ALL note content; this module never calls graphify — it only shapes data.
 *
 * I1 (durable identity, RESERVED slot): `principal_owner` is accepted here as an
 * OPAQUE caller-supplied string and passed through verbatim. This builder never
 * derives it, never parses it, and never uses it as a lookup/partition key — it
 * is carried, not computed. h2a's own addressing identity today is minted PER
 * CONVERSATION (see `runtime/identity/bindings.ts`), which is exactly the kind of
 * fragile id this invariant warns against soldering in. Because nothing here
 * keys on the string's shape, a durable identity can be handed in later, by the
 * caller, with zero change to this module.
 */

import type { MemoryEventAnchor, MemoryKind, MemoryNoteInput, MemoryScope } from "./port-v1.js";

/**
 * h2a's own closed input taxonomy for "what kind of episode is this" — NOT the
 * graphify `memory_kind` enum. The builder folds this DOWN to the three-value
 * target `memory_kind` (`context` | `decision` | `evidence`); see
 * {@link foldTaxonomyToMemoryKind} for the fold and its one deliberately
 * non-obvious case.
 */
export const H2A_MEMORY_TAXONOMY = ["reference", "feedback", "user", "project", "measured-fact"] as const;
export type H2AMemoryTaxonomy = (typeof H2A_MEMORY_TAXONOMY)[number];

/** `"agent-work"` or a human subject, never a persona/voice (port §3.3.1). */
export type MemoryNoteSubject = "agent-work" | `human:${string}`;

export function isHumanMemorySubject(subject: string): subject is `human:${string}` {
  return subject.startsWith("human:") && subject.length > "human:".length;
}

/**
 * The h2a-side episode the NoteBuilder consumes. Deliberately narrower than
 * `MemoryNoteInput`: this is what a DISPATCH SITE supplies, not the wire shape.
 */
export interface H2AMemoryEvent {
  /** The episode instant (epoch-ms). Distinct from `t`, which is stamped at dispatch. */
  readonly at: number;
  /** A DESCRIPTIVE freetext label — h2a's own vocabulary, NOT a closed set. */
  readonly kind: string;
  /** Structured locator: envelope-id | commit-sha | tool-result-id | decision-id. */
  readonly ref: string;
  /** h2a's input taxonomy; folds to the port's `memory_kind`. */
  readonly taxonomy: H2AMemoryTaxonomy;
  /** The text being remembered; becomes `provenance.cited`. */
  readonly cited: string;
  readonly subject: MemoryNoteSubject;
  /** RESERVED durable-identity slot (I1) — opaque, carried, never derived here. */
  readonly principalOwner: string;
  readonly scope: MemoryScope;
  /** Required when `subject` is human (port §3.5); ignored for `agent-work`. */
  readonly purpose?: string;
  /** Required when `subject` is human (port §3.5); ignored for `agent-work`. */
  readonly retention?: number | string;
  /** Names which mechanism produced `t`. Defaults to `"h2a:dispatch"`. */
  readonly tSrc?: string;
}

export interface BuildMemoryNoteOptions {
  /** Injectable clock so `t` (ordering coordinate) is deterministic in tests. */
  readonly now?: () => number;
}

/**
 * Fold h2a's five-member input taxonomy down to the port's closed three-value
 * `memory_kind` enum (§3.1: `context` | `decision` | `evidence` — there is no
 * fourth value; the vendored port never had one). Mapping, per the build brief:
 *   - `feedback`      → `decision` (episodic-cited)
 *   - `user`          → `context`  (subject-named, never a UserModel)
 *   - `project`       → `context`
 *   - `measured-fact` → `evidence`
 *   - `reference`     → `context`. RESOLVED (graphify SPEC_AGENT_MEMORY_SUBSTRATE
 *     §3.1.1, co-spec GO'd): "reference → provenance, NOT a genre." A reference
 *     (URL/dashboard/ticket) is a LOCATOR, not an assertion — it is never
 *     `evidence`, because `evidence` means a measured fact was OBSERVED, and a
 *     pointer observes nothing. So the HOST note is a `context` note, same as
 *     `user`/`project`, and the locator itself rides in `provenance.source`
 *     (a field every note already carries — see {@link buildMemoryNote}), which
 *     is why `reference` needs no `memory_kind` of its own beyond `context`.
 */
export function foldTaxonomyToMemoryKind(taxonomy: H2AMemoryTaxonomy): MemoryKind {
  switch (taxonomy) {
    case "feedback":
      return "decision";
    case "user":
      return "context";
    case "project":
      return "context";
    case "measured-fact":
      return "evidence";
    case "reference":
      return "context";
  }
}

/**
 * Build the complete `MemoryNoteInput` h2a will dispatch. Pure mapping — no I/O,
 * no dispatch, no validation (that is {@link ../memory/preflight.ts}). `t` is
 * stamped HERE, at build/dispatch time (received-at), and MAY differ from
 * `event.at` (the episode instant); `t_src` names which mechanism produced `t`.
 */
export function buildMemoryNote(event: H2AMemoryEvent, options: BuildMemoryNoteOptions = {}): MemoryNoteInput {
  const now = options.now ?? Date.now;
  const anchor: MemoryEventAnchor = { at: event.at, kind: event.kind, ref: event.ref };

  const note: MemoryNoteInput = {
    node_type: "MemoryNote",
    memory_kind: foldTaxonomyToMemoryKind(event.taxonomy),
    subject: event.subject,
    t: now(),
    t_src: event.tSrc ?? "h2a:dispatch",
    event: anchor,
    // provenance.source == event.ref (build brief, port §4/§9.4) — the SAME handle.
    provenance: { cited: event.cited, source: event.ref },
    principal_owner: event.principalOwner,
    scope: event.scope
  };

  // purpose + retention are REQUIRED when subject is human (port §3.5); this
  // builder carries them through only in that case so an agent-work note never
  // grows fields the shape check does not expect for it.
  if (isHumanMemorySubject(event.subject)) {
    if (event.purpose !== undefined) note.purpose = event.purpose;
    if (event.retention !== undefined) note.retention = event.retention;
  }

  return note;
}
