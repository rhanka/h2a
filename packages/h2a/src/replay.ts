/**
 * Anti-replay for signed envelopes (DEC-074), slice 2 of the signed-bearer
 * transport-auth workstream (DEC-032 / DEC-073).
 *
 * A DEC-073 signature proves *who* emitted an envelope, but not that it is
 * *fresh* — a validly signed envelope can be captured and re-sent. Replay
 * protection adds two orthogonal checks:
 *
 * - **Freshness**: the envelope's `createdAt` must fall inside an accepted
 *   window `[now - maxAgeMs, now + maxSkewMs]` (skew tolerates clock drift on
 *   the emitter).
 * - **Dedup**: the envelope's `id` must not have been accepted before. The
 *   `id` is part of the signed view (DEC-073), so a replayed envelope carries
 *   the same id and is rejected.
 *
 * Both are pure/in-memory — no I/O — so this lives in `@sentropic/h2a`. The
 * channel that moves bytes is irrelevant; verification is end-to-end.
 */

import type { H2AEnvelope } from "./types.js";

export const H2A_DEFAULT_MAX_AGE_MS = 300_000; // 5 minutes
export const H2A_DEFAULT_MAX_SKEW_MS = 60_000; // 1 minute clock skew

export interface H2AFreshnessOptions {
  /** Reference time (ms epoch). Defaults to `Date.now()`. */
  now?: number;
  /** How old an envelope may be before it is stale. Default 5 min. */
  maxAgeMs?: number;
  /** How far in the future `createdAt` may be (clock skew). Default 1 min. */
  maxSkewMs?: number;
}

export type H2AReplayRejection = "invalid-timestamp" | "expired" | "future" | "replayed";

export interface H2AReplayCheck {
  ok: boolean;
  reason?: H2AReplayRejection;
}

/**
 * Pure freshness check: is the envelope's `createdAt` within the accepted
 * window? Does not consider dedup (that needs state — see {@link createReplayGuard}).
 */
export function checkEnvelopeFreshness(
  envelope: H2AEnvelope,
  options: H2AFreshnessOptions = {}
): H2AReplayCheck {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? H2A_DEFAULT_MAX_AGE_MS;
  const maxSkewMs = options.maxSkewMs ?? H2A_DEFAULT_MAX_SKEW_MS;

  const created = Date.parse(envelope.createdAt);
  if (Number.isNaN(created)) {
    return { ok: false, reason: "invalid-timestamp" };
  }
  if (created > now + maxSkewMs) {
    return { ok: false, reason: "future" };
  }
  if (created < now - maxAgeMs) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

export interface H2AReplayGuard {
  /**
   * Accept an envelope iff it is fresh AND its id has not been seen before.
   * On success the id is remembered for the rest of its freshness window.
   */
  accept(envelope: H2AEnvelope, now?: number): H2AReplayCheck;
  /** Number of remembered ids (after pruning). Mostly for tests/observability. */
  size(): number;
}

/**
 * Create an in-memory replay guard. It remembers accepted envelope ids until
 * they fall out of the freshness window, so the set stays bounded: an id that
 * could only be replayed *after* it has expired would be rejected by the
 * freshness check anyway, so it is safe to forget.
 */
export function createReplayGuard(
  options: Pick<H2AFreshnessOptions, "maxAgeMs" | "maxSkewMs"> = {}
): H2AReplayGuard {
  const maxAgeMs = options.maxAgeMs ?? H2A_DEFAULT_MAX_AGE_MS;
  const maxSkewMs = options.maxSkewMs ?? H2A_DEFAULT_MAX_SKEW_MS;
  // id -> the createdAt (ms) we accepted it at, for window-based pruning.
  const seen = new Map<string, number>();

  function prune(now: number): void {
    for (const [id, created] of seen) {
      if (created < now - maxAgeMs) seen.delete(id);
    }
  }

  return {
    accept(envelope: H2AEnvelope, now = Date.now()): H2AReplayCheck {
      const freshness = checkEnvelopeFreshness(envelope, {
        now,
        maxAgeMs,
        maxSkewMs
      });
      if (!freshness.ok) return freshness;

      prune(now);
      if (seen.has(envelope.id)) {
        return { ok: false, reason: "replayed" };
      }
      seen.set(envelope.id, Date.parse(envelope.createdAt));
      return { ok: true };
    },
    size(): number {
      return seen.size;
    }
  };
}
