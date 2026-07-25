# Spec: h2a lane addressing — presence display name divergence and unambiguous lane resolution

Date: 2026-07-25

Status: **D1 DECIDED + implemented in this branch. D2 and D3 DECIDED BY THE OWNER
2026-07-25 (after this branch was opened) and recorded here — their
IMPLEMENTATION IS A SEPARATE INCREMENT and is deliberately NOT in this branch:
they change a public contract and must not ride along with a bug fix.**

Decision provenance: D1 decided in this spec. **D2 (reuse `scope`) and D3 (list
and ask) were decided by the repository owner on 2026-07-25**, after the four
D2 options and the two D3 candidates below were put to them. §9 sketches what
those two decisions require of the next increment.

Motivating incident: an architecture consultation intended for the `auth` lane
landed in the inbox of an unrelated instance that was blocked on a credential
prompt, and sat there for hours. Two defects produced it from opposite
directions: the name/title divergence specified below, and a stored memory that
named a now-stale instance-id (§D5).

---

## 1. The measured defect

All measurements re-taken **2026-07-25, 08:38–08:50 UTC**, on the live bus
(root `/home/antoinefa/h2a-workspace/.h2a`), by reading presence and
`tmux list-panes` only. No session was restarted, renamed, or written to.

### 1.1 The reported numbers still hold

| Measurement | Reported | Re-verified 2026-07-25 |
| --- | --- | --- |
| `h2a_discover_sessions(name: "auth")` | `[]` | `{"sessions":[]}` — still zero |
| live panes whose pane **title** is `✳ auth` | 2 | 2 — `%1` and `%37` |
| `h2a_discover_sessions(name: "sentropic")` | 4 live | 4 live — 3× `sentropic` + 1× `sentropic-app` |

The crossed pairing reproduces exactly:

| pane | tmux session | pane title | `presence.name` | instance |
| --- | --- | --- | --- | --- |
| `%1` | `remote-sentropic` | `✳ auth` | `39etc` | `claude:39etc:1b40cf1ca6c8` |
| `%37` | `remote-auth` | `✳ auth` | `sentropic` | `claude:sentropic:cff455ad5eaf` |

So the lane a human calls `auth` is carried by **two** panes and reachable by
**zero** bus names, while the name `sentropic` reaches **four** instances —
three of which a human would call `auth`, `sentropic-chat`, and `conductor`.

### 1.2 Bus-wide scale (new measurement)

Comparing every live presence session (heartbeat < 90 s, DEC-051 freshness)
against its pane title:

- **39** live presence sessions
- **32** with a resolvable tmux pane title
- **19** where `presence.name` differs from the pane title

Of those 19, **10 rows (5 panes × 2 sessions)** have a pane title that is a
launcher-set *task sentence* (e.g. `Rendre l'UI radar-immobilier responsive sur
mobile et tablette`), not a human lane name. Those belong to the remote-CLI
registry's `@display_name` namespace, not to `H2ASession.name`; counting them as
this defect would inflate the number. Excluding them:

> **9 of 32 live sessions (28%) advertise a display name that disagrees with the
> short human lane name shown in their pane.**

Second, independent measurement — **display names shared by more than one live
session**:

```
sentropic × 3, pokemon × 3,
bprime-recette-steve30 × 2, bprime-residentiel-debug × 2,
graphify-3-4-foundation × 2, immo-proof-provenance-link × 2,
radar-immobilier × 2, ui-responsive-drawer × 2
```

**8 colliding groups.** Ambiguity on display names is structural, not
exceptional. This number governs §D2 — any option that requires unique display
names starts by breaking 8 live groups.

---

## 2. Root cause

Two independent bugs, both proven on live data, that compound. Either one alone
would produce a wrong name; together they make the name unfixable at runtime.

### RC-1 — the Claude name reader scans the wrong end of an append-only file

`packages/h2a/src/runtime/identity/readers.ts:225` reads the **first 40 lines**
of the transcript, and `:235` breaks on the **first** `customTitle` found:

```ts
  const lines = readers.readLines(transcriptPath, 40);
  …
      if (typeof obj.customTitle === "string" && obj.customTitle.length > 0) {
        customTitle = obj.customTitle;
        break; // prefer first customTitle found
      }
```

A Claude transcript is an **append-only** JSONL, and `customTitle` is stamped on
essentially every record. A rename therefore appends records carrying the *new*
title at the **end**; the first 40 lines carry the title as it was at session
start, permanently. The scan window is at the wrong end of the file.

Proof, on the live offender `%1` (presence name `39etc`, pane title `auth`):

- its server (pid 28889) has `CLAUDE_CODE_SESSION_ID=ea3d1634-a5e9-43de-ae84-7af9b8ba97d7`
- that transcript contains **1022** records `customTitle":"39etc"` then **65**
  records `customTitle":"auth"`
