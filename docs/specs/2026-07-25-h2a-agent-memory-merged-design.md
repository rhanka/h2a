# H2A agent memory — merged design and owner direction

**Date:** 2026-07-25

**Status:** owner-directed merged design; specification input, not implementation authorization

**Dossier revision:** `agent-memory-2026-07-25`
**Answer records:** `docs/decisions/2026-07-25-agent-memory-owner-answers.{md,json}` and `docs/decisions/2026-07-25-agent-memory-owner-answers-v2.{md,json}`

## 1. Purpose, authority, and the artefacts that remain replayable

This document is the committed, portable merge requested by the owner in D13. It combines:

1. the thirteen-card Focus decision dossier and the owner's two passes of answers; and
2. the earlier local design corpus under `/home/antoinefa/src/graphify/.graphify/scratch/`, which was
   invisible to revision 1 because that directory is ignored by git.

The merge fixes a specific audit defect: **a citation to a document nobody can reach makes work
unauditable while appearing justified**. The prior material is therefore quoted and reconciled here in
enough detail for this document to stand alone. Its originals remain at the read-only paths listed in
§11; nothing from that scratch directory is added to this repository.

This merge creates a **new** design document. It does **not** supersede, replace, hollow out, or mutate
the decision dossier or its acceptance history. The following committed files remain the replayable UAT
artefact and are explicitly **not superseded by this merge**:

- `apps/focus/src/lib/server/agent-memory-dossier.ts` — all thirteen cards, revision
  `agent-memory-2026-07-25`;
- `docs/decisions/2026-07-25-agent-memory-owner-answers.{md,json}` — the historical D1–D7 answer set;
- `docs/uat/2026-07-25-focus-agent-memory-dossier.md`;
- `docs/uat/results/2026-07-25-focus-agent-memory-dossier-run-1.md`;
- `docs/uat/results/2026-07-25-focus-agent-memory-dossier-run-2.md`.

The v2 answer record is additional provenance. The original D1–D7 JSON deliberately remains the fixture
that the UAT loads. A replay must continue to show the revision mismatch honestly, apply D1–D7, and name
D8–D13 as absent from that historical answer set.

## 2. Rules used for this merge

Three constraints outrank editorial tidiness:

1. **Ownership is preserved.** The earlier seed assigns F2 to the h2a peer and F3 jointly to the h2a
   peer and harness. This document does not decide them. Any direction that touches them is marked
   **needs the owning party's consent**, and that consent must be recorded before specification.
2. **The notes are the reasoning; the selection is only its label.** Every owner note is reproduced
   verbatim in French in §4, including the D2–D6 amendments.
3. **No gap is silently filled.** In particular, D10 says `Je n'ai pas de conviction`; its trigger label
   is recorded, but the trigger, `/rewind`, and commit model remain open.

### Authority boundary

The earlier seed is a **DRAFT study proposal**, not a signed protocol action. It says that the principal
approved launching the study, but it also says explicitly that the seed itself **does not send**. Neither
this repository nor the dossier established whether it was later sent or whether the proposed parties
opened or signed a negotiation. The ownership map is therefore a constraint on who must consent, not
evidence that consent already exists.

The current Graphify time-oriented specification also records a live boundary: h2a coordination evidence
may be projected, while **authored memory and h2a persona/knowledge semantics remain unapproved and out of
scope**. The owner's D1/D8 direction asks the Graphify lane to consider lifting that boundary; this merged
document does not lift it. Graphify must record an explicit scope decision before implementation.

## 3. Merged direction in one view

The direction across D1–D13 is:

- use **one Graphify substrate** that can keep its current archive/corpus role and also act as the
  context-dependent living-memory sink; logical layers and trust tiers remain distinct even when the
  physical substrate is one;
- extend the existing ontological graph toward **ontology plus bi-temporality with contradiction**, but
  only after correcting Graphify's existing interval contradiction and designing an assertion-level
  reconciliation algorithm;
- keep automatic extraction behind a **binary gate**, reducing human review through double consensus
  by high-grade agents rather than making unreviewed memories merely lower-weight;
