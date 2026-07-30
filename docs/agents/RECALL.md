# Wake recall — what a durable actor re-reads before its first action

WP11 · Memory & context. Owner-facing state: **not accepted** (no UAT).

This is not a summary of the project, and it is not a store. It is the shortest text
that stops a waking actor from redoing what has already been done, or from re-asserting
what has already been refuted.

## How to read it

1. Read it before your first action, after `COMMON.md` and your own `BRIEF-<you>.md`.
2. **Every entry names its locator.** Re-check the locator before you rely on the entry.
3. **An entry whose locator does not resolve is quarantined, not true.** Move it to
   QUARANTINE and say so. A recalled claim that cannot be re-verified is worse than no
   memory: it produces confident wrong action.
4. Each entry carries its rung on the enforceability ladder —
   `structural > test > spec line > habit`. The rung tells you how much the entry can
   carry. A `habit` entry is a lead, not a guarantee.
   **A rung is justified by what a guard actually pins, never by the guard's existence.**
   `conductor` measured the failure: a document claimed `structural` for the actor roster
   on the strength of `validateOrgManifest`, which pins neither the twelve actors, nor a
   unique conductor, nor the root scopes, nor the WP map. The roster was at `test` — and
   `test` was worth whatever its last falsification proved. See REC-16.
5. **A count over a shared, append-only artefact must name the state it was measured at**,
   or it cannot be reproduced. Twelve actors append to one `.track/events.jsonl`: it went
   from 669 to 725 events inside one session of this lane. "185 items" without "at 669
   events" is not a fact anyone can re-derive.
6. **Every entry names who measured it**, and says whether this lane re-measured it.
   A lesson relayed by another actor is worth recording; presenting it as this lane's own
   measurement is not. Entries marked *(relayed)* were not re-run here.
7. **Verify against `origin/main`, not against the shared checkout.** See INC-03: the
   tree's local `main` had diverged from `origin/main` by 3 local-only and 195 missing
   commits. Every locator below was re-checked against `origin/main` at `1906942`.

8. **Ask what REFUSES.** Counting is not refusing. Detecting is not refusing. Documenting is
   not refusing. Reviewing is not refusing. If no mechanism declines the forbidden thing,
   you have an intention, not a guarantee — say so, and expect it to be exceeded exactly
   when it matters.

## A property of this system, not a list of accidents

`conductor` named the shape after the third case and handed over the fifth, which was its
own: **a device named as a guarantee while carrying only the force of a convention.** Six
independent instances were measured inside a single night, 2026-07-29:

- the required gate, titled as covering the repo, excluding 73 test files — and its own
  guard passing 6/6 green on the mutation its title forbids (REC-02, REC-16);
- `org.h2a.yaml` asserting *only a ratified manifest is provisioned*, while provisioning
  granted `CONDUCTOR` with no signature and no key (REF-06);
- a three-step launch check named as verification, one step of which cannot distinguish
  *submitted* from *never arrived* (REC-17);
- an owner cap of twelve subcontractors, held by hand, reaching nineteen (REC-19);
- the conductor's hourly cadence, described as cron-carried, delivering three iterations of
  five (REC-20);
- **this file**, which nobody is forced to open (see "The surface this file does not cover").

Six is no longer a pattern. **Treat it as the system's default state, and carry the burden of
proof the other way: assume a named guarantee is a convention until you have found what
refuses.** The useful question is therefore not *is this guaranteed?* but **what refuses,
and when did it last refuse?** A device that has never refused anything has never been
tested — ask for the last refusal, with its date.

That this file is on the list is not modesty. A memory dossier that exempted itself from its
own test would be the worst specimen of the class it documents. Only its generated doctrine
table actually refuses: `--check` fails. The rest has conventional force.


Baseline for the journal counts below: `.track/events.jsonl` read from the shared tree at
**669 events**, verified with `track events-contains` to be a proper superset of the 667
events on `origin/main` (no fork).

---

## SETTLED DOCTRINE

Decided and recorded as a selected option in the journal. Rung: **structural** — the
question, selected option and its recorded summary are retrievable by the decision ULID.
`node scripts/generate-recall-doctrine.mjs` reads `.track/events.jsonl` and replaces only
the content bounded by the `DOCTRINE-PROJECTION:START` and `DOCTRINE-PROJECTION:END` HTML
comments below. `--check` fails when that bounded projection is stale.

