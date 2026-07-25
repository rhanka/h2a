# P1 joint plan — see your own h2a sessions in the Sentropic web UI

Status: **awaiting owner GO.** Cross-checked by the sentropic architect lane; the auth lane answered
and corrected two premises. Nothing in P1 has been built against the hosted product; the two h2a-side
increments that were startable without a GO are done (one merged, one in review).

Companion documents:
- `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md` — the **ratified** h2a-side
  feed contract (descriptors, enrollment binding, pull API), plus its amendments.
- `sentropic/spec/SPEC_EVOL_CONNECTOR_ACCOUNT_WORKSPACE_EXPOSURE.md` — the sentropic-side exposure spec.

## 1. What the owner gets

Log into `sentropic.sent-tech.ca`, and see **your own h2a agent sessions** (llm-mesh, architect, geo, …)
**read-only**: names, workspace labels, liveness, timestamps. The same "what is running for me" view you
get from `claude remote`, but inside the Sentropic app.

**What P1 is not**: no interactive attach (no transcript, no input into a session from the browser) —
that is a separate, separately-gated capability and must not be assumed to fall out of this feed. No
multi-user sharing. Read-only, one principal: you.

## 2. Why this is not simply "turn the old thing back on"

The pre-existing mirror was a **one-shot June demo**, not a service:
- the local push never ran continuously (no daemon existed);
- the enrolled signing key is **stale** — current agents re-anchored to new keys, so a push today is
  rejected 401;
- hosted enrollment is off, and the surface it fed was a **claude.ai MCP connector**, not the Sentropic
  web app, which has **no h2a integration at all**.

So P1 builds the missing feed + binding + gateway + panel. The mirror's signed-envelope trust boundary is
reused unchanged.

## 3. Architecture (ratified seam)

```
local agents (.h2a presence + registry)
   │  [h2a] live per-principal push daemon (opt-in, 15–30 s)
   ▼
per-principal root partition
   │  [h2a] hosted read-only MCP tools (h2a_discover_instances / _sessions)
   ▼
[sentropic gateway] 39-auth sub → active bindings → scoped store
   ▼
[app/ui] read-only session panel (descriptors + liveness + asOf)
```

Two invariants the whole design rests on:

- **The tenancy key is the Sentropic principal (39-auth `sub`), never an agent key.** An agent key proves
  *authorship* of a push; it never proves *authorization* to appear in a principal's feed. Those are
  separate checks and stay structurally separate.
- **The panel must not upgrade anything the feed did not establish.** Three faces of one rule:
  partial staleness stays visible per session; `activitySource: 'heartbeat'` renders as "process alive,
  activity unproven" and never as idle/parked; and every free-text field is untrusted — escaped, never
  HTML-interpreted, never path-interpreted, never linkified.

## 4. Ownership

| Lane | Owns |
|---|---|
| **h2a** (this repo) | feed descriptors; the push daemon; the agent side of the enrollment ceremony; re-enrollment of current keys; the per-binding push keying |
| **arch** (sentropic architect) | the binding store/schema; the gateway/catalogue contract; the authz model; per-principal root partitioning; the exposure/UI contract |
| **auth** (39-auth lane) | the nonce challenge + verification endpoint; first-party session semantics; Lot 1 |
| **app/ui** | the in-app read-only panel |

Neither h2a nor arch touches the `sentropic` namespace unilaterally. Cross-repo changes take two
independent GO reviews with distinct framings.

## 5. Increments, in dependency order