- remain **embedded and local-first**, while requiring the database backend to become read-write for
  memory/knowledge if it is not already;
- make an **append-only journal authoritative** and the graph a projection; a CRDT is not the default,
  while GUN remains insufficiently investigated;
- use ActiveMemory/ctx as the identified file-oriented reference, without adopting it as the substrate;
- merge this direction with the earlier native design instead of citing an unreachable scratch corpus.

This settles a direction, not every mechanism. The exact write trigger and repository commit model are
not settled. F2/F3 are not settled. The assertion-reconciliation algorithm, database write capability,
graph-size ceiling, journal fold, and live-versus-commit reconciliation are not settled.

## 4. D1–D13 — selections and verbatim owner reasoning

### D1 — Nature of the memory

**Selected label:** `Hybrid: curated corpus + live capture, in distinct layers` (`hybride`).

**Merged reading:** D8 later places both roles in Graphify. “Distinct layers” therefore means distinct
semantics and trust treatment within one substrate, not necessarily two independently operated stores.

> Zep/Graphiti ressemble a ce qu'on fait avec graphify. on pourrait donc utiliser a la fois graphify pour la mémoire d'archive et la capture vivante. cependant tu ne m'as pas présenté comment hermes fait ou d'autres, il faut plus de détail

### D2 — Structure of the substrate

**Selected label:** `Corpus ontology graph` (`graphe-ontologique-corpus`).

**Merged reading:** D9 composes this with bi-temporality; the existing `t`/`t_end` design is not sufficient
until the second temporal axis and contradiction mechanism exist.

> J'aimerais une approche hybride de graphe entre ontology et bi-temporel - la bi-temporalité pourrait être une forme de gestion de mémoire longue au dela de la journée ou simplement du dépassement de contexte (avec des prehook de compaction, l'idéal ?)

**Amendment v2:**

> Il faudra mener la correction a la contradiction identifiee dans graphify

### D3 — Who decides a fact enters memory

**Selected label:** `Automatic extraction with an approval gate` (`ecriture-gatee`).

**Merged reading:** proposed memories enter a binary pending/accepted policy; Focus sessions are the named
review surface. D11 refines how to keep that surface human-sized.

> j'imagine des sessions via h2a focus pour la révision de mémoires.

**Amendment v2:**

> inspire toi des meilleurs mecanismes qu on implementera dans graphify. il est important de confier l etude et le dossier de decision integral a graphify pour qu il dispose du meme point de depart

### D4 — Reconciling contradictory facts

**Selected label:** `Bi-temporal reconciliation` (`bi-temporelle`).

**Merged reading:** Graphify remains the target, but identity reconciliation is not assertion
reconciliation. The latter is new work and is an explicit open algorithm, not an inferred capability.

> on repose a maxima sur graphify pour cela (évolution bi temporelle a co-design)

**Amendment v2:**

> il faut ajouter un algo de reconciliation d assertion a graphify c est parfaitement ce que je souhaitait lire. S inspirer de graphifi / cognee et donner ces elments d analyse a graphify

### D5 — Hosting under RAM/OOM constraints

**Selected label:** `Embedded, local-first` (`embarque-local`).

**Merged reading:** file/local use remains the baseline. A web/Sentropic integration may use the existing
GraphStore port, but it must be read-write for the living-memory use case rather than a downstream mirror.

> il faut pouvoir reposer sur local first et permettre la capitalisation. graphify embarque un backend db et pourrait être configuré pour l'usage d'une tierce db, surtout lorsque h2a devient intégré a sentropic, version web

**Amendment v2:**

> update note v2: si le backend db n est pas encore en rw il faut demander la completion pour les besoin de la memoire / knowledge

### D6 — Concurrent multi-CLI writes

**Selected label:** `Safe concurrent writes (CRDT / append-log)` (`crdt-append-log`).

**Merged reading:** the first-pass note made this open; D12 later chooses the journal as the default path.
The journal branch of the original label is therefore the current direction. CRDT remains a fallback
study, not a chosen implementation.

