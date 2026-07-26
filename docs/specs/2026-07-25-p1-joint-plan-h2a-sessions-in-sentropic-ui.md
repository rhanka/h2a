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
| 2 | Nonce challenge + verify endpoint | auth | not started; **unblocked and cheaper than assumed** | 0 |
| 3 | Enrollment ceremony (agent side) + **re-enrollment of current keys** | h2a | not started | 2 |
| 4a | Push daemon (one-shot → opt-in live) | h2a | **MERGED** (#23), ships disarmed | — |
| 4b | Per-binding push keying + per-principal partition | h2a | not started | 0, 3, 5 |
| 5 | Gateway resolves `sub` → active bindings → scoped store | arch | not started | 0; **Lot 1** for an authenticated round-trip |
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
- **A disclosure trade-off, stated as what is actually sent.** Once armed, the daemon pushes — every
  15–30 s instead of once on demand — the instance registration, **subagent NHI bindings**, and the
  **raw presence records**. "Presence" is not the sanitized descriptor the browser sees. **The feed
  sanitizes at READ; the mirror does not sanitize at SEND.** So what comes to rest in the hosted root is,
  per record: the **working-directory path** (`launchContext.cwd`, a real filesystem path), the **full
  command line**, the **tmux session and pane**, and the **process id** — precisely the fields the feed
  contract exists to keep out of a browser, and which its opacity helper strips on the way out.
  The payload is **signed but not confidential**, so a mistyped target discloses all of that repeatedly to
  whatever host answers, while the local journal reports `ok`. Mitigations: the unit ships disarmed
  (kill-switch active, placeholder target) and documents verifying a single manual push before arming; the
  hosted read boundary allowlists what can leave again.
  **UPDATE 2026-07-25 — the send side is now mitigated, so the list above no longer describes what
  travels.** The mirror sanitizes before signing: `launchContext` (cwd, command line, tty, tmux), `pid`,
  `workspace.path`, `workspace.repo` and `file://` endpoint uris are withheld by an allowlist that fails
  the build when a new field is left unclassified. The paragraph is kept rather than rewritten because the
  consent it records was given against it, and because it still held for one case: a sender running a CLI
  older than the fix, since the INGEST boundary did not sanitize yet (section 9). What the owner is
  consenting to for an up-to-date sender is now the field list in the feed contract's "Send boundary"
  section — identity, liveness timestamps, a workspace **label**, and no paths.
  **UPDATE 2026-07-25 (b) — the ingest side is now mitigated too, so the "un-upgraded sender" carve-out
  in the sentence above is retired for records arriving from now on.** `runtime/mirror/ingest.ts` narrows
  every arriving record with **the same** `sanitize*ForMirror` functions, and the apply-callback types in
  `accept.ts` are the `H2AMirrored*` wire types, so a raw record cannot reach a store writer at all.
  Measured end-to-end through the real ingester rather than argued: a hand-built push carrying
  `workspace.path`, the full command line, tty, tmux session/pane, `pid`, `workspace.repo` and a `file://`
  endpoint is accepted **202** and lands **none** of them, while the workspace label, session identity,
  interests, `publicKeys` and `capabilities` survive. An un-upgraded sender is narrowed rather than
  refused — refusing would drop old agents off the hosted surface — and the 202 reports
  `narrowed: { records, fields }` so a stale sender is a number an operator can watch, not a silent repair.
  **Two things this does NOT do, and the owner should not read them as done:** it does nothing for records
  a pre-fix sender **already landed** (presence self-heals on the next beat; the append-only registry row
  does not), and the hosted **read** surface is still a passthrough (section 9).
  This is a disclosure-accuracy point, not a design objection: signed-not-confidential to a host the owner
  controls may be entirely fine. But the owner must consent to *paths, command lines, tmux coordinates and
  pids leaving the machine*, not to the word "metadata".
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

- **Free text is not content-checked — and the concern is DATA AT REST, not only rendering.** Revised
  2026-07-25: the earlier version of this item named four display fields (`displayName` /
  `workspaceLabel` / `topicOrTitle` / `host`) and framed the risk as *rendering*. Both were too narrow.
  The full transmitted, agent-settable, unchecked set is: presence `name`, `workspace.label`,
  `workspace.host`, `workspace.id`, `version.cli`, `version.skill`, and the element values of
  `interests.scopes[]` / `interests.negotiations[]` / `subscribedTopics[]`; registration `principal`,
  `conductor`, `agentUuid`, `name`, and the element values of `scopes[]` / `capabilities[]` /
  `declaredCapabilities[]` / `acceptedPolicies[]` / `publicKeys[]` / `roles[]`. All of it is
  agent-settable because `h2a_register_instance` accepts an **arbitrary object** (`handleRegisterInstance`
  checks `typeof === "object"` and nothing more; `store.registerInstance` checks nothing) and
  `h2a_session_open` copies `interests.scopes` verbatim from its caller. Two concrete consequences: a
  plain `h2a_session_open` with `interests: {scopes:["scope:/home/you/private/directory"]}` puts that
  path on the hosted disk with no privilege and no malformed record; and `conductor: "file:///home/you/…"`
  is how a `file://` URI still reaches the hosted store despite the endpoint scheme filter. The harm is a
  value coming to rest **on someone else's disk** — how a panel escapes it on the way out is an
  additional, separate concern. Free text cannot be allowlisted, so the mitigations are different in kind:
  length bounds + character-class normalisation on the h2a side, userinfo stripping and a query/fragment
  policy for URI-shaped fields, and the untrusted-rendering rule on the panel side. Disclosed by the
  feed's author, independently confirmed, and widened by adversarial review.
- **~~The mirror does not sanitize at send.~~ CLOSED on the send side (2026-07-25).** The fix took the
  **narrow-what-is-shipped** option: `runtime/mirror/sanitize.ts` gives every payload member a wire type
  built from a field plan that classifies **every** field of the source record, so `launchContext` (cwd,
  command line, resumeCommand, tty, tmux), `pid`, `workspace.path`, `workspace.repo` and `file://`
  endpoint uris no longer leave the machine. Three properties, each mutation-proved: an unclassified field
  cannot travel (the builder iterates the plan), a newly-added field **fails the build** until it is
  classified (`satisfies` over `keyof Required<Source>`), and the wire type cannot drift from its plan.
  Sanitizing happens before signing, so the signature still covers exactly what is transmitted, and the
  signing primitive, sequence fencing and accept-side verification are untouched. A denylist was measured
  rather than dismissed: it passes every hostile-value test and fails only the unclassified-field test —
  which is the whole failure mode. The disclosure in section 7 **no longer describes the fields that
  travel**; what a hosted store now receives is listed in the feed contract's "Send boundary" section.
  Two consequences worth reading there: `H2AWorkspaceRef.path` had to become optional (while it was
  required, `isH2ASession` made a path-free presence record unwritable — the required field was
  *compelling* the leak), and `capabilities` is transmitted deliberately because the receiving side's
  subagent ceiling and attestation right both read it off the mirrored row.

  **Amended after adversarial review (2026-07-25).** The first version of the fix was correct at the top
  level of each payload member and **incomplete one level down**, demonstrated end-to-end rather than
  argued: `interests` was classified `send`, so the plan copied the object by reference; `isInterests` is a
  two-field spot-check that does not reject extra keys, so `interests: {scopes, negotiations, lc:{tmux,
  cwd, pid}}` was well-formed by the receiver's own guard, was accepted **202**, and came to rest on the
  receiver's disk. The endpoints **element** type had the same shape (`Array.prototype.filter` passes the
  element through whole), and both mutations — a new field on `H2ASessionInterests`, a new field on the
  endpoints element — compiled with `tsc` exit 0 and travelled. Closed by giving each nested composite its
  own plan (`INTERESTS_PLAN`, `ENDPOINT_PLAN`), which makes the allowlist claim true as written and
  extends the compile-time ratchet downward. Also corrected in the same pass: the endpoint filter could
  **throw** on a stored registration whose `endpoints` was not an array (a fault the send boundary itself
  introduced, since the pre-fix builder never touched the field), and the comment justifying the absent
  guard cited a validator — `isH2AActorRegistration` — that is **never called on any production path**.
  Remaining, disclosed, and not closable by a field allowlist: the free-text element values in item 1
  above.
