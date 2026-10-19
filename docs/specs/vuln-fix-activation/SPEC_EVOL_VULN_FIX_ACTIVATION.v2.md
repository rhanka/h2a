# SPEC EVOL — Make the daily vulnerability-fix job (PR #371) activable and autonomous

Status: specification only, v2 after the Astra max and Sol max reviews.
No implementation, live qualification or activation is claimed here.
Date: 2026-10-18. Sources cut-off: owner entries of 2026-10-18 ~11:30 plus the
follow-up « Dans gh » recorded immediately after (see Section 2).
Revision evidence and the treatment of all 18 review remarks are in
SPEC_EVOL_VULN_FIX_ACTIVATION.v2-changes.md; the original specification is
preserved unchanged.

How to read the source tags. Each separately labelled requirement or
proposal carries its own tag:

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
The technical execution sheets, state transitions and acceptance sequence
introduced below are `[proposition-not-validated]`, not additional owner
verbatim. Passing their checks never invents an owner authorization.

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
| I7 | ../rv371a-last.md (Astra max), ../rv371s-last.md (Sol max), both reviewing original sha256 c476ca3a9f3bd7d753f9e59afad27aa9ae6d60384cc00b89ca1654c6db27725f | Independent review inputs; checked against the sources listed in the French change table, not treated as owner decisions |

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
ambiguous. It is NOT decided in this specification; OQ1 asks about the
responsibilities and outcomes expected from GitHub. Execution placement,
orchestration, traceability and merge enforcement are separate dimensions,
with compatible combinations, not three exclusive answers. No dependent
lot may silently select a combination.

Review clarification recorded on 18/10 ~03:25: the journal distinguishes
specification reviews (Astra max + Sol 6.1 max) from code reviews
(Sol 6.1 xhigh + Astra max). This later allocation governs D13; the
17/10 assignment alone is not the complete review rule.

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
| C10 | Controller publishing credentials must stay inaccessible to native CLI, model tools and candidate tests; the authenticated native CLI still needs its admitted seat capability. Current tests inherit the parent environment, and environment filtering alone does not isolate files/processes. Access-only consumer expiry/401 = unavailable; the separately admitted serialized native delegate remains under central custody. | D8/D10, L3 isolation and L3-R renewal/delivery proofs |
| C11 | The owner must not become the integrator (no fictitious authority path, no EXACT_APPROVED_MODEL placeholder, no owner-written config or systemd install). Maintainers deliver; the owner arbitrates capacity, accounts, rights. | Lot L0 ownership |
| C12 | Old reviews (rev371, rev371b-last) target older SHAs; their findings are neither proven open nor proven closed on the final HEAD. A fresh double review on the integrated HEAD is required. | Gate G5 |
| C13 | The full five-provider × CLI+mesh matrix, multi-OS qualification, 5-minute detection, and image/OS remediation must not gate the first activable cycle, and must not be dropped either. | Lot L7 separate; global NOT covered |

### 3.2 Divergences, kept explicit