> j hesite entre 1 et 2. peut être 2 avec opt in 1 dans un deuxieme temps

**Amendment v2:**

> pour les limites en max graph bytes de graphify: il faut probablement lever une etude d options pour lever cette limite quand on ira a la specification avec graphify

### D7 — Which project “ctx” means

**Selected label:** `ActiveMemory/ctx (Go)` (`activememory-ctx`).

**Note:** (none)

The reference is the git-native, file-oriented ActiveMemory/ctx project. Its useful mechanisms are scored
context allocation and an MCP/steering surface; it is not a CRDT and is not the selected memory substrate.

### D8 — Archive and living memory

**Selected label:** `Un seul substrat : graphify devient aussi le puits vivant`
(`graphify-substrat-unique`).

> graphify doit pouvoir continuer a jouer le role qu'elle joue aujourd'hui + le role de memoire vivante selon le contexte d'utilisation.

The single-substrate decision does not authorize collapsing provenance or trust. A corpus-derived fact,
an agent-authored MemoryNote, and a signed h2a identity may share a graph while remaining different kinds
of claims with different admission and query rules.

### D9 — Ontology plus bi-temporality

**Selected label:** `Construire la reconciliation d'assertion` (`detecteur-assertions`).

> in claro: on va adopter ontologie + bi temporalite avec contradiction, comme graphifi, mais dans graphify, et graphify sera couche vivante version a froid.

Graphiti is the mechanism reference for contradiction-driven invalidation. Cognee contributes useful
identity and ontology-resolution mechanisms, but this document does not pretend that identity
deduplication is assertion contradiction.

### D10 — Long-memory write trigger

**Selected label:** `Compte de tours, ou silence debounce` (`compte-de-tours`).

**Status:** **OPEN — no conviction was expressed.** The label must not be promoted into a settled choice.

> Je n'ai pas de conviction, j'ai choisi ce qui me semblait le plus evident. Mais ca pose des questions sur les "/rewind" par exemple. et sur l'articulation avec le commit. Dans ce mode, il faudra probablement preconiser de ne plus commiter le graph avec le repo, ou bien changer le mode de commit. J'aime bien quand meme avoir la memoire commitee, mais on risque d'avoir plusieurs roles d'agents avec des memoires distinctes (cf les roles dans sentropic: architect, conductor, llm-mesh, cowork, sentropic-chat, sentropic-app etc). dans ce cas si on commit il faut avoir les mecanismes de reconciliation live vs commit + potentielle mutualisation de memoire inter-agents (une couche h2a par dessus graphify)

A turn counter or silence debounce is the leading candidate only. `/rewind`, commit boundaries, committed
memory, per-role memories, live-versus-commit reconciliation, and an h2a mutualisation layer must be
designed together before the trigger is specified.

### D11 — Pending memory and human review

**Selected label:** `Garder la porte binaire, mais reduire ce qui atteint l humain`
(`reduire-la-surface`).

> utiliser le principe de double consensus. avec des agents de haut grade (consenus 5.6 terra xhigh, opus 5 xhigh suffisant)

The gate remains binary. Double consensus is the chosen way to reduce the human queue; the exact promotion
rule, independence requirement, disagreement path, and audit record remain specification work. The
GovMem result in the dossier—that no tested real-agent-code trace was safe for automatic promotion—must
be treated as a safety constraint when defining that rule.

### D12 — Authority under concurrent writes

**Selected label:** `Le journal fait foi, le graphe est une projection` (`journal-plus-fold`).

> tu m'a un peu dissuade d'un CRDT j'ai donc choisi l'option par defaut de journal

**Note (suite):**

> cependant tu as critique automerge pas GUN. ce serait peut etre a approfondir, mais avec decision par defaut de journal

The default is an append-only authoritative journal and a replayable graph projection. This does not claim
that the required fold, tombstones/supersession events, snapshots, or non-commutative-operation rules
already exist. Automerge evidence counts against Automerge only; it does not close the GUN question.

### D13 — Relationship to the earlier local design

