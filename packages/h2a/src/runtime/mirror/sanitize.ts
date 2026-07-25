/**
 * EVO-13 / feed-contract P1 — the mirror's **SEND BOUNDARY**.
 *
 * The feed (`runtime/feed/descriptors.ts`) sanitizes what a browser READS. That
 * protects nothing that has already come to rest on someone else's disk: the
 * mirror push (`build.ts` → `remote/client.ts`) used to ship `listPresence(...)`
 * records and registry rows **verbatim**, so `launchContext.cwd`, the full
 * command line, the tmux session/pane, the pid, `workspace.path` and the
 * `file://<root>` endpoint uri all landed in the hosted store — the exact fields
 * the feed contract exists to keep out of a browser.
 *
 * The rule this module implements:
 *
 *   **Sanitize at the boundary you are responsible for; never assume an upstream
 *   or downstream sanitizer.** A read-side sanitizer does not protect data at
 *   rest. The send boundary is ours, so it sanitizes.
 *
 * ── Why an ALLOWLIST, and why it is a *type*, not a filter ──────────────────
 *
 * A denylist that strips `cwd`/`command`/`tmux`/`pid` starts leaking silently
 * the day someone adds a field to `H2ASession`. So every payload member gets a
 * FIELD PLAN: an object that classifies **every** field of the source type as
 * `send`, `withhold` or `narrow`. Three properties follow, in increasing order
 * of strength:
 *
 *  1. *Nothing unclassified can travel.* The builders iterate the PLAN's keys and
 *     read only those off the record. A field absent from the plan is never even
 *     read, so it cannot reach the wire whatever wrote it (including a `as any`
 *     cast or a JS caller).
 *  2. *Nothing unclassified can be added quietly.* Each plan is checked with
 *     `satisfies { [K in keyof Required<Source>]: ... }`, so adding a field to
 *     `H2ASession` / `H2AActorRegistration` / `H2ASubagentBinding` **fails the
 *     build** until it is explicitly classified. The ratchet is the compiler, not
 *     a reviewer's attention.
 *  3. *The wire type cannot drift from the plan.* `H2AMirrored*` is written out
 *     explicitly (it IS the wire contract, so it should be readable), and a
 *     compile-time equality assertion pins its key set to the plan's `send` +
 *     `narrow` keys. Change one without the other and the build fails.
 *
 * This is the same reasoning that makes `sanitizeDeclaredCapabilities` correct:
 * it ITERATES the closed vocabulary (`H2A_DECLARED_CAPABILITIES.filter(...)`)
 * instead of removing known-bad values. Here the "vocabulary" is the field set.
 *
 * ── What this module is NOT ────────────────────────────────────────────────
 *
 * Everything here is PURE and happens **before signing**, so the signature still
 * covers exactly the bytes transmitted. Nothing about the signing primitive, the
 * sequence fencing or the accept-side verification changes.
 *
 * It is also only the SEND half. The ingester (`serve.ts`) still writes whatever
 * a *verified* sender hands it, so an older CLI that predates this module keeps
 * pushing raw records. Applying these same functions on the ingest path is the
 * symmetric half of the rule and is recorded as owed — see the feed contract's
 * "Send boundary" section.
 */
import type {
  H2AActorRegistration,
  H2AAgentVersion,
  H2ASession,
  H2ASessionInterests,
  H2ASessionNotificationTopic,
  H2ASessionState,
  H2ASubagentBinding,
  H2AWorkStatus,
  H2AWorkspaceRef
} from "@sentropic/h2a";

// ─── Field plans ────────────────────────────────────────────────────────────

/**
 * Why a field is withheld. A closed vocabulary rather than free text: the
 * reasons are asserted by tests and read by reviewers, and "some comment
 * somewhere" is not a contract.
 */
