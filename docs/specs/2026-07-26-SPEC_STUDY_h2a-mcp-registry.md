# STUDY — third-party MCP registry through h2a

Date: 2026-07-26

Base examined: `origin/main` at `0f285c27877a332af5ffe555f5c16b556b02781c`

Status: **STUDY — recommendation ready; cross-owner parameters deliberately open**

Scope: design only. No runtime, gateway, CLI, golden-contract, sentropic-namespace, Focus, or mirror change is authorized by this document.

## 1. Decision asked

What should “registry mcp (gmail etc) dans h2a” mean when Gmail, Google Drive,
ClickUp, HubSpot, Playwright, and other third-party MCP servers must be reachable
**through one h2a connection**, instead of being configured separately in every
agent?

Three meanings are possible:

1. a catalogue that only describes servers;
2. a proxy that carries traffic to several servers;
3. a broker that carries traffic and selects the credential authorized for the
   authenticated human.

**Recommendation — [JUDGMENT]:** the product meaning should be **(3), a broker
with identity**. The owner's wording asks for the proxy experience — one agent
connection and traffic flowing through it — but a proxy without identity becomes
unsafe as soon as more than one human or credential set exists. The production
target is therefore a principal-scoped broker, not a larger local `mcp-serve`.

**Cheapest increment startable by h2a this week — [RECOMMENDATION]:** one
provider adapter/catalogue candidate with pinned, reviewed read-only descriptors
and a conformance harness for principal resolution, secret exclusion, revocation,
and honest upstream failures. It uses a fake credential resolver and mock
upstream; it adds no public tool, route, credential, or claim of reachability.
This is the smallest non-throwaway h2a contribution while the sentropic
architect and auth lane settle the seams they own.

**First owner-usable increment — [RECOMMENDATION]:** one owner `sub`, one
owner-selected credentialed OAuth upstream, and two or three explicitly
allowlisted read-only tools on the singular target gateway. It is one-week-sized
**after** the gateway endpoint, grant/vault interface, and auth prerequisites
exist; this study does not claim those unbuilt cross-lane prerequisites can be
completed this week. It is broker-shaped from the first live call: server-side
principal resolution, server-side `secretRef`, authorization checked again on
every call, and no credential in agent context. It does not become a dependency
of the already-approved h2a-sessions P1.

The strongest alternative is a local single-owner proxy: it can likely run
sooner and provides real traffic without waiting for sentropic work. It is not
recommended because the owner already classified the standalone single-tenant
project MCP as a demo, and because a local proxy would defer precisely the
credential-selection boundary this feature must prove. If the sentropic
architect cannot ratify the target placement and MCP surface for the live
slice, the honest fallback is catalogue groundwork only — explicitly **not** a
claim that third-party servers are reachable through h2a.

## 2. What exists already, and what is actually new

### 2.1 Shipped ground

