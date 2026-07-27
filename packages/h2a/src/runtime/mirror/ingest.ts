/**
 * EVO-13 / feed-contract P1 — the mirror's **INGEST BOUNDARY**, the symmetric
 * half of `sanitize.ts`.
 *
 * `sanitize.ts` closed what this CLI SENDS. It protects nothing that a *different*
 * sender pushes at us: `serve.ts` wired `applyRegistration: (reg) =>
 * store.registerInstance(reg)` and `writePresence(root, {...session, …})`, both
 * raw passthroughs, so an agent running a CLI older than that fix kept landing
 * `workspace.path`, `launchContext` (cwd, command line, tty, tmux), `pid`,
 * `workspace.repo` and `file://` endpoint uris in the hosted root — measured, and
 * measured *through this very path*, not argued.
 *
 * The rule is the one `sanitize.ts` states, applied to the other boundary:
 *
 *   **Sanitize at the boundary you are responsible for; never assume an upstream
 *   or downstream sanitizer.** A sanitizer on the SEND side does not protect data
 *   at rest in someone else's store, because the sender is not the only sender.
 *
 * ── WHY THIS FILE REUSES THE SEND PLANS INSTEAD OF RESTATING THEM ───────────
 *
 * Two boundaries with two copies of "what may travel" is two things to keep in
 * step, and they would not stay in step: the compile-time ratchet in
 * `sanitize.ts` fires when a field is added to `H2ASession`, and it would fire
 * for the send copy only. A second, hand-maintained ingest allowlist would drift
 * silently — which is the exact failure mode the field plans exist to remove.
 *
 * So the narrowing here IS `sanitize*ForMirror`. Not "the same rules"; the same
 * functions. There is one definition of what may cross the mirror boundary and
 * both directions call it.
 *
 * ── ORDERING: AFTER VERIFICATION, AND WHY THAT IS THE ONLY CHOICE ───────────
 *
 * The envelope is signed over its body. Narrowing the body BEFORE
 * `verifyEnvelopeSignature` would change the signed bytes and every push would
 * fail verification — sanitize-then-verify is not a stricter option, it is a
 * broken one. So narrowing happens strictly after the signature is verified,
 * which is where `accept.ts` invokes the apply callbacks anyway.
 *
 * The honest consequence, stated rather than glossed: **the raw record exists in
 * the ingester's process memory** between `JSON.parse` and narrowing. That is
 * unavoidable for any signed payload and it is not what this boundary claims to
 * fix. What it claims, and what the tests assert, is narrower and checkable:
 * *no withheld field reaches DISK.* Data at rest is the thing a send-side
 * sanitizer cannot protect and the thing this closes.
 *
 * Narrowing also never precedes an AUTHORIZATION decision. `accept.ts` filters
 * registrations by `publicKeys` against the verified key first, and only then
 * narrows the survivors, so a narrowing step can never widen or change who is
 * allowed to write. (`publicKeys` is transmitted either way, so this is an
 * ordering choice made for clarity, not a necessity — recorded so the next
 * reader does not "simplify" it by narrowing earlier.)
 *
 * ── NARROW, DO NOT REJECT ──────────────────────────────────────────────────
 *
 * A record arriving with withheld fields is narrowed and applied, never refused.
 * Refusing is the more positive form and it was considered: it tells the sender
 * its CLI is stale instead of quietly repairing it. It was rejected because the
 * senders that trip it are precisely the un-upgraded ones, and a 4xx would take
 * their presence off the hosted surface entirely — trading a confidentiality
 * problem this module already fixes for an availability problem it would create.
 * A hosted mirror that drops every old agent is not a safer mirror.
 *
 * The middle path is taken instead, so that "forgiving" does not become
 * "silent": {@link droppedKeyPaths} reports what narrowing actually removed, and
 * `accept.ts` returns it on the 202 as `narrowed: { records, fields }`. Staleness
 * becomes a number an operator can watch rather than an absence nobody notices.
 * Field NAMES are returned, never values — the names are the sender's own schema
 * and disclose nothing the sender does not already have.
 *
 * ── THE INGEST RATCHET ─────────────────────────────────────────────────────
 *
 * `sanitize.ts`'s ratchet answers "is every FIELD of a transmitted type
 * classified?". It cannot answer the question this boundary has to answer: "is
 * every record-carrying MEMBER of the mirror body narrowed on arrival?" Adding a
 * fourth member to `H2AInstanceMirrorBody` and an `applyX` beside it in
 * `serve.ts` would compile clean and pass every send-side test while landing raw
 * records — the send plans say nothing about it, because on the send side
 * `build.ts` populates that member and would have sanitized it there.
 *
 * {@link INGEST_NARROWERS} closes that with the same instrument one level up: a
 * map from body member to narrower, `satisfies` a mapped type over
 * {@link MirrorBodyRecordMember} — the members of `H2AInstanceMirrorBody` whose
 * type is an array of objects. Add `tasks: H2ATask[]` to the body and the map is
 * missing a key and the **build fails**. Scalar members (`kind`, `seq`) are
 * excluded by the same conditional, so they neither need nor get an entry.
 *
 * Where it stops, said out loud: the conditional keys off the member's TYPE, so a
 * member typed `any[]` — or `any` — resolves both branches and is not forced.
 * That is the same `any` hole `sanitize.ts` names, and it is covered the same way,
 * one rung lower, by a runtime test that reads the map against the body a real
 * sender builds (`mirror-ingest-boundary.test.js`).
 */