| # | Step | Lane | State | Depends on |
|---|---|---|---|---|
| 0 | Binding store + schema | arch | **held for owner GO** — ready | owner GO |
| 1 | Feed descriptors | h2a | **built**, PR #22 open: architect GO in hand, code-quality leg running | — |
| 2 | Nonce challenge + verify endpoint | auth | not started; **unblocked and cheaper than assumed** | 0; and Lot 1 for an authenticated round-trip |
| 3 | Enrollment ceremony (agent side) + **re-enrollment of current keys** | h2a | not started | 2 |
| 4a | Push daemon (one-shot → opt-in live) | h2a | **MERGED** (#23), ships disarmed | — |
| 4b | Per-binding push keying + per-principal partition | h2a | not started | 0, 3, 5 |
| 5 | Gateway resolves `sub` → active bindings → scoped store | arch | not started | 0 |
| 6 | Read-only session panel | app/ui | not started | 5 |

**Step 3's definition of done is not "code exists"**: it is *current live agents re-enrolled and the feed
returning rows for them*. That is what actually kills today's stale-key 401, and it is easy to declare
finished without achieving.

## 6. Findings that shaped the plan (each one changed a decision)

1. **A credential proves who wrote something, never what may be written — and never what it may touch.**
   Step 4b routes writes by a `bindingId` in the URL path while the existing ingest check only proves the
   payload is *internally* self-consistent. Validated independently, agent A with a valid key and a valid
   signature could POST to principal B's path and land a write in B's partition — every individual check
   passing, the *composition* failing. **Blocking requirement on 4b**: the ingester must cross-verify that
   the signing key **is** the `agentPubKey` of the **active** binding named by the path, with a negative
   test (valid key + valid signature + someone else's bindingId ⇒ rejected, no write, not even partial).
   A `bindingId` in a URL is a routing key, never a bearer credential.
2. **Enrollment must require a first-party session, not any bearer.** "Post-login authenticated action"
   was ambiguous. If a bearer suffices, any relying party the owner ever consented to could mint a durable
   binding **for its own key** — escalating "read the owner's data" into "permanently be the owner's
   agent". Amended: an active first-party session plus a narrow explicit scope, unreachable by
   resource-indicator-bound tokens.
3. **"Already landed" is not "already works."** The audience-binding and MCP-resource-server lots are
   shipped, so the gateway can be spec-correct with no new auth surface — but the verify primitives
   **throw not-implemented** until **Lot 1** merges, and the flag defaults off. The challenge works; an
   authenticated round-trip does not. **Lot 1 is an explicit dependency of step 5**, stated here rather
   than discovered later.
4. **An empty collection on the wire is a factual claim, so it must be produced by code that established
   that fact.** A defaulted `[]` cannot be distinguished from an errored resolver, a silently-empty query,
   or a lookup never performed. Both the binding resolver and the feed now return empties from explicit
   named branches; in the feed an unread source **throws with the source named** instead of rendering
   "you have no agents".
5. **P1 is structurally uncoupled from tenant resolution, not merely sequenced ahead of it.** Scoping by
   `principalSub` and nothing else puts P1 outside that blast radius by construction: a surface that
   resolves no tenant cannot be wrong about tenant. **Hard rule: P1 never scopes by tenant — not even for
   display.** That is precisely the exception someone adds later for a nice UI label.
6. **A prerequisite that turned out not to exist was removed, out loud.** An owner-gated permission prompt
   was reported as blocking step 2. It was not: it blocked an unrelated instance whose *display title*
   merely resembled the auth lane's. Struck from this plan explicitly rather than deleted quietly.

## 7. What the owner is being asked to accept

- **A GO to build P1**, which unblocks step 0 (a schema change in the live product repo) and, at step 3,
  turns on hosted enrollment **for the owner's own principal only**.
- **A disclosure trade-off.** Once armed, the daemon pushes presence, registrations **and subagent NHI
  bindings** every 15–30 s instead of once on demand. The payload is **signed but not confidential**, so a
  mistyped URL discloses that metadata repeatedly to whatever host answers — while the local journal
  reports `ok`. Mitigation: verify a single manual push before arming, which the shipped unit documents
  and enforces by shipping disarmed (kill-switch active, placeholder target).
- **Nothing else.** No other owner action is on the critical path.

## 8. Gates

- P1 is **read-only**, single principal, and never scopes by tenant. Interactive attach is out of scope.
- The daemon stays **opt-in** and ships disarmed; arming is an owner act.
- Cross-repo changes: two independent GO reviews with distinct framings, and **a GO is a floor, not an
  obligation to merge** — nothing ships that we have since learned misreports itself.
- Any partial verification is reported **as partial**, naming what it did not cover.
- Multi-user fan-out stays behind sentropic's strict tenant-resolution prerequisite. P1 does not wait on
  it (see finding 5) and does not pre-empt it.

## 9. Tracked separately (deliberately not folded into P1)

- **Free-text display fields are not content-checked.** `displayName` / `workspaceLabel` / `topicOrTitle` /
  `host` are validated for non-emptiness only, so an agent can put a path or key material in its own
  label and have it rendered. Pre-existing, not an authz field, and free text cannot be allowlisted — so
  the mitigation is different in kind: length bounds + character-class normalisation on the h2a side, and
  the untrusted-rendering rule on the panel side. Disclosed by the feed's author and independently
  confirmed.
- **Lane addressing defect.** The h2a name has diverged from the host-native title, so routing to a named
  lane is ambiguous: nothing is registered as `auth`, four live instances share one name, and two panes
  share a title. This is a bus-correctness defect, not a BR-39l feature; folding it into P1 would hide it.
