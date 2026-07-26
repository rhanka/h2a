# STUDY — h2a integration boundary for Sentropic: READ → WRITE → EXECUTE

Status: **h2a-side boundary study; no implementation and nothing armed.**

Target surface: the authenticated Sentropic web application at
`sentropic.sent-tech.ca`, including its mobile view. This is **not** the
claude.ai MCP connector.

This document specifies what h2a may expose, what it may accept in return, and
the guarantees at that boundary. It does not specify the Sentropic gateway,
web application, tenant model, or identity-provider internals. Decisions in
those lanes are named and left open in §9.

## 1. Outcome

“h2a integrated into Sentropic” is an **authority ladder**, not one feature:

1. **READ — focus stacked across projects:** show decision dossiers from
   several repositories in one cockpit, grouped by repository and swipeable.
2. **WRITE — remote control:** act on one local agent from a remote surface.
3. **EXECUTE — proxied UAT:** run an approved UAT through Sentropic against an
   environment controlled by somebody else.

No grant is inferred from another grant. In particular:

- seeing a card does not grant the right to answer it;
- answering a card does not grant arbitrary terminal input;
- controlling one's own agent does not grant execution in another person's
  environment;
- a display name, `actor.instance`, repository label, route id, binding id, or
  URL is never a credential.

The mobile design spans the ladder without collapsing it: h2a emits structured
questions and option ids so the Sentropic app can render large tap targets.
Under READ, those cards are view-only. Once WRITE is separately active, a tap
can submit the structured answer without asking the owner to retype it.
Unrestricted session input is not a harmless extension of that tap: it can
induce execution under the agent's credentials and therefore needs explicit
confinement and a broader grant (§5).

## 2. Facts and hard constraints

### 2.1 The local h2a bus does not authenticate the claimed sender

Today an h2a envelope must contain `actor.instance`, but the ordinary local
mailbox write paths validate the envelope's shape and recipient routing only:

- `packages/h2a/src/runtime/mcp/handlers.ts` `handleInbox(..., action:"put")`
  calls `store.putInboxMessage`;
- `packages/h2a/src/runtime/local-files/store.ts` `putInboxMessage` calls
  `validateH2AEnvelope` and writes the envelope;
- neither path resolves a public key or verifies a signature for
  `envelope.actor.instance`.

The separate off-host receive path, `runtime/remote/accept.ts`, does perform a
registry-key signature check. That does not retroactively authenticate ordinary
bus messages, and the registry's initial registration can itself be supplied by
a caller (`handleRegisterInstance` accepts an object and `registerInstance`
appends it).

Therefore:

> **Identity by name is fabricable. Identity by owned work or controlled
> placement is falsifiable.**

`actor.instance`, agent names, session titles, and roles may be rendered as
untrusted labels. They MUST NOT select an authorization row, a control target,
an execution target, or a revocation subject.

### 2.2 The old mirror is absent as an operational dependency

The June mirror is not a service to turn back on:

- the P1 joint plan records a one-shot demo, a stale enrolled key that now
  receives 401, hosted enrollment off, and no continuous service;
- a daemon implementation now exists, but the shipped
  `contrib/systemd/h2a-mirror-push.service` contains placeholder target,
  instance, and key values and ships with `H2A_MIRROR_PUSH_OFF=1`;
- the old surface served the claude.ai MCP connector, not the Sentropic web
  application.

This study therefore treats the old hosted mirror as **absent**. Reuse of its
signed-envelope and replay primitives is allowed; reliance on its operational
state is not.

### 2.3 PR #46 is a no-arm gate

The requested base, `0f285c2`, does not contain the ingest-boundary work. A
local remote-tracking branch named `origin/fix/mirror-sanitize-at-ingest` exists
at `d00bbff`, but its mapping to GitHub PR #46 and its current review/merge
state could not be independently checked without GitHub access. Its local
history also contains a commit explicitly labelled `UNVERIFIED BACKUP, DO NOT
MERGE`; the branch proves that work exists, not that the prerequisite is safe
or accepted.

The owner identifies **PR #46 as the ingest prerequisite**. Consequently:

- Rung 1 depends on #46 directly: no session/dossier feed is armed until the
  arriving records are narrowed before persistence and the accepted wire types
  are the only types that can reach the store writer.
- Rungs 2 and 3 must use separate privileged command channels, not the mirror;
  they do not inherit authorization from #46. They are nevertheless behind the
  same operational no-arm gate: no Sentropic-facing integration is enabled
  while the shared deployment still lacks the required ingest boundary.
- Landing #46 does **not** unblock WRITE or EXECUTE. It closes one READ-path
  prerequisite only.

### 2.4 Existing useful pieces are not complete capabilities

