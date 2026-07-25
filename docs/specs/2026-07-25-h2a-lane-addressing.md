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

A Claude transcript is an **append-only** JSONL. A rename appends a dedicated
**rename-event record** (`type: "custom-title"`) carrying the *new* title at the
**end**; the first 40 lines therefore carry the title as it was at session start,
permanently. The scan window is at the wrong end of the file.

> **Correction to an earlier draft of this spec.** It claimed `customTitle` is
> "stamped on nearly every record". That is **wrong**, and the wrong model is
> worth correcting because it hides the real failure: a title appears **only from
> a rename onward**, on rename-event records only. Measured 2026-07-25 —
> title-bearing records are **5.1%** of the motivating transcript (1087 of 21473)
> and **0.06%** of tail records across the whole corpus. This is precisely why
> main's head-40 read found **nothing at all** in 16 of 8078 transcripts: those
> conversations were renamed later than line 40. The fix is right; the stated
> reason was not.

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

- ⚠️ **`docs/specs/2026-07-20-CR_h2a-tmux-liveness-activatable.md:57`** —
  `- [[reflect_host_native]] (h2a reflects native host state)`.
  This is the **only** occurrence of the token anywhere, and it is referenced as
  an already-established standing rule while being defined nowhere.
  **But that file is UNTRACKED working-tree material** (`git ls-files` →
  *"Did you forget to 'git add'?"*), and `git grep reflect_host_native
  origin/main` returns **nothing**. So a reader of this spec on `main` cannot open
  the citation at all.
  **Therefore this spec does not rest the claim on that file.** The claim rests on
  the grep result, which is the stronger statement anyway:
  **on `origin/main` the reflect-host-native rule does not appear in the
  repository in any form.** The untracked file is noted only as evidence that the
  rule is *believed* to exist. Citing it as though it were readable would
  reproduce exactly the dangling-reference defect recorded in §3.3 for DEC-116.
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

**(a) The reflect-host-native rule is not in the repository at all.**
`[[reflect_host_native]]` is referenced as an already-established standing rule
and is **defined nowhere** — no DEC, no VOCABULARY entry. Its one occurrence is in
an **untracked** file, so on `origin/main` the rule has **zero** presence in
version control while five code sites silently depend on it. A rule in that state
is not "one rename away from being lost" — for anyone who has not got that
working-tree file, **it is already lost**. It should be promoted to a DEC or a
VOCABULARY entry independently of this spec.

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
re-read. The visible effect is that `h2a_discover_sessions(name: …)` starts
returning the lane a human would name, which is the entire point: it is the
lookup that returned `[]` for `auth`.

**Precise scope of the routing claim — narrowed 2026-07-25 after review.** An
earlier draft said *"no routing consumer is affected"*. That is **too strong** and
is corrected here, because a claim wider than its evidence is the defect class
this spec exists to document.

The display name **seeds the handle at mint**:
`live.ts:318` (`const name = input.name ?? hostName ?? label`) →
`deriveInstanceId({ host, label: name, uuid })` → `slugify(label)`. So changing
the reader changes **which handle gets minted** for a conversation that was
renamed *before* h2a first attached to it. That is a real, if narrow,
routing-visible effect, and it is **new with this fix**.

What does hold — and it is the load-bearing safety property — is that **an
existing inbox never moves**:

| | claim |
| --- | --- |
| **at mint** | the reader's output influences the minted handle. **Changed by this fix.** |
| **after mint** | the handle is frozen (`identity.ts:17-19`) and reclaim keys on `{host, providerSessionId, workspaceId}` (`live.ts`, `bindings.ts`) — **not** on the name. A rename is display-only and moves no mail. **Unchanged.** |

So the correct statement is: **no routing consumer is affected after mint**, and
no queued mail can be redirected by a rename.

**And the name↔handle invariant is already broken on `main`, before this PR.**
Measured on the live (main-built) bus 2026-07-25: `slugify(presence.name)` equals
the handle's label segment in only **34 of 39** live sessions. The **5**
violations:

```
name "pokemon"       -> handle label "pokemon-cards"  (codex:pokemon-cards:431e10ec4139, x3)
name "sentropic-app" -> handle label "sentropic"      (claude:sentropic:7f3b90716dc5)
name "cowork"        -> handle label "sentropic"      (claude:sentropic:8f2c1223e514)
```

Recorded because it matters for attribution: display name and minted handle
**already** diverge on `main`, so this PR is not the breakage — and anyone reading
a diverged pair later should not attribute it here. It also demonstrates the
after-mint property empirically: those five have diverged and their inboxes did
not move.

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

- `readers.ts` — tail-based Claude title read, last rename event wins;
  `readTailLines` added to the injectable `HostNameReaders`.
- `readers.ts` — **one title policy, shared with `h2a-runtime/src/restore.ts`**:
  a title is only honoured on a `type: "custom-title"` record. See §10.
- `readers.ts` — `createHostSessionNameRefresher()`: a memoized per-session
  resolver (the transcript path is resolved once; only the tail is re-read), with
  **negative caching + exponential backoff** on a lookup miss. See §10.
