# h2a → sentropic session-exposure feed — h2a's side of the contract

Status: **RATIFIED** by the architect 2026-07-24 (see the Ratification
section at the end), amended 2026-07-25 by the Q1 and SPLIT rulings recorded
there. Companion to
`sentropic/spec/SPEC_EVOL_CONNECTOR_ACCOUNT_WORKSPACE_EXPOSURE.md` (the
"exposure spec"). Scope: **h2a's own surface only** — a read-only,
principal-scoped presence/sessions feed, plus the principal↔agent enrollment
binding that scopes it. Sentropic owns the multi-tenant gateway, the 39-auth
broker, and the UI panel that consumes this feed; this document does not
propose any of that.

Grounded in real h2a code, cited inline. No h2a schema in this doc stores a
secret. Per the exposure spec's invariant #1, only opaque lifecycle
descriptors and public-key material ever leave the agent — never a private
key, never a message body, never a filesystem path beyond a human label.

**Governing rule for every field below**: *if a field can't be shown safely
in a browser, it doesn't belong in the feed.*

---

## Part A — `InstanceDescriptor` / `SessionDescriptor`

```ts
/** h2a session-exposure feed types (P1). Every field OPAQUE, non-secret. */

/** h2a's own protocol-role vocabulary (packages/h2a/src/types.ts H2A_ROLES). */
type H2ARole = 'PRINCIPAL' | 'EXECUTIF' | 'CONDUCTOR' | 'AGENTS' | 'CONTROL' | 'MANDATAIRE';

/** Per-descriptor liveness. `stale` is distinct from `idle`: see derivation below. */
type H2ALivenessState = 'live' | 'idle' | 'stale' | 'closed';

interface InstanceDescriptor {
  readonly instanceId: string;
  readonly displayName: string;
  readonly host: string;
  /** Q1 ruling (2026-07-25): `'unknown'` when no role is declared — a missing
   *  role must never be synthesized into a real H2ARole. */
  readonly role: H2ARole | 'unknown';
  readonly workspaceLabel: string;
  /** SPLIT ruling (2026-07-25): sourced from
   *  `H2AActorRegistration.declaredCapabilities`, NEVER from the
   *  authority-bearing `capabilities`. Allowlisted on read. */
  readonly declaredCapabilities: readonly string[];
  readonly lastSeen: string;          // ISO 8601
  readonly liveness: H2ALivenessState;
}

interface SessionDescriptor {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly topicOrTitle: string;
  readonly state: 'open' | 'idle' | 'closed';
  readonly openedAt: string;          // ISO 8601
  readonly lastActivityAt: string;    // ISO 8601
  /** Ratification condition #2: discriminates proven MCP traffic from a bare
   *  heartbeat fallback, so a consumer can NEVER present 'process alive' as
   *  'proven channel activity' by omission. */
  readonly activitySource: 'mcp' | 'heartbeat';
  readonly counterpartsOpaqueRefs: readonly string[];
}
```

### Field-by-field source mapping

**`InstanceDescriptor`**

| Field | Type | h2a source |
|---|---|---|
| `instanceId` | `string` | `H2ASession.instance` / `H2AActorRegistration.instance` — the addressable `host:slug(label):uuid12` handle, frozen at mint (DEC-114, `packages/h2a/src/identity.ts` `deriveInstanceId`). Own-principal's own resource id, so it is shown verbatim (see "opacity boundary" below — this is NOT a counterpart ref). |
| `displayName` | `string` | `H2AActorRegistration.name` (DEC-114 mutable display name, set at mint or `/rename`), falling back to the most recent live session's `H2ASession.name` (host-native `customTitle`/`thread_name`, WP-6), falling back to `workspaceLabel`. |
| `host` | `string` | `H2ASession.host` ("claude"/"codex"/"gemini" hint set at session open), most-recent session for that instance, else `'unknown'`. A workspace ref is deliberately NOT consulted: `labelOf` must stay the single reader of a workspace reference for the path-exclusion to be structural. |
| `role` | `H2ARole \| 'unknown'` | `H2AActorRegistration.roles[0]` (`packages/h2a/src/types.ts` `H2A_ROLES`), else the literal `'unknown'` (Q1 ruling, 2026-07-25 — **never** synthesize a real `H2ARole` for a missing one). **Note**: today `identity/live.ts` `ensureRegistered` hardcodes `roles: ["AGENTS"]` at mint, so the field is emitted but currently shows only one value in practice — not a missing field, a narrow-range one (see Gaps). |
| `workspaceLabel` | `string` | `H2AWorkspaceRef.label` off `session.workspace` for the **most recent** session (preferred, per-session-authoritative) falling back to `registration.workspace` (mint-time), else `'unknown'`. **Never** `H2AWorkspaceRef.path`/`launchContext.cwd` — those are filesystem paths and are excluded by design. |
| `declaredCapabilities` | `readonly string[]` | `H2AActorRegistration.declaredCapabilities` — the DECLARED display list, a field kept structurally separate from the authority-bearing `capabilities` (SPLIT ruling, 2026-07-25). **ALLOWLISTED at the read boundary**: intersected with the closed vocabulary, so only known members are emitted. An intersection, never a denylist. |
| `lastSeen` | `string` (ISO) or `'unknown'` | `max(H2ASession.heartbeatAt)` across the instance's known sessions, computed by the descriptor builder over `listPresence(root).filter(s => s.instance === instanceId)` (`packages/h2a/src/runtime/local-files/presence.ts`). **Strictly that** — never `registration.createdAt`: a mint is not a sighting, and presenting one as "last seen" would be an unearned freshness claim. No parseable heartbeat → `'unknown'`. |
| `liveness` | `H2ALivenessState` | Derived — see "Liveness/state derivation" below. Best-of across the instance's sessions. |

**`SessionDescriptor`**

| Field | Type | h2a source |
|---|---|---|
| `sessionId` | `string` | `H2ASession.sessionId`. |
| `instanceId` | `string` | `H2ASession.instance`. |
| `topicOrTitle` | `string` | `H2ASession.name` — the DEC-114 per-session mutable display name (host-native `customTitle`/`thread_name`, or `/rename`), falling back to `registration.name`, falling back to `workspace.label`. **Note**: this can diverge from `InstanceDescriptor.displayName` — a session can be renamed independently of its owning instance. |
| `state` | `'open'\|'idle'\|'closed'` | Derived from `H2ASessionState` + `connectionConfidence` — see below. |
| `openedAt` | `string` (ISO) or `'unknown'` | `H2ASession.startedAt`, validated on read — an unparseable value yields `'unknown'` rather than passing arbitrary text into an ISO-typed field. |
| `lastActivityAt` | `string` (ISO) or `'unknown'` | Validated on read (unparseable → `'unknown'`). `H2ASession.lastMcpActivityAt` when present (WP-F: proof the MCP channel carried real traffic), else falls back to `H2ASession.heartbeatAt`. The fallback is advisory-only (a live process, not proven channel activity) and MUST be labelled as such by any consumer, never conflated with the proven case. |
| `counterpartsOpaqueRefs` | `readonly string[]` | **Gap**: no such field/derivation exists on `H2ASession` today. Empty for P1 — produced by an EXPLICIT branch on "is any counterpart source wired" (per the EMPTY-AS-FACT amendment), never a literal default, so the empty list means "there is no source" and not "we did not look". See Gaps §2 for the derivation + opacity mechanism. |

