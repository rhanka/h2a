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
  H2A_ROLES,
  H2A_SESSION_DEFAULT_EXPIRY_MS,
  deriveConnectionConfidence,
  isSessionExpired,
  sanitizeDeclaredCapabilities,
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
  /**
   * `H2AActorRegistration.roles[0]` **validated against `H2A_ROLES` on read**,
   * or the literal `'unknown'` when the instance has no registration, declares
   * no role, or declares a string outside the enum.
   *
   * The union is deliberate (architect ruling, 2026-07-25): a MISSING role must
   * never be rendered as a real `H2ARole`. Synthesizing e.g. `'AGENTS'` would be
   * indistinguishable from an asserted claim, so once real roles land
   * (PRINCIPAL/CONDUCTOR/CONTROL) an absent role would silently read as a
   * genuine claim of authority and no consumer could tell the two apart.
   *
   * Validation on READ is what makes the union true on the wire whoever wrote
   * the registry: the store re-validates nothing on read, `mirror/accept.ts`
   * authorizes a mirrored registration by key ownership without constraining its
   * content, and `mcp/handlers.ts` applies a caller-supplied registration. A
   * `'SUPERADMIN'` planted by any of those paths must surface as `'unknown'`,
   * never as an out-of-union string in a typed consumer.
   */
  readonly role: H2ARole | "unknown";
  /** Human label only. NEVER a filesystem path (Part A, opacity boundary). */
  readonly workspaceLabel: string;
  /**
   * Ratification condition #3: a DECLARED, NON-AUTHORITATIVE DISPLAY LIST
   * ONLY. Self-reported by the agent at registration, and it MUST NEVER be an
   * input to any authorization decision — authorization stays principal-binding
   * + server-side scoping (Part B).
   *
   * The NAME carries that semantic on purpose (architect ruling, 2026-07-25):
   * the field is sourced from `H2AActorRegistration.declaredCapabilities` and
   * never from the authority-bearing `capabilities`, which is the subagent
   * ceiling and the attestation right. The whole defect this rename closes was
   * ambiguity between "display list" and "authz list", so the wire field does
   * not keep the ambiguous name.
   *
   * ALLOWLISTED on read: values are intersected with the closed vocabulary
   * `H2A_DECLARED_CAPABILITIES`, so only known members survive. It is an
   * intersection, never a denylist — nothing here strips `/home/` or PEM
   * markers, because a denylist is whack-a-mole and loses to the next encoding.
   * Anything outside the vocabulary was never a valid declaration and is
   * dropped silently.
   */
  readonly declaredCapabilities: readonly string[];
  /**
   * ISO 8601 — max heartbeat across this instance's known sessions, or
   * `'unknown'` when no session carries a parseable heartbeat. NEVER the
   * registration's mint time: reporting a `createdAt` as "last seen" would be an
   * unearned freshness claim, the same class the Q1 ruling rejected.
   */
  readonly lastSeen: string;
  readonly liveness: H2ALivenessState;
}

/** A session as it may be rendered in a browser. Opaque, non-secret. */
export interface SessionDescriptor {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly topicOrTitle: string;
  readonly state: "open" | "idle" | "closed";
  /**
   * ISO 8601 — `H2ASession.startedAt`, or `'unknown'` when it is missing or
   * unparseable. Validated on read for the same reason `role` is: the contract
   * types this field as ISO 8601, and a presence record written by any other
   * path must not be able to put arbitrary text in an ISO-typed field.
   */
  readonly openedAt: string;
  /**
   * ISO 8601, or `'unknown'` when neither source carries a parseable timestamp.
   * See {@link SessionDescriptor.activitySource} for provenance.
   */
  readonly lastActivityAt: string;
  /**
   * Ratification condition #2: discriminates proven MCP traffic
   * (`lastMcpActivityAt`, WP-F) from a bare heartbeat fallback, so a consumer
   * can NEVER present "process alive" as "proven channel activity" by
   * omission. The gateway/UI MUST render `'heartbeat'` as advisory.
   */
  readonly activitySource: "mcp" | "heartbeat";
  /**
   * Other parties' handles, opacified. Empty for P1 — and empty as an
   * ESTABLISHED FACT, produced by the explicit branch in
   * `counterpartsOpaqueRefsFor()` rather than by a literal default: per the
   * contract's Gaps §2 no h2a structure records "who is this session in contact
   * with", and negotiations are not mirrored yet (EVO-13 scopes
   * `h2a_conflict_posture` out until they are). So `[]` here means "there is no
   * counterpart source at all", never "we did not look". When a derivation lands, the raw `instance:` routing string is
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
  /**
   * Empty means "we looked and this principal has nothing" — an established
   * fact, never a default: the builders throw if a source was not read, so a
   * broken presence read can never surface here as "no agents". A consumer may
   * therefore trust an empty feed the same way it trusts a populated one.
   */
  readonly instances: readonly InstanceDescriptor[];
  /** Empty carries the same established-fact meaning as `instances`. */
  readonly sessions: readonly SessionDescriptor[];
}

