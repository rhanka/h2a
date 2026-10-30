import { contentHashOf, stripFrame } from './frame.js'
import type { Sha256, TrackEvent, Ulid } from './types.js'
import { validate } from './validate.js'

/**
 * Fail-closed integrity refusal from a reseal (Lot L3, spec §1.3). Distinct from a plain `Error` so a
 * caller can tell "reseal REFUSED to touch the log" from any other failure: reseal never re-hashes a
 * tampered `EventCore` and never writes a stream `validate` rejects — the log is left byte-identical.
 */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

/** Outcome of a reseal, as printed by `track reseal`. */
export interface ResealResult {
  /** Number of events in the resealed output stream (after duplicate collapse). */
  events: number
  /** Number of events whose integrity frame (`seq` and/or `prevHash`) was rewritten by the reseal. */
  resealed: number
  /** Number of exact duplicate lines (same `id`, same `contentHash`) collapsed — first kept. */
  deduplicated: number
}

/**
 * Re-seal a union-merged event stream (Lot L3, spec §1.3). `.gitattributes` pins
 * `merge=union` so a merge of two branches that each appended disjoint events keeps BOTH suffixes —
 * but the merged log then carries a broken positional `prevHash` chain, duplicate per-aggregate `seq`,
 * and a stale head, which makes the store fail-closed on the next append. `resealEvents` recomputes
 * ONLY the integrity frame; every event `id` and `contentHash` is preserved verbatim (the hash domain
 * is the frame-free `EventCore`, so `events-contains` containment over ids survives a reseal).
 *
 * Steps (fail-closed — nothing is written before all four pass):
 *  1. Pre-reseal core integrity guard: every event must satisfy `contentHash === contentHashOf(core)`.
 *     A reseal NEVER re-hashes a tampered core — it would launder the tamper into a "valid" log.
 *  2. Idempotent duplicate-line collapse: an exact `(id, contentHash)` pair may appear twice (a
 *     cherry-picked commit union-merged) — keep the first, count the rest; the same `id` with a
 *     DIFFERENT `contentHash` is a conflict, not a duplicate — refuse.
 *  3. Re-frame: contiguous `seq` (`1..k` per `aggregateId`) and stream `prevHash` (`null` for the
 *     first event, the previous event's `contentHash` otherwise), `contentHash` untouched.
 *  4. Full post-reseal validation gate: the reframed stream must pass `validate(out, head)` — a
 *     re-chain repairs ONLY `prev-hash`/`aggregate-seq`/`head-mismatch` findings; anything else
 *     (an interleaved command batch, an `aggregate-mismatch`, a `blocker-scope` or `reopen` finding)
 *     means the merged log is not resealable as-is and the caller must repair it through the CLI.
 *
 * Pure: reads the input array, returns a new array — no I/O. `EventStore.reseal` persists the result.
 */
export function resealEvents(
  events: ReadonlyArray<TrackEvent>,
): { events: TrackEvent[]; result: ResealResult } {
  // Step 1 — pre-reseal core integrity guard, in input order, before anything else.
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const expected = contentHashOf(stripFrame(e))
    if (e.contentHash !== expected) {
      throw new IntegrityError(
        `reseal: content-hash mismatch at index ${i} (event ${e.id}): stored ${e.contentHash}, ` +
          `core hashes ${expected} — refusing to reseal a tampered event`,
      )
    }
  }

  // Step 2 — idempotent duplicate-line collapse (same id + same contentHash ⇒ keep the first).
  const firstHashById = new Map<Ulid, Sha256>()
  const unique: TrackEvent[] = []
  let deduplicated = 0
  for (const e of events) {
    const known = firstHashById.get(e.id)
    if (known === undefined) {
      firstHashById.set(e.id, e.contentHash)
      unique.push(e)
    } else if (known === e.contentHash) {
      deduplicated += 1
    } else {
      throw new IntegrityError(
        `reseal: duplicate-event-id ${e.id} with divergent content (${known} vs ${e.contentHash}) ` +
          `— refusing to reseal`,
      )
    }
  }

  // Step 3 — re-frame per-aggregate `seq` (1-based contiguous) and the stream `prevHash` chain.
  const out: TrackEvent[] = []
  const nextSeq = new Map<Ulid, number>()
  let prevHash: Sha256 | null = null
  let resealed = 0
  for (const e of unique) {
    const seq = (nextSeq.get(e.aggregateId) ?? 0) + 1
    nextSeq.set(e.aggregateId, seq)
    const reframed: TrackEvent = { ...stripFrame(e), seq, prevHash, contentHash: e.contentHash }
    if (reframed.seq !== e.seq || reframed.prevHash !== e.prevHash) resealed += 1
    out.push(reframed)
    prevHash = e.contentHash
  }

  // Step 4 — full post-reseal validation gate against the head the resealed stream defines.
  const head = { streamLength: out.length, lastContentHash: prevHash }
  const integrity = validate(out, head)
  if (!integrity.ok) {
    const kinds = integrity.findings.map((f) => f.kind).join(', ')
    throw new IntegrityError(
      `reseal: the resealed stream fails validate (${integrity.findings.length} finding(s): ${kinds}) ` +
        `— refusing to write`,
    )
  }

  return { events: out, result: { events: out.length, resealed, deduplicated } }
}
