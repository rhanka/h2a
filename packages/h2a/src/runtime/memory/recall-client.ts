/**
 * Recall client — WP11 slice 5 (build brief), read-side (wake-recall). Consumes
 * an INJECTED `MemoryRecallPort` and returns the notes for the wake path. This
 * slice stubs the port in tests; it never wires to real storage/graphify and is
 * NOT wired into the actual wake/CLI path — the real recall factory awaits
 * graphify's storage-laying Vague B (out of scope here, same boundary as
 * `admit-client.ts`'s producer side).
 *
 * READ-SIDE GUARANTEES ENFORCED HERE, AS A CONSUMER (not just assumed from the
 * port's types — the port is an external boundary, so this module re-checks the
 * shape of what it gets back):
 *  - `projection: "notes-only"` — this module exposes the notes as a FLAT LIST
 *    and offers no helper that aggregates `subject: "human:<id>"` notes into a
 *    profile. `groupAgentWorkNotesBySubject` below is the ONE grouping helper
 *    this module offers, and it EXCLUDES human-subject notes from the grouping
 *    by construction (counts them, never groups them) — so a UserModel cannot
 *    be assembled by composing this consumer's exports. A port that returns a
 *    different projection value is refused locally too: a misbehaving or
 *    incorrectly-stubbed port must not silently smuggle a different shape past
 *    the consumer boundary (the projection prohibition, §3.3.3, holds even if
 *    the far side does not enforce it correctly).
 *  - `freshness` and each note's `trust`/`review_status`/`provenance` are
 *    passed through VERBATIM — never stripped, never re-labeled as verified.
 *  - I5 fail-closed: an absent port, or one that throws/rejects, REFUSES —
 *    never a silent `notes: []` that reads as "no memories exist". A refusal
 *    is a structurally distinct shape (`refused: true` + `reason`, `notes: []`)
 *    from a genuine empty recall (`refused: false, notes: []`), so a caller
 *    cannot conflate "asked and got nothing" with "could not ask".
 *  - I1: `ctx.principal_owner` travels through opaque and unexamined — this
 *    module never derives, parses or keys on it (same reservation as
 *    `note-builder.ts`).
 *  - I4: no new capabilities/taxonomy vocabulary opens here — the
 *    human-subject predicate is REUSED from `note-builder.ts`
 *    (`isHumanMemorySubject`), never redefined.
 */

import { isHumanMemorySubject } from "./note-builder.js";
import type {
  MemoryContext,
  MemoryRecallPort,
  MemoryRecallQuery,
  MemoryRecallResultView,
  RecalledMemoryNoteView
} from "./port-v1.js";

export interface RecallMemorySuccess {
  readonly refused: false;
  readonly notes: readonly RecalledMemoryNoteView[];
  readonly freshness: MemoryRecallResultView["freshness"];
  readonly projection: MemoryRecallResultView["projection"];
  readonly requestingPrincipal: string;
  readonly unpaged: true;
}

export interface RecallMemoryRefusal {
  readonly refused: true;
  readonly reason: string;
  /** Always empty on a refusal — never conflate with a genuine empty recall. */
  readonly notes: readonly [];
}

export type RecallMemoryOutcome = RecallMemorySuccess | RecallMemoryRefusal;

function refuse(reason: string): RecallMemoryRefusal {
  return { refused: true, reason, notes: [] };
}

/**
 * Dispatch `query` through `port.recallMemory(query, ctx)` for the wake path.
 * `port` is injected and may be `undefined`/`null` (I5: fail-closed default,
 * not a wiring error — the real recall factory does not exist yet).
 */
export async function recallMemory(
  query: MemoryRecallQuery,
  ctx: MemoryContext,
  port: MemoryRecallPort | undefined | null
): Promise<RecallMemoryOutcome> {
  if (!port) {
    return refuse("no memory recall port injected — refusing (fail-closed, I5)");
  }

  let result: MemoryRecallResultView;
  try {
    result = await port.recallMemory(query, ctx);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return refuse(`memory recall port unreachable: ${reason}`);
  }

  if (result.projection !== "notes-only") {
    return refuse(
      `memory recall port returned projection "${String(result.projection)}", expected "notes-only" — refusing rather than trusting an unverified shape`
    );
  }

  return {
    refused: false,
    notes: result.notes,
    freshness: result.freshness,
    projection: result.projection,
    requestingPrincipal: result.requestingPrincipal,
    unpaged: result.unpaged
  };
}

export interface NotesGroupedBySubject {
  /** Grouped ONLY for non-human subjects (e.g. `"agent-work"`). */
  readonly grouped: Readonly<Record<string, readonly RecalledMemoryNoteView[]>>;
  /** Count of human-subject notes excluded from the grouping — never aggregated. */
  readonly excludedHumanSubjectCount: number;
}

/**
 * The ONE grouping/summary helper this consumer offers, and it deliberately
 * cannot be used to assemble a human-subject profile: any `human:<id>`
 * subject note is EXCLUDED from the grouping (counted, never aggregated).
 * Only non-human subjects (e.g. `"agent-work"`) are grouped. This mirrors the
 * projection prohibition (§3.3.3) at the consumer boundary, so the
 * prohibition holds even if a caller composes only this module's own exports
 * — there is no way to reach a `Record<humanSubject, notes[]>` through it.
 */
export function groupAgentWorkNotesBySubject(
  notes: readonly RecalledMemoryNoteView[]
): NotesGroupedBySubject {
  const grouped: Record<string, RecalledMemoryNoteView[]> = {};
  let excludedHumanSubjectCount = 0;

  for (const note of notes) {
    if (isHumanMemorySubject(note.subject)) {
      excludedHumanSubjectCount += 1;
      continue;
    }
    const bucket = grouped[note.subject] ?? (grouped[note.subject] = []);
    bucket.push(note);
  }

  return { grouped, excludedHumanSubjectCount };
}