At the base commit:

- browser-safe instance/session descriptor builders exist under
  `runtime/feed/`, but their own comments say they are not wired into hosted
  handlers;
- the agent-side enrollment proof exists and proves possession of a local key,
  but a signature proves authorship, not authorization, and signing an
  `instance` string does not make the string authoritative;
- `packages/focus-interactive` defines multi-project decision keys, ordered
  cards, swipe state, options, and feedback intents;
- the remote protocol defines `uat-expose` and UAT route lifecycle shapes, but
  those are descriptive schemas, not an execution authorization system.

## 3. Common authority rules

Every rung has its own grant and proof. A valid proof is accepted only when all
of these rules hold:

1. **Grant before proof:** the proof demonstrates possession or provenance; an
   active grant determines what that proof may reach.
2. **No name-indexed authorization:** all authority keys are opaque, minted
   references tied to a verified binding. Names are display-only.
3. **Whole-request binding:** the proof covers its version, rung, grant ref,
   target ref, action or read scope, payload digest, issuer/audience, nonce,
   issue time, expiry, and, where applicable, idempotency key. A field not
   covered by the proof is not accepted as authoritative.
4. **Narrowing only:** client hints may reduce the grant's scope, never expand
   it.
5. **Current state:** expiry, revocation, target liveness, and target ownership
   are checked at use time, not copied from enrollment-time provenance.
6. **Fail closed and factual emptiness:** an unread/failed source is an error,
   never an empty feed. An empty feed means h2a actually read the sources and
   established that nothing matched.
7. **Receipts match effects:** “accepted”, “delivered”, “executed”, and
   “passed” are distinct states. A queued write is not reported as an agent
   action; a created UAT route is not reported as a test run.
8. **Local kill switch wins:** h2a can disable each privileged rung locally
   even if the remote grant still appears active.

“Owned work” in this contract means a locally resolved work source under an
active publisher/placement binding, with immutable content/revision evidence
that makes the claim falsifiable. A digest is **provenance, not proof of
control**: it is copyable. Control is established by the active enrolled
publisher or by a challenge completed through a supervisor-controlled live
placement. A self-reported repository name, agent name, or copied digest
establishes neither identity nor authority.

### 3.1 What “forged proof” means

Each rung distinguishes three failures:

- a forged **per-request assertion**, while the independent grant store and
  target binding remain sound, reaches at most one resolved active grant;
- a forged **publisher/target/runner binding** can impersonate the resource
  covered by that binding, but must not mint a broader grant;
- compromise of the **grant issuer, verifier trust anchor, or grant store** can
  affect every grant under that anchor's configured principal/tenant/rung.

The per-rung blast-radius sections state all three. Treating only the first case
as “proof forgery” would silently assume the most powerful components cannot be
compromised.

## 4. Rung 1 — READ: focus stacked multi-project

### Grant

The owner grants one authenticated Sentropic principal permission to read the
sanitized h2a feed for an explicitly confirmed set of workspace/agent bindings.
The grant permits:

- repository-grouped decision cards;
- the browser-safe dossier projection behind each card, including its
  immutable revision, stakes/risk reasons, options, and evidence references;
- swipe ordering across repositories;
- browser-safe session liveness metadata;
- immutable work provenance sufficient to tell which repository and revision
  produced a card.

It does not permit answers, bus writes, transcript access, raw presence,
filesystem paths, command lines, tmux/pane coordinates, process ids, keys,
message bodies outside the dossier, or routable counterpart/session handles.

### Proof of the grant

**Confirm-first is the proportionate target assurance for this rung**, provided
that confirmation is attached to the binding and recognizable work, rather
than to a claimed agent name:

1. the owner is in a first-party authenticated Sentropic session;
2. the local side answers a nonce-bound enrollment challenge with proof of key
   possession;
3. the owner confirms a proposed exposure showing the workspace's locally read
   work provenance, not merely its name;
4. an active principal↔key/workspace binding is used for every feed resolution;
5. h2a re-resolves the current key/work relation and emits an authenticated,
   grant-scoped publication containing only the sanitized browser contract.

The key proves control of the endpoint that answered. Owner confirmation grants
read exposure. The publication proof binds the snapshot to the current enrolled
publisher and workspace binding. A card or session line received from the
ordinary bus is not enough. `instanceId`, `sessionId`, and names remain
provenance/display data, not authorization inputs.

### Revocation

Any of these revokes READ:

- the principal binding becomes revoked or expired;
- the owner disables the local feed/push kill switch;
- the local key is rotated without a new binding;
- the workspace exposure is removed;
- the target can no longer establish current work ownership.