The `selected option (journal)` column is always generated from the selected option id and
the latest `dossier.options[].summary`. An `editorial rule` is distinguished by a DOC id:
it is the preserved hand-written wording for that exact decision ULID, kept where it is
sharper than the raw summary. A row without such wording shows `—`; its cells are wholly
generated. Any legacy wording whose decision has no selection event is also generated
below the table as explicitly **not doctrine**, rather than silently dropped.

<!-- DOCTRINE-PROJECTION:START -->
| id | question | selected option (journal) | editorial rule (hand-written where sharper) | locator (decision ULID) | settled |
|---|---|---|---|---|---|
| DOC-01 | 3/6 — Quand plusieurs sessions correspondent, que fait H2A ? | `A` — Plusieurs candidats : h2a refuse et affiche la liste. | Several candidates match a target → **h2a refuses and prints the list**. It does not pick. | `01KY66FVKFFVKRDXY9PFGEF4RD` | 2026-07-28 |
| DOC-02 | 4/6 — Quelle preuve faut-il avant de dire « agent disponible » ? | `A` — Disponible = le pane tmux existe ET le processus de l'agent tourne ET il y a eu une activite MCP recente. | "Agent available" requires **three** facts together: the tmux pane exists, the agent process runs, and there was recent MCP activity. | `01KY66FW260Q5TV1DVR6ZPH891` | 2026-07-28 |
| DOC-03 | Sur quels espaces de noms resoudre une cible ? | `A` — Un nom est resolu contre le role H2A, le --name de la commande run, le nom natif de la CLI et le nom de session tmux, en une seule passe, et H2A montre lequel a matche. | A name resolves in **one pass** against four namespaces — h2a role, `run --name`, CLI-native name, tmux session name — and h2a shows which one matched. | `01KYNGMC6979YKMXV8MQQ8A16H` | 2026-07-28 |
| DOC-04 | Prefixe remote- sur les sessions tmux : que fait la resolution ? | `A` — H2A denude les prefixes connus (remote-, h2a-) avant de comparer, sans rien renommer. | Known prefixes (`remote-`, `h2a-`) are **stripped before comparison**; nothing is renamed. | `01KYNGMCB0Z7ESGYJKFVCTW8MH` | 2026-07-28 |
| DOC-05 | Un item clos sans validation humaine peut-il etre rouvert ? | `A` — done -> in-progress et cancelled -> in-progress redeviennent legales. L'evenement de reouverture porte son motif : cloture sans UAT owner, ou regression constatee. Rien n'est efface : c'est une transition de plus dans un journal append-only. | An item closed without human validation **can be reopened**: `done → in-progress` and `cancelled → in-progress` become legal, the reopening event carries its reason, nothing is erased. *Decided; implementation in flight on `fix/track-reopen-closed-item`, **not merged** into `origin/main` — so a WP percentage can still be wrong in its own favour. See REC-05.* | `01KYQ5RRN67190YMZ08EGGBSBT` | 2026-07-29 |
| DOC-06 | Modele d'acteurs durables : roles transverses et lanes de domaine | `A` — architect (WP6), conductor (WP4), harness (WP9), cyber (sans WP) ; coop (WP1-3), runtime (WP5,7), track (WP8), plugins (WP10), memory (WP11), portal (WP12), agents (WP13), gateway (WP14). Le conducteur definit le RACI sur avis de l'architecte. | Twelve durable actors: four transverse (`architect` WP6, `conductor` WP4, `harness` WP9, `cyber` no WP) and eight domain lanes (`coop` WP1-3, `runtime` WP5+7, `track` WP8, `plugins` WP10, `memory` WP11, `portal` WP12, `agents` WP13, `gateway` WP14). | `01KYQ89WANWD257Y3GCW7YM8BZ` | 2026-07-29 |

**Unprojected legacy rules — not doctrine.** They remain visible so a missing journal event cannot silently erase their phrasing; if the event arrives, the generator moves the rule into the table.