| Existing surface | What it establishes | What it does **not** establish |
|---|---|---|
| In-process h2a MCP server | `createMcpServer` exposes `{ listTools, callTool }` over the local h2a store (`packages/h2a/src/runtime/mcp/server.ts:96-103,123-148`). Calls are statically dispatched to h2a and Track handlers (`server.ts:149-172,175-264`). | It is not an upstream MCP client and has no connector-account or credential resolver. |
| Static project tool descriptors | The endpoint composes h2a coordination descriptors with Track's read-only descriptors (`packages/h2a/src/runtime/mcp/tools.ts:715-727`) and refuses a missing descriptor at startup (`tools.ts:729-734`). | It has no provider catalogue, dynamic namespace, upstream lifecycle, or per-principal tool projection. |
| Golden project contract | `docs/contracts/golden/mcp-tools.json:1-38` freezes 37 `h2a_*` project verbs; its README says additions/removals/renames are public-contract changes (`docs/contracts/golden/README.md:5-15`). | It is not a registry of Gmail/Drive/etc. This study does not change or reconcile the golden surface. The current runtime's separate Track composition is pre-existing and outside this pass. |
| Hosted read-only MCP wrapper | `buildHostedMcpServer` wraps the existing h2a dispatcher, announces a fixed allowlisted subset, and maps handler errors to MCP `isError` (`packages/h2a/src/runtime/mcp-http/hosted-mcp-server.ts:20-36,39-57`). | It cannot connect to or multiplex third-party MCP servers. Its announced list is built once per MCP server/session, so it is not an authorization cache and cannot enforce later revocation by itself. |
| Structural h2a private-key exclusion | The hosted surface exposes a fixed list and throws if an exposed descriptor contains the literal `privateKeyPem` (`packages/h2a/src/runtime/mcp-http/readonly-allowlist.ts:1-10,15-45,51-68`). | This protects the shipped h2a signing-key shape. It is **not** a general detector for OAuth tokens, cookies, HubSpot keys, or arbitrary provider credentials. Third-party secret exclusion is new. |
| OAuth-gated Streamable HTTP `/mcp` | The app validates a bearer token and `h2a:read` scope (`packages/h2a/src/runtime/mcp-http/app.ts:113-128`) and serves the MCP endpoint at `/mcp` (`app.ts:200-205`). | This authenticates access to h2a's MCP server; it is not provider OAuth enrollment or third-party token custody. |
| 39-auth broker mode and per-user h2a root | Broker login binds the 39-auth `sub` into the issued token (`app.ts:60-108`; `oauth/single-tenant-provider.ts:248-266,278-307`). `/mcp` resolves that `sub` to a tenant root and rejects cross-tenant session reuse (`app.ts:132-177`). `rootForSub` safely derives the filesystem partition (`oauth/tenancy.ts:1-18`). | It selects an h2a root, not a Gmail/Drive account or provider grant. The class name `SingleTenantOAuthProvider` also reflects its origin; the broker-mode additions do not make it a third-party credential vault. |
| Prior sentropic gateway direction | The prior framing already recommends one sentropic MCP connector, 39-auth login, `sub`-scoped data, and namespaced tools with h2a as the first catalogue entry (`docs/superpowers/specs/2026-06-03-h2a-mcp-tenancy-and-sentropic-gateway-framing.md:37-49`). It calls standalone single-root h2a-mcp a demo, not an end state (`:13-18`). | It did not specify third-party connector account bindings, upstream execution, or failure semantics. |
| Sentropic gateway/catalogue implementation state at this base | None existed when the gateway framing was written (`docs/superpowers/specs/2026-06-03-h2a-mcp-tenancy-and-sentropic-gateway-framing.md:27-28`), and P1 gateway step 5 is still marked not started with an auth Lot 1 dependency (`docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md:70-81,102-106`). | The standalone h2a `/mcp` cannot be called an already-existing sentropic gateway endpoint. Target route, placement, and wire evolution remain open. |
| Ratified h2a session feed | The feed keeps principal authorization separate from agent-key authorship (`docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md:165-176`) and assigns the no-secret `H2APrincipalAgentBinding` to sentropic (`:178-215`). The P1 plan assigns gateway/catalogue/authz and binding-store ownership to the sentropic architect (`docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md:58-68`). | An agent binding is not a third-party account binding and carries no `secretRef`. It must not be overloaded to hold provider credentials. |
| EMPTY-AS-FACT contract | A default `[]` cannot distinguish “nothing” from resolver failure or “never looked”; unread sources are errors (`docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md:622-630`; joint plan `:107-111`). | Existing third-party registry and upstream error semantics do not exist yet. |

The P1 joint plan in this base still says “awaiting owner GO”
(`docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md:1-5`).
The owner's current instruction supersedes that status for sequencing: P1 has a
build GO. This study does not edit the plan, and the registry is not added to
P1's critical path.

### 2.2 New work implied by a registry

The following are new even though h2a already speaks MCP:

- a provider/server catalogue with stable opaque IDs, reviewed descriptors,
  supported transport, and lifecycle state — never raw credentials;
