# Study: dependable addressing and role visibility for named h2a sessions

Date: 2026-07-18

Status: **STUDY / DESIGN ONLY — no implementation**

Motivating command: `h2a run claude --name a20`

## Executive conclusion

Today, `a20` is a dependable local runtime selector only within part of the
runtime surface. It is not a protocol identity assertion, not a presence-session
identifier, and not a protocol role binding. A fresh launch can therefore show
up simultaneously as:

- runtime slug and registry id `a20`;
- tmux session `h2a-a20`;
- runtime projection id `local:a20`;
- a Claude provider conversation id, if one is available;
- a full protocol instance such as `claude:<native-or-cwd-name>:<uuid12>`;
- a launcher-sidecar instance such as `agent:<cwd-name>:<uuid12>`;
- one or more transient presence ids such as `sess:<hex>`;
- a separate objective-loop agent id and functional role.

Those identifiers describe different objects and have different lifetimes. The
current source contains no verified join from the runtime launch record to the
protocol instance(s) and protocol roles associated with the launched terminal.
The structured sidecar handshake proves that an auto-opened presence exists, but
the launcher discards even the returned presence session id and never receives
the instance, name, roles, or registration proof. [S1] [S5] [S15]

The situation is not merely a display problem:

1. A plain `h2a run` has launcher-side h2a disabled by default, so it may create
   no protocol presence at all. [S2]
2. If the launcher sidecar is enabled, its default command receives neither
   `--host claude` nor `--name a20`. It resolves as host `agent`, normally names
   itself from the cwd, and can share one perennial protocol instance with other
   named sidecars in the same workspace. [S2] [S9] [S10]
3. If Claude independently loads the host-integrated MCP configuration, it can
   create a second `claude:...` identity for the same terminal, again without a
   join to `a20`. [S11]
4. One runtime wake path parses the supposedly opaque protocol instance and
   assumes its label is the tmux slug. A mismatch leaves the wake envelope
   unprocessed; watch mode repeats the same pass. This is a literal retry loop in
   current source. [S8] [S22]
5. Objective-loop correlation cannot match an ordinary local projection to a
   protocol instance. It can consequently classify an existing named process as
   missing and request another launch, subject to cooldown and relaunch guards.
   [S19]

The strongest design direction is therefore **not** “make `a20` the address.” It
is a verified launch-identity join:

- keep the full `host:label:uuid12` protocol instance opaque and authoritative
  for direct protocol delivery;
- keep `a20` as a uniqueness-checked operator selector/display name;
- keep the exact tmux session and pane as process locators;
- keep `sess:*` as a transient attachment/liveness id;
- correlate them at the readiness boundary with an immutable launch generation
  and explicit evidence;
- expose protocol authorization roles, runtime classification, and objective
  role separately;
- represent multiple or conflicting identities explicitly instead of silently
  choosing one.

This study does not decide which process owns the canonical actor identity: the
host-integrated MCP, the launcher sidecar, or an authenticated handoff between
them. It recommends a provider/key-proven host actor with a sidecar wake-proxy
default, but D4 remains an owner decision that must precede implementation.

## Question, scope, and non-goals

The question is:

> After an owner runs `h2a run claude --name a20`, what must `a20` mean so the
> owner can reliably find the intended process, learn its protocol address and
> roles, send to it safely, and wake or supervise it without identity loops?

In scope:

- exact current launch, tmux, registry, projection, protocol identity, presence,
  discovery, inbox, wake, and objective-loop flows;
- the semantic boundary between a human name, a process locator, a perennial
  protocol identity, and a live attachment;
- safe ambiguity, rename, resume, reuse, and compatibility behavior;
- requirements, competing design options, risks, and future acceptance cases.

Out of scope:

- code or schema implementation;
- migration execution;
- changing inbox routing, tmux naming, or objective-loop policy in this study;
- selecting a final CLI spelling for future lookup commands;
- treating a display name as an authorization or routing authority.

## Source baseline and method

This study is grounded in the exact working-tree source on 2026-07-18, based on
HEAD `51c7259b0a6df66928ab89ae8c6378f9578b1047` on branch
`feat/llm-gateway-0.9-integration`.

The working tree already contained unrelated user changes. In particular,
`packages/h2a-runtime/src/tmux.ts`, `registry.ts`, `index.ts`, and
`agents-projection.ts` contain uncommitted tmux-prefix and ambiguity work. This
study deliberately describes those current files, not committed HEAD. In the
current working source, `h2a-` is the canonical local tmux prefix and `remote-`
is the accepted legacy prefix; a bare slug that matches both is ambiguous.
[S3]

Method:

1. trace `--name a20` forward from CLI parsing to every persisted and projected
   identifier;
2. trace protocol identity and presence independently from `mcp-serve`;
3. inspect every selector and delivery resolver rather than infer equivalence
   from similar strings;
4. trace both runtime wake and objective-loop relaunch/wake consumers;
5. challenge the findings with two independent adversarial source reviews;
6. separate current-source facts (cited as `[S#]`) from proposed requirements
   (marked `R#`) and unresolved decisions (marked `D#`).

## Current identifier ontology

The word “session” currently spans at least four different objects: a runtime
session, a provider conversation, a protocol instance attachment, and an
objective-loop participant. Treating their ids as aliases is the central error.

| Object | Example after `--name a20` | Authority and lifetime | Safe use | Unsafe inference | Evidence |
|---|---|---|---|---|---|
| Owner-requested name | `a20` | Input to one launch; constrained by runtime naming rules | Human/operator selector candidate | Protocol recipient, role, or identity proof | [S1] |
| Runtime slug | `a20` | Local managed-session key while that runtime row/session exists | `run` result id; local attach/stop lookup when unique | Full protocol instance | [S1] [S3] |
| Exact tmux session | `h2a-a20` | Concrete tmux container; canonical prefix in current working source | Exact attach/stop and runtime process lookup | Protocol identity or display name | [S3] |
| Exact agent pane | `%N` | Concrete terminal endpoint for the current launch incarnation | Wake/injection after liveness and human-typing checks | Perennial identity | [S3] [S16] |
| Runtime registry session id | `id=a20`, `label=a20` | Runtime enrollment key for this `run`; other sources can use provider conversation, control-plane, or hook ids | Join runtime/tmux state within the registry | A universal session id, launch generation, or protocol registration | [S4] [S23] |
| Runtime registry delegated-job id | opaque `job.id`; projected as `job:<job.id>` | Delegation/conductor key and job lifecycle | Address a managed job in the runtime/control plane | Provider conversation or protocol actor | [S23] |
| Remote control-plane session id | registry `remoteId`; projection `remoteSessionId` | Remote session/Pod control-plane authority | Remote attach/stop/log lookup | Local tmux name or protocol address | [S23] |
| Runtime projection id | `local:a20` | Read-only projected runtime entity | `h2a agents inspect local:a20` | Bare-name compatibility or protocol route | [S5] |
| Synthetic job `h2aInstance` | `remote-job:<tool>:<job.id>` | Runtime projection correlation token manufactured from a job row | Current projection/objective correlation where explicitly supported | Proof that a protocol registration, key, inbox, or presence exists | [S23] |
| Provider conversation id | `CLAUDE_CODE_SESSION_ID` value | Provider resume/reclaim hint; not an authority anchor | Reclaim same provider conversation | Human address, pane, or authorization | [S9] |
| Protocol display name | native Claude name or cwd; not `a20` by default | Mutable UX attribute on registration/presence | Discovery and display | Routing key | [S7] [S9] [S12] |
| Full protocol instance | e.g. `claude:repo:<uuid12>` or `agent:repo:<uuid12>` | Frozen perennial actor handle; key/inbox authority | Exact direct protocol address | tmux slug or unique live terminal | [S7] [S10] [S13] |
| Presence session id | `sess:<16 hex>` | One transient MCP attachment; many allowed per instance | Liveness/connection correlation | Durable recipient or actor id | [S12] |
| Runtime `role` | absent for this launch | Only the delegated-job classifier `"job"` | Distinguish runtime job from ordinary session | Protocol permission or loop function | [S4] |
| Protocol roles | default `AGENTS` at first registration | Authorization/discovery attributes of exact instance | Protocol capability/role display | Runtime job kind or loop role | [S10] [S18] |
| Objective-loop agent id | explicit `agent.id`, defaulting to the joined full instance | Functional participant key inside one loop | Exact loop-agent state and event correlation | Global protocol/runtime identity unless joined | [S19] [S25] |
| Objective-loop references | `h2aInstance`, `remoteAgentId`, `remoteJobId`, plus launch/track refs | Optional cross-plane correlation fields on the loop agent | Exact correlation when populated and unique | Permission to infer a missing ref from role, host, or label | [S19] [S25] |
| Objective-loop role/placement/status | e.g. `participant`, `local`, `running` | Functional policy, requested/actual placement, and loop-local lifecycle | Objective planning, display, and supervision | Protocol authorization, connection health, or managed runtime state | [S19] [S25] |