**Selected label:** `Fusionner les deux en un seul document, et le sortir du scratch.`
(`fusionner-en-un-document`).

**Note:** (none)

This document is that merge. It replaces the need to justify future work with unreachable scratch
citations. It does not delete the scratch provenance and, crucially, does not supersede the Focus dossier
as the committed replay artefact.

## 5. Native substrate carried forward from the earlier corpus

### 5.1 Existing base, not a greenfield memory system

The earlier design starts from `graphify.agent-stats.project-graph/v1`, not a separate store. Its existing
nodes are Project, Repo, Agent, Session, Branch, and Commit; its existing relations include `belongs-to`,
`rename-lineage`, `worked-in`, `conducted-by`, `touched-branch`, `produced`, and `derived-from`. The
rename-aware project graph was demonstrated across three repo incarnations while retaining one project
identity.

Agent-stats is the **relay**: it parses local CLI transcripts and derives evidence-ranked session facts.
Attribution comes from tool outputs, transcript evidence, h2a registry matches, and other ranked evidence,
never from git authorship. This is why its memory is “earned.” The earlier corpus proposed additive
MemoryNote, UserModel, Persona/Soul, and Skill concepts, role-scoped recall, and a lineage reason such as
compaction/subagent/resume. Those are design inputs, not claims that the types already ship.

### 5.2 Time model and the contradiction that must be corrected first

The prior time-oriented design proposed a shared event-time contract on nodes and edges:

- `t` — primary event instant in epoch milliseconds;
- `t_end` — optional end of a span;
- `t_iso` — optional display/audit mirror;
- `t_src` — provenance of the time value.

That is a **single temporal axis**. D9 adds the need for transaction/knowledge time so the graph can
distinguish when a fact was valid from when the system learned or invalidated it. The exact field names and
storage representation are not invented here.

Before adding that axis, Graphify must correct an existing semantic contradiction: the earlier
specification describes `[t, t_end]` as closed while the scene renderer treats it as `[t, t_end)`
half-open. A second axis would multiply the boundary error. Until one interval convention is made
authoritative end-to-end, temporal recall and contradiction cannot be specified safely.

### 5.3 One substrate, context-dependent roles

Graphify must continue to serve its current corpus/archive role while gaining a living-memory role. The
earlier capability map remains useful:

| Capability | Native home | Carried direction |
|---|---|---|
| Agent-authored durable memory | Graphify substrate | MemoryNote/UserModel-like assertions with provenance, gating, supersession, and bounded growth; exact schema open |
| Cross-session recall | Graphify query/recall over the substrate | role/time/trust-aware recall; exact ranking and `--as-of` contract open |
| Session lineage | Agent-stats relay into Graphify | retain parentage; compaction/resume reason is additive design work |
| Persona/Soul | h2a identity and role-binding | **owned elsewhere and untouched; needs h2a peer consent** |
| Procedural memory/skills | harness plus Graphify evidence | harness-local versus first-class h2a role is **owned elsewhere and untouched** |
| External persistence | GraphStore port | reuse rather than mint a parallel port, conditional on read-write completion |

The earlier “Increment 0” proposal—MemoryNote write plus role-scoped recall, no persona—remains a useful
sequencing hypothesis because it avoids deciding F2/F3. It is not ready to implement until the open
questions in §9 that affect write authority, journal fold, commit mode, and backend capability are closed.

## 6. Ownership and F1–F6 reconciliation

The seed's ownership map is retained:

| Component | Owns | Calls |
|---|---|---|
| Graphify | memory substrate, schema, persistence, reconciliation | F1, F4, and F5 with the principal for the gate |
| agent-stats | transcript-to-graph relay and earned evidence | evidence mapping, no governance call |
| h2a | roles, persona, signed identity | F2 and F3; the h2a peer's consent is load-bearing |
| harness | stable coding roles and skill bundles | F3 jointly with the h2a peer |

Reconciliation against the owner's answers:

