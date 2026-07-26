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
 * ── AND THE SAME RULE APPLIED TO THIS FILE'S OWN COMMENTS ───────────────────
 *
 *   **When a comment here cites another module's validator, CALL IT and check
 *   what it actually rejects. Do not read its name, its type signature, or its
 *   docstring and infer.**
 *
 * This is written down because the file broke its own rule three times, and each
 * time it took a measurement to notice — a comment assuming a sibling guard is
 * the same mistake as code assuming one:
 *
 *  - `isH2AActorRegistration` "requires `endpoints` to be an array" — it does,
 *    but it is **never called on any production path**, so it required nothing.
 *  - `isH2AEnvelope` "requires a vocabulary role" — it checks `actor.instance`
 *    and nothing else (see {@link sanitizeActorForMirror}).
 *  - `isActorRef` (`envelope.ts:27`) does check the role vocabulary, and is
 *    referenced **nowhere**. Reading it as live would have been the third.
 *
 * A false claim about a sibling guard is worse than no claim: it supplies a
 * reason to delete a protection that works. Every guard citation below has been
 * exercised, and what each one ACTUALLY enforces is recorded at its use site:
 *
 *   | Cited guard              | What it really enforces                      |
 *   |--------------------------|----------------------------------------------|
 *   | `isH2AWorkspaceRef`      | `id`/`host`/`label` required; `path` rejected |
 *   |                          | when present-but-empty; EXTRA KEYS TOLERATED  |
 *   | `isH2ASession`           | rejects missing `interests`/`subscribedTopics`|
 *   |                          | and a non-vocabulary topic; tolerates extra   |
 *   |                          | top-level keys                                |
 *   | `isInterests`            | `scopes`+`negotiations` string arrays only;   |
 *   |                          | EXTRA NESTED KEYS TOLERATED (the P1 leak)     |
 *   | `isH2AActorRegistration` | would reject `endpoints: "nope"` — but has NO |
 *   |                          | production caller, so it guards nothing        |
 *   | `isH2AEnvelope`          | `actor.instance` is a string. NOT `role`.     |
 *   | `canAttestComprehension` | `(role, rights = [])`; both call sites pass   |
 *   |                          | `registration.capabilities` — claim holds     |
 *   | `deriveLiveness`         | reads `mirroredAt` to gate staleness          |
 *   |                          | (`descriptors.ts:410`) — claim holds          |
 *
 * Note the shape of the three tolerances: every one of these guards is a
 * SPOT-CHECK that accepts unknown keys. None of them is an allowlist. That is
 * precisely why this module cannot delegate to any of them.
 *
 * ── Why an ALLOWLIST, and why it is a *type*, not a filter ──────────────────
 *
 * A denylist that strips `cwd`/`command`/`tmux`/`pid` starts leaking silently
 * the day someone adds a field to `H2ASession`. So every COMPOSITE type that
 * travels — each payload member **and every composite nested inside one** — gets
 * a FIELD PLAN: an object that classifies **every** field of the source type as
 * `send`, `withhold` or `narrow`. Three properties follow, in increasing order
 * of strength:
 *
 *  1. *Nothing unclassified can travel.* The builders iterate the PLAN's keys and
 *     read only those off the record. A field absent from the plan is never even
 *     read, so it cannot reach the wire whatever wrote it (including an `as any`
 *     cast or a JS caller). This holds at EVERY level, not merely at the top of
 *     each payload member: every composite listed in the table below is rebuilt
 *     field-by-field from its own plan, never copied by reference. It does NOT
 *     hold for the element VALUES inside arrays of primitives — those are free
 *     text, no field allowlist can constrain them, and they are handled as a
 *     disclosed gap (see the table's second half).
 *  2. *Nothing unclassified can be added quietly.* Each plan is checked with
 *     `satisfies { [K in keyof Required<Source>]: ... }`, so adding a field to
 *     ANY type in the table **fails the build** until it is explicitly
 *     classified. The ratchet is the compiler, not a reviewer's attention — and
 *     because the nested types carry plans of their own, the ratchet reaches
 *     downward instead of stopping at the payload member. (Before the nested
 *     plans it did stop there: a field added to `H2ASessionInterests` or to the
 *     endpoints element type compiled clean and travelled.)
 *  3. *The wire type cannot drift from the plan.* `H2AMirrored*` is written out
 *     explicitly (it IS the wire contract, so it should be readable), and a
 *     compile-time equality assertion pins its key set to the plan's `send` +
 *     `narrow` keys. Change one without the other and the build fails.
 *
 * This is the same reasoning that makes `sanitizeDeclaredCapabilities` correct:
 * it ITERATES the closed vocabulary (`H2A_DECLARED_CAPABILITIES.filter(...)`)
 * instead of removing known-bad values. Here the "vocabulary" is the field set.
 *
 * ── Every composite type that travels, and its plan ────────────────────────
 *
 * Property 1 is worth exactly as much as this list is complete, so the list is
 * exhaustive by construction: `buildInstanceMirror` puts three member arrays in
 * the body and nothing else, and every entry here is reachable from one of them.
 *
 *   H2ASession                          → PRESENCE_PLAN
 *     ├─ H2ASessionInterests            → INTERESTS_PLAN
 *     ├─ H2AAgentVersion                → VERSION_PLAN
 *     └─ H2AWorkspaceRef                → WORKSPACE_PLAN
 *   H2AActorRegistration                → REGISTRATION_PLAN
 *     ├─ endpoints[] element {kind,uri} → ENDPOINT_PLAN
 *     └─ H2AWorkspaceRef                → WORKSPACE_PLAN
 *   H2ASubagentBinding                  → SUBAGENT_PLAN
 *
 * Every composite above has a plan. **NOT covered, and cannot be**: arrays of
 * primitives and free-text scalars, because a field allowlist classifies FIELDS
 * and these have none — their risk is in the VALUE. Transmitted: the element
 * values of `interests.scopes[]`, `interests.negotiations[]`, `scopes[]`,
 * `capabilities[]`, `declaredCapabilities[]`, `acceptedPolicies[]`,
 * `publicKeys[]`, `roles[]`, `subscribedTopics[]`, and the scalars `name`,
 * `principal`, `conductor`, `agentUuid`, `workspace.label`, `workspace.host`,
 * `workspace.id`, `version.cli`, `version.skill`. `roles[]` and
 * `subscribedTopics[]` are closed vocabularies in the TYPE but are not
 * re-intersected against that vocabulary here. The others are agent-settable:
 * `h2a_session_open` copies `interests.scopes` verbatim from its caller
 * (`runtime/mcp/sessions.ts`), and `h2a_register_instance` accepts an arbitrary
 * object, so a scope of `"scope:/home/you/private"` or a conductor of
 * `"file:///home/you/…"` comes to rest on the hosted disk with no privilege, no
 * malformed record and no older CLI involved. That is a disclosed, bounded gap —
 * joint plan § 9 item 1, feed contract "Send boundary" — not something these
 * plans close, and the concern is DATA AT REST on someone else's disk, not only
 * how a panel renders it.
 *
 * The ENVELOPE around the body is NOT all literals — an earlier version of this
 * comment claimed it was, and that was false. `protocol` / `version` / `id` /
 * `type` / `target` / `createdAt` are built from constants, the instance id and
 * the injected clock. But `actor` is assembled from the REGISTRATION:
 * `buildInstanceMirror` wrote `role: reg.roles?.[0]`, which is a source record's
 * field reaching the wire outside every plan in this module — demonstrated with
 * a `roles` array whose first element was a real filesystem path, which came to
 * rest on the receiver. `scope` was a hardcoded `"scope:default"`, i.e. the one
 * remaining literal in the one place with no plan and no ratchet: the day
 * somebody made it `reg.scopes?.[0]` — the obvious edit — a record field would
 * have ridden out with no compile-time and no test signal.
 *
 * So `actor` now has a boundary like everything else, and it is a stronger one
 * than a plan: {@link sanitizeActorForMirror} derives it from the ALREADY
 * SANITIZED `H2AMirroredRegistration`, never from the raw record. That makes the
 * property structural rather than reviewed — the envelope cannot carry a field
 * the registration plan does not already transmit, because the raw record is not
 * in scope at the point the actor is built. `role` is additionally re-intersected
 * against the `H2A_ROLES` vocabulary at runtime, so the path in the example above
 * no longer reaches the wire at all, and the unvalidated `reg.roles?.[0]` — which
 * on the string `"NOTANARRAY"` quietly yielded the single character `"N"` — is
 * gone with it.
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
import { H2A_ROLES } from "@sentropic/h2a";
import type {
  H2AActorRef,
  H2AActorRegistration,
  H2AAgentVersion,
  H2ARole,
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

/**
 * A value that may be transmitted VERBATIM: a primitive, or an array of
 * primitives. Deliberately narrow — an array of arrays or an array of objects is
 * composite and does not qualify.
 *
 * This is the type that makes "no composite is ever copied by reference" a
 * STRUCTURAL property instead of a convention, and it exists because convention
 * demonstrably was not enough. The `interests` leak this module was written to
 * fix was precisely a composite classified `send`: `applyPlan` copied the whole
 * object by reference, `isInterests` tolerated the extra keys, and a nested
 * `cwd`/`pid`/tmux payload came to rest on the receiver's disk. The field plan
 * was already in place at the time. It forced a classification and the
 * classification was `send`, which is a LEGAL classification — so the ratchet
 * fired, was answered, and the leak shipped anyway.
 *
 * A plan that forces you to classify does not force you to classify CORRECTLY.
 * Making `send` inexpressible for a composite removes the wrong answer from the
 * menu rather than trusting the next author not to pick it.
 *
 * ── WHERE THIS RULE STOPS ──────────────────────────────────────────────────
 *
 * It is structural for any field with a real type, and it is NOT structural for
 * a field typed `any`: a conditional type on `any` resolves to both branches, so
 * `SEND` stays assignable and the compiler says nothing. `unknown` is fine
 * (forced to `narrow`); `any` is the hole, and `any` is exactly what a field
 * added in a hurry looks like. That case is covered one rung lower, by a runtime
 * test that reads the plans directly rather than through a fixture
 * (`mirror-send-boundary.test.js`, "no plan classifies a COMPOSITE field as
 * `send`"). Naming the boundary here rather than letting "structural" be heard
 * as "total".
 */
type MirrorSendableValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[];

/**
 * How one source field is treated at the send boundary.
 *
 * `send` is only in the union when the field's type is a
 * {@link MirrorSendableValue}. For a composite field the union collapses to
 * `withhold | narrow`, so `SEND` is not assignable and the build fails until the
 * field gets a plan of its own. That is the difference between "the ratchet
 * forces you to classify" and "the ratchet forces a classification that cannot
 * copy by reference".
 */
export type MirrorFieldPlan<T> =
  | ([NonNullable<T>] extends [MirrorSendableValue] ? SendPlan : never)
  | WithholdPlan
  | NarrowPlan<T>;

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
 * Objects this module built field-by-field from a plan.
 *
 * The membership test is what makes "a composite is REBUILT, never passed
 * through" checkable at runtime instead of merely intended. See
 * {@link isPlanBuilt} and the `narrow` branch of {@link applyPlan}.
 */
const PLAN_BUILT = new WeakSet<object>();

/**
 * The RUNTIME twin of {@link MirrorSendableValue}.
 *
 * It exists because the compile-time constraint proves something about the
 * PLAN, not about the VALUE. `applyPlan` receives records from
 * `store.findInstance` / `listPresence`, and a registration is accepted and
 * written with **no validation at all** (`registerInstance` validates nothing;
 * `handleRegisterInstance` checks `typeof === "object"` and stops). So the
 * declared type of a field is a hope about the data, not a fact about it: a
 * `principal` declared `string` can hold `{cwd, command}` at runtime, and a
 * `send` classification would copy that object wholesale.
 */
function isSendableAtRuntime(value: unknown): boolean {
  const isPrimitive = (v: unknown): boolean =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  if (isPrimitive(value)) return true;
  return Array.isArray(value) && value.every(isPrimitive);
}

/** Whether a narrow's output was really rebuilt from a plan (arrays: elementwise). */
function isPlanBuilt(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(isPlanBuilt);
  return PLAN_BUILT.has(value);
}

/**
 * Apply a plan: iterate the PLAN (never the record's own keys) and copy only
 * what it permits.
 *
 * Iterating the plan is what makes this an allowlist rather than a filter — an
 * unclassified field on `record` is not skipped, it is never looked at. Absent
 * values are omitted rather than serialized as `undefined`, so the payload keeps
 * the same "optional field absent" shape the store and the guards expect.
 *
 * ── THE TWO RUNTIME CHECKS, AND WHY A TYPE IS NOT ENOUGH ───────────────────
 *
 * Both exist because this function's input is UNVALIDATED. The compile-time
 * ratchet governs the plan; nothing governs the record.
 *
 *  - A `send` value that is not a primitive or an array of primitives is
 *    DROPPED. The declared type says what the field must be, so anything else is
 *    a lie, and a lie shaped like an object is how a `cwd` and a command line
 *    ride out through a field declared `string`. Dropped rather than thrown:
 *    throwing here would let any hostile registry row kill the push for every
 *    session on the machine, trading availability for a confidentiality win
 *    that dropping already secures. If the dropped field was required, the
 *    receiver's own guard rejects the record — fail-closed, and visible.
 *  - A `narrow` whose output was not itself built by this function is DROPPED.
 *    `NarrowPlan.narrow` is an arbitrary callback returning `unknown`, so
 *    `narrow((value) => value)` — an identity narrow — type-checks and copies a
 *    composite wholesale, which is precisely the leak the plans exist to stop.
 *    The compiler cannot reject it (identity returns a structurally compatible
 *    type), so the membership test in {@link PLAN_BUILT} does.
 *
 * `null` is passed THROUGH to a narrow rather than short-circuited, so the
 * narrow's own hostile-input handling can run. That is what makes
 * `endpoints: null` produce `[]` instead of an absent field.
 */
function applyPlan<Source extends object>(
  record: Source,
  plan: MirrorPlanFor<Source>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  PLAN_BUILT.add(out);
  // The record itself may be null/undefined or not an object at all — every
  // narrow must be TOTAL, because nothing validated what is in the store.
  const source = (record ?? {}) as Record<string, unknown>;
  for (const field of Object.keys(plan)) {
    const step = (plan as Record<string, MirrorFieldPlan<unknown>>)[field];
    if (step === undefined || step.kind === "withhold") continue;
    const value = source[field];
    if (value === undefined) continue;
    if (step.kind === "narrow") {
      const narrowed = step.narrow(value as never);
      if (narrowed === undefined || narrowed === null) continue;
      if (!isPlanBuilt(narrowed)) continue;
      out[field] = narrowed;
      continue;
    }
    if (value === null) continue;
    if (!isSendableAtRuntime(value)) continue;
    out[field] = value;
  }
  return out;
}

/**
 * {@link applyPlan} and the plan constructors, exported for the send-boundary
 * tests ONLY.
 *
 * Exporting internals to test them is usually a smell. It is justified here
 * because the property under test is "a hostile PLAN cannot defeat the
 * boundary", and a plan cannot be made hostile from outside without these. The
 * alternative — trusting that no future plan uses an identity narrow — is the
 * assumption this module exists to eliminate.
 */
export const MIRROR_TEST_HOOKS = {
  applyPlan,
  send: SEND,
  narrow,
  withhold
} as const;

/**
 * Fields present on `record` that the plan does not classify at all.
 *
 * **This is a TEST-TIME assertion helper, not a runtime half of the ratchet.**
 * It is called from `test/mirror-send-boundary.test.js` and from nowhere on the
 * send path, and the earlier claim that it "covers the paths the compiler cannot
 * see" was wider than what is built — a guard that is never invoked cannot cover
 * anything. It is kept, and kept exported, because it is what lets a test fail by
 * NAMING the unclassified field instead of asserting an opaque key-set equality.
 *
 * It is deliberately not wired into the builders. Two reasons, and the second is
 * the honest one: (a) throwing on an unclassified field would turn an additive,
 * harmless field into a dead mirror pipeline — availability lost for no
 * confidentiality gained, since `applyPlan` never reads the field anyway; and
 * (b) the alternative, warning or counting, would make this module impure, and
 * the purity claim above ("everything here is PURE and happens before signing")
 * is load-bearing for the signature argument. The ratchet that actually holds is
 * the compiler (`satisfies MirrorPlanFor<Source>` on every plan in the table) plus
 * plan-iteration in {@link applyPlan}. There is no runtime ratchet; if one is
 * wanted it belongs in the caller, where a side effect is allowed.
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
 * `id` survives because it lets a UI GROUP an owner's agents by place and because
 * it is not reversible into a path. Be precise about WHY it is not, because the
 * usual shorthand ("the salted `ws:<uuid>` digest") describes the wrong branch:
 *
 *  - The PRIMARY id, tried first at `runtime/identity/live.ts`, is
 *    `durableWorkspaceId` (`runtime/identity/workspace-id.ts`) — an **unsalted**
 *    `sha256(rootCommitSHA + "\n" + worktreeRelPath)` rendered as `ws:<64 hex>`.
 *    Both inputs are PUBLIC: the repo's root-commit SHAs and a worktree name. It
 *    carries no path because the path is not an input, not because a secret hides
 *    it — so it is portable across clones by design, and an observer who already
 *    knows the repo can confirm a guess at the worktree name. That is the actual
 *    property, and it is weaker than "salted digest" implies.
 *  - The SECOND fallback is `provider.workspaceHint`, which for `host: "remote"`
 *    is the **unconstrained** `SESSION_WORKSPACE_ID` env var (`identity/
 *    resolver.ts` checks truthiness only — no prefix, charset or length check).
 *  - Only the THIRD fallback, reached in a non-git directory, is the salted
 *    `deriveWorkspaceId` (`identity.ts`: `sha256(machineId \0 realpath)` as
 *    `ws:<uuid>`). It is the branch the old comment described and the one least
 *    often taken.
 *
 * None of the three transmits a path, which is the property this boundary needs;
 * the rationale is corrected because an inaccurate rationale inside a security
 * module is how the next reader over-trusts the field.
 *
 * `host` survives because it is a CLI name (`claude` / `codex` / ...) and because
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

/** The plan, for tests. */
export const MIRROR_WORKSPACE_PLAN: Readonly<Record<string, MirrorFieldPlan<never>>> =
  WORKSPACE_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

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

/** The plan, for tests. */
export const MIRROR_VERSION_PLAN: Readonly<Record<string, MirrorFieldPlan<never>>> =
  VERSION_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

function sanitizeVersionForMirror(version: H2AAgentVersion): H2AAgentVersion {
  return applyPlan(version, VERSION_PLAN) as H2AAgentVersion;
}

// ─── Session interests ──────────────────────────────────────────────────────

/**
 * Session interests as they may LEAVE the machine.
 *
 * This type and its plan exist because `interests` used to be classified `SEND`,
 * which made {@link applyPlan} copy the whole object **by reference**. The
 * consequence was not theoretical: `isH2ASession` validates `interests` through a
 * two-field spot-check (`session.ts` `isInterests` asserts `scopes` and
 * `negotiations` are string arrays and does **not** reject extra keys), so a
 * record carrying `interests: { scopes: [], negotiations: [], lc: { tmux: …,
 * cwd: …, pid: … } }` was well-formed by the guard, travelled whole, and came to
 * rest on the receiver's disk. A nested composite reached by reference is outside
 * both halves of the ratchet: the plan cannot filter what it does not iterate,
 * and `satisfies MirrorPlanFor<H2ASession>` says nothing about the fields of
 * `H2ASessionInterests`.
 *
 * Both fields are transmitted — the hosted `writePresence` REQUIRES them, since
 * `isInterests` rejects a record missing either — but the object is now rebuilt
 * from the plan rather than passed through, so a third field cannot ride along.
 * The element VALUES stay free text: `runtime/mcp/sessions.ts` copies
 * `interests.scopes` verbatim from the `h2a_session_open` caller, so a scope
 * naming a real directory is transmissible and is disclosed as such. A field
 * allowlist bounds the SHAPE, never the content.
 */
export interface H2AMirroredSessionInterests {
  readonly scopes: readonly string[];
  readonly negotiations: readonly string[];
}

const INTERESTS_PLAN = {
  scopes: SEND,
  negotiations: SEND
} satisfies MirrorPlanFor<H2ASessionInterests>;

/** The plan, for tests. */
export const MIRROR_INTERESTS_PLAN: Readonly<Record<string, MirrorFieldPlan<never>>> =
  INTERESTS_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

/** Pins {@link H2AMirroredSessionInterests} to {@link INTERESTS_PLAN}. */
export type InterestsKeysMatchPlan = Exact<
  keyof H2AMirroredSessionInterests,
  SentKey<typeof INTERESTS_PLAN>
>;
const _interestsKeysMatchPlan: InterestsKeysMatchPlan = true;
void _interestsKeysMatchPlan;

function sanitizeInterestsForMirror(
  interests: H2ASessionInterests
): H2AMirroredSessionInterests {
  return applyPlan(
    interests,
    INTERESTS_PLAN
  ) as unknown as H2AMirroredSessionInterests;
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
  readonly interests: H2AMirroredSessionInterests;
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
  // Narrowed, not SEND: `isInterests` tolerates extra keys, so a `SEND` here
  // shipped the caller's whole object by reference. See INTERESTS_PLAN.
  interests: narrow<H2ASessionInterests>(sanitizeInterestsForMirror),
  // Element values are NOT re-intersected against the closed topic vocabulary.
  // Recorded, not fixed: `writePresence`/`isH2ASession` reject a non-vocabulary
  // topic at the sender, so the real pipeline cannot reach this; calling
  // `sanitizePresenceForMirror` directly with a hostile element can. Pure
  // defence-in-depth, tracked with the free-text gap.
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
 *
 * ── What this filter does NOT do ───────────────────────────────────────────
 *
 * It answers "is this a NETWORK LOCATOR", not "does this value contain a path or
 * a secret". A bounded, disclosed gap with a known shape: all of
 * `http://localhost/home/you/…`, `https://h/?cwd=/home/you/…`,
 * `https://h/#/home/you/…` and `https://user:sk-live-…@h/` (credentials in the
 * URI's userinfo) are network locators and therefore travel. Mirror endpoint
 * URLs are exactly the kind of value that carries a token, so this is worth
 * naming rather than leaving implied. Content-checking a URI is a different
 * mitigation in kind (userinfo stripping, query/fragment policy) and is tracked
 * with the free-text gap, not silently folded in here.
 */
const MIRRORABLE_ENDPOINT_SCHEMES = ["http:", "https:", "ws:", "wss:"] as const;

/** One endpoint of a registration, as declared locally. */
type H2AEndpointDeclaration = H2AActorRegistration["endpoints"][number];

/**
 * One endpoint as it may LEAVE the machine. Its own plan, so a field added to
 * the endpoints ELEMENT type fails the build instead of travelling — before
 * this, the element was copied whole by `Array.prototype.filter`, which is a
 * pass-through, and the ratchet stopped at `H2AActorRegistration`.
 */
export interface H2AMirroredEndpoint {
  readonly kind: H2AEndpointDeclaration["kind"];
  readonly uri: string;
}

const ENDPOINT_PLAN = {
  kind: SEND,
  uri: SEND
} satisfies MirrorPlanFor<H2AEndpointDeclaration>;

/** The plan, for tests. */
export const MIRROR_ENDPOINT_PLAN: Readonly<Record<string, MirrorFieldPlan<never>>> =
  ENDPOINT_PLAN as Readonly<Record<string, MirrorFieldPlan<never>>>;

/** Pins {@link H2AMirroredEndpoint} to {@link ENDPOINT_PLAN}. */
export type EndpointKeysMatchPlan = Exact<
  keyof H2AMirroredEndpoint,
  SentKey<typeof ENDPOINT_PLAN>
>;
const _endpointKeysMatchPlan: EndpointKeysMatchPlan = true;
void _endpointKeysMatchPlan;

/**
 * Endpoints reachable by a receiver — from an explicit filter, so an empty list
 * is the established fact "no endpoint of this registration is addressable from
 * off this machine", never a defaulted `[]`. Each survivor is then rebuilt from
 * {@link ENDPOINT_PLAN} rather than passed through.
 *
 * `Array.isArray` FIRST, and not as a formality. `isH2AActorRegistration`
 * (`types.ts`) would require this field to be an array, but it **is never called
 * on any production path** — its only non-test references in the tree are its
 * definition, the barrel re-export and this comment. Neither
 * `store.registerInstance` nor `handleRegisterInstance` invokes it; the latter
 * validates its input as `typeof === "object"` and nothing more, so
 * `registerInstance({… endpoints: "nope"})` is accepted and written to
 * `instances.jsonl`. Without the guard, `endpoints.filter` throws a `TypeError`
 * that propagates out of `buildInstanceMirror` and kills the push — a fault this
 * module would have INTRODUCED, since the pre-fix builder shipped `reg` verbatim
 * and never touched `endpoints`. Confidentiality-neutral, availability-negative:
 * exactly the failure a guard justified by a premise that does not exist creates.
 *
 * ── `endpoints: null` — RECORDED IN ROUND 3, CLOSED IN ROUND 5 ────────────
 *
 * The earlier note said this was recorded and left to the ingest half. That was
 * wrong on ownership, and the second review leg was right to push back: the SEND
 * side was emitting a row that violated its OWN declared wire type, so the fix
 * belongs here regardless of what the receiver does.
 *
 * The mechanism: {@link applyPlan} used to skip null BEFORE invoking the narrow,
 * so `Array.isArray` inside {@link sanitizeEndpointsForMirror} — the guard
 * written precisely for this — could never fire for `null`. The field came out
 * ABSENT rather than `[]`, and `runtime/drumbeat/relaunchers.ts:296` reads
 * `store?.findInstance(instance)?.endpoints.find(…)`, whose optional chain stops
 * BEFORE `.endpoints`. A guard that could not fire, which is the same shape this
 * module keeps finding elsewhere.
 *
 * Now closed on both sides: `null` flows through to the narrow (which returns
 * `[]`), and {@link sanitizeRegistrationForMirror} makes the array
 * unconditional, covering the `undefined` case too. Both are pinned by tests.
 */
function sanitizeEndpointsForMirror(
  endpoints: H2AActorRegistration["endpoints"]
): H2AMirroredEndpoint[] {
  if (!Array.isArray(endpoints)) return [];
  return endpoints
    .filter((endpoint) => {
      let scheme: string;
      try {
        scheme = new URL(endpoint.uri).protocol;
      } catch {
        return false; // unparseable, or not an object at all → cannot vouch for it
      }
      return (MIRRORABLE_ENDPOINT_SCHEMES as readonly string[]).includes(scheme);
    })
    .map((endpoint) => applyPlan(endpoint, ENDPOINT_PLAN) as unknown as H2AMirroredEndpoint);
}

/**
 * A registry row as it may LEAVE the machine. Structurally assignable to
 * `H2AActorRegistration`, which is what the ingest path expects when it applies
 * the row via `store.registerInstance`.
 *
 * That assignability is a TYPE-level property only, and deliberately stated that
 * way: `store.registerInstance` does **not** validate with
 * `isH2AActorRegistration` — nothing in production does (see
 * `sanitizeEndpointsForMirror`). So being assignable is what keeps the compiler
 * honest here; it is not evidence that the receiver checks the shape.
 */
export interface H2AMirroredRegistration {
  readonly id: string;
  readonly instance: string;
  readonly roles: H2AActorRegistration["roles"];
  readonly scopes: string[];
  readonly capabilities: string[];
  readonly declaredCapabilities?: string[];
  readonly endpoints: H2AMirroredEndpoint[];
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
  const out = applyPlan(registration, REGISTRATION_PLAN);
  // `endpoints` is REQUIRED by `H2AMirroredRegistration`, and the receiver
  // dereferences it WITHOUT optional chaining (`relaunchers.ts:296`:
  // `…?.endpoints.find(…)` — the chain stops before `.endpoints`). `applyPlan`
  // omits a source field that is `undefined`, so without this the emitted row
  // would violate its own declared wire type and hand the receiver a
  // `TypeError`. `null` is already handled — it now flows through the narrow,
  // which returns `[]` — so this closes the remaining `undefined` case and makes
  // the array unconditional.
  if (!Array.isArray(out.endpoints)) out.endpoints = [];
  return out as unknown as H2AMirroredRegistration;
}

// ─── Envelope actor ─────────────────────────────────────────────────────────

/** Role used when the registration declares none usable. */
const MIRROR_FALLBACK_ROLE: H2ARole = "AGENTS";
/** Scope used when the registration declares none usable. */
const MIRROR_FALLBACK_SCOPE = "scope:default";

/**
 * First usable element of a declared list, or the fallback.
 *
 * `Array.isArray` first, and not as a formality — the same reason it guards
 * {@link sanitizeEndpointsForMirror}. `h2a_register_instance` accepts an
 * arbitrary object and `isH2AActorRegistration` is not called on any production
 * path, so `roles` can be a bare string at runtime despite its `H2ARole[]` type.
 * The previous `reg.roles?.[0]` then indexed the STRING: `"NOTANARRAY"` yielded
 * `"N"`, a value that is not a role, not a diagnostic, and travelled anyway.
 */
function firstDeclared(values: unknown, fallback: string): string {
  if (!Array.isArray(values)) return fallback;
  const first: unknown = values[0];
  return typeof first === "string" && first.length > 0 ? first : fallback;
}

/**
 * The envelope's `actor`, derived from the SANITIZED registration.
 *
 * Taking `H2AMirroredRegistration` rather than `H2AActorRegistration` is the
 * whole point and is worth not "simplifying" later: the raw record is not in
 * scope here, so this function CANNOT read a withheld field even by mistake.
 * Every value it can reach has already been through {@link REGISTRATION_PLAN},
 * which makes "the envelope carries nothing the body does not already carry" a
 * consequence of the signature instead of a claim in a comment.
 *
 * `role` is re-intersected against `H2A_ROLES`. That is a genuinely closed
 * vocabulary check, not a shape check: `roles[]` element VALUES are otherwise
 * free text (disclosed above), and this is the one place where an element value
 * escapes the body into the envelope, so it is the one place worth closing.
 *
 * ── STRUCK, AND LEFT VISIBLE ON PURPOSE ────────────────────────────────────
 *
 * An earlier version of this comment continued: ~~"`isH2AEnvelope` requires a
 * vocabulary role anyway, so a non-role here produced an envelope that fails the
 * protocol's own guard."~~ **That is false.** `isH2AEnvelope` delegates to
 * `validateH2AEnvelope` (`envelope.ts:109`), which checks `actor` only for
 * `typeof actor.instance === "string"`. It never looks at `role`. Measured:
 *
 *   isH2AEnvelope(actor.role = "/home/antoinefa/NOTAROLE")  -> true
 *   isH2AEnvelope(actor with no role at all)                -> true
 *   isH2AEnvelope(actor with no instance)                   -> false
 *
 * There IS a function that checks the vocabulary — `isActorRef`, `envelope.ts:27`
 * — but it is module-private and referenced nowhere in the tree. A guard that
 * cannot fire.
 *
 * The sentence is struck rather than deleted because of what it was doing: it
 * supplied a REASON TO DELETE THE RE-INTERSECTION BELOW. "The protocol guard
 * catches it anyway" is exactly the argument someone would use to remove that
 * line, and removing it restores the leak. A false justification for a live
 * guard is more dangerous than no justification at all — nothing downstream
 * validates this field, so the check here is the only one there is.
 *
 * `scope` is NOT closed — there is no scope vocabulary to close it against — but
 * it is now sourced from the sanitized registration rather than hardcoded, so
 * the trap is disarmed by construction: the "obvious edit" has already been made
 * here, safely, under test. Its value is free text and rides out under the same
 * disclosed gap as `scopes[]` in the body, which already transmits it verbatim.
 */
export function sanitizeActorForMirror(
  instance: string,
  mirrored: H2AMirroredRegistration
): H2AActorRef {
  const declaredRole = firstDeclared(mirrored.roles, MIRROR_FALLBACK_ROLE);
  return {
    instance,
    role: (H2A_ROLES as readonly string[]).includes(declaredRole)
      ? (declaredRole as H2ARole)
      : MIRROR_FALLBACK_ROLE,
    scope: firstDeclared(mirrored.scopes, MIRROR_FALLBACK_SCOPE)
  };
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
