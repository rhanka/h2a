/**
 * EVO-13 P1 — build an "instance mirror": the local instance's OWN registration,
 * wrapped in an h2a envelope ready to be signed and pushed to a remote h2a so
 * its read-only surface (`h2a_discover_instances`) reflects this live agent.
 *
 * P1 replicates instances only (registry). Presence (P2) and NHI (P3) extend the
 * same envelope with more event kinds. The private key never leaves the agent;
 * `buildInstanceMirror` returns an UNSIGNED envelope — the caller signs it with
 * `signEnvelope` (DEC-116: possession of the key is the sole authority anchor).
 *
 * SEND BOUNDARY: nothing local reaches the body verbatim. Every member goes
 * through `sanitize.ts`, which ALLOWLISTS the fields that may leave the machine
 * — so `launchContext.cwd`, the command line, the tmux coordinates, the pid,
 * `workspace.path` and `file://` endpoint uris do not travel. This happens
 * BEFORE signing, so the signature still covers exactly what is transmitted.
 *
 * The ENVELOPE is inside that boundary too, which it was not at first. `actor`
 * is built from the SANITIZED registration by `sanitizeActorForMirror`, not from
 * the raw registry row — see the note in `sanitize.ts`. The other envelope
 * fields really are constants, the instance id, or the injected clock.
 */
import { H2A_PROTOCOL, H2A_VERSION, type H2AEnvelope } from "@sentropic/h2a";

import { listPresence, type LocalStore } from "../local-files/index.js";
import {
  sanitizeActorForMirror,
  sanitizePresenceForMirror,
  sanitizeRegistrationForMirror,
  sanitizeSubagentForMirror,
  type H2AMirroredRegistration,
  type H2AMirroredSession,
  type H2AMirroredSubagentBinding
} from "./sanitize.js";

export const H2A_MIRROR_BODY_KIND = "mirror.instances" as const;

/**
 * The mirror payload. Every member is a `H2AMirrored*` type, NOT the local
 * record type: the send boundary narrows what leaves the machine, and the wire
 * types are what make that structural rather than a review-time hope. See
 * `sanitize.ts` for the field plans and for why an allowlist (not a scrub) is
 * the only version of this that stays correct as the local types grow.
 */
export interface H2AInstanceMirrorBody {
  readonly kind: typeof H2A_MIRROR_BODY_KIND;
  /** Append-only registration events. P1: the sender's own registration only. */
  readonly registrations: H2AMirroredRegistration[];
  /**
   * P2: the sender's live sessions. The remote RE-STAMPS `heartbeatAt` with its
   * own clock on arrival (freshness is derived from the mirror beat, not the
   * local clock — no ghost/skew/resurrection). Omitted in P1-only callers.
   */
  readonly presence?: H2AMirroredSession[];
  /**
   * P2: monotonic per-instance sequence (the CLI uses epoch ms — increases
   * across restarts). The remote rejects a mirror with `seq <= last applied`
   * (fencing), so a replayed older beat cannot resurrect stale presence.
   */
  readonly seq?: number;
  /**
   * P3: the sender's subagent bindings (NHI inventory). Append-only on the
   * remote (idempotent — re-mirroring a known binding is a no-op). Only bindings
   * whose `parentInstance` the verified key owns are applied. Omitted in P1/P2.
   */
  readonly subagents?: H2AMirroredSubagentBinding[];
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
  // Sanitize EVERY member at the send boundary. `sanitize*ForMirror` iterates a
  // field plan, so a field added to the local record later cannot travel until
  // it is explicitly classified (an omission fails the build, not a review).
  const presence = listPresence(store.paths.root, { now: nowMs })
    .filter((s) => s.instance === instance)
    .map(sanitizePresenceForMirror);
  const subagents = store.listSubagentsOf(instance).map(sanitizeSubagentForMirror);
  // Sanitize ONCE and reuse, so the envelope's `actor` is derived from the same
  // narrowed record the body carries. The actor used to be assembled from `reg`
  // directly (`role: reg.roles?.[0]`), which put a source record's field on the
  // wire outside every field plan — the envelope was the one place with no plan
  // and no ratchet. `sanitizeActorForMirror` takes the MIRRORED registration, so
  // the raw record is not reachable from it at all.
  const mirroredReg = sanitizeRegistrationForMirror(reg);
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    id: `mirror:${instance}:${nowMs}`,
    type: "event",
    actor: sanitizeActorForMirror(instance, mirroredReg),
    target: { instance },
    body: {
      kind: H2A_MIRROR_BODY_KIND,
      registrations: [mirroredReg],
      presence,
      seq: nowMs,
      subagents
    },
    createdAt: new Date(nowMs).toISOString()
  };
}