| Fork | Earlier position | Owner direction | Status |
|---|---|---|---|
| **F1 — memory schema** | Extend `project-graph/v1` in place rather than mint a sibling `agent-memory/v1`; Graphify owns the call. | D1/D8 choose Graphify as the single archive + living substrate; D2/D9 add ontology plus bi-temporality. | **agreeing** — both positions use the existing Graphify substrate. Exact additive schema remains for the Graphify lane. |
| **F2 — persona placement** | Lean: bind Soul/persona to the instance × role × slot binding; h2a peer owns the call. | D10 observes that several agent roles may have distinct memories and may need an h2a layer above Graphify. It does not choose binding vs instance vs standalone Persona. | **owned elsewhere and untouched** — **needs the owning h2a peer's recorded consent**. |
| **F3 — coding roles as h2a roles** | Lean: harness-local roles bound onto AGENTS, not additions to the frozen h2a vocabulary; h2a peer + harness own jointly. | D10 lists architect, conductor, llm-mesh, cowork, sentropic-chat, sentropic-app as potentially distinct memory-bearing roles. It does not decide vocabulary or binding. | **owned elsewhere and untouched** — **needs the owning h2a peer's and harness's recorded consent**. |
| **F4 — external-memory port** | Reuse GraphStore; decide the French embedding provider separately. | D5 keeps local-first and asks for a third-party DB path; its v2 note requires read-write completion for memory/knowledge if missing. | **agreeing** — reuse the port, but do not call a read-only mirror a living-memory backend. Embedding choice remains open. |
| **F5 — authored-memory gate** | Gate UserModel; allow automatic MemoryNote with supersession; Graphify + principal own jointly. | D3 chooses automatic extraction with a gate. D11 keeps the gate binary and uses high-grade double consensus to reduce what reaches the human. | **superseded** — the type-specific lean is replaced by the later binary-gate/double-consensus direction. Its exact promotion semantics remain to be specified with Graphify. |
| **F6 — “stp” component** | Ask whether `stp` is a fifth component or “s'il te plaît”; principal owns it and the seed says it blocks final scope. | No D1–D13 answer addresses it. | **owned elsewhere and untouched** — still open; no fifth component is invented and no ambiguity is silently erased. |

## 7. Trust invariant — carried forward unchanged

The seed's exact invariant is carried forward, not retired:

> agent-stats memory = earned (ground truth), MemoryNotes = asserted (gated), h2a identity+persona = signed (Ed25519). One substrate, three trust tiers — do not collapse them.

Consequences for the one-substrate direction:

- a shared graph does not imply a shared evidentiary grade;
- retrieval and UI must preserve the tier and provenance of every result;
- assertion reconciliation must not overwrite earned evidence or signed identity as though they were
  ordinary mutable memories;
- the binary admission gate applies to asserted memory; it is not a substitute for signature validation
  or earned-evidence derivation;
- any projection or export must retain the tier, otherwise D8 would destroy the property that allowed the
  seed to accept one substrate.

## 8. How Hermes actually works — mechanism findings recovered from scratch

The owner twice identified the same defect: the prior presentation said what Hermes was, but not **how it
worked**. The answer already existed in the three-arm investigation and the later mechanism research, but
it was unreachable because every investigation lived in a git-ignored scratch directory. This section
surfaces that missing answer.

### 8.1 Evidence reconciliation across the three arms

- The Opus and Sonnet arms identify the target as NousResearch `hermes-agent` and describe its persistent
  files, SQLite history, profiles, persona, skills, and provider model using external documentation.
- The Codex arm establishes the local Graphify integration surface—Hermes is a skill-based assistant
  target under `.hermes/skills/graphify/SKILL.md` plus AGENTS instructions—but, with network unavailable
  and no local Hermes installation, correctly marks Hermes-native memory and roles unverified and asks for
  a real fixture before writing a parser.
- The later thirteen-card dossier reads the mechanism code and corrects earlier shorthand: limits are in
  characters rather than tokens, “consolidation” is a hard error/retry loop rather than an LLM pass, and
  the live in-session view is a frozen snapshot.