### Opacity boundary (non-negotiable)

- **OPAQUE, non-secret only.** No message bodies, no negotiation content, no
  keys/tokens, no filesystem paths beyond a human label.
- `workspaceLabel` — yes (a repo/folder name). `cwd`/`launchContext.path` —
  never.
- **Scope of that statement: this feed and the mirror push, NOT the product.**
  "No filesystem paths leave the machine" is true of the mirror push (enforced by
  `runtime/mirror/sanitize.ts`) and of what this feed renders. It is **not** a
  product-wide property, and must not be quoted as one. Other egress paths in the
  same monorepo do send paths and file content today: `packages/h2a-runtime`'s
  `h2a-bridge.ts` relays files base64-encoded to remote pods and `h2a sync`
  transfers workspace content; and `report-ai` posts
  `H2AReportContextEntry.workspace` — an **absolute realpath** — to a loopback
  gateway that proxies **upstream**. Each is a deliberate, separately-owned
  channel with its own rationale; none is covered by this boundary. The honest
  claim is per-channel, and this contract governs one channel.
- `instanceId`/`sessionId` are the row's **own** identity (the resource the
  owner is reading about their own agent) — shown verbatim, because P1 is
  "read your own data."
- `counterpartsOpaqueRefs` are **other** parties' handles. Those are never
  the raw `instance:` routing string (that string is a live bus address —
  leaking it into a browser surface would let the UI attempt to address the
  bus directly, bypassing h2a's own authority model). They MUST be opaque,
  stable, per-principal-scoped ids (see Gaps §2).

### Send boundary (the mirror) — CONTRACT, added 2026-07-25

The opacity boundary above governs what a browser READS. It protects nothing
that has already come to rest on someone else's disk. The mirror push
(`runtime/mirror/build.ts`) used to ship `listPresence(...)` records and registry
rows **verbatim**, so every beat landed `launchContext.cwd`, the full command
line, the tmux session/pane, the pid, `workspace.path` and the `file://<root>`
endpoint uri in the hosted store — precisely the fields this contract exists to
keep out of a browser. Disclosed in the joint plan (§ 7) and recorded as owed
(§ 9); **closed on the send side** by `runtime/mirror/sanitize.ts`.

**The rule, as contract:**

> **Sanitize at the boundary you are responsible for; never assume an upstream or
> downstream sanitizer.** A read-side sanitizer does not protect data at rest.
> Both the send boundary and the read boundary are ours, and each sanitizes
> independently of the other.

Binding consequences for anything that leaves the machine:

1. **ALLOWLIST, never a denylist.** The permitted field set is *iterated*; the
   record's own keys are never enumerated onto the wire. This holds for **every
   field of every composite type that travels, at every level** — each nested
   composite is rebuilt from its own plan rather than copied by reference. The
   exhaustive list of those types and their plans is in `sanitize.ts`'s header
   table; it is exhaustive by construction, because `buildInstanceMirror` puts
   exactly three member arrays in the body and every entry is reachable from one
   of them. A denylist that strips `cwd`/`command`/`tmux`/`pid` starts leaking the
   day someone adds a field. This was measured rather than assumed: implemented as
   spread-then-delete, a denylist passes every hostile-value test and fails only
   the unclassified-field test. Same reasoning as `sanitizeDeclaredCapabilities`,
   which intersects the closed vocabulary instead of removing known-bad values.

   **What this claim does NOT cover, stated because the earlier wording was wider
   than what was built.** Until 2026-07-25 the guarantee was true at the top level
   of each payload member and **false one level down**, and that was demonstrated
   end-to-end, not argued: `interests` was classified `send`, so the plan copied
   the object by reference; `isInterests` is a two-field spot-check that does not
   reject extra keys, so `interests: {scopes, negotiations, lc:{tmux, cwd, pid}}`
   was a well-formed record by the receiver's own guard; the push was accepted
   **202** and the nested value came to rest on the receiver's disk. The same shape
   applied to the endpoints **element** type, which `Array.prototype.filter` passes
   through whole. Both now have plans (`INTERESTS_PLAN`, `ENDPOINT_PLAN`), so the
   claim above is true as written — but the correction is recorded rather than
   quietly overwritten, because the failure was documentation asserting a nested
   guarantee the code did not implement.

   The claim still does **not** cover the element VALUES inside arrays of
   primitives, nor free-text scalars — see "Free text is not content-checked"
   below. A field allowlist bounds the SHAPE of what travels, never the content.
2. **A new field must not be able to travel by default.** Each payload member's
   plan is checked with `satisfies` over `keyof Required<Source>`, so adding a
   field to `H2ASession` / `H2AActorRegistration` / `H2ASubagentBinding` **fails
   the build** until it is explicitly classified `send` / `withhold` / `narrow`.
   **The same applies to the nested types** (`H2ASessionInterests`,
   `H2AAgentVersion`, `H2AWorkspaceRef`, the endpoints element): each carries its
   own `satisfies`, so the ratchet reaches downward instead of stopping at the
   payload member. Before the nested plans, a new field on `H2ASessionInterests`
   or on the endpoints element compiled with `tsc` exit 0 **and travelled** —
   mutation-proved in both directions.

   The ratchet is the compiler, not a reviewer's attention. Two limits worth
   knowing: it is a **compile-time** ratchet only — `unclassifiedMirrorFields` is
   a test-time assertion helper, called from the test file and from nowhere on the
   send path, so it must not be described as a runtime half (an uninvoked guard
   covers nothing); and an index signature added to a source type **is** caught,
   which was mutation-tested and is the hatch that would otherwise reopen all of
   this.
3. **Sanitize BEFORE signing.** The signature must cover exactly the bytes
   transmitted. `buildInstanceMirror` returns an UNSIGNED envelope that is
   already narrowed, so a caller can only sign what was already sanitized — a
   post-signing scrub is structurally unavailable, not merely discouraged.
4. **Never silently drop what a consumer needs.** A field required by a
   receiving-side consumer is transmitted and the reason recorded, even when the
   feed itself does not display it. `capabilities` is the live example: the
   subagent ceiling (`subagents.ts`) and `canAttestComprehension`
   (`mcp/handlers.ts`) both read it off the mirrored registry row, so
   withholding it would change an authorization outcome on the receiver.

**The field set transmitted today.** Presence: `sessionId`, `instance`, `host`,
`name`, `startedAt`, `heartbeatAt`, `state`, `interests`, `subscribedTopics`,
`workStatus`, `lastMcpActivityAt`, `version`, and `workspace` narrowed to
`{id, host, label}`. Withheld: `launchContext` (cwd / command / resumeCommand /
tty / tmux), `pid`, and `mirroredAt` — the last one for PROVENANCE, since
`deriveLiveness` reads it to decide `stale` and a sender-supplied value would be
a forged freshness claim; the receiver stamps it. Registration: identity, roles,
scopes, capabilities, declaredCapabilities, publicKeys, acceptedPolicies,
createdAt, principal, conductor, agentUuid, name, the same narrowed workspace,
and `endpoints` filtered to **network-locator schemes** (`http`/`https`/`ws`/
`wss`) and then rebuilt element-by-element from `ENDPOINT_PLAN` — filtered by
scheme rather than by `kind` because `kind` is self-declared, so a `file://` uri
labelled `kind: "remote"` would sail through a kind-based check. The scheme test
holds against every variant it was attacked with (uppercase, mixed case, leading
whitespace, embedded newline, single-slash `file:/`, `data:`, `javascript:`,
scheme-relative `//host`, and a bare relative path), which is what vindicates the
scheme-over-`kind` choice; what it does **not** do is in the next paragraph.

**Free text is not content-checked — and the concern is data at rest, not
rendering.** The joint plan's § 9 item 1 framed this as a *rendering* concern over
four display fields. That framing is too narrow on both axes. The transmitted
free-text set is larger, and the harm is that an agent-chosen string comes to rest
**on someone else's disk**; whether a panel escapes it on the way out is a
separate, additional concern.

Transmitted and agent-settable, none of it content-checked:

- Presence: `name`, `workspace.label`, `workspace.host`, `workspace.id`,
  `version.cli`, `version.skill`, and the element values of `interests.scopes[]`,
  `interests.negotiations[]` and `subscribedTopics[]`.
- Registration: `principal`, `conductor`, `agentUuid`, `name`, and the element
  values of `scopes[]`, `capabilities[]`, `declaredCapabilities[]`,
  `acceptedPolicies[]`, `publicKeys[]`, `roles[]`.

`h2a_register_instance` accepts an **arbitrary object** — `handleRegisterInstance`
validates `typeof === "object"` and nothing else, and `store.registerInstance`
validates nothing — so every registration field above is whatever the agent wrote.
`h2a_session_open` likewise copies `interests.scopes` / `interests.negotiations`
**verbatim** from its caller (`runtime/mcp/sessions.ts`). Two consequences to hold
in view:

- A plain `h2a_session_open` with `interests: {scopes: ["scope:/home/you/private/
  directory"]}` puts that path on the hosted disk. No privilege, no malformed
  record, no older CLI — full reachability today.
- `conductor: "file:///home/you/…"` is how a `file://` URI **still** reaches the
  hosted store despite the endpoint scheme filter. The filter covers `endpoints`,
  not every field that can hold a URI.

And the endpoint filter's own bounded gap, stated with its shape: it answers *"is
this a network locator"*, not *"does this value contain a path or a secret"*. So
`http://localhost/home/you/…`, `https://h/?cwd=/home/you/…`, `https://h/#/home/
you/…` and `https://user:sk-live-TOKEN@h/` (**credentials in the URI userinfo**)
all travel. Mirror endpoint URLs are exactly the kind of value that carries a
token, so this is named rather than left implied.

Mitigations are different in kind from an allowlist and are tracked separately:
length bounds + character-class normalisation on the h2a side, userinfo stripping
and a query/fragment policy for URIs, and the untrusted-rendering rule on the
panel side. `roles[]` and `subscribedTopics[]` are closed vocabularies in the type
but are **not** re-intersected against that vocabulary at the send boundary; for
`subscribedTopics` the sender's own `writePresence`/`isH2ASession` rejects an
off-vocabulary topic, so the real pipeline cannot reach it and only a direct call
to `sanitizePresenceForMirror` can — defence-in-depth, recorded, not fixed.

**Undeclared behavioural change on a HOSTED root (stated, not left to be
discovered).** Withholding both `workspace.path` and `launchContext` means
`runtime/reporting/context.ts`'s `sessionWorkspace` returns `undefined` for every
mirrored session, so `readH2AReportContext` calls `markUnsafe(session.instance)`
and `continue`s — every mirrored instance is marked **unsafe and skipped**, and
contributes no `h2a:session:` report-context entry and no inbox metadata on the
receiving host. This is fail-closed and arguably the right outcome (a remote
agent's cwd is not a directory the hosted process may reason about), but it is a
behaviour change on the receiver and it belongs in the contract rather than in
someone's debugging session.

**Two latent hazards closed as a side effect, recorded because they are the
strongest part of the case.** Both are on the RECEIVING host:

- Withholding `pid` prevents `reapAllDeadPresence`
  (`runtime/local-files/presence.ts`) from reading a foreign pid as dead. Its own
  docstring says it *"assumes presence pids are local to this machine (true for a
  single-host bus)"* — and a mirror root is by definition not a single-host bus. It
  reaps on `!isAlive(pid)` with `includeExpired: true`, so an unrelated local pid
  collision would have deleted **every mirrored row**. A row with no `pid` is
  skipped before any liveness test, so withholding it is not merely tidier — it is
  what keeps the janitor from being data-destructive.
- Withholding `launchContext` prevents `headlessRelauncher`
  (`runtime/drumbeat/relaunchers.ts`) from `spawnDetached`-ing a remote agent's
  captured command line in that agent's cwd **on the hosted pod**. Both the command
  and the cwd come entirely from `launchContext`, unvalidated; with it absent the
  relauncher returns `false` before spawning anything.

**`H2AWorkspaceRef.path` is now optional, and that was the root cause.**
`isH2ASession` validates `workspace` through `isH2AWorkspaceRef`; while `path`
was required, the only shape the hosted `writePresence` would accept was one
carrying a real filesystem path. A type that makes a filesystem path mandatory
on every workspace reference cannot express a sanitized reference at all — the
required field was *compelling* the disclosure, not merely permitting it. `id`,
`host` and `label` stay required and `path` is still validated when present.

**Still owed (the symmetric half).** The INGEST boundary is also ours and does
not yet apply this. `serve.ts` writes whatever a *verified* sender hands it, so
an older CLI that predates the send boundary keeps pushing raw records into the
hosted root, and a hosted read surface is still a full passthrough of stored
records (`h2a_discover_sessions` returns `{...session}`; the feed builders are
not wired into the hosted handlers yet — Part C step 5). Applying the same
`sanitize*ForMirror` functions in `serve.ts`'s `applyPresence` /
`applyRegistration` closes it, and should be a separate change so the
accept-side verification and fencing are reviewed on their own terms.

Two defects found while scoping that half, **recorded here and deliberately not
fixed in the send-boundary change** (touching `accept.ts` / `serve.ts` /
`push-daemon.ts` would merge the two increments):

- `serve.ts` wires `applyRegistration` to `store.registerInstance`, which
  **throws** `Instance already registered` on every repeat beat, with no
  `try`/`catch` — unlike the sibling `applySubagent`, which does catch. So a
  steady mirror beat from an already-registered instance takes the throw path.
  Availability, on the ingest side; it belongs to the ingest increment.
- `h2a remote send --json` (`cli.ts`) signs and POSTs an **arbitrary
  operator-supplied envelope** with no shape validation and no sanitize — an
  escape hatch around the very boundary this section establishes. It is
  operator-driven rather than agent-driven, which is why it is a recorded gap and
  not a blocker, but the boundary is only as strong as the absence of a bypass and
  this is one.

### Liveness / state derivation

Both derivations are pure functions of h2a's existing primitives —
`packages/h2a/src/session.ts`:

- `H2A_SESSION_DEFAULT_EXPIRY_MS = 90_000` — the **90s keepalive window**
  that already gates `h2a_discover_sessions` freshness
  (`packages/h2a/src/runtime/mcp/tools.ts:325`: *"filters by freshness
  (default expiry 90s)"*).
- `isSessionExpired(session, { now, expiryMs })` — heartbeat-age check.
- `deriveConnectionConfidence(session, { now, activityWindowMs })` — WP-F
  channel-traffic confidence, default 10-minute activity window; returns
  `"active" | "idle-uncertain" | "unknown"`.

```ts
// asOf = the feed's own read timestamp (see Part C).
function deriveSessionState(session: H2ASession, asOf: number): 'open' | 'idle' | 'closed' {
  if (session.state === 'closed' || session.state === 'expired') return 'closed';
  if (isSessionExpired(session, { now: asOf, expiryMs: H2A_SESSION_DEFAULT_EXPIRY_MS })) return 'closed';
  const confidence = deriveConnectionConfidence(session, { now: asOf });
  return confidence === 'active' ? 'open' : 'idle'; // idle-uncertain | unknown -> idle
}
```

`liveness` (instance level, `live|idle|stale|closed`) reuses the same two
primitives, plus one more distinction that `state` does not need:

```ts
function deriveLiveness(session: H2ASession, asOf: number, pushIntervalMs?: number): H2ALivenessState {
  if (session.state === 'closed' || session.state === 'expired') return 'closed';
  if (isSessionExpired(session, { now: asOf, expiryMs: H2A_SESSION_DEFAULT_EXPIRY_MS })) return 'closed';

  // Replicated/mirrored record (Part C's push-to-root path): heartbeatAt is
  // remote-clock re-stamped on ingest (accept.ts / serve.ts), but the payload's
  // own lastMcpActivityAt is a LOCAL clock value copied through verbatim — it is
  // NOT proof of current liveness once the pipeline itself may have gone quiet.
  if (session.mirroredAt && pushIntervalMs) {
    const pipelineAge = asOf - Date.parse(session.mirroredAt);
    if (pipelineAge > 2 * pushIntervalMs) return 'stale'; // pipeline lag, not agent state
  }

  const confidence = deriveConnectionConfidence(session, { now: asOf });
  return confidence === 'active' ? 'live' : 'idle'; // idle-uncertain | unknown -> idle
}
```

Rationale for `stale`: it is **not** a per-session signal — it is the
feed *pipeline's* own freshness bleeding into a row. A directly-observed
local session is never `stale` (`mirroredAt` absent → skip straight to
live/idle/closed, trustworthy same-machine clock). A replicated row is
`stale` when the daemon that is supposed to keep refreshing it has gone
quiet for more than 2× its push interval — at that point the numerically
"fresh" `heartbeatAt`/`lastMcpActivityAt` in the record can no longer be
trusted the way a live local read can, so the honest label is "we don't
know," not "live." `asOf` is what makes this checkable server-side (Part C).

---

## Part B — Principal↔agent enrollment binding

### Authority model (read first)

**The 39-auth PRINCIPAL is the authorizing authority. The agent's ed25519
key only co-signs to prove it controls that key.** A valid agent signature
proves *authorship* (this key produced this signature); it never proves
*authorization* (this key may appear in this principal's feed). Those are
two different checks and the design keeps them structurally separate:
authorization is "does an **active** binding row exist for
`(principalSub, agentPubKey)`" — a lookup against sentropic's own binding
store — never inferred from signature validity alone.

### Binding record

```ts
interface H2APrincipalAgentBinding {
  readonly bindingId: string;                 // opaque, minted at issuance
  readonly principalSub: string;               // 39-auth `sub` — the AUTHORIZING party
  readonly agentPubKey: string;                // ed25519 public key PEM the agent proved control of
  readonly boundAt: string;                    // ISO 8601
  readonly expiresAt?: string;                 // ISO 8601, optional bound lifetime
  readonly state: 'active' | 'revoked' | 'expired';
  /** Provenance only — NEVER re-used as authority at read time; revalidated
   *  live against the current registry (an instance can rotate keys/re-mint). */
  readonly agentInstanceIdAtBinding?: string;
  /** Proof-of-key-control captured at issuance, kept for audit. */
  readonly agentSignature: { readonly alg: 'ed25519'; readonly value: string };
}
```

Owned and stored by **sentropic** (the control plane that has a concept of
39-auth principals at all — h2a does not). This is deliberate, matching the
exposure spec §6 ownership routing: *"h2a owner: signed local
descriptor/lifecycle transport and engagement evidence only; no secret value
handling and no unilateral remote activation."* h2a's job stops at proving
key control; sentropic decides what that proof authorizes.

**Naming collision to avoid**: `H2AActorRegistration` already has a
`principal?: string` field (`packages/h2a/src/types.ts:109`), used by
`runtime/drive/index.ts:344` to name *which other h2a instance* may
drive/pilot this one. That is an h2a-internal governance concept, unrelated
to the 39-auth `principalSub` here. Do not write `principalSub` into that
field; keep the binding record entirely in sentropic's own store.

**Relationship to the exposure spec's records**: this binding is *not* an
instance of `ConnectorAccountEnrollment` — it carries no `secretRefs`,
`accountRef`, or third-party credential custody (there is no secret at all,
only a public key, which is not secret material). It follows the same
non-negotiable invariants (opaque refs, fail-closed, revocation is
auditable and immediate) as a sibling, h2a-specific record type.

### Enrollment / (re-)binding flow

1. Owner authenticates to the sentropic gateway via 39-auth (existing OIDC
   flow; resolves `sub`).
2. Gateway issues a **challenge**: a random nonce, TTL-bound, scoped to that
   `sub`.
3. The owner's local h2a agent — already holding its ed25519 keypair at
   `<root>/keys/<instance>.key.pem` (`identity/live.ts` `ensureKeypair`) —
   signs the **canonical composite**
   `signCanonical({ type: 'h2a-enrollment-proof-v1', nonce, instance, publicKeyPem }, { by: instance, privateKeyPem })`
   (`packages/h2a/src/signature.ts`); see the SIGNED-COMPOSITE amendment below.
   This is the **exact same primitive** already used for reclaim
   proof-of-possession (`identity/bindings.ts` `provesLocalKey` /
   `verifyReclaimProof`) — `signCanonical` already takes `unknown`, so this is
   the same primitive with a different argument: no new crypto, no new key.
4. The agent returns `{ type, nonce, signature, publicKeyPem, instance }` to the
   gateway. The challenge it received carries **no `principalSub`** — see the
   amendment.
5. Gateway verifies: (a) the nonce is unexpired and was issued to this same
   `sub` (this is the principal's authorizing act — the 39-auth session that
   requested the challenge already IS the authenticated principal; no second
   human-side signature scheme is needed); (b)
   `verifyCanonical({ type, nonce, instance, publicKeyPem }, signature, publicKeyPem)`
   (`packages/h2a/src/signature.ts`) proves key control, **and** `type` equals the
   version the verifier speaks (a `-v2` proof must fail a v1 verifier, not be
   reinterpreted). h2a exports
   `enrollmentProofSignedPayload` and `verifyEnrollmentProof`
   (`runtime/enrollment/ceremony.ts`) so both lanes verify the same bytes and
   neither has to guess at key ordering.
6. On success, gateway **mints a new** `H2APrincipalAgentBinding` row —
   fresh `bindingId`, `state: 'active'`.

#### SIGNED-COMPOSITE amendment (architect, 2026-07-25 — supersedes the bare-nonce signature in steps 3 and 5b above)

The original shape signed the **bare nonce**, leaving `instance` and
`publicKeyPem` carried but unsigned. The crypto review established that this is
safe *on its own terms* — the nonce is single-use against a first-party session,
`principalSub` comes from the session and not the proof, authorization is
`(principalSub, agentPubKey)`, and `instance` is provenance revalidated live.

**That is exactly the objection.** "It is safe because nothing currently relies
on `instance`" is a NEGATIVE property: safety derived from the present *absence*
of a consumer, satisfied by emptiness, and expiring the moment someone adds the
consumer. The price is asymmetric — cheap now, breaking once the auth lane
implements.

**The rule, statable and checkable: a proof must attest to everything it carries
AND to what it is.** Content-completeness plus context-binding. Both halves:

1. **Content-completeness.** The signed composite MUST cover **every field the
   proof carries except the signature itself** — here
   `{ type, nonce, instance, publicKeyPem }`. **If a field does not deserve
   signing, remove it from the proof instead**; carrying an unsigned field is what
   is disallowed. A reader sees a signature and reasonably infers it covers the
   payload, so an unsigned-but-present field is a claim wider than its evidence —
   in the one artifact whose whole job is to be exactly as wide as its evidence.
2. **Context-binding (amendment to the amendment).** Attesting content while
   leaving the message *type* unstated is exactly how cross-protocol attacks
   work: signature valid, content honest, **interpretation attacker-chosen**.
   The first draft of this amendment fixed the signing-oracle by changing the
   payload type (string → object) and thereby bound the message type only
   **accidentally**, via a key set that happens to be unique among h2a's signing
   sites today — the same negative property this amendment exists to reject, one
   level up. So the composite carries a signed
   **`type: 'h2a-enrollment-proof-v1'`**, and the verifier CHECKS it.
   **Versioned deliberately**: a future format change must be *distinguishable*
   rather than silently reinterpreted, and an unversioned tag only defers the
   problem to the next revision.

**Composition constraint, easy to get wrong**: the `type` field must sit inside
the same mechanism that covers every other field — in h2a's implementation, inside
the rest-spread *source*. A tag carried on the proof but excluded from the signed
payload would be an **unsigned field asserting the message's own identity**: the
worst possible field to leave unsigned, and worse than having no tag at all.

h2a's coverage is **structural, not asserted**: `enrollmentProofSignedPayload` is
a rest-spread removing exactly one field (the same shape as `envelope.ts`
`envelopeSigningView`), and its parameter is typed `Omit<H2AEnrollmentProof,
"signature">` so **tsc** rejects a caller that does not hold every non-signature
field. A field carried but not signed is therefore impossible to emit at all: the
sign-time and verify-time derivations disagree and the self-verification throws.
The key-derived test is kept as documentation.

**GUARD-RAIL ON THIS RULING, which is part of the ruling: SIGNED ≠ AUTHORIZED.**
Signing `instance` makes its **provenance** trustworthy. It does **NOT** make
`instance` an authorization input, and nothing downstream may start treating it
as one. Authorization remains the ACTIVE-binding lookup on
`(principalSub, agentPubKey)` with the instance re-resolved live at read time —
`agentInstanceIdAtBinding` stays "provenance only, NEVER re-used as authority at
read time" exactly as the Binding record says. This is the same line as
authorship ≠ authorization, one field further in: a signature widens what you may
*believe about the payload*, never what the payload may *reach*. A future
implementer must not "upgrade" a now-signed field into an authz key.

**Structural consequence, recorded because it removes a finding instead of
guarding against it**: the reclaim proof-of-possession signs a STRING
(`identity-reclaim:<instance>:<fingerprint>`, fully derivable from public data)
while enrollment now signs an OBJECT, and `canonicalize` type-tags the two
differently. So no enrollment signature can ever satisfy `verifyReclaimProof` —
the signing-oracle collision the review reproduced under the bare-nonce shape is
**impossible by construction**. h2a therefore ships **no guard** against it and
a regression test proving the property instead: a guard that cannot fire is a
defect, not a mitigation.

#### Challenge shape: what the agent receives (amendment, 2026-07-25)

The challenge is an **ALLOWLIST**: only `nonce` and `expiresAt` may appear, and
anything else is **refused**. The first draft specified the *nonce* positively
while leaving the challenge *object* specified negatively — a blocklist of one key,
`principalSub` — which did not cover its own stated harm: `{ nonce, meta: {
principalSub } }` and `{ nonce, "__proto__": { principalSub } }` both put a
principal id into the agent process while passing a top-level check. A blocklist
of one key stops one spelling of one field; nesting is a different spelling.
**Refuse-the-rest means refuse, not ignore.**

Implementation constraints, because they are the point rather than a detail: the
allowlist is applied over **own enumerable keys** (`Object.keys` /
`Object.hasOwn`), **never `in`** — `in` walks the prototype chain, so it both
misses an own `"__proto__"` key (which `JSON.parse` *defines* as an own property
rather than reassigning the prototype) and is confused by inherited names. Every
field the validator later *reads* is checked with `Object.hasOwn` for the same
reason: an inherited value is not a carried field, and only carried fields are
signed. The validated challenge is then rebuilt as a **fresh null-prototype
object**, so a parsed document's own `"__proto__"` key — a prototype-pollution
vector, not merely a disclosure one — cannot propagate past the boundary.

**THE NONCE BRACKET — four bounds, each labelled with what it is for.** The
general form, which corrects the first draft of this section: *a positive
specification does not mean a single value — it means every accepted-set boundary
is stated, and each one says what it is for.* A floor that protects strength and a
ceiling that protects against blobs are different parameters and must not be
described in the same breath. The first draft said `fixed ~43`, which pinned an
issuer **that does not exist yet** to an entropy choice made on its behalf: if the
auth lane later picks 384 or 512 bits — the *safer* choice — a fixed verifier turns
their improvement into our outage.

- **`nonce`** — REQUIRED.
  1. **Alphabet base64url** (`[A-Za-z0-9_-]`) — **positive, SECURITY-BEARING**.
  2. **Minimum 256 bits** (≥43 chars, derived as `ceil(256/6)` since base64url
     packs 6 bits per character) — **positive, SECURITY-BEARING**. A MINIMUM, never
     a fixed length.
  3. **Maximum 1024 bits** (≤171 chars, `ceil(1024/6)`) — a **SANITY CEILING,
     EXPLICITLY NOT A SECURITY PARAMETER**. It means *"beyond this it is not a
     nonce"*; it must **never** be read as *"this much entropy is enough"*. Set at
     1024 rather than 512 because a 64-byte nonce is 86 base64url characters, so a
     512-bit/86-char ceiling would sit exactly on it with zero headroom — a bound
     never meant to bound entropy must not be the thing that rejects a stronger
     nonce.
  4. **4096 chars** — pre-parse DoS guard only. Not a definition of anything.
- **`expiresAt`** — OPTIONAL and **advisory**. The gateway remains the authority
  on the TTL (step 5a). Present, it lets the agent refuse to spend a signature on
  a challenge it can already see is dead, which can only ever narrow what
  happens.
- **`principalSub`** — **MUST NOT be sent to the agent.** The agent signs a
  nonce; it has no functional need for the principal's identifier, and the
  gateway already knows which session it issued that nonce to. Shipping one puts
  a principal id into an agent process and context window for zero benefit.
  *Minimal disclosure beats verified non-retention* — so h2a enforces this at
  RECEIPT rather than merely proving it absent from the proof, and it does so via
  the allowlist above rather than by naming the field, so a nested spelling is
  unreachable instead of hunted.
- **Anything else** — refused, with the unexpected key names reported so the
  document can be fixed in one pass.

### Re-enrollment of a post-re-anchor key (the June-key problem)

The identity re-anchor (2026-06-07, `identity/bindings.ts` header) means an
agent that was enrolled before it may now present a **different**
`instance` handle and a **different** keypair after a mint (the stability
unit moved from `(host, workspaceId)` to the provider conversation UUID).
The old enrolled `agentPubKey` is simply no longer produced by any live
agent.

Rule, stated explicitly per the ratification checklist: **any change of
controlling key — from a re-anchor mint or an explicit rotation — requires
re-running the enrollment ceremony above and mints a brand-new
`bindingId`.** The old row is transitioned to `state: 'revoked'`, never
silently overwritten and never reused for the new key. Both rows persist
(audit trail: "principal X authorized pubkey Y from T1 to T2, then pubkey Z
from T3"). Resolution at read time considers `state === 'active'` rows
only.

### Fail-closed semantics

1. **No 39-auth session** (unauthenticated request) → **401**, unchanged
   from today's behavior.
2. **Authenticated principal, no `active` binding row** (never enrolled,
   revoked, or expired) → **not** 401 — a **200 with empty arrays**
   (`{ instances: [], sessions: [], asOf }`). The caller is a legitimate
   authenticated principal; they simply own nothing yet. Never falls back to
   a default/demo agent, never shows another principal's data.
3. **A syntactically valid agent signature from a key with no binding row at
   all** → same empty-result treatment as (2). This is the explicit
   authorship-≠-authorization test case: verifying the signature must never,
   by itself, cause any row to be returned.
4. **Binding `state !== 'active'`** (revoked/expired) → excluded from
   resolution even if the underlying key still happens to be listed active
   in h2a's own local registry (`store.listInstanceKeys`). h2a-side key
   validity is necessary but not sufficient — the *binding* governs
   exposure, not h2a's own key lifecycle.

### Reuse vs. new

| Reused as-is | New |
|---|---|
| ed25519 identity keypair (`identity/live.ts` `ensureKeypair`) | `H2APrincipalAgentBinding` record + store (sentropic-owned) |
| `signCanonical` / `verifyCanonical` (`packages/h2a/src/signature.ts`) | The challenge/nonce issuance + verification endpoint (sentropic-owned) |
| Proof-of-possession pattern (`identity/bindings.ts` `provesLocalKey`) | The re-enrollment UX (owner-triggered "reconnect" flow) |
| `H2ASignature` shape `{ by, alg, value }` (`packages/h2a/src/types.ts:73`) | — |

---

## Part C — Per-principal read-only PULL API

### Recommendation: extend the existing hosted read-only MCP surface + a live, per-principal-keyed push daemon — not a literal network pull into the laptop

The section title says "pull," and that's exactly what the **consumer**
(gateway/UI) does: it reads on demand from a store that is already warm,
with no request-time round-trip back to the owner's machine. Getting the
data into that store is still **push**, because a laptop behind NAT cannot
reliably accept inbound connections — this is the same reasoning EVO-13
already used (`docs/superpowers/specs/2026-06-01-evo13-remote-presence-mirror-design.md`).

Concretely:

- **Endpoint = the existing hosted MCP tools**, not a bespoke new HTTP
  route: `h2a_discover_instances`, `h2a_discover_sessions`
  (`packages/h2a/src/runtime/mcp-http/readonly-allowlist.ts`
  `H2A_HOSTED_READONLY_TOOLS`), already structurally read-only (the
  allowlist throws if any private-key-taking tool is ever added to it).
  These are what gets **principal-scoped**; nothing new needs to be invented
  at the wire-protocol level.
- **What changes**: (1) the `H2A_ROOT` these tools read is
  **per-principal-partitioned** rather than the single shared root
  EVO-13/EVO-12 use today; (2) `h2a remote mirror` — today a **one-shot**
  push (`packages/h2a/src/cli.ts` `runMirrorPush`: build → sign → POST
  once, no `--interval`) — becomes a **live daemon**: the same one-shot
  logic wrapped in the supervisor pattern already shipped for the L1
  objective-loop (`packages/h2a/src/runtime/loop/supervisor.ts`,
  `contrib/systemd/h2a-supervisor.service`), run every 15–30s instead of
  once; (3) the push target becomes **per-binding-keyed**
  (`/h2a/mirror/<bindingId>` or equivalent), so namespacing exists at both
  the key level (already enforced — `accept.ts`'s `instance-key-mismatch`
  check) and the **store partition** level (new — one principal's push can
  never land in another principal's slice).
- **Auth handshake**: the gateway resolves the caller's 39-auth session →
  `principalSub` (its own OIDC session/token, per
  `docs/superpowers/specs/2026-06-03-h2a-operating-modes-and-auth.md` mode
  3's DCR+OIDC shim) → looks up `active` `H2APrincipalAgentBinding` rows for
  that `sub` (Part B) → resolves the set of `agentPubKey`s → for each,
  cross-references against the principal's root-partition registry
  (`store.listInstanceKeys(instance)`) to find the **currently owning**
  `instance` for that key (keys, not stale cached instance ids, remain the
  authority anchor per DEC-116) → scopes the store handed to
  `handleDiscoverInstances`/`handleDiscoverSessions` to exactly that set. At
  P1 scale (a handful of local agents per principal) this is a plain loop
  over the partition's own registry — no new h2a index required.
- **Principal-scoping is server-side, hints only narrow.** The existing
  `h2a_discover_sessions` input schema already accepts `scope`/`instance`/
  `name` filters (`packages/h2a/src/runtime/mcp/tools.ts`) — those still
  work, but only **within** the principal-resolved subset computed above.
  A client cannot pass an `instance`/principal selector that reaches outside
  it. This mirrors the exposure spec's invariant #3 verbatim: *"selector
  hints only and may narrow, never broaden, the resolved context."*
- **Response shape**: the existing handlers already return
  `{ instances: [...] }` / `{ sessions: [...] }`
  (`packages/h2a/src/runtime/mcp/handlers.ts`). Add one top-level field at
  the same call sites:
  ```ts
  interface H2AFeedResponse {
    readonly asOf: string;                          // ISO 8601, the read timestamp
    readonly instances: readonly InstanceDescriptor[];
    readonly sessions: readonly SessionDescriptor[];
  }
  ```
  Minimal, additive — no break to the existing tool contract.
- **Liveness/staleness rendering contract**: the gateway/UI renders exactly
  the `liveness`/`state` values the feed computed (Part A) plus `asOf` — it
  never re-derives "is this live" from wall-clock arithmetic of its own. A
  UI showing a snapshot from a store whose daemon has been down for 10
  minutes must show `stale`/`closed` rows because the feed itself computed
  that, not because the UI guessed.
- **How this supersedes the one-shot mirror**: today's EVO-13 P1/P2 mirror
  is (a) a single shared root with no principal isolation and (b) a manual,
  ad hoc push (an operator/cron runs `h2a remote mirror` when they remember
  to). This design keeps the exact same signed-envelope trust boundary
  (`acceptMirrorEnvelope`, replay guard, sequence fencing) and only adds
  per-principal store partitioning + a continuous daemon — no new auth
  model, no bearer token, no weakening of DEC-116.

### Attach semantics (P1 boundary)

**Attach = read-only.** For P1, "consulting a session" means viewing its
`SessionDescriptor` metadata (title, state, timestamps) — nothing more.
**Interactive attach** — routing a live session into the browser so the
owner can read its transcript or send it input — is explicitly **out of
scope** for this contract. It is a separate, separately-gated capability
(today, drive/wake is local-only per the operating-modes doc: *"the hosted
surface today is read-only; drive (EVO-1 wake) is local-only"*) and must not
be assumed to fall out of this feed design.

### P1 scope

Read-only. Single principal = the owner's own `sub`, reading only their own
bound agents. This can run as a single per-principal root slice (comparable
to today's demo-status mode 4, "🟡 démo (enrôlement OFF)," but with
enrollment turned ON for exactly this one owner). Full multi-tenant fan-out
— many principals, shared-cluster root partitioning, cross-tenant isolation
tests — stays gated behind the exposure spec §5's **ARCH-11 prerequisite**
("P2 prerequisite: ARCH-11 strict tenant resolution... Until then,
multi-tenant/workspace persistence and cross-workspace exposure are NO-GO")
and is explicitly not proposed here.

---

## Gaps: fields the architect wants that h2a doesn't emit today

### 1. `InstanceDescriptor.declaredCapabilities` — always `[]` (see the SPLIT ruling)

`H2AActorRegistration.capabilities: string[]` exists and is typed, but
`identity/live.ts` `ensureRegistered` hard-codes `capabilities: []` at
mint — nothing populates it today; its only current reader
(`canAttestComprehension` in `handlers.ts:539`) is an NHI-attestation gate,
not a descriptive list.

**Resolution (as implemented, per the SPLIT ruling below)**: thread an optional
`declaredCapabilities?: readonly string[]` through `ResolveLiveIdentityInput` →
`ensureRegistered`, defaulted by the caller to a small static, closed vocabulary
(`["h2a.session", "h2a.mcp", "h2a.subagents"]`; the CLI path declares the first
two, since subagent support is host-specific and not knowable there), and write
it to a **new, separate** `H2AActorRegistration.declaredCapabilities` field.
Additive, no schema break. **NOT** into `capabilities` — that field is the
subagent ceiling and the attestation right; see the SPLIT ruling for why this is
non-negotiable and why a "don't collide with right strings" invariant does not
substitute for it.

### 2. `SessionDescriptor.counterpartsOpaqueRefs` — no source field at all

No h2a structure today records "who is this session in contact with."

**Proposed minimal addition**: derive, don't store — a pure function at
feed-build time that unions (a) the `parties` of any
`H2ANegotiationRecord` this instance is party to
(`packages/h2a/src/types.ts` `H2ANegotiationRecord.parties`), and (b) the
`actor.instance`/`target.instance` of envelopes sharing this session's
`threadId` within a bounded recent window (the EVO-inbox-threading fields
already on `H2AEnvelope`). The **feed server** — never h2a core, never the
wire — then opacifies each raw `instance` handle into a stable,
per-principal-salted id (e.g. `HMAC(instance, principal-scoped-salt)`)
before it is returned, so the browser gets a stable-but-unaddressable
reference, never a routable bus address. For P1, since negotiations are not
yet mirrored (EVO-13 explicitly scopes `h2a_conflict_posture` out until
they are), this field correctly defaults to `[]` for every session —
accurate, not fabricated.

### 3. `InstanceDescriptor.role` — emitted, but only one value in practice

Not missing, just narrow: `ensureRegistered` always writes `roles:
["AGENTS"]`. The field, the enum, and the plumbing all already exist
(`H2A_ROLES`); nothing structural is required — only whichever future work
assigns a real `PRINCIPAL`/`CONDUCTOR`/etc. role at registration time would
widen it. Not blocking for P1.

---

## Ratification checklist coverage

| Checklist item | Where addressed |
|---|---|
| Authorizing authority = principal, agent co-signs | Part B, "Authority model" |
| Binding shape `{principalSub, agentPubKey, boundAt, state, bindingId}` | Part B, "Binding record" |
| Re-enrollment = new bindingId, never silent rotation | Part B, "Re-enrollment of a post-re-anchor key" |
| Reject valid signature from unbound/revoked key (authorship ≠ authorization) | Part B, "Fail-closed semantics" items 3–4 |
| Principal-scoping server-side; hints narrow, never broaden | Part C, "Auth handshake" + "Principal-scoping" bullets |
| Explicit `asOf`; deterministic liveness thresholds tied to h2a signals (90s keepalive, `connectionConfidence`) | Part A, "Liveness / state derivation"; Part C, `H2AFeedResponse.asOf` |
| Opaque descriptors; workspace = label only; no paths/keys/bodies | Part A, "Opacity boundary" |
| Attach = read-only view for P1 (owner's own principal); interactive attach out of scope | Part C, "Attach semantics (P1 boundary)" |

---

## Ratification (architect, 2026-07-24) — RATIFIED, conditions accepted (FINAL)

Architect independently verified the load-bearing grounding (signCanonical/verifyCanonical `signature.ts:11,22`; `H2A_SESSION_DEFAULT_EXPIRY_MS=90000` `session.ts:36`; `H2A_HOSTED_READONLY_TOOLS` `readonly-allowlist.ts:16`; the `principal?` collision `types.ts:109`). All 8 checklist items covered. Three binding conditions on the flagged gaps — accepted:

1. **`counterpartsOpaqueRefs` HMAC**: the salt is **server-held, per-principal, never shipped to the browser, and not derivable from the opaque ref**. The mapping must be **stable within a principal** (UI can correlate the same counterpart across sessions) but **NOT enumerable or reversible** into a routable `instance:` address. `[]` for P1 (negotiations unmirrored) is correct.
2. **`lastActivityAt` fallback**: baked into the descriptor as `activitySource: 'mcp' | 'heartbeat'` (SessionDescriptor, above). The gateway/UI MUST render the `'heartbeat'` case as advisory ("process alive"), never as proven MCP traffic.
3. **`capabilities` closed vocab**: a **declared, non-authoritative display list only**. The gateway MUST NOT use it for any authorization decision — authz stays principal-binding + server-side scope.

**Grant-model note (non-blocking)**: `H2APrincipalAgentBinding` is a **sibling** record, NOT a `ConnectorAccountEnrollment` (no `secretRefs`/`accountRef`; a public key is not secret). When the canonical AccessGrant workstream lands, the gateway references the binding by opaque `bindingId`; the binding does not fold into it.

**Q1 ruling on absent sources (architect, 2026-07-25 — architecture/contract-conformance GO given conditional on it)**: a row is **NEVER DROPPED** to hide a missing field (a dropped row is a false negative on presence and collides with the "empty arrays = nothing enrolled" semantic above). The governing principle is instead: **never synthesize a value indistinguishable from a real one.** So `workspaceLabel`/`host` fall back to the literal `'unknown'` (no real label or host hint is `unknown`; it reads as a blank), while `role` is **widened to `H2ARole | 'unknown'`** — synthesizing `'AGENTS'` was rejected because it is a real `H2A_ROLES` member, so once real roles land (PRINCIPAL/CONDUCTOR/CONTROL) an absent role would silently render as a genuine claim of authority with nothing downstream able to tell synthesized from asserted. The instance roll-up ordering `live > idle > stale > closed` is **confirmed**, on the structural ground that `deriveLiveness` decides staleness *before* consulting `deriveConnectionConfidence` — so an `idle` is always fresh knowledge, never absence of it; were that ordering inverted, `stale` would have to dominate. Capabilities need **no backfill** for P1: `[]` on a pre-existing registration is cosmetic, not a correctness or security gap, since the list is display-only (condition #3); the UI renders `[]` as "not declared", never "this agent can do nothing".

**SPLIT ruling on `capabilities` (architect, 2026-07-25 — supersedes the single-field reading of condition #3; the earlier architecture/contract GO was WITHDRAWN pending it)**: `H2AActorRegistration.capabilities` is **authority-bearing** — it is the subagent capability CEILING (`subagents.ts`, a SUBSET check over the whole field, `capabilities-exceed-parent`) and it feeds `canAttestComprehension` (`authority.ts` `H2A_ATTESTER_COMPREHENSION_RIGHT`). A display list must therefore **never** be written into it: doing so widens a privilege ceiling as a side effect of a display feature. The four parts of the ruling:

1. Nothing writes display vocabulary into `capabilities`; it keeps its pre-existing content, so pre-existing authz semantics are untouched.
2. The registration store gains a separate **`declaredCapabilities`** field carrying the declared display list. The feed reads THAT field, never `capabilities`.
3. The **wire/descriptor field is named `declaredCapabilities` too** — the whole defect was ambiguity between "display list" and "authz list", so the wire name must carry the non-authoritative semantic itself.
4. A regression test pins the separation: populating `declaredCapabilities` must change **no** subagent-ceiling outcome and **no** attestation-right outcome.

Explicitly NOT relied upon: the invariant "no display-vocabulary member may ever equal a right string". In the observed failure that invariant **held** — none of `h2a.session`/`h2a.mcp`/`h2a.subagents` is a right string — and the ceiling widened anyway, because the check is a subset over the whole field rather than a lookup of specific strings. An invariant satisfied by the exact case it is meant to stop is not a mitigation: separation of fields is, string choice is not.

**Read-boundary sanitization (same ruling)**: the feed is a boundary of its own and sanitizes there, never assuming an upstream sanitizer — `mirror/accept.ts` authorizes a mirrored registration by key ownership alone without constraining its content, `serve.ts` persists it verbatim, `mcp/handlers.ts` applies a caller-supplied registration, and the store re-validates nothing on read. Two hard constraints: `declaredCapabilities` is filtered by **ALLOWLIST — an intersection with the closed vocabulary, never a denylist** that strips path or PEM markers (a denylist is whack-a-mole and loses to the next encoding); and `role` is **validated against `H2A_ROLES` on read**, anything unrecognized mapped to `'unknown'`, so a `'SUPERADMIN'` planted by any writer can never reach a consumer typed against this contract.

**Shape of the opacity guarantee, stated precisely**: the feed never *sources* a filesystem path or key material into a descriptor, and every field with a declared closed shape (`role`, `declaredCapabilities`, the ISO timestamps, `state`, `liveness`, `activitySource`) is validated on read. It does **not** guarantee that a free-text host-native title (`displayName`/`topicOrTitle`, from Claude `customTitle` / Codex `thread_name` / `/rename`) is benign — no allowlist can constrain free text — so the consumer must escape those like any user content. They are the owner's own agent's names in the owner's own panel, never another principal's data.

**EMPTY-AS-FACT amendment (raised by the sentropic auth lane, accepted and owned by the architect, 2026-07-25 — applies to this feed as well as to the binding resolver)**: the fail-closed rule above ("authenticated principal, no `active` binding → 200 with empty arrays") must not be implemented as a `?? []` at a resolver tail. **A DEFAULTED empty array is indistinguishable from (a) an errored resolver, (b) a silently-empty query, and (c) a lookup that was never performed.** The reusable rule: *an empty collection on the wire is a factual claim — "there is nothing" — so it must be produced by code that actually ESTABLISHED that fact. A default cannot establish a fact.*

Consequences that are now contract, not implementation detail:

1. **An empty `instances`/`sessions` means "we looked and this principal has nothing."** A consumer may trust an empty feed exactly as much as a populated one.
2. **An unread source is an ERROR, never an empty feed.** The descriptor builders require their presence and registry inputs to *be* collections and throw, naming the source, when one is missing — a failed `listPresence` must never render as "you have no agents". A caller with no registry passes an empty collection **deliberately**, which is itself the claim "I looked, it is empty".
3. **`counterpartsOpaqueRefs: []` is produced by an explicit branch** on whether any counterpart source is wired (P1: none is, per Gaps §2), not by a literal default — so when a source lands, the empty case cannot silently persist as a fallthrough.

This is the same discipline the contract already applies to scalars via the `'unknown'` sentinel, extended to collections. Architect's framing: it is the third instance today of one defect family — *a value that cannot distinguish "nothing" from "we never looked"* — alongside a claim wider than its instrument and a status wider than its evidence.

**P1 confirmed**: read-only, owner's own `sub`, single per-principal root slice, enrollment ON for that one owner. Full multi-tenant fan-out stays behind ARCH-11 strict (exposure spec §5). Attach = read-only metadata; interactive attach is a separate gated capability.

---

## Step 4b — BLOCKING security requirement: cross-verify path identity against key identity

Recorded on the ruling of the sentropic architect lane (2026-07-25), raised **before** the code exists.
Blocking on step 4b; may be cited as constraining work in the h2a lane.

Step 4b makes the push target per-binding-keyed (`/h2a/mirror/<bindingId>`). Today's ingest check
(`runtime/mirror/accept.ts`) proves only that the payload is signed by a key that owns the instance
**declared in that same payload** — payload-internal consistency — and `runtime/mirror/serve.ts` routes on
one fixed path with **no** path parameter, which is why there is no vulnerability today and why 4b would
introduce one.

If 4b routes the write by the `<bindingId>` in the **path** while validation only proves the payload is
internally self-consistent, then path-identity and key-identity are validated **independently**. Agent A,
holding a perfectly valid key and a perfectly valid signature over its own payload, can POST to principal
B's bindingId path and land a write in B's partition. **Every individual check passes; the composition is
what fails** — which is exactly why this is blocking rather than advisory.

**REQUIRED**

1. The ingester MUST cross-verify that the signing key **is** the `agentPubKey` of the **ACTIVE** binding
   named by the `<bindingId>` in the path. Path-identity and key-identity are checked **against each
   other**, never each merely valid on its own.
2. A `bindingId` in a URL is a **ROUTING key, never a bearer credential**. Possession of the path confers
   nothing.
3. Mandatory negative test: valid key + valid signature + **someone else's** `bindingId` ⇒ **REJECTED**,
   with **no write and no partial write** (a rejected cross-principal push must leave the target partition
   byte-identical; a per-item loop that validates late is how partial writes appear).
4. Logging: a `bindingId` in the owner's own local journal is fine — it is not a credential. Once the
   ingester logs server-side in a shared or multi-tenant context, `bindingId`s must not reach shared logs.

**The generalisation, which is the reusable part**: a credential proves **who produced** something, never
**what it may touch**. This is the same failure family as *authorship ≠ authorization* — there a valid
signature was almost allowed to stand in for an authorization lookup; here it would stand in for partition
ownership.