- a principal-scoped connector-account/grant resolver that can establish which
  catalogue tools the authenticated `sub` may use;
- third-party credential custody behind an opaque `secretRef`, including
  refresh, revocation, serialization of refresh races, and log redaction;
- upstream MCP client lifecycle for HTTP and, only if explicitly admitted,
  sandboxed stdio servers;
- stable tool namespace/versioning, descriptor review, collision handling, and
  protection against upstream descriptions/schemas injecting arbitrary text
  into agent context;
- authorization on every `tools/call`, independent of any earlier `tools/list`;
- honest failure translation, time/size/rate bounds, circuit breaking, and
  metadata-only audit.

No part of those concerns is supplied by adding Gmail names to
`mcp-tools.json`.

## 3. The three readings of “registry”

| Reading | Concrete behavior | Strongest case for it | Strongest case against it | Blast radius | Verdict |
|---|---|---|---|---|---|
| **1 — Catalogue** | h2a knows `serverId`, label, transport, tool metadata, and where an agent could connect. No upstream traffic passes through h2a. | Lowest cost; no credential custody or shared runtime; useful metadata can be reused by a later broker. | It does not satisfy “reachable THROUGH h2a”: each agent still needs another connection and usually its own auth configuration. Exposing a global catalogue can also leak systems another principal has. | Low: metadata schema, provenance, admin lifecycle, disclosure policy. | Useful groundwork, not the requested outcome. |
| **2 — Proxy** | One MCP endpoint multiplexes `tools/list` and `tools/call` to several upstream MCP servers, using static/operator credentials. | Directly gives the one-connection UX and can be piloted locally for one owner. | It has no principled answer to “whose Gmail token?” A static credential silently turns one account into shared authorization. Central latency, outages, egress, schema churn, process isolation, and quotas also become h2a's problem. | Medium/high: transports, namespaces, upstream processes, backpressure, health, audit, shared outage domain. | Honest only as a deliberately single-owner convenience; not the production meaning. |
| **3 — Broker with identity** | Proxy behavior plus `principalSub → active connector account/grant → secretRef`, with server-side credential injection and per-tool authorization. | It is the only reading that supports several agents and several humans without sharing access or secrets. It matches the already-selected sentropic one-gateway direction. | Highest coordination and operational cost; touches IAM, consent, vaulting, grants, revocation, privacy, audit, and a contract-owned gateway. It can miss a one-week target if cross-owner calls are not made immediately. | High: all proxy concerns plus auth, secret custody, grant model, isolation, revocation, incident response, and cross-repo contract review. | **Recommended target.** Start with a narrow vertical slice, not a complete generic platform. |

The recommendation is not “build all of option 3 now.” It is “do not build an
option-2 shortcut whose state model prevents option 3.” One principal and one
provider may be the first deployed slice; the lookup must still be keyed by the
principal and the credential must still remain server-side.

## 4. Recommended broker boundary

```text
agent (one configured MCP endpoint)
  -> architect-ratified MCP ingress authenticates 39-auth sub
     -> establish effective tools for that sub
        catalogue ∩ active connector account ∩ grant ∩ reviewed tool allowlist
     -> re-authorize this tool call
        -> resolve opaque secretRef inside the executor
           -> invoke the selected upstream MCP server
              -> return a proven result OR an explicit error
```

Agent-key verification, if required for attribution, is a separate side check:

```text
agent key/signature -> authorship/audit provenance
39-auth sub + active grant -> authorization + credential selection
```

The second arrow must never be derived from the first.

### 4.1 Four sets/states that must not collapse

1. **`exists`** — the operator/architect catalogue of connector types and
   installed adapters.
2. **`connectedForPrincipal`** — connector accounts whose binding lookup
   successfully established an active relationship to this `sub`.
3. **`mayUse`** — the intersection of catalogue, active account, active grant,
   and the adapter's reviewed tool allowlist.
4. **`usableNow`** — current upstream health (`available`, `unavailable`, or
   `unknown`). Health is not authorization.