| # | Divergence | Sol | Astra | Treatment in this specification |
|---|---|---|---|---|
| V1 | Freshness of the publication state | Local Git references only; explicitly no npm registry read; notes even 0.26.1/0.18.0 historically lacked the APIs | Read the public registry on 18/10: llm-mesh latest 0.26.1, cluster-mesh latest 0.19.0; the three import methods absent from the examined surfaces; h2a pins remain 0.26.0/0.16.0; sentropic #681 open draft | Astra's observation is the more recent evidence and is used for L1's starting state. It must be re-checked at build time (L1 RED resolves the actually adopted packages). Sol's caution stands: a compatible publication would shrink L1 but never replaces adoption + recipe. |
| V2 | State of #371 on GitHub | No real-time GitHub claim | Open, draft, 15 checks SUCCESS on 3e0cbc7e3; merge base with main lacks #348, so a rebase is required before the integrated recipe | Astra's facts are used; L4/L6 start from a rebase onto main containing #348. CI green is recorded as proving neither accounts, quotas, nor timer (both agree). |
| V3 | Is the mesh import (L1) on the critical path of the first pilot? | Keeps the shared integration in the recommended path; a direct CLI pilot must not claim the dual use as acquired by bypass | Admits a native pilot before the full mesh delivery IF lab native projections, the common quota authority, and single-owner renewal already exist and are qualified; forbids a new local vault or silent use of personal logins as the bypass | Reconciled as a conditional: the pilot MAY precede L1 completion only with the three proofs Astra names at G2, including L3-R renewal, delivery and next-generation consumption receipts (serialized delegation if required); otherwise L1 is on the path. The custody proof is mandatory on either path, never waived by a successful import. A parallel vault/counter is forbidden and dual use stays due in L7. The condition is `[proposition-not-validated]`. |
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
  (« S il n dst pas activable il ne sert a rien »). The standing NO GO
  on merging #371 is not lifted by a dormant delivery or by this revision.

  **Proposed acceptance sequence for D3. `[proposition-not-validated]`**
  Before the #371 evolution can be proposed for merge, G0–G3 establish
  end-to-end activability on the integrated candidate and qualification
  target, with the resolved execution/scheduler/merge configuration and
  ready deployment artefacts. G5 adds the final code reviews and
  integration evidence; technical evidence alone does not revoke the
  standing owner NO GO. After release/deployment, G4 establishes actual
  scheduled activation; G6 establishes production autonomy and delivery.
  Reports distinguish these three stages: activability proven before
  merge, scheduled activation observed, production acceptance achieved.
  G4/G6 are not pre-merge prerequisites; they remain required before
  claiming the job operationally accepted. This is a proposed technical
  sequence, not a new interpretation attributed verbatim to the owner.

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
  named. Access-only native consumers and all mesh consumers never refresh: expiry or
  401 means unavailable, with no fallback. If a pinned native CLI rejects
  access-only operation, reuse `serialized-stream` (shared spec-v10
  §3.4 and #348): one bounded native delegate, one family ticket under
  the central authority, successor capture after all its children stop,
  durable save and later-run verification before any next use. This is
  not independent consumer refresh or a second grant copy; mesh remains
  refresh-less. Enforced by: L2 and L3-R.

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
  The publishing identity (push/PR/merge) belongs only to deterministic
  controller control code, which executes no candidate code. The trusted
  native CLI authentication process needs its admitted seat capability;
  that permission does not give it publishing rights or let model tools
  and candidate tests read authentication material. A private HOME and
  an environment allowlist alone do not separate same-UID processes,
  files, descriptors or capabilities. Masking is defence in depth.

  **Process capability contract. `[proposition-not-validated]`**

  | Process/role | Permitted capability | Required exclusions |
  |---|---|---|
  | Deterministic controller publication/merge control | GitHub publishing rights limited to admitted repositories; non-secret admission and evidence references | No native/provider login or candidate execution in this role; no checkout credential residue passed downstream |
  | Central custody maintenance / bounded serialized native delegate | Selected family's canonical material only in its designated trusted role; one exclusive family ticket, successor capture and L3-R handoff | No publication, custody-writer or delivery/dispatch capability in the native process; no concurrent refresher; no grant exposed to model inputs/tools |
  | Trusted native CLI author/reviewer authentication process | Qualified access-only or static-key projection of the admitted seat; serialized delegation only through the preceding role when required | No controller writer, ambient login, credit fallback or independent renewal |
  | Model-visible tools, MCP children and candidate commands | Workspace-scoped editing/review tools and non-secret evidence only | No direct provider credential, canonical store, writer, delivery/dispatch or controller process/file access |
  | Candidate installer/verifier and test descendants | Candidate tree, public dependency inputs and temporary state only | No seat/provider/refresh/credit or publishing credentials, including via files, process views, sockets, descriptors and Git credential helpers |

  Reuse #348 materialisation/MCP filtering and the shared custody
  role-separated execution pattern (spec-v10 §3.5); they are capital,
  not evidence that #371 already enforces this boundary. L0 must name
  the existing confinement/runner adapter and its exact source/test
  paths for the chosen placement. On Actions, reuse fresh isolated
  runners per role with explicit secret/permission references. For a
  lab execution path, reuse a qualified filesystem and process boundary
  denying controller/profile access to tools/tests; another HOME or
  unconfined same-UID subprocess does not qualify. If that adapter is
  missing, its bounded delivery is a blocking L3 prerequisite in the
  owning repository, not an invented implementation or a new vault.
  No writer/control endpoint or inherited descriptor may restore the
  denied capability. L3 tests environment, file, process and capability
  canaries. This bounded separation does not restore the general
  B9/B10 laboratory gate removed on 13/10.

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
  in reporting. Transient failures have durable autonomous re-evaluation
  under L5; an existing job-owned PR is not a permanent conductor
  handoff. Foreign PRs and ambiguous ownership remain separate operator
  states. Where the autonomous acts execute is OQ1.

- **D12 — Package trust rules as shipped. `[both analyses]`**
  Minimum age 7 days for every modified package, integrity/signature/
  provenance verification, lock-only changes to already-tracked
  compatible locks, no majors, no new packages, refused origins refused.
  No urgent-age exception exists in the shipped behaviour; creating one
  is OQ4 and must never be smuggled in to make a recipe pass. Reported
  plainly: a CRITICAL fix published yesterday waits, so the daily job
  is not a zero-day SLA.

- **D13 — Review discipline for this evolution itself. `[owner verbatim]`**
  The 18/10 ~03:25 journal entry requires two independent specification
  reviews before code: **Astra max + Sol 6.1 max**. Before code merge,
  the pair is **Sol 6.1 xhigh + Astra max**. These are separate
  allocations, not two uniformly maximum-effort code reviews. Qualify
  the exact model identifiers and technical effort mapping under OQ3;
  do not silently substitute a lower effort or relabel it "max".
  Reviews bind the exact final specification revision/digest or code
  SHA; historical reviews on older revisions do not count (C12).
  Enforced by: G0 for the specification, G5 for the code. The two
  original-spec reviews are inputs to this v2, not approval of v2.

- **D14 — Detection reporting and measurement. `[both analyses]`**
  Reporting measures detection → candidate → merge → delivery, with
  per-repository state, capacity refusals, and ageing visible. An open
  PR, a draft held by D12, or a quota refusal is never counted as a
  fixed vulnerability. Findings of unknown severity stay visible.
  Enforced by: L6 reporting acceptance.

---

## 5. Open questions

An open question blocks exactly the lots named with it, nothing else.
Owner questions remain open questions about principles, with context and
consequences. Conductors translate the answer into an execution contract;
technical examples below are compatible combinations, not forced choices
or owner requirements. This follows the 18/10 ~10:20 recadrage against
binary design questions.

### OQ1 — Responsibilities expected from GitHub (owner principles required; blocks L4 and the placement-dependent half of L6 activation)

Owner statement, literal: « Dans gh », given as a precision on
« Fix + revue autonome ». Recorded gloss: the autonomous fix and review
take place in GitHub. The open question is: **What responsibilities and
observable outcomes do you expect GitHub to carry for the daily job —
orchestration, execution, review traceability and merge enforcement — and
what custody, availability and operating principles must that respect?**
No answer is inferred here, and no binary host/merge questionnaire
replaces this question.

The conductors then document these dimensions separately:

| Dimension | What the technical contract must establish |
|---|---|
| Orchestration and schedule | Responsible scheduler, workflow/control repository, daily trigger, timezone, catch-up, retry/reconciliation wake-up and stop/resume ownership |
| Execution placement | Hosted ephemeral runner, managed isolated lab runner, or admitted lab service; exact security boundary and lifecycle per role, D8 identity and D10 separation |
| Traceability | GitHub PRs, SHA-bound review objects/evidence, required checks, durable refusal reasons and links to redacted custody/admission receipts |
| Merge execution and enforcement | Controller API operation or GitHub auto-merge/queue; L5 gates, merge-commit support, expected-head protection and revalidation on queued/base changes |
| Custody and operation | Existing central store/renewal/delivery, account-holder consent, runner availability, allowed egress, rights, costs and emergency stop |

Illustrative combinations, all `[proposition-not-validated]`:

| Combination | Execution and scheduler | Merge executor (separate dimension) | Consequences |
|---|---|---|---|
| Lab service with GitHub records | Qualified lab roles, shipped host timer adapted under OQ5 | Controller or platform, independently qualified | Reuses host scheduling and seat delivery; depends on host availability. Records alone may not meet the owner's execution expectation and are not presumed sufficient. |
| Actions with hosted isolated runners | Actions cron/continuations, fresh runner per role | Controller or platform | GitHub owns orchestration; custody/delivery to runners, profile/keyring support, authority access and costs must be qualified. |
| Actions with managed lab runners | Actions cron/continuations, isolated role runners administered in the lab | Controller or platform | Keeps Actions orchestration and lab execution together; does not inherently require transferring seats to hosted runners. Runner connectivity, availability, isolation and central custody delivery remain to prove. |

The old GH-3 idea (platform merge) composes with any execution row; it
does not resolve execution or scheduling by itself. The L4 execution
sheet must name the full combination, including scheduler, before code
for that placement starts. Platform merge requires all L5 conditions as
native rules or an owned required gate, with revalidation when queued
state changes; availability of these settings is not presumed.

D1/D2/D5–D12 remain unchanged. L0–L3 and L5's placement-independent gate
contract can progress; placement-specific adapters, secret delivery and
enabling schedules wait for the owner principles and their documented
technical derivation. Neither systemd nor Actions is silently chosen.

### OQ2 — Exact repository inventory (conductor-produced; owner only for exclusions)

Analyses name h2a, sentropic, radar-immobilier, graphify; the
graphify/engram correspondence, private repositories, fixtures, and
per-repository data-sharing consent are unconfirmed. L0 produces the
inventory with readiness state per repository (L6 criteria); the owner
is asked only about exclusions or unestablished consent, never to type
the list. Blocks: L6 admission of each unnamed repository, not the
chain itself.

### OQ3 — Exact models, efforts, and live availability for the work pool (technical, resolvable without the owner)

The shipped effort set is low/medium/high/xhigh; owner vocabulary includes
"max". Qualify exact model identifiers and effort mapping for the Muse
author, the two Codex code reviewers (Sol 6.1 xhigh + Astra max), and
the distinct specification-review pair (Astra max + Sol 6.1 max).
Resolution: L0/L2 qualify the strings against the admitted binaries and
authority; a flattering label, invented value or silent downgrade is a
defect. Requested model is not attestation of served model; report both
separately. Live quotas are decided by admission, not a static registry
note. Blocks: L2 closure and the relevant D13 review gate.

### OQ4 — Urgent exception to the 7-day age rule (owner answer required ONLY if an urgent path is wanted)

Shipped behaviour blocks every younger package (D12). Open principle:
**What urgency, exposure, trust and accountability principles should
govern any exceptional response when a fix has not matured seven days?**
Consequences to study include detection cadence, acceptable exposure
while waiting, evidence freshness, exception authority and auditability;
no urgency makes invalid signatures/provenance acceptable. The conductors
would derive a bounded policy or exact-candidate proposal from those
principles. No exception is created here. Not blocking: activation and
automatic maturation re-evaluation proceed under D12 as shipped.

### OQ5 — Schedule details under the chosen host (operator proposition, announced, reversible)

Shipped rendering is 03:00 machine-local with up to 15 min jitter and
Persistent catch-up; per-day limits count in UTC. The study's
07:17–12:59 UTC routine window is a study proposition, not an owner
rule. For an Actions scheduler, cron is UTC regardless of runner location. The operator
proposes the final time and timezone in the runbook (L4), consistent
with quota windows; an owner decision is needed only if a window
conflicts with test-matrix usage. Blocks: nothing once OQ1 is answered.

---

## 6. Lots

Rules for every lot: RED first — the named test is written and observed
failing for the stated reason on the pre-lot tree before any fix, then
observed passing after; command, exit code, and output are kept for
both runs. This concerns a regression/new capability in the lot's own
code, not a requirement that every dependency candidate fail its business
tests before a fix. For a new capability absent from the baseline, its
positive scenario must fail initially; a pre-existing "no merge" result
does not prove a new guard (L5). Targeted test files only (`node --test <file>` /
`vitest run <file>` forms used by the owning repository); the full
suite is the conductor's integration step, never the lot's claim.
Temporary directories only in tests; a test that silently skips for
missing real state is a failure. Live qualification on real lab
accounts is an operator act with redacted receipts, separate from the
synthetic tests, and is named as such in each gate. Model-visible inputs,
tools, tests and evidence never read or print secret values; only the
admitted trusted authentication/custody roles consume their capability
privately under D10. This specification revision reads no secret.

**Mandatory execution sheet before each code lot.** L0 records the exact
owning repository/checkout and base revision; exact source paths (with
existing/new status); explicit test files and working directory; interface
operations and request/receipt/refusal contract; the literal targeted
command, expected failing assertion and output; dependencies, maintainer
and closure receipt. Source paths are resolved before the lot starts,
not discovered after its RED. Published package inspection may establish
an API gap but never substitutes for editable source/test paths.
Any unresolved owner, path, adapter, interface or command blocks that
dependent lot. Documentation inventory may proceed with a named resolver;
it does not authorize code, deployment or activation.

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
- Produce and verify the mandatory execution sheet above for every
  code lot and prerequisite, including sentropic L1 source/publication,
  quota/custody and L3-R renewal/delivery, the D10 confinement adapter,
  L4's selected entrypoint/workflow/merge gate, and every L6 repository
  verification adapter. For existing h2a files, confirm the paths below
  on the actual integrated base and record each literal command (for
  example `rtk node --test packages/h2a/test/vuln-fix-merge.test.js`
  from the h2a root; `rtk npx --no-install vitest run
  packages/h2a-runtime/src/vuln-seat.test.ts` from its qualified test
  root). Record real commands for the owning repository; do not assume
  an unavailable test runner. Sentropic source/test paths not evidenced
  here remain blocking dependencies, never "dist plus counterparts".
- Freeze the non-secret seam contracts: L1 import owner/generation and
  refusal semantics; admission `status` and atomic cycle reservation;
  custody generation/stream-ticket/save/verify/delivery handoff;
  confinement launch/result/cleanup; L5 owned-PR reconcile, SHA-bound
  evidence and merge idempotency. Map them to exact owning source/test
  files and commands; a copied request JSON is not an implementation.
- Rewrite the #371 contract and operator reference so that owner
  statements (Section 2), this specification's decisions, and the
  remaining gaps are one consistent activation sheet: no fictitious
  authority path, no "merge now, configure later".

Files (h2a):
- `docs/specs/SPEC_EVOL_DAILY_VULN_FIX.md`
- `packages/h2a/skills/vuln-fix/references/operator.md`

RED: none (documentation only). An explicit unknown with a resolver is
valid inventory progress, not an executable contract. G0 for a dependent
lot requires its execution sheet fully resolved before that lot starts;
global G0 before G3/G5 requires all first-activation sheets resolved.
The D13 specification reviews must cover the final revision, not merely
v1. Nothing here claims that this v2 has already passed them.
NOT covered: any enrolment, deployment, or activation.

### L1 — Published L1 seat import, adopted by h2a

Owners: sentropic L1/custody maintainer (publication), then h2a
(adoption). Depends on: L0. Conditional per V3: the first native cycle
may precede L1 completion only if gate G2 evidences qualified native
projections + the common authority + single-owner renewal without it;
L1 remains due under D2 regardless. The renewal proof includes L3-R.
Code starts only after the lot's G0 execution sheet is resolved.

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
- sentropic: the L0 sheet must enumerate the exact editable source,
  package export and test files for both packages and their publication
  boundary, plus the literal targeted commands. These paths are not
  established by the supplied analyses: this upstream code lot remains
  blocked until they are resolved. The registry artefacts examined by
  Astra are historical evidence only, never an editing target.
- h2a: `packages/h2a-runtime/src/llm-mesh-accounts.ts`,
  `packages/h2a-runtime/src/index.ts` (enrolment command),
  `packages/h2a-runtime/package.json` (pins),
  `docs/cli-seat-l2s.md` (delivery wording updated, reservations kept).
- h2a (new test): `packages/h2a-runtime/src/cli-seat-published-l1-contract.test.ts`.

RED first: from the qualified h2a test root, `rtk npx --no-install vitest run
packages/h2a-runtime/src/cli-seat-published-l1-contract.test.ts` against the currently
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
- Qualify capability per pinned CLI/OS: `access-only`, `static-key` or
  `serialized-stream`. Where access-only is rejected, reuse #348's
  `beginSerializedStream` / materialisation delegate /
  `captureSerializedResult` / `validateStreamClearance` under L3-R's
  central custody protocol. Do not declare a native path qualified by
  importing its mesh projection, or let an authenticated native process
  lend its capability to model tools or tests (D10).
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
access-only expiry/401 yields unavailable with no fallback, while a
required serialized native path closes only with L3-R's successor proof.
NOT covered: rotation across several eligible authors (due later,
tracked in L7 backlog note), Vibe/agy remediation launches, served-
model attestation beyond requested-vs-served distinction (OQ3).

### L3 — One real quota/scope authority; whole-cycle reservation; effective credential separation

Owners: custody/quota maintainer (authority implementation, owning
repository and exact files/commands resolved in L0 — the existing shared
line, never a new h2a-local counter), h2a (client seam), and the maintainer
of the reused confinement/runner boundary. Depends on: the fully resolved
G0 sheets for these components and L2 binding contract. L3-R below is a
mandatory closure component, including on V3's native-first path.

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
- Enforce D10's role table at the execution boundary, not only in env:
  deterministic controller/publication and custody writer roles execute
  no candidate code. The native authentication role receives only its
  admitted seat capability. Model tools, installers, candidate tests
  and descendants have neither that credential nor control credentials.
  Reuse the existing role-separated runner/confinement adapter named in
  L0. Its filesystem and process view excludes controller homes, auth
  files, Git helpers, mounts, sockets, inherited FDs and control process
  environment; deny controller writer/dispatch endpoints and lateral
  capability acquisition. A local adapter lacking these properties is
  an explicit blocking prerequisite, never an env-only substitute.
- Verify the exact deployed boundary in the selected placement with
  synthetic canaries in environment, private files, inherited capability
  attempts and a spawned synthetic controller process. A same-UID
  verifier able to read any such canary fails G2, even if its child env
  is clean. Under Actions, use fresh isolated role runners and the
  shared workflow contract on secret/permission references; under lab
  execution, qualify the selected filesystem/process boundary. No claim
  relies on a worktree or private HOME alone. Limits of reviewed
  workflow conventions against an administrator remain those accepted
  in spec-v10 §3.5, not a stronger platform guarantee.

Files:
- Authority and confinement implementations: exact owning repositories,
  source/test files, seam schemas and literal targeted commands must
  already be in the G0 sheets before their code starts. If either
  implementation is absent, deliver the bounded missing component on
  its existing shared line with its own RED, before L3 can close.
  Unknown locations block that component; no h2a look-alike (D4).
- h2a: `packages/h2a/src/vuln-fix/seats.mjs`,
  `packages/h2a/src/vuln-fix/controller.mjs`,
  `packages/h2a/src/vuln-fix/repository.mjs` (verifier launch boundary),
  `packages/h2a-runtime/src/vuln-seat.ts` and
  `packages/h2a-runtime/src/cli-seat-materialization.ts` (native/tool
  separation; source reuse, not a confinement claim by itself).
- Tests (h2a): `packages/h2a/test/vuln-fix-seats.test.js`,
  new `packages/h2a/test/vuln-fix-seat-authority.test.js` (integration
  against the real authority implementation in temporary state),
  `packages/h2a/test/vuln-fix-repository.test.js`,
  `packages/h2a/test/vuln-fix-controller.test.js`.

RED first:
1. Concurrency: remediation + CLI test + gateway test racing for the
   last admissible budget → no double-spend; whole cycle reserved or author never
   starts; refusal at reserve ≤ 20%, unknown quota, wrong workspace,
   digest, seat, or generation; enrolment units never spent
   (`vuln-fix-seat-authority.test.js`).
2. Non-promoted capacity: authority without the D6 amendment → zero
   remediation starts (`vuln-fix-seats.test.js`).
3. Boundary: run ordinary candidate code and native tool/MCP descendants
   through the exact adapter against a synthetic control role. On the
   old path, demonstrate access to an env/file canary; after correction,
   all env/file/process/FD/socket capability probes are denied, including
   `/proc/<spawned-control-pid>/environ`, `root` and `fd` routes where
   applicable. The harness itself must prove the canaries were present
   and readable to the control role; an absent path or non-executed
   probe is failure, not isolation. Positive control: the admitted CLI
   authenticates using only its synthetic projection, and the verifier
   executes a real targeted test and returns results. Record booleans
   and categories only, never canary contents; reports/review inputs
   contain neither raw nor encoded canaries
   (`vuln-fix-repository.test.js`, `vuln-seat.test.ts`, and the exact
   adapter tests frozen by L0). All processes/PIDs are spawned by the
   test; all state, including XDG_RUNTIME_DIR, is created in temporary
   directories. No probe targets owner state or unrelated processes.
   Retain separately identified negative guards without claiming that
   every guard already reproduced a baseline exploit.
Gate: completes the quota/separation part of G2 with L2 and L3-R
receipts. Unit fakes do not close L3: integration runs the real authority
and real boundary adapter against synthetic temporary state, followed
by redacted operator qualification for the actual admitted placement.
NOT covered: provider-side turn accounting proof (one local unit vs
several internal provider requests) — measured during L6 and reported,
never assumed; urgent-unit protections of unchosen capacity B.

#### L3-R — Central renewal, successor delivery and next consumption (mandatory prerequisite)

Owner: existing sentropic custody/renewal/delivery maintainer, with the
h2a native consumer maintainer; owning repositories, exact source/test
files and targeted commands must be resolved by L0 before any code here.
This sublot reuses spec-v10 §§3.3–3.5, the selected central store and
#348 stream primitives. A successful initial import, a local family lock
or a quota receipt is not proof of operational renewal or delivery.

Scope and closure:
1. Prove the sole authority's maintenance path: persist pending intent,
   maintain only the selected family under exclusion, capture/seal the
   successor, save canonical before projections, and verify the exact
   epoch/generation/operation in a newly queued later run (where the
   shared store has queue-time snapshots). Only then activate/deliver
   it to the admitted native/mesh consumer; never infer delivery from
   a PUT acknowledgement, timestamp or same-run stale snapshot.
2. Prove N → N+1 → actual next native consumption for the renewable
   initial work-pool seats under G2. The mesh next-consumption receipt
   is also mandatory before live mesh use is admitted or that provider's
   dual use is advertised in L7. L1's published synthetic import
   contract alone does not prove it. Native renewal is never waived
   by V3's deferral of mesh integration.
3. If the real pinned CLI needs `serialized-stream`, centrally record
   one family ticket, drain other family users, admit one bounded
   native delegate with no writer, capture after its entire own tree
   stops even on scenario failure, then seal/save/deliver/verify the
   successor before the next turn. An unchanged state clears only its
   exact validated ticket; ambiguity/lost successor fences the family
   and alerts for controlled recovery/re-enrolment. No replay of N or
   concurrent consumer refresher is a recovery method.
4. Name the deployed renewal schedule, delivery consumer/receiver and
   responsible operator. Prove restart/lost-dispatch recovery resumes
   pending save/verification without repeating an uncertain provider
   refresh. On expiry/401, consumers stop; only the central lifecycle
   path can restore availability, never a personal-home/credit fallback.

For a verified static-key capability, qualify validity/expiry policy and
controlled replacement, delivery and next consumption instead of
inventing OAuth refresh. An unchanged serialized turn retains its
credential generation and bundle operation ID while validating the
distinct stream ticket, as in spec-v10 §3.4; it does not manufacture N+1.

Files (h2a, where the consumer seam needs changes):
`packages/h2a-runtime/src/cli-seat-materialization.ts`,
`packages/h2a-runtime/src/vuln-seat.ts`,
`packages/h2a-runtime/src/llm-mesh-accounts.ts`;
targeted tests `packages/h2a-runtime/src/cli-seat-materialization.test.ts`
and new `packages/h2a/test/vuln-fix-seat-lifecycle.test.js` for real shared
custody/consumer integration. Upstream source, workflow and test files
must be enumerated in the G0 sheet; spec-v10's proposed test names are
not assumed to exist in an adopted source tree.

RED: the next invocation still sees stale generation N or cannot obtain
N+1 after maintenance; a serialized native turn cannot finalize and
resume under the central handoff. GREEN: real implementations, synthetic
temporary state and a controlled clock exercise renewal, later-run
delivery verification, next consumption, failed-scenario write-back,
crash/restart, duplicate delivery and stale-generation refusal. Operator
receipt then proves the initial pool's real renewal/delivery/next-use
path with non-secret metadata only. Missing required capability or an
unexercised serialized path when required blocks G2. A provider not
needing serialization is explicitly recorded as qualified access-only
or static-key, not credited with an unrun serialized proof.

NOT covered: loss of a provider grant cannot be repaired without its
controlled re-enrolment when no usable successor exists; additional
providers' live lifecycle receipts remain open in L7. No second vault,
renewal service or quota ledger is introduced.

### L4 — Compose orchestration, execution and merge placement (CONDITIONAL on OQ1)

Owner: h-cond / operator, with per-repository conductors for rulesets.
Depends on: recorded OQ1 principles and their technical derivation,
fully resolved G0 sheet, L2/L3/L3-R and L5 gate contract. Documentary
inventory may proceed; placement-specific code and deployment wait.
Record the full combination before RED: control repository, exact
workflow/entrypoint, execution role boundaries, scheduler and wake-up
policy, custody delivery, GitHub traceability and merge executor.
Execution and merge below are composable dimensions, not exclusive
branches. Platform merge alone is not a complete placement contract.

Common work:
- Integrate #371 by rebase onto main containing #348 (V2); verify the
  old JSON masking, mask-before-truncate and TODO regressions on the
  integrated HEAD using their exact targeted files, recorded in L0.
- Publish reviews as SHA-bound GitHub review objects with redacted
  evidence links. Freeze the reviewed release/config/runbook paths and
  drain/stop/resume behaviour, preserving claims, counters, pending
  candidates and custody operations.
- Name one effective scheduler/admission owner for each target; do not
  run a host timer and Actions schedule independently for the same
  daily work. The selected scheduler also wakes L5's durable pending-PR
  reconciliation after checks/maturation, including after restart.

Execution placement, derived from the principles:
- **Lab service:** qualified isolated roles on the designated lab
  executor; host timer rendered under OQ5. Existing h2a sources:
  `packages/h2a/src/vuln-fix/cli.mjs` and
  `packages/h2a/src/vuln-fix/repository.mjs`; targeted files
  `packages/h2a/test/vuln-fix-cli.test.js` and
  `packages/h2a/test/vuln-fix-repository.test.js`. L3 names the actual
  confinement adapter; this lot does not infer it from systemd.
- **Actions on hosted runners:** a scheduled/continuation workflow
  reuses the central custody secret/delivery circuit and fresh isolated
  runners per role. Qualify D8/D10/L3-R there; private profiles,
  keyrings, authority reachability, egress and costs are explicit.
- **Actions on managed lab runners:** the same orchestration uses
  administered isolated lab runners and qualified custody delivery.
  No presumption of hosted-runner seat transport; persistent same-UID
  jobs sharing credential/process views do not satisfy D10. Qualify
  runner availability and residue cleanup as well as the common gates.

For either Actions placement, proposed new exact paths are
`.github/workflows/daily-vuln-fix.yml` in the control repository chosen
by the conductors, and h2a
`packages/h2a/src/vuln-fix/runner-entry.mjs` with
`packages/h2a/test/vuln-fix-runner-entry.test.js`. L0 must resolve the
owning repository, ref, exact role/workflow dependencies and literal
targeted workflow/entrypoint test commands before this code starts;
these named proposals do not stand in for that missing execution sheet.
Unused host scheduling stays disabled; its mere rendering is not a
second active scheduler.

Merge execution, independently composed with the execution placement:
- **Controller merge:** deterministic control invokes the GitHub merge
  operation under L5 with expected-head protection and branch rules;
  no publishing capability crosses to agents/tools/tests. Sources and
  targeted tests are L5's exact files.
- **Platform merge:** GitHub reviews/rulesets require every L5 gate on
  the exact SHA; an owned required check supplies conditions not
  natively expressible. Auto-merge/queue must support merge commits,
  revalidation and same-SHA reviews, including queued/base changes.
  Settings are per-repository receipts. Proposed new h2a source/test:
  `packages/h2a/src/vuln-fix/github-gate.mjs` and
  `packages/h2a/test/vuln-fix-github-gate.test.js`. The L0 sheet binds
  the actual workflow/settings caller and exact targeted command;
  unavailable rules or merge-commit support leave the repository
  not-ready, without an admin bypass.

RED: a requested qualified schedule/continuation cannot be rendered or
triggered, a valid SHA-bound review never reaches GitHub, or a fully
admissible candidate never reaches the selected merge executor → the
positive selected path works, with no implicit enable. Guards also
cover unbound identity/generation, double admission, missing/stale
review and age/provenance refusal; pre-existing refusals are guards,
not claimed baseline regressions. All source/test paths and commands
are the exact ones frozen by G0, not directory-level placeholders.

Before merge (G3/G5): artefacts and their qualification execution are
ready for the chosen complete configuration. After release/deployment,
G4 requires one real scheduler-triggered run in the production service
or workflow context, with report and stop/resume proof. A manual shell
run alone does not establish G4.
NOT covered: unselected placements, multi-OS runners, waking a powered-
off lab host (Persistent catch-up is not wake-up), or an unqualified
platform merge mode.

### L5 — Autonomous merge, fail-closed (new behaviour; #371 ships none)

Owner: h2a maintainer, with each admitted repository's conductor for
its rules. Depends on: L2, L3; placement by L4. Implements D11, which
supersedes the analyses' manual-merge position (V4).

Scope — the merge executor derived from OQ1 and frozen in L4
(controller or platform, independently of execution placement)
merges a candidate if and only if ALL hold at merge
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
4. Verification distinguishes three evidence classes, all under D10:
   - Vulnerability audit/scan: the baseline contains the targeted
     HIGH/CRITICAL finding and the candidate removes it (audit RED →
     GREEN, with scanner completeness and the comparison in point 3).
   - Ordinary required functional/non-regression targeted tests (L6
     readiness set): baseline GREEN → candidate GREEN. An already
     passing baseline is normal for a dependency-only correction.
   - An applicable, explicitly identified regression marked
     `redBefore: true`: baseline RED for the asserted defect →
     candidate GREEN. This exception is never made mandatory for
     ordinary candidates. Failure to install/execute, missing real
     state, a skipped/TODO test or unrelated failure is not a valid
     regression RED. All required candidate tests must actually pass.
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

**Durable autonomous re-evaluation.** Reuse the existing controller
claims/state and lock, extending them rather than adding a parallel
controller. Before new candidate/inference admission, and independently
of a clean new scan or the per-day anti-repeat key, reconcile each
job-owned pending PR with GitHub. Ownership requires the persisted
repository/branch/PR linkage and expected commits, not just the branch
prefix. Foreign/manual PRs or ambiguous publication/ownership remain
explicit operator/quarantine states; do not adopt or duplicate them.

Persist, outside ephemeral worktrees: repository and PR identity, branch,
baseline/target base and candidate SHA, proof/guard/test-set digests and
receipts, author/reviewer identities and used admissions, package
publication times, blocking reason, next eligible reevaluation time,
and merge intent/result. This contains metadata/evidence references,
never credentials. At least these states and transitions are covered:

| State/reason | Autonomous next step |
|---|---|
| `waiting-checks` (required check missing/pending) | Persist and stop cleanly; trusted schedule or check-completion wake-up re-reads remote head, reviews, required checks and all L5 gates; still missing/skipped is not green |
| `waiting-age` (known valid package below seven days) | Persist the maturation deadline; at/after it, re-fetch trusted metadata and provenance plus all merge gates; no age override or new author merely for elapsed time |
| `waiting-admission` / temporary authority or API outage | Retain the same candidate and reasons; bounded retry/backoff under the selected L4 scheduler; reserve new work only when it is actually required and admitted |
| `needs-revalidation` (head/base/verification contract changed or evidence invalid) | Invalidate affected proofs, re-verify the new exact base/head and obtain new reviews on a changed candidate SHA; no stale proof can authorize merge |
| `blocked-review` / permanent guard failure / quarantine | No merge; durable named reason and responsible party. Do not repeatedly spend inference without an admissible changed input or a bounded recovery action |
| `merge-pending` → `merged` | Record intent, revalidate gates and expected head immediately before the selected merge operation; reconcile remote merge status before any retry |

On unchanged SHA/base and still-valid evidence, waiting for age/checks
does not rerun the author or the two already completed reviews. Reuse
those immutable SHA-bound receipts while re-reading current gates;
only actually required new inference is admitted against current shared
quotas, with additional reservation and accounting. Restart, polling and
UTC midnight never reset claims/counters, recreate the candidate, or
silently charge the same completed tasks again. Expired seat/generation
blocks new work, not a licence to switch to ambient credentials.

Duplicate events and crashes (including after a merge request but before
its local acknowledgement) reconcile the remote result and persistent
intent before acting. Require expected-head protection and exactly one
merge effect; already merged records its merge SHA without another
author/review/merge. Platform auto-merge is not exempt from same-SHA,
base/queue and gate revalidation. Disabled admissions suspend merges
as well as new author work; observing/reporting existing state remains
possible. Lost state or uncertain proof stays blocked, never guessed.

Files (h2a):
- `packages/h2a/src/vuln-fix/repository.mjs`
- `packages/h2a/src/vuln-fix/controller.mjs`
- `packages/h2a/src/vuln-fix/state.mjs` (durable candidate/merge state
  and safe compatibility with existing claims/counters)
- `packages/h2a/src/vuln-fix/verify.mjs` (age/provenance re-check at
  merge time)
- `packages/h2a/src/vuln-fix/scan.mjs` (post-fix scanner comparison)
- Tests: `packages/h2a/test/vuln-fix-repository.test.js`,
  `packages/h2a/test/vuln-fix-controller.test.js`,
  new `packages/h2a/test/vuln-fix-merge.test.js` (temporary remotes;
  GitHub-facing behaviour against the L4 branch's real mechanism in a
  qualification repository for the live receipt).

RED first (literal commands recorded by G0, including
`rtk node --test packages/h2a/test/vuln-fix-merge.test.js` from h2a):
1. **Initial positive RED of the new capability:** all gates satisfied,
   audit RED → GREEN and ordinary required tests GREEN → GREEN on a
   temporary remote must produce exactly one autonomous merge commit.
   The shipped code fails because it never merges. This is the
   non-vacuous initial RED, not an assertion that missing guards were
   reproduced by a controller that already never merged.
2. **Resume RED:** checks pending → persist/stop/restart → checks green
   on unchanged SHA/base → exactly one merge, no second author/review
   calls, branch or charge for completed tasks. Repeat completion
   events and restart after an ambiguous merge acknowledgement still
   yield one merge effect (`vuln-fix-controller.test.js`,
   `vuln-fix-merge.test.js`, temporary state/remotes).
3. **Maturation RED:** valid candidate below seven days → persist and
   restart, advance a controlled clock past maturation → revalidate
   age/provenance/checks and merge once without a new author. Include
   UTC rollover and unchanged spend accounting. A changed head/base
   invalidates affected evidence and blocks until freshly proven.
4. Applicable `redBefore` regression RED → GREEN is a separate positive
   case; it does not replace the ordinary GREEN → GREEN case.

Safeguard tests (no claim that pre-existing no-merge behaviour is RED):
one review; stale-SHA pair after a push; red/missing/skipped check;
young package before its deadline; bad provenance; major/new package;
moved base; lost quota for genuinely required new inference; disabled
admissions; foreign or ambiguous PR → no merge. When a new guard is
being added to a functioning merge path, its own bypass regression
must be demonstrated RED before correction. Test commands, exit codes
and outputs identify the positive/resume regression versus guards.
Gate: part of G3 (positive recipe ends with an autonomous merge on
the qualification target) and of G6 (first production autonomous
merge under observation).
NOT covered: human-approved urgent merges (OQ4), rollback of a bad
merge (repository process), merges for non-lock changes.

### L6 — Per-repository readiness, enrolment, activation, operation

Owners: each repository's conductor (readiness), account holder
(consent acts only), lab operator (enrolment and activation). Activation
depends on L0–L5 for the chain; preparatory readiness/enrolment and
qualification can progress earlier to supply G2, without a circular
activation prerequisite. Each repository is admitted independently under
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
   h2a example is not a verification. Its exact source/test paths,
   interfaces, cwd, literal targeted command and expected RED must be
   resolved in that repository's L0 execution sheet before adapter code
   starts. Without them, the repository remains not-ready; no directory
   placeholder authorizes the adapter lot.
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
receipts, plus L3-R renewal/delivery/next-consumption evidence for the
admitted capability (central serialized delegate if necessary); the
gateway taking new accounts into account is operated on
the lab gateway only. Daily personal sessions are measured for
coexistence first and enrolment stops if one is disturbed (standing
16/10 rule: « Mes comptes, mesuré d’abord »).

Pre-merge activability: review the deployable private config and selected
L4 scheduler/continuation artefacts, qualify the G2 boundary and lifecycle,
then run scan-only for inventory and the positive recipe (G3) on one real fixable
candidate per chain configuration (if no real fixable finding exists,
a designated qualification repository with a controlled fixture proves
the path and is reported as a path proof, never as a repaired real
CVE; no vulnerability is ever introduced into a real repository).
Post-release activation, after G5 and the existing release/merge
authority requirements: operator deploys the reviewed config/artefacts,
enables the selected L4 scheduler and observes its first real scheduled
run (G4). Production acceptance requires G6, not just that first run.
Daily operation: readable report
(detection → candidate → merge → delivery, refusals, ageing, fairness
across ready repositories — starvation of the last-configured
repository is measured and reported, and a queue-fairness change is
specified if starvation is observed under D6 scarcity); owned PRs waiting
for age/checks/admission are reconciled automatically under L5 across
restarts and UTC days, with next wake-up and retained proof state visible.
Foreign/ambiguous PRs, quarantines, expired seats, and quota starvation are operator-visible
states with a named responsible, not silent exits. Stop: close
admissions and scheduler, drain own tasks, keep claims, counters, and
proofs. Resume: reconcile remote state and seats first; never erase
counters to regain quota.

Files: per admitted repository — its lock/manifest fixes for
criterion 1, its test-selection or verification-adapter files for
criterion 2 (exact paths, owners, interfaces and targeted commands frozen
by that repository's conductor in L0 before code; unresolved sheet blocks
that repository/adapter, not documentation inventory), plus h2a operator runbook
(`packages/h2a/skills/vuln-fix/references/operator.md`).
Tests: that repository's own targeted files for any adapter it adds;
h2a `packages/h2a/test/vuln-fix-controller.test.js` and
`packages/h2a/test/vuln-fix-repository.test.js` for chain-level cases.
RED first (chain level): a dry-run with no admissible seat can be
reported "ready to fix" → readiness reporting distinguishes scanned /
fixable / fix-blocked; a required test missing or skipped → repository
stays not-ready. An existing job-owned PR waiting for checks or age must
resume to one merge once eligible (L5 RED), without a duplicate branch or
author. A foreign/ambiguous duplicate remains an explicit handoff with
ownership reason; its mere existence never counts as proof of readiness.
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
- Apply L3-R lifecycle/next-generation consumption qualification to
  each additional provider/usage as it is claimed. An import receipt
  alone is never a live renewal, native execution or mesh route proof.

Files (h2a):
- `scripts/e2e-cli-seats-direct.mjs` (stub replaced by the real,
  admission-gated path)
- `packages/h2a/test/cli-seat-direct-matrix.test.js`
- `packages/h2a-runtime/src/cli-seat-codecs.ts`,
  `packages/h2a-runtime/src/cli-seat-materialization.ts` (only where a
  provider qualification proves a gap)
- `docs/cli-seat-l2s.md`

RED first: the initial positive live capability must fail on the
refusing stub before it is delivered. Coverage validation also rejects
an all-`uncovered` table as closure; ten usage receipts without scenario
or rotation evidence cannot close G7. Native evidence borrowed from
gateway-only execution, an unqualified OS/provider marked covered,
and a diagonal reusing one renewable family are refusal/coverage guards,
with actual baseline failures identified rather than presumed.
Synthetic tests stay; live cells are operator-run receipts per cell,
absent prerequisite = explicit failure, never a skip.

**Progress reporting is not closure.** The five-provider × two-usage
table may show partial or all-uncovered progress truthfully, but G7
requires all three positive evidence sets:
1. **Usages:** all ten CLI/mesh usages qualified for the admitted Linux
   tranche, each with real binary/route, identity, entitlement,
   capability/lifecycle and version/platform receipts. No empty or
   uncovered cell satisfies this part.
2. **Native scenarios:** all 25 ordered five-CLI pairs for each required
   scenario — `message`, `unavailable`, `loop`, `negotiation` — i.e.
   100 Linux pair/scenario receipts with real CLI binaries, gateway off,
   qualified scenario assertions and cleanup. An expected unavailable
   recipient in that scenario is asserted behaviour, not permission
   to skip another cell. Diagonals prove distinct actors/seats/families
   as required above. Follow the standing preference for simulated
   model responses when possible with real binaries; genuine inference
   uses the shared seat/admission circuit. No synthetic function call
   substitutes for native execution.
3. **Author rotation:** at least two eligible no-Claude authors actually
   alternate in admitted remediation cycles, each with two conformant
   independent reviews, D8/D10/L3-R receipts and shared accounting.
   Having several configuration entries or one successful Muse author
   does not prove rotation.

Each missing receipt keeps its L7 part open; G7's Linux scope closes
only when all three sets pass. macOS/Windows remain explicitly open
qualification scopes in the Linux → macOS → Windows priority order,
never covered by Linux receipts. G7 and all of L7 remain independent
of first activation, not silently discharged by G2/G6.
NOT covered: macOS/Windows qualification order beyond the standing
Linux → macOS → Windows priority; provider features outside seat
enrolment and launch.

---

## 7. Gates

| Gate | Closes | Evidence required (command + output, or named receipt) |
|---|---|---|
| G0 | L0 execution readiness | Documentary unknowns have resolvers but do not pass a dependent lot: before its code, exact owning repo/base/source/test files, interfaces, cwd, literal targeted commands and expected RED are resolved. Before G3/G5 all first-activation dependencies are resolved; final-spec reviews Astra max + Sol 6.1 max cover this revision (D13); no fictitious path/model |
| G1 | OQ1 interpretation for placement | Owner principles recorded in DECISIONS-owner.md, with conductor's explicit technical derivation naming orchestration/control repo, execution roles/runner, traceability, custody delivery, scheduler/wake-ups and merge executor. Complete composable L4 contract frozen before placement-specific RED; no binary technical answer demanded from the owner |
| G2 | L1–L3 including L3-R | L1 published-boundary contract GREEN or all V3 native-first proofs; real L2 identity/capability receipts; L3 integration against the real quota/scope authority with authority-side D6 amendment and exact D10 boundary. Environment, file, spawned-process and capability canaries denied with positive controls; real central renewal/delivery/next-use receipt, serialized-stream successor/continuation proof whenever required. Env-only filtering, import success or a local lock never closes G2 |
| G3 | Pre-merge activability; L5 qualification and L6 recipe | Integrated HEAD and selected complete L4 configuration: audit RED → GREEN, ordinary targeted tests GREEN → GREEN, applicable explicit redBefore regression RED → GREEN, none skipped; two autonomous reviews on final SHA, one autonomous merge commit on qualification target, targeted findings gone. Also targeted proof of pending-check and maturation stop/restart/resume, idempotency and no repeated completed inference. Reviewed deployable scheduler/continuation artefacts ready; no dry-run or clean-repository substitution |
| G4 | Post-release scheduled activation; L4/L6 operational step | First real scheduler-triggered run of the selected complete configuration observed after deployment in production service/workflow context, with report, refusal/alert path and stop/resume proof. Required for scheduled activation acceptance, not a pre-merge prerequisite |
| G5 | Eligibility to merge the #371 evolution | G0–G3 passed; two independent code reviews **Sol 6.1 xhigh + Astra max** on exact final SHA, findings resolved, relevant targeted tests green with command/output, conductor's full-suite integration result from CI. This is the pre-merge evidence package; the standing owner NO GO must be lifted under the existing owner authority and is not revoked by this spec or by gate success alone. G4/G6 follow release/deployment; no new per-vulnerability-merge owner approval is introduced |
| G6 | Production autonomy | First autonomous merges on real admitted repositories observed with D14 reporting (detection → merge → delivery) and capacity/fairness state visible; kill switch (admissions closed) tested once |
| G7 | L7 Linux deliverable, three conjunctive parts | All ten provider/usage receipts, all 100 ordered native pair/scenario Linux receipts, and exercised rotation of at least two conformant no-Claude authors. Partial/all-uncovered progress cannot close any missing part. Missing coverage keeps that L7 scope open; macOS/Windows have separate explicit open qualification scopes and are not declared covered |

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
- Full five-provider usage coverage, multi-author rotation, multi-OS
  matrices and gateway/native completeness at first activation (due in
  L7; G7 closes only its positively proven Linux scope, with other OS
  scopes kept explicitly open).
- Served-model attestation: reports keep requested and served models
  distinct; no launch alias is treated as proof of the served model.
- Rollback of merged fixes, release management of the target
  repositories, and remediation of vulnerabilities requiring product
  code changes: repository processes, with the job reporting the block.
- Any use of credit/API billing for remediation work, any silent use
  of the owner's daily sessions, any reading of secret values by
  model-visible tools/inputs, candidate tests, reports or this
  specification's evidence. D10 separately permits the admitted trusted
  native authentication/custody roles to consume their capability; it
  never licenses disclosure to the model or arbitrary candidate code.
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
Review reconciliation and source evidence:
SPEC_EVOL_VULN_FIX_ACTIVATION.v2-changes.md.
