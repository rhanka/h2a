// Canevas ③ — PURE aggregation of pending human decisions.
//
// Zero IO, zero runtime import. The CLI/server shell gathers escalate-like
// envelopes (+ their live session) and this module maps + dedups + orders them
// into a stable `PendingDecision` list. Double-consensus (opus-4-8 + codex xhigh,
// 2026-07-03): read-only tranche-1, source `escalate` first; track/loop are
// additive adapters; the reply-bridge (write) is a later, gated tranche.

export type DecisionChannel = "advise" | "decide" | "alert";
export type DecisionSource = "escalate" | "track" | "loop";

export interface DecisionSessionRef {
  readonly tmuxName?: string;
  readonly pane?: string;
  readonly sessionId?: string;
}

export interface PendingDecision {
  readonly id: string;
  readonly source: DecisionSource;
  readonly channel?: DecisionChannel;
  readonly instance: string;
  readonly workspace?: string;
  readonly question: string;
  readonly options?: readonly { readonly id: string; readonly label: string }[];
  readonly sessionRef?: DecisionSessionRef;
  readonly createdAt: string;
}

// --- Minimal input shapes (kept local so the module stays pure/testable) -------
export interface EscalateLikeEnvelope {
  readonly id: string;
  readonly type: string;
  readonly actor?: { readonly instance?: string; readonly scope?: string };
  readonly body?: unknown;
  readonly createdAt?: string;
}

export interface AggregateSession {
  readonly instance?: string;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly launchContext?: { readonly tmux?: { readonly session?: string; readonly pane?: string } };
}

export interface AggregateEntry {
  readonly env: EscalateLikeEnvelope;
  readonly session?: AggregateSession;
}

const CHANNEL_RANK: Record<string, number> = { alert: 0, decide: 1, advise: 2 };

function stringifyQuestion(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const p = payload as { question?: unknown; text?: unknown };
    if (typeof p.question === "string") return p.question;
    if (typeof p.text === "string") return p.text;
    try {
      return JSON.stringify(payload);
    } catch {
      return "(decision)";
    }
  }
  return "(decision)";
}

function sessionRefOf(session?: AggregateSession): DecisionSessionRef | undefined {
  if (!session) return undefined;
  const ref: { tmuxName?: string; pane?: string; sessionId?: string } = {};
  if (session.launchContext?.tmux?.session) ref.tmuxName = session.launchContext.tmux.session;
  if (session.launchContext?.tmux?.pane) ref.pane = session.launchContext.tmux.pane;
  if (session.sessionId) ref.sessionId = session.sessionId;
  return Object.keys(ref).length > 0 ? ref : undefined;
}

/** PURE: map ONE escalate-like envelope to a PendingDecision, or null if it is
 *  not a decision-bearing escalate envelope. */
export function escalateToPendingDecision(entry: AggregateEntry): PendingDecision | null {
  const { env, session } = entry;
  if (env.type !== "escalate" || typeof env.id !== "string") return null;
  const instance = env.actor?.instance ?? session?.instance;
  if (!instance) return null;
  const body = env.body as { channel?: unknown; payload?: unknown } | undefined;
  const channel =
    body && typeof body.channel === "string" && body.channel in CHANNEL_RANK
      ? (body.channel as DecisionChannel)
      : undefined;
  const sessionRef = sessionRefOf(session);
  return {
    id: env.id,
    source: "escalate",
    ...(channel !== undefined ? { channel } : {}),
    instance,
    ...(session?.workspaceId !== undefined ? { workspace: session.workspaceId } : {}),
    question: stringifyQuestion(body?.payload),
    ...(sessionRef !== undefined ? { sessionRef } : {}),
    createdAt: env.createdAt ?? ""
  };
}

/**
 * PURE: aggregate escalate-like entries into an ordered, de-duplicated list of
 * pending decisions. Dedup by `id`. Order = channel priority (alert > decide >
 * advise > none) then `createdAt` ascending (oldest waiting first).
 */
export function aggregatePendingDecisions(entries: readonly AggregateEntry[]): PendingDecision[] {
  const byId = new Map<string, PendingDecision>();
  for (const entry of entries) {
    const decision = escalateToPendingDecision(entry);
    if (decision && !byId.has(decision.id)) byId.set(decision.id, decision);
  }
  const rank = (d: PendingDecision): number => (d.channel ? CHANNEL_RANK[d.channel] : 3);
  return [...byId.values()].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