export type MirrorWithholdReason =
  /** A real path on the sender's filesystem. */
  | "filesystem-path"
  /** A command line — reveals tooling, flags, and often paths inside it. */
  | "command-line"
  /** Identifies a process on the sender's machine (pid, tty). */
  | "process-identity"
  /** tmux session/window/pane — coordinates of a live terminal. */
  | "terminal-coordinates"
  /** The RECEIVER establishes this itself; a sender's value would be a forgery. */
  | "receiver-stamped"
  /** Nothing downstream reads it, so it has no business travelling. */
  | "not-consumed-downstream";

interface SendPlan {
  readonly kind: "send";
}
interface WithholdPlan {
  readonly kind: "withhold";
  readonly because: MirrorWithholdReason;
}
interface NarrowPlan<T> {
  readonly kind: "narrow";
  readonly narrow: (value: NonNullable<T>) => unknown;
}

/** How one source field is treated at the send boundary. */
export type MirrorFieldPlan<T> = SendPlan | WithholdPlan | NarrowPlan<T>;

/** Transmitted as-is. Only for fields that are provably not sender-private. */
const SEND: SendPlan = { kind: "send" };

/** Never transmitted, with the reason recorded in the closed vocabulary. */
function withhold(because: MirrorWithholdReason): WithholdPlan {
  return { kind: "withhold", because };
}

/** Transmitted, but through its own nested allowlist. */
function narrow<T>(fn: (value: NonNullable<T>) => unknown): NarrowPlan<T> {
  return { kind: "narrow", narrow: fn };
}

/** A plan covering EVERY field of `Source` — the `satisfies` target. */
type MirrorPlanFor<Source> = {
  readonly [K in keyof Required<Source>]: MirrorFieldPlan<Required<Source>[K]>;
};

/** Keys a plan withholds. */
type WithheldKey<Plan> = {
  [K in keyof Plan]: Plan[K] extends WithholdPlan ? K : never;
}[keyof Plan];

/** Keys a plan transmits (verbatim or narrowed). */
type SentKey<Plan> = Exclude<keyof Plan, WithheldKey<Plan>>;

/**
 * Compile-time type equality. Used to pin each `H2AMirrored*` wire type's key
 * set to its plan: if they drift, `true` stops being assignable to `false` and
 * the build fails.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Apply a plan: iterate the PLAN (never the record's own keys) and copy only
 * what it permits.
 *
 * Iterating the plan is what makes this an allowlist rather than a filter — an
 * unclassified field on `record` is not skipped, it is never looked at. Absent
 * values are omitted rather than serialized as `undefined`, so the payload keeps
 * the same "optional field absent" shape the store and the guards expect.
 */
function applyPlan<Source extends object>(
  record: Source,
  plan: MirrorPlanFor<Source>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = record as Record<string, unknown>;
  for (const field of Object.keys(plan)) {
    const step = (plan as Record<string, MirrorFieldPlan<unknown>>)[field];
    if (step === undefined || step.kind === "withhold") continue;
    const value = source[field];
    if (value === undefined || value === null) continue;
    out[field] = step.kind === "narrow" ? step.narrow(value) : value;
  }
  return out;
}

/**
 * Fields present on `record` that the plan does not classify at all.
 *
 * Exported for the tests, and it is the property that makes the allowlist
 * claim checkable at RUNTIME as well as at compile time: a record carrying a
 * field nobody classified is exactly the moment a denylist would start leaking.
 *
 * The builders deliberately do NOT throw on one. They cannot leak it (they never
 * read it), so throwing would only turn an additive, harmless field into a dead
 * mirror pipeline — availability lost for no confidentiality gained. The
 * compiler already refuses the unclassified field at the type level; this
 * function covers the paths the compiler cannot see (JS callers, casts, records
 * written by an older version).
 */
export function unclassifiedMirrorFields(
  record: object,
  plan: Record<string, unknown>
): string[] {
  return Object.keys(record).filter((field) => !(field in plan));
}

// ─── Workspace reference ────────────────────────────────────────────────────

