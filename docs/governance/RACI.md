# RACI of the twelve durable actors

WP4 · Governance & RACI. **Status: architect's advice given and applied (COUNTER, three
conditions, all met) — awaiting the owner's ratification.** Nothing in this file grants
authority yet: the roles it names are not the roles the registry holds. See *Where this
stops*.

Author: `cond` (CONDUCTOR). Mandate: the owner settled on 2026-07-29 that the
conductor **defines** the RACI, on the architect's advice — decision
`01KYQ89WANWD257Y3GCW7YM8BZ`, option A, outcome `go`. The architect's advice is the
single retained counterweight to that ownership and is **not optional**.

Machine form: [`org.h2a.yaml`](../../org.h2a.yaml) at the repo root — `h2a org show`,
`h2a org validate`, `h2a org diff`.

---

## What the letters mean here

| letter | meaning in this repo |
|---|---|
| **A** — accountable | Answers for the outcome. Exactly one actor per act. Cannot be shared. |
| **R** — responsible | Does the work. May be several. May be the same actor as A. |
| **C** — consulted | Must be asked **before** the act, and their objection has to be addressed on the record. Blocking. |
| **I** — informed | Told **after**, with no veto. |

Two rules override the tables when they collide:

1. **The owner alone accepts.** No actor may declare an item `done` on a green suite.
   A closure without owner UAT is the defect this repo repeats — six items were closed
   on a claim the owner then observed to be false (`REF-01`).
2. **The builder is never a review leg.** Any merge needs a test *and* two review legs,
   neither of them the author.

---

## A · Ownership by workpackage

One accountable actor per WP; the WP is that actor's own scope for
conflict-of-interest purposes.

| WP | title | A / R | C | I |
|---|---|---|---|---|
| WP1 | Protocol & envelopes | `coop` | `arch` | `cond` |
| WP2 | Addressing & presence | `coop` | `arch`, `runtime` | `cond` |
| WP3 | Coordination & loop | `coop` | `cond` | `arch` |
| WP4 | Governance & RACI | `cond` | `arch` (mandatory) | owner |
| WP5 | Execution & runtime | `runtime` | `coop` (addressing doctrine), `cyber` (sandbox policy) | `cond` |
| WP6 | Identity, auth & NHI | `arch` | `cyber`, `coop` — an identity that cannot be resolved cannot be bound | `cond` |
| WP7 | Infra, deploy & MCP | `runtime` — **provisional** | `portal` (its MCP part), `arch` | `cond` |
| WP8 | Tracking & record | `track` | `cond` | all |
| WP9 | Method & harness | `harness` | `cyber` (security discipline), `arch` | all |
| WP10 | Distribution, CLI & packaging | `plugins` | `harness` (gate), `cond` (tempo) | all |
| WP11 | Memory & context | `memory` | `agents`, `arch` | all |
| WP12 | Integration — sentropic & MCP brokering | `portal` | `gateway` (routing), `arch` | `cond` |
| WP13 | Native CLI & agent runtime | `agents` | `arch`, `memory` | `cond` |
| WP14 | Gateway — routing, pools, loop | `gateway` | `runtime` | `cond` |
| — | security policy, vulnerability register, audit gate | `cyber` | owning lane | `cond`, `harness` |

**WP7 is provisional, and says so on purpose.** The architect's arbitration
(`docs/specs/2026-07-29-ARCH_raci-visa-and-wp7-arbitration.md`) recommends dissolving
WP7 by leaf destination rather than splitting it in two: measured, its eight open leaves
have five destinations across four actors, and three of the eleven leaves ever parented
to it have already left — toward three different packages, none of them WP5. Dissolving
it changes a **ratified** decision (option A gives `runtime` WP5 *and* WP7), so it is the
owner's act, neither the architect's nor mine. Until the owner decides, this table
records today's state. Amendment trigger: the owner selecting the dissolution option.
When that happens, `org.h2a.yaml`, this table and
`packages/h2a/test/org-manifest-committed.test.js` — which pins WP7 → `runtime` — change
in the **same commit**. The gate refusing a half-applied split is the point, not an
obstacle to the arbitration.