The merged conclusion keeps the agreement and the uncertainty: Hermes is a **reference only** for the
native recode. Earlier recommendations to make it a fourth agent-stats host are explicitly overridden by
the seed unless a separate owner decision reopens integration.

### 8.2 Core memory and visibility

- Core memory is stored in `MEMORY.md` and `USER.md` as flat text entries separated by the literal
  delimiter `\n§\n`; duplicates are removed on load.
- Enforced defaults are **2,200 characters** for memory and **1,375 characters** for the user model,
  configurable in YAML. Token numbers in the early investigations were approximations, not enforcement.
- `load_from_disk()` captures a snapshot once at session start. `format_for_system_prompt()` injects that
  **frozen snapshot** so the model-provider prefix cache remains stable. A write is durable on disk and
  visible in the tool result immediately, but it does not enter the system prompt until the next session.
- The tool offers add/replace/remove, not a separate read/list operation. The model sees the snapshot,
  its displayed character budget, and—on write failure—the current entries in the error payload.
- Crossing the budget causes a synchronous hard error that instructs the model to replace/remove and
  retry in the same turn. There is **no LLM consolidation pass**. After three failed attempts in one turn,
  the tool returns a terminal result so it does not block the user's answer indefinitely.
- Writes use a temporary file and atomic replace, with an OS file lock and external-drift detection. Those
  safeguards do not eliminate logical data loss; the failure cases below still occurred.

### 8.3 Approval, session history, and lineage

- `memory.write_approval` is false by default. When enabled, foreground interactive writes can be
  approved inline; messaging, cron, scripts, background reviewers, and skills are placed in
  `pending/memory/<id>.json`. Automatic writes are marked `[auto]`.
- The delivered gate is binary and primarily **delays** an entry. It has no “reject immediately” state in
  the path studied. That makes queue semantics—not merely a Focus screen—part of the design.
- Conversation history is a separate SQLite `state.db`, not the core-memory prompt. Three external FTS5
  indexes are maintained by triggers: Unicode tokenization, a trigram index excluding tool-role rows, and
  an optional CJK bigram extension.
- `session_search` uses BM25, deduplicates by session lineage, demotes cron rows beneath interactive rows,
  and returns windows of roughly five messages on either side as an ordinary tool response. It makes no
  LLM call and does not inject results into the system prompt.
- Sessions carry parent lineage; compaction/splits can preserve a parent-to-child chain. This is the
  mechanism that the native `derived-from` plus reason design aims to reproduce.

### 8.4 Identity, persona, procedural memory, and providers

- `SOUL.md` supplies persistent persona/voice; named profiles isolate configuration, memory, persona, and
  tools under distinct homes; personalities can be switched. This is behavioral identity, not h2a's
  signed governance identity, so the two axes must not be conflated.
- Skills and skill bundles act as procedural memory and can be created or improved from experience. The
  native design maps that capability to harness-owned role/skill bundles rather than taking a Hermes
  dependency.
- Hermes exposes multiple external memory providers but activates one external provider at a time beside
  core memory. Only Honcho was read end to end in the mechanism research; ByteRover, Hindsight,
  Holographic, mem0, OpenViking, RetainDB, and Supermemory remain unverified beyond their declarations.

### 8.5 Failure modes that constrain the native design

- Issue #56464 reports replace/add truncating a roughly 2,100-character memory from 28 entries to 5 while
  reporting success, three times in one session.
- Issue #49200 reports an external provider failure silently falling back to the built-in 2,200-character
  store without logs, unnoticed for six days and recurring on container rebuild.
- Issue #66654 reports stale-memory pollution and accumulation without cleanup or timestamps.

The transferable lesson is not “copy Markdown plus SQLite.” It is: fail loudly, expose the active
provider and write result, make visibility timing explicit, keep history separate from injected core
memory, bound growth without silent truncation, and preserve provenance through every fallback.

## 9. Open questions and what each blocks

An unresolved item named is preferable to a mechanism invented here.