/**
 * The single "not declared" sentinel for every string field whose source may be
 * absent. Safe precisely because it can never collide with a real value: no
 * workspace label, host hint or `H2A_ROLES` member is the literal `unknown`, so
 * a consumer can always tell an undeclared field from an asserted one, and a
 * row is NEVER dropped to hide one (a dropped row would be a false negative on
 * presence, and would collide with the ratified "empty arrays = nothing
 * enrolled" semantic). Architect ruling, 2026-07-25.
 */
const UNKNOWN = "unknown";

/**
 * AN EMPTY COLLECTION ON THE WIRE IS A FACTUAL CLAIM — "there is nothing" — so
 * it must be produced by code that actually ESTABLISHED that fact. A default
 * cannot establish a fact.
 *
 * That is why nothing in this module reaches the wire through `?? []`, `|| []`
 * or an equivalent tail: a DEFAULTED empty array is indistinguishable from an
 * errored read, a silently-empty query, and a lookup that was never performed.
 * Every empty value below is a named constant returned from an explicit branch,
 * and an *unread* source is a THROWN ERROR rather than an empty feed. (Amendment
 * accepted by the architect, 2026-07-25, raised by the sentropic auth lane; it
 * governs this feed as well as the binding resolver. Same discipline as
 * `isoOrUnknown`/`nonEmpty` for scalars, extended to collections.)
 */
const NO_COUNTERPART_SOURCE_IN_P1: readonly string[] = Object.freeze([]);

/** Nothing was declared: absent registration, or the field is absent/empty. */
const NOTHING_DECLARED: readonly string[] = Object.freeze([]);

/**
 * Whether ANY counterpart source is wired into this build.
 *
 * P1: none exists — no h2a structure records "who is this session is in contact
 * with", and negotiations are not mirrored (contract Gaps §2; EVO-13 scopes
 * `h2a_conflict_posture` out until they are). Typed `boolean` deliberately so
 * both branches of {@link counterpartsOpaqueRefsFor} stay reachable to the type
 * checker.
 */
const COUNTERPART_SOURCE_WIRED: boolean = false;

/**
 * `counterpartsOpaqueRefs` for one session, from an EXPLICIT branch.
 *
 * The empty list is P1's answer to a question we can actually answer: there is
 * no source at all, so "no counterparts" is established rather than assumed.
 * When a source IS wired, its derivation must be added ABOVE the throw — the
 * empty case must never become reachable by falling through, because from that
 * point on an empty list would mean "we did not look" while claiming "there are
 * none".
 */
function counterpartsOpaqueRefsFor(): readonly string[] {
  if (!COUNTERPART_SOURCE_WIRED) return NO_COUNTERPART_SOURCE_IN_P1;
  throw new Error(
    "h2a feed: a counterpart source is wired but no derivation is implemented — " +
      "refusing to emit an empty counterpart list that would read as 'no counterparts'"
  );
}

/**
 * Guard a collection the caller was supposed to have READ.
 *
 * A missing array is not an empty one: it means the read never happened or it
 * failed. Rendering that as an empty feed would tell the owner "you have no
 * agents" on the strength of a broken read, so fail loudly instead. This is the
 * one place the pure builders can enforce the distinction, since the read itself
 * happens in the caller.
 */
function requireRead<T>(value: readonly T[] | undefined, source: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `h2a feed: ${source} was not read (got ${value === undefined ? "undefined" : typeof value}) — ` +
        "an unread source must never render as an empty feed"
    );
  }
  return value;
}

/**
 * The instance's declared display list, from an explicit branch on whether a
 * declaration exists at all — never a `?? []` tail.
 */
function declaredCapabilitiesOf(
  registration: H2AActorRegistration | undefined
): readonly string[] {
  if (registration === undefined) return NOTHING_DECLARED;
  if (registration.declaredCapabilities === undefined) return NOTHING_DECLARED;
  // Present: ALLOWLIST it (intersection with the closed vocabulary). An empty
  // result here is also a fact — every value offered was outside the vocabulary.
  return sanitizeDeclaredCapabilities(registration.declaredCapabilities);
}