`cyber` is the only actor without a WP while it ships code. Its discipline currently
lives as an item inside WP9 (`01KYJVQM5JMJ49MTKR2H4K12NK`). Whether it gets a WP of
its own or keeps its items under WP9 is an **open owner decision**, flagged in its own
brief and not settled here.

## B · Ownership by act

This table is the part that arbitrates. Where an act crosses lanes, the accountable
actor named here wins.

| act | A | R | C | I |
|---|---|---|---|---|
| Set product priority | owner | owner | `cond` | all |
| Decide the tempo, dispatch a lane, relaunch a dead lane | `cond` | `cond` | — | affected lane |
| Wake an idle agent | `cond` | `coop` (mechanism) | — | woken agent |
| Define or amend this RACI, the actor→WP map, or the conductor's authority | `cond` | `cond` | `arch` — mandatory and **not omissible**, see the rule below | owner, all |
| Ratify the org manifest / provision it | owner | `cond` (proposes) | `arch` | all |
| Arbitrate a package or WP boundary, split a WP | `arch` | `arch` | affected lanes | `cond`, owner |
| Resolve two lanes that contradict each other | `arch` | affected lanes | `cond` | owner |
| Merge a branch | owning lane | owning lane | `harness` (gate), 2 review legs ≠ author | `cond` |
| Cut and publish a release | `plugins` | `plugins` | `cond` (tempo), `harness` (gate) | all |
| Change what the required test gate covers | `harness` | `harness` | `cyber` — independent leg, see the exclusion below | all |
| Ship a security fix or a vulnerable-dependency bump | `cyber` | `cyber` | owning lane — informed, **not** blocking | `cond`, `harness` |
| Set the sandbox / greywall policy | `cyber` | `cyber` | `runtime` (executes it) | `cond` |
| Declare an item `done` | owner (UAT) | owning lane | — | `cond`, `track` |
| Reopen an item closed without validation | owning lane | `track` (mechanism) | — | `cond`, owner |
| Cancel an item | owning lane | owning lane | `cond` | owner, `track` |
| Write the journal, the report, the decision surface | `track` | `track` | `cond` | all |
| Declare a conflict of interest / ask for clearance | declaring actor | `cond` | `arch` | owner |
| Escalate after N failed relaunches | `cond` | `cond` | — | owner |
| Speak to the `sentropic` repo | `portal` | `portal` | `arch` | `cond` |
| Choose a model, an account pool, a routing target | `gateway` | `gateway` | `runtime` | `cond` |
| Define what an actor must recall on wake | `memory` | `memory` | all | `cond` |

Escalation chain, unchanged from `docs/drumbeat.md`: `AGENTS ← CONDUCTOR ← PRINCIPAL`.
The owner is the escalation endpoint; there is no EXECUTIF at this scope.

### The architect's advice is not omissible

Any amendment to this RACI, to the actor→WP map, or to the conductor's own authority
carries a **track decision whose dossier references the architect's advice artefact**.
The owner may **refuse** that advice; nobody may **skip** it. A conductor that amends its
own governance without that reference has produced a document, not an amendment.

Why this form rather than a stronger one: "C, mandatory" is a spec line — nothing fires
when it is forgotten, and a habit is skipped exactly when it counts, which here means
under pressure and on the conductor's own authority. Requiring the reference *inside a
decision* is checkable by a human today and testable tomorrow: does the decision carry
the artefact? This was the architect's condition for its visa, and it deliberately
transfers nothing — WP4 stays with the conductor, which is what the owner decided. The
counterweight's force comes from the artefact being answerable, not from the role holding
it: an unconsulted CONTROL is worth less than an AGENTS whose advice cannot be skipped.

### Exclusion — the owner of a gate is not the reviewer of its repair

When `harness` ships code that changes the required test gate, `harness` is **neither of
the two review legs nor the verifier** of that change; `cyber` (CONTROL, `gate-audit`) is
the independent leg, and a green suite produced by `harness` is not the evidence. This is
rule 2 of this document — the builder is never a review leg — applied to the gate itself.