- `DOC-07` is not a doctrine row because `01KYQZXCEZJXYAJ04YB5YMEWK0` has no `decision.option-selected` event in this journal. Its preserved hand-written wording is: **Durable actor memory lives at the tracked path `docs/agents/`, and only the durable part.** `tmp/` stays ignored — the test runner writes `tmp/test-runtime` and worktrees live under `tmp/worktrees`, so un-ignoring it would version scratch. Tracked: `COMMON.md`, the twelve actor briefs, `RECALL.md`, `DELEGATION.md`, `launch.sh`. **Deliberately NOT tracked: per-task subcontract briefs** — they are written for one delegation and die with it, and versioning them would turn a working directory into a graveyard. The line is durability, not importance. Short-name aliases (`BRIEF-arch.md`, `BRIEF-cond.md`) were byte-identical copies of the canonical files and are not carried over: one file per actor, or the copies drift. Its locator resolves only in the shared tree's uncommitted journal — see REC-12.
<!-- DOCTRINE-PROJECTION:END -->

**An open decision contradicts a settled design, and it is filed against this WP.** The
track report carries D5 "Comment lancer le moteur natif H2A ?" with recommendation A —
*h2a owns the loop and runs it locally; sentropic stays a consumer.* That is the **inverse**
of constraint 1 of the governing STUDY: "**The session engine is sentropic's.** h2a does
not build its own loop runtime" (`docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md:24`,
settled 2026-07-13 and reconducted 2026-07-18 — verified here). The report attaches D5 to
WP11, so flagging it falls to this lane; the arbitration belongs to `architect` and the
owner. **Do not implement either side while both are on the table.** Raised by `agents`
(WP13); the contradiction is re-verified here.

**Under review, not doctrine:** PR 84 (`docs/governance/RACI.md`, `org.h2a.yaml`, plus a
test in the required gate) assigns accountability per act — for this file, A and R sit
with `memory`, all actors consulted. It is **a map, not an authorization**: every actor is
registered under role `AGENTS` and `h2a_conductor` returns null. Do not cite it as
settled until it merges.

---

## REFUTED

Tested and failed. Re-proposing one of these without new evidence is the single most
expensive mistake this repo makes.

| id | refuted claim | how it failed | rung |
|---|---|---|---|
| REF-01 | *The objective loop relaunches an idle agent.* | Six items were closed `DONE` on this claim; the owner observes it does not relaunch. Re-raised as `01KYQ5KHZG7QBGGE91CV7XYDG1`. **Diagnosed by `coop` 2026-07-29 *(relayed, not re-measured here)*: the three suspected links are all correct and nothing reaches them.** Two independent causes, each sufficient — (a) the `policy.autoTick` opt-in is **unwritable**: `isLoopAutoTickEligible` requires `=== true`, and neither `h2a loop create` nor the MCP `h2a_loop_create` schema (`additionalProperties: false`) has a field for it; 41 loops on disk, **0** with `autoTick: true`, so `listAutoTickLoops()` returns `[]` always. (b) The supervisor is **not deployed**: no process, systemd unit still a template, 0 executor heartbeats on 41 loops. | structural |
| REF-05 | *A capability recorded as delivered is reachable.* | The L1 supervisor is merged, and no user or agent can turn it on — see REF-01(a). **Delivered ≠ reachable ≠ deployed.** Before citing a capability, find the code path that switches it on. | structural |
| REF-02 | *A green suite is an owner acceptance.* | The six closures above each had a passing technical recipe and none had a UAT. Recorded in the dossier context of `01KYQ5RRN67190YMZ08EGGBSBT`. | structural (dossier) |
| REF-03 | *The local gateway can carry a Claude session **of the current family**.* | A `claude` session routed through the gateway dies on `API Error: 400 unsupported model: claude-opus-5` — `runtime` observed the 400 live. **The cause is a missing alias, not the nature of the gateway**, so this is repairable and the path is open: probed here, `GET localhost:3002/v1/models` returns 5 ids and neither `claude-opus-5` nor `claude-sonnet-5`. Earlier framing — "the gateway exposes GPT only" — was retracted by `conductor` as misleading, and correctly: an entry that says *impossible* closes a path that is merely unwired. Still open, narrowed: `gateway` states 7 `claude-*` aliases exist and that **none covers the current family**, which is the part that matters and which this lane's probe corroborates. The two accounts only reconcile if those aliases are routable but unlisted. **What would settle it:** `gateway` naming the 7, so anyone can attempt a routed call. Until then, cite the current-family gap, not an alias count. | the probe above (measured here); the 400 observed by `runtime` | structural for the current family; the alias count is **open** |
| REF-06 | *Only a ratified manifest is provisioned.* — asserted by `org.h2a.yaml` itself. | **FALSE.** `conductor` measured `h2a org provision` granting `CONDUCTOR` and two scopes on a witness registry with **no signature, no ratified envelope and no key**. On the real registry, `org diff` and `org provision` crash outright (`TypeError: r.roles is not iterable`, a legacy scalar-format line). **An authority boundary that does not exist is worse than an absent one, because it gets cited.** Fixed and re-falsified in `fe7a2836`, with the NO-GO recorded as `fail` in track rather than leaving a positive acceptance on refused work. | structural *(relayed by `conductor`, not re-run here)* |
| REF-04 | *A live PID proves an agent is working.* | One lane showed 1 s of CPU over 33 min. Liveness is CPU time, not the PID. Source: `COMMON.md`. | habit — git-ignored file. **Not re-measured by this memory.** |