Revocation must affect the next read and next push. It cannot recall a card
already rendered, copied, photographed, or notified to a phone. Treatment of
cached copies is a Sentropic-owned cache/retention decision; any retained copy
must not continue to look live or authorized.

### Blast radius if the proof is forged

- A forged read-request/publication assertion with sound grant and publisher
  bindings exposes the sanitized data of the one independently resolved grant.
- A forged publisher/workspace binding can substitute the feed for the
  workspaces covered by that binding.
- A compromised READ grant issuer, trust anchor, or grant store can expose
  every READ binding under its configured principal/tenant scope.

In every case the harm is **information disclosure**: project labels,
questions, options, dossier risks, status, timing, and bounded work provenance.
Already rendered data cannot be clawed back. Paths, commands, credentials, bus
addresses, and write handles remain outside this contract so READ cannot become
a bus pivot by itself.

### Are today's guarantees sufficient?

**No, not sufficient or armable today.** The owner has already given the P1
read-only product/design **GO**, and confirm-first is proportionate to that
sanitized owner-only target. Operational state remains **HOLD** because:

- #46 has not landed on the base;
- the old mirror is treated as absent;
- the principal-scoped resolver and Sentropic web panel belong to other lanes;
- current living agents have not been proven re-enrolled against this feed.

Step 3 is complete only when **living agents are re-enrolled and an
authenticated fresh publication returns a session line for each of them from
its active publisher binding**. A decision card is not a session line. A bus
line with a claimed actor, a static list, a stale mirror row, or code that can
theoretically enroll does not satisfy completion.

## 5. Rung 2 — WRITE: remote control of a local agent

### Grant

The owner grants an authenticated remote principal a bounded action set against
one exact `controlTargetRef`, for a bounded time. The baseline WRITE action is
`decision.reply`: a typed binding-scoped decision reference, revision,
`optionId`, and optional note, idempotent and tied to the card's workspace and
work digest.

`session.input` is a distinct high-risk remote-control action. It can be
offered under WRITE only when the target placement is demonstrably confined to
the owner's environment and has no path to somebody else's UAT environment.
Otherwise it is categorically rejected. A Rung 3 grant is not an upgrade token
for arbitrary terminal text: operations against somebody else's environment
must use the separate immutable `H2AUatExecutionV1` request. Calling arbitrary
input “WRITE” cannot make its induced execution safe.

The allowed action vocabulary is closed and versioned on the h2a side. The
grant lists its allowed subset. A grant for `decision.reply` does not imply
`session.input`, interrupt, restart, shell, file, network, or UAT authority.

### Proof of the grant

This rung requires an **active target binding** that does not exist today.

The binding must be minted by a local h2a control broker after it:

1. identifies the managed placement through a host adapter (for example a
   provider session id plus a tmux pane or a managed pod session), not through a
   bus name;
2. completes a fresh challenge through that exact placement;
3. binds the challenge response to a broker-observed key and current work
   evidence;
4. mints an opaque `controlTargetRef` and an expiring action lease.

An incoming action additionally carries a verifiable remote authorization
assertion bound to the principal, grant, target, workspace, exact action
payload, nonce, expiry, and idempotency key. h2a atomically checks the
assertion, active local target binding, action allowlist, decision/workspace
ownership, confinement where required, and live placement at effect injection.

An envelope with a forged `actor.instance` but no active target binding is
rejected even if it is well-formed. A registry row or a valid signature by a
self-registered key is not a substitute.

For phone use, `decision.reply` accepts the stable non-empty option set emitted
in Rung 1. The UI can make the question tappable; h2a receives a typed answer
rather than reconstructed prose. h2a resolves the opaque `decisionRef` under
the exact target/workspace binding and validates option membership. A stale
revision returns a typed conflict instructing the client to refresh through the
READ contract; it does not return the card to a WRITE-only caller. Another
target's decision is rejected even when the action proof is otherwise valid.

### Revocation

Any of these revokes WRITE:

- the remote grant is revoked or expires;
- the local target lease expires;
- the local control kill switch is set;
- the placement dies, changes identity, or loses the bound work;
- the broker key or remote verifier key is rotated;
- the owner explicitly detaches the target.

The durable replay/idempotency record and active lease are checked atomically at
effect consumption, not only when a request is queued. Queued but unapplied
actions are discarded on revocation. Whether an already in-flight action can
be interrupted is action-specific and must be reported honestly in the
receipt.

### Blast radius if the proof is forged

- A forged action assertion with a sound grant and target binding reaches the
  one target/action set independently allowed by that active grant.
- A forged target binding impersonates the one placement and its reachable
  owner-controlled resources; confinement failure can widen this to external
  environments and must escalate to Rung 3.
- A compromised WRITE grant issuer, verifier trust anchor, or grant store can
  control every WRITE target under that configured scope.

