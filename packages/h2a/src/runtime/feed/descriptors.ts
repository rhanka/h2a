/**
 * h2a → sentropic session-exposure feed — DESCRIPTOR BUILDERS (P1, step 1).
 *
 * Implements Part A of the ratified contract
 * `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md`
 * (RATIFIED by the sentropic architect, 2026-07-24, with three binding
 * conditions accepted). Sentropic owns the multi-tenant gateway, the 39-auth
 * broker and the UI panel; this module is h2a's own surface only.
 *
 * Everything here is PURE: presence records + registrations in, opaque
 * descriptors out. No I/O, no network, no auth, no push, and never a clock —
 * `asOf` is always injected by the caller, so every derivation is
 * deterministic and unit-testable.
 *
 * Governing rule of the contract, enforced structurally in this module:
 * *if a field can't be shown safely in a browser, it doesn't belong in the
 * feed.* No message bodies, no negotiation content, no keys or tokens, and no
 * filesystem path — `workspaceLabel` reads `H2AWorkspaceRef.label` and NEVER
 * `.path` or `launchContext.cwd` (Part A, "Opacity boundary", non-negotiable).
 *
 * NOT wired into the hosted MCP handlers yet: that is step 5 of the P1 plan and
 * is gated on the architecture lane's per-principal root partition (Part C).
 */
import {
  H2A_SESSION_DEFAULT_EXPIRY_MS,
  deriveConnectionConfidence,
  isSessionExpired,
  type H2AActorRegistration,
  type H2ARole,
  type H2ASession
} from "@sentropic/h2a";

/**
 * Per-descriptor liveness. `stale` is NOT a synonym for `idle`: see
 * {@link deriveLiveness} — it is a FEED-PIPELINE freshness signal, not an agent
 * state.
 */
export type H2ALivenessState = "live" | "idle" | "stale" | "closed";

/** An agent instance as it may be rendered in a browser. Opaque, non-secret. */
export interface InstanceDescriptor {
  /**
   * `H2ASession.instance` / `H2AActorRegistration.instance` — the addressable
   * `host:slug(label):uuid12` handle frozen at mint (DEC-114). Shown verbatim
   * because P1 is "read your OWN data": this is the resource id of the
   * principal's own agent, not a counterpart reference.
   */
  readonly instanceId: string;
  readonly displayName: string;
  readonly host: string;
  readonly role: H2ARole;
  /** Human label only. NEVER a filesystem path (Part A, opacity boundary). */
  readonly workspaceLabel: string;
  /**
   * Ratification condition #3: a DECLARED, NON-AUTHORITATIVE DISPLAY LIST
   * ONLY. It is self-reported by the agent at registration and MUST NEVER be
   * an input to any authorization decision — authorization stays
   * principal-binding + server-side scoping (Part B).
   */
  readonly capabilities: readonly string[];
  /** ISO 8601 — max heartbeat across this instance's known sessions. */
  readonly lastSeen: string;
  readonly liveness: H2ALivenessState;
}

/** A session as it may be rendered in a browser. Opaque, non-secret. */
export interface SessionDescriptor {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly topicOrTitle: string;
  readonly state: "open" | "idle" | "closed";
  /** ISO 8601 — `H2ASession.startedAt`. */
  readonly openedAt: string;
  /** ISO 8601 — see {@link SessionDescriptor.activitySource} for provenance. */
  readonly lastActivityAt: string;
  /**
   * Ratification condition #2: discriminates proven MCP traffic
   * (`lastMcpActivityAt`, WP-F) from a bare heartbeat fallback, so a consumer
   * can NEVER present "process alive" as "proven channel activity" by
   * omission. The gateway/UI MUST render `'heartbeat'` as advisory.
   */
  readonly activitySource: "mcp" | "heartbeat";
  /**
   * Other parties' handles, opacified. Always `[]` for P1: per the contract's
   * Gaps §2, no h2a structure records "who is this session in contact with",
   * and negotiations are not mirrored yet (EVO-13 scopes
   * `h2a_conflict_posture` out until they are). `[]` is ACCURATE, not
   * fabricated. When a derivation lands, the raw `instance:` routing string is
   * never emitted — the feed server opacifies it with a server-held,
   * per-principal salt (ratification condition #1) that is stable within a
   * principal but not enumerable or reversible into a routable bus address.
   */
  readonly counterpartsOpaqueRefs: readonly string[];
}