import type {
  H2AActorRegistration,
  H2ASession,
  H2ASubagentBinding
} from "@sentropic/h2a";
import type { H2AInstanceMirrorBody } from "./build.js";
import {
  sanitizePresenceForMirror,
  sanitizeRegistrationForMirror,
  sanitizeSubagentForMirror,
  type H2AMirroredRegistration as SanitizedRegistration,
  type H2AMirroredSession as SanitizedSession,
  type H2AMirroredSubagentBinding as SanitizedSubagentBinding
} from "./sanitize.js";

/**
 * An ingest-only nominal marker. The send-side types deliberately describe the
 * shape of a serializable record, so raw local records with extra fields are
 * structurally assignable to them. Callbacks need a stronger guarantee: only a
 * value returned by one of this module's narrowers may reach a store writer.
 *
 * `declare` keeps the marker type-only: it never becomes a field in a mirrored
 * record or on disk. The casts below are the sole fabrication points.
 */
declare const MIRROR_INGEST_NARROWED: unique symbol;

export type H2AMirroredRegistration = SanitizedRegistration & {
  readonly [MIRROR_INGEST_NARROWED]: true;
};
export type H2AMirroredSession = SanitizedSession & {
  readonly [MIRROR_INGEST_NARROWED]: true;
};
export type H2AMirroredSubagentBinding = SanitizedSubagentBinding & {
  readonly [MIRROR_INGEST_NARROWED]: true;
};

type Assert<T extends true> = T;
type NotAssignable<Raw, Narrowed> = Raw extends Narrowed ? false : true;

// Compile-time regression guard for the nominal boundary above. If the brand is
// removed, the raw local types become structurally assignable again and this
// file fails the build before a callback can be changed back to passthrough.
type _RawRegistrationCannotReachCallback = Assert<
  NotAssignable<H2AActorRegistration, H2AMirroredRegistration>
>;
type _RawSessionCannotReachCallback = Assert<NotAssignable<H2ASession, H2AMirroredSession>>;
type _RawSubagentCannotReachCallback = Assert<
  NotAssignable<H2ASubagentBinding, H2AMirroredSubagentBinding>
>;

/**
 * Members of the mirror body that carry RECORDS — i.e. whose type is an array of
 * objects. `kind` (a string literal) and `seq` (a number) are excluded by the
 * conditional, so the map below is not asked to narrow a scalar.
 *
 * `-?` strips optionality before the test, so `presence?` and `subagents?` are
 * required entries in the map: an OPTIONAL member is still a member that lands
 * records when it is present, and the ratchet must not be dodgeable by adding a
 * `?`.
 */
export type MirrorBodyRecordMember = {
  [K in keyof H2AInstanceMirrorBody]-?: NonNullable<
    H2AInstanceMirrorBody[K]
  > extends readonly object[]
    ? K
    : never;
}[keyof H2AInstanceMirrorBody];

/**
 * The narrowing applied to each record-carrying body member on arrival.
 *
 * This map is not documentation — it is the only route by which a record reaches
 * a store writer, so deleting an entry breaks the build at its use site rather
 * than silently disabling a boundary. Each value is the SEND-side function,
 * reused verbatim; see the module header for why there is no ingest-side copy.
 */
export const INGEST_NARROWERS = {
  registrations: sanitizeRegistrationForMirror,
  presence: sanitizePresenceForMirror,
  subagents: sanitizeSubagentForMirror
} satisfies { readonly [K in MirrorBodyRecordMember]: (record: never) => object };

/** Narrow an arriving registration to the fields the mirror boundary permits. */
export function narrowIngestedRegistration(
  registration: Parameters<typeof INGEST_NARROWERS.registrations>[0]
): H2AMirroredRegistration {
  return INGEST_NARROWERS.registrations(registration) as H2AMirroredRegistration;
}