Even though this rung is named WRITE, arbitrary agent input can induce file
changes, commands, network calls, or secret access under the agent's OS
credentials. Target/action/time/confinement binding bounds the radius;
authorizing by a name would make the radius every agent an attacker can
impersonate.

### Are today's guarantees sufficient?

**No — BLOCKED.** The ordinary h2a bus does not authenticate its sender and has
no active, supervisor-anchored target binding. Before WRITE can be armed, h2a
must build:

- the local control broker and placement challenge;
- opaque active target bindings and revocation;
- a versioned remote-action envelope with replay/idempotency protection;
- an authorization-assertion verifier whose trust anchor is configured, not
  self-declared;
- placement confinement evidence for any action broader than a typed decision
  reply;
- effect receipts that distinguish accepted, injected, observed, and failed.

PR #46 is necessary as the global no-arm gate but is not sufficient for any of
these items.

## 6. Rung 3 — EXECUTE: UAT proxied through Sentropic

### Grant

The environment owner grants one authenticated requester permission to execute
one immutable UAT plan against one exact environment, using one constrained
runner identity. The grant is bound to:

- environment and deployment/workload identity;
- workspace plus commit/tree or artifact digest;
- UAT plan/command manifest digest;
- allowed runner capability, ports, egress, secret classes, and destructive
  mode;
- issue time, short expiry, nonce, use count, and maximum duration.

Creating or viewing a UAT route is not this grant. Neither an h2a READ binding
nor an h2a remote-control binding implies it.

### Proof of the grant

This rung requires stronger, independent assurance than Rung 2:

1. an authenticated requester authorization;
2. explicit authorization by the **environment owner** for the exact plan and
   environment;
3. an active runner/workload binding rooted in provisioned workload identity,
   not `actor.instance`;
4. a one-shot or tightly counted execution capability whose proof covers the
   complete request;
5. a signed execution receipt binding outputs, logs/evidence digests, exit
   state, runner identity, environment, and plan digest.

h2a's executor admits the request only when all bindings agree. It rechecks
revocation before each material phase. The Sentropic UAT proxy may relay the
request and evidence; it does not get to rewrite the plan after authorization.

### Revocation

Any of these revokes EXECUTE:

- requester or environment-owner grant revocation;
- runner/workload identity revocation;
- local/environment kill switch;
- route or capability expiry/use exhaustion;
- plan, artifact, environment, or policy digest mismatch;
- loss of the execution isolation boundary.

The material phase boundaries are admission, temporary-credential issuance,
route creation, runner start, each separately admitted test phase, evidence
publication, and teardown. Revocation is rechecked before each; after
revocation no new credential, route, process, phase, or retry may start. The
executor attempts to stop an in-flight side effect but cannot promise to undo
one already performed, and reports whether termination was confirmed. Route
teardown and temporary credential revocation are part of closure, not
asynchronous cleanup that may be forgotten.

### Blast radius if the proof is forged

- A forged requester assertion with sound environment-owner grant and runner
  binding reaches only the one independently approved execution grant.
- A forged environment-owner grant or runner/workload binding can authorize or
  impersonate execution inside that environment's runner boundary.
- A compromised EXECUTE grant issuer, environment-owner trust anchor, workload
  trust anchor, or grant store can authorize every environment/run under that
  configured scope.

The resulting harm is **arbitrary execution against somebody else's
environment** within whatever the runner can reach: data destruction, secret
exfiltration, lateral movement, service disruption, and false UAT evidence.
The minimum defensible radius is one isolated environment, service account,
network policy, secret set, immutable plan, and short execution window. If
those bounds are not real, the radius is the entire hosting account or network.

### Are today's guarantees sufficient?

**No — BLOCKED.** Existing `uat-expose`, `UatExposurePolicy`, and
`uat.route.created` shapes establish vocabulary and lifecycle only. They do not
prove requester authority, environment-owner consent, runner identity, plan
immutability, confinement, revocation, or execution evidence.

EXECUTE may reuse non-name-based assertion, replay, idempotency, and revocation
primitives designed alongside Rung 2. It does **not** require an active WRITE
grant, a `controlTargetRef`, or shipment of remote control first. Its
environment-owner grant, workload binding, constrained executor, phase-bound
revocation, and attested receipt are independent and mandatory.

## 7. Boundary contract

The shapes below state h2a's side of the seam. Field names are indicative for
the STUDY; promotion to an EVOL spec must freeze versioned schemas.

### 7.1 h2a exposes: authenticated browser-safe READ publication