/**
 * The feed envelope (Part C). `asOf` is what makes staleness checkable by the
 * consumer: the gateway/UI renders the `liveness`/`state` the feed computed and
 * never re-derives liveness from wall-clock arithmetic of its own.
 */
export interface H2AFeedResponse {
  /** ISO 8601 — the feed's own read timestamp. */
  readonly asOf: string;
  readonly instances: readonly InstanceDescriptor[];
  readonly sessions: readonly SessionDescriptor[];
}

/** Shown when neither a session nor a registration carries a human label. */
const UNKNOWN_LABEL = "unknown";

/**
 * Fallback role. `identity/live.ts` `ensureRegistered` writes `roles:
 * ["AGENTS"]` at mint, so this only applies to a session with no registration
 * at all (contract Gaps §3: the field is narrow-range, not missing).
 */
const DEFAULT_ROLE: H2ARole = "AGENTS";

/** Input common to every builder. `asOf` is injected — never `Date.now()`. */
export interface BuildFeedInput {
  /** The feed's read timestamp, in epoch ms. */
  readonly asOf: number;
  /** Presence records, e.g. from `listPresence(root)`. */
  readonly sessions: readonly H2ASession[];
  /** Registry rows, e.g. from `store.listInstances()`. Optional. */
  readonly registrations?: readonly H2AActorRegistration[];
  /**
   * The mirror push daemon's interval (ms). Only meaningful for MIRRORED rows:
   * it is what makes `stale` computable (Part C). Absent → no row is `stale`.
   */
  readonly pushIntervalMs?: number;
}

function parseIso(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : at;
}

function heartbeatMs(session: H2ASession): number {
  return parseIso(session.heartbeatAt) ?? 0;
}

/**
 * The ONLY reader of a workspace reference in this module, and it reads
 * `label` exclusively. `H2AWorkspaceRef.path` and `H2ALaunchContext.cwd` are
 * filesystem paths and are excluded from the feed by design — this indirection
 * is what keeps that exclusion structural instead of a review-time hope.
 */
function labelOf(workspace: { readonly label?: string } | undefined): string | undefined {
  const label = workspace?.label;
  return typeof label === "string" && label.length > 0 ? label : undefined;
}

/** Sessions of one instance, most recent heartbeat first. */
function sessionsOfInstance(
  sessions: readonly H2ASession[],
  instanceId: string
): H2ASession[] {
  return sessions
    .filter((session) => session.instance === instanceId)
    .sort((a, b) => heartbeatMs(b) - heartbeatMs(a));
}

/**
 * Session state per the contract's code block. Reuses h2a's existing
 * primitives — the 90s keepalive window that already gates
 * `h2a_discover_sessions`, and WP-F connection confidence. Nothing about
 * freshness is reimplemented here.
 */
export function deriveSessionState(
  session: H2ASession,
  asOf: number
): "open" | "idle" | "closed" {
  if (session.state === "closed" || session.state === "expired") return "closed";
  if (isSessionExpired(session, { now: asOf, expiryMs: H2A_SESSION_DEFAULT_EXPIRY_MS })) {
    return "closed";
  }
  const confidence = deriveConnectionConfidence(session, { now: asOf });
  // "idle-uncertain" and "unknown" both read as idle: the process lives but the
  // MCP channel has carried no proven traffic.
  return confidence === "active" ? "open" : "idle";
}

/**
 * Liveness per the contract's code block. Same two primitives as
 * {@link deriveSessionState}, plus the one distinction `state` does not need:
 * `stale`.
 *
 * `stale` is the FEED PIPELINE's own freshness bleeding into a row, not an
 * agent state. A directly-observed local session (no `mirroredAt`) is NEVER
 * `stale` — the same-machine clock is trustworthy, so it goes straight to
 * live/idle/closed. A replicated row is `stale` when the daemon that should
 * keep refreshing it has gone quiet for more than 2x its push interval: at
 * that point the numerically "fresh" `heartbeatAt`/`lastMcpActivityAt` carried
 * in the record can no longer be trusted the way a live local read can, so the
 * honest label is "we don't know", not "live".
 */