| Open question | What must be established | What it blocks |
|---|---|---|
| **Assertion-reconciliation algorithm** | Design the detector and supersession operation Graphify lacks. Draw on Graphiti's overlap-first contradiction invalidation and on Graphify/Graphiti/cognee identity and ontology mechanisms without conflating identity with assertion. Define provenance, idempotence, ordered ingestion, and failure behavior. | D4/D9 becoming actual contradiction-aware bi-temporal memory; `invalid_at`-like values; safe promotion of corrected facts. |
| **Existing Graphify interval contradiction** | Choose one authoritative interval convention and correct the closed `[t,t_end]` versus half-open `[t,t_end)` mismatch through spec, storage, recall, and renderer. | A second temporal axis, correct boundary queries, `recall --as-of`, and trustworthy temporal rendering. |
| **Database backend read-write capability** | Verify whether the chosen GraphStore backend supports element-level reads and writes for living memory. If it is not read-write, request and complete that capability for memory/knowledge instead of treating `pushGraph` as sufficient. | Focus/web approval writes, a database as an authoritative living sink, and Sentropic web integration. |
| **Maximum graph bytes ceiling** | Study options for the merge ceiling. The dossier measured a 52,428,800-byte merge limit against a 54,039,561-byte committed graph, already over the limit; include history/projection separation and snapshot/compaction options. | Git-based multi-writer reconciliation today and any living-capture growth; a credible committed-memory policy. |
| **`/rewind`, trigger, and commit articulation** | Compare turn counter, silence debounce, explicit phase/commit, and provider hooks under rewind. Specify idempotence and which events are undone, replayed, or retained. D10 provides no conviction. | The write trigger, duplicate avoidance, rewind correctness, and whether graph commits correspond to memory commits. |
| **Per-role memories and live-versus-commit reconciliation** | Define isolation, sharing, merge, and retention for architect/conductor/llm-mesh/cowork/chat/app-like roles; decide whether a mutualisation layer belongs in h2a above Graphify. This touches persona/role ownership. | Cross-role recall, live state versus repository state, inter-agent mutualisation, and the final storage topology. **Needs F2/F3 owners' consent.** |
| **Automerge versus GUN** | Keep the journal as the default. If a CRDT fallback is reopened, investigate GUN independently; Automerge history-size and graph-integrity criticism does not establish GUN's behavior. Specify delete semantics and referential integrity for any candidate. | Whether there is a credible CRDT fallback and whether D12 should ever move away from journal-plus-projection. |
| **Does the authoritative decision journal fold into rebuilds?** | Verify whether Graphify's accepted reconciliation decisions are replayed during reconstruction. If not, design the missing deterministic fold before calling the journal authoritative. | D12's core claim, persistence of accepted review decisions, D8 living writes, and D11 queue outcomes. |
| **Conversation assertion provenance** | Decide whether conversation turns become citeable corpus documents or assertions receive an explicit non-corpus provenance class and trust-tier treatment. | Preserving Graphify's citation invariant while accepting living memory into one substrate. |
| **Binary double-consensus promotion rule** | Define validator independence, model grades, agreement threshold, disagreement-to-human path, stale-candidate handling, audit record, and response to GovMem's negative real-trace result. | D11 implementation, human queue size, and safety against background-memory pollution. |
| **F2 persona placement and F3 coding-role vocabulary** | Obtain the h2a peer's consent for F2 and joint h2a-peer/harness consent for F3. | Persona-bound memory, role-specific slices, and any h2a mutualisation layer. |
| **F6 “stp” ambiguity** | The principal must say whether `stp` is a component or “s'il te plaît.” | The final cross-component scope only; no component is inferred here. |

## 10. Graphify lane hand-off

The owner asked twice that Graphify receive both the study and the full decision dossier so it starts from
the same evidence. The hand-off is therefore a package, not a link to one invisible file.

Graphify must receive:

1. **This merged design** as the portable synthesis and ownership map.
2. **The full replayable decision dossier**:
   `apps/focus/src/lib/server/agent-memory-dossier.ts` at revision `agent-memory-2026-07-25`, including
   all thirteen cards, mechanisms, corrections, unknowns, and matrix—not merely the selected answers.