```ts
interface H2AReadRequestV1 {
  readonly schema: "h2a.read-request.v1";
  readonly requestId: string;
  readonly readGrantRef: string;
  readonly requestedWorkspaceRefs?: readonly string[]; // may narrow only
  readonly audience: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly authorizationProof: unknown;
}

/** Exactly one enrolled publisher binding; never a multi-agent aggregate. */
interface H2ASourcePublicationV1 {
  readonly schema: "h2a.read-source-publication.v1";
  readonly requestId: string;
  readonly readGrantRef: string;
  readonly publisherBindingRef: string;
  readonly audience: string;
  readonly sequence: number;
  readonly producedAt: string;
  readonly expiresAt: string;
  readonly bodyDigest: string;
  readonly body: {
    readonly freshness: "fresh" | "stale";
    readonly sources: {
      readonly decisions: "read";
      readonly presence: "read";
      readonly registry: "read";
    };
    readonly focus: H2AFocusFeedV1;
    readonly sessions: H2ASessionFeedV1;
  };
  readonly publisherProof: unknown;
}

interface H2AReadAggregateV1 {
  readonly schema: "h2a.read-aggregate.v1";
  readonly requestId: string;
  readonly readGrantRef: string;
  readonly audience: string;
  readonly state: "complete";
  readonly asOf: string;
  /** Non-empty; the zero-binding result has its own type below. */
  readonly sourcePublications: readonly [
    H2ASourcePublicationV1,
    ...H2ASourcePublicationV1[]
  ];
  readonly aggregateDigest: string;
  readonly aggregatorProof: unknown;
}

interface H2AReadEmptyV1 {
  readonly schema: "h2a.read-empty.v1";
  readonly requestId: string;
  readonly readGrantRef: string;
  readonly audience: string;
  readonly state: "complete";
  readonly reason: "no-active-bindings";
  readonly asOf: string;
  readonly sourcePublications: readonly [];
  /** Authenticates the factual binding lookup; not a fake publisher proof. */
  readonly bindingResolutionProof: unknown;
}

interface H2AReadFailureV1 {
  readonly schema: "h2a.read-failure.v1";
  readonly requestId: string;
  readonly state: "failed";
  readonly source:
    | "authorization"
    | "binding-resolution"
    | "decisions"
    | "presence"
    | "registry";
  readonly code:
    | "unauthorized"
    | "revoked"
    | "expired"
    | "source-unreadable"
    | "publication-invalid";
}

type H2AReadResultV1 =
  | H2AReadAggregateV1
  | H2AReadEmptyV1
  | H2AReadFailureV1;

interface H2AFocusFeedV1 {
  readonly schema: "h2a.focus-feed.v1";
  readonly asOf: string;
  readonly cursor: string;
  readonly projects: readonly ProjectDeckV1[];
}

interface ProjectDeckV1 {
  /** Opaque binding-scoped reference; not a path, repo URL, or credential. */
  readonly workspaceRef: string;
  readonly workspaceLabel: string; // untrusted display text
  readonly feedState: "fresh" | "stale";
  readonly decisions: readonly DecisionCardV1[];
}

interface DecisionCardBaseV1 {
  /** Opaque and binding-scoped; unlike decisionKey, usable for target checks. */
  readonly decisionRef: string;
  readonly decisionKey: string;
  readonly revision: string;
  readonly source: "escalate" | "track" | "loop";
  readonly urgency: "alert" | "decide" | "advise" | "none";
  readonly question: string; // untrusted display text
  readonly createdAt: string;
  readonly dossier: {
    readonly artifactDigest?: string;
    readonly stakes: readonly string[]; // untrusted display text
    readonly riskReasons: readonly string[];
    readonly evidenceRefs: readonly string[];
  };
  readonly workEvidence: {
    readonly kind: "workspace-content";
    readonly digest: string;
  };
}

type DecisionCardV1 =
  | (DecisionCardBaseV1 & {
      readonly interaction: "read-only";
      readonly options: readonly { readonly id: string; readonly label: string }[];
    })
  | (DecisionCardBaseV1 & {
      readonly interaction: "requires-write-grant";
      /** Non-empty stable options: required for a one-tap structured reply. */
      readonly options: readonly [
        { readonly id: string; readonly label: string },
        ...{ readonly id: string; readonly label: string }[]
      ];
    });

interface H2ASessionFeedV1 {
  readonly asOf: string;
  readonly instances: readonly InstanceLineV1[];
  readonly sessions: readonly SessionLineV1[];
}

interface InstanceLineV1 {
  readonly instanceRef: string; // opaque, binding-scoped
  readonly displayName: string; // untrusted; never authority
  readonly workspaceRef: string;
  readonly workspaceLabel: string;
  readonly lastSeen: string;
  readonly liveness: "live" | "idle" | "stale" | "closed";
}

interface SessionLineV1 {
  readonly sessionRef: string; // opaque, binding-scoped
  readonly instanceRef: string;
  readonly topicOrTitle: string; // untrusted; never authority
  readonly state: "open" | "idle" | "closed";
  readonly lastActivityAt: string;
  readonly activitySource: "mcp" | "heartbeat";
}
```