export function deriveLiveness(
  session: H2ASession,
  asOf: number,
  pushIntervalMs?: number
): H2ALivenessState {
  if (session.state === "closed" || session.state === "expired") return "closed";
  if (isSessionExpired(session, { now: asOf, expiryMs: H2A_SESSION_DEFAULT_EXPIRY_MS })) {
    return "closed";
  }

  // Replicated/mirrored record (Part C's push-to-root path): `heartbeatAt` is
  // re-stamped with the receiving clock on ingest, but the payload's own
  // `lastMcpActivityAt` is a LOCAL clock value copied through verbatim — it is
  // NOT proof of current liveness once the pipeline itself may have gone quiet.
  if (session.mirroredAt && pushIntervalMs) {
    const mirroredAt = parseIso(session.mirroredAt);
    if (mirroredAt !== undefined && asOf - mirroredAt > 2 * pushIntervalMs) {
      return "stale"; // pipeline lag, not agent state
    }
  }

  const confidence = deriveConnectionConfidence(session, { now: asOf });
  return confidence === "active" ? "live" : "idle";
}

/** Best-of ranking for the instance-level roll-up: live > idle > stale > closed. */
const LIVENESS_RANK: Record<H2ALivenessState, number> = {
  live: 3,
  idle: 2,
  // "we don't know" ranks below a KNOWN idle, and above a known-closed row.
  stale: 1,
  closed: 0
};

/**
 * Roll several sessions' liveness up to their instance: best-of, per Part A
 * ("Best-of across the instance's sessions"). An instance with no session at
 * all reads `closed` — absence is not liveness.
 */
export function rollUpLiveness(states: readonly H2ALivenessState[]): H2ALivenessState {
  let best: H2ALivenessState = "closed";
  for (const state of states) {
    if (LIVENESS_RANK[state] > LIVENESS_RANK[best]) best = state;
  }
  return best;
}

export interface BuildSessionDescriptorOptions {
  readonly asOf: number;
  /** Registration owning this session, when known — used for name fallbacks. */
  readonly registration?: H2AActorRegistration | undefined;
}

/**
 * One presence record → one `SessionDescriptor`.
 *
 * `lastActivityAt` prefers `lastMcpActivityAt` (WP-F: proof the MCP channel
 * carried real traffic) and falls back to `heartbeatAt`. The fallback is
 * advisory-only — a live process, not proven channel activity — which is why
 * `activitySource` is baked into the descriptor rather than left to the
 * consumer's inference (ratification condition #2).
 */
export function buildSessionDescriptor(
  session: H2ASession,
  options: BuildSessionDescriptorOptions
): SessionDescriptor {
  const registration = options.registration;
  const workspaceLabel =
    labelOf(session.workspace) ?? labelOf(registration?.workspace) ?? UNKNOWN_LABEL;
  // DEC-114 per-session mutable display name (host-native customTitle /
  // thread_name, or `/rename`). May legitimately diverge from the owning
  // instance's displayName — a session can be renamed independently.
  const topicOrTitle = session.name ?? registration?.name ?? workspaceLabel;

  const mcpActivityAt = parseIso(session.lastMcpActivityAt);
  const provenMcp = mcpActivityAt !== undefined;

  return {
    sessionId: session.sessionId,
    instanceId: session.instance,
    topicOrTitle,
    state: deriveSessionState(session, options.asOf),
    openedAt: session.startedAt,
    lastActivityAt: provenMcp
      ? (session.lastMcpActivityAt as string)
      : session.heartbeatAt,
    activitySource: provenMcp ? "mcp" : "heartbeat",
    // P1: always empty — see the field's own doc comment (contract Gaps §2).
    counterpartsOpaqueRefs: []
  };
}

export interface BuildInstanceDescriptorOptions {
  readonly asOf: number;
  /** This instance's presence records; any order. */
  readonly sessions: readonly H2ASession[];
  readonly registration?: H2AActorRegistration | undefined;
  readonly pushIntervalMs?: number | undefined;
}

/**
 * One instance (+ its sessions) → one `InstanceDescriptor`.
 *
 * `displayName` order per Part A: the registration's DEC-114 mutable name,
 * then the most recent LIVE session's host-native name (WP-6), then the
 * workspace label. `lastSeen` is the max heartbeat across the instance's
 * sessions. `host` comes from the most recent session's host hint.
 */
