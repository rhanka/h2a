/**
 * EVO-1 inbox-wake — pure decision core (durable bug #3). Given the ids already
 * woken on and the current inbox, decide whether there is something new and
 * format an **h2a-tagged, human-visible wake line** to inject into an idle host.
 *
 * Pure + dep-free (no store, no clock — `nowIso` is injected). The process /
 * driver wiring (mcp-serve --wake hook, watch-inbox loop) lives in @sentropic/h2a
 * and reuses nativeBackchannelDriver + formatSignedDriveInstruction.
 */
import type { H2AEnvelope } from "./types.js";

export const H2A_WAKE_REASON_INBOX = "inbox" as const;

export interface InboxWakeInput {
  /** Envelope ids already woken on (persisted across ticks). */
  readonly seen: readonly string[];
  readonly inbox: readonly H2AEnvelope[];
  /** Reference time (ISO) stamped in the wake tag — injected for determinism. */
  readonly nowIso: string;
}

export interface InboxWakeDecision {
  /** New (unseen) envelopes that triggered the wake. */
  readonly fresh: H2AEnvelope[];
  /** The wake line to inject (tag + neutral sentence). */
  readonly wake: string;
  /** Updated seen set (prior + fresh ids) for the next tick. */
  readonly seen: string[];
}

function bodyTopic(envelope: H2AEnvelope): string {
  const body = envelope.body as { topic?: unknown; kind?: unknown } | undefined;
  const raw =
    body && typeof body.topic === "string"
      ? body.topic
      : body && typeof body.kind === "string"
        ? body.kind
        : "message";
  return raw.replace(/\s+/g, "_");
}

/**
 * Format the wake line. The bracketed tag is machine-parseable + always visible
 * (no silent injection); the sentence is the neutral human reason.
 */
export function formatWakeLine(fresh: readonly H2AEnvelope[], nowIso: string): string {
  if (fresh.length === 1) {
    const e = fresh[0];
    return (
      `[h2a-wake reason=${H2A_WAKE_REASON_INBOX} from=${e.actor.instance} topic=${bodyTopic(e)} at=${nowIso}] ` +
      `automatic message from h2a — 1 new inbox envelope; run /h2a receive to process.`
    );
  }
  return (
    `[h2a-wake reason=${H2A_WAKE_REASON_INBOX} count=${fresh.length} at=${nowIso}] ` +
    `automatic message from h2a — ${fresh.length} new inbox envelopes; run /h2a receive to process.`
  );
}

/** Decide a wake from new inbox envelopes; null when nothing is unseen. */
export function decideInboxWake(input: InboxWakeInput): InboxWakeDecision | null {
  const seenSet = new Set(input.seen);
  const fresh = input.inbox.filter((e) => !seenSet.has(e.id));
  if (fresh.length === 0) return null;
  return {
    fresh,
    wake: formatWakeLine(fresh, input.nowIso),
    seen: [...input.seen, ...fresh.map((e) => e.id)]
  };
}