Agents discover only their **effective `mayUse` tools**. They do not receive
`exists`, another principal's connections, or a “not allowed” diff. Otherwise
the registry leaks the shape of systems they cannot access. A temporary outage
does not revoke authorization and must not silently remove an otherwise
permitted tool.

Internally, resolver APIs need a sum type equivalent to:

```ts
type Established<T> = { kind: 'established'; value: T; asOf: string };
type ResolutionFailure = {
  kind: 'failed';
  source: 'catalogue' | 'binding' | 'grant' | 'credential' | 'upstream';
  code: string;
  retryable: boolean;
  observedAt: string;
};
```

This is an internal semantic requirement, **not** a proposed gateway wire
schema. The sentropic architect owns the external MCP/error shape.

### 4.2 Discovery and call rules

- `tools/list` is projected only after catalogue, binding, and grant resolution
  return `established`. An established empty third-party set is valid; it means
  “we looked and this principal has no permitted third-party tools.” Existing
  permitted h2a/Track tools may still remain visible.
- The pilot uses a **code-reviewed, pinned descriptor snapshot** and an
  gateway-ratified stable namespace backed by h2a-reviewed descriptors. It does
  not blindly copy upstream tool names, descriptions, or schemas into agent
  context. Upstream text is untrusted content and upstream schema churn is not
  allowed to mutate the public surface between calls.
- `tools/call` resolves principal, active account, grant, and tool allowlist
  again. A cached tool list is never a grant. Revocation must fail the next call
  even inside an already-open MCP session.
- Credential material is resolved and injected after authorization, inside the
  server-side executor. It is absent from tool input schemas, arguments,
  results, model prompts, error text, and logs.
- Unauthorized or guessed names return a non-enumerating not-authorized/not-
  available error. They do not reveal whether that tool exists for somebody
  else.

The existing hosted wrapper's fixed allowlist and `isError` mapping are useful
patterns (`packages/h2a/src/runtime/mcp-http/hosted-mcp-server.ts:20-36`), not a
complete broker implementation.

## 5. Credential ownership and what changes for the owner

### 5.1 Default answer

- **Account/consent owner:** the human whose Gmail, Drive, ClickUp, or HubSpot
  account is accessed.
- **Credential custodian:** the server-side sentropic broker/vault, acting on
  that human's explicit grant.
- **Selection binding:** an active per-principal connector-account/grant record
  associates `principalSub` with an opaque account reference, scopes, state,
  and `secretRef`. The raw access/refresh token is not a catalogue field and is
  not returned by the resolver.
- **Agent:** receives only permitted descriptors and tool results. An agent key
  may prove who asked, but never chooses a credential or authorizes access.

The feed contract already draws the adjacent line: its
`H2APrincipalAgentBinding` is a no-secret sibling, not a
`ConnectorAccountEnrollment` with `accountRef`/`secretRefs`
(`docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md:196-215`),
and a future AccessGrant references that binding instead of folding it
(`:597-605`). Third-party credentials belong on the connector-account side of
that sentropic-owned seam, not in h2a identity records.

### 5.2 Owner migration

Today the owner uses these MCP servers under their own accounts. The broker does
not magically acquire those credentials.

For the first supported provider, the owner performs **one fresh OAuth consent
to the broker**. The pilot must not scrape tokens from Claude, Codex, Gemini,
plugin files, or existing MCP configs, and it must not silently import them.
Existing per-agent wiring stays in place until the owner verifies the broker;
then it is removed explicitly. The resulting steady state is one consent per
provider/account and one MCP endpoint per agent, rather than one consent/config
per agent.

Personal per-principal OAuth is the default because that is the account model
the owner uses now. A service account is not a fallback: it is an organization-
owned credential with a separately approved principal/workspace grant and a
larger blast radius. Team sharing and service accounts are open owner/architect
decisions, outside the first slice.

## 6. Upstream and resolver failure semantics

The EMPTY-AS-FACT rule applies at both discovery and business-result boundaries.