/**
 * A workspace as it may LEAVE the machine: identity + label, never a path.
 *
 * `H2AWorkspaceRef.path` is "the absolute realpath on **this machine**" — by its
 * own definition it means nothing on any other host, and it is the single field
 * the feed's opacity boundary names first. `repo` is withheld too: nothing
 * downstream reads it and a git remote may itself be a local filesystem path.
 *
 * `id` survives because it is the opaque, salted `ws:<uuid>` digest that lets a
 * UI GROUP an owner's agents by place; it is not reversible into a path. `host`
 * survives because it is a CLI name (`claude` / `codex` / ...) and because
 * `isH2AWorkspaceRef` requires it — see the note on `path` in `identity.ts`.
 */
export interface H2AMirroredWorkspaceRef {
  readonly id: string;
  readonly host: string;
  readonly label: string;
}

const WORKSPACE_PLAN = {
  id: SEND,
  host: SEND,
  label: SEND,
  path: withhold("filesystem-path"),
  repo: withhold("not-consumed-downstream")
} satisfies MirrorPlanFor<H2AWorkspaceRef>;

/** Pins {@link H2AMirroredWorkspaceRef} to {@link WORKSPACE_PLAN}. */
export type WorkspaceKeysMatchPlan = Exact<
  keyof H2AMirroredWorkspaceRef,
  SentKey<typeof WORKSPACE_PLAN>
>;
const _workspaceKeysMatchPlan: WorkspaceKeysMatchPlan = true;
void _workspaceKeysMatchPlan;

export function sanitizeWorkspaceRefForMirror(
  workspace: H2AWorkspaceRef
): H2AMirroredWorkspaceRef {
  return applyPlan(workspace, WORKSPACE_PLAN) as unknown as H2AMirroredWorkspaceRef;
}

// ─── Version stamp ──────────────────────────────────────────────────────────

const VERSION_PLAN = {
  cli: SEND,
  skill: SEND
} satisfies MirrorPlanFor<H2AAgentVersion>;

function sanitizeVersionForMirror(version: H2AAgentVersion): H2AAgentVersion {
  return applyPlan(version, VERSION_PLAN) as H2AAgentVersion;
}

// ─── Presence ───────────────────────────────────────────────────────────────

/**
 * A presence record as it may LEAVE the machine.
 *
 * Assignable to `H2ASession` on purpose: the hosted ingester writes it through
 * `writePresence`, which validates with `isH2ASession`, and the feed's
 * descriptor builders consume it as a session. Narrowing the payload therefore
 * required exactly one type change elsewhere — `H2AWorkspaceRef.path` became
 * optional, because a type that makes a filesystem path MANDATORY on every
 * workspace reference cannot express a sanitized reference at all. That
 * mandatory field was compelling the leak, not merely permitting it.
 */
export interface H2AMirroredSession {
  readonly sessionId: string;
  readonly instance: string;
  readonly host?: string;
  readonly name?: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  readonly state: H2ASessionState;
  readonly interests: H2ASessionInterests;
  readonly subscribedTopics: readonly H2ASessionNotificationTopic[];
  readonly workStatus?: H2AWorkStatus;
  readonly lastMcpActivityAt?: string;
  readonly version?: H2AAgentVersion;
  readonly workspace?: H2AMirroredWorkspaceRef;
}

/**
 * Every field of `H2ASession`, classified.
 *
 * The `send` set is exactly what a consumer of the mirror demonstrably needs:
 *  - `sessionId` / `instance` — the row's own identity (`accept.ts` authorizes a
 *    session by `instance`; the feed keys rows on both);
 *  - `startedAt` / `heartbeatAt` / `state` / `lastMcpActivityAt` — the liveness
 *    derivation (`deriveSessionState`, `deriveLiveness`, `isSessionExpired`);
 *  - `interests` / `subscribedTopics` — required by `isH2ASession`, so the
 *    hosted `writePresence` rejects the record without them;
 *  - `host` / `name` / `workspace` — the feed's `host`, `topicOrTitle`,
 *    `displayName` and `workspaceLabel`;
 *  - `workStatus` / `version` — closed vocabularies, shown by `h2a_discover_*`.
 */