Two consequences follow.

First, the full protocol instance is the only current direct protocol delivery
address, but it identifies a perennial actor, not necessarily one live terminal.
The protocol explicitly permits several concurrent presence sessions for one
instance. [S12] [S13]

Second, a presence `sessionId` is exactly the missing launch-correlation evidence
the current readiness ACK already observes, but it is not a suitable durable
address because it changes per MCP attachment. [S12] [S15]

Third, the delegated-job projection's `remote-job:<tool>:<job.id>` value must not
be read as evidence of a protocol actor. It is constructed synchronously from
the runtime job row even when no matching registration or presence has been
observed. [S23]

## Exact trace: `h2a run claude --name a20`

### 1. Runtime naming is deterministic

The runtime option describes `--name` as “tmux session slug + tab label.” The
launch validates the value, selects it as the single label, and passes it to
`startLocalSession`. The tmux layer slugifies the label, prefixes it with the
current canonical `h2a-`, creates window `claude`, records the exact agent pane,
and persists profile/cwd metadata. For this input the intended local result is
therefore slug `a20`, tmux session `h2a-a20`, and an exact `%N` agent pane.
[S1] [S3]

The runtime enrollment then writes `id=a20`, `label=a20`,
`tmuxSession=h2a-a20`, tool `claude`, cwd, and optional provider resume id. It
does not accept or store a protocol instance, a presence session id, a protocol
display name, or protocol roles. The JSON launch result similarly returns
`session.id=a20`, tmux session, pane, profile, workspace, gateway state, and only
a boolean `h2aSidecar`. [S1] [S4]

This local half is internally coherent. The break occurs at the protocol join,
not at `a20 -> h2a-a20`.

### 2. There are three materially different protocol variants

#### Variant A — launcher sidecar disabled

The launcher chooses `opts.h2a ?? config.enabled`, and `enabled` defaults to
false. A plain `h2a run claude --name a20` therefore does not itself guarantee
any h2a presence. An independently configured host MCP may still exist, but that
is outside the runtime launch result. [S2]

Required operator conclusion: when this variant occurs, addressability is
**unavailable**, not inferable from `a20`.

#### Variant B — launcher sidecar enabled

The default sidecar command is exactly:

```text
h2a mcp-serve --auto-open --auto-upgrade --wake local-tmux
```

The runtime starts that command unchanged. It supplies no `--host`, `--name`, or
`--instance`. `resolveAutoOpen` consequently resolves identity with host
`agent`, while omitting the optional `host` field from the returned presence
configuration because no host flag was present. With no native provider session
for unknown host `agent`, identity falls back to a per-workspace provider-session
key and chooses the cwd/native fallback as its name. For a workspace named
`a2a-cli`, a newly minted instance will have the shape
`agent:a2a-cli:<uuid12>`, not `claude:a20:<uuid12>`. [S2] [S7] [S9]

The side-window wrapper does carry one strong piece of evidence: before starting
`mcp-serve`, it deliberately overrides `TMUX_PANE` with the exact agent pane.
Auto-open then records that pane as the presence launch context. The protocol
therefore knows an exact pane-to-presence relationship; the runtime simply does
not ingest it back into its registry, projection, or result. [S16]

#### Variant C — Claude host-integrated MCP

`h2a host setup --host claude` renders an MCP command with `--auto-open --host
claude`, but still without `--name a20`. Claude identity can then bind to
`CLAUDE_CODE_SESSION_ID`; its name precedence is explicit name, then Claude
`customTitle`/`agentName`, then cwd label. Thus the same terminal may have a
separate `claude:<native-or-cwd-name>:<uuid12>` actor, also unjoined to `a20`.
[S9] [S11]

If both variants B and C exist, the current source does not classify one as the
primary actor and the other as a wake proxy. A future join must not silently
merge them because they can have different keys, registrations, roles, and
inboxes.

### 3. Same-workspace sidecars can collapse distinct runtime names

The no-provider fallback is not merely a different label. Identity binding
matches `(host, providerSessionId)`; `workspaceId` is recorded only as metadata.
When no provider id is readable, the caller constructs
`fallback:<host>:<workspaceId>`. Two default sidecars in the same workspace
therefore present the same stability key: host `agent` plus the same fallback
provider-session id. With proof of the existing locally stored key, the later
sidecar reclaims the earlier perennial instance. [S10]

Consequently:

```text
runtime a20 -> tmux h2a-a20 --\
                                 > protocol instance agent:a2a-cli:<same uuid12>
runtime a21 -> tmux h2a-a21 --/
```

Each sidecar still opens a different random `sess:*` attachment and records its
own exact agent pane. The protocol instance inbox and registration, however, are
shared. [S12] [S16]

Merely forwarding `--name a20` to `mcp-serve` would not solve this. The name
affects minting, but a successful reclaim returns the already frozen instance;
`ensureRegistered` does not update an existing registration name. A presence can
therefore carry a new name while discovery continues to prefer the old
registration name. [S7] [S10] [S17]

### 4. Runtime projection loses the join and the bare selector

The local projection becomes:

```json
{
  "id": "local:a20",
  "kind": "local-session",
  "tool": "claude",
  "tmuxSession": "h2a-a20",
  "sources": [{ "kind": "local-tmux", "id": "a20" }]
}
```

It has no `h2aInstance` and no role fields. Its `label` is populated only from a
separately set tmux `@display_name`, which `run --name` does not set. Inspector
matching considers projection id, job id, exact tmux session, remote id,
`h2aInstance`, or display label, but not the source slug. Thus, for the fresh
launch, `h2a agents inspect a20` fails while `local:a20` and `h2a-a20` can match.
[S5]

The runtime `h2a ls` view does show `a20`, because it falls back from absent
display name to the slug. There is no single current view that shows `a20`, the
exact protocol instance(s), liveness attachment(s), and roles together. [S6]

## Current discovery and addressing behavior

### Discovery is split by data source

Protocol `discover` reads registrations and can filter by role/scope. Its live
path groups presence by exact instance and joins registration roles by that same
instance. It does not implement a name filter. `sessions --name` and `status
--name` can filter presence names, but presence records carry no protocol roles,
so those views cannot answer “what roles does a20 have?” by themselves. [S17]

Runtime `agents` reads jobs and local tmux rows and does not join the protocol
registry or presence store. [S5]

The result is two legitimate but disconnected answers:

- runtime: “`local:a20` is a detached Claude session in `h2a-a20`”;
- protocol: “`agent:a2a-cli:<uuid>` or `claude:<name>:<uuid>` has role
  `AGENTS` and N live attachments.”

Neither source can currently prove those statements refer to the same actor or
terminal.

### Bare names and two-segment aliases are intentionally not direct routes

Protocol inbox writes reject a hostless `a20`. A full three-segment
`host:label:uuid12` is accepted as a direct target. A two-segment
`claude:a20` is a legacy/channel alias: if multiple live full ids share the
host-label it is refused; if exactly one is live, the resolver returns a hint but
deliberately leaves the delivery destination as the alias. Automatic alias-to-id
rewriting is parked as an interception risk. [S13] [S14]

Furthermore, only the first claimant of a shared legacy alias reads that alias
inbox; later de-collided peers do not. `claude:a20` is therefore never a
dependable synonym for `claude:a20:<uuid12>`, even if the strings happen to
align. [S14]

This safety property must survive any named-session design. A convenient local
selector may help an operator *look up* the exact route; it must not silently
become a protocol channel or authorization anchor.

### Rename behavior is split and currently misleading

The native CLI help advertises `h2a rename --instance <id> --name <name>` and
says peers can find it through `discover --name`. The native contract and
`cmdDiscover` do not expose `discover --name`, and the native synchronous route
has no rename handler. Unknown native verbs fall through to the heavy runtime,
whose actual command is positional `rename <slugOrId> <newName>` and modifies
tmux/control-plane display state, not protocol registration or presence identity.
[S20]

This is evidence of the namespace split, not a recommendation to make rename
rewrite a frozen protocol instance. Protocol source explicitly says display name
is mutable UX state and never a routing key. [S7] [S12]

### No current command exposes enough identity by itself

“Enough” here means that an owner can distinguish managed work from actors and
attachments, choose the identifier authoritative for the requested action, see
role/placement/capability/status without inference, and receive a closed
ambiguity error.