| Situation | Required outcome | Forbidden outcome |
|---|---|---|
| Catalogue/binding/grant source could not be read | Explicit resolver/MCP error naming the failing class. | Empty third-party tool set. |
| Lookup completed and found no active account/grant | Existing h2a tools plus a deliberately established empty third-party set. | Fallback to a demo/default account or another principal's tools. |
| Credential missing, revoked, or refresh failed | Authorization/credential error; next call remains fail-closed. | Ask the agent to supply the token; silently use a service/global account. |
| Upstream connect/DNS/timeout/non-2xx/protocol failure | Internal failure facts include a stable class such as `upstream_unavailable`, `upstream_timeout`, or `upstream_protocol_error`, an opaque connector ref, retryability, observation time, and correlation ID. The external MCP response is an explicit non-success; the sentropic architect owns its encoding. | A domain `[]`, `null`, success text, or disappearance from discovery. |
| Upstream returned a valid successful empty collection | Pass the empty collection through: the upstream call established it. | Replace it with cached/assumed data without a freshness marker. |
| Rate/quota exceeded | Explicit `rate_limited`, with `retryAfter` when known; limit per principal + provider. | Generic empty or indefinite retry loop. |

The broker can establish that a call succeeded and returned empty; it cannot
certify the provider's external truth. Its duty is narrower and checkable: it
must never invent emptiness.

The first increment has no federated “search all providers” call and therefore
no partial aggregate. Later aggregation must either fail as incomplete or
return explicit per-provider completeness/errors; it must never present a
partial union as complete. Cached data, if later approved, needs explicit
`stale`/`asOf` semantics rather than silent substitution.

Provider circuit breakers are isolated: Gmail being down must not erase Drive
tools or poison Drive calls. OAuth refresh is serialized per connector account
to avoid concurrent refresh/revocation races. Logs contain only opaque
principal/connector refs, tool ID, outcome, latency, and correlation ID by
default — never authorization headers, tool arguments, or results. “Read-only”
mail and files are still sensitive content.

## 7. Identity is not an address, and an instance is not the tenancy key

Three observed h2a failures directly constrain the registry:

1. **Name divergence.** The project-level h2a name can diverge from the
   host-native session title; the P1 plan records ambiguous lane routing from
   that defect (`docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md:166-168`).
2. **Unproved actor string.** The envelope validator checks only that
   `actor.instance` is a string (`packages/h2a/src/envelope.ts:109-138`). Local
   inbox put then validates that envelope shape and writes it, with no
   registration or signature check at that boundary
   (`packages/h2a/src/runtime/local-files/store.ts:1276-1289`). Shape is not
   proof of identity or authority.
3. **Root split.** Root resolution permits explicit flag, environment, or
   default roots (`packages/h2a/src/cli.ts:474-495`). The forensic study found
   that agents on different roots are mutually invisible even with a perfect
   instance string (`docs/superpowers/specs/2026-06-08-h2a-addressing-failures-and-plan.md:21-25`).

Therefore:

- the credential/tenancy key is the authenticated 39-auth `sub`, never
  `instance`, session title, display name, workspace path, or agent key;
- no connector-account lookup may accept an agent-supplied principal selector;
- if agent attribution is later required, verify its key separately and record
  it only as provenance/audit;
- an h2a bus address is `(rootRef, instance)`, never the bare instance. `rootRef`
  must be opaque outside the server; a filesystem root must not enter browser or
  agent-visible contracts;
- the cheapest broker slice avoids any callback to an agent inbox, so it does
  not depend on unresolved bus addressing. If a later feature needs such a
  callback, it resolves the canonical root plus live instance at use time and
  cross-checks the agent key without turning that key into authorization.

## 8. Relationship to the sentropic gateway and P1

This registry is a **step toward the sentropic MCP gateway**, not a second
production gateway inside standalone h2a and not a permanent local convenience.

