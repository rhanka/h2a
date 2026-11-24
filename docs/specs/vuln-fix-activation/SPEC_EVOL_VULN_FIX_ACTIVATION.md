# SPEC EVOL — Make the daily vulnerability-fix job (PR #371) activable and autonomous

Status: specification only. No code in this document.
Date: 2026-10-18. Sources cut-off: owner entries of 2026-10-18 ~11:30 plus the
follow-up « Dans gh » recorded immediately after (see Section 2).

How to read the source tags. Every decision D carries exactly one tag:

- `[owner verbatim]` — text recorded word for word in the brief or in
  DECISIONS-owner.md. It is a requirement.
- `[both analyses]` — point on which analysis-sol.md and analysis-astra.md
  agree, each from its own evidence. It is capital to respect, not an owner
  order.
- `[proposition-not-validated]` — proposal of one analysis, of the earlier
  study, or of this specification. It must never be read, quoted, or built
  as an owner requirement.

Where a later owner entry supersedes an analysis proposition, the decision
is tagged `[owner verbatim]` and the superseded proposition is named as
superseded in Section 3. Where the two analyses diverge, the divergence is
kept visible; this specification does not silently pick a winner except
where a later owner entry settles the point, and that settlement is cited.

---

## 1. Inputs and existing capital

### 1.1 Inputs to this specification

