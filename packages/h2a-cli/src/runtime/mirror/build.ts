/**
 * EVO-13 P1 — build an "instance mirror": the local instance's OWN registration,
 * wrapped in an h2a envelope ready to be signed and pushed to a remote h2a so
 * its read-only surface (`h2a_discover_instances`) reflects this live agent.
 *
 * P1 replicates instances only (registry). Presence (P2) and NHI (P3) extend the
 * same envelope with more event kinds. The private key never leaves the agent;
 * `buildInstanceMirror` returns an UNSIGNED envelope — the caller signs it with
 * `signEnvelope` (DEC-116: possession of the key is the sole authority anchor).
 */
import {
  H2A_PROTOCOL,
  H2A_VERSION,
  type H2AActorRegistration,
  type H2AEnvelope,
  type H2ASession
} from "@sentropic/h2a";

import { listPresence, type LocalStore } from "../local-files/index.js";

export const H2A_MIRROR_BODY_KIND = "mirror.instances" as const;

export interface H2AInstanceMirrorBody {
  readonly kind: typeof H2A_MIRROR_BODY_KIND;
  /** Append-only registration events. P1: the sender's own registration only. */
  readonly registrations: H2AActorRegistration[];
  /**
   * P2: the sender's live sessions. The remote RE-STAMPS `heartbeatAt` with its
   * own clock on arrival (freshness is derived from the mirror beat, not the
   * local clock — no ghost/skew/resurrection). Omitted in P1-only callers.
   */
  readonly presence?: H2ASession[];
  /**
   * P2: monotonic per-instance sequence (the CLI uses epoch ms — increases
   * across restarts). The remote rejects a mirror with `seq <= last applied`
   * (fencing), so a replayed older beat cannot resurrect stale presence.
   */
  readonly seq?: number;
}

/**
 * Build the unsigned mirror envelope for `instance` from the local store.
 * `nowMs` is injected (epoch ms) so the id + createdAt + seq are deterministic
 * in tests; the CLI verb passes `Date.now()`. Includes the instance's own live
 * sessions (P2) so the remote can derive its presence.
 */
export function buildInstanceMirror(
  store: LocalStore,
  instance: string,
  nowMs: number
): H2AEnvelope<H2AInstanceMirrorBody> {
  const reg = store.findInstance(instance);
  if (!reg) throw new Error(`mirror: unknown local instance ${instance}`);
  const presence = listPresence(store.paths.root, { now: nowMs }).filter(
    (s) => s.instance === instance
  );
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    id: `mirror:${instance}:${nowMs}`,
    type: "event",
    actor: { instance, role: reg.roles?.[0] ?? "AGENTS", scope: "scope:default" },
    target: { instance },
    body: { kind: H2A_MIRROR_BODY_KIND, registrations: [reg], presence, seq: nowMs },
    createdAt: new Date(nowMs).toISOString()
  };
}