| Current surface | What it actually enumerates or resolves | What is adequate today | What remains missing |
|---|---|---|---|
| `h2a ls` | Local tmux plus runtime registry, then remote control-plane sessions | Local/remote managed-work visibility and a source badge | Protocol actor, roles, presence count, loop refs, immutable launch generation, and verified joins [S6] [S24] |
| `h2a sessions` / `status` | Fresh presence attachments, filterable by exact instance, name substring, or scope | Attachment-level diagnostics and exact `sess:*` visibility | Managed-work ownership, protocol registration roles, alias uniqueness, and generation; repeated rows for one actor are expected, not duplicate work [S17] [S26] |
| `h2a discover` | Perennial registrations; `--live` instead groups fresh presence by exact instance and annotates roles/scopes | Exact actor ids, protocol roles/scopes, and connection confidence | Runtime/tmux/job/loop links; fresh heartbeat is explicitly not proof of reachability or managed work [S17] |
| `h2a attach` / `stop` | Local managed tmux first, then remote control-plane | Current `h2a-`/legacy `remote-` collision refusal and registry-backed local routing prevent arbitrary prefix choice or local-to-Pod fallthrough | Protocol actor/presence selectors and a verified actor-to-launch join; a full instance cannot safely locate a terminal [S24] |
| Protocol inbox write (`inbox put`; a future `send` may wrap it) | Full protocol instance directly, or legacy host-qualified alias/channel behavior | Exact opaque delivery and fail-closed hostless/ambiguous alias handling | Dependable resolution from operator name to actor; managed status and placement are intentionally outside this primitive [S13] [S14] |
| `h2a loop agents` / attach/logs selector | Loop-local agent records containing optional cross-plane refs | Exact refs are representable and `agents` emits the full records | CLI selection takes the first match across id, role, host, remote-agent id, or instance; it neither checks multiple matches nor matches `remoteJobId` [S25] |

The answer to the adequacy question is therefore **no**: the current commands
are useful, but they are intentionally authoritative for different object
kinds. Dependable named-session operation needs a joined read model and
action-specific resolution; merging the existing lists into one undifferentiated
“sessions” list would make the ambiguity worse.

## Source-grounded loop failures

### Literal runtime wake-request loop

Protocol identity source says callers must not parse the colon-separated
instance. Runtime `resolveAgentPaneForInstance` nevertheless splits it, treats
segment two as the tmux slug, and requires segment one to equal the tmux-stored
profile. [S7] [S8]

For the motivating launch, both common identities fail that heuristic:

- default sidecar: host `agent` does not equal stored profile `claude`, and its
  label is the cwd rather than `a20`;
- host-integrated MCP: host `claude` can match, but the native/cwd label still
  need not equal `a20`.

When resolution fails, `wake-request` logs “no agent pane,” skips the envelope,
and does not mark it processed. With `--watch`, the pass runs again at the polling
interval. The unresolved envelope is therefore retried indefinitely until some
external state or process termination changes the condition. [S22]

The source already contains the correct local precedent: sidecar self-wake uses
the exact inherited agent pane stored in its own launch context and explicitly
avoids instance-based pane lookup, because concurrent sessions can share one
perennial instance. [S16]

### Bounded objective-loop false relaunches

Objective-loop matching uses only exact `h2aInstance`, remote job id, or remote
agent id. Ordinary local projections have none of those correlation fields.
When the loop agent also lacks the exact protocol instance, the existing
`local:a20` process is invisible to that match; pending work can emit
`request-launch`. [S5] [S19]

The launch result does not fill the loop agent's missing `h2aInstance`, and the
request-launch sink records an action event rather than mutating the loop agent
with a verified identity. A later tick can therefore request another launch.
The retry is bounded by cooldown and `maxRelaunches` (default 3); an existing-name
or invalid-result failure is marked non-retry-safe and stops further requests.
This is a repeated/failed relaunch cycle, not an unbounded spawn claim. [S19]

When a loop *does* have the exact instance, its wake adapter is safer: it selects
fresh presence by exact instance and drives the stored exact tmux launch context,
without parsing the instance. That is the design precedent to preserve. [S19]

Separately, interactive loop selection is not deterministic under duplicate
human attributes. `selectLoopAgent` returns the first record matching any of
`id`, `role`, `host`, `remoteAgentId`, or `h2aInstance`; two `participant` or two
`claude` agents therefore select by array order instead of producing ambiguity.
The schema also carries `remoteJobId`, but this selector does not consult it.
This can attach/log the wrong loop participant even before launch correlation is
considered. [S25]

## Root causes

### RC1 — `--name` has no cross-boundary contract

The runtime defines `--name` only as tmux slug/tab label. It is not propagated as
a protocol display-name request, and no result field states whether any protocol
actor was created or attached. [S1] [S2]

### RC2 — readiness proves presence, not identity

Structured readiness correlates nonce and PID and receives a non-empty random
presence `sessionId`, but the ACK omits protocol instance, name, roles, workspace,
registration/key proof, exact launch context, and actor/proxy classification. The
runtime returns only sidecar pane/PID and discards the presence id. [S15]

### RC3 — two registries are not joined

The runtime registry owns slug/tmux/provider-resume metadata. The protocol
registry owns the perennial instance, key material, name, roles, scopes, and
workspace. Presence owns transient liveness and exact launch context. None stores
a verified common launch-generation key. [S4] [S10] [S12]

### RC4 — identity cardinality is not one-to-one

One named runtime can have zero protocol actors, a sidecar proxy, a
host-integrated actor, or both. Conversely, multiple named sidecars can reclaim
one fallback protocol instance. A scalar guessed `protocolInstance` field would
hide real ambiguity. [S2] [S10] [S11]

### RC5 — “role” names three unrelated concepts

Runtime `role` means only delegated job classification; protocol roles are
authorization/discovery attributes; objective-loop role is a functional label
inside one loop. The runtime projection exposes none of the latter two. [S4]
[S18] [S19]

### RC6 — selectors mix lookup and routing

Runtime commands accept a local slug or exact tmux name under uniqueness rules.
Protocol delivery requires a host-qualified exact identity or deliberately uses
a legacy alias/channel. Treating the same string as both selector and recipient
would bypass existing ambiguity and anti-interception rules. [S3] [S13] [S14]

### RC7 — one wake path derives process location from identity spelling

The runtime wake resolver violates the opaque-id invariant instead of consuming
the already captured exact pane from verified presence. [S8] [S16] [S22]

### RC8 — launch rows lack incarnation/generation

The runtime registry key for this path is the reusable slug `a20`. A stopped and
later recreated `a20` is not necessarily the same provider conversation,
protocol actor, or pane. Any future identity link needs an immutable launch
generation; otherwise a reused row can retain or be mistaken for a stale actor.
[S4] [S21]

## Design invariants to preserve

These are constraints from current source, not optional conveniences.

1. **Opaque route.** The full protocol instance remains frozen at mint and is
   never derived back into a tmux locator. [S7]
2. **Name is UX, not authority.** Rename may alter display/lookup state but not
   keys, inbox authority, or the frozen route. [S7] [S12]
3. **Alias safety.** A two-segment alias is not silently rewritten to a live full
   id; ambiguity and phantom targets fail closed. [S13] [S14]
4. **Cardinality is explicit.** One instance may have several transient presence
   sessions; one runtime launch may expose multiple actor/proxy identities. [S12]
5. **Provider id is a reclaim hint.** The provider conversation helps stability
   but is not the ed25519 authority anchor and is not an operator address. [S9]
6. **Exact process wake.** Wake/injection uses a verified exact pane plus liveness,
   idleness, cooldown, and human-typing guards. [S16] [S19]
7. **Compatibility ambiguity fails closed.** Current `h2a-` and legacy `remote-`
   sessions can coexist; a bare collision cannot choose arbitrarily. [S3]
8. **Unavailable is valid state.** A run without protocol presence must say so;
   no identifier may be invented from name similarity. [S2]
9. **Unverified legacy is not verified.** A historical slug/label match may be a
   discovery hint, never proof that two records represent one actor.

## Requirements for a future design

These requirements are proposed by this study; they are not implemented.

### R1 — Define `a20` as an operator selector

`a20` should mean “the uniquely selected current local runtime launch in the
declared namespace,” not “the protocol inbox named `a20`.” Lookup must produce
one of `unique`, `missing`, or `ambiguous`, with exact candidates on ambiguity.

The namespace and reuse policy remain open in D2, but at minimum the selector
must distinguish launch generations.

### R2 — Introduce an immutable launch generation

Every concrete launch incarnation needs an immutable correlation id independent
of the reusable slug. Conceptually:

```text
launchGeneration = launch:<random-or-monotonic-id>
operatorName      = a20
runtimeProjection = local:a20
tmuxSession       = h2a-a20
agentPane         = %17
```

The generation must change when `a20` is stopped and recreated, while a provider
resume can explicitly link the new generation to the same perennial actor.

### R3 — Extend the readiness evidence conceptually

When addressability is requested, successful readiness should attest at least:

- challenge nonce and sidecar/host process PID;
- immutable launch generation;
- exact tmux session and agent pane;
- presence `sessionId`;
- full protocol `instance`;
- protocol display `name`;
- workspace/root and observed host;
- registration/key existence and effective protocol roles;
- attachment kind, such as `primary-actor`, `wake-proxy`, or `secondary`.