The June framing already chose the target shape: one sentropic MCP endpoint,
39-auth login, per-user scoping, namespaced tools, and h2a as its first catalogue
entry (`docs/superpowers/specs/2026-06-03-h2a-mcp-tenancy-and-sentropic-gateway-framing.md:37-49`).
That is a target, not a shipped endpoint: the same framing records that no
sentropic MCP catalogue/gateway existed (`:27-28`), and the current P1 plan still
marks its gateway resolution step not started
(`docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md:70-81`).
The h2a broker-mode code is reusable evidence and possibly reusable substrate:
it proves DCR/OIDC ingress, `sub` propagation, root isolation, and session
pinning (`:82-104`). It does not give h2a unilateral ownership of sentropic's
catalogue, grants, or credential store.

The approved sessions P1 and the registry share one invariant — principal
authorization is separate from agent authorship — and may share gateway/auth
substrate. They do **not** share a binding type:

- P1 uses a no-secret principal↔agent public-key binding to scope session rows;
- third-party MCP uses a principal↔connector-account grant with a server-held
  secret reference to authorize provider calls.

The registry must not delay P1 steps 0–6 or get folded into the session feed's
acceptance (`docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md:70-85`).

The LLM gateway v1 wire is frozen by owner direction at `/v1/models`,
`/v1/messages`, and `/v1/chat/completions`. This study authorizes no route and
relies on no sentropic MCP endpoint being present. The MCP protocol and h2a's
host-side one-endpoint pattern may be reused, but target endpoint placement and
any addition or expansion of an HTTP-served MCP surface are wire evolution to
co-validate with the sentropic architect — not facts this h2a study can freeze.

## 9. Cheapest startable increment, then first owner-usable slice

### 9.1 H2a-controlled increment startable this week

Prepare one provider-specific adapter/catalogue candidate and conformance harness
without exposing it on a public tool surface. This is useful, mergeable gateway
input; it is not represented as live Gmail/Drive reachability.

**In scope**

- owner selects the candidate provider and two or three read-only operations;
- h2a records a pinned, reviewed descriptor snapshot using internal adapter IDs;
  the public namespace remains unset until the sentropic architect ratifies it;
- an adapter interface accepts a principal/grant decision and opaque credential
  handle, then calls a mock upstream;
- conformance cases prove successful empty versus resolver/upstream failure,
  revocation on the next call, no credential-bearing input/output/log shape,
  and rejection of unreviewed upstream descriptors;
- no real provider token, public tool, golden-contract change, HTTP route,
  sentropic-namespace change, or P1 dependency.

**Acceptance**

1. The candidate descriptor cannot change from an upstream `tools/list` response.
2. Established-no-grant, failed-grant-resolution, upstream-down, and successful-
   empty are four distinguishable test outcomes.
3. A revoked fake grant fails the next call despite a previously returned tool
   list.
4. Token/API-key/cookie-shaped fixtures appear in no public schema, result,
   error, or captured log.
5. The adapter can be attached to the future architect-owned resolver without
   changing its provider-call and failure semantics.

### 9.2 First owner-usable broker vertical slice — prerequisite-contingent

After the sentropic architect ratifies the gateway endpoint and contract, the
auth prerequisite is live, and an unassigned deployment/security owner has been
assigned and ratified the vault seam, build one non-generic end-to-end slice.
The slice is intentionally narrow, but its calendar is not asserted here.

**In scope**

- exactly one authenticated owner `sub`;
- exactly one owner-selected **credentialed OAuth** upstream. Gmail read-only is
  a useful default recommendation because it proves the hard credential seam;
  the owner chooses the provider and scopes;
- two or three code-reviewed, namespaced, read-only tools;
- a pinned descriptor snapshot, not dynamic wholesale import from upstream;
- one fresh OAuth enrollment producing a server-side `secretRef`;
- `mayUse` filtering at discovery and fresh authorization at every call;
- explicit down/timeout/revoked/rate-limit errors;
- the MCP protocol through the architect-ratified target endpoint; any route or
  HTTP-surface expansion is co-validated wire evolution;