| # | Input | Role |
|---|---|---|
| I1 | brief-act371-common.txt (owner verbatim of 17/10 and 18/10, seat dual use of 17/10, questions A–D) | Primary owner statements before the dossier |
| I2 | DECISIONS-owner.md, latest entries of 2026-10-18: capacity « A · Partager la maintenance »; repositories « Tous les dépôts prêts »; « T es con ou quoi le but c est d avoir des upgrade autonome. Fix + revue autonome »; follow-up « Dans gh » | Owner decisions that amend the analyses and the dossier |
| I3 | analysis-sol.md (2026-10-18, observations stopped 13:50 UTC, local Git references, no npm registry read) | Independent analysis 1 |
| I4 | analysis-astra.md (2026-10-18, GitHub and public registry reads on the day) | Independent analysis 2 |
| I5 | dossier/dossier-371-activation.json (decision:371-activation, draft 2026-10-18, three questions: capacity, perimeter, takeover) | Presentation to which the owner replied; its recommendations are propositions, the owner answers in I2 are the decisions |
| I6 | DECISIONS-owner.md earlier entries cited by the analyses (seat enrolment modes 13/10; seat dual use 16/10; daily-jobs directive 17/10 ~20:30; sub-contractor rules 17/10 ~21:00; NO GO on #371 18/10 ~02:55; double review 18/10 ~03:25) | Standing owner constraints |

### 1.2 Existing capital that must be respected, not rebuilt

| Capital | What it already provides | Limit stated by the analyses |
|---|---|---|
| h2a PR #371 (worktree vulnfix, HEAD 3e0cbc7e319a0c831fae26f8b3ebd8b71923c01d at analysis time) | Daily controller, npm/OSV scan, lock-only guard, durable claims, reports, rendered systemd units, operator reference, SPEC_EVOL_DAILY_VULN_FIX contract | Dormant: no real seat binding, no deployed quota/scope authority, no activable author/reviewer pool under current rules, timer rendered but never installed; base does not contain #348 (Astra) |
| h2a PR #348 (merged, 7670fbed6, in origin/main 46b82b42) | Five-provider seat model, codecs, CLI/token import surfaces, nativeUse/meshUse projections, private materialisation, synthetic 25×4 matrix | Synthetic: real enrolment blocked on unpublished L1 APIs; live NxN path is a refusing stub; no live CLI or gateway proof |
| sentropic L1 work in source (cited: #678 merged L0a envelope; #681 open draft L1 at analysis time) | SeatBundle contract and import implementation in source | Not an integrated published delivery; h2a pins (llm-mesh 0.26.0 / cluster-mesh 0.16.0 on main) predate it |
| sentropic vulnerability study (study-v5, dossier v6, choices VA1–VA6) | Quota doctrine, single-authority doctrine, batching/merge/detection/age trade-offs | Recommendations B/B/A/A/B/A are study propositions, not owner answers; the 17/10 directive replaces the six questions as a blocking set |
| Shared seat doctrine (spec-v10, CI addendum v5, as cited) | Max 10 units per CLI per UTC day across all consumers; provider reserve strictly above 20%; unknown quota = zero inference; Codex split 6 CI / 2 enrolment / 2 maintenance; credit fallback limited to admitted CI tests | Design documents: no deployed ledger, vault, or refresh service is proven by the analyses |

Rule: no lot in Section 6 may create a second seat vault, a second quota
ledger, or a parallel controller. Every lot either reuses this capital or
names the precise gap it closes in it.

---

## 2. Owner statements that govern this evolution

Verbatim, in chronological order. Spelling preserved.

1. 17/10: « des jobs daily avec des sieges pour fixer les failles cve …
   a commencer par les vuln npm high et critical ».
   Completed 17/10 ~20:30: « pour la sécu je comprends vraiment pas tes
   question je veux des jobs daily avec des sieges pour fixer les failles
   cve. pas celles detectées par dependabot, les failles quelle qu elles
   soient a commencer par les vuln npm high et critical des différents
   composants. »
2. 17/10 (seats): « attention : les sieges servent - aux tests gw - aux
   tests cli (a2a inter cli) il faut donc bien des sieges enrôlables CLI
   ET LLM-MESH Claude, codex, muse, vibe, agy/cloud-code sinon on n a
   qu une partie des tests en matrice ».
3. 13/10 (enrolment modes, relayed verbatim): « j'ai deja demandé les deux
   modes : oauth par défaut ou --cli (import de siege). Dans tous les cas
   faut un mécanisme d'import de siege pour imaginer par un état
   transitoire hors instance live (token stocké), ce pourrait être
   d'ailleurs deux options : --cli pour importer de la cli du siege, et
   --token pour importer d'un token sérialisé dans un gestionnaire de
   secrets. »
4. 17/10 ~21:00 (sub-contractors): « stp utilise muse a fond a la place
   d astra (muse wonder max ou muse 1.3 xhigh selon que tu spec ou tu
   code) + revue de spec stra max revue de code 6.1 sol xhigh. n utilise
   plus claude code merci ». The analyses read this as: Claude Code must
   not be used as a work sub-contractor; Claude remains required as a
   tested provider in the matrix (statement 2). That reading is kept here.
5. 18/10 on #371: « Je n ai aps eu de presentation qui requiert les
   sieges. S il n dst pas activable il ne sert a rien ». And the standing
   NO GO of 18/10 ~02:55: « par contre le job quotidien et le
   chronométrage je sais pas ce que ca contient, no go ».
6. 18/10 ~11:30, answers to the act371 dossier: capacity « A · Partager
   la maintenance »; repositories « Tous les dépôts prêts »; merge:
   « T es con ou quoi le but c est d avoir des upgrade autonome. Fix +
   revue autonome ». Recorded gloss in DECISIONS-owner.md: autonomous fix
   and autonomous review, autonomous merge after reviews, no owner
   approval per merge.
7. 18/10, precision immediately after: « Dans gh ». Recorded gloss:
   the autonomous fix and review take place in GitHub.

Statement 7 is treated literally as an owner statement. Its scope is
ambiguous. It is NOT decided in this specification; it is open question
OQ1 (Section 5) with three readings and their consequences. No lot may
silently assume one reading. Lots that depend on the reading are marked
conditional on OQ1.

---

## 3. Reconciliation of the two independent analyses

### 3.1 Points of agreement (both analyses, independent evidence)

| # | Agreed point | Consequence for this specification |
|---|---|---|
| C1 | #371 is not activable end to end by configuration alone. Missing: real seat binding, deployed quota/scope authority, a rule-conformant author + two-reviewer pool, host/timer activation proof. | D3, lots L1–L3, activation gates G2–G4 |
| C2 | #348 is synthetic capital, not live seats. Import depends on L1 APIs not present in the pinned/published surfaces examined; the live NxN script refuses; an llm-mesh import is not a native CLI proof and a logged CLI is not a gateway proof. | D4, lot L1, lot L7 |
| C3 | The runner does not bind seat.id to an executed identity: it inherits process.env minus a key list and never calls the #348 materialisation. An external "seat available" answer cannot fix which account runs. | D8, lot L2 RED on ambient identity |
| C4 | Selection needs an author plus two reviewers each differing from the author in both host profile and model. Codex alone can never satisfy it. With Claude barred as sub-contractor, #371 as shipped admits no conformant work pool. | D9, lot L2 |
| C5 | Smallest conformant pool proposed by both: one Muse author + two distinct Codex reviewer models (single eligible author = pilot pool, not full rotation). Muse headless is refused by the shared launch builder (stdin contract), so removing an allowlist is not enough. | D9 `[proposition-not-validated]` for the pool composition; lot L2 |
| C6 | One shared quota authority for the three consumers (gateway tests, CLI tests, fixes): cap 10 units/CLI/UTC day, provider reserve > 20%, unknown quota = zero inference, whole-cycle reservation (author + 2 reviews) before launch; #371 reserves externally per task, which does not protect the reviewers. | D7, lot L3 |
| C7 | Minimum cost is 3 model tasks per candidate (1 Muse + 2 Codex in the pilot pool). Under capacity A that is at most one minimal candidate per day across ALL repositories if both maintenance units are free. "One attempt per repository per day" in the controller is an anti-repeat limit, not a capacity promise. Repository iteration order gives no fairness across repositories. | D6 consequences; fairness gap named in L6 |
| C8 | A successful dry-run proves nothing about seats: it stops before seat lookup/admission. A clean repository proves nothing about remediation capacity. A positive recipe is required. | Gate G3 |
| C9 | Fixed 7-day minimum package age, integrity/signature/provenance checks, lock-only compatible updates (no majors, no new packages) are the shipped behaviour; this is not a zero-day promise. | D12, OQ4 |
| C10 | Credentials of the controller (push/PR identity) must stay separate from agent and candidate-test processes; current test invocation inherits the parent environment. Expiry/401 on a consumer = unavailable, never a silent refresh, credit fallback, or fall-back to the personal home. | D10, lot L3 |
| C11 | The owner must not become the integrator (no fictitious authority path, no EXACT_APPROVED_MODEL placeholder, no owner-written config or systemd install). Maintainers deliver; the owner arbitrates capacity, accounts, rights. | Lot L0 ownership |
| C12 | Old reviews (rev371, rev371b-last) target older SHAs; their findings are neither proven open nor proven closed on the final HEAD. A fresh double review on the integrated HEAD is required. | Gate G5 |
| C13 | The full five-provider × CLI+mesh matrix, multi-OS qualification, 5-minute detection, and image/OS remediation must not gate the first activable cycle, and must not be dropped either. | Lot L7 separate; global NOT covered |

### 3.2 Divergences, kept explicit

| # | Divergence | Sol | Astra | Treatment in this specification |
|---|---|---|---|---|
| V1 | Freshness of the publication state | Local Git references only; explicitly no npm registry read; notes even 0.26.1/0.18.0 historically lacked the APIs | Read the public registry on 18/10: llm-mesh latest 0.26.1, cluster-mesh latest 0.19.0; the three import methods absent from the examined surfaces; h2a pins remain 0.26.0/0.16.0; sentropic #681 open draft | Astra's observation is the more recent evidence and is used for L1's starting state. It must be re-checked at build time (L1 RED resolves the actually adopted packages). Sol's caution stands: a compatible publication would shrink L1 but never replaces adoption + recipe. |
| V2 | State of #371 on GitHub | No real-time GitHub claim | Open, draft, 15 checks SUCCESS on 3e0cbc7e3; merge base with main lacks #348, so a rebase is required before the integrated recipe | Astra's facts are used; L4/L6 start from a rebase onto main containing #348. CI green is recorded as proving neither accounts, quotas, nor timer (both agree). |
| V3 | Is the mesh import (L1) on the critical path of the first pilot? | Keeps the shared integration in the recommended path; a direct CLI pilot must not claim the dual use as acquired by bypass | Admits a native pilot before the full mesh delivery IF lab native projections, the common quota authority, and single-owner renewal already exist and are qualified; forbids a new local vault or silent use of personal logins as the bypass | Reconciled as a conditional, not a disagreement about ends: the pilot MAY precede L1 completion only with the three proofs Astra names, evidenced at gate G2; otherwise L1 is on the path. In both readings a parallel vault or counter is forbidden (C6), and dual use remains due (L7). The condition is `[proposition-not-validated]`. |
| V4 | Merge authority | Manual merge by the conductor under existing repository authority; autonomous delegation is a separate future choice, not needed for a pilot | Same: harness stops at ready; no new auto-merge required for activation; VA3 kept for later | SUPERSEDED by owner statement 6 (autonomous fix + review + merge). The analyses' position is recorded here as the prior state; D11 and lot L5 implement the owner position. The analyses' cautions survive as merge gates (same-SHA double review, CI, effects on publication/deployment per repository). |
| V5 | Repository rollout order | Pilot on h2a, then extend the family list; objective stays the family | Same target; pilot h2a then sentropic and following; pool capacity made explicit | SUPERSEDED in form by owner statement 6, « Tous les dépôts prêts »: every repository that passes the readiness gate is in scope together. A single-repository positive recipe remains a proof technique (G3), not a scope reduction and not a sequencing promise. D5. |
| V6 | Capacity arbitration | Recommends P1 (= dossier capacity A), preserving 6 CI + 2 enrolment | Same recommendation A for a bounded pilot, B only if urgency outranks tests | SETTLED by the owner: capacity A (statement 6). No longer an open question. D6. |
| V7 | Host and schedule | Local Linux/systemd as shipped; 03:00 machine-local rendering; reconcile with the study's 07:17 UTC routine window if that window is kept | Same shipped facts; host/operator/timezone unknown; the study window is a study proposition | Both readings assumed a local host because #371 ships systemd. Owner statement 7 (« Dans gh ») post-dates both analyses and puts the host question back in play. Neither analysis settles it. OQ1, lot L4 conditional. |
| V8 | Effort vocabulary | Accepted efforts are low/medium/high/xhigh; "max" needs an explicit qualified mapping per model | Same; the `Astra max` wording must not be declared satisfied by a `high` example | Agreement in substance; listed here because the exact model+effort strings for the work pool are still unqualified in both. OQ3. |

### 3.3 What the owner answers changed relative to the dossier

The dossier asked three questions. Its recommendations were propositions.

| Dossier question | Dossier recommendation (proposition) | Owner answer (decision) |
|---|---|---|
| Capacity | A · Share the maintenance units | « A · Partager la maintenance » — adopted as recommended |
| Perimeter | Pilot h2a, then extension | « Tous les dépôts prêts » — NOT the recommended option; all ready repositories together |
| Takeover | Current conductors merge | « Fix + revue autonome », autonomous upgrades, no per-merge owner approval — neither dossier option; a stronger delegation than asked |
| (not asked) Where | Dossier assumed the shipped local design | « Dans gh » — new owner statement, ambiguous scope, OQ1 |

Any text, review, or build brief downstream of this specification that
still presents manual merge or a h2a-only perimeter as the target is
stale with respect to Section 2.

---

## 4. Decisions

Each decision states the rule, its source tag, and where it is enforced.

- **D1 — Purpose and priority. `[owner verbatim]`**
  Daily seat-based jobs that FIX vulnerabilities (CVE in the broad sense,
  every source, explicitly not only Dependabot detections), starting with
  npm HIGH and CRITICAL findings across the components. Detection-only or
  Dependabot-only delivery does not satisfy D1. Enforced by: scan scope in
  L6, acceptance A1.

- **D2 — Seats are dual-use, five providers. `[owner verbatim]`**
  Seats must be enrollable for CLI AND for llm-mesh, for Claude, Codex,
  Muse, Vibe, and agy/cloud-code, serving gateway tests and inter-CLI
  tests in addition to the fix job. One account may yield two projections
  under one renewal owner and one shared budget; ten combinations do not
  mean ten subscriptions. Enrolment modes: OAuth by default, plus
  `--cli` import and `--token` import from a secret manager (13/10).
  Enforced by: L1, L7. The first activable cycle (D9 pool) does not
  discharge D2.

- **D3 — "Activable" is the delivery criterion. `[owner verbatim]`**
  A delivery that the operator cannot activate end to end is worthless
  (« S il n dst pas activable il ne sert a rien »). "Activable" = the
  full chain is connected and proven by a positive recipe (G3) and one
  observed scheduled run (G4), under the chosen OQ1 reading. The standing
  NO GO on merging #371 holds until the gates of Section 7 pass; a
  dormant re-merge proposal does not lift it. Enforced by: G1–G6.

- **D4 — Reuse the capital; no parallel systems. `[both analyses]`**
  Reuse #371 (controller, scanners, guards, reports) and #348 (seat
  model, codecs, materialisation) and the sentropic L1/custody line.
  Forbidden: a second seat vault, a second quota counter, silent use of
  personal daily logins, renaming a seat to fake an identity. Enforced
  by: lot boundaries in Section 6; L2/L3 RED tests on ambient identity.

- **D5 — Perimeter: all ready repositories. `[owner verbatim]`**
  « Tous les dépôts prêts »: every repository that passes the per-repo
  readiness gate (L6) is in scope from activation; readiness is a
  property proven per repository (locks, baseline installable, required
  targeted tests expressible and executable, data-sharing consent,
  merge/publication effects known), not a name in a config file.
  Candidate family named in the analyses: h2a, sentropic,
  radar-immobilier, graphify (graphify/engram correspondence to confirm,
  OQ2). The exact inventory is produced by the conductors in L0; owner
  input is only for exclusions or unestablished sharing consent.
  Consequence kept explicit: D5 does not create capacity; with D6 the
  daily fix throughput may be one candidate per day across all ready
  repositories while scans still cover all of them.

- **D6 — Capacity A. `[owner verbatim]`**
  « A · Partager la maintenance »: remediation is admitted inside the
  two Codex maintenance units of the documented split (6 CI / 2
  enrolment protected / 2 maintenance, cap 10 units per CLI per UTC day
  across all consumers). The six CI units and the two enrolment units
  are preserved; the enrolment reserve is never spent on fixes.
  Remediation consumption of the maintenance units competes with native
  qualification/maintenance the same day — the conflict is displayed by
  the authority, never hidden by relabelling remediation as CI. B
  (protecting two urgent units out of CI) and C (no Codex remediation)
  were not chosen. The decision is effective only once applied in the
  real authority (L3), not when written in a local config. No credit
  fallback funds remediation author/reviewer work `[both analyses]`.

- **D7 — One quota and scope authority, whole-cycle reservation.
  `[both analyses]`**
  A single deployed authority, shared by gateway tests, CLI tests, and
  fixes, decides admission: global cap, provider reserve strictly above
  20% in every provider window, unknown or unreadable quota = zero
  inference. Admission reserves the entire cycle (author + two reviews)
  before the author starts; per-task reservation that leaves the
  reviewers unfunded is a defect. Scope receipts bind the exact
  workspace, the exact guard bundle digest, the seat reference and
  generation, and a freshness under 24 h; the same qualification is
  required on the author worktree and on each review worktree. A static
  `guardQualified: true` answer or a JSON mirror of the request is not
  an authority. Enforced by: L3.

- **D8 — The executed identity is the reserved identity. `[both analyses]`**
  Reservation, seat reference, and child process must be one chain: the
  launch uses the materialised projection of the admitted seat (private
  profile, closed environment from #348 materialisation), never the
  ambient login that happens to be on the host. Two configuration lines
  pointing at the same ambient account are one seat, whatever they are
  named. Consumers never refresh: expiry or 401 means unavailable, with
  no fallback. Enforced by: L2.

- **D9 — Work pool without a Claude Code sub-contractor.
  `[owner verbatim]` for the ban; `[proposition-not-validated]` for the
  composition.**
  No Claude Code as author or reviewer sub-contractor (17/10 ~21:00);
  Claude remains a tested provider under D2, with distinct usage
  permissions (test-cli, test-gateway, vulnerability-remediation,
  author/reviewer roles, allowed models) so a test capability can never
  be spent as remediation work. Proposed smallest conformant pool (both
  analyses, C5): one Muse author and two distinct Codex reviewer
  models. This pool has exactly one eligible author: it activates the
  job, it does not deliver full author rotation; extending to several
  eligible authors stays due. Exact model identifiers and the
  effort mapping (owner words such as "max" versus the shipped
  low/medium/high/xhigh) are unqualified: OQ3. The recorded Muse
  unavailability until 19/10 02:00 is a registry note, not a live quota
  reading; admission is decided by the authority at run time, never by
  that date.

- **D10 — Credential separation. `[both analyses]`**
  The publishing identity (push branch, open/update PR, and under D11
  merge) belongs to the controller only. Agent processes and candidate
  test processes receive no writer, refresh, provider, or credit
  credentials, and no ambient profile selectors. Candidate tests run
  with an isolated environment; output masking is defence in depth, not
  the isolation mechanism. This is a minimal separation on the shipped
  local/GitHub path; it does not reintroduce the B9/B10 laboratory gate
  the owner ordered eradicated (13/10). Enforced by: L3 RED canaries.

- **D11 — Autonomous fix, autonomous review, autonomous merge.
  `[owner verbatim]`**
  « le but c est d avoir des upgrade autonome. Fix + revue autonome »:
  the job produces the fix, obtains its two independent reviews, and
  merges without per-merge owner approval. Autonomy is bounded by the
  merge gates of L5, which are fail-closed: both reviews on the exact
  final SHA, required checks green on that SHA, candidate still
  lock-only/compatible, age and provenance rules satisfied (D12), no
  unresolved blocking review thread, repository merge rules and the
  standing "merge commit, never squash" owner rule respected, and
  per-repository publication/deployment side-effects of a merge known
  and admitted in L6 readiness (a repository whose merge auto-publishes
  or auto-deploys is "ready" only if that effect is the intended one).
  Any gate failure leaves the PR open with a durable, operator-readable
  reason; the job never merges a stale, re-pushed, or partially proven
  candidate, and an open blocked PR counts as an unfixed vulnerability
  in reporting. Where the autonomous acts execute is OQ1.

- **D12 — Package trust rules as shipped. `[both analyses]`**
  Minimum age 7 days for every modified package, integrity/signature/
  provenance verification, lock-only changes to already-tracked
  compatible locks, no majors, no new packages, refused origins refused.
  No urgent-age exception exists in the shipped behaviour; creating one
  is OQ4 and must never be smuggled in to make a recipe pass. Reported
  plainly: a CRITICAL fix published yesterday waits, so the daily job
  is not a zero-day SLA.

- **D13 — Review discipline for this evolution itself. `[owner verbatim]`**
  Two independent maximum-effort reviews of the specification before
  code and of the code before merge (18/10 ~03:25), on the exact final
  SHA, under the current sub-contractor assignment (17/10 ~21:00).
  Historical reviews on older SHAs do not count (C12). Enforced by: G5.

- **D14 — Detection reporting and measurement. `[both analyses]`**
  Reporting measures detection → candidate → merge → delivery, with
  per-repository state, capacity refusals, and ageing visible. An open
  PR, a draft held by D12, or a quota refusal is never counted as a
  fixed vulnerability. Findings of unknown severity stay visible.
  Enforced by: L6 reporting acceptance.

---

## 5. Open questions

An open question blocks exactly the lots named with it, nothing else.
Each question gives context, options with consequences, and the
resolution path. Propositions inside an option are never owner
requirements until the owner answers.

### OQ1 — What « Dans gh » means (owner answer required; blocks L4 and the host half of L6 activation)

Owner statement, literal: « Dans gh », given as a precision on
« Fix + revue autonome ». Recorded gloss: the autonomous fix and review
take place in GitHub. Three readings fit the words. They differ in
where the seats run, where the schedule lives, where review verdicts
exist, and what merges. This specification does not choose.

| Reading | What runs where | Consequences, for and against |
|---|---|---|
| **GH-1: GitHub as system of record.** Agents still run on the lab host seats with the shipped controller; GitHub hosts branches, PRs, the two reviews as PR reviews/comments, required checks, and the merge. | Fix and review agents execute locally (D8 seats); their verdicts are posted to the PR; the controller merges through GitHub once D11 gates pass. Schedule stays host-side (shipped systemd units). | Smallest delta to #371 and to the seat capital: D7/D8 unchanged, no secret transport. Reviews become auditable GitHub objects. Against: the daily chain still depends on a local host being up at night; "in GitHub" is then about records and merge, not execution — if the owner meant execution, GH-1 misses the point. |
| **GH-2: GitHub Actions as execution host.** A scheduled Actions workflow runs scan, author, reviews, and merge on GitHub runners. | Seats must be transported into Actions as secrets (the 12/10 owner model for the test matrix already describes real seats in a GitHub secret refreshed by cron, with periodic re-enrolment); the D7 authority must be reachable and race-safe from ephemeral runners; systemd units and the lab host disappear; per-repo or central workflow placement to define. | No local host availability problem; schedule, logs, and merge natively in GitHub. Against: largest delta — D8's materialised private profiles, keyrings (agy), and renewal ownership must be re-qualified on ephemeral runners; seat secrets in GitHub widen the custody surface; quota authority needs a network-reachable, concurrency-safe form; provider terms for headless CLI use on hosted runners unqualified; runner minutes and model egress costs unknown. |
| **GH-3: GitHub-hosted autonomous merge only.** Fix and review agents may run on seats (as GH-1) or in Actions, but the binding verdicts are GitHub reviews and the merge is executed by GitHub mechanisms (auto-merge / merge queue) once D11 gates and branch protection pass, instead of the controller merging itself. | Execution host open; GitHub enforces required reviews/checks and performs the merge commit. | Merge enforcement by the platform, hardest to bypass; keeps seat custody where it is. Against: native auto-merge merges when checks turn green, so the D11 same-SHA/double-review/age logic must be expressible as required checks and rulesets per repository, or an extra gating check must be built and owned; merge-queue availability and ruleset expressiveness per repository unverified. |

Common to all readings: D1, D2, D5, D6, D7, D9, D11, D12 are unchanged;
lots L0–L3 and L5's gate logic are needed in every reading; only their
placement of execution differs (L5 states the gates once, L4 places
them). Questions the owner answer must settle, in one reply: execution
host (GH-1 host seats / GH-2 Actions), and merge executor (controller /
GH-3 platform). Until then, no lot may hard-code systemd as the answer,
and no lot may hard-code Actions either.

### OQ2 — Exact repository inventory (conductor-produced; owner only for exclusions)

Analyses name h2a, sentropic, radar-immobilier, graphify; the
graphify/engram correspondence, private repositories, fixtures, and
per-repository data-sharing consent are unconfirmed. L0 produces the
inventory with readiness state per repository (L6 criteria); the owner
is asked only about exclusions or unestablished consent, never to type
the list. Blocks: L6 admission of each unnamed repository, not the
chain itself.

### OQ3 — Exact models, efforts, and live availability for the work pool (technical, resolvable without the owner)

The shipped effort set is low/medium/high/xhigh; owner vocabulary
includes "max". Exact model identifiers for the Muse author and the
two Codex reviewers, their effort mapping, and their live quota state
are unqualified in both analyses. Resolution: L0/L2 qualify the strings
against the real binaries and the authority; a flattering label or an
invented "max" value is a defect. A model actually served is not
attested by the requested name; reports keep requested vs served
distinct. Blocks: L2 closure.

### OQ4 — Urgent exception to the 7-day age rule (owner answer required ONLY if an urgent path is wanted)

Shipped behaviour blocks every younger package (D12). Options: keep 7
days for the autonomous path and handle true urgencies by an exact,
human-approved, single-candidate exception with all other D11/D12
controls intact; or define an urgent policy (shorter age + faster
detection than daily) as its own evolution. No option makes invalid
signatures or provenance acceptable. Not blocking: activation proceeds
under D12 as shipped.

### OQ5 — Schedule details under the chosen host (operator proposition, announced, reversible)

Shipped rendering is 03:00 machine-local with up to 15 min jitter and
Persistent catch-up; per-day limits count in UTC. The study's
07:17–12:59 UTC routine window is a study proposition, not an owner
rule. Under GH-2 the cron is UTC by platform design. The operator
proposes the final time and timezone in the runbook (L4), consistent
with quota windows; an owner decision is needed only if a window
conflicts with test-matrix usage. Blocks: nothing once OQ1 is answered.

---

## 6. Lots

Rules for every lot: RED first — the named test is written and observed
failing for the stated reason on the pre-lot tree before any fix, then
observed passing after; command, exit code, and output are kept for
both runs. Targeted test files only (`node --test <file>` /
`vitest run <file>` forms used by the owning repository); the full
suite is the conductor's integration step, never the lot's claim.
Temporary directories only in tests; a test that silently skips for
missing real state is a failure. Live qualification on real lab
accounts is an operator act with redacted receipts, separate from the
synthetic tests, and is named as such in each gate. No lot reads or
prints a secret value.

Files are given per owning repository. Published-artifact paths are
named where the analyses observed artifacts; the source counterpart in
the owning repository is confirmed by that maintainer at RED time and
recorded, not invented here.

### L0 — Activation inventory and contract update (documentation; no code)

Owner: h-cond with s-conductor. Depends on: nothing. Blocks: every
later gate (facts first).

Scope:
- Produce the non-secret seat inventory: opaque seat references,
  account owner, provider, allowed usages (test-cli / test-gateway /
  vulnerability-remediation), allowed roles and exact models (OQ3
  input), entitlement class, expiry/generation, custody reference,
  qualification state, capacity state. Unknown fields are written as
  unknown, never filled with placeholders that look real.
- Produce the repository inventory for OQ2 with L6 readiness state.
- Rewrite the #371 contract and operator reference so that owner
  statements (Section 2), this specification's decisions, and the
  remaining gaps are one consistent activation sheet: no fictitious
  authority path, no "merge now, configure later".

Files (h2a):
- `docs/specs/SPEC_EVOL_DAILY_VULN_FIX.md`
- `packages/h2a/skills/vuln-fix/references/operator.md`

RED: none (no code). Gate: G0 — every field needed by L1–L6 is either
a real reference or an explicit unknown with a named resolver; the
double review of this specification (D13) is done before L1 code.
NOT covered: any enrolment, deployment, or activation.

### L1 — Published L1 seat import, adopted by h2a

Owners: sentropic L1/custody maintainer (publication), then h2a
(adoption). Depends on: L0. Conditional per V3: the first native cycle
may precede L1 completion only if gate G2 evidences qualified native
projections + the common authority + single-owner renewal without it;
L1 remains due under D2 regardless.

Scope:
- Publish (or identify the already-published) versions of
  `@sentropic/llm-mesh` and `@sentropic/cluster-mesh` that actually
  export `importSeatBundle`, `parseCliSeatProfile`, and
  `parseTokenSeatEnvelope`; adopt them in the h2a pins. Starting state
  per V1: the methods were absent from the surfaces examined on
  18/10 and h2a main pinned older versions; the lot re-checks rather
  than trusting either analysis.
- Prove the h2a consumer path end to end on synthetic bundles for five
  providers × two sources (cli, token): persistence, lineage,
  idempotence, reload; refusal on wrong owner scope, on renewable
  projection where only access is allowed, and zero provider refresh
  or fallback on expiry/401.

Files:
- sentropic (`@sentropic/llm-mesh`, observed artifact surfaces):
  `dist/service/facade.js`, `dist/enrollment/index.js`,
  `dist/enrollment/seat-bundle.js` and their source counterparts.
- sentropic (`@sentropic/cluster-mesh`, observed artifact surfaces):
  `dist/integrations/llm-mesh/enrollment.js`,
  `dist/integrations/llm-mesh/facade.js` and source counterparts.
- h2a: `packages/h2a-runtime/src/llm-mesh-accounts.ts`,
  `packages/h2a-runtime/src/index.ts` (enrolment command),
  `packages/h2a-runtime/package.json` (pins),
  `docs/cli-seat-l2s.md` (delivery wording updated, reservations kept).
- h2a (new test): `packages/h2a-runtime/src/cli-seat-published-l1-contract.test.ts`.

RED first: `vitest run` of the new contract test against the currently
pinned packages fails because the resolved public API lacks the import
methods (or is contract-incompatible). GREEN requires the ten imports
through the really published boundary — an injected fake facade that
bypasses the blockage does not count — plus the refusal cases above.
Gate: G1a (publication adopted) recorded in L0 inventory.
NOT covered: live account enrolment (operator act, L6), native CLI
acceptance by real binaries (L7), gateway route proof (L7).

### L2 — Bind the executed seat identity; conformant work pool (Muse author path)

Owner: h2a runtime maintainer. Depends on: L0; on L1 or on the V3
conditional proofs for native projections.

Scope:
- Connect admission to execution: the native runner launches with the
  materialised projection of the admitted seat reference (private
  profile and closed child environment from the #348 materialisation),
  not with inherited ambient environment. Reservation receipt, seat
  reference/generation, and child process identity are recorded
  together per task (D8).
- Deliver a safe Muse author/reviewer launch contract: the shared
  launch builder currently refuses Muse headless on the stdin
  contract, so the lot replaces the assumption with a qualified
  explicit input mechanism (a private prompt-file path is a candidate
  to qualify, `[proposition-not-validated]`), with tool/scope
  restrictions equivalent to the existing profiles, exact model/effort
  passing (OQ3), JSON verdict handling at the exact SHA for reviews,
  and prompt/profile cleanup. No prompt content in argv. Unqualified
  providers (Vibe, agy for remediation launch) stay refused, with the
  refusal tested.
- Enforce usage permissions in selection (D9): a seat admitted for
  test-cli/test-gateway only (notably Claude) is never selectable for
  vulnerability-remediation author or reviewer roles.

Files (h2a):
- `packages/h2a-runtime/src/vuln-seat.ts`
- `packages/h2a-runtime/src/agent-launch-args.ts`
- `packages/h2a-runtime/src/cli-seat-materialization.ts` (reuse; extend
  only where the binding needs it)
- `packages/h2a-runtime/src/cli-seat-codecs.ts` (only if a projection
  field is missing; otherwise untouched)
- `packages/h2a/src/vuln-fix/seats.mjs`
- `packages/h2a/src/vuln-fix/policy.mjs`
- Tests: `packages/h2a-runtime/src/vuln-seat.test.ts`,
  `packages/h2a-runtime/src/agent-launch-args.test.ts`,
  `packages/h2a/test/vuln-fix-policy.test.js`,
  `packages/h2a/test/vuln-fix-controller.test.js`.

RED first (each observed failing before the fix):
1. Two distinct seat references of the same profile both inherit the
   same ambient identity → must resolve to two distinct private
   profiles bound to their reservations, with ambient auth selectors
   absent (`vuln-seat.test.ts`).
2. A Muse remediation launch is refused before start → the qualified
   contract builds and runs with restrictions and cleanup; sensitive
   content never appears in argv (`vuln-seat.test.ts`,
   `agent-launch-args.test.ts`).
3. A configuration offering Claude for remediation work is admissible,
   or no no-Claude triplet is selectable → Claude remediation roles are
   refused by policy while the Muse-author + two-Codex-models triplet
   is selectable; any missing leg blocks before inference
   (`vuln-fix-policy.test.js`, `vuln-fix-controller.test.js`).
Gate: part of G2. Live qualification (operator, lab accounts): the
triplet produces author + two review receipts on one candidate SHA;
expiry/401 yields unavailable with no fallback.
NOT covered: rotation across several eligible authors (due later,
tracked in L7 backlog note), Vibe/agy remediation launches, served-
model attestation beyond requested-vs-served distinction (OQ3).

### L3 — One real quota/scope authority; whole-cycle reservation; credential separation

Owners: custody/quota maintainer (authority implementation, owning
repository per L0 inventory — the existing shared line, never a new
h2a-local counter) with h2a (client seam). Depends on: L0, L2 binding
contract.

Scope:
- Connect the shipped external-authority seam (`status`/`reserve`,
  purpose `vulnerability-remediation`, exact workspace, guard digest)
  to the real deployed authority implementing D6 and D7: global cap
  across the three consumers, reserve > 20%, unknown quota = zero,
  capacity A split with the enrolment reserve untouchable, remediation
  admitted inside the two maintenance units by an authority-side
  amendment (not by relabelling).
- Replace per-task external reservation with whole-cycle reservation
  (author + both reviews funded before the author starts), durable
  across crashes and UTC midnight without reset-based double-spend.
- Scope qualification by the real binary and shipped guard bundle on
  the exact workspace, repeated for author and each review worktree.
- Separate credentials (D10): candidate tests and agent processes run
  without controller writer/refresh/provider/credit material; canary
  values planted in the parent environment are unreachable from tests
  and absent from reports and review inputs.

Files:
- Authority implementation: owning repository and paths identified in
  L0 (existing custody/quota line). If L0 finds no such implementation,
  its delivery is a named prerequisite of this lot with its own RED
  tests in that repository; building a look-alike inside h2a is
  forbidden (D4).
- h2a: `packages/h2a/src/vuln-fix/seats.mjs`,
  `packages/h2a/src/vuln-fix/controller.mjs`,
  `packages/h2a/src/vuln-fix/repository.mjs` (test environment).
- Tests (h2a): `packages/h2a/test/vuln-fix-seats.test.js`,
  new `packages/h2a/test/vuln-fix-seat-authority.test.js` (integration
  against the real authority implementation in temporary state),
  `packages/h2a/test/vuln-fix-repository.test.js`,
  `packages/h2a/test/vuln-fix-controller.test.js`.

RED first:
1. Concurrency: remediation + CLI test + gateway test racing for the
   last unit → exactly one wins; whole cycle reserved or author never
   starts; refusal at reserve ≤ 20%, unknown quota, wrong workspace,
   digest, seat, or generation; enrolment units never spent
   (`vuln-fix-seat-authority.test.js`).
2. Non-promoted capacity: authority without the D6 amendment → zero
   remediation starts (`vuln-fix-seats.test.js`).
3. Canary: a planted parent credential is visible to a candidate test
   → isolated environment makes it unreachable, and it never reaches a
   report (`vuln-fix-repository.test.js`).
Gate: completes G2 (with L2 receipts). A fake authority used only in
unit tests does not close this lot; the integration test runs the real
implementation.
NOT covered: provider-side turn accounting proof (one local unit vs
several internal provider requests) — measured during L6 and reported,
never assumed; urgent-unit protections of unchosen capacity B.

### L4 — Place the autonomous chain under the chosen « Dans gh » reading (CONDITIONAL on OQ1)

Owner: h-cond / operator, with per-repository conductors for rulesets.
Depends on: OQ1 answer, L2, L3, L5 gate logic. Nothing in this lot is
built before OQ1; the three branches below are alternatives, and the
chosen one is recorded in DECISIONS-owner.md before RED.

Common to every branch: rebase the #371 branch onto main containing
#348 (V2); golden regressions from the old reviews (JSON masking,
mask-then-truncate order, TODO detection) re-verified on the
integrated HEAD; runbook with reviewed release paths, private config,
stop/resume by draining with claims and counters preserved.

Branch GH-1 (GitHub as record; host seats):
- Keep the shipped controller on the designated lab host; reviews are
  posted as GitHub PR reviews; the controller performs the L5 merge.
- Files (h2a): `packages/h2a/src/vuln-fix/cli.mjs` (units; only if
  schedule changes under OQ5), `packages/h2a/src/vuln-fix/repository.mjs`
  (review posting), test `packages/h2a/test/vuln-fix-cli.test.js`.
- RED: requested schedule/timezone unrenderable by the frozen
  calendar, or review verdicts existing only in local reports → units
  render the OQ5 schedule with escaped paths and no implicit enable;
  verdicts land on the PR bound to the exact SHA.

Branch GH-2 (Actions as execution host):
- Scheduled workflow(s) run the controller on runners; seat transport
  follows the 12/10 GitHub-secret model with refresh cron and periodic
  re-enrolment by the account holder; the D7 authority is reached
  through a concurrency-safe network form qualified in L3 (no
  per-runner local counters); D8/D10 re-qualified on ephemeral runners
  (private profiles, no ambient home, keyring-dependent providers
  refused until qualified there).
- Files: `.github/workflows/` workflow definition in each admitted
  repository or one central repository (placement decided with the
  OQ1 answer, recorded in L0), h2a runner-entry files under
  `packages/h2a/src/vuln-fix/` as needed; systemd rendering is then
  retired, not left as a second scheduler.
- RED: two concurrent workflow runs over-spend the shared cap, or a
  runner executes under an unbound identity → authority refuses the
  second cycle; seat generation mismatch refuses before inference.

Branch GH-3 (platform merge):
- Reviews are GitHub reviews; branch rulesets require the L5 gates as
  required reviews/checks on the exact SHA (plus one owned gating
  check if a D11 condition — age, provenance, lock-only proof — is not
  natively expressible); auto-merge or merge queue performs the merge
  commit; the controller never merges directly.
- Files/settings: rulesets are GitHub settings per admitted
  repository (recorded with receipts, not files); any gating check
  lives in h2a under `packages/h2a/src/vuln-fix/` with tests in
  `packages/h2a/test/vuln-fix-repository.test.js`.
- RED: a candidate with green tests but missing second review,
  stale-SHA review, or D12 failure is auto-mergeable → ruleset/check
  keeps it unmergeable.

Gate: G4 requires one observed run triggered by the real scheduler of
the chosen branch, in the same context as production (service user or
workflow), not a manual shell run alone.
NOT covered: the two unchosen branches; multi-OS runners; waking a
powered-off host (GH-1 Persistent catches up missed runs only).

### L5 — Autonomous merge, fail-closed (new behaviour; #371 ships none)

Owner: h2a maintainer, with each admitted repository's conductor for
its rules. Depends on: L2, L3; placement by L4. Implements D11, which
supersedes the analyses' manual-merge position (V4).

Scope — the merge executor named by OQ1 (controller in GH-1/GH-2,
platform in GH-3) merges a candidate if and only if ALL hold at merge
time, re-read at merge time, on the exact HEAD SHA:
1. Two independent review verdicts exist for that SHA from reviewers
   satisfying the D9 complementarity and usage permissions; any later
   push invalidates them; a blocking verdict or unresolved blocking
   thread stops the merge.
2. Required repository checks are green on that SHA; a required check
   that is missing, skipped, or inconclusive stops the merge (a
   skipped required test is never a pass).
3. The candidate diff is still lock-only, compatible, no majors, no
   new packages; every modified package satisfies D12 (age ≥ 7 days,
   integrity, signatures, provenance as shipped); scanner state after
   the fix shows the targeted HIGH/CRITICAL findings gone without new
   equal-or-higher findings introduced by the change.
4. The baseline was red and the candidate green on the repository's
   required targeted tests (the L6 readiness set), executed under
   D10 isolation.
5. Merge method is a merge commit (standing owner rule: never
   squash); branch protection/rulesets of the repository are satisfied
   without admin bypass; the merge identity's rights are the minimum
   for the admitted repositories and are never lent to agents/tests.
6. Target branch has not moved in a way that changes the proven base
   (re-verify; on ambiguity, stop with a durable reason).
Any failure: no merge, PR left open, state and reason durable and
visible in the daily report as an unfixed vulnerability (D14). Merge
success is recorded with merge SHA and the delivery chain to follow
(publication/deployment per repository readiness, L6). Stop behaviour:
disabling admissions stops new merges; an in-flight merge is never
forced or rolled back by the job.

Files (h2a):
- `packages/h2a/src/vuln-fix/repository.mjs`
- `packages/h2a/src/vuln-fix/controller.mjs`
- `packages/h2a/src/vuln-fix/verify.mjs` (age/provenance re-check at
  merge time)
- `packages/h2a/src/vuln-fix/scan.mjs` (post-fix scanner comparison)
- Tests: `packages/h2a/test/vuln-fix-repository.test.js`,
  `packages/h2a/test/vuln-fix-controller.test.js`,
  new `packages/h2a/test/vuln-fix-merge.test.js` (temporary remotes;
  GitHub-facing behaviour against the L4 branch's real mechanism in a
  qualification repository for the live receipt).

RED first (on the shipped code the merge simply does not exist; the
negative cases are written first and must keep failing to merge after
the lot): candidate with (a) one review, (b) two reviews on a previous
SHA then a re-push, (c) red or skipped required check, (d) a package
younger than 7 days or bad provenance, (e) a major bump or new
package, (f) moved target base, (g) quota for re-verification gone →
no merge in every case. Positive case: all gates true on a temporary
remote → exactly one merge commit, no squash, receipts complete.
Gate: part of G3 (positive recipe ends with an autonomous merge on
the qualification target) and of G6 (first production autonomous
merge under observation).
NOT covered: human-approved urgent merges (OQ4), rollback of a bad
merge (repository process), merges for non-lock changes.

### L6 — Per-repository readiness, enrolment, activation, operation

Owners: each repository's conductor (readiness), account holder
(consent acts only), lab operator (enrolment and activation). Depends
on: L0–L5 for the chain; each repository admitted independently under
D5 once its own readiness passes.

Readiness criteria per repository (all required; "prêt" in D5 means
exactly this list):
1. Tracked npm locks inventoried (example from the analyses: h2a has
   three — root, `apps/focus/package-lock.json`,
   `packages/h2a/focus-kit/package-lock.json`); every manifest
   represented; baseline installs without scripts; fixtures, peers,
   and overrides that break lock-only updates identified and resolved
   or the repository stays not-ready with the reason visible.
2. Required targeted tests expressible in the shipped validator's
   forms (Node/Vitest targeted files). If a repository's real required
   checks are not expressible (the analyses flag sentropic Make and
   container flows), a conformant verification adapter for that
   repository is a prerequisite lot in that repository — copying the
   h2a example is not a verification.
3. Scan/data policy qualified per repository: what OSV receives
   (public-registry package identities), npm audit policy, additional
   scanners configured or explicitly absent; private code sharing with
   each provider of the work pool consented (OQ2).
4. Merge side-effects known (D11 point): what a merge to the target
   branch triggers (publication, pre-production, deployment) is the
   intended effect, with its owner named.
5. Config produced by maintainers: canonical roots, `rhanka/<repo>`
   remotes verified, state outside repositories, worktree ignores,
   publishing identity limited to the admitted repositories and held
   only by the controller (D10).

Enrolment (operator acts; owner only for login/MFA/consent and
billing confirmations; no secret transits a conversation, argv, or
report): lab sessions enrolled through the official circuit (OAuth
default; `--cli` from an explicitly chosen private L1 manifest;
`--token` as a consumer SeatBundle over bounded masked/stdin input —
never a bare provider token), recorded under single-owner renewal;
native auth and gateway routes qualified separately with redacted
receipts; the gateway taking new accounts into account is operated on
the lab gateway only. Daily personal sessions are measured for
coexistence first and enrolment stops if one is disturbed (standing
16/10 rule: « Mes comptes, mesuré d’abord »).

Activation and operation: private config deployed; scan-only pass
first (inventory), then the positive recipe (G3) on one real fixable
candidate per chain configuration (if no real fixable finding exists,
a designated qualification repository with a controlled fixture proves
the path and is reported as a path proof, never as a repaired real
CVE; no vulnerability is ever introduced into a real repository);
then the scheduler of the chosen L4 branch is enabled and its first
scheduled run observed (G4). Daily operation: readable report
(detection → candidate → merge → delivery, refusals, ageing, fairness
across ready repositories — starvation of the last-configured
repository is measured and reported, and a queue-fairness change is
specified if starvation is observed under D6 scarcity); blocked PRs,
quarantines, expired seats, and quota starvation are operator-visible
states with a named responsible, not silent exits. Stop: close
admissions and scheduler, drain own tasks, keep claims, counters, and
proofs. Resume: reconcile remote state and seats first; never erase
counters to regain quota.

Files: per admitted repository — its lock/manifest fixes for
criterion 1, its test-selection or verification-adapter files for
criterion 2 (paths owned and named by that repository's conductor in
L0), plus h2a operator runbook
(`packages/h2a/skills/vuln-fix/references/operator.md`).
Tests: that repository's own targeted files for any adapter it adds;
h2a `packages/h2a/test/vuln-fix-controller.test.js` and
`packages/h2a/test/vuln-fix-repository.test.js` for chain-level cases.
RED first (chain level): a dry-run with no admissible seat can be
reported "ready to fix" → readiness reporting distinguishes scanned /
fixable / fix-blocked; a required test missing or skipped → repository
stays not-ready; an existing duplicate PR → intelligible handoff
state, no second branch.
Gate: G3, G4, then G6 per production rollout.
NOT covered: repositories failing readiness (they wait, visibly, per
criterion, without reducing D5 to the ready subset of today);
repository-specific product work beyond vulnerability locks.

### L7 — Complete the seat finality: five providers × CLI and llm-mesh, real matrices

Owners: h2a with sentropic L1/custody and repository conductors.
Depends on: L1; independent of the first activation (must not gate it,
must not be dropped — C13). Delivers D2 in full.

Scope:
- Live qualification, provider by provider (Claude/claude-code,
  Codex/codex, Muse/muse, Vibe/mistral-vibe, agy/cloud-code), of
  both projections against the real binaries and gateway routes:
  entitlement and billing class proven (Vibe static-key route without
  unapproved paid overage; agy isolated keyring with the real agy
  binary, never substituted by Gemini CLI/ADC/API key; Muse service
  key not presumed to be a CLI login), separate receipts for native
  and mesh (neither proves the other).
- Real NxN inter-CLI matrix replacing the refusing stub, scenario by
  scenario, Linux first; diagonal cells use two distinct seats and,
  for renewable access, two distinct families — copies of one refresh
  token never count as two seats.
- Extend the remediation work pool to several eligible authors
  (rotation actually exercised) by qualifying further no-Claude
  combinations; Vibe/agy remediation launches admitted only with the
  same restriction and cleanup proofs as L2.

Files (h2a):
- `scripts/e2e-cli-seats-direct.mjs` (stub replaced by the real,
  admission-gated path)
- `packages/h2a/test/cli-seat-direct-matrix.test.js`
- `packages/h2a-runtime/src/cli-seat-codecs.ts`,
  `packages/h2a-runtime/src/cli-seat-materialization.ts` (only where a
  provider qualification proves a gap)
- `docs/cli-seat-l2s.md`

RED first: a native cell proven only through the gateway is accepted
as native proof → rejected; an unqualified provider or OS shows as
covered → shown uncovered; a diagonal cell reusing one family twice →
refused. Synthetic tests stay; live cells are operator-run receipts
per cell, absent prerequisite = explicit failure, never a skip.
Gate: G7 — a public coverage table of 5 providers × 2 usages where
every green cell names its receipt; anything else is written
uncovered.
NOT covered: macOS/Windows qualification order beyond the standing
Linux → macOS → Windows priority; provider features outside seat
enrolment and launch.

---

## 7. Gates

| Gate | Closes | Evidence required (command + output, or named receipt) |
|---|---|---|
| G0 | L0 | Inventories complete-or-unknown with resolvers; this specification double-reviewed (D13); no fictitious path/model remains |
| G1 | OQ1 | Owner answer recorded in DECISIONS-owner.md naming execution host and merge executor; L4 branch chosen before its RED |
| G2 | L1–L3 | L1 contract GREEN on published boundary (or V3 conditional proofs filed); L2 identity receipts on lab accounts; L3 integration GREEN against the real authority with D6 amendment applied authority-side |
| G3 | L5, L6 | Positive recipe on the integrated HEAD: baseline red → candidate green, targeted tests executed (none skipped), two reviews on the final SHA, autonomous merge commit on the qualification target, post-fix scan clean for the targeted findings. A dry-run or a clean-repository run never satisfies G3 |
| G4 | L4, L6 | First scheduler-triggered run of the chosen branch observed in production context, with report, refusal/alert path exercised, stop/resume proven |
| G5 | Pre-merge of the #371 evolution | Two independent maximum-effort code reviews on the exact final SHA with findings resolved, targeted tests green on that SHA, full-suite integration result by the conductor; owner NO GO lifted only against G0–G3 evidence (“activable” is demonstrated, not asserted). Activable before merge means the recipe is proven; the durable scheduler (G4) may follow the release |
| G6 | Production autonomy | First autonomous merges on real admitted repositories observed with D14 reporting (detection → merge → delivery) and capacity/fairness state visible; kill switch (admissions closed) tested once |
| G7 | L7 | Coverage table of Section L7 with a receipt per green cell |

Cost and reversibility, stated once: minimum inference is three model
tasks per candidate (plus retries), drawn from D6 capacity; no new
subscription, credit line, or public service is presumed by any lot —
if L0 shows one is needed, it returns to the owner with real prices.
Configuration and scheduler are reversible; spent units and published
versions are not; autonomous merges are bounded by L5 and stopped by
closing admissions.

## 8. Global NOT covered

- Non-npm ecosystems, container image and OS vulnerabilities, vendored
  or generated code, unpublished flaws: the shipped scanners cover
  configured npm trees plus configured additional scanners. « Quelle
  qu elles soient » (D1) is the direction; claiming universal coverage
  from npm/OSV would be false, and each added source is its own lot.
- Major upgrades, new packages, code changes beyond lock files,
  manifest rewrites the shipped guard refuses.
- Zero-day or sub-7-day autonomous correction (D12, OQ4); detection
  faster than daily (5-minute class) and any 15-minute objective.
- Full five-provider rotation, multi-OS matrices, and gateway/native
  completeness at first activation (due in L7, tracked by G7).
- Served-model attestation: reports keep requested and served models
  distinct; no launch alias is treated as proof of the served model.
- Rollback of merged fixes, release management of the target
  repositories, and remediation of vulnerabilities requiring product
  code changes: repository processes, with the job reporting the block.
- Any use of credit/API billing for remediation work, any silent use
  of the owner's daily sessions, any reading of secret values by
  agents, tests, reports, or this specification's evidence.
- Estimates in human engineering days: sizing is done in agent hours
  and review rounds after L0, from measured velocity (standing owner
  rule); no duration from the earlier study is reused.

## 9. Acceptance (owner-visible)

- A1: On a given day, for every ready repository, the run either
  reports no HIGH/CRITICAL npm finding in scope, or shows the
  finding's state (candidate, blocked with reason, merged,
  delivered) — never silence.
- A2: At least one real candidate has travelled detection → autonomous
  fix → two autonomous reviews → autonomous merge → delivery with
  receipts at each step, without owner action between detection and
  delivery (G6).
- A3: Test budgets are intact: the authority shows remediation spent
  only inside the maintenance units, CI and enrolment untouched, and a
  starved day is reported as starved.
- A4: The owner can stop the system with one documented operator act
  (admissions + scheduler off) and can see why every open candidate is
  open.

End of specification. Companion summary: spec-summary.md.