It is not hypothetical: item `01KYPZA14CRATVDSSZ6V6HDPCZ` measured the required gate blind
to the `h2a-runtime` tests — `harness` owns the gate *and* has to deliver its own repair,
which is exactly the moment this exclusion applies. Whether that repair has landed on
`main` is a question for `harness` and for the gate itself, not for this document. Same
structure of conflict of interest as WP4, same treatment.

---

## The recorded disagreement on WP4

Both legs of the double consensus concluded that WP4 should belong to `arch`, not to
`cond`, on the same argument: **an operator must not own the rules that found its own
authority**, and the repo already ships a conflict-of-interest posture that makes the
separation explicit. The owner decided otherwise on 2026-07-29, citing the precedent of
their other projects, and retained the architect's advice as the counterweight — *the
separation is by advice, not by ownership*.

This is recorded so that any future conflict over the conductor's authority is re-read
in the light of what was flagged. It is not a reservation about the decision; it is the
decision's own stated condition. In practice it means: an amendment to this RACI that
`arch` has not seen is not valid, whoever writes it.

One discrepancy in the ratified dossier, for the record: the selected option is titled
"Onze acteurs durables : 4 transverses, 7 de domaine" while its own body enumerates
four transverse and **eight** domain lanes — twelve actors, as `docs/agents/RECALL.md`
DOC-06 states. The enumeration is authoritative; the count in the title is off by one.

---

## Where this stops

On the enforceability ladder — **structural > test > spec line > habit** — this file is
a **spec line**. `org.h2a.yaml` raises the *roster* to structural (a total validator
refuses an invalid org), and a test pins the two together. The **A/R/C/I assignments
themselves remain a spec line**: nothing in the code refuses an act performed by the
wrong actor. Five measurements say exactly how far the machine is from this paper.

**Status of the gate itself, stated precisely.** The test lives in `packages/h2a/test`,
which the required `build-and-test` check runs on `main` under `enforce_admins`, and
`npm test` builds before testing — so the mechanism does cover it. It is verified locally
at 6/6, with falsification checked (two mutations, two named failures). But a required
check runs on the **pushed** tree: until this work is pushed and merged, the honest claim
is "checked locally", not "enforced by the gate". The architect made this correction, and
it is the same defect this repo has paid for three times — citing an uncommitted document
as a mandate.

1. **No actor holds its role in the registry.** All fourteen live agents in this
   workspace are registered `roles: ["AGENTS"]` — including `cond`, `arch`, `harness`
   and `cyber`. `h2a_conductor` returns `conductor: null, claimedBy: null` for the
   workspace. Measured 2026-07-29 21:37Z. So the roles above are, today, invisible to
   the machine; provisioning them requires the owner's ratification.

2. **The conductor resolver cannot be reached by path.** `h2a_conductor` called with
   `workspacePath: /home/antoinefa/src/h2a` derives
   `ws:4fcb3611-1010-56a7-b14d-9c2c760fa2b6` and answers `live: false` with zero
   candidates; called with the presence-form id
   `ws:4471ea0ce44cda345ef053f51773215a5b6f0f09aa9f505bef086751f50fb8d2` it answers
   `live: true` with fourteen. So a caller that passes a path — the natural form for a
   human or a hook — is silently told the workspace is dead, and "who conducts here" has
   no reliable answer. Traced as a WP4 defect. The path form is a **third** mechanism
   (UUID-shaped) and remains unexplained; the two sha256-shaped ids are explained by
   measurement 5.

3. **Per-item RACI cannot be back-filled.** `track` persists `accountable` /
   `responsible` **only at item creation** (`track item new --accountable/--responsible`);
   there is no command to set them on an existing item, and 115 items already exist. So
   the ownership table above cannot yet be projected onto the backlog it governs.

4. **Routing to an actor is a convention.** Multi-namespace target resolution (DOC-03)
   is decided and not wired. Until it is, a dispatch addressed to `runtime` is a name
   this repo cannot reliably resolve, and every C in these tables depends on the message
   arriving.