- h2a contributes the adapter/conformance layer and reviewed catalogue metadata;
  sentropic remains ingress, identity, grant, and secret-binding authority.

**Out of scope**

- mutation tools, send/delete actions, or generic “expose every upstream tool”;
- service accounts, teams, several humans, delegation between principals, or
  cross-workspace sharing;
- arbitrary upstream URLs, commands, packages, or user-supplied stdio launch
  strings;
- a generic connector admin UI, automatic token migration, cross-provider
  search, result caching, or multi-provider partial aggregation;
- changes to `docs/contracts/golden/**`, the CLI verb contract, gateway LLM v1
  routes, `runtime/mirror/**`, `apps/focus/**`, or P1's feed contract.

**Acceptance**

1. The owner consents once to the selected provider.
2. Two separately configured agents pointing only at the same remote h2a/
   sentropic MCP endpoint see the same effective permitted third-party tools and
   can call them.
3. An authenticated but unbound principal retains whatever h2a/Track tools it is
   allowed, but sees no third-party registry tools after a successful empty
   binding/grant resolution.
4. Revoking the connector grant or credential causes the next call in an
   existing MCP session to fail closed.
5. Killing or timing out the upstream produces an explicit MCP error; no empty
   business result and no silent tool disappearance is observed.
6. Access tokens, refresh tokens, cookies, API keys, and OAuth client secrets
   occur in no agent-visible descriptor/schema, tool arguments, tool results,
   prompts, errors, or logs.
7. Existing h2a/Track tools and the P1 session feed behave unchanged.

Playwright would be technically cheaper, but it would dodge the load-bearing
credential question. It is therefore a poor first proof for a registry whose
stated examples start with Gmail and Drive.

### Go/no-go gate for the live slice

Before live code, the sentropic architect must ratify runtime placement, target
endpoint, namespace/versioning, and the effective-tool/error contract. The auth
lane must ratify the provider OAuth client and consent/refresh/revoke behavior.
The **unassigned deployment/security owner — owner to assign** must ratify the
vault and operations interface. Until then, the h2a lane may complete section
9.1, but must not ship a second identityless production proxy as a shortcut.

## 10. Decisions deliberately left open

| Open decision | Why it is not decided here | Decision owner |
|---|---|---|
| First provider, exact account, scopes, and two or three tools | This is owner value and disclosure consent, not an h2a implementation default. | **Owner** |
| Whether every agent bound to the owner may use a connector, or only explicitly granted agents | Principal tenancy is decided; the finer delegation policy is not. Any narrowing must be a principal-issued, server-side grant referencing an active agent binding; key verification proves control/authorship and never grants access by itself. | **Owner + sentropic architect** |
| Personal OAuth versus organization service accounts, and any team sharing | Service accounts and multi-human sharing change the credential owner and blast radius. | **Owner + sentropic architect**; review by **unassigned deployment/security owner — owner to assign** |
| Production runtime/repository and whether h2a broker code is reused, extracted, or only adapted | The prior framing explicitly left gateway location open; h2a cannot assign sentropic's runtime. | **Sentropic architect** |
| Exact MCP namespace, versioning, descriptor-change, pagination, and collision contract | These are public/frozen-surface choices and upstream names are untrusted/churnable. The `gmail__tool` style in this study is illustrative only. | **Sentropic architect**, co-validated by **h2a maintainer** |
| Exact external error/partial-result wire shape and whether the expanded MCP surface is a wire evolution | Internal honest semantics are required; their external encoding belongs to the gateway contract. | **Sentropic architect** |
| Catalogue `exists` visibility and administration | Global visibility can disclose another principal's systems. | **Sentropic architect**; review by **unassigned deployment/security owner — owner to assign** |
| Connector-account/AccessGrant schema and principal/workspace narrowing | The P1 plan assigns binding store and authz to sentropic; this study states required semantics only. | **Sentropic architect** |
| Provider OAuth client, redirect/consent ceremony, first-party session/audience rules, refresh and revoke | These are IAM decisions and provider integration contracts. | **39-auth/auth lane**; review by **unassigned deployment/security owner — owner to assign** |
| Vault backend, encryption/backup, secret rotation, egress allowlist, audit retention, incident response | No owner is identified in the examined h2a documents; inventing one would freeze somebody else's job. | **Unassigned deployment/security owner — the owner must assign** |
| Adapter isolation, HTTP/stdio lifecycle, descriptor pinning, time/size bounds, result/error mapping | These are h2a/provider execution concerns after the gateway contract is ratified. | **h2a maintainer**; review by **unassigned deployment/security owner — owner to assign** |
| Mutation tools and approval UX | Read-only does not imply low sensitivity; writes have a separate authorization and human-confirmation blast radius. | **Owner + sentropic architect + 39-auth/auth lane**; review by **unassigned deployment/security owner — owner to assign** |
| Cutover/removal of old per-agent connector configs | Automatic migration is explicitly rejected; timing follows successful owner validation. | **Owner** |