h2a guarantees:

- the read request resolves an active READ grant before any source is exposed;
- each `H2ASourcePublicationV1` is issued for exactly one active publisher
  binding. Its focus cards and instance/session lines derive only from that
  publisher's bound workspace/work; it cannot attest another agent's
  liveness. Its proof binds audience, grant, publisher binding, sequence,
  freshness, and complete body digest;
- every displayed living agent therefore has its own current source
  publication and publisher proof. A self-declared `actor.instance` line,
  unsigned bus message, copied body, or aggregate proof alone cannot satisfy
  that requirement;
- `H2AReadAggregateV1` composes one or more independently verified source
  publications. Its proof covers their exact membership, order, deduplication,
  aggregate digest, grant, audience, and `asOf`; it cannot introduce a card or
  session line absent from those verified sources;
- `H2AReadEmptyV1` is a resolver-authenticated finding of zero active
  publisher bindings, not a publication by a fictional publisher;
- the proof encodings, aggregate signer/placement, and source-to-aggregate
  transport remain open boundary decisions;
- projects are grouped deterministically across verified source publications
  before exposure; the consumer need not see a local root;
- `decisionRef` is binding-scoped; `decisionKey` is unique within the feed and
  `revision` prevents stale answers;
- order is deterministic: alert, decide, advise, unranked; then oldest first;
- all arrays are factual reads, not error defaults; a wholly or partly unread
  source yields `H2AReadFailureV1`, not an empty/partial success;
- the feed contains no local path, repo URL, command, pid, tmux/pane coordinate,
  key, raw routable agent/session reference, or implicit write handle;
- display text is untrusted and must be escaped by the consumer;
- top-level freshness, sequence, cursor/as-of, publication expiry, and
  per-project staleness make a static or broken feed visible.

The existing `packages/focus-interactive` `PendingDecision` and swipe helpers
are useful source semantics. Its `sessionRef` and `projectRoot` are explicitly
not part of this browser contract. The existing ratified `H2AFeedResponse`
remains the source descriptor contract inside h2a. This Sentropic-web boundary
is an intentional **narrowing projection**: raw `instanceId`/`sessionId` may
remain h2a provenance but are replaced by binding-scoped opaque refs before
crossing this boundary. They are never accepted back as control targets.

Per the ratified empty-feed semantic, an authenticated principal for whom the
binding resolver **established** that there are zero active bindings receives
`H2AReadEmptyV1`, whose `bindingResolutionProof` covers that factual lookup; no
publisher or aggregate proof is fabricated. A failed binding lookup or unread
source yields `H2AReadFailureV1` instead. “Nothing is bound” and “we did not
look” remain distinguishable.

### 7.2 h2a accepts for WRITE: authenticated action

```ts
interface DecisionReplyPayloadV1 {
  readonly kind: "decision.reply";
  readonly workspaceRef: string;
  readonly decisionRef: string;
  readonly decisionKey: string; // provenance/idempotency, not routing
  readonly revision: string;
  readonly workDigest: string;
  readonly optionId: string;
  readonly note?: string;
}

interface SessionInputPayloadV1 {
  readonly kind: "session.input";
  readonly text: string;
  readonly confinementRef: string;
}

type H2ARemoteActionV1 = {
  readonly schema: "h2a.remote-action.v1";
  readonly grantRef: string;
  readonly controlTargetRef: string;
  readonly audience: string;
  readonly payloadDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  /** Opaque to the transport; h2a verifies it through a configured verifier. */
  readonly authorizationProof: unknown;
} & (
  | { readonly action: "decision.reply"; readonly payload: DecisionReplyPayloadV1 }
  | { readonly action: "session.input"; readonly payload: SessionInputPayloadV1 }
);

interface H2ARemoteActionReceiptV1 {
  readonly schema: "h2a.remote-action-receipt.v1";
  readonly grantRef: string;
  readonly controlTargetRef: string;
  readonly idempotencyKey: string;
  readonly effect:
    | "rejected"
    | "accepted"
    | "injected"
    | "observed"
    | "conflict"
    | "failed";
  readonly code?: "revoked" | "expired" | "wrong-target" | "stale-revision"
    | "invalid-option" | "not-confined" | "duplicate" | "effect-failed";
  readonly observedAt: string;
  readonly brokerProof: unknown;
}
```