5. **The journal this RACI would be enforced through is split across two workspace ids.**
   `track workspace-id` prints
   `ws:4471ea0ce44cda345ef053f51773215a5b6f0f09aa9f505bef086751f50fb8d2`; querying with
   it returns **2** items, while the WP1–WP14 referential — every WP container included —
   sits under `ws:89c45cc3e0…` with **119**. Root cause, computed and reproduced
   independently on both sides rather than supposed: the id is
   `sha256(root-commit-SHAs, sorted, comma-joined + "\n" + worktree-name)`
   (`packages/track/src/workspace-id.ts`), and this repo has **two** root commits —
   `ce2f385` (init h2a) and `e195823` (init `@sentropic/track`, absorbed by a
   `git subtree add` on 2026-07-04). `sha256("ce2f385…\n")` reproduces the referential id
   exactly; `sha256("ce2f385…,e195823…\n")` reproduces today's exactly. The function is
   documented as durable because it is salted only by what travels with the repo: true
   under a move or a clone, **false when the repo absorbs another repo's history** — which
   is the direction h2a is taking (track absorbed, remote absorbed, single-plugin
   consolidation ahead). The guarantee is real and narrower than its name.

   Consequence for this document: ownership recorded through `track` can land outside the
   referential, silently — the write succeeds and `track validate` says nothing. One item
   already sits orphaned that way. **Interim instruction, in force for all twelve actors
   until the drift is fixed: pass `--workspace ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d`
   explicitly, and do not use `track workspace-id` in this repo.** Owned by the architect
   in WP6 (identity & workspace); broadcast by the conductor.

What would raise the A/R/C/I rung from spec line to structural, in order of cost:
provision the ratified manifest so roles exist in the registry; give `track` a way to
set `accountable`/`responsible` on an existing item; then gate the acts in table B on
the actor's registered role, reusing the clearance gate rather than goodwill.

---

## The architect's advice — the counterweight, exercised

Requested 2026-07-29T21:43Z (envelope `raci-visa-req-20260729T2143Z`), answered
2026-07-29T21:48Z (envelope `raci-visa-arch-counter-20260729T2148Z`, verdict **COUNTER**).
Advice artefact: `docs/specs/2026-07-29-ARCH_raci-visa-and-wp7-arbitration.md`. The three
questions were put as open, and the answers changed this document — they did not endorse
it. All three conditions are applied above.

1. **`arch` = `AGENTS`, not `CONTROL` — refused by the architect itself.** "Taking CONTROL
   would be taking through the vocabulary what was refused on the substance", and the
   argument that an operator must not own the rules founding its own authority "applies to
   me too". Encoding kept as proposed. Its condition instead: make the advice
   *non-omissible* through a decision that carries the artefact — the rule now in table B.
   The architect asked for opposability, not for power.

2. **WP7: record today's state, do not wait.** The arbitration is delivered and registered
   as a *pending* decision; the architect declined to apply it, for two reasons worth
   keeping: dissolving WP7 modifies an already-ratified decision (the owner's act), and it
   refused to lean on this RACI's table B while this RACI is not yet ratified — "same
   discipline for me as for you". Its measurement corrects both earlier review legs: the
   destinations are five across four actors, not two, and three leaves have already left
   toward three different packages, none of them WP5.

3. **`harness` stays `CONTROL`, with an explicit exclusion.** The role is founded on what
   it gates, not what it writes — but rule 2 of this document then has to apply to the gate
   itself, hence the exclusion above.

Endorsed without change: the 11-vs-12 discrepancy in the ratified option title, and that
`cyber`'s missing WP is roster-level and therefore the owner's — registered as decision
`01KYQXPNS1K1SJV0G3JYTAZF67`, recommendation A, neither of us deciding it further.

**What this advice explicitly does not cover**, in the architect's own words: it did not
verify that table B corresponds to any behaviour of the code (it does not — this document
says so), nor that `h2a org validate` refuses every invalid manifest beyond the six pinned
invariants, nor that role provisioning works. The visa covers the **coherence of the
referential and the package boundaries**. The rest stays a spec line.