/** Narrow an arriving presence record to the fields the mirror boundary permits. */
export function narrowIngestedPresence(
  session: Parameters<typeof INGEST_NARROWERS.presence>[0]
): H2AMirroredSession {
  return INGEST_NARROWERS.presence(session) as H2AMirroredSession;
}

/** Narrow an arriving subagent binding to the fields the mirror boundary permits. */
export function narrowIngestedSubagent(
  binding: Parameters<typeof INGEST_NARROWERS.subagents>[0]
): H2AMirroredSubagentBinding {
  return INGEST_NARROWERS.subagents(binding) as H2AMirroredSubagentBinding;
}

/** What narrowing removed from one mirror push. */
export interface MirrorNarrowingReport {
  /** Records that lost at least one key path. Zero ⇒ the sender is up to date. */
  readonly records: number;
  /** Sorted, de-duplicated key paths that were dropped. Names only, never values. */
  readonly fields: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Key paths present in `before` and absent from `after` — i.e. what the plans
 * actually removed.
 *
 * Deliberately an OBSERVATION of the narrowing rather than a second reading of
 * the plans. Re-deriving "what is withheld" from `MIRROR_*_PLAN` here would
 * reintroduce the duplication this module exists to avoid, and would miss the
 * two things the plans do not express as withheld fields at all: nested
 * composites rebuilt by their own plan (`workspace.path` is withheld by
 * `WORKSPACE_PLAN`, not by `PRESENCE_PLAN`), and endpoints removed by the scheme
 * filter, which is not a field classification at all. Diffing catches both for
 * free and cannot drift from the plans, because it has no opinion of its own.
 *
 * ── EXACT WHERE IT MATTERS, INDICATIVE WHERE IT DOES NOT ───────────────────
 *
 * This value is a DIAGNOSTIC — it gates nothing and authorizes nothing — so it is
 * worth being precise about which parts are load-bearing:
 *
 *  - **Exact**: whether the list is empty. It is empty iff narrowing removed no
 *    key path, which is the property the operator signal rests on. Object keys
 *    and array-length shrinkage are both compared directly.
 *  - **Exact**: object key paths, at every depth (`workspace.path`,
 *    `launchContext`).
 *  - **Indicative**: an index inside an array path. Elements are compared
 *    positionally, and the endpoint scheme filter REMOVES elements, so after a
 *    filtered element the survivors shift left and `endpoints[0].x` names a
 *    position, not a stable address. The length-shrink marker `endpoints[]` is
 *    exact; the per-element paths after it are a hint. Today this is moot —
 *    `ENDPOINT_PLAN` withholds nothing, so a surviving element loses no keys —
 *    and it is written down so that stops being an accident.
 *
 * `null`/`undefined` in `before` are not reported: `applyPlan` omits them by
 * design, so treating an absent-because-empty field as "dropped" would report
 * every optional field a sender left unset and drown the real signal.
 */
export function droppedKeyPaths(before: unknown, after: unknown, prefix = ""): string[] {
  const dropped: string[] = [];
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return prefix ? [prefix] : [];
    if (after.length < before.length) dropped.push(`${prefix}[]`);
    for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
      dropped.push(...droppedKeyPaths(before[i], after[i], `${prefix}[${i}]`));
    }
    return dropped;
  }
  if (isPlainObject(before)) {
    if (!isPlainObject(after)) return prefix ? [prefix] : [];
    for (const [key, value] of Object.entries(before)) {
      // Absent-and-empty is how `applyPlan` represents "nothing to send", not a
      // removal. Reporting it would make every unset optional field look stale.
      if (value === undefined || value === null) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (!(key in after)) dropped.push(path);
      else dropped.push(...droppedKeyPaths(value, after[key], path));
    }
    return dropped;
  }
  return dropped;
}

/**
 * Accumulates {@link MirrorNarrowingReport} across the records of one push.
 *
 * Stateful on purpose and scoped to a single envelope: `accept.ts` is otherwise
 * pure, and this keeps the impurity in one named, obviously-per-request object
 * instead of threading counters through the accept logic.
 */
export function createNarrowingTally(): {
  note: (before: unknown, after: unknown) => void;
  report: () => MirrorNarrowingReport;
} {
  let records = 0;
  const fields = new Set<string>();
  return {
    note: (before, after) => {
      const paths = droppedKeyPaths(before, after);
      if (paths.length === 0) return;
      records += 1;
      for (const path of paths) fields.add(path);
    },
    report: () => ({ records, fields: [...fields].sort() })
  };
}