/** Input common to every builder. `asOf` is injected — never `Date.now()`. */
export interface BuildFeedInput {
  /** The feed's read timestamp, in epoch ms. */
  readonly asOf: number;
  /**
   * Presence records, e.g. from `listPresence(root)`. **Required to be an
   * array**: an empty feed must mean "we looked and there is nothing", so a
   * missing/failed read throws instead of rendering as "no agents".
   */
  readonly sessions: readonly H2ASession[];
  /**
   * Registry rows, e.g. from `store.listInstances()`. **Required, and required
   * to be an array**: a caller with no registry must pass `[]` DELIBERATELY,
   * which is a claim ("I looked, the registry is empty"). Omitting it — or
   * passing the result of a failed read — throws rather than quietly producing a
   * feed that says the owner has no agents.
   */
  readonly registrations: readonly H2AActorRegistration[];
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
 * A present, non-empty string, or `undefined`.
 *
 * Used by every fallback chain in this module so `""` behaves like absence
 * everywhere. Without it the `'unknown'` sentinel is defeated by an empty
 * string: `h2a connect --name ""` writes `registration.name === ""`, and a `??`
 * chain would happily emit that as the displayName.
 */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The ONLY reader of a workspace reference in this module — the whole ref
 * reaches exactly this function, which returns `label` and nothing else.
 * `H2AWorkspaceRef.path` and `H2ALaunchContext.cwd` are filesystem paths,
 * excluded from the feed by design, and this single choke point is what makes
 * that exclusion structural rather than a review-time hope.
 *
 * The claim is only true while it is literally the only reader: an earlier
 * revision of this file also read `workspace?.host` directly at the instance
 * builder, which made the comment overstate the guarantee. Do not add a second
 * reader; extend this one.
 */
function labelOf(workspace: { readonly label?: string } | undefined): string | undefined {
  return nonEmpty(workspace?.label);
}

/**
 * Validate a declared role against `H2A_ROLES` at the READ boundary.
 *
 * Anything unrecognized — `'SUPERADMIN'`, `''`, a non-string — becomes
 * `'unknown'`. This is the Q1 ruling applied to the read path: never emit a
 * value outside the declared union, no matter which writer produced the
 * registry row.
 */
function sanitizeRole(role: unknown): H2ARole | typeof UNKNOWN {
  if (typeof role !== "string") return UNKNOWN;
  return (H2A_ROLES as readonly string[]).includes(role) ? (role as H2ARole) : UNKNOWN;
}

/**
 * Emit a timestamp only if it actually parses as one; otherwise the sentinel.
 * The contract types these fields as ISO 8601, so arbitrary text must not pass
 * through into them.
 */
function isoOrUnknown(value: string | undefined): string {
  return parseIso(value) === undefined ? UNKNOWN : (value as string);
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

  // ORDERING IS LOAD-BEARING — do not move this gate below the confidence
  // check. Because staleness is decided FIRST, any row that later returns
  // 'idle' has already passed pipeline-freshness: an 'idle' is therefore
  // genuine, fresh knowledge ("we looked, and it is quiet"), never absence of
  // knowledge. That is the whole justification for ranking idle ABOVE stale in
  // the instance roll-up (see LIVENESS_RANK). Reorder these two checks and a
  // stale-pipeline row would surface as 'idle' — a fresh-looking claim built on
  // timestamps nobody has refreshed — and the roll-up ordering would become
  // wrong (stale would have to dominate instead). Pinned by the test named
  // "the mirroredAt staleness gate strictly precedes the confidence check".
  //
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

/**
 * Best-of ranking for the instance-level roll-up: live > idle > stale > closed.
 *
 * `idle` outranks `stale` ONLY because {@link deriveLiveness} decides staleness
 * before it consults connection confidence, so an `idle` here is always fresh
 * knowledge rather than absence of it. If that ordering is ever inverted, this
 * ranking must be inverted with it — `stale` would then have to dominate.
 */
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
    labelOf(session.workspace) ?? labelOf(registration?.workspace) ?? UNKNOWN;
  // DEC-114 per-session mutable display name (host-native customTitle /
  // thread_name, or `/rename`). May legitimately diverge from the owning
  // instance's displayName — a session can be renamed independently. `nonEmpty`
  // keeps `""` behaving as absence, so the chain cannot emit a blank title.
  const topicOrTitle =
    nonEmpty(session.name) ?? nonEmpty(registration?.name) ?? workspaceLabel;

  const mcpActivityAt = parseIso(session.lastMcpActivityAt);
  const provenMcp = mcpActivityAt !== undefined;

  return {
    sessionId: session.sessionId,
    instanceId: session.instance,
    topicOrTitle,
    state: deriveSessionState(session, options.asOf),
    openedAt: isoOrUnknown(session.startedAt),
    // When the MCP stamp is absent/unparseable we fall back to the heartbeat,
    // which is itself validated: an unparseable heartbeat yields the sentinel
    // rather than leaking arbitrary text into an ISO-typed field. The source is
    // still reported as 'heartbeat' — that IS the source we consulted, and a
    // consumer must keep treating it as advisory.
    lastActivityAt: provenMcp
      ? (session.lastMcpActivityAt as string)
      : isoOrUnknown(session.heartbeatAt),
    activitySource: provenMcp ? "mcp" : "heartbeat",
    // From an explicit branch, never a literal default: an empty list here is
    // the CLAIM "there are no counterparts", so it must be established.
    counterpartsOpaqueRefs: counterpartsOpaqueRefsFor()
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
 *
 * Every chain below matches the contract's declared mapping exactly and adds no
 * undeclared step: earlier revisions scanned ALL sessions for a label/host and
 * fell back to `workspace.host` and to `registration.createdAt`, none of which
 * the spec declares. Code and contract must not disagree, so those were removed
 * rather than quietly kept.
 */
export function buildInstanceDescriptor(
  instanceId: string,
  options: BuildInstanceDescriptorOptions
): InstanceDescriptor {
  const registration = options.registration;
  const ordered = [...options.sessions].sort((a, b) => heartbeatMs(b) - heartbeatMs(a));
  const mostRecent = ordered[0];

  // Declared mapping: the session's workspace label (per-session authoritative,
  // taken from the most recent session), else the registration's, else nothing.
  const workspaceLabel =
    labelOf(mostRecent?.workspace) ?? labelOf(registration?.workspace) ?? UNKNOWN;

  const liveSessionName = ordered
    .filter((session) => deriveSessionState(session, options.asOf) !== "closed")
    .map((session) => nonEmpty(session.name))
    .find((name) => name !== undefined);
  const displayName = nonEmpty(registration?.name) ?? liveSessionName ?? workspaceLabel;

  // Declared mapping: the most recent session's host hint, else nothing. A
  // workspace ref is NOT consulted here — that would be a second reader of the
  // ref and would break `labelOf`'s choke-point guarantee.
  const host = nonEmpty(mostRecent?.host) ?? UNKNOWN;

  // Strictly max(heartbeatAt). No mint-time fallback: `createdAt` is not a
  // sighting, and presenting it as "last seen" would be an unearned freshness
  // claim.
  const lastSeenMs = ordered.reduce((max, session) => Math.max(max, heartbeatMs(session)), 0);
  const lastSeen = lastSeenMs > 0 ? new Date(lastSeenMs).toISOString() : UNKNOWN;

  const liveness = rollUpLiveness(
    ordered.map((session) => deriveLiveness(session, options.asOf, options.pushIntervalMs))
  );

  return {
    instanceId,
    displayName,
    host,
    // Validated against H2A_ROLES on read, and never synthesized for a missing
    // one (see the field's doc). Whoever wrote the registry, the wire union holds.
    role: sanitizeRole(registration?.roles?.[0]),
    workspaceLabel,
    // Declared DISPLAY list, read from `declaredCapabilities` and ALLOWLISTED
    // against the closed vocabulary — an intersection, never a denylist. The
    // authority-bearing `capabilities` is deliberately NOT read here: it is the
    // subagent ceiling and the attestation right, and it must never surface in a
    // browser panel nor be conflated with a declaration.
    declaredCapabilities: declaredCapabilitiesOf(registration),
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
  for (const registration of requireRead(input.registrations, "registrations")) {
    push(registration.instance);
  }
  for (const session of input.sessions) push(session.instance);
  return ids;
}

function registrationIndex(
  registrations: readonly H2AActorRegistration[]
): Map<string, H2AActorRegistration> {
  const index = new Map<string, H2AActorRegistration>();
  for (const registration of registrations) {
    if (!index.has(registration.instance)) index.set(registration.instance, registration);
  }
  return index;
}

/**
 * Presence + registry → `InstanceDescriptor[]`, **ordered by `lastSeen`
 * descending** (most recently seen agent first). The order is part of the
 * behaviour, not an accident of input order, and is pinned by a test — a
 * documented behaviour that can be deleted with the suite still green is not a
 * behaviour. Rows whose `lastSeen` is the sentinel sort last.
 */
export function buildInstanceDescriptors(input: BuildFeedInput): InstanceDescriptor[] {
  // Both sources must have been READ. An empty result below is then a fact.
  requireRead(input.sessions, "sessions");
  const index = registrationIndex(requireRead(input.registrations, "registrations"));
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

/**
 * Presence + registry → `SessionDescriptor[]`, **ordered by `lastActivityAt`
 * descending** (most recently active session first). Pinned by a test, for the
 * same reason as {@link buildInstanceDescriptors}.
 */
export function buildSessionDescriptors(input: BuildFeedInput): SessionDescriptor[] {
  const sessions = requireRead(input.sessions, "sessions");
  const index = registrationIndex(requireRead(input.registrations, "registrations"));
  return sessions
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