The runtime must verify and retain the evidence rather than infer it later from
string equality. A successful process start without the required identity proof
must be a typed degraded/failure result, according to D1.

### R4 — Store a set-valued, attributable join

A future launch record must support zero, one, or several protocol attachments:

```text
LaunchIdentityLink {
  launchGeneration
  runtimeId
  tmuxSession
  agentPane
  attachments[] {
    kind: primary-actor | wake-proxy | secondary
    protocolInstance
    presenceSessionId
    protocolName
    protocolRoles[]
    observedHost
    verifiedAt
    evidence
  }
  linkage: verified | unavailable | ambiguous | stale | legacy-unverified
}
```

`presenceSessionId` is evidence for one attachment and may expire; the perennial
`protocolInstance` remains the route. Exactly one verified primary actor is the
happy path. Zero, multiple primaries, or conflicting panes/instances must remain
visible states, not last-writer-wins choices.

### R5 — Preserve actor versus attachment semantics

Protocol mail is addressed to the full perennial instance. Terminal-specific
operations such as wake use the selected fresh presence attachment and its exact
pane. If several live attachments intentionally share one instance, the design
must define whether protocol notification is fan-out, leader-selected, or
otherwise coordinated; it must never select an arbitrary pane by parsing the
instance.

### R6 — Join role vocabularies without flattening them

The owner view should show separately:

- `runtimeKind` / `jobClassification`;
- `protocolRoles` with source instance and effective grants;
- `objectiveRole` with loop id and loop agent id.

An unqualified `ROLE` field is insufficient because `job`, `AGENTS`, and
`participant` answer different questions.

### R7 — Provide one joined operator projection

A successful named launch should eventually be inspectable in one view similar
to:

```text
NAME       a20
LINK       verified
RUNTIME    local:a20
TMUX       h2a-a20  pane=%17
PROFILE    claude
ACTOR      claude:a20:7e6b...  primary
PRESENCE   sess:91ab...  active
PROTO ROLE AGENTS
LOOP ROLE  participant (loop:...)
```

When reality differs, the view must say `unavailable`, `proxy-only`,
`multiple-actors`, `shared-instance`, `stale`, or `legacy-unverified` instead of
manufacturing the happy path.

### R8 — Separate lookup from direct delivery

An operator selector may resolve to an exact full instance for display or an
explicit next step. Direct inbox delivery should continue to use the full
instance unless a separately approved, auditable selector-to-route workflow is
chosen in D3. No current two-segment alias should silently change semantics.

### R9 — Wake only through verified launch context

Deprecate the design assumption behind `resolveAgentPaneForInstance`. Runtime
wake, sidecar self-wake, and objective-loop wake should consume the exact pane
from the selected verified presence/launch link. An unresolved wake should move
to an explicit parked/backoff/escalated state rather than remain an invisible
forever-retried envelope.

### R10 — Make sidecar-disabled and partial states honest

If h2a is disabled, launch output must state `addressability: unavailable`. If a
presence opens but actor ownership cannot be established, state `proxy-only` or
`unverified`; do not report the runtime slug as an address. Structured callers
may choose fail-closed addressability, while interactive callers may allow a
clearly visible degraded launch, subject to D1.

### R11 — Do not assume `--instance` is a safe launcher shortcut

Current `resolveLiveIdentity` returns immediately for an explicit instance,
before normal binding, key, registration, workspace, and name setup. A design
that has the launcher invent and pass `--instance` would therefore require a
separate authenticated ownership/registration contract; simply adding the flag
is not sufficient. [S7]

### R12 — Legacy migration is evidence-preserving

Historical sessions may be shown as candidate matches based on slug, tmux
metadata, cwd, host, or presence context, but only a verifiable handshake may
upgrade them to `verified`. Conflicts remain visible and no migration may rewrite
the frozen protocol instance merely to resemble the runtime name.

## Options considered

| Option | Summary | Benefits | Fatal or material costs | Study disposition |
|---|---|---|---|---|
| A. Make `a20` the address | Route directly to bare name or `claude:a20` | Superficially simple UX | Violates host qualification, UUID de-collision, rename stability, concurrency, and current anti-interception alias behavior | Reject |
| B. Pass `--host claude --name a20` to the sidecar | Make minted strings look aligned | Better initial display on a first mint | No provider evidence in a sibling sidecar; same-workspace fallback can still reclaim one instance; reclaim freezes the old id/name; does not join roles/result | Reject as sufficient solution; possible input to a larger design |
| C. Documentation/discovery only | Teach users to run separate runtime and protocol commands | Lowest implementation cost | Does not fix wake parsing, sidecar collisions, readiness correlation, false relaunches, or unified roles | Insufficient |
| D. One universal session id | Replace runtime, provider, protocol, presence, and loop ids with one id | One apparent token | Objects intentionally have different lifetimes, cardinalities, owners, and authority; breaks resume and concurrent attachment semantics | Reject |
| E. Scalar `protocolInstance` on runtime row | Persist one instance next to `a20` | Easy joined display in simple case | Hides zero/multiple actor cases; stale on slug reuse; cannot distinguish actor from proxy or transient attachment | Reject as data model |
| F. Verified launch-generation join | Preserve native ids and add evidence-backed relations | Addresses operator UX, safe routing, roles, wake, and lifecycle without weakening identity invariants | Requires actor-ownership decision, handshake evolution, lifecycle model, and migration states | Preferred direction for a future DESIGN/EVOL |

## Preferred direction, without committing implementation

The future design should be built around two separations and one verified join:

```text
operator plane                         protocol plane
--------------                         --------------
a20 (selector/display)                 full instance (direct route/authority)
local:a20 (runtime projection)         registration (name, roles, keys)
h2a-a20 + %17 (process locator)         sess:* (live attachment)
          \                              /
           \-- verified launch link ----/
                  launch generation
                  evidence + kind
```

The owner should be able to begin with `a20`, but every consequential action
must resolve to the identifier authoritative for that action:

- attach/stop -> exact current tmux session;
- inspect roles -> exact protocol registration(s), with attachment kind;
- direct send -> exact full protocol instance;
- wake -> exact fresh presence launch context and pane;
- resume -> provider conversation evidence plus a new launch generation;
- objective supervision -> loop agent id joined to exact protocol/runtime ids.

This yields dependable addressing without pretending the identifiers are the
same string.

### Canonical opaque addresses and human aliases

The preferred model does not create another universal “session id.” It gives
each durable object one canonical opaque address and joins them:

| Address/domain | Proposed meaning | Mutability and routing authority |
|---|---|---|
| `launch:<opaque-generation>` | One concrete managed-work incarnation | Immutable; canonical for lifecycle, attach/stop eligibility, and links, but not a protocol inbox |
| Existing full protocol instance | One perennial actor/key authority | Already immutable and canonical for direct inbox delivery; never derived from launch, alias, provider id, or tmux spelling |
| Existing runtime job/control-plane ids | One delegated job or remote managed session | Preserved as native management authorities and linked to the launch generation where applicable |
| Existing `sess:*` | One presence attachment | Transient diagnostic/wake evidence only; never a durable recipient or managed-work address |
| Loop agent id scoped by loop id | One objective participant | Canonical only inside that loop; linked explicitly to actor and managed-work refs |

Human names such as `a20` become versioned aliases in an operator namespace,
not fields copied into every id. An alias record should identify its namespace,
normalized and display spellings, target launch generation, validity interval,
state (`active`, `retired`, or `conflicted`), and evidence/source. Alias history is
retained so reuse cannot make an old event point at a new launch. Protocol
registration names remain independent mutable UX attributes. The namespace and
reuse policy require D2.

This model makes the requested relationship explicit:

```text
operator alias a20 -> launch:<opaque generation> -> exact managed locator(s)
                                  |
                                  +-> 0..N attributed actor links
                                         |
                                         +-> full opaque protocol instance
                                         +-> 0..N transient sess:* attachments
                                  |
                                  +-> 0..N loop-agent refs (scoped by loop)
```

### Deterministic resolver contract

Every command must declare a target domain before resolving: `managed-work`,
`protocol-actor`, `presence-attachment`, or `loop-agent`. Resolution then follows
this closed algorithm; it must not fall through from one domain because a
string happens to resemble another id.

1. **Classify explicit selectors.** Exact current ids and typed future selectors
   (`launch:…`, `job:…`, `local:…`, exact managed tmux name, exact full protocol
   instance, `sess:…`, or loop-scoped agent id) are looked up only in their
   declared domain. A known id of the wrong kind returns `E_TARGET_WRONG_KIND`.
2. **Preserve command-specific compatibility.** For `attach`/`stop`, an untyped
   legacy token keeps current local-first behavior: resolve live managed tmux,
   then the durable local registry; refuse any `h2a-`/`remote-` or local alias
   ambiguity; consult the remote control plane only when local resolution is
   missing. An explicit URL/session pair forces the remote domain. [S24]