## 11. Reversibility, contrary case, and review status

### Reversibility and cost

The one-provider slice is reversible if the adapter, catalogue record, grant,
and secret are all independently removable. Rollback is: revoke the connector
grant and provider token, remove the adapter from the effective catalogue, and
leave the existing h2a/Track surface untouched. There is no data migration in
the proposed slice and no automatic deletion of old agent configs.

The full multi-provider broker is not a one-week build. Its costly commitments
are the grant schema, public namespace/wire behavior, vault/retention policy,
and production placement; those are precisely the parameters left with their
owners.

### Strongest case against the recommendation

A single-owner local proxy could deliver visible value faster, remain useful
offline, and reuse the owner's already-working local MCP configurations without
waiting for sentropic or auth lanes. If the target gateway cannot expose MCP
tools this week and the owner explicitly values speed over a non-duplicated
path, that option can win — but only as a named local convenience with one OS
trust boundary, no claim of multi-tenancy, no imported tokens in agent context,
and a removal date. The current owner direction instead favors the multi-tenant
sentropic gateway, so this study does not choose that shortcut.

### What would overturn the recommendation

- The owner explicitly changes direction back to permanent single-user local
  infrastructure.
- The sentropic architect determines that the target gateway cannot or should
  not speak MCP, and ratifies a different singular production endpoint.
- A provider contract makes server-side token custody impossible while still
  supporting the required agent use; the account model would need redesign.

### Pre-mortem

Six months later, this failed because a “temporary” local proxy became the
production broker; one operator credential quietly served several humans;
upstream descriptions flooded or injected agent context; revocation only
changed `tools/list` while old sessions kept calling; and provider outages were
reported as empty mail/file collections. The gates in this study attack those
failure modes directly: singular sentropic target, principal binding before the
first call, pinned descriptors, per-call authorization, server-side secrets,
and errors that cannot masquerade as empty facts.

### Review completeness

Two independent adversarial reviews were run against the cited base: a
security/tenancy lens and an operability/owner-value lens. They converged on the
broker target and the principal/credential/failure invariants. The security
review's strongest shortcut was a local single-owner proxy; the operability
review rejected that as a duplicate and recommended the singular gateway slice
adopted here.

An additional Claude Opus pass was attempted as the repository's
decision-presentation discipline requests, but the restricted sandbox could not
reach the model. Accordingly this remains a **STUDY recommendation**, not a
frozen cross-owner decision. The missing independent-model pass is not papered
over; the sentropic-architect, auth-lane, and assigned deployment/security
reviews named above remain required before implementation.

Presenter-interest disclosure: catalogue-only would have been the easiest and
lowest-risk artifact for the author, but it would not give the owner through-
h2a reachability. A local proxy would have been easiest to demonstrate in this
repository, but would optimize implementation convenience over the owner's
already-stated gateway direction. The recommended broker slice is harder for the
presenter and more dependent on coordination, but better preserves owner value,
credential integrity, and future multi-human isolation.