3. **Both answer generations**: the unchanged D1–D7 fixture and the v2 D8–D13 plus D2–D6 amendment
   record. Notes must travel with option keys.
4. **The replay acceptance evidence**: the UAT scenario and both run reports, so the Graphify lane knows
   which artefacts must remain replayable and what “not orphaned” means.
5. **The prior native substrate evidence carried here**: `project-graph/v1`, agent-stats as an earned
   evidence relay, rename-aware project/session relations, the single-axis `t`/`t_end` contract, the
   trust invariant, and the F1–F6 ownership table.
6. **The Hermes mechanism findings**, including the frozen prompt snapshot, synchronous hard-cap retry,
   pending gate, separate FTS5 history, lineage, profile/persona distinction, provider uncertainty, and
   silent-degradation failures. Hermes remains reference-only.
7. **A written response from the Graphify lane** on the concrete unknowns it owns: assertion
   reconciliation; interval semantics; journal fold; element-level DB read/write; graph-size ceiling;
   conversation provenance; the binary-gate projection path; and whether to lift the current boundary
   that keeps authored memory and h2a persona/knowledge unapproved and out of scope.
8. **Consent routing rather than accidental scope creep**: Graphify must return F2/F3 questions to the
   h2a peer/harness owners rather than encoding a persona or role-vocabulary answer in its schema.

For same-machine forensic work, the eight scratch originals listed in §11 can be supplied read-only. For
any remote, CI, or future checkout, this committed document plus the dossier/answer/UAT files are the
minimum self-contained package; a bare scratch path is not acceptable evidence.

## 11. Source map and provenance

### Committed, reachable sources

- `apps/focus/src/lib/server/agent-memory-dossier.ts` — thirteen-card dossier and mechanism research.
- `docs/decisions/2026-07-25-agent-memory-owner-answers.md` and `.json` — first-pass D1–D7 fixture.
- `docs/decisions/2026-07-25-agent-memory-owner-answers-v2.md` and `.json` — second-pass D8–D13 and
  D2–D6 amendments.
- `docs/uat/2026-07-25-focus-agent-memory-dossier.md` and the two dated run reports — replay contract and
  evidence.

### Read-only originals outside this repository

All were read in full. They remain under `/home/antoinefa/src/graphify/.graphify/scratch/` and are
git-ignored; none is added or modified here:

- `H2A_MEMORY_STUDY_SEED.md` — consensual study seed, F1–F6, ownership, trust invariant;
- `NATIVE_AGENT_MEMORY_DESIGN.md` — six-capability native recode, Graphify/agent-stats/h2a/harness split;
- `HERMES_MEMORY_INVESTIGATION_OPUS.md`;
- `HERMES_MEMORY_INVESTIGATION_SONNET.md`;
- `HERMES_MEMORY_INVESTIGATION_CODEX.md`;
- `AGENT_STATS_PLAN.md`;
- `AGENT_STATS_PROJECT_GRAPH.md`;
- `DESIGN_AGENTSTATS_TIMEORIENTED_KNOWLEDGE.md`.

The first five bullets named by the owner plus the three agent-stats documents are the complete prior
local corpus used in this merge. Their role is provenance. Future work should cite this committed merge
for the reconciled design and cite an original scratch path only as additional same-machine evidence.

## 12. Exit criteria for a later specification

A Graphify specification may begin when it can name, without invention:

- the assertion-reconciliation algorithm and interval convention;
- journal events, fold, snapshots, supersession/tombstone behavior, and failure visibility;
- the read-write storage capability and graph-size strategy;
- the living-assertion provenance class and preserved trust tier;
- the trigger/rewind/commit contract;
- double-consensus admission semantics;
- which questions are still waiting on F2/F3 consent.

Until then, the owner direction is clear but intentionally incomplete: **one Graphify substrate; archive
plus living memory; ontology plus bi-temporality with contradiction; binary gate with reduced human
surface; local-first; authoritative journal and projected graph; no invented answers where ownership or
evidence is missing.**