3. **Resolve human aliases only after exact ids miss.** Query the selected
   namespace and return the full candidate set. Zero candidates is
   `E_TARGET_NOT_FOUND`; more than one is `E_TARGET_AMBIGUOUS`; a retired target
   without an allowed historical operation is `E_TARGET_STALE_LINK`.
4. **Traverse only verified typed links.** For example, actor -> managed launch
   is valid for attach only when exactly one current verified link advertises
   attach capability. A label, prefix, cwd, provider conversation, registration
   name, or fresh presence alone never upgrades a link.
5. **Authorize the resolved action.** Resolution returns the canonical id,
   candidate aliases, link evidence/freshness, placement, capabilities, and
   relevant status. Unsupported operations return `E_TARGET_UNSUPPORTED`, not a
   best-effort route.

All ambiguity errors must be stable and machine-readable:

```json
{
  "code": "E_TARGET_AMBIGUOUS",
  "input": "a20",
  "domain": "managed-work",
  "candidates": [
    { "canonical": "launch:01…", "alias": "a20", "locator": "h2a-a20" },
    { "canonical": "launch:02…", "alias": "a20", "locator": "remote-a20" }
  ],
  "retryWith": ["h2a attach h2a-a20", "h2a attach remote-a20"]
}
```

Human output may be shorter, but it must list exact usable candidates. Never
silently pick the newest row, first loop agent, freshest presence, or first
alias claimant. `E_TARGET_UNVERIFIED` distinguishes a plausible historical
match from a missing target. Exact protocol delivery retains the current
host-qualified, anti-interception behavior; an explicit future `channel:` form,
rather than a bare name, should represent channel semantics if D3 permits it.

### Display vocabulary: keep independent dimensions independent

Joined output needs separate columns/JSON fields rather than one overloaded
`STATE` or `ROLE`:

- `kind`: managed session, delegated job, remote session, actor, presence
  attachment, or loop participant;
- `placement`: local tmux, local headless, remote interactive, remote headless,
  plain process, or unknown;
- `capabilities`: independently computed `attach`, `stop`, `logs`, `send`,
  `wake`, `resume`, and `objective` booleans with reasons when false;
- `managedStatus`: runtime/job/control-plane state, including ended;
- `connectionConfidence`: `active`, `idle-uncertain`, `unknown`, or expired,
  preserving the current advisory meaning rather than using it as a routing
  gate [S17] [S26];
- `workStatus`: optional presence self-report, distinct from connection and
  managed status [S26];
- `runtimeKind`, `protocolRoles`, and loop-scoped `objectiveRole`;
- `linkStatus`: `verified`, `unavailable`, `proxy-only`, `ambiguous`, `stale`,
  `shared-instance`, or `legacy-unverified`.

### Compatible CLI projection and action UX

The following is a semantic contract, not a commitment to final flag spelling.
Existing exact selectors remain valid throughout rollout.

| Surface | Default object and proposed behavior | Identity shown / accepted | Guardrail |
|---|---|---|---|
| `h2a ls` | Managed work only, one row per active/recent launch generation; retain LOCAL and REMOTE sections | Alias/name, launch/job/remote id, placement, managed status, exact locator; compact actor-link status and presence count, with roles/refs in `--wide`/JSON | Never list a presence-only actor as managed work; never imply `active` connection means a job is running |
| `h2a sessions` | Presence attachments only, explicitly headed “PRESENCE (not managed work)” | `sess:*`, full actor instance, name, host, pane/context, heartbeat/activity confidence, optional linked launch | Several rows for one actor are normal; expiry removes liveness, not the actor or managed row |
| `h2a discover` | Protocol actors/registrations, one row per full instance; optional live summary | Full actor id, mutable name, protocol roles/scopes, capability summary, connection count/confidence, verified managed links | Registration or fresh presence alone never asserts managed work exists |
| `h2a attach` | Managed-work operation; preserve slug, exact tmux, local-first, explicit remote URL/id | Prefer launch id or exact managed locator; actor id is allowed only when one current verified attach-capable launch link exists | Reject `sess:*`; ambiguous actor or prefix/alias candidates are errors |
| `h2a stop` | Managed-work operation with the same compatibility resolver | Launch/job/remote id, exact managed locator, or uniquely verified actor link | Stopping work does not delete the actor, inbox, registration, or unrelated presence |
| `h2a send` / inbox write | Protocol-actor operation; a convenience command may wrap the current inbox primitive | Exact full instance is non-interactive authority; a human alias may resolve and print the exact destination only under D3; explicit `channel:` preserves channel intent | Never treat `a20`, `sess:*`, tmux name, or job id as a recipient without one unique verified actor traversal; no alias auto-rewrite hidden from output |
| inbox read | Actor inbox by exact self instance; optional joined display metadata | Actor id remains the ownership boundary; show source alias/launch only as annotations | A managed-work stop/rename cannot transfer inbox ownership |
| objective loops | One row/selection per loop-scoped agent, with exact refs | Loop agent id, functional role, placement/status, `h2aInstance`, launch/job/remote refs, capabilities | Selectors return one unique agent or candidates; role/host are filters, never first-match addresses; presence absence alone must not trigger relaunch |

This keeps `ls`, `sessions`, and `discover` complementary: managed work, live
attachments, and perennial actors respectively. The joined link appears in all
three as attribution, but none silently changes its primary object kind.

### Alignment with the `h2a-` tmux-prefix migration

The working source already treats `h2a-` as canonical, dual-reads legacy
`remote-`, persists exact tmux names where available, and reports both exact
candidates for a bare collision. Attach/stop additionally trust a matching
local runtime row before remote control-plane fallback, preventing a transient
tmux miss from becoming a Pod reconnect loop. [S3] [S24]

The target model should reuse that resolver as the managed-locator layer,
retain both prefixes as exact compatibility selectors during rollout, and store
the exact observed tmux name in each launch link. It must **not** derive a
protocol instance, actor alias, role, or presence from `h2a-a20`; the prefix
migration solves managed tmux naming only. Ending the legacy dual-read is a
separate compatibility decision after observed collision-free use, not a
prerequisite for protocol addressing.

## Lifecycle and conflict rules to settle

The future DESIGN should define these state transitions explicitly:

1. **Create launch.** Allocate a new immutable launch generation before process
   start. Activate `a20` for that generation in its namespace. Runtime start can
   succeed with `addressability=unavailable`; structured/objective callers may
   instead require verified addressability under D1.
2. **Verify attachment.** A challenge-bound handshake may add a primary actor,
   proxy, or secondary link. One verified primary plus exact process context is
   `verified`; zero is `unavailable`; competing claims are `ambiguous`,
   `shared-instance`, or `proxy-only`, never last-writer-wins.
3. **Open/reconnect presence.** Every attachment gets a new random `sess:*`.
   Reconnection can retain the same perennial instance and launch generation
   only when authority plus incarnation/context evidence still matches. Merely
   sharing `name`, cwd, pane label, or provider hint is insufficient.
4. **Multiple live attachments.** Preserve all sessions. Actor-level inbox
   delivery still targets the one full instance; terminal wake requires one
   selected fresh, verified attachment according to D5. No “newest session”
   shortcut is authoritative.
5. **Presence becomes idle or expires.** Current source heartbeats every 5 s,
   expires after 90 s by default, treats ten minutes without MCP activity as
   `idle-uncertain`, and normally sweeps expired presence files. These are
   attachment/connection facts only. Expiry removes live/wake eligibility; it
   does not stop managed work, end a loop participant, delete a registration,
   or make the perennial exact inbox address invalid. [S26]
6. **Provably dead reconnect residue.** Current reconnect cleanup can reap a
   different same-instance session whose local PID is provably dead. Preserve
   that narrow rule; do not globally probe remote PIDs or infer death from
   silence alone. [S26]
7. **Stop managed work.** Mark the launch ended and retire its active operator
   alias/attach-wake capabilities. Retain immutable links and exact locator as
   history. Do not delete actor keys, registration, inbox, or other launch links.
8. **Resume/relaunch.** Always allocate a new launch generation and process
   locator. Provider conversation evidence plus actor-key proof may link the new
   generation to the same frozen instance; otherwise it is a new or unavailable
   actor relationship. Relaunch guards count attempts per loop agent/generation,
   not per reusable alias.
9. **Reuse `a20`.** A new conversation gets a new launch generation and alias
   validity interval. Historical events continue resolving to the old
   generation. Concurrent or normalization-colliding reuse becomes explicit
   ambiguity according to D2.
10. **Rename.** Changing the operator alias retires/redirects alias metadata
    according to owner policy; changing a protocol display name updates only
    registration/presence UX. Neither rewrites launch id, tmux historical
    locator, provider id, full instance, key authority, inbox, or loop id.
11. **Legacy source-only match.** Expose `legacy-unverified` plus source,
    freshness, and candidates. Only an authenticated handshake upgrades the
    link; a matching `a20` substring or tmux prefix never does.