---

## RECURRENT DEFECTS

| id | defect | evidence | rung |
|---|---|---|---|
| REC-01 | **A claim wider than its proof.** The repo's signature failure. "The tests pass" is true; "the code is covered" is not. | REC-02, REC-06, and the QUARANTINE section — which was produced by applying this rule to this memory's own initial content. | habit |
| REC-02 | **The required gate does not reach `h2a-runtime`.** On `origin/main`, `scripts/run-tests.mjs` gates two Node directories (`packages/h2a/test`, `packages/focus-interactive/test` → 202 files) plus exactly one Vitest suite (`packages/track` → 86 files). The **73** `.test.ts`/`.spec.ts` files under `packages/h2a-runtime/src` are never executed, and `.github/workflows/ci.yml` runs nothing else. Any statement of the form "the gate is green, therefore the runtime is covered" is false by construction. **A fix exists and is not merged** (`harness/test-gate-runtime` at `3d3c8d4`; also `fix/npm-test-runs-all-gates`) — so "it was fixed on 2026-07-29" is true of a branch and false of `main`. Verify the branch, not the claim. | `origin/main:scripts/run-tests.mjs` (`NODE_TEST_DIRS`, `VITEST_SUITES`), `origin/main:.github/workflows/ci.yml` | **structural** |
| REC-03 | **A problem is re-raised under new wording, so no mechanical check can find it.** 185 `item.created`, 185 distinct titles, **zero** exact duplicates — yet two items created on 2026-07-29 are explicitly titled `RECURRENCE — …`. Exact-match dedup is blind here; the only signal is a free-text prefix an author may or may not type. | `.track/events.jsonl` at 669 events | habit |
| REC-04 | **The journal cannot say which actor did anything.** All **669/669** events are signed `by: human:fabien.antoine@m4x.org`, including those an agent wrote. Provenance of a lesson, a closure or a cancellation is therefore unattributable. | `.track/events.jsonl`, field `by` | structural absence |
| REC-05 | **Track has no record type for three of the four things worth remembering.** The journal has 18 event types. Settled doctrine maps to `decision.created` + `decision.option-selected`. A refuted hypothesis, a recurrent defect and an incident map to nothing — they survive only as prose in a title or a dossier. DOC-05 would close the regression half of this, and is not merged. **Two of the three lessons this file records had nowhere to live but this file.** | 18 event types in `.track/events.jsonl`; `track --help` write surface | structural absence |
| REC-06 | **A documented guarantee narrower than its name — and the failure is silent.** `track workspace-id` returns `ws:4471ea0c…` in this repo, but the WP1-WP14 referential is filed under `ws:89c45cc3…` (measured: 2 items under the CLI's id, 119 under the referential's). The write **succeeds**, `track validate` says nothing, and `report` does not filter by workspace — so the item simply is not in the referential. Root cause, computed independently by `architect` and `conductor`: the id is `sha256(sorted root commits, comma-joined + newline + worktree name)`, and this repo has **two** root commits — `ce2f385` (h2a init) and `e195823` (`@sentropic/track` init, absorbed by a `git subtree add` on 2026-07-04); both verified present. **The workspace is fixed at CREATION only** — pass `--workspace ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d` on `item new`, `decision new`, `ingest`, and never call `track workspace-id` here. On the verbs that take an `itemId` (`item realize`, `accept criterion`, `accept run`, `item reparent`, …) the flag is accepted, exits 0, and is **silently ignored**: they inherit the item's workspace and cannot be misfiled. Verified here at `packages/track/src/cli/index.ts:662` — `setRealization` reads its positionals and never `flags.workspace`. Two general lessons, and they are why this entry is the most instructive in the file: "salted only by what travels with the repo" is durable under a move or a clone and **false under history absorption** — and h2a absorbed a repo in July; and **the broad formulation ("always pass --workspace") is more memorable than the exact one, so in a hand-written memory it is the broad one that survives** — which is this file's own failure mode. Drift fix belongs to `architect` (WP6); do not open a duplicate. | `git rev-list --max-parents=0`; `packages/track/src/cli/index.ts:662`; item counts per workspace. Raised by `conductor`, narrowed by `coop`, re-verified here. | **structural** |
| REC-07 | **No durable actor is addressable by its lane name.** Measured here: the registry holds **107** instances under **43** distinct names — 32 of them literally `h2a` — and **not one of the twelve lane names** (`memory`, `gateway`, `coop`, `runtime`, `track`, `plugins`, `portal`, `agents`, `architect`, `conductor`, `harness`, `cyber`) is registered. The only lane-shaped names in the registry belong to another project (`graphify-*`). Consequence, lived on 2026-07-29: `harness` could not tell the `gateway` lane it must merge first, and had to ask the conductor to relay; a consultation had already landed on an unrelated blocked third party this way. Worse than ambiguity: the registry carries **no field that discriminates one actor from another** — `name`, `roles` and `endpoints` are identical across the 32, and several still point at the repo's former path. Only the opaque instance id differs, so DOC-01's "refuse and list the candidates" has nothing to list. **Address by instance id, never by lane name.** This applies to this lane too — `run --name memory` did not put `memory` in the registry. | `h2a_discover_instances`; measured here | **structural** |
| REC-08 | **A dropped reason turns a failure into silence.** The wake sink returns a bare `skipped` where `requestLaunch` returns the detail, so cooldown, max-relaunches and no-fresh-tmux-session are indistinguishable after the fact. The repo's entire relaunch history is **one day** (2026-07-22): 5 wakes applied, **637 skipped**, none stamped by a supervisor. That is what kept the outage in REF-01 invisible for a week. *(relayed by `coop`, not re-measured here — locator `adapters.ts:717`)* | `.h2a` loop state; `adapters.ts:717` | structural |
| REC-09 | **A model id is probed, never guessed.** Reachable set, re-probed here 2026-07-29 via `GET localhost:3002/v1/models` — exactly 5 ids: `gpt-5.3-codex-spark`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`. Ask for the list or probe it; never infer an id from a nickname. For the gateway's Claude behaviour see REF-03, and note what happened to the two claims that travelled with this one: one was retracted as never measured (Q-05), the other as misleading. | the probe above, run in this lane | **structural** (a live probe) |
| REC-13 | **Never invoke the `h2a` CLI from a shell.** A PreToolUse hook blocks it; use the MCP tools. Confirmed observed by `conductor`. | the hook; observed | structural |
| REC-14 | **`h2a run` truncates a long prompt, silently, and it is the END that is lost.** Measured by `runtime`: 10 977 characters are truncated by both hosts, 9 830 pass whole. `gateway` lost the tail of **both** its subcontract briefs; `conductor` lost the tail of a review brief — which is exactly where the honesty rules were. **Consequence for anything you delegate: put the hard stops FIRST, keep the prompt short, and pass a long brief as a file.** Length is a measured constraint here, not a style preference. *(relayed by `runtime`, `gateway`, `conductor`; the sibling delivery defect was measured here — REC-10.)* | those lanes' measurements; REC-10 measured here | **structural** |
| REC-15 | **`gateway: required` is not refused on profile `codex` — it is silently downgraded to direct.** No error, no warning. Measured by `gateway`, which owns the routing, correcting an earlier claim of a *visible refusal* (Q-05). A silent downgrade is strictly worse than a refusal: the caller believes it is routed and is not. This lane saw the same shape from the other end — a launch requested with `gateway: auto` returned `gateway: "direct"`. **Never infer the routing from the request; read what the launch returned.** *(relayed by `gateway`; the downgrade on `required` was not re-measured here.)* | `gateway`'s measurement; this lane's launch result | structural |
| REC-16 | **A guard is worth what its last falsification proved, not what its title announces.** Stronger than "a guard that cannot fire manufactures assurance": a guard that *does* fire, on the mutations its author thought of, still says nothing about the ones they did not. Measured by `conductor` on its own work: the test `org-manifest-committed`, titled *every WP is owned by exactly one actor*, had been proven by mutation to catch document/manifest drift — then an adversarial third leg mutated **differently**, putting two contradictory lines inside table A (`WP1 → runtime` then `WP1 → coop`), and the test passed **6/6 green**. `Map.set` silently overwrote the first value, so the guard admitted precisely what its title forbids, and had been announced as proven. **Before trusting a guard, ask which mutations were replayed — and mutate the property in the guard's own title.** Fixed and re-falsified in `fe7a2836`. | `conductor`'s measurement and `fe7a2836` *(relayed, not re-run here)* | **test**, and only for the properties actually mutated |
| REC-17 | **Delegation through the launcher is not autonomous, and no single launch check is sufficient.** `track` measured **eleven** launches in one night and **zero** that worked without manual intervention. Three distinct delivery failures now exist: the prompt fragmented across N messages, the prompt never submitted, and — third, measured by `track` — the prompt delivered **before the TUI exists**, which leaves no trace in the composer at all. So an empty composer is ambiguous between *submitted* and *never arrived*, and a recall entry saying "check the composer" is **false by omission**. Verify all four together: composer at placeholder, a visible "Working", non-flat CPU on the **child** (`ps --ppid`), and the **last line** of the brief visible in the transcript. Budget a keystroke and a check per delegation. | `track`'s measurement of 11 launches *(relayed)*; two of the three modes reproduced here | **structural** |
| REC-18 | **The coordination channel fails under the load it exists to carry.** `h2a_inbox read` now returns **431 000 characters** — past the token ceiling, so the conductor cannot open its own inbox. There is no pagination and no filter. Measured the same night: `h2a_discover_instances` returns 70 609 characters, likewise unreadable in one call. The surface degrades precisely when twelve lanes make coordination matter most, and it degrades **silently** — the call succeeds, the reader just cannot receive it. **Consequence for this lane: any diffusion path that assumes an actor can read its inbox is unreliable, which is a second argument for putting standing rules in a replaying prompt rather than a message.** Not this lane's to fix — protocol and bus are `coop` (WP1-3). | `conductor`'s measurement; `discover_instances` measured here | **structural** |
| REC-19 | **A cap no mechanism refuses is not a cap, it is an intention — and it is exceeded exactly when it matters.** The owner set twelve parallel subcontractors on 2026-07-29 and made `conductor` accountable for it. `conductor` said at its first iteration that the cap was held **by hand** and that nothing would refuse a thirteenth. Three hours later: **19 alive**, seven of them appearing inside 22 minutes, at 322 node/codex processes and 34.7 GB resident with 17 GB free of 57 — on a machine that has already taken OOM kills. It could not prevent it, could not attribute it (presence carries no launch name — REC-07), and could not detect it before the next iteration. **What would falsify this entry: a launch the tool refuses past the threshold.** The guarantee stops at counting. | `conductor`'s measurement *(relayed)*; this lane returned its own subcontractor's 265 MB on request and did not replace it | **habit** — and named as one |
| REC-20 | **No supervisory beat is guaranteed, so nothing may depend on one arriving.** `conductor` withdrew its own claim that its hourly iteration is cron-carried and "fires as soon as I stop": over five hours the cron delivered **three iterations of five**, and the 03:07 slot was missed while it had been idle since 02:43 — so neither the periodicity nor the explanation held. The cron is intra-session, not persisted, and fires on conditions it does not control and had not measured. The cadence is **real but irregular**. **Consequence: a subcontractor cannot count on "the conductor will come by within the hour", which is why its start-up text must be self-sufficient rather than a pointer** (`DELEGATION.md`). And a cadence recorded as running while nothing executes it is the same family as `autoTick: false` (REF-01). | `conductor`'s measurement of its own cadence *(relayed)* | **habit** — and named as one |
| REC-10 | **`state: "started"` is not proof that a subcontractor received its brief.** Reproduced here on the installed 0.88.0, both failure modes from one mechanism: the prompt is typed into the pane without a submit, so a **multi-line** prompt self-submits on its own newlines and arrives as N separate messages (the agent starts acting on fragment 1), while a **single-line** prompt is never submitted at all — 0 s CPU, prompt sitting in the box, launch still reported `started`. **Always brief a subcontractor from a file** with a one-line launch prompt, then verify: CPU time > 0 on the child process and a visible working indicator. Liveness is CPU, not the PID (REF-04). A fix already exists — `fix/h2a-run-prompt-delivery` (`bf641f2d`) adds `pasteLiteralBlock`, `submitPane`, CPU probing and a `submitted-idle` state — authored by the `runtime` lane and **not merged**. Do not re-diagnose this; do not open a duplicate of item `01KYNVJ9SNN7HG43EWG0ZX5BVS`. | reproduced here; `origin/main..fix/h2a-run-prompt-delivery` | **structural** (fix unmerged) |
| REC-11 | **Two unmerged fixes have a merge order, and getting it wrong hides 559 lines of tests.** The prompt-delivery fix above ships its tests in `packages/h2a-runtime/src/{prompt-delivery,proc-cpu,tmux}.test.ts` — precisely the directory the required gate never runs (REC-02). So `harness/test-gate-runtime` must merge **before or with** `fix/h2a-run-prompt-delivery`, or the launch fix lands with its entire test suite invisible to CI. Generalise it: **a fix whose tests live outside the gate is unguarded no matter how well tested it looks.** Check where a fix's tests live before trusting them. | `git diff --stat origin/main...fix/h2a-run-prompt-delivery`; `scripts/run-tests.mjs` | **structural** |
| REC-12 | **Tonight's entire record is unversioned, so every id cited tonight dangles.** Measured 2026-07-29 22:5x: `.track/events.jsonl` in the shared tree holds **785** events of which **264 are uncommitted** relative to its own HEAD — 78 `item.created`, 22 `decision.created`, 27 `blocker.opened`, 26 realization transitions. `origin/main` carries 667. So the twelve lanes' whole evening — items, decisions, acceptance criteria — exists in one working directory, and one `git checkout -- .track` erases it. Every item and decision ULID quoted tonight in a message, a committed document or a PR body **does not resolve for anyone else**, including DOC-07 above, which this lane wrote and cited in the same hour. This is the "citation to an uncommitted artefact" defect, one level up: not one dangling citation, but the evening's entire evidence base. **Before citing an id, check it is in `origin/main`'s journal, not just in the tree you are standing in.** Found because a subcontractor refused to project DOC-07 rather than manufacture its evidence — the return gate working in the opposite direction. **Two counts, both correct, and this is rule 5 in action:** 264 relative to the shared HEAD (521), and `conductor`'s 151 relative to `origin/main` (667, tree at 818). Neither is "the right number" — a count without its reference point is not a fact. **Resolved by `conductor` in PR 91**, after verifying pure-append against `origin/main` and an unbroken chain over 818 events; the designated-writer question stays open. | `git show HEAD:.track/events.jsonl` vs `.track/events.jsonl`; measured here | **structural** |

---

## INCIDENTS

| id | incident | evidence |
|---|---|---|
| INC-01 | **The twelve actors' wake memory lives in a git-ignored directory.** `.gitignore` matches `tmp/`, and `tmp/agents/launch.sh` hard-codes `tmp/agents/BRIEF-$agent.md`; `git log --all -- tmp/agents` is empty. The initial memory of every actor survives neither a clone, nor a worktree, nor a `tmp/` cleanup. This file exists in `docs/` for that reason. | `.gitignore`, `tmp/agents/launch.sh`, git log |
| INC-02 | **Nine cancellations, none carrying a reason field.** At least one — the tmux status surface — described word for word a still-active request, and drove decision DOC-05. | 9 `realization.transition → cancelled` events |
| INC-03 | **Twelve actors share one checkout, and nothing warns them.** Measured 2026-07-29: this lane switched `/home/antoinefa/src/h2a` from `main` to a feature branch while `conductor` was working in it; `conductor` found out only by checking before committing, and a commit at that moment would have landed its delivery in this lane's PR. Measured the same day: the shared tree's local `main` had **diverged** from `origin/main` — 3 local-only commits, 195 missing — so work based on the tree's `main` is based on a phantom baseline, as this lane's own first commit was. **Check `git branch --show-current` before any commit, and deliver from an isolated worktree based on `origin/main`.** | this session; `git rev-list --left-right --count main...origin/main`; traced as item `01KYQXJ13H5ZEMK2KX86YVF7RC` |

---

## QUARANTINE — claims that circulate and did not reproduce

These were handed to this lane as memory. Each was checked against the artefact it cites
and **did not reproduce**. They are listed so nobody re-asserts them, and so nobody
mistakes this list for a refutation of the underlying concern.

| id | claim | check | result |
|---|---|---|---|
| Q-01 | "The same five items were recreated twice, two days running." | 185 `item.created`, 185 distinct titles, 0 duplicate titles. The only near-duplicates (Jaccard ≥ 0.45) are six intentional per-host siblings (`Codex`/`OpenCode`/`Hermes`/`agy`, same day) and one theme rename (`WP-D Governance` → `Governance & RACI`). | **not reproducible.** The real, narrower defect is REC-03. |
| Q-02 | "The journal forked at the same event." | 669 events: `prevHash` chain continuous, zero chain break, zero duplicate `prevHash`. `track events-contains` confirms the working journal is a proper superset of `origin/main`'s 667. | **not reproducible.** No locator was given; may have concerned a copy since discarded. |
| Q-03 | "`--rebase` broke tag `v0.86.0` (`506e976` → `c3b78d3`)." | `v0.86.0` → `2605e808`. `506e976` exists; `c3b78d3` is not a valid object. | **not reproducible as stated.** The merge policy in `COMMON.md` stands on its own; this particular proof does not. |
| Q-04 | "1138 runtime tests are outside the gate." | The **exclusion** is verified and structural (REC-02); the figure 1138 was never measured. The real number now exists and is different: `harness` measured **2 818 gated out of 4 341** — the required gate saw **65 %** of the tests — with a falsifiable artefact (4 deliberate mutations, 4 named reds; criterion `01KYQY9TYVPQX520MGJZNS0PRA`, evidence `01KYQY9V3BA5PZYXDBKGGGRJ8K`, commit `3d3c8d4`). *(relayed, not re-measured here.)* | **claim replaced.** Cite 2 818/4 341 and its artefact, never 1138. Every "CI green" statement made in this repo before 2026-07-29 — including release 0.88.0 — covered 65 % of the tests: the figure was true, its scope was not. |
| Q-05 | "Gateway `required` is refused on profile `codex`." | Diffused to eleven lanes as a *measured* trap on 2026-07-29, then retracted by `conductor` the same evening: it was read in the `h2a-run` skill documentation and labelled a measurement. `gateway`, which owns the routing, answers **not verified — do not cite me on this.** | **refuted, and in the more dangerous direction — see REC-15.** `gateway` then measured the real behaviour: `required` is not refused on `codex`, it is **silently downgraded to direct**. So the original claim was not merely unmeasured, it described a visible failure where the truth is a mute one. Kept here because the claim reached eleven lanes and needs somewhere to die: anyone who remembers "it will be refused" will trust a routing that never happened. |

---

## The surface this file does not cover

`plugins` found the thing this lane had missed, and it is not a store. It put its standing
instruction **in its cron prompt** rather than in working memory, with the reason: *the
prompt that replays is the only thing that survives my own forgetting.*

That names a second surface. This file is what an actor re-reads **if it remembers to**. A
replaying prompt is what an actor re-reads **without meaning to** — it has none of a
document's properties (no projection, no falsification, no rung) but it has the one a
document lacks: nobody has to decide to open it. **A perfect `RECALL.md` that an actor
forgets to open is worth less than one line in a prompt that replays.**

The two are not rivals and neither replaces the other: doctrine has to be projectable and
falsifiable, which a prompt cannot be; arrival has to be involuntary, which a document cannot
be. `DELEGATION.md`'s thirteen lines are already in the second family — the cron prompt is
the version of them that survives context compaction. Mapping that surface properly is this
lane's next design question, and it is not answered here.

## Where this contract stops

This file is prose, maintained by hand. Nothing forces an entry to be written when a
doctrine is settled, and nothing re-checks the locators. It sits one rung above the
briefs for two reasons only: it is committed, and every entry names the evidence that
would falsify it.

To go higher, one of two things has to happen, and neither is this lane acting alone:

- **Projection.** Generate the DOCTRINE section from the journal, so it cannot drift from
  `decision.option-selected`. Derivable today with no new record type.
- **Record types** for refuted / recurrent / incident, plus the DOC-05 reopening
  transition. That is track's write surface — WP8's lane, not WP11's. Traced, not taken.

Until then: an actor that reads this file knows what was settled and what was refuted. It
does **not** have a guarantee that everything settled or refuted since the last edit is
in here.