- the first-40-line window sees **only** `39etc`; the last record says `auth`
- `presence.name` = `39etc`; pane title = `auth`

Re-running the reader today, with the correct session id in hand, **still**
returns `39etc`. The reader is not merely stale — it is wrong by construction.

Note the internal inconsistency: `readCodexSessionName` (`readers.ts:259-260`)
already does last-match-wins for `thread_name`. Claude is the outlier.

### RC-2 — `presence.name` can never be refreshed after session open

`updatePresence`'s patch type (`packages/h2a/src/runtime/local-files/presence.ts:171-177`)
admits exactly five fields, and `name` is not among them:

```ts
  patch: {
    heartbeatAt?: string;
    state?: H2ASessionState;
    workStatus?: H2AWorkStatus;
    launchContext?: H2ALaunchContext;
    lastMcpActivityAt?: string;
  }
```

`SessionRegistry.touch` (`runtime/mcp/sessions.ts:176-196`) is the only
in-process heartbeat writer, and it can only patch through that type. The two
other presence rewriters — `keepaliveOnce` (`cli.ts:6024-6047`) and the mirror
re-stamp (`runtime/mirror/serve.ts:132-135`) — spread the existing object and so
preserve whatever name is already there.

**Consequence:** the display name is bound once, at `mcp-serve` boot, and is only
ever re-derived on reconnect. Fixing RC-1 alone would leave every mid-session
rename stale until the host reconnects — which, for long-lived panes, is hours
or days.

### RC-3 — silent fallback to the cwd basename manufactures the collisions (contributing; NOT fixed here)

`runtime/identity/live.ts:230`:

```ts
  const name = input.name ?? hostName ?? label;
```

where `label = labelFromCwd(cwd)` = the cwd basename (`live.ts:89-91`). When the
reader returns `undefined`, presence advertises the **directory name** as if it
were a human display name — indistinguishable, to any consumer, from a real one.

Proof, on the live offender `%37` (presence name `sentropic`, pane title `auth`):

- its server (pid 191767) has `CLAUDE_CODE_SESSION_ID=0f6c3a97-ffd1-480f-96f6-14c54fe3ab55`
- **no** `0f6c3a97-….jsonl` exists anywhere under `~/.claude/projects` — only a
  `~/.claude/session-env/0f6c3a97-…/` directory
- so `findClaudeTranscript` (`readers.ts:183-215`) returns `undefined`
- so the name falls back to the cwd basename `sentropic`
- and that is precisely one of the three colliding `sentropic` names

