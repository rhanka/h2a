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

Baseline for the journal counts below: `.track/events.jsonl` read from the shared tree at
**669 events**, verified with `track events-contains` to be a proper superset of the 667
events on `origin/main` (no fork).

---

## SETTLED DOCTRINE

Decided and recorded as a selected option in the journal. Rung: **structural** — the
question, the chosen option and its rationale are all retrievable with
`track item show` / `track decision ls`, keyed by the ULID below. All six were confirmed
present on `origin/main` as `decision.created` + `decision.option-selected`. Do not
reopen these without a new decision.

| id | rule | locator (decision ULID) | settled |
|---|---|---|---|
| DOC-01 | Several candidates match a target → **h2a refuses and prints the list**. It does not pick. | `01KY66FVKFFVKRDXY9PFGEF4RD` | 2026-07-28 |
| DOC-02 | "Agent available" requires **three** facts together: the tmux pane exists, the agent process runs, and there was recent MCP activity. | `01KY66FW260Q5TV1DVR6ZPH891` | 2026-07-28 |
| DOC-03 | A name resolves in **one pass** against four namespaces — h2a role, `run --name`, CLI-native name, tmux session name — and h2a shows which one matched. | `01KYNGMC6979YKMXV8MQQ8A16H` | 2026-07-28 |
| DOC-04 | Known prefixes (`remote-`, `h2a-`) are **stripped before comparison**; nothing is renamed. | `01KYNGMCB0Z7ESGYJKFVCTW8MH` | 2026-07-28 |
| DOC-05 | An item closed without human validation **can be reopened**: `done → in-progress` and `cancelled → in-progress` become legal, the reopening event carries its reason, nothing is erased. *Decided; implementation in flight on `fix/track-reopen-closed-item`, **not merged** into `origin/main` — so a WP percentage can still be wrong in its own favour. See REC-05.* | `01KYQ5RRN67190YMZ08EGGBSBT` | 2026-07-29 |
| DOC-07 | **Durable actor memory lives at the tracked path `docs/agents/`.** `tmp/` stays ignored — the test runner writes `tmp/test-runtime` and worktrees live under `tmp/worktrees`, so un-ignoring it would version scratch. The briefs and `COMMON.md` join `RECALL.md` and `DELEGATION.md` there. **Constraint: the move and the launch-path repoint must land together** — a tracked copy that goes stale while `launch.sh` still reads the ignored one would look versioned and be wrong, which is worse than today. Sequencing is the conductor's to diffuse. | `01KYQZXCEZJXYAJ04YB5YMEWK0` | 2026-07-29 |
| DOC-06 | Twelve durable actors: four transverse (`architect` WP6, `conductor` WP4, `harness` WP9, `cyber` no WP) and eight domain lanes (`coop` WP1-3, `runtime` WP5+7, `track` WP8, `plugins` WP10, `memory` WP11, `portal` WP12, `agents` WP13, `gateway` WP14). | `01KYQ89WANWD257Y3GCW7YM8BZ` | 2026-07-29 |

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
| REF-03 | *The local gateway can carry a Claude session.* | It exposes GPT models only; a Claude session routed through it dies on `API Error: 400 unsupported model: claude-opus-5`. Reported measured 2026-07-29. | habit — comment in `tmp/agents/launch.sh`, a git-ignored file. **Not re-measured by this memory.** |
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

| REC-09 | **A model id is probed, never guessed, and the gateway is not neutral.** Reachable set, verified 2026-07-29 by `conductor` via `GET localhost:3002/v1/models`: `gpt-5.3-codex-spark`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`. Two measured traps: gateway `required` is **refused** on profile `codex`; and a `claude` session routed through the gateway dies on `400 unsupported model: claude-opus-5`, because the gateway exposes GPT only (REF-03). Ask for the list; do not infer an id from a nickname. *(relayed by `conductor`, not re-probed here.)* | the probe above; `tmp/agents/launch.sh` — git-ignored, hence the habit rung | habit (the only locator is an ignored file) |

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

---

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