- **~~Still owed: the INGEST half of the same rule.~~ CLOSED for arriving records (2026-07-25).**
  `serve.ts` used to write whatever a *verified* sender handed it, so an agent running a CLI older than the
  send fix kept pushing raw records into the hosted root. `runtime/mirror/ingest.ts` now narrows every
  record-carrying member of the mirror body — `registrations`, `presence`, `subagents` — with **the same**
  `sanitize*ForMirror` functions, so there is one definition of what may cross the mirror boundary and both
  directions call it. A second, hand-maintained ingest allowlist was rejected precisely because the
  compile-time ratchet would then fire for the send copy only, and the two would drift.
  Made structural rather than remembered: the apply-callback types in `accept.ts` are the `H2AMirrored*`
  wire types, so no caller — `serve.ts` included — can be handed a raw record even by writing its callback
  carelessly. A second ratchet one level up (`INGEST_NARROWERS satisfies` a mapped type over the body's
  record-carrying members) fails the build if a **fourth payload member** is added without an ingest
  narrower; the field plans could not have caught that, since they classify fields within a type rather
  than members of the body. Verification order is unchanged and had to be: narrowing runs strictly after
  `verifyEnvelopeSignature` (narrowing first would alter the signed bytes) and after the `publicKeys`
  authorization filter, so it can never change an authorization outcome. The raw record therefore exists in
  the ingester's **process memory**; the claim made and tested is that no withheld field reaches **disk**.
  Also fixed here, because a boundary that dies is not a boundary: any authorized sender's **second beat**
  killed the ingester. `store.registerInstance` throws `Instance already registered`, the throw escaped the
  request handler as an uncaught exception terminating the process, and the sender got no response at all —
  measured, not read off the source. Made idempotent, and the same throw class from `registerSubagent`
  (four distinct errors, one matched by the existing filter) and `writePresence` contained as a 500 whose
  body carries no exception message, since those messages interpolate record content.
  **Still open, and the reason this is not the whole disclosure:** (a) **data already at rest** is
  untouched — presence self-heals on the next beat because `writePresence` overwrites the file, but the
  append-only registry row does **not**, since a known id is a no-op and `findInstance` returns the first
  match, so appending would not shadow it either; cleaning it is an operation on the hosted store; (b) the
  hosted **read** surface is still a full passthrough (`h2a_discover_sessions` returns `{...session}`; the
  feed builders are not wired into the hosted handlers — Part C step 5); (c) free text is unchanged, per
  item 1 above; (d) the `h2a remote send --json` operator bypass is unchanged.
- **Lane addressing defect.** The h2a name has diverged from the host-native title, so routing to a named
  lane is ambiguous: nothing is registered as `auth`, four live instances share one name, and two panes
  share a title. This is a bus-correctness defect, not a BR-39l feature; folding it into P1 would hide it.