const PRESENCE_PLAN = {
  sessionId: SEND,
  instance: SEND,
  host: SEND,
  name: SEND,
  startedAt: SEND,
  heartbeatAt: SEND,
  state: SEND,
  interests: SEND,
  subscribedTopics: SEND,
  workStatus: SEND,
  lastMcpActivityAt: SEND,
  version: narrow<H2AAgentVersion>(sanitizeVersionForMirror),
  workspace: narrow<H2AWorkspaceRef>(sanitizeWorkspaceRefForMirror),
  // The working directory, the command line and the terminal coordinates: the
  // whole point of the exercise. Captured at launch for LOCAL relance (DEC-084)
  // — a relauncher on another host could not use them even if it wanted to.
  launchContext: withhold("command-line"),
  pid: withhold("process-identity"),
  // Not privacy — PROVENANCE. `mirroredAt` is the receiving side's own record of
  // when it ingested a row, and `deriveLiveness` reads it to decide `stale`. A
  // sender-supplied value would be a forged freshness claim feeding a liveness
  // decision, so the sender does not get to make it. `serve.ts` stamps it.
  mirroredAt: withhold("receiver-stamped")
} satisfies MirrorPlanFor<H2ASession>;

/** The plan, for tests and for callers that want to state the contract. */
export const MIRROR_PRESENCE_PLAN: Readonly<Record<string, MirrorFieldPlan<never>>> =
  PRESENCE_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

/** Pins {@link H2AMirroredSession} to {@link PRESENCE_PLAN}. */
export type PresenceKeysMatchPlan = Exact<
  keyof H2AMirroredSession,
  SentKey<typeof PRESENCE_PLAN>
>;
const _presenceKeysMatchPlan: PresenceKeysMatchPlan = true;
void _presenceKeysMatchPlan;

/** One presence record → the record as it may leave the machine. */
export function sanitizePresenceForMirror(session: H2ASession): H2AMirroredSession {
  return applyPlan(session, PRESENCE_PLAN) as unknown as H2AMirroredSession;
}

// ─── Registration ───────────────────────────────────────────────────────────

/**
 * Endpoint uri schemes that may leave the machine: a NETWORK locator is
 * meaningful to a receiver, a `file://` uri is a path on the sender's disk.
 *
 * Allowlisted by scheme rather than by `kind` deliberately. `kind` is a
 * self-declared label — a `file://` uri labelled `kind: "remote"` would sail
 * through a kind-based check, while the scheme is the thing that actually
 * determines whether the value is a path. The only writer in the tree today
 * emits `{ kind: "local-files", uri: "file://<root>" }` (`identity/live.ts`),
 * i.e. the agent's h2a root — under `$HOME` on every developer machine.
 */
const MIRRORABLE_ENDPOINT_SCHEMES = ["http:", "https:", "ws:", "wss:"] as const;

/**
 * Endpoints reachable by a receiver — from an explicit filter, so an empty list
 * is the established fact "no endpoint of this registration is addressable from
 * off this machine", never a defaulted `[]`. `isH2AActorRegistration` requires
 * the field to be an array and accepts an empty one.
 */
function sanitizeEndpointsForMirror(
  endpoints: H2AActorRegistration["endpoints"]
): H2AActorRegistration["endpoints"] {
  return endpoints.filter((endpoint) => {
    let scheme: string;
    try {
      scheme = new URL(endpoint.uri).protocol;
    } catch {
      return false; // not a parseable locator → not something we can vouch for
    }
    return (MIRRORABLE_ENDPOINT_SCHEMES as readonly string[]).includes(scheme);
  });
}

/**
 * A registry row as it may LEAVE the machine. Assignable to
 * `H2AActorRegistration` (the ingester applies it via `store.registerInstance`,
 * which validates with `isH2AActorRegistration`).
 */
export interface H2AMirroredRegistration {
  readonly id: string;
  readonly instance: string;
  readonly roles: H2AActorRegistration["roles"];
  readonly scopes: string[];
  readonly capabilities: string[];
  readonly declaredCapabilities?: string[];
  readonly endpoints: H2AActorRegistration["endpoints"];
  readonly publicKeys: string[];
  readonly acceptedPolicies: string[];
  readonly createdAt: string;
  readonly principal?: string;
  readonly conductor?: string;
  readonly agentUuid?: string;
  readonly name?: string;
  readonly workspace?: H2AMirroredWorkspaceRef;
}