The joined read model should be derived conservatively from these independent
lifecycles. In particular, `runtime live + presence expired`, `runtime ended +
presence fresh`, `actor registered + no managed link`, and `managed launch + no
actor` are all valid, reportable states rather than repair triggers.

## Phased, reversible rollout

No phase changes frozen protocol ids, renames tmux sessions, or deletes legacy
data. Each phase is independently disableable and preserves the current exact
CLI forms.

| Phase | Additive change proposed for a later DESIGN/EVOL | Entry evidence | Reversal |
|---|---|---|---|
| 0 — contract baseline | Freeze this ontology, resolver/error vocabulary, JSON fixtures, and command ownership; instrument current ambiguity/degraded cases without changing routing | Golden current-source fixtures and owner decisions D1-D6 | Remove diagnostics/docs only; behavior is unchanged |
| 1 — observe identity evidence | Add a versioned structured-readiness payload carrying instance, presence, exact context, roles, and attachment kind; continue accepting v1 ACK | Challenge/mismatch tests and shadow logs prove evidence is trustworthy | Disable v2 request/consumption; v1 path remains |
| 2 — shadow launch index | Allocate launch generations and append set-valued links in shadow mode; expose read-only debug/JSON projection, but let existing commands resolve exactly as today | Cross-source reconciliation reports zero silent overwrites and classifies partial states | Stop shadow writes/reads; native registries and ids remain untouched |
| 3 — opt-in joined UX | Add explicit inspect/resolve or `--wide`/JSON joined views for `ls`, `sessions`, `discover`, and loops; return proposed typed errors only behind an opt-in compatibility flag | CLI goldens and operator validation demonstrate object-kind clarity | Hide the joined fields/flag; data remains additive |
| 4 — opt-in action resolver | Allow launch ids and verified links for attach/stop/wake; optionally allow audited send-by-alias under D3; preserve current slug, exact tmux, URL/id, and full-instance forms | Differential tests compare legacy and new resolution; every divergence is expected and reviewed | One configuration switch restores legacy resolvers; exact selectors still work |
| 5 — safe default | Make the joined resolver default only after ambiguity, stale-link, multi-presence, prefix, and relaunch acceptance gates pass; retain an emergency legacy resolver switch for one compatibility window | Release telemetry/log review plus migration rehearsal over legacy `remote-` rows | Switch default back without data rewrite |
| 6 — compatibility retirement, separately authorized | Consider removing legacy implicit forms or `remote-` dual-read only after an owner decision and measured zero-use window | Explicit deprecation criteria and recovery documentation | Keep/read the legacy path; never rewrite opaque actor or generation ids |

Suggested verification layers for those phases:

- pure resolver table tests over exact ids, typed ids, normalization, aliases,
  wrong-kind inputs, stale links, and complete ambiguity candidate ordering;
- property tests that insertion order, presence freshness order, and registry row
  order cannot change a resolution result;
- integration tests across runtime registry, tmux metadata, protocol
  registration/presence, remote jobs, and loop state, including partial-store
  failure;
- CLI golden tests proving `ls` means managed work, `sessions` means
  attachments, and `discover` means actors in both human and JSON output;
- migration/differential tests for simultaneous `h2a-a20`/`remote-a20`, exact
  historical rows, remote/local same-name collision, and rollback at every
  phase;
- lifecycle tests for rename, name reuse, reconnect, provider resume, new
  conversation, several sessions per instance, 90-second expiry, a fresh
  presence on ended work, and live work with stale/no presence;
- objective-loop tests for duplicate role/host filters, absent refs, synthetic
  job refs, one verified correlation, bounded relaunch, and exact-context wake.

## Future acceptance scenarios

Any implementation proposal should be rejected unless its tests cover at least:

1. `run --name a20` with sidecar disabled reports addressability unavailable.
2. A verified launch exposes runtime id, exact tmux/pane, protocol instance,
   presence attachment, protocol roles, and linkage status in one projection.
3. Concurrent `a20` and `a21` in the same cwd do not silently become one actor.
4. A deliberately shared perennial instance exposes both attachments and never
   wakes an arbitrary pane.
5. A host-integrated Claude MCP plus launcher sidecar is classified as
   actor/proxy or explicit ambiguity, not silently unioned.
6. Same provider conversation resumed under a new launch generation preserves
   the frozen exact instance when ownership proof succeeds.
7. A new provider conversation reusing name `a20` gets a new actor link.
8. Rename changes lookup/display state while the exact route remains unchanged;
   discovery shows one consistent current display name.
9. `h2a agents inspect a20` either resolves uniquely through the operator index
   or returns explicit ambiguity with `local:a20`/tmux candidates.
10. Protocol, runtime, and objective roles are displayed separately with their
    source and freshness.
11. Same label on different hosts, case/slug normalization collisions, and
    simultaneous `h2a-a20`/`remote-a20` refuse ambiguous lookup.
12. Full instance delivery remains direct; hostless and ambiguous alias delivery
    preserves current refusal/hint rules.
13. A runtime wake consumes verified exact launch context and never parses the
    protocol instance.
14. An unresolved wake becomes parked/backed off/escalated and is not logged
    forever on every watch pass.
15. An objective loop correlates a launched local session after the first launch
    and does not request a duplicate; relaunch guards remain effective.
16. Presence expiration, runtime-only live tmux, protocol-only live presence, and
    old unlinked rows produce explicit degraded states.
17. Structured readiness rejects mismatched nonce, PID, launch generation,
    instance, pane, root/workspace, host/profile, registration, or attachment
    kind.
18. An explicit-instance flow cannot claim verified ownership without keys and a
    valid registration.
19. A delegated `job.id`, control-plane `remoteId`, and synthetic
    `remote-job:<tool>:<job.id>` remain distinguishable; the synthetic value
    cannot fabricate protocol registration or send capability.
20. Two loop agents sharing the same role or host make that filter ambiguous;
    exact loop-agent, actor, job, and remote refs each select only their unique
    record, independent of array order.
21. Passing `sess:*` to attach, stop, send, or loop-agent actions returns
    `E_TARGET_WRONG_KIND` with the permitted target kinds.
22. Live managed work with expired/no presence remains managed and does not by
    itself trigger relaunch; fresh presence linked to ended work does not make
    that work attachable.
23. Exact `h2a-a20` and `remote-a20` remain independently usable during the
    prefix migration; bare `a20` lists both and never falls through to a remote
    Pod when local evidence exists.
24. Every rollout phase can revert to the preceding resolver/read model without
    rewriting launch generations, protocol instances, native registry ids, or
    historical alias intervals.

## Open decisions for the next design rung

These are the **owner decisions** exposed by the study. Field names, table
layout, cache strategy, and final flag spelling are implementation/design-detail
decisions and should not be escalated as owner policy.

| Decision | Study recommendation | Why owner authority is required |
|---|---|---|
| D1 addressability obligation | Require verified addressability for objective-loop/structured launches; allow an explicitly degraded interactive launch | Changes whether a successful process launch can be reported as command success |
| D2 alias namespace/reuse | Start with one active alias per runtime root/tmux-server namespace, retain immutable generation history, and fail cross-source collisions closed | Determines what the human promise “`a20`” means and when names can be reused |
| D3 send-by-alias | Keep exact full instance mandatory for non-interactive delivery; permit only an opt-in, auditable unique alias resolution for interactive convenience; make channel intent explicit | Alias delivery changes routing/anti-interception semantics and can send work to the wrong principal |
| D4 primary actor owner | Prefer the provider-integrated host actor when it has provider/key proof; treat a sibling launcher sidecar as a wake proxy unless an authenticated handoff establishes actor ownership | Controls keys, inbox consumption, resume, grants, and who may speak as the actor |
| D5 concurrent attachment semantics | Keep one perennial actor inbox; select terminal wake only through a unique verified launch attachment, otherwise refuse | Current protocol permits concurrent sessions, so arbitrary “freshest” selection can affect another terminal |
| D6 durable join owner | Prefer an additive generation-keyed neutral launch index that references, but does not replace, native runtime/protocol stores | Cross-owner failure, retention, and repair policy cannot safely be hidden in one subsystem |

The recommendations are deliberately conservative and reversible. Ratifying
them authorizes a DESIGN/EVOL contract, not implementation.

## Owner decision record — ratified 2026-07-23

The six owner choices from the Focus dossier were received by the live H2A CLI
on 2026-07-23 and are now the design baseline.  They settle the policy choices
that were open when this study was written; they do **not** yet authorize a
silent routing change or a destructive migration.

### Terminology correction: `--name` is not necessarily an alias

The earlier text uses *operator alias* as a modelling term.  In the normal
Claude Code workflow the operator sees and often deliberately aligns two human
labels:

- `h2a run claude --name a20`: the **launch name**, used by H2A/runtime and
  normally reflected in the tmux launch; and
