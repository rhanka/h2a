// Canevas ③ — IO gatherer (read-only). Collects escalate envelopes across the
// live instances' inboxes and returns the ordered, de-duplicated pending-decision
// list. Shared by `h2a canevas list` and the canevas server. No runtime import,
// no write.

import { listPresence } from "../local-files/presence.js";
import { createLocalStore } from "../local-files/store.js";
import { aggregatePendingDecisions, type AggregateEntry, type PendingDecision } from "./aggregate.js";

export function gatherPendingDecisions(root: string): PendingDecision[] {
  const store = createLocalStore({ root });
  const sessions = listPresence(root);
  const byInstance = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) {
    if (s.instance && !byInstance.has(s.instance)) byInstance.set(s.instance, s);
  }
  const entries: AggregateEntry[] = [];
  const seen = new Set<string>();
  for (const s of sessions) {
    if (!s.instance) continue;
    let envelopes;
    try {
      envelopes = store.readInbox(s.instance);
    } catch {
      continue;
    }
    for (const env of envelopes) {
      if (env.type !== "escalate" || seen.has(env.id)) continue;
      seen.add(env.id);
      const actorInstance = env.actor?.instance;
      const session = actorInstance ? byInstance.get(actorInstance) : undefined;
      entries.push({ env, ...(session ? { session } : {}) });
    }
  }
  return aggregatePendingDecisions(entries);
}
