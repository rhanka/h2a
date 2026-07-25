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
- `instanceId`/`sessionId` are the row's **own** identity (the resource the
  owner is reading about their own agent) — shown verbatim, because P1 is
  "read your own data."
- `counterpartsOpaqueRefs` are **other** parties' handles. Those are never
  the raw `instance:` routing string (that string is a live bus address —
  leaking it into a browser surface would let the UI attempt to address the
  bus directly, bypassing h2a's own authority model). They MUST be opaque,
  stable, per-principal-scoped ids (see Gaps §2).

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
   signs the nonce: `signCanonical(nonce, { by: instance, privateKeyPem })`
   (`packages/h2a/src/signature.ts`). This is the **exact same primitive**
   already used for reclaim proof-of-possession
   (`identity/bindings.ts` `provesLocalKey` / `verifyReclaimProof`) — no new
   crypto, no new key.
4. The agent returns `{ nonce, signature, publicKeyPem, instance }` to the
   gateway.
5. Gateway verifies: (a) the nonce is unexpired and was issued to this same
   `sub` (this is the principal's authorizing act — the 39-auth session that
   requested the challenge already IS the authenticated principal; no second
   human-side signature scheme is needed); (b) `verifyCanonical(nonce,
   signature, publicKeyPem)` (`packages/h2a/src/signature.ts`) proves key
   control.
6. On success, gateway **mints a new** `H2APrincipalAgentBinding` row —
   fresh `bindingId`, `state: 'active'`.

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