/**
 * Every field of `H2AActorRegistration`, classified.
 *
 * `capabilities` is transmitted DELIBERATELY, though it is authority-bearing and
 * the feed never displays it. Two gates on the RECEIVING side read it off the
 * registry row: the subagent capability ceiling (`subagents.ts`
 * `capabilities-exceed-parent` compares a binding against `parent.capabilities`)
 * and the attestation right (`canAttestComprehension(role,
 * registration.capabilities)` in `mcp/handlers.ts`). Withholding it would not be
 * "sanitizing" — it would silently change an authorization outcome on the
 * receiver, which is a worse failure than the one being fixed. It carries no
 * path, no command and no process identity.
 */
const REGISTRATION_PLAN = {
  id: SEND,
  instance: SEND,
  roles: SEND,
  scopes: SEND,
  capabilities: SEND,
  declaredCapabilities: SEND,
  publicKeys: SEND,
  acceptedPolicies: SEND,
  createdAt: SEND,
  principal: SEND,
  conductor: SEND,
  agentUuid: SEND,
  name: SEND,
  endpoints: narrow<H2AActorRegistration["endpoints"]>(sanitizeEndpointsForMirror),
  workspace: narrow<H2AWorkspaceRef>(sanitizeWorkspaceRefForMirror)
} satisfies MirrorPlanFor<H2AActorRegistration>;

/** The plan, for tests. */
export const MIRROR_REGISTRATION_PLAN: Readonly<
  Record<string, MirrorFieldPlan<never>>
> = REGISTRATION_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

/** Pins {@link H2AMirroredRegistration} to {@link REGISTRATION_PLAN}. */
export type RegistrationKeysMatchPlan = Exact<
  keyof H2AMirroredRegistration,
  SentKey<typeof REGISTRATION_PLAN>
>;
const _registrationKeysMatchPlan: RegistrationKeysMatchPlan = true;
void _registrationKeysMatchPlan;

export function sanitizeRegistrationForMirror(
  registration: H2AActorRegistration
): H2AMirroredRegistration {
  return applyPlan(
    registration,
    REGISTRATION_PLAN
  ) as unknown as H2AMirroredRegistration;
}

// ─── Subagent binding ───────────────────────────────────────────────────────

/**
 * A subagent (NHI) binding as it may leave the machine. Every field is
 * transmitted — checked one by one, none is a path, a command or a process id —
 * but the plan exists anyway, so a future field on `H2ASubagentBinding` must be
 * classified before it can travel. That is the ratchet, not a formality: this
 * payload member had no boundary of its own before.
 */
export interface H2AMirroredSubagentBinding {
  readonly id: string;
  readonly parentInstance: string;
  readonly name: string;
  readonly capabilities?: readonly string[];
  readonly createdAt: string;
}

const SUBAGENT_PLAN = {
  id: SEND,
  parentInstance: SEND,
  name: SEND,
  capabilities: SEND,
  createdAt: SEND
} satisfies MirrorPlanFor<H2ASubagentBinding>;

/** The plan, for tests. */
export const MIRROR_SUBAGENT_PLAN: Readonly<Record<string, MirrorFieldPlan<never>>> =
  SUBAGENT_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

/** Pins {@link H2AMirroredSubagentBinding} to {@link SUBAGENT_PLAN}. */
export type SubagentKeysMatchPlan = Exact<
  keyof H2AMirroredSubagentBinding,
  SentKey<typeof SUBAGENT_PLAN>
>;
const _subagentKeysMatchPlan: SubagentKeysMatchPlan = true;
void _subagentKeysMatchPlan;

export function sanitizeSubagentForMirror(
  binding: H2ASubagentBinding
): H2AMirroredSubagentBinding {
  return applyPlan(binding, SUBAGENT_PLAN) as unknown as H2AMirroredSubagentBinding;
}