- `readers.ts` — titles are trimmed, whitespace-only rejected, and length-capped
  at `MAX_DISPLAY_NAME_CHARS`; the Codex index read is tail-bounded.
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
- **`InstanceDescriptor.displayName` staleness after a rename** — a real defect
  this fix makes reachable, deferred with an argument and a named follow-up in
  §10.5 (`descriptors.ts:542`, `live.ts:259-286`).
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

---

## 10. Review follow-ups (independent correctness leg, 2026-07-25)

The leg returned **GO** and validated the fix well past this PR's own evidence:
across **all 8078** local transcripts (largest **233 MB**, not the 46 MB this spec
originally cited), emulating main's head-40 reader against this one —
**0 regressions, 16 improvements** where main found no title and this reader finds
the real one, and **3 changed values** including the reported `39etc` → `auth`.
Cost **0.30 ms/call** on the 233 MB file against a 5000 ms heartbeat.

Five should-fix items. Four are closed in this branch; one is deferred with an
argument.

### 10.1 CLOSED — one title policy (was: two readers, two policies)

`h2a-runtime/src/restore.ts:187-200` requires `type === "custom-title"` and reads
the whole file; this reader accepted `customTitle` on any record and read only the
tail. **Resolved by adopting the stricter predicate**, so the two now agree by
construction.

Chosen on measurement, not taste: comparing both policies **on the same 64 KiB
window across all 8078 transcripts** gives **0 divergences**, and **0** of the 89
title-bearing records carried the field on any record type other than
`custom-title`. The tie-break is asymmetric risk — a **misread** produces a wrong
name and therefore wrong routing, while a **missed** read produces no name, which
§D1's keep-previous rule already absorbs safely.

Also corrected: this spec previously said *"Codex already did last-wins; Claude
was the outlier."* **`restore.ts` did last-wins too.** The outlier was
`readers.ts` specifically, not "Claude" as a host.

### 10.2 CLOSED — the tail window is validated, not assumed

Of the 8078 transcripts, **45 carry a title at all**, and **all 45** resolve from
the 64 KiB window: **0 missed, 0 wrong values**. (Independently, the review leg
found that of 2010 transcripts over 200 KiB, **zero** have a title deeper than
64 KiB.) The bound is therefore empirical rather than a guess — and the residual
risk, should it ever be exceeded, degrades to "no title" and is absorbed by
keep-previous.

### 10.3 CLOSED — negative caching for a transcript miss

`createHostSessionNameRefresher` memoized **only on success**, so a session whose
transcript never appears — exactly the RC-3 case above — re-walked
`~/.claude/projects` (**87 directories, 14345 files, 8.73 ms**) on **every
heartbeat, every 5 s, forever**, on a machine with a known OOM history. Now a miss
is cached with exponential backoff (`TRANSCRIPT_MISS_BACKOFF_MS` →
`TRANSCRIPT_MISS_BACKOFF_MAX_MS`), so a persistent miss costs a handful of walks
per hour instead of 720. A transcript appearing later is still picked up, bounded
by the current backoff.

### 10.4 CLOSED — nits

Whitespace-only titles were written verbatim (`"   "` is truthy, no trim); there
was no length cap, so an unbounded user-controlled title would land in every
peer's presence read (`isH2ASession` checks only `typeof`); and the Codex index
was read whole on every heartbeat with no bound on a monotonically growing file.
All three fixed. The cap **truncates rather than rejects**, so an over-long title
stays findable by the substring match `discover_sessions(name:)` performs.

### 10.5 DEFERRED, with an argument — `InstanceDescriptor.displayName` goes stale

**The defect is real and is recorded here so it is not lost:**

- `runtime/feed/descriptors.ts:542` —
  `const displayName = nonEmpty(registration?.name) ?? liveSessionName ?? workspaceLabel;`
  → prefers the **registration**.
- `runtime/feed/descriptors.ts:477` —
  `nonEmpty(session.name) ?? nonEmpty(registration?.name) ?? workspaceLabel`
  → prefers the **live session**.
- `runtime/identity/live.ts:259-286` (`ensureRegistered`) writes
  `registration.name` **only inside the `if (!existing)` branch**.

So after a rename, one feed payload carries the **new** title in `topicOrTitle`
and the **old** one in `displayName`. This fix makes that reachable rather than
causing it, and the feed is already merged.

**Why it is not fixed in this branch.** Both candidate fixes are contract acts,
not bug fixes:

1. **Invert `:542` to prefer the live session name.** One line — but it inverts a
   precedence the merged feed contract states explicitly
   (`2026-07-24-h2a-feed-contract-for-sentropic.md:65`: `displayName` is
   `registration.name` … *falling back to* the live session name). Changing a
   documented public precedence is exactly what §D2/§D3 are being held back for.
2. **Make `registration.name` track renames** in `ensureRegistered`. Arguably the
   *faithful* reading — the feed contract says the registration name is "set at
   mint or `/rename`", and it is frozen today only because **no `/rename` verb
   exists on the h2a side at all** (`grep` for `cmdRename`/`updateInstanceName`
   finds nothing). But this adds a durable-store write to the boot path and needs
   a registry update API, so it is not a one-liner either.

Either way it is a public-contract or durable-store change and belongs to its own
increment. **Named follow-up: `feed displayName must not outlive a rename` —
`descriptors.ts:542` + `live.ts:259-286`, with the two options above.**