h2a validates that `optionId` belongs to the exact active card revision under
the target/workspace binding. Unknown actions, options, proof fields, targets,
and schema versions fail closed. A valid proof naming another target's
`decisionRef` is rejected.

### 7.3 h2a accepts for EXECUTE: immutable UAT request

```ts
interface H2AUatExecutionV1 {
  readonly schema: "h2a.uat-execution.v1";
  readonly requesterGrantRef: string;
  readonly environmentOwnerGrantRef: string;
  readonly runnerAttestationRef: string;
  readonly requesterRef: string;
  readonly environmentRef: string;
  readonly runnerRef: string;
  readonly workspaceRef: string;
  readonly audience: string;
  readonly artifactDigest: string;
  readonly planRef: string;
  readonly planDigest: string;
  readonly policyDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly authorizationProofs: {
    /** Encoding is open; roles and independent trust anchors are not. */
    readonly requester: unknown;
    readonly environmentOwner: unknown;
    readonly runner: unknown;
  };
}

interface H2AUatExecutionReceiptV1 {
  readonly schema: "h2a.uat-execution-receipt.v1";
  readonly requesterGrantRef: string;
  readonly environmentOwnerGrantRef: string;
  readonly runnerAttestationRef: string;
  readonly environmentRef: string;
  readonly artifactDigest: string;
  readonly planDigest: string;
  readonly policyDigest: string;
  readonly idempotencyKey: string;
  readonly state:
    | "rejected"
    | "admitted"
    | "route-created"
    | "running"
    | "passed"
    | "failed"
    | "termination-requested"
    | "terminated"
    | "teardown-confirmed"
    | "teardown-failed";
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly exitStatus?: number;
  readonly outputDigests: readonly string[];
  readonly logDigests: readonly string[];
  readonly runnerProof: unknown;
}
```

The three proofs may use an encoding chosen by the owning lanes, but h2a must
resolve distinct current requester, environment-owner, and runner/workload
authorities. The runner proof on the receipt binds immutable request fields to
the evidence; a bare JSON receipt is not trustworthy UAT evidence.

### 7.4 h2a needs from Sentropic

At the boundary, h2a requires:

- opaque principal, workspace-binding, agent-binding, grant, and environment
  references with no authority encoded in display names;
- an authenticated feed-publisher/workspace binding for READ;
- a verifiable principal/grant assertion for every READ, WRITE, or EXECUTE
  request, bound to audience and the complete request;
- current revocation/expiry state, available at the time of use;
- an environment-owner grant and workload identity for UAT;
- mutually authenticated transport, replay ownership, and honest delivery of
  receipts/failures/feed staleness to the mobile UI.

The storage models, signing/verification infrastructure, OIDC semantics,
tenant resolution, and UI implementation that provide these properties belong
to Sentropic-owned lanes and remain open here.

## 8. Dependency and acceptance ladder

### Gate 0 — before any rung is armed

- PR #46 is merged into the selected base and its ingest guarantees pass.
- Existing sensitive data already at rest is assessed separately; #46 protects
  arriving records and does not erase old rows.
- The target deployment is not the June demo and does not reuse its expired
  enrollment as if it were current.
- Kill switches default to off/disarmed for every new remote surface.

### Rung 1 acceptance

- current **living** agents complete fresh enrollment;
- a fresh `H2AReadAggregateV1` returns one independently verified
  `H2ASourcePublicationV1` per enrolled living publisher, and each living
  agent's session line occurs only in that publisher's bound source; a card,
  copied line, or aggregate proof alone is not a substitute;
- stopping the live feed makes rows visibly stale rather than silently static;
- a revoked binding disappears on the next read;
- an authenticated read whose binding resolver establishes zero active
  bindings returns `H2AReadEmptyV1` with `bindingResolutionProof`;
- a valid publisher proof targeting another binding returns no data and does
  not change the target binding's stored feed;
- an unread decisions, presence, or registry source returns a typed failure,
  not empty arrays;
- paths, commands, pid/tmux data, keys, and raw routing refs never reach the
  browser feed.

### Rung 2 acceptance

- forged or copied `actor.instance` never selects a control target;
- a validly signed but unbound bus envelope cannot cause a write;
- target/action/expiry/payload mutations invalidate the proof;
- duplicate idempotency keys do not duplicate effects;
- local and remote revocation stop queued writes;
- a valid proof carrying another target/workspace's `decisionRef` is rejected;
- an actionable card always has at least one stable option, and a selected
  option must belong to its exact revision;
- unrestricted session input is rejected without current owner-resource
  confinement evidence; a UAT grant never upgrades a session-input envelope;
- a tapped option reaches the exact card revision and returns an observed
  receipt from the bound live session.

### Rung 3 acceptance

