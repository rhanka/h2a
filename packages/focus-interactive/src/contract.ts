// Focus L-B — the NEUTRAL deck contract.
//
// Defined FRESH here (NOT moved from, and NOT importing, the h2a canevas
// `aggregate.ts`). The shape is deliberately inspired by that module's form
// (`PendingDecision` / `DecisionSource` / `CHANNEL_RANK` + rank-then-time
// ordering) so a later lot can reconcile the two, but this package stays a
// pure, framework-free, h2a-free leaf (PLAN v2 §4.1, L-B).
//
// Differences from the canevas shape, on purpose:
//   - `decisionKey` (projectHash:source:decisionId, PLAN fix #5) is a FIRST-CLASS
//     field: it is the stable identity across N stacked projects (multi-focus).
//   - `CHANNEL_RANK` is EXPORTED (the canevas kept it module-private).
//   - Aggregation dedups by `decisionKey`, not by the raw `id`.

/** The urgency lane a decision belongs to. */
export type DecisionChannel = "advise" | "decide" | "alert";

/** Where a pending decision originates. Only these three are contract-stable;
 *  `escalate` is live today, `track`/`loop` are additive adapters (PLAN §4.1). */
export type DecisionSource = "escalate" | "track" | "loop";

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
}

/** How to reach the live session that raised the decision. Opaque to L-B;
 *  the L-C write-bridge re-resolves the live target server-side at reply. */
export interface DecisionSessionRef {
  readonly tmuxName?: string;
  readonly pane?: string;
  readonly sessionId?: string;
}

/** One pending human decision, normalized for the deck. Immutable data. */
export interface PendingDecision {
  /** projectHash:source:decisionId — stable identity across stacked projects. */
  readonly decisionKey: string;
  /** The raw decision id within its source/project (may repeat across projects). */
  readonly id: string;
  readonly source: DecisionSource;
  readonly channel?: DecisionChannel;
  /** The agent instance that raised the decision. */
  readonly instance: string;
  readonly workspace?: string;
  readonly question: string;
  readonly options?: readonly DecisionOption[];
  readonly sessionRef?: DecisionSessionRef;
  /** ISO-8601; "" when unknown (kept sortable). */
  readonly createdAt: string;
}

/** Ordering priority per channel: alert first, then decide, then advise. */
export const CHANNEL_RANK: Record<DecisionChannel, number> = {
  alert: 0,
  decide: 1,
  advise: 2
};

/** Rank used for a decision with no channel (sorts after every ranked channel). */
export const CHANNEL_RANK_NONE = 3;

/** PURE: the sort rank of a (possibly absent) channel. */
export function channelRank(channel?: DecisionChannel): number {
  return channel === undefined ? CHANNEL_RANK_NONE : CHANNEL_RANK[channel];
}

/**
 * PURE total order over pending decisions:
 *   1. channel priority (alert > decide > advise > none),
 *   2. `createdAt` ascending (oldest waiting first),
 *   3. `decisionKey` ascending (a stable tie-breaker → deterministic output).
 */
export function comparePendingDecisions(a: PendingDecision, b: PendingDecision): number {
  const byChannel = channelRank(a.channel) - channelRank(b.channel);
  if (byChannel !== 0) return byChannel;
  const byTime = a.createdAt.localeCompare(b.createdAt);
  if (byTime !== 0) return byTime;
  return a.decisionKey.localeCompare(b.decisionKey);
}

/**
 * PURE: de-duplicate by `decisionKey` (first occurrence wins) and return a
 * new, stably ordered list. Never mutates the input.
 */
export function aggregatePendingDecisions(
  decisions: readonly PendingDecision[]
): PendingDecision[] {
  const byKey = new Map<string, PendingDecision>();
  for (const d of decisions) {
    if (!byKey.has(d.decisionKey)) byKey.set(d.decisionKey, d);
  }
  return [...byKey.values()].sort(comparePendingDecisions);
}