export function buildInstanceDescriptor(
  instanceId: string,
  options: BuildInstanceDescriptorOptions
): InstanceDescriptor {
  const registration = options.registration;
  const ordered = [...options.sessions].sort((a, b) => heartbeatMs(b) - heartbeatMs(a));
  const mostRecent = ordered[0];

  const workspaceLabel =
    labelOf(mostRecent?.workspace) ??
    ordered.map((session) => labelOf(session.workspace)).find((label) => label !== undefined) ??
    labelOf(registration?.workspace) ??
    UNKNOWN_LABEL;

  const liveSessionName = ordered
    .filter((session) => deriveSessionState(session, options.asOf) !== "closed")
    .map((session) => session.name)
    .find((name) => typeof name === "string" && name.length > 0);
  const displayName = registration?.name ?? liveSessionName ?? workspaceLabel;

  const host =
    mostRecent?.host ??
    ordered.map((session) => session.host).find((value) => typeof value === "string") ??
    // A workspace ref carries the host CLI hint that observed it; it is a hint,
    // never a path.
    mostRecent?.workspace?.host ??
    registration?.workspace?.host ??
    UNKNOWN_LABEL;

  const lastSeenMs = ordered.reduce((max, session) => Math.max(max, heartbeatMs(session)), 0);
  const lastSeen =
    lastSeenMs > 0 ? new Date(lastSeenMs).toISOString() : (registration?.createdAt ?? "");

  const liveness = rollUpLiveness(
    ordered.map((session) => deriveLiveness(session, options.asOf, options.pushIntervalMs))
  );

  return {
    instanceId,
    displayName,
    host,
    role: registration?.roles?.[0] ?? DEFAULT_ROLE,
    workspaceLabel,
    // Declared display list only — never an authorization input (condition #3).
    capabilities: [...(registration?.capabilities ?? [])],
    lastSeen,
    liveness
  };
}

/** Every instance id mentioned by a presence record or a registration. */
function instanceIds(input: BuildFeedInput): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined): void => {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const registration of input.registrations ?? []) push(registration.instance);
  for (const session of input.sessions) push(session.instance);
  return ids;
}

function registrationIndex(
  registrations: readonly H2AActorRegistration[] | undefined
): Map<string, H2AActorRegistration> {
  const index = new Map<string, H2AActorRegistration>();
  for (const registration of registrations ?? []) {
    if (!index.has(registration.instance)) index.set(registration.instance, registration);
  }
  return index;
}

/** Presence + registry → `InstanceDescriptor[]`, ordered by `lastSeen` desc. */
export function buildInstanceDescriptors(input: BuildFeedInput): InstanceDescriptor[] {
  const index = registrationIndex(input.registrations);
  return instanceIds(input)
    .map((instanceId) =>
      buildInstanceDescriptor(instanceId, {
        asOf: input.asOf,
        sessions: sessionsOfInstance(input.sessions, instanceId),
        registration: index.get(instanceId),
        pushIntervalMs: input.pushIntervalMs
      })
    )
    .sort((a, b) => (parseIso(b.lastSeen) ?? 0) - (parseIso(a.lastSeen) ?? 0));
}

/** Presence + registry → `SessionDescriptor[]`, ordered by last activity desc. */
export function buildSessionDescriptors(input: BuildFeedInput): SessionDescriptor[] {
  const index = registrationIndex(input.registrations);
  return input.sessions
    .map((session) =>
      buildSessionDescriptor(session, {
        asOf: input.asOf,
        registration: index.get(session.instance)
      })
    )
    .sort((a, b) => (parseIso(b.lastActivityAt) ?? 0) - (parseIso(a.lastActivityAt) ?? 0));
}

/**
 * Presence + registry → the whole `H2AFeedResponse`.
 *
 * The caller decides WHICH sessions and registrations to hand in — this
 * function never widens that set, and (per P1) principal scoping happens
 * server-side before the call, never here.
 */
export function buildFeedResponse(input: BuildFeedInput): H2AFeedResponse {
  return {
    asOf: new Date(input.asOf).toISOString(),
    instances: buildInstanceDescriptors(input),
    sessions: buildSessionDescriptors(input)
  };
}