- `/rename a20`: the mutable **provider conversation label**, visible inside
  Claude Code.

Matching strings are valuable operator UX, but are only observed or declared
label correspondence.  They neither prove that the runtime launch, provider
conversation, tmux process, H2A actor, or live attachment are the same object,
nor authorize delivery.  The word *alias* below therefore means a future,
versioned lookup record only where such a record actually exists.  Until then,
`a20` should be called the launch name/operator selector.  A joined projection
must display `launchName`, `providerConversationLabel`, `h2aInstance`,
`tmuxSession`, and immutable `generationId` separately, with a label relation
of `matching`, `different`, or `unknown`.

| Decision | Ratified policy | Implementation boundary |
|---|---|---|
| D1 — addressability | Structured and objective-loop launches require verified protocol addressability. An interactive launch may continue only with an explicit `degraded` result. | A process start alone is never reported as structured success. |
| D2 — launch-name namespace | One active launch name per runtime-root/tmux-server namespace; immutable launch generations and closed collision handling. | This applies to `h2a run --name`, not to the global uniqueness of Claude `/rename` labels. |
| D3 — delivery | Non-interactive delivery requires the exact full H2A instance. Interactive convenience may resolve one unique launch-name link only with explicit channel intent and auditable output. | No bare launch name, tmux name, provider label, or legacy alias silently becomes a route. |
| D4 — actor owner | A provider-integrated, key-proven MCP host owns the primary actor. A sibling launcher sidecar is only a verified wake proxy absent authenticated handoff. | The launcher cannot mint or claim the host actor merely because names match. |
| D5 — inbox and attachments | The perennial actor owns its inbox. A terminal wake requires exactly one verified launch attachment; zero or several candidates refuse wake. | Never select newest presence or fan out merely because attachments are live. |
| D6 — durable join | A neutral, additive, generation-keyed launch index links native runtime and protocol records. | Native stores retain their authority; partial links remain visible rather than last-writer-wins. |

### Authorized next rung

Produce the DESIGN/EVOL contract for the neutral launch index and the
challenge-bound readiness proof, then implement only its additive/read-only
foundation first: generation allocation, append-only link evidence, and a
joined inspection projection.  Routing, automatic wake, and alias convenience
remain disabled until the proof, ambiguity, and interactive-confirmation
acceptance tests exist.

### D1 — Is protocol addressability mandatory for `h2a run`?

Choices include:

- required for structured/objective-loop launch but optional-degraded for an
  interactive human launch;
- required for all supported profiles;
- always opt-in, with supervision disabled when unavailable.

### D2 — What is the `a20` uniqueness and reuse scope?

Candidates include current machine/runtime root, workspace, owner, or a wider
control-plane scope. The answer determines how ambiguity is reported and when a
name may be reused after stop.

### D3 — May an operator selector authorize direct send?

The safest baseline is lookup-only: resolve `a20`, show the exact full instance,
then send explicitly. A convenience send would need explicit unique resolution,
auditable output, and a decision on confirmation; it must not reuse legacy alias
semantics accidentally.

### D4 — Which process owns the primary actor identity?

Options:

- host-integrated MCP owns the actor; launcher sidecar is only a wake proxy;
- launcher sidecar owns a launch-scoped actor;
- an authenticated handshake transfers/binds the host actor to the launcher;
- profiles choose different ownership models but expose a common verified
  contract.

This is the highest-impact unresolved decision. It controls keys, provider
resume, role grants, inbox consumption, and multi-attachment behavior.

### D5 — What are the intended semantics of several live sessions per instance?

The protocol permits them. The design must state whether inbox observation is
fan-out, single-consumer, or coordinated, and how one terminal is selected for
wake without undermining perennial identity.

### D6 — Where does the durable join live?

Candidates are the runtime registry, the protocol store, or a new neutral launch
index. The owner must be explicit, append/reuse behavior must be generation-safe,
and readers must be able to report partial failure without last-writer-wins
repair.

## Adversarial review reconciliation

Two independent read-only reviews were required by the STUDY workflow.

The source-trace reviewer corrected three initial simplifications:

- plain launch, launcher-sidecar, and host-MCP variants must be analyzed
  separately;
- exact pane evidence already exists in presence because the sidecar wrapper
  overrides `TMUX_PANE`; the missing step is the return join, not capture;
- the no-provider binding fallback can collapse same-workspace sidecars onto one
  instance, so forwarding name alone is insufficient.

The contract reviewer independently reached the same conclusions and challenged
the scalar-link idea: one launch can have a primary actor and a proxy, while one
actor can have several attachments. That produced R4/R5 and kept actor ownership
open in D4. The reviewer also required separate runtime/protocol/objective roles,
an immutable launch generation for name reuse, and preservation of alias
anti-interception behavior.

Both reviewers distinguished the two loop claims now used here:

- runtime `wake-request --watch` can literally repeat an unresolved envelope
  indefinitely;
- objective-loop relaunch/wake behavior is bounded by cooldown, non-retry-safe
  failures, and `maxRelaunches`, so it must not be described as an infinite spawn
  loop.

No reviewer edited source or implementation.

## Exact source evidence

All ranges below refer to the current working-tree files described in the source
baseline.

**S1 — runtime launch and result**

- `packages/h2a-runtime/src/index.ts:4911-4939` — `run` and the stated
  `--name`/`--h2a` contract.
- `packages/h2a-runtime/src/index.ts:5081-5106` — name requirement/validation and
  label selection.
- `packages/h2a-runtime/src/index.ts:5217-5327` — sidecar selection, unchanged
  configured command, verified/unverified start.
- `packages/h2a-runtime/src/index.ts:5354-5414` — runtime enrollment inputs and
  JSON `h2a.run.result` fields.

**S2 — launcher-sidecar defaults**

- `packages/h2a-runtime/src/config.ts:113-127` — sidecar contract and default
  command without host/name/instance.
- `packages/h2a-runtime/src/config.ts:474-480` — `enabled=false` default.
- `packages/h2a-runtime/src/index.ts:5217-5219` — per-run/config choice.

**S3 — current tmux naming and exact process metadata**

- `packages/h2a-runtime/src/tmux.ts:41-44` — canonical `h2a-` and legacy
  `remote-` prefixes in the current working source.
- `packages/h2a-runtime/src/tmux.ts:226-253` — runtime slug and canonical tmux
  name construction.
- `packages/h2a-runtime/src/tmux.ts:287-348` — managed-session listing and
  unique/ambiguous resolution.
- `packages/h2a-runtime/src/tmux.ts:653-753` — launch, exact tmux name, profile
  window, captured pane, and metadata.

**S4 — runtime registry**

- `packages/h2a-runtime/src/registry.ts:38-50` — registry kind and `role="job"`
  vocabulary.
- `packages/h2a-runtime/src/registry.ts:72-138` — row schema; no protocol
  instance, presence id, or protocol roles.
- `packages/h2a-runtime/src/registry.ts:702-731` — `run` enrollment as slug/id,
  label, and exact tmux session.
- `packages/h2a-runtime/src/registry.ts:733-803` — local list rows and optional
  separately set display name.

**S5 — runtime agent projection**

- `packages/h2a-runtime/src/agents-projection.ts:14-35` — projection schema;
  `h2aInstance` optional and no roles fields.
- `packages/h2a-runtime/src/agents-projection.ts:88-111` — local projection
  `local:<slug>`, exact tmux, label only from display name, no instance.
- `packages/h2a-runtime/src/agents-projection.ts:142-154` — inspector selector
  set omits source slug.
- `packages/h2a-runtime/src/agents-projection.test.ts:69-76` — exact tmux selector
  example for a local projection.
- `packages/h2a-runtime/src/index.ts:5721-5766` — `agents ls/inspect` wiring.

**S6 — runtime list display**

- `packages/h2a-runtime/src/index.ts:7935-7958` — local list shows display name or
  slug.

**S7 — protocol identity invariants and live resolution**

- `packages/h2a/src/identity.ts:4-27` — workspace/agent/session separation,
  frozen instance, mutable name, and forbidden colon parsing.
- `packages/h2a/src/identity.ts:51-70,96-103` — protocol slug normalization and
  `host:label:uuid12` construction.
- `packages/h2a/src/runtime/identity/live.ts:202-237` — explicit-instance early
  return, host/cwd/name resolution, and mint.
- `packages/h2a/src/runtime/identity/live.ts:268-311` — registration/alias result
  and returned identity.

**S8 — name-derived runtime wake lookup**

- `packages/h2a-runtime/src/tmux.ts:1071-1095` — splits protocol instance,
  assumes label equals tmux slug, and checks host/profile equality.

**S9 — provider and native-name resolution**

- `packages/h2a/src/runtime/identity/resolver.ts:49-85` — provider conversation
  sources; Claude env and unknown-host fallback.
- `packages/h2a/src/runtime/identity/readers.ts:150-180,217-266` — Claude/Codex
  native display-name readers.