- requester-only approval without environment-owner approval is rejected;
- one proof cannot silently stand in for requester, environment owner, and
  runner/workload authorities;
- a valid grant for another environment, runner, artifact, or plan is rejected;
- revocation between phases prevents the next phase and triggers teardown;
- the runner cannot exceed the granted environment/service-account/network/
  secret boundary;
- receipts bind to immutable plan and artifact digests;
- route-created, executed, passed, failed, terminated, and cleaned-up are never
  conflated.

## 9. Sentropic-lane and owner decisions — intentionally open

| Open decision | Owner | h2a boundary constraint |
|---|---|---|
| Principal authentication, step-up, and first-party-session semantics per rung | **39-auth/auth lane** | Must yield an audience-bound assertion; a generic bearer is insufficient for WRITE/EXECUTE. |
| Binding/grant storage schema, lifecycle, lookup, and multi-tenant isolation | **Sentropic architect** | Must key authority on opaque active bindings, never claimed names; hints only narrow. |
| Assertion format, verifier/key distribution, rotation, and revocation delivery | **Sentropic architect + auth lane** | h2a must be able to verify the complete request offline or through a fail-closed verifier. |
| Gateway↔local pairing and transport topology for READ publications, WRITE actions, and UAT requests | **Sentropic architect + h2a boundary owner** | Mutual endpoint authentication, audience binding, replay ownership, reconnect, offline delivery, and acknowledgements must be explicit; this study chooses no transport. |
| Source and lifecycle of authenticated feed-publisher/workspace provenance | **h2a boundary owner + Sentropic architect** | h2a proves the active publisher/work relation; Sentropic resolves it to an active READ grant. Neither may substitute a bus name. |
| Mapping a local workspace binding to a Sentropic workspace and enforcing workspace RBAC | **Sentropic architect** | h2a emits an opaque workspace ref plus work evidence; it does not choose tenant/workspace policy. |
| Cache, retention, and post-revocation treatment of previously rendered READ cards | **Sentropic architect + product owner** | Cached data must not appear fresh after revocation. |
| Mobile information architecture, card density, swipe behavior, accessibility, and step-up UX | **Sentropic app/UI lane + product owner** | Questions/options must remain tappable; UI must visibly distinguish READ from WRITE authority. |
| Mobile notification, background delivery, and deep-link semantics for “questions arrive” | **Sentropic app/UI lane + product owner** | A notification must preserve freshness/revocation state and must not turn a lock-screen preview into an unintended disclosure or write grant. |
| Which Rung 2 actions ship, which require per-action confirmation, and grant durations | **Product owner, advised by Sentropic architect and h2a owner** | `decision.reply` and broader session input remain separate grants; h2a will enforce the selected closed set. |
| Receipt authenticity, verifier ownership, audit visibility, and audit retention | **Sentropic architect + auth lane; environment owner for UAT evidence** | UI status must be derived from a verified h2a publisher/broker/runner receipt, never a relay's bare claim. |
| Environment ownership model and who may grant a UAT run | **Sentropic architect + environment owner** | Both requester and environment-owner authority must be proven; membership/name is insufficient. |
| UAT runner isolation, service account, network/secret policy, route exposure, and retention | **Sentropic architect lane + environment/platform owner** | h2a will execute only inside the attested boundary and will report teardown. |
| UAT executor placement, deployment, availability, and operational on-call ownership | **Sentropic platform/environment owner + h2a executor owner** | The runner trust anchor and isolation boundary must identify the actual workload; this study does not choose local, pod, or another placement. |
| Public/private UAT exposure policy and any exception to per-run approval | **Environment owner + product owner** | No default is chosen here; broader exposure requires a separately explicit grant. |
| Whether remote control and UAT are exposed in the first product release | **Product owner** | This study marks both BLOCKED today; it does not choose a release commitment. |

## 10. Established and not established

Established from the repository at `0f285c2`:

- ordinary local bus mailbox writes do not verify the claimed sender;
- a separate remote receive path has signature/key checks, so the two paths
  must not be conflated;
- browser-safe feed builders and multi-project mobile-card primitives exist;
- the old mirror's service unit ships disarmed;
- the agent-side enrollment proof exists;
- UAT route/capability vocabulary exists without the required authorization
  chain;
- the ingest work is absent from the selected base and present on a local
  remote-tracking branch.

Not established:

- GitHub PR #46's live state or the local branch's exact PR mapping;
- any real hosted mirror, credential, key, route, or endpoint state (none was
  contacted);
- current user-service state (the June mirror is treated as absent instead);
- current living-agent enrollment (live presence files were not read);
- any Sentropic internal decision listed in §9.

Those unknowns do not authorize a best guess. They remain acceptance inputs for
the owning lane.