Two structural facts behind this: the env var is captured at server spawn and
frozen for the process lifetime, while the pane's *live* conversation can move to
a different id (resume / continue / clear); and `findClaudeTranscript`
deliberately has no fallback (`readers.ts:204-205`: *"We skip the fallback to
keep things simple and correct"*), so a missed id yields no name at all rather
than a best guess.

RC-3 is left open on purpose: distinguishing "this is my name" from "this is my
directory" requires a presence field (`nameSource`) whose only consumer would be
the disambiguation model still pending in §D2. Specifying it here and shipping it
with a bug fix would smuggle in part of that contract. See §D2 and §6.

---

## 3. The contract violated

### 3.1 The reflect-host-native rule

It is real in code and in convention, but — honest finding — it is **not recorded
as a DEC anywhere**. The citations that do exist:

- `docs/specs/2026-07-20-CR_h2a-tmux-liveness-activatable.md:57` —
  `- [[reflect_host_native]] (h2a reflects native host state)`.
  This is the **only** occurrence of the token in the entire repo. It is
  referenced as an already-established standing rule and defined nowhere.
- `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md:79` —
  `topicOrTitle` is `H2ASession.name` — *"the DEC-114 per-session mutable display
  name (host-native `customTitle`/`thread_name`, or `/rename`), falling back to
  `registration.name`, falling back to `workspace.label`."*
- `docs/specs/2026-06-27-h2a-unified-cli-syntax.md:100` —
  `| h2a rename | h2a rename | reflects host-native name |`
- `docs/specs/2026-06-28-h2a-command-mapping-v3-finalites.md:143` —
  `claude customTitle · codex thread_name`
- in code: `runtime/identity/live.ts:225-226` (*"WP-6: prefer the host-native
  session name (Claude customTitle / Codex thread_name) over the cwd label"*) and
  the reader contract at `runtime/identity/readers.ts:153-155`.
- `packages/h2a/src/session.ts:114-117` — `name` is *"the perennial agent's
  mutable display name … UX only — never a routing key (the `instance` handle
  is)."*

**Two things must be said plainly, because both are load-bearing and neither is
written down anywhere else.**

**(a) The reflect-host-native rule exists only as a citation.**
`[[reflect_host_native]]` is referenced as an already-established standing rule
and is **defined nowhere** — no DEC, no VOCABULARY entry, one single occurrence in
the entire repo. A rule that exists only as a citation is **one rename away from
being lost**: rename or delete that CR file and the only trace of the rule
disappears, while five code sites keep silently depending on it. It should be
promoted to a DEC or a VOCABULARY entry independently of this spec.

**(b) No document states that the title is surfaced at heartbeat.**
The code only ever did it at identity-resolve / session-open. So RC-2 is not a
regression against a written rule — it is a gap between the intended contract and
*both* the docs and the code. **§D1 of this spec is the first place that intent is
written down.** That is worth noticing on its own: the behaviour everyone assumed
was contractual had no contract, which is why it could be absent for as long as it
was without anyone's test going red.

### 3.2 The addressing rules that do exist

All of them live in `SKILL.md` prose plus code comments, **not** in the decision
log:

- `packages/h2a/skills/h2a/SKILL.md:313-318` — *"**Addressing is case-insensitive;
  the label is slugified** (0.40.0+). The handle is canonicalized as
  `lower(host):slugify(label)[:lower(uuid)]` … The canonical channel for a label
  is therefore `host:slugify(label)`, **not** the raw display case."*
- `SKILL.md:153` — *"**Resolve-before-send rule (0.59.0+):** Always resolve the
  peer to its LIVE full id … A bare `host:label` sent to an ambiguous target (>1
  live agent sharing that alias) or a phantom target … is now **REFUSED** …"*
- `SKILL.md:310` — *"**Resolution rule — discover, never grep** … To reach a peer
  by FRIENDLY NAME, filter on `name` … If several sessions match, list them and
  pick/ask."*
- `SKILL.md:304-309` — the bare `host:label` form is a **named mailbox/alias**,
  not a specific agent.
- `docs/superpowers/specs/2026-06-08-h2a-addressing-failures-and-plan.md:62-72` —
  WP-2's 4-way rule, and the still-**PARKED** irreversible: *"silently
  auto-ROUTING a bare alias to the single live uuid. It is a mail-interception
  primitive at an unauthenticated layer … and is data-irreversible."*
- implementation: `runtime/local-files/paths.ts:216-296` (`resolveRecipient`),
  whose invariant at `:187-188` reads *"this function NEVER changes the delivery
  destination. Auto-routing to a live uuid is an interception risk and is
  explicitly PARKED."*

### 3.3 Governance observations — FLAGGED, NOT FIXED HERE

Found while looking for the citations. These are **wider than this spec** and are
recorded as observations for the owner, deliberately **not** fixed in this branch:
back-filling a decision log is a governance act, not a bug fix, and doing it
silently inside a naming fix is precisely the smuggling this spec refuses
elsewhere.

1. `[[reflect_host_native]]` is cited as a standing rule but is defined nowhere —
   no DEC, no VOCABULARY entry, one single occurrence in the repo.
2. **DEC-116 is absent from `DECISIONS.md`** (the file goes DEC-115 → DEC-117)
   despite being cited as the identity/addressing anchor by `PLAN.md:33,43`, five
   specs, and five source files (`runtime/identity/resolver.ts:2`,
   `readers.ts:3`, `migration.ts:2,58`, `mirror/build.ts:9`).
3. Two specs cite **DEC-114** for "mutable display name"; DEC-114 is actually
   *"fix: fetchLatest 4s timeout silently broke every upgrade check"*
   (`DECISIONS.md:1996`). The citation is wrong — likely intended DEC-116.
4. There is **no DEC** for case-folding, handle slugification,
   resolve-before-send, or the bare-alias policy. All four are load-bearing and
   all four live outside the decision log — in `SKILL.md` prose and code comments
   only. Note that D3 has just **overruled one of them** (`SKILL.md:153`'s hard
   refuse), which means a public behaviour is being changed by amending a skill
   document, with no decision record to amend. That is the concrete cost of gap 4.

**Why this matters beyond bookkeeping:** the identity/addressing subsystem rests
on a decision (DEC-116) that cannot be read, cited by code that cannot be
audited against it. Every one of the four unrecorded rules above is exactly the
kind of rule this incident turned on. Recommend recording them — as their own
increment, by the owner, not here.

---

## 4. Decisions

### D1 — where the display name comes from, and when — **DECIDED, implemented**

Source precedence is **unchanged**: explicit `--name` > host-native title > cwd
basename. Two behavioural changes:

**D1a — the Claude reader takes the LAST `customTitle`, not the first.**
Implemented as a **tail read** (last 64 KiB by default), scanning backwards for
the newest `customTitle`. A head read is not merely wrong (RC-1) but expensive at
heartbeat cadence: the live `auth` transcript is **46 MB**, and the existing
`readLines` does a full `readFileSync` before slicing. `agentName` keeps
first-seen-wins semantics within the window — it is not user-mutable, so
last-wins would be meaningless for it. `aiTitle` remains never returned.
This also makes Claude consistent with Codex, which already does last-wins.

**D1b — the heartbeat re-derives the name and writes it when it changed.**
`updatePresence` accepts `name`; `SessionRegistry` accepts a per-session
display-name resolver, installed by the `mcp-serve` auto-open path, and
`touch()` calls it each heartbeat. Convergence bound: **one heartbeat interval.**

Behaviour at the edges, all specified and all tested:

| situation | behaviour |
| --- | --- |
| title changes mid-session | converges within one heartbeat; repeated renames converge to the last |
| explicit `--name` given | no resolver is installed — the operator's name is never overwritten |
| resolver returns `undefined` mid-session (transcript rotated/deleted) | **keep the previous name.** Never downgrade a real name back to the cwd basename. Refresh is monotonic in confidence. |
| resolver returns the same value | no write (the patch is omitted, not a no-op write) |
| resolver throws | swallowed; heartbeat still lands. A naming bug must never break liveness. |

**Explicitly NOT changed: the instance handle.** It is frozen at mint
(`identity.ts:17-19`, and `2026-05-30-agent-identity-fix.md:117` *"Freeze the
handle at mint (rename = display only, never moves the inbox)"*). A rename must
not move an inbox. This is what keeps D1 a bug fix rather than a contract change.

**Consequences.** `presence.name` becomes mutable *within* a session, where
before it was fixed per session. Any consumer that cached it per session must
re-read. Because it is documented UX-only and never a routing key
(`session.ts:114-117`), no routing consumer is affected — the address is the
handle, which does not move. The visible effect is that
`h2a_discover_sessions(name: …)` starts returning the lane a human would name,
which is the entire point: it is the lookup that returned `[]` for `auth`.

**Residual after D1.** D1 does **not** make `auth` unambiguous — it makes it
*findable*. After D1, `name: "auth"` returns **2** sessions instead of **0**.
Turning 2 into a correct single delivery is §D2/§D3, and is not shipped here.

### D2 — how a lane becomes addressable unambiguously — **DECIDED 2026-07-25 (owner): REUSE `scope`**

> **Decision.** No new "lane" concept. **`scope` IS the purpose key** and is what a
> lane resolves through. Chosen by the repository owner on 2026-07-25,
> **precisely because it is nearly free**: the mechanism already exists, it needs
> no new registry, no new contract, and no migration. This is Option C below.
> Options A and B are rejected; Option D's disambiguation survives as D3.
>
> **Implementation is a separate increment — see §9. Nothing about D2 is in this
> branch.**

#### D2 sequencing caveat — `scope` carries NO signal yet (measured)

This must be explicit here rather than discovered during implementation:

> **All 39 live sessions currently sit in `scope:default`.** The mechanism is
> built and **entirely unused**.

Two consequences that govern the order of work:

1. Adopting `scope` as the addressability key does **not** by itself make any
   lane unambiguous. Until scopes are actually populated, every live session
   shares one scope, so routing by scope is exactly as ambiguous as routing by
   name is today — 39-way rather than 3-way.
2. **Until scopes are populated, D3's list-and-ask is doing all of the work.**
   D3 is therefore not a fallback for D2; it is the load-bearing mechanism during
   the entire adoption period, and it must be shipped and correct on its own.

So the sequence is: D1 (this branch, makes names honest) → D3 (list-and-ask, does
the real work immediately) → D2 population (scope earns signal over time, and
narrows the candidate lists D3 produces). Shipping D2's key without a population
path would be a no-op that looks like a fix.

#### The four options, and why the owner picked C

Recorded so the reasoning survives the decision. No recommendation is asserted;
the owner's choice is marked.

**Option A — a uniqueness constraint on display names per workspace.**
Breaks 8 live groups today (§1.2), including `sentropic × 3` and `pokemon × 3` —
all legitimate: three concurrent agents on one project is the normal working
shape, not an error. Worse, it is **unenforceable**: the name mirrors a
host-native title that h2a does not own and cannot veto. h2a can *detect* a
collision; it can never *prevent* one. Viable only as a warning, never as an
invariant. **Rejected as an invariant** (§5).

**Option B — an explicit lane→instance binding, verified rather than guessed.**
A lane is a declared alias whose binding is stored and revalidated against live
presence on every use. Cost: a new registry, a declaration step, and a lifecycle
(who owns a lane, what a handover looks like, what happens when the holder dies).
Benefit: the only option that makes a lane a genuinely first-class addressable
thing while leaving display names free to collide. **Blocker:** this is close to
the bare-alias auto-route PARKED at
`2026-06-08-h2a-addressing-failures-and-plan.md:62-72` as *"a mail-interception
primitive at an unauthenticated layer."* A lane registry is arguably the
sanctioned form of that primitive, and it must inherit that interception analysis
before it ships. It cannot be adopted as a side effect of this spec.

**Option C — a distinct addressable "lane" concept, separate from display names.
← CHOSEN by the owner 2026-07-25.**
Note that **this already exists**: `scope` is already the sanctioned "reach a
peer by PURPOSE" key (`SKILL.md:310`), and today **all 39 live sessions sit in
`scope:default`** — the mechanism is built and entirely unused. Cheapest option
by a wide margin: no new concept, no new contract, no migration; just start
declaring scopes and route on them. Weakness, and the reason D3 is load-bearing:
scopes are self-declared and unverified, so nothing stops two agents claiming one
scope — Option C therefore does **not** remove the need for §D3, it only narrows
the candidate set once populated (see the sequencing caveat above).

**Option D — accept ambiguity; require disambiguation at send time.**
Status quo, plus honesty. Note that the *send* path is **already correct**:
`resolveRecipient` (`paths.ts:252-262`) refuses a bare alias with >1 live match
and returns the candidate list. The gap was never the send path; it was that
(i) discovery *by name* returned nothing at all, because of RC-1/RC-2, and
(ii) the skill tells agents to *"list them and pick/ask"* for a name match
(`SKILL.md:310`) while `inbox put` **hard-refuses** an ambiguous alias
(`SKILL.md:153`) — two different bars for the same hazard, reconciled in no
document. Cheapest and lowest-risk; costs one round-trip per ambiguous send.

**Outcome.** The owner took **C** as the addressability key and **D's
disambiguation** as its safety net, promoted to D3 below. **A** is rejected as an
invariant (unenforceable), **B** is rejected for now (it inherits the PARKED
interception analysis and costs a whole new registry for something C gives free).

This combination is what would have prevented the incident: with D1 making the
name honest, `auth` resolves to 2 named candidates, and D3 forces the sender to
choose rather than letting anything be auto-selected.

**None of D2 is implemented in this branch.** See §9.

### D3 — what a resolver must do when a name is ambiguous — **DECIDED 2026-07-25 (owner): LIST AND ASK**

> **Decision.** When more than one live session shares a display name, resolution
> returns the **candidates, with enough information to distinguish them**
> (workspace, pane, last activity), and **the caller chooses**. Decided by the
> repository owner on 2026-07-25.
>
> **Implementation is a separate increment — see §9. Nothing about D3 is in this
> branch.**

**Two things are rejected, both on the record so neither can return:**

1. **"Return the first match" is REJECTED.** That is the exact shape that produced
   the misroute. Resolution must never be settled by array order, by heartbeat
   recency, by "closest name", or by any other silent tiebreak.
2. **"Hard refuse" is REJECTED as the default.** This resolves the contradiction
   identified in §3.2: `SKILL.md:310` says *list them and pick/ask* while
   `SKILL.md:153` says an ambiguous alias is **REFUSED** with exit 1. The owner
   resolved it **in favour of `:310`** — so `SKILL.md:153`'s hard refuse **must
   give way** as the default behaviour for an ambiguous *name*.

Resolution therefore still produces a three-valued outcome —
`unique | none | ambiguous(candidates[])` — but the `ambiguous` arm is now
**actionable** (return the candidates) rather than **terminal** (refuse).

**Why list-and-ask is safe, and why that is the load-bearing property:** the
safety does not come from refusing, it comes from the fact that **nothing is ever
auto-selected**. The candidate list is inert data; a message is only sent once the
caller has picked a specific full id. That preserves the invariant at
`paths.ts:187-188` — resolution *never* changes a delivery destination — while
being usable for a human-driven consultation, which is the §D4 "confirm-first"
bar. A refusal and a candidate list are equally safe against misdelivery; the
candidate list is simply the one that lets the sender finish the job.

Note the interaction with §D2's sequencing caveat: because all 39 live sessions
currently share `scope:default`, **D3 is not a fallback — it is the whole
mechanism** until scopes are populated. It must be shipped and correct on its own
merits, not as a stopgap.

Already correct and to be preserved: `resolveRecipient` returns the candidate set
on >1 live match (`paths.ts:252-262`) and states the interception invariant
(`paths.ts:187-188`). The change D3 requires is at the *name* path and in the
skill wording, not in that invariant.

Known remaining first-match sites, from `2026-07-18-STUDY_h2a-named-session-addressing.md:358,414`:
`h2a loop agents` / attach / logs takes the first match across id, role, host and
remote-agent id, checking for neither multiplicity nor `remoteJobId`. These are
in scope for the D3 increment and are **not** touched here.

### D4 — identity assurance PROPORTIONATE TO USE — **GOVERNING RULE, preserved verbatim**

From the sentropic architect. Preserved verbatim because it is what stops this
fix from over-rotating:

> **identity assurance must be PROPORTIONATE TO USE** — confirm-first for a
> consultation (a wrong recipient costs one detectable message); domain-ownership
> confirmation before treating an answer as an authoritative input; and for
> **authorization** a declared identity is never sufficient, an active binding
> lookup instead (the same rule as authorship ≠ authorization). Three
> deliberately different bars.

Three bars, deliberately different:

| use | bar |
| --- | --- |
| consultation | confirm-first — a wrong recipient costs one detectable message |
| treating an answer as an authoritative input | domain-ownership confirmation |
| authorization | a declared identity is **never** sufficient — active binding lookup |

**How this constrains the fix.** D1 adds no ceremony whatsoever: it signs
nothing, attests nothing, challenges nothing. It makes the display name *honest*,
so that the cheapest bar — confirm-first — finally has something true to confirm
against. The incident was not an authentication failure; it was a failure of the
cheapest bar, because the name being confirmed was wrong.

**Binding consequence for §D2:** any option that would add a cryptographic step
to an ordinary consultation is **out of proportion and must be rejected on that
ground alone.** The fix must not turn every message into a cryptographic
ceremony.

### D5 — the stale-mapping hazard — **DECIDED (as a rule; no code here)**

The second half of the incident was a stored memory naming a now-stale
instance-id. **A recorded instance-id rots.** Therefore:

1. Resolution **MUST** consult live presence, freshness-filtered (DEC-051, 90 s),
   at the moment of use. A cached lane→instance mapping is a **hint, never an
   address**.
2. Any tooling that caches a lane→instance mapping **MUST revalidate before use**
   and **MUST fail closed** when revalidation misses — treat as unresolved and
   re-discover. It must never fall back to the cached value, which is exactly how
   a message reaches a dead or repurposed inbox.
3. Do not write a bare instance-id into durable memory, docs, or a spec. Record
   the **lane** plus the workspace, and re-resolve at use time. Where an id must
   be written, write it with its `startedAt`/`heartbeatAt` and an explicit note
   that it must be re-resolved.
4. Corollary of RC-3: wherever an instance-id is surfaced for a human to copy,
   surface its freshness beside it. An id without a heartbeat is a trap.

---

## 5. Rejected alternatives

| rejected | why |
| --- | --- |
| **Return the first match** on ambiguity | The incident's proximate mechanism. Rejected on the record (§D3) so it cannot return. |
| **Hard refuse** as the default on an ambiguous name (`SKILL.md:153`) | Rejected by the owner 2026-07-25 in favour of list-and-ask (`SKILL.md:310`). Equally safe against misdelivery, but it dead-ends the sender instead of letting them choose. Safety comes from nothing being auto-selected, not from refusing. (§D3) |
| **A new first-class "lane" concept** (D2 Option B, a verified lane→instance registry) | Rejected for now: `scope` already is the purpose key, so B buys a new registry, a declaration step and a lifecycle for something Option C gives free — and it inherits the PARKED mail-interception analysis at `2026-06-08…:62-72` before it could ship. |
| **Re-key the handle on rename** / slugify the current display name into the address | Would move an agent's inbox and lose queued mail. Contradicts the frozen-handle rule (`identity.ts:17-19`, `2026-05-30-agent-identity-fix.md:117`) and makes a rename a mail-redirection primitive. |
| **Read the tmux pane title as the name source** | Tempting — it is what the human sees — but wrong. The pane title is an OSC string *any* process in the pane can set: 10 of the 19 diverging rows are launcher-set task sentences, not names. It is terminal state, not host-native state. h2a must reflect `customTitle`/`thread_name`; the pane title merely *displays* them. **Corollary: `presence.name == pane title` is NOT the acceptance criterion** — for `%37` the correct outcome is the transcript title, which may still differ from the pane. |
| **Enforce display-name uniqueness** (Option A) as an invariant | Unenforceable — h2a does not own the title and cannot veto a rename. Breaks 8 live groups. Warning only. |
| **Read the whole transcript** to find the last title | 46 MB per heartbeat on the live session. Tail-read a bounded window instead. |
| **Refresh the name from the external prober** (`h2a keepalive`, `cli.ts:6024`) | Only covers sessions with a live tmux pane, and the prober may not be running at all. The refresh must live on the in-process heartbeat. |
| **Add `nameSource` to presence** in this PR | Correct idea, wrong PR: its only consumer is the §D2 disambiguation model. Shipping it with a bug fix would smuggle in part of a pending contract. Recommended as the first increment *after* D2 is chosen (§6). |
| **Make the reader guess the transcript** when the env session id misses (RC-3) | `findClaudeTranscript` deliberately refuses to guess (`readers.ts:204-205`). Picking "newest transcript matching cwd" would silently attach one pane's name to another pane's conversation — a new misroute class to fix a naming bug. Needs the owner. |

---

## 6. What is implemented in this branch, and what is not

**Implemented (D1 only):**

- `readers.ts` — tail-based Claude title read, last `customTitle` wins;
  `readTailLines` added to the injectable `HostNameReaders`.
- `readers.ts` — `createHostSessionNameRefresher()`: a memoized per-session
  resolver (the transcript path is resolved once; only the tail is re-read).
- `presence.ts` — `updatePresence` accepts `name`.
- `sessions.ts` — per-session display-name resolver; `touch()` re-derives and
  writes on change only.
- `live.ts` — `ResolvedLiveIdentity` additionally exposes `providerSessionId` so
  the refresher can be built.
- `cli.ts` / `stdio.ts` — wire the refresher for the `mcp-serve --auto-open`
  path, only when no explicit `--name` was given.

**Deliberately not implemented:**

- **D2** (`scope` as the addressability key) and **D3** (list-and-ask) — now
  DECIDED by the owner, but they change a public contract and must not ride along
  with a bug fix. They are the next increment; §9 sketches the wiring.
- **RC-3** (the cwd-basename fallback and the missing-transcript case) — needs
  `nameSource` and/or a guessing policy, both of which are D2 material.
- The `h2a loop agents` first-match selector — D3 increment.
- The decision-log gaps in §3.3 — flagged as governance observations, wider than
  this spec. Not fixed here.
- Reconciling `SKILL.md:153` (hard refuse) with `SKILL.md:310` (list and ask) —
  D3 has now decided the direction (`:310` wins, `:153` gives way); the wording
  change itself is part of the D3 increment.

---

## 7. Test plan

Unit, on the reader (`readTailLines` + last-title semantics):

1. last `customTitle` wins over an earlier one (the RC-1 regression, red before
   the fix)
2. `customTitle` still wins over `agentName` regardless of order
3. `agentName` fallback when no `customTitle` anywhere
4. `aiTitle` never returned
5. a title beyond the old 40-line window is found (the RC-1 shape, with >40
   records before the rename)
6. a title beyond the tail window is not found → `undefined`, and D1's
   keep-previous rule then protects the name
7. tail read on a file smaller than the window returns all lines, with no
   truncated leading record
8. a truncated first line in the tail window is discarded, not mis-parsed
9. Codex last-match-wins unchanged (guard against regressing the consistent side)

Unit, on the refresh path:

10. `updatePresence({ name })` writes the new name and preserves every other field
11. `updatePresence` unknown-state / unknown-workStatus validation unchanged
12. `touch()` writes the new name when the resolver's value changed
13. `touch()` omits `name` from the patch when the value is unchanged
14. `touch()` keeps the previous name when the resolver returns `undefined`
15. `touch()` keeps the previous name when the resolver throws, and still advances
    `heartbeatAt`
16. no resolver installed (explicit `--name`) → the name is never touched

Integration:

17. presence written at open with the cwd-basename fallback, then the transcript
    gains a `customTitle`; after one `touch()` the name is the title and
    `discover_sessions(name: <title>)` finds it — the end-to-end shape of the
    measured defect, in a fixture. This closes the gap noted in the existing
    `wp6-host-session-name.test.js:218-253`, which fabricates the presence file
    by hand and so never covered the wiring.

Amended existing test: `wp6-host-session-name.test.js` test 4 asserts
first-`customTitle`-wins. That assertion **encodes RC-1** and is inverted, with
the justification recorded in the test file: the transcript is append-only, so
first = stale, and Codex already did last-wins.

Mutation proof: each new assertion must be shown red by reverting the specific
line it covers (head-read vs tail-read; `break` on first vs last; the `name` key
in the patch type; the change-detection guard; the keep-previous branch).

Non-goals for the tests: nothing asserts `presence.name == pane title` (§5), and
nothing asserts that `auth` becomes *unique* — after D1 it becomes *findable*
(2 candidates), and uniqueness is D2.

---

## 8. Acceptance

- `npx tsc -b packages/h2a` clean.
- Affected suites green, with an `origin/main` baseline in an equally-installed
  tree for any failure claimed pre-existing.
- On the live bus after the fix ships and hosts reconnect:
  `h2a_discover_sessions(name: "auth")` returns **2** sessions, not 0. Two is the
  correct post-D1 outcome; turning two into one delivery is D2+D3 (§9).
- No live session restarted, renamed, or written to by this work.

---

## 9. What the D2/D3 increment requires (sketch — NOT implemented here)

Written so the next increment is wiring rather than re-deciding. These are the
open design points, not settled answers; the two *decisions* are settled (§D2,
§D3), the shapes below are proposals for the increment to confirm.

### 9.1 What resolution returns for the ambiguous case

D3 needs the `ambiguous` arm to carry **enough to distinguish candidates without a
second round-trip**. The owner named the discriminators: workspace, pane, last
activity. Proposed shape, per candidate:

| field | why the caller needs it | source |
| --- | --- | --- |
| `instance` | the only thing safe to send to (full `host:label:uuid12`) | `H2ASession.instance` |
| `name` | what the human called it — now honest after D1 | `H2ASession.name` |
| `workspace.path` + `workspace.label` | separates two agents on different repos | `H2ASession.workspace` |
| `launchContext.tmux.pane` | separates two agents on the SAME repo — the `sentropic × 3` case | `H2ASession.launchContext` |
| `lastMcpActivityAt` + `heartbeatAt` | which one is actually working vs idle-but-live; also §D5's freshness-beside-the-id rule | presence |
| `scope` | once populated, the discriminator that removes the ambiguity entirely | `interests.scopes` |
| `connectionConfidence` | avoid steering the caller to an `idle-uncertain` peer | presence |

Two constraints on the shape: it must be **inert data** (§D3 — nothing
auto-selected), and it must not imply an ordering that reads as a
recommendation, or "first match" returns through the back door. Worth deciding in
the increment: whether to sort at all, and if so by what (activity recency is the
obvious candidate and also the most likely to be mistaken for a pick).

### 9.2 Where the caller-chooses step lives

Today the refusal happens deep, in `resolveRecipient` (`paths.ts:216-296`), behind
`reachGuard` — used by `inbox put` (`cli.ts:771,804`) and the MCP handlers
(`handlers.ts:206,240`). D3 does not change that function's invariant (it never
changes a destination); it changes what the **callers** do with an ambiguous
outcome. Open points:

- the *name* lookup (`handleDiscoverSessions`, `handlers.ts:792-829`) already
  returns the full set — it is arguably already D3-compliant, and the gap is that
  callers were not required to go through it. Confirm rather than rebuild.
- for an agent caller, the natural home is the tool result: an `ambiguous` outcome
  with candidates, which the agent must resolve before a send. For a human
  caller, the natural home is the CLI printing the table and exiting non-zero
  **without** having sent anything.
- `SKILL.md:153` must be rewritten to match (`:310` wins). Both copies —
  `packages/h2a/skills/h2a/SKILL.md` and `.claude/skills/h2a/SKILL.md` — drift
  independently today and must be changed together.

### 9.3 How `scope` gets populated

This is the part with no existing mechanism and therefore the real work.
`--scope` already flows through `resolveAutoOpen` → `sessions.open` →
`interests.scopes`, so the plumbing exists and only the *population* is missing.
Open points, all needing a decision in the increment:

- **who sets it.** At launch (`h2a run --scope …`, the launcher's job) is the
  cheapest and matches how these panes are already started per-purpose. Deriving
  it from the host-native title would be tempting after D1 — and should be
  resisted: it would re-couple the routing key to a mutable display string, which
  is what §5 rejects for the handle.
- **at launch or at rename.** If a scope may change mid-session, it needs the same
  heartbeat-refresh treatment D1 just built for the name, and the same
  keep-previous rule. If it is launch-only, it is immutable and simpler — but then
  a repurposed pane lies about its scope, which is exactly the class of bug this
  spec is about.
- **verification.** Scopes are self-declared (§D2 Option C weakness). Per §D4 this
  is *acceptable for a consultation* (confirm-first) and **not** acceptable as an
  authorization input — a declared scope must never be treated as authority.
  Record that boundary explicitly wherever scope routing is documented.

### 9.4 What happens to a session still in `scope:default`

The migration case, and the one most likely to be got wrong:

- `scope:default` must be treated as **"no scope declared"**, never as a real
  lane. A resolver must not consider two `scope:default` sessions to be in the
  same purpose group in any way that narrows a choice.
- routing by scope must therefore **fail open into D3** for default-scope
  sessions: return them as candidates, do not silently exclude them (a message
  that vanishes because a peer had not adopted a scope yet is worse than a
  candidate list).
- and it must not fail *closed* either: refusing to reach a default-scope session
  would make 100% of the current bus unreachable on day one.
- during adoption the candidate lists will be long. That is honest and expected;
  it is the visible cost of the sequencing in §D2, and it shrinks exactly as fast
  as scopes get populated.