- `packages/h2a/src/runtime/identity/live.ts:225-266` — name precedence and
  no-provider fallback id.

**S10 — identity binding, registration, and collision**

- `packages/h2a/src/runtime/identity/bindings.ts:1-25,77-97` — stability unit is
  host plus provider-session id; workspace is metadata; fallback behavior.
- `packages/h2a/src/runtime/identity/bindings.ts:132-156` — proof-gated reclaim or
  mint.
- `packages/h2a/src/runtime/identity/live.ts:167-200` — default `AGENTS`
  registration and no existing-registration name update.
- `packages/h2a/src/runtime/identity/live.ts:249-289` — fallback key, reclaim, and
  registration call.
- `packages/h2a/src/runtime/local-files/store.ts:390-408` — registration append
  refuses duplicate id rather than updating it.

**S11 — Claude host MCP**

- `packages/h2a/src/cli.ts:3488-3521` — host setup command includes host but no
  runtime name/instance.
- `packages/h2a/src/hosts/claude.ts:26-48` — rendered Claude MCP command/args.

**S12 — presence and session semantics**

- `packages/h2a/src/session.ts:1-12` — transient session versus perennial
  instance; concurrent sessions permitted.
- `packages/h2a/src/session.ts:89-117` — presence fields and name as UX only.
- `packages/h2a/src/runtime/mcp/sessions.ts:74-76,94-156` — random `sess:*`, one
  presence file per client attachment.
- `packages/h2a/src/types.ts:104-133` — registration roles and non-routing name.

**S13 — protocol recipient resolution**

- `packages/h2a/src/runtime/local-files/paths.ts:93-148` — canonicalization and
  host-qualified-address requirement.
- `packages/h2a/src/runtime/local-files/paths.ts:175-295` — direct full id,
  alias hint/dormant/refusal outcomes, and no destination rewrite.
- `packages/h2a/src/runtime/mcp/handlers.ts:175-255` — resolver use and exact
  recipient-liveness match.

**S14 — legacy alias ownership**

- `packages/h2a/src/runtime/local-files/store.ts:1292-1322` — only first claimant
  reads a shared legacy alias.
- `packages/h2a/test/identity-live-wiring.test.js:102-154` — later peer exclusion
  and first-owner dual-read scenarios.

**S15 — structured readiness loses identity**

- `packages/h2a/src/runtime/mcp/stdio.ts:126-155,365-377` — ACK contains only
  kind/version/nonce/PID/presence session id after auto-open.
- `packages/h2a-runtime/src/tmux.ts:1200-1268,1274-1369` — runtime validates the
  ACK but returns only sidecar pane/PID.
- `packages/h2a/src/runtime/mcp/agent-launch.ts:174-254` — structured launch
  invocation/result validation has no protocol instance, presence id, or roles.

**S16 — exact pane evidence and self-wake precedent**

- `packages/h2a-runtime/src/tmux.ts:161-178` — sidecar wrapper overwrites
  `TMUX_PANE` with the exact agent pane.
- `packages/h2a/src/runtime/mcp/stdio.ts:279-362` — presence records that launch
  context; self-wake deliberately uses its own pane rather than instance lookup.
- `packages/h2a/src/runtime/drive/index.ts:481-505,698-727` — local-tmux driver
  consumes launch context and exact pane.

**S17 — split discovery/name views**

- `packages/h2a/src/cli-contract.ts:137-143` — protocol discover exposes
  role/scope filters, not name.
- `packages/h2a/src/cli.ts:4000-4088` — registration/live exact-instance join and
  role output.
- `packages/h2a/src/cli.ts:4138-4209` — presence `sessions/status` name filters.
- `packages/h2a/src/runtime/mcp/handlers.ts:151-169,792-829` — instance discovery
  versus session discovery inputs.

**S18 — protocol roles**

- `packages/h2a/src/runtime/identity/live.ts:167-194` — new registrations default
  to `roles: ["AGENTS"]`.
- `packages/h2a/src/types.ts:104-133` — registration role/name fields.

**S19 — objective-loop identity and bounded recovery**

- `packages/h2a/src/runtime/loop/index.ts:65-105,167-175` — independent loop
  agent id/role/instance fields and default relaunch limit 3.
- `packages/h2a/src/runtime/loop/index.ts:400-483` — explicit instance joins a
  loop agent.
- `packages/h2a/src/runtime/loop/engine/decision.ts:141-170,321-360` — exact
  correlation and launch/wake decisions.
- `packages/h2a/src/runtime/loop/engine/adapters.ts:278-310,337-420` — exact
  presence launch-context wake and bounded/cooldown attempt accounting.
- `packages/h2a/src/runtime/loop/engine/adapters.ts:555-593,630-729` — strict
  launch result, non-retry-safe duplicate/invalid result, request-launch and
  exact-context wake effects.

**S20 — rename surface divergence**

- `packages/h2a/src/cli.ts:366-375,4000-4088,6211-6269` — advertised protocol
  rename/discover-name versus implemented native routes.
- `packages/h2a/src/bin-routing.ts:26-50` — non-native verb fallback to runtime.
- `packages/h2a-runtime/src/index.ts:8038-8080` — positional runtime rename and
  tmux/control-plane effects.

**S21 — reusable runtime registry key**

- `packages/h2a-runtime/src/registry.ts:72-94,702-731` — slug/id is the stable
  runtime row key for `run`, with no launch-generation field.

**S22 — literal wake watch retry**

- `packages/h2a-runtime/src/index.ts:6894-6900` — unresolved pane skips without
  processing the wake envelope.
- `packages/h2a-runtime/src/index.ts:6962-7021` — watch mode repeats the pass.

**S23 — runtime job, remote-session, and synthetic projection identities**

- `packages/h2a-runtime/src/registry.ts:72-138` — one registry row may carry its
  native id, provider `convId`, control-plane `remoteId`, exact `tmuxSession`,
  job role/state, parent, and callback target.
- `packages/h2a-runtime/src/registry.ts:345-405` — enrollment upserts by native
  id and preserves omitted prior correlation fields; it has no launch-generation
  boundary.
- `packages/h2a-runtime/src/agents-projection.ts:57-85` — job projection derives
  `job:<job.id>`, optional remote/tmux ids, capabilities, and the synthetic
  `remote-job:<tool>:<job.id>` h2a-instance-shaped value.

**S24 — managed attach/stop compatibility resolution**

- `packages/h2a-runtime/src/index.ts:1939-1982` — live tmux then durable-registry
  resolution and exact-candidate ambiguity reporting.
- `packages/h2a-runtime/src/index.ts:7717-7780` — attach is local-first, refuses
  ambiguity, trusts a durable local row across a transient tmux miss, and only
  then falls through to the remote control plane.
- `packages/h2a-runtime/src/index.ts:8000-8035` — stop uses the same managed-local
  resolution before remote fallback.
- `packages/h2a-runtime/src/registry.ts:838-901` — exact managed names never
  become slug/label aliases; historical rows without exact prefix evidence
  return both candidates rather than manufacturing one.

**S25 — loop agent refs and ambiguous CLI selection**

- `packages/h2a/src/runtime/loop/index.ts:65-95` — loop agent id, host, driver,
  functional role, placement, status, optional protocol/remote job/remote agent
  refs, track refs, and launch spec.
- `packages/h2a/src/runtime/loop/index.ts:400-483` — join defaults id to the exact
  instance, requires an instance, and fills one exact planned slot.
- `packages/h2a/src/cli.ts:2107-2111` — CLI selection returns the first match by
  id, role, host, remote-agent id, or protocol instance without ambiguity
  detection and without consulting `remoteJobId`.
- `packages/h2a/src/cli.ts:2225-2256` — loop agents emits full records while
  attach/logs consume that selector.

**S26 — presence freshness, connection confidence, and cleanup**

- `packages/h2a/src/session.ts:18-45` — session states, 5-second heartbeat,
  90-second expiry, and ten-minute advisory MCP activity window.
- `packages/h2a/src/session.ts:89-139` — attachment id, perennial instance,
  heartbeat, work status, launch context, workspace, non-routing name, and last
  MCP activity are independent fields.
- `packages/h2a/src/runtime/local-files/presence.ts:105-161` — normal presence
  listing excludes and sweeps expired attachment files.
- `packages/h2a/src/runtime/local-files/presence.ts:221-267` — reconnect cleanup
  reaps only a different same-instance session whose local PID is provably dead.

## Study outcome

The named-session problem is not solved by synchronizing string formatting. It
is an absent, cardinality-aware, evidence-backed join between an operator-named
runtime launch and the protocol actor/attachment graph around it.

The next step, if authorized, is a DESIGN/EVOL that first resolves D4 (identity
ownership) and then specifies the launch-generation handshake, link owner,
machine contract, lifecycle state machine, and migration behavior. No
implementation should begin from this study alone.
