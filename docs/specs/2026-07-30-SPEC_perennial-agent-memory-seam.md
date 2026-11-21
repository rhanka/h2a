# SPEC — Perennial agent-memory seam between h2a and graphify

Status: **specification proposal; no implementation and no owner acceptance**.

Date: 2026-07-30

Branch: `memory/graphify-seam-spec`

h2a original-spec baseline: then-local `origin/main` and starting `HEAD`
`af9e8e4c2e5a8f4afa0a3a5421c9a7d7c9be9c3d`. During the addendum pass the local
`origin/main` ref had advanced to
`815e0880796f5599f7fcf3bc8c73f5e13e4f8aee`; `git merge-base HEAD origin/main`
still printed `af9e8e4c…`, and `git rev-list --left-right --count HEAD...origin/main`
printed `1 13` before the amendment commit. This lane did not fetch, merge or
rebase. During the Addendum 2 pass, the already-local `origin/main` ref had
advanced again to `2d586c7c2749727ae9745e11e7211c18f2a90f70`; merge-base still
printed `af9e8e4c…`, and the left/right count printed `2 26` before this amendment
commit. `git diff --name-status af9e8e4c..2d586c7c --` for the cited h2a
architecture, decision, journal and gate files printed no changes; the cited
track IDs were re-found in current local `origin/main`.

graphify baseline inspected: local `origin/main`
`54d771aea8b1b5feb8e3f13f49f8f41eafd83632`; the inspected checkout was the dirty
`feat/aclp-ontology-studio` worktree at `343690503748f325cc7673b577321271cb0cbb9f`,
but `git diff origin/main --` was empty for the temporal-recall, storage,
citation, and renderer files cited below. Neither local remote-tracking ref was
refreshed by this lane; graphify `origin/main` still printed `54d771ae…` during
the addendum pass.

This document uses seven evidence labels:

- **MANDATED** — fixed by the commissioning brief; this spec does not reopen it.
- **VERIFIED** — observed in the named file, commit, event, command, or test output.
- **GRAPHIFY-MEASURED** — measured directly by `graphify-knowledge` and relayed
  in `tmp/ADDENDUM-2-retraction.md` or `tmp/BRIEF-seam-finalize.md`; source or
  data independently rechecked here is named separately.
- **RETRACTED** — appeared in commit `e74c4bd8` from superseded Addendum 1 and is
  explicitly not evidence or a requirement in this version.
- **REQUIRED** — proposed seam behavior, not present behavior. The named refusal
  and conformance test are what would falsify an implementation claim.
- **PENDING D8** — the design is stated, but the owner has not ratified D8 as
  graphify's principal. It creates no graphify commitment or implementation
  authority until that explicit graphify-side scope decision exists.
- **OPEN** — agreement is required from `graphify-knowledge` or another named
  owner; this document does not decide it.

The guarantee of this document stops at the evidence and proposed contract. It
does not establish implementation, deployment, owner acceptance, live-Postgres
behavior, latency, RAM/OOM behavior, privacy authorization, or cross-host
continuity.

## 2026-07-31 update — consensus-informed

This pass folds four later inputs into the seam without changing its proposal
status:

- **A — graphify corrections, relayed rather than rerun here.** The executable
  interval convention is closed-inclusive; the only half-open statement is a
  self-contradictory contract comment, so the work is a zero-behavior-change
  contract freeze, not a renderer migration. `GraphStore` has whole-graph
  `pushGraph`, not element-level append. The namespace carries the workspace,
  while host and role are node attributes (`tmp/BRIEF-seam-finalize.md:22-43`).
- **B — D10 owner answers.** Ordering is conversation turn number plus real
  write-time; location is live graphify plus a smaller committed recovery copy;
  rewound notes remain but become no-longer-current. Those three choices are
  owner-decided, not implemented. One unified graph per repo plus retained
  per-job compartmentalization is owner direction, not ratified design
  (`origin/main:docs/decisions/2026-07-25-agent-memory-owner-answers-v2.json:20-26`;
  `origin/main:docs/specs/2026-07-25-h2a-agent-memory-merged-design.md:284-322`,
  local `origin/main` `e328248e81ddc367fd00eaaf188cefa7fbc93855`).
- **C — benchmark.** EXXETA `exxperts` supplies a file-based pole supporting the
  committed/file direction as a README-declared shipping reference for
  approval-gated, provenance-linked, recall-as-of memory. It is not
  code-verified, does not prove a committed recovery copy, and implies no
  dependency
  (`docs/benchmark-exxperts` commit `5cc0b6b5`: merged-design §8.6, lines
  531-561; PR #123 was read as OPEN during this pass).
- **D — graphify hard gate.** Every graphify-engaging commitment below is
  **PENDING D8 ratification by the owner as graphify's principal**. The spec
  designs those seams; it commits none of them
  (`tmp/BRIEF-seam-finalize.md:73-80`;
  `tmp/ADDENDUM-2-retraction.md:90-95`).

The **PENDING D8** set is: D8's single-substrate boundary; the closed-interval
contract freeze before D9's second temporal axis; any MemoryNote/authored-memory
schema, ingestion or h2a write path; element-level graph writes and their
durability receipt; the recovery-copy projection/rebuild/comparison contract;
no-longer-current rewind filtering; unified-repo/per-job sharing rules;
binding structured citations to MemoryNote; any caller-chosen namespace,
cross-workspace read or pagination surface; and graphify-side anti-cycle/version
gates. Existing generic temporal recall, whole-graph push, configured namespace,
citation inclusion and the named-branch file-only anti-cycle evidence remain
present-behavior observations at their stated limits, not commitments created by
this specification.

## 0. Retraction record

`tmp/ADDENDUM-2-retraction.md:1-20` supersedes Addendum 1. This document retracts
the following claims and requirements introduced in commit `e74c4bd8`. The
superseding addendum identifies the false premise as a commissioning-side error,
not a graphify failure:

1. **RETRACTED — “the Postgres temporal feed is missing and serves nothing
   end-to-end.”** The measured chain is complete. The 8,919-node inspected
   `graph.json` legitimately returned an empty temporal window because no node
   carried numeric `t`, not because push or query was disconnected. This lane
   rechecked `nodes: 8919` and zero numeric `"t"` occurrences in the inspected
   graphify worktree; graphify-knowledge measured the complete push/query chain
   (`tmp/ADDENDUM-2-retraction.md:8-20`).
2. **RETRACTED — `FEED_NOT_READY`, a graphify ingestion delivery gate, the
   “missing-feed” delivery sequence, and OPEN-Q17 as a **bulk-feed** question.**
   No bulk ingestion-side build is required. That retraction does not provide
   the absent element-level write needed by live memory; the MemoryNote producer,
   append and receipt remain **PENDING D8**
   (`tmp/ADDENDUM-2-retraction.md:18-26`;
   `tmp/BRIEF-seam-finalize.md:36-39`).
3. **RETRACTED — caller selection of a graphify `memory_target` namespace.** The
   namespace is one store-configured string; T6 exposes no caller selector, and
   adding one is inside graphify's principal gate
   (`tmp/ADDENDUM-2-retraction.md:31-40`).
4. **RETRACTED — any implication that citation grounding validates a lesson's
   truth or catches a free-form identifier.** `verifyVerbatim` proves only that a
   structured quoted string occurs in its named normalized source. A free field
   bypasses that guarantee (`tmp/ADDENDUM-2-retraction.md:48-59`).
5. **RETRACTED — the description of the anti-cycle as architectural text plus
   negative scans only.** Graphify-knowledge verified a concrete, fail-closed
   workspace-local file contact on its current branch; branch/merge status and
   the still-missing prospective CI import gate are stated separately below
   (`tmp/ADDENDUM-2-retraction.md:74-78`).

No section below relies on Addendum 1 as current evidence.

## 1. What is settled, and how far it is settled

### 1.1 Boundary ruling

**MANDATED:** graphify is the majority layer for perennial agent memory and h2a
does not build a store. The mandate is the commissioning brief at
`tmp/BRIEF-graphify-seam-spec.md:28-31`.

**GRAPHIFY-MEASURED cross-repository limit:** this is the h2a owner's architecture
direction, not a graphify-side decision. The graphify conductor names its
principal as `human:rhanka` and reports that nothing has been ruled on that side
(`tmp/ADDENDUM-2-retraction.md:90-95`). This specification is written
to the h2a direction, but graphify's ownership of the proposed seam remains a
cross-repository commitment **PENDING D8 ratification by the owner as
graphify's principal**. It is not settled by this document.

**VERIFIED in architecture text:** the `knowledge (graphify)` row is in the
`Modèle` column as **ADDITIF (fédéré)**. Its other columns say graphify keeps its
CLI, h2a exposes a thin `h2a knowledge …` dispatcher, and graphify never imports
h2a (`docs/specs/2026-06-27-h2a-semantic-v0-FOR-REVIEW.md:119-141`). The same
document places design/knowledge/agent-stats in its `DÉCIDÉ` section
(`:204-218`).

**Limit:** that document's header says it locks nothing (`:3-9`). The earlier
resegmentation document is `Status: PROPOSAL`, places `knowledge (ex-graphify)`
among h2a-org capabilities consuming libraries, and repeats the one-way import
direction (`docs/specs/2026-06-27-h2a-sentropic-resegmentation.md:1-5,35-49`).
The dedicated integration document is also `brainstorm / design-only`, keeps
graphify's CLI and models h2a as an argv/JSON/exit-code dispatcher, while leaving
graphify confirmation Q-K1..Q-K5 open
(`docs/specs/2026-06-27-h2a-design-knowledge-integration.md:1-9,67-128,130-140,155-157`).

**VERIFIED in track:** no explicit track decision ratifies the graphify thin
dispatcher or its anti-cycle. The exact journal query

```text
jq -s '[.[] | select(.aggregate == "decision") | select((.payload | tostring) | test("graphify|dispatcher mince|knowledge \\(graphify\\)"; "i"))] | {count: length, events: map({id, aggregateId, type, title: .payload.title})}' .track/events.jsonl
```

printed `{ "count": 0, "events": [] }` against h2a `origin/main` state. This is
a keyword-bounded negative search, not proof that no differently worded
decision exists. Event `01KWVM4ZM2ZMAYXNFTWRMBYSKY` on `origin/main` is an
`item.created` asking that graphify carry perennial multi-session context; it is
not a decision (`.track/events.jsonl:247`).

### 1.2 Owner direction that is not ratification

**VERIFIED direction, not decision:** the first owner-answer dossier says
`Status: direction, NOT a ratified decision`, describes the target as durable
memory plus ephemeral multi-CLI sessions, and selects local-first hosting
(`docs/decisions/2026-07-25-agent-memory-owner-answers.md:1-20,24-32,48-50`).
The second dossier says `owner direction, NOT a ratified design` and selects
graphify as one live+cold substrate plus a journal-as-truth/graph-as-projection
direction (`docs/decisions/2026-07-25-agent-memory-owner-answers-v2.md:1-6,19-40,59-64`).
Its 2026-07-31 D10 decomposition then records three owner-decided surrounding
choices—dual-coordinate ordering, live graphify plus committed recovery copy,
and keep-but-no-longer-current rewind—while the write trigger stays OPEN. It
records unified-repo plus per-job sharing only as owner direction requiring
h2a, harness, graphify and graphify-principal agreement
(`origin/main:docs/decisions/2026-07-25-agent-memory-owner-answers-v2.json:20-26`).
This spec treats all of them as design constraints, never as implemented
behavior. Every graphify mechanism they require is **PENDING D8**; sharing is
also not ratified by the other named owners.

### 1.3 Durable actor and session identity

**VERIFIED track decision:** the durable-actor model is represented by decision
aggregate `01KYQ89WANWD257Y3GCW7YM8BZ`, selected option A in events
`01KYQ89WF7YH95Q9TE75J3PMR6` and `01KYQ89WF8YD1SX43ERAF22474`
(`.track/events.jsonl:663-666`, present on local `origin/main`). It gives each
durable role continuity and assigns perennial context/memory to the memory lane.
That decision does not define a graphify record key or seam.

**MANDATED identity constraint:** no primary or subject key may contain an h2a
session or instance identity (`tmp/BRIEF-graphify-seam-spec.md:65-75`). The
measured reason is REC-07: one tmux session had distinct presence and bus IDs;
delivery to the presence ID returned success but landed in an unread inbox
(`memory/wake-recall-main:docs/agents/RECALL.md:158`, commit
`9c45dc2a16c85d20672c5455512cb82ac42aeff6`). `git merge-base --is-ancestor
memory/wake-recall-main origin/main` exited 1, `git branch -r --contains` named
only `origin/memory/wake-recall-main`, and `gh pr view 90` printed
`state:"OPEN"`, `mergeStateStatus:"CLEAN"`, head `9c45dc2…`. REC-07 is therefore
evidence on an open, unmerged branch, not behavior merged into h2a main.

**GRAPHIFY-MEASURED root boundary:** a bus root is a deployment accident and
must not enter the record key. Graphify neither knows nor prevents h2a
wrong-root dispatch; prevention belongs to h2a before dispatch. Graphify can
carry the selected root only as provenance, making a wrong-root record
detectable after the fact, not prevented
(`tmp/ADDENDUM-2-retraction.md:42-46`). The h2a resolver/owner remains
**OPEN-Q18**; graphify never imports h2a bus topology.

## 2. Substrate evidence, including its stopping point

### 2.1 Temporal storage, complete chain, and the stamping boundary

**VERIFIED by source and targeted test:** in the inspected storage-provider
source on graphify `origin/main`, `git grep -n 'queryWindow' origin/main --
src/storage src` printed an implementation/capability only in
`src/storage/postgres.ts:522,893,1151-1161`, plus the optional type contract and
temporal consumer. The file store exposes neither member
(`graphify/tests/storage-postgres-time-window.test.ts:249-264`). This bounded
source result supports “only the inspected Postgres provider,” not a claim about
uninspected plugins or future providers. The contract
round-trips inclusive points, closed spans and open intervals, excludes untimed,
malformed, inverted and non-overlapping records, validates bad bounds before
SQL, and isolates parameterized namespaces (`:266-354`). The command

```text
./node_modules/.bin/vitest run tests/storage-postgres-time-window.test.ts --no-cache --reporter=verbose --configLoader=runner
```

printed `Test Files 1 passed`, `Tests 7 passed | 1 skipped`; the skipped case was
the live-Postgres malformed-row guard conditional on
`GRAPHIFY_TEST_POSTGRES_URL` (`:388-426`). Live PostgreSQL behavior is therefore
**not measured** here.

**VERIFIED chain and corrected empty-result explanation:** the inspected
`.graphify/graph.json` command
`jq '{nodes:(.nodes|length), edges:(.edges|length), numeric_t_occurrences:([.. | objects | select(has("t") and (.t|type == "number"))] | length)}'`
printed `nodes: 8919`, `edges: 0`, and `numeric_t_occurrences: 0`. Postgres
serializes non-schema attributes into `props` unchanged
(`graphify/src/storage/postgres.ts:169-178`), keys nodes by
`(city_slug,id)`, retains `t`/`t_end` in JSONB, and creates numeric expression
indexes (`:285-304,327-352,439-451`). `pushGraph` builds node/edge rows and
transactionally upserts them (`:900-951`); `queryWindow` reads the same temporal
properties (`:1151-1205`). Graphify-knowledge also measured the round trip and
states explicitly that the chain is complete
(`tmp/ADDENDUM-2-retraction.md:8-20,24-26`). An empty query over the current
documentary/ontological graph is therefore legitimate: its producer emitted no
temporal anchors. It is not evidence of a missing feed.

**REQUIRED · PENDING D8 temporal producer semantics:** a future
authored-memory producer must emit numeric epoch-ms `t`, optional numeric
epoch-ms `t_end`, and string provenance `t_src` according to one fixed contract:

- absent `t` means timeless and never appears in temporal recall;
- absent `t_end` means an **OPEN** interval and remains visible at later instants;
- `t_end === t` means a **POINT**, used for a dated closed lesson;
- any other valid `t_end >= t` means a closed span.

These meanings are verified in the shared predicate and agent-stats comments
(`graphify/src/temporal-recall.ts:133-151`;
`graphify/src/agent-stats/project-graph.ts:293-315,581-590` on graphify branch
`feat/aclp-ontology-studio`) and are graphify-knowledge's measured Q1 answer
(`tmp/ADDENDUM-2-retraction.md:24-29`). The branch-only agent-stats producer is
not a MemoryNote writer and is not merged into inspected graphify `origin/main`;
that distinction is recorded in §10.

**GRAPHIFY-MEASURED interval correction, relayed; REQUIRED · PENDING D8
contract freeze:** executable graphify behavior is already closed-inclusive.
The scene renderer reads `node.t` and never `t_end`, so it has no executable
half-open membership path (`graphify/src/scene-layout.ts:186-198`). The latent
trap is one comment that says both “half-open, membership iff `t < w1`” and “a
point sets `t_end === t`,” which would exclude a point from its own instant
(`graphify/src/studio-scene.ts:32-34`). Temporal recall is closed-inclusive
(`graphify/src/temporal-recall.ts:139-147`). The D9 prerequisite therefore
holds today: one executable convention already runs end-to-end. Before adding
the second temporal axis, graphify must freeze the `studio-scene.ts` contract
comment to that implemented convention, with zero behavior change. This is a
contract to freeze, a latent trap, **not code debt or a renderer migration**.
Because `studio-scene.ts` belongs to the renderer role, graphify's conductor
carries that cross-role coordination; h2a edits nothing there
(`tmp/BRIEF-seam-finalize.md:24-35`).

**DECIDED BY THE OWNER; REQUIRED · PENDING D8 ordering contract:** every note
carries both a conversation-scoped turn number and real write-time. Turn number
orders notes within one conversation; numeric `t` orders across conversations
and agents. The accepting writer, not the author/agent, stamps `t` at real
receipt/write time, sets `t_src` to the exact derivation identifier
`received-at`, and retains an author-supplied time separately as `authored_at`.
It also records `turn_src=conversation-turn`; `t_src` is not overloaded to claim
that `t` came from a turn. Each stored entry therefore names the source of both
coordinates. Every ordered result repeats, on each returned entry,
`order_source=turn_src` for within-conversation order or `order_source=t_src`
for cross-conversation order, rather than leaving that choice implicit in the
consumer. This entry-level encoding is itself **PENDING D8**. It confirms
graphify-knowledge Q7 after it measured an envelope post-dated by about twelve
minutes (`tmp/ADDENDUM-2-retraction.md:80-88`) and folds D10(a)
(`origin/main:docs/decisions/2026-07-25-agent-memory-owner-answers-v2.json:20-23`).
Graphify merely passes `t_src` through and does not verify it. The future writer
must refuse caller-supplied `t`/`t_src` masquerading as receiver time.
Multi-host receiver-clock authority, equal-time tie-breaking and monotonic
sequencing remain **OPEN-Q7**.

**VERIFIED correction to the broad Postgres claim:** graphify's higher-level
`recallAsOf` reads `graph.json` directly when no store is selected, applying the
same temporal predicate (`graphify/src/temporal-recall.ts:1-8,243-271,357-383`).
Once a store is selected, a missing capability, connection/query failure, or
empty result never silently switches to the file (`:317-355` and
`graphify/spec/SPEC_AGENTSTATS_TIMEORIENTED.md:241-255`). The command

```text
./node_modules/.bin/vitest run tests/temporal-recall.test.ts tests/cli-temporal-recall.test.ts --no-cache --reporter=verbose --configLoader=runner
```

printed `Test Files 2 passed` and `Tests 12 passed`. Thus chronological local
recall does not inherently require Postgres; `GRAPHIFY_STORE=file` is not that
path, because a selected file store lacks `queryWindow`. The local path is an
explicit graph source or no selected store.

The file path is a real existing degraded mode, not a missing-feed workaround.
It always reports `freshness: "unverified"`, and node/edge membership is
deliberately independent, so the result is not necessarily an induced subgraph
(`graphify/src/temporal-recall.ts:243-271,357-383,386-404`).
Graphify-knowledge's fixture returned an edge whose source node was absent
(`tmp/ADDENDUM-2-retraction.md:61-72`). A memory consumer must therefore reject
or remove any edge whose two endpoints are not both present; it must never
fabricate the missing node.

**Stopping point:** T6 explicitly models neither authored memory nor semantic
relevance (`graphify/src/temporal-recall.ts:1-8`). Every file/store result says
`freshness: "unverified"`; a store metadata failure becomes `snapshot: null`,
and the response still succeeds (`:46-75,336-350,368-398`). Its normative spec
says it is temporal graph recall only, adds no write path, treats namespace as
partition rather than authorization, and does not verify provenance, freshness,
authorship, integrity or trust
(`graphify/spec/SPEC_AGENTSTATS_TIMEORIENTED.md:183-188,241-271,280-296`). It
also says h2a has no ratified versioned MemoryNote/persona/knowledge body or
read/write command (`:285-296`). Current T6 plus `store push` is therefore a
reachable lower-level primitive, not a ratified authored-memory schema,
producer, or h2a write seam.

### 2.2 Canonical data, citations, and the graph renderer

**VERIFIED current storage contract:** `.graphify/graph.json` is described as
the source of truth and GraphStore backends as pushed projections
(`graphify/src/storage/types.ts:1-5`). `GraphStore` exposes whole-graph push and
optional read capabilities; it does not expose an authored-memory append API
(`:179-260`). **GRAPHIFY-MEASURED correction, relayed:** its only write is
`pushGraph`; merge upserts a whole submitted graph and replace clears then loads
one. There is no element-level “append one node/edge” operation. Live memory
cannot re-push the whole graph for each note. An atomic element-level write is
therefore graphify **WORK · PENDING D8**, not an acquired capability
(`tmp/BRIEF-seam-finalize.md:36-39`). This also conflicts with the owner
directions that live graphify has a smaller committed recovery copy (D10(b)) and
that a journal should be truth with graph projection (D12). Resolution remains
mechanism work under **OPEN-Q5,Q6**, not an assertion by this spec.

**VERIFIED proposal status:** `graphify/spec/SPEC_GRAPH_DB_BACKENDS.md:1-13`
still says `(proposal)`, `Draft / proposal (no implementation)`, and retains
`graph.json` as canonical. That status does not itself prove the state of the
implemented temporal files above.

**VERIFIED citation refusal, with its exact limit:** graphify has deterministic
citation identity, union and top-K selection
(`graphify/src/citations.ts:1-12,39-100`). Its grounding helpers call
`verifyVerbatim`, which normalizes a quote and returns true only when that string
occurs in the normalized source; non-verbatim and term-mismatched emissions are
dropped (`graphify/src/source-grounding.ts:315-320`;
`graphify/src/cite-grounding.ts:202-289,370-391`). The cited-source validator
separately requires a locator, modality-appropriate anchor and evidence text
(`graphify/src/cited-source-refs.ts:111-141`).

**REQUIRED answer to graphify-knowledge:** an agent-memory entry carries a
**structured artefact citation**, never a free evidence field. The structure has
a named source/locator, exact quoted string, positional anchor where applicable,
and source revision/digest. If a ULID or other identifier is evidence, the exact
identifier must appear as the quoted string in the named artefact. A free-form
ULID field is rejected by the memory schema before grounding because it bypasses
`verifyVerbatim` (`tmp/ADDENDUM-2-retraction.md:48-59,97-104`).

The mechanical guarantee stops at **source inclusion**: the quote really occurs
in the normalized named source. It does not establish that the memory assertion
is true, that the source is authoritative, or that `t_src` is honest. Binding
this reusable gate to a future graphify MemoryNote producer is **PENDING D8
ratification by the owner as graphify's principal**, not implemented behavior
(**OPEN-Q13**).

**VERIFIED package boundary:** `@sentropic/graph` calls itself rendering-first
and exports buffers, layouts, matrices, positions, geometry and renderers
(`graphify/packages/graph/README.md:1-16` and
`graphify/packages/graph/src/index.ts:1-19`). It is not the memory store; the
storage and citation substrate inspected above lives under graphify `src/`.

### 2.3 Graphify-knowledge's measured answers and corrections

These answers supersede the corresponding assumptions in `e74c4bd8`. “Measured”
does not mean graphify's principal ratified the cross-repository contract.

| Point | Measured answer adopted here | Remaining gate |
|---|---|---|
| Interval | executable recall is closed-inclusive; renderer code has no `t_end` path; one self-contradictory comment is the latent half-open trap | zero-behavior-change comment freeze before D9's second axis is **PENDING D8**, carried across renderer roles by graphify's conductor |
| Q1 — bulk path vs live write | `store push` carries stamped `t`/`t_end`/`t_src` through JSONB into `queryWindow`; absent `t_end` is OPEN and `t_end === t` is POINT. But `pushGraph` is whole-graph only; no element append exists | MemoryNote producer/schema plus atomic per-note write/receipt are graphify **WORK · PENDING D8** |
| Q2 — key | recommended seam mapping: store-configured namespace carries `workspace_uid`; node ID carries `record_uid`; host, role and durable subject are node attributes | mapping and any caller selection are **PENDING D8**; namespace is a data partition, not authorization, and caller selection is forbidden by the current seam |
| Q3 — roots | root never enters the key; h2a prevents wrong-root dispatch, while graphify may retain root only as provenance for after-the-fact detection | h2a resolver/topology owner remains OPEN-Q18; MemoryNote provenance binding is **PENDING D8** |
| Q4 — citations | memory evidence is structured named-source + verbatim quote; the gate proves inclusion only, never assertion truth | MemoryNote binding/approval remains **OPEN-Q13 · PENDING D8** |
| Q5 — offline | `recall --as-of … --graph … --json` exists; file freshness is always unverified; edges may lack returned endpoints; file GraphStore has no `queryWindow` | h2a must degrade explicitly and refuse dangling-edge inference |
| Q6 — anti-cycle | no h2a/a2a dependency or source import was found; graphify's only contact reads the exact workspace-local registry file and fails closed on path/symlink mismatch | strict reader is branch-only at `a7d605a6`; prospective CI import refusal remains **OPEN-Q15 · PENDING D8** |
| Q7 — clock | author-stamped ordering silently inverts under skew; D10(a) carries `turn_number`/`turn_src` plus receiver-stamped `t`/`t_src`, and every ordered result entry exposes the operative `order_source` | entry-level encoding/writer support is **PENDING D8**; receiver clock authority/monotonic ordering remains OPEN-Q7 |

Evidence: `tmp/ADDENDUM-2-retraction.md:22-88` and the relayed 2026 corrections
at `tmp/BRIEF-seam-finalize.md:22-43`. The strict registry reader is at
`graphify/src/agent-stats/registry.ts:71-116` on graphify branch
`feat/aclp-ontology-studio`; `git merge-base --is-ancestor HEAD origin/main`
exited 1, no remote branch contained that HEAD, and `gh pr list --head
feat/aclp-ontology-studio` printed `[]`.

## 3. Seam boundary

The following is the proposed boundary. Every row is **REQUIRED**, not a claim
about current code. Every future graphify action in the table is also **PENDING
D8**; current generic primitives are named explicitly as current.

| Concern | h2a | graphify | What must refuse |
|---|---|---|---|
| Authored record | May validate and dispatch only a D8-ratified contract; creates no independent h2a memory store | Would own the MemoryNote/producer schema and atomic per-note write; neither exists today | h2a refuses an invented/unratified envelope or success without graphify durability; authored-memory acceptance is **PENDING D8** |
| Durable subject | Resolves exactly one stable workspace+subject from governance context | Would store subject, host and role as node attributes under a **PENDING D8** MemoryNote schema, not namespace components | h2a refuses zero/multiple/ambiguous/session-derived subjects |
| Bus/address plane | Prevents wrong-root dispatch before graphify and supplies root only as provenance | Knows no h2a roots; future MemoryNote provenance binding is **PENDING D8** and can support detection, not prevention | h2a refuses ambiguous/wrong-root dispatch; graphify cannot provide that refusal and must not be credited with it |
| Namespace | Uses the graphify deployment configured for the workspace; never chooses a namespace per request | Current physical config supplies one `city_slug`; mapping proposed `workspace_uid` into it is **PENDING D8**. Namespace partitions data but does not authorize it | the h2a surface exposes no namespace selector; any future caller selection is **PENDING D8** |
| Temporal producer | Carries conversation turn plus authored time, but does not accept author-controlled cross-agent ordering | Future writer carries `turn_src=conversation-turn`, stamps receiver-controlled `t`/`t_src=received-at`, and returns entry-level `order_source`; support is **PENDING D8** | writer refuses missing coordinate sources, author-supplied receiver stamps, malformed/inverted bounds and unstructured evidence |
| Bulk substrate path | Dispatches only; builds no duplicate feed or shadow store | Existing `graph.json` → whole-graph `store push` → JSONB/index → `queryWindow` chain is complete | no invented `FEED_NOT_READY` gate; ordinary push/query errors are surfaced without h2a fallback |
| Live element write | Dispatches only after D8 ratification; never re-pushes the whole graph once per note | Must add an atomic one-node/edge append and durability receipt; `GraphStore` lacks both today | attempted live write refuses until the **PENDING D8** capability and contract exist |
| Recovery copy | Does not invent a second store; may consume/validate the committed artefact defined by the ratified contract | Must define and produce the smaller rebuild-sufficient projection, its cadence, and live-versus-copy comparison | a clone/rebuild or degraded read refuses when the copy's contents, production point, or comparison receipt are absent; contract is **PENDING D8** |
| Read at wake | Uses the deployment-configured source, treats unverified freshness as degraded, and rejects dangling-edge inference | Returns temporal nodes and edges under existing T6 semantics; file/store results remain freshness-unverified | h2a refuses `MEMORY_VERIFIED` from current T6 and refuses any edge whose endpoint is absent |
| Offline operation | Selects `--graph <file>` explicitly or declares documentary degradation | Existing file as-of path reads stamped graph data; file GraphStore has no `queryWindow` | neither side silently changes source after a store was selected; offline output is never called attested |
| Anti-cycle | Depends on graphify's CLI/API or neutral contract only | Imports no h2a package/runtime; branch-only agent-stats reads one exact workspace-local file path, non-symlinked and fail-closed | current path filter returns no evidence on mismatch; a future graphify CI dependency/import gate is **PENDING D8** and must fail the forbidden edge |

The h2a-side conformance artifact must be a top-level JavaScript test under
`packages/h2a/test`, because the required root gate discovers that directory and
does not discover `packages/h2a-runtime`
(`scripts/run-tests.mjs:10-19,29-58`). The proposed filename is
`packages/h2a/test/perennial-memory-seam.test.js`. Graphify provider and schema
fixtures would belong under graphify `tests/`, beside the three targeted suites
above, and are **PENDING D8**. Those tests do not exist and were not run.

The existing h2a anti-cycle check only rejects selected h2a-core dependency-name
substrings (`scripts/check-public-contract.sh:30-36`). Graphify-knowledge verified
no h2a/a2a dependency or source import and one file-only contact
(`tmp/ADDENDUM-2-retraction.md:74-78`). The inspected strict reader resolves
`<project-root>/.h2a/registry/instances.jsonl`, refuses symlink/path escape and
filters records to the exact workspace
(`graphify/src/agent-stats/registry.ts:71-116`, branch
`feat/aclp-ontology-studio`, commit `a7d605a6`, not on inspected
`origin/main`). That is verified present behavior on the named branch. It is not
a prospective CI mechanism that would refuse a newly added import; **OPEN-Q15 ·
PENDING D8** retains that separate gate.

## 4. Record key and address

### 4.1 Primary key

**Proposed mapping from graphify-knowledge Q2 · PENDING D8, with semantic
identity details still OPEN-Q2..Q4:** workspace is the configured graphify
namespace; host and role are queryable node attributes, not namespace
components.

```text
proposed store-config mapping: namespace/city_slug <- workspace_uid
current physical graph-node PK = (city_slug, record_uid)
subject_ref = (workspace_uid, subject_uid)
logical record locator = (workspace_uid, record_uid)
proposed node attrs include subject_uid, host, role, job_ref?, conversation_ref,
  turn_number, turn_src, root_provenance, t, t_end?, t_src
ordered result entry includes order_source = turn_src OR t_src
address-plane context = one bus_root_ref OR bus_federation_ref (h2a-side only)
```

- Under the **PENDING D8** mapping, `workspace_uid` is serialized as the single
  namespace chosen in graphify store config. Current Postgres keys nodes by
  `(city_slug,id)` (`graphify/src/storage/postgres.ts:285-304,327-352`). The h2a
  seam exposes no per-request selector, and namespace is partition, not
  authorization (`tmp/ADDENDUM-2-retraction.md:31-40`).
- `subject_uid` is an immutable durable-subject identifier. Whether the subject
  is one role-shared memory or one durable actor occupying a role is OPEN-Q4;
  the current role slug is a mutable alias, not identity.
- `record_uid` is the graph node `id`, unique inside the configured workspace
  namespace. It distinguishes many records for one subject. Minting and alias
  rules remain OPEN-Q2.
- host and current role slug are attributes. They support `(host,role)` queries
  without multiplying store partitions and never become record identity.
- `conversation_ref` plus `turn_number` preserves within-conversation order;
  optional `job_ref` preserves the per-job compartment capability inside the
  unified workspace graph. These proposed MemoryNote attributes and their
  filters are **PENDING D8**; neither namespace nor an attribute grants access.
- root is an optional provenance attribute only. Graphify can expose a
  wrong-root stamp for detection but cannot refuse the original h2a dispatch.
- a future `operation_id` is separate from the graph-node key and would make a
  ratified authored-write retry idempotent; that write contract remains
  **OPEN-Q6 · PENDING D8**.
- `bus_root_ref`/`bus_federation_ref` is h2a address-plane context, not a
  graphify store ID and not a session-minted actor UUID. It is never folded into
  `subject_ref`. h2a must reduce it to one result or refuse before dispatch;
  graphify sees only the provenance attribute emitted by the eventual producer.
  Owner semantics are **OPEN-Q18**.
- CLI provider, h2a instance/session IDs, tmux name, checkout path and branch are
  provenance or aliases only and never key components.
- `workspace_uid` and `subject_uid` travel in a typed identity envelope with an
  issuer/kind only after D8 ratification of a MemoryNote schema. Opaque strings
  alone cannot distinguish a durable subject from a session ID; issuer,
  credential and validation rules are **OPEN-Q2..Q4 · PENDING D8** on the
  graphify side.

UID authority, workspace serialization, typed issuer/credential and alias
migration are **OPEN-Q2..Q4**. A content hash alone is not recommended as
identity because correction, contradiction and supersession need distinct
records; exact lifecycle semantics are **OPEN-Q8**.

The key cannot cure an h2a routing partition. Before graphify dispatch, the h2a
address plane must resolve one authoritative bus root or one explicitly
federated bus view. A D8-ratified MemoryNote could record only the chosen root
provenance after the fact. This is deliberately asymmetric: h2a prevention,
graphify detection **PENDING D8**. Graphify does not learn how h2a presence or
bus paths are laid out.

The proposed key is falsified by
`packages/h2a/test/perennial-memory-seam.test.js` if changing a session loses an
otherwise unchanged subject's records, if a declared alias migration loses or
crosses records, or if two records in one subject scope collide. Host changes
must preserve records because host is an attribute, not identity. The h2a
fixture must model an ambiguous/wrong root and observe refusal before graphify
dispatch. A **PENDING D8** graphify fixture must instead prove that the selected
root survives only as queryable provenance. No fixture may expose a
caller-chosen namespace.

### 4.2 Evaluation of `(host, workspace, role)`

The proposed `(host, workspace, role)` tuple does **not** align directly with
graphify storage. Graphify-knowledge's measured model has one store-configured
namespace string, not a per-record composite
(`tmp/ADDENDUM-2-retraction.md:31-40`). This spec proposes its recommended
translation **PENDING D8**: `workspace_uid` is the namespace; host and role are
node attributes; `record_uid` is the node ID.

| Change/case | What the tuple survives | Where it fails |
|---|---|---|
| New session/instance | Yes: no session value enters namespace or node identity | Any hidden use of a presence/bus/instance ID repeats REC-07 and must be refused |
| Ambiguous/wrong bus root | Key remains unchanged; h2a refuses before dispatch | Graphify can only detect emitted root provenance after the fact |
| Repo rename | Only if `workspace_uid` is an opaque stable configured namespace | A repo name, basename or mutable remote-derived namespace changes |
| Workspace move | Yes if namespace is independent of path | A path-derived namespace changes |
| Role rename | Record remains under the workspace namespace | Role attribute and durable-subject alias require migration; slug is not identity |
| Two repos each with `architect` | Yes when their configured workspace namespaces differ | Clone/fork/logical-project semantics remain OPEN-Q3 |
| Host rename, reinstall or another machine | Record remains because host is an attribute | Provenance/queries change; alias/history policy remains OPEN-Q4 |
| Two records for one actor | Yes through distinct `record_uid` node IDs | Collision inside one workspace namespace must refuse |
| Two actors sharing one role in one workspace | Only if distinct `subject_uid` attributes are ratified | Role alone cannot distinguish them |

The current track workspace key must not be reused by assumption. REC-06 reports
a history-absorption failure for that key
(`memory/wake-recall-main:docs/agents/RECALL.md:157`, open PR 90 head
`9c45dc2…`). Whether a clone, fork, worktree or absorbed history is the same
logical workspace is **OPEN-Q3**.

## 5. Write path

### 5.1 Existing bulk graph path — not a live write capability

No feed is missing for a complete stamped graph:

1. A graph producer emits nodes into `graph.json`, including numeric `t`,
   optional `t_end`, `t_src`, and arbitrary semantic/provenance attributes.
2. Store configuration fixes the one workspace namespace. The caller does not
   select it.
3. `graphify store push` submits the whole graph and preserves non-schema
   attributes in JSONB `props`; merge upserts the submitted graph, while replace
   clears then loads it.
4. `queryWindow` returns stamped nodes/edges under POINT/OPEN/span semantics.

This bulk path is current graphify infrastructure, verified in §2.1 and measured
by graphify-knowledge. A graph that omits `t` legitimately remains timeless.
But `GraphStore` has no append-one-node/edge operation: a live memory writer may
not re-push the whole graph for every note. “Complete batch feed” therefore does
not mean “element-level living-memory storage”
(`tmp/BRIEF-seam-finalize.md:36-39`).

### 5.2 Future authored-memory and element write — PENDING D8

Graphify has no ratified MemoryNote schema, element-level write, or h2a write
surface. Those fields, transport and durability semantics remain **OPEN-Q1,Q6 ·
PENDING D8**; this specification does not invent an envelope inside graphify's
hard gate (`tmp/ADDENDUM-2-retraction.md:90-95`). It fixes only the invariants a
future D8-ratified producer must satisfy:

1. h2a resolves one durable subject and refuses a missing, ambiguous,
   session-derived or wrong-root address before dispatch. It creates no
   independent h2a memory store.
2. The candidate's evidence is a structured named-source/verbatim citation. A
   free evidence field is refused before graphify grounding.
3. The candidate carries `conversation_ref`, `turn_number` and
   `turn_src=conversation-turn`. The accepting writer stamps real write-time `t`
   and `t_src=received-at`, keeps author time in `authored_at`, applies the
   POINT/OPEN rule in §2.1, and records the selected h2a root only as provenance.
   Each ordered result entry sets `order_source` to the source field it used.
4. Graphify atomically appends the note within the workspace-configured graph,
   with host, role, job and subject as attributes, and returns a durability
   receipt. This is required new graphify work; the existing whole-graph
   `pushGraph` is not invoked once per note.
5. h2a may report durability only from that eventual D8-ratified result. If
   graphify is unavailable or write status is unknown, h2a reports exactly that
   uncertainty; it never claims persistence, switches namespace, or invents an
   `.h2a` WAL, queue, cache, shadow graph or automatic fallback.

Exact append atomicity, idempotency, receipt and failure-code semantics remain
**OPEN-Q6 · PENDING D8**, rather than the invented `FEED_NOT_READY` protocol
retracted in §0. The owner-directed recovery copy in §5.3 is an explicit,
bounded projection contract—not an h2a outbox or silent fallback. `RECALL.md`
remains a read/bootstrap input unless that recovery contract later selects and
defines it.

### 5.3 D10 surrounding choices and their remaining gates

The original D10 write trigger—*when* to capture a note—remains **OPEN**. The
2026-07-31 decomposition decided three surrounding choices and recorded one
multi-owner direction (`origin/main:docs/specs/2026-07-25-h2a-agent-memory-merged-design.md:284-322`):

1. **Ordering — DECIDED BY THE OWNER, not implemented:** turn number and real
   write-time both travel; each stored entry names `turn_src` and `t_src`, and
   each ordered result entry names the operative `order_source`, as specified in
   §2.1. This entry-level encoding and writer support are **PENDING D8**.
2. **Location — DECIDED BY THE OWNER, not implemented:** daily working memory is
   live in graphify and a smaller recovery-sufficient copy is committed with the
   repository. The copy is not the whole graph. Graphify's element-level write
   and a recovery contract defining **what** is copied, **when** it is produced,
   how a clone rebuilds from it, and **how** it is compared/reconciled with live
   state remain **OPEN · PENDING D8**. “Live” names the working location, not an
   uptime guarantee.
3. **`/rewind` — DECIDED BY THE OWNER, not implemented:** notes from rewound
   turns stay in history marked `no-longer-current`; ordinary searches exclude
   them, while an explicit discarded-path query may include them. Representation,
   filtering and audit mechanics remain **OPEN · PENDING D8**. Silent deletion
   or treating a rewound note as current violates this choice.
4. **Sharing — OWNER DIRECTION, NOT RATIFIED:** one unified graph per repository
   mutualizes common project history **and** retains per-job compartmentalization
   as a capability. Both properties must hold; namespace=workspace and role/job
   are attributes queried inside that graph. H2a, harness, graphify and the owner
   as graphify's principal must agree. Graphify work is **PENDING D8**; access,
   pruning, leakage, atomicity and performance remain OPEN. Cross-repository or
   cross-workspace sharing is future-important owner direction, outside this
   seam and still inside graphify's hard gate
   (`origin/main:docs/decisions/2026-07-25-agent-memory-owner-answers-v2.json:20-26`).

**Benchmark note:** the EXXETA `exxperts` benchmark in open PR #123 describes,
from its public README and **without code verification**, a shipping file-based
memory with human approval, exact-conversation provenance and per-day time
travel—the recall-as-of direction, not evidence of a literal identically named
command. That existing file-based pole supports the recovery-copy half of
D10(b): human gate, provenance and time-travel recall need not require a live
graph. It does **not** show that its files are repository-committed,
rebuild-sufficient or reconciled with graphify, and it does not define this
seam's recovery contents, graphify integration,
contradiction/bi-temporality, cross-agent ordering or common-history
mutualization, and implies no dependency (`docs/benchmark-exxperts` commit
`5cc0b6b5`: merged-design §8.6, lines 531-561).

## 6. Read path at wake

### 6.1 Complement, not an asserted replacement

**REQUIRED proposal:** the dynamic graphify bundle complements
`docs/agents/RECALL.md`; it does not yet replace it. The dossier's reading rules
require a locator, quarantine unresolved
locators, distinguish enforcement rungs, name measurement state, and ask what
refuses (`memory/wake-recall-main:docs/agents/RECALL.md:1-38`, open PR 90 head
`9c45dc2…`). Its own text says nobody is forced to open the file and that only a
generated doctrine `--check` currently refuses drift (`:40-63`).

`git ls-tree -r --name-only origin/main docs/agents/RECALL.md` printed no path;
the fallback is not merged into h2a main. Until graphify can represent doctrine,
refutations, recurrent defects, incidents, locators, quarantine and a
deterministic bootstrap projection, removal of the branch's file would lose the
only inspected form that carries those reading rules. D10(b) decides that some
smaller recovery-sufficient copy is committed; it does not decide that
`RECALL.md` is that copy. Its selection, contents, deterministic production and
eventual replacement/complement relationship are **OPEN-Q14 · PENDING D8**.
Whatever neutral file/projection is selected must preserve the one-way edge:
graphify never imports h2a.

### 6.2 Current temporal read surface and its limit

Before first-action prompt construction, h2a resolves the exact durable subject
or refuses. It then invokes graphify against the deployment-configured source;
it does not choose a namespace. Current T6 returns source kind, configured
namespace for a store, snapshot metadata when available,
`freshness: "unverified"`, and `unpaged: true`
(`graphify/src/temporal-recall.ts:304-383`). With stamped data this is a reachable
chronological read. It is not an attested authored-memory response.

Graphify's principal has not ratified MemoryNote/Persona semantics, an h2a write
or response envelope, caller namespace selection, cross-workspace reads, or
pagination/cursors (`tmp/ADDENDUM-2-retraction.md:90-95`). Therefore this spec
does not prescribe those fields. Independent freshness, completeness,
authorization, bounded semantic selection and any future receipt remain
**OPEN-Q11..Q15 · PENDING D8** where they require graphify work. A
self-consistent snapshot digest alone would still not prove that an independently
expected head was served.

### 6.3 What refuses

| Forbidden input/outcome | Required refusing mechanism |
|---|---|
| Wrong or ambiguous actor | h2a durable-address resolver refuses zero/multiple matches; response address must match byte-for-byte; it never picks the first candidate |
| Wrong or ambiguous h2a bus root | h2a address resolver refuses zero/multiple roots unless an agreed bus federation produces one subject; graphify is not invoked and does not import bus topology |
| Caller-selected namespace | h2a exposes no selector and uses only store configuration; any future selector is refused while **PENDING D8** |
| Unratified authored-memory schema or element write | h2a refuses dynamic write or verified-memory interpretation while **PENDING D8**; existing T6 data remains generic temporal graph data |
| Whole-graph push attempted once per note | h2a refuses; the live path requires the **PENDING D8** atomic element write and receipt, not `pushGraph` |
| Stale or unverifiable snapshot | current `freshness: unverified` or `snapshot: null` can only yield degraded temporal context, never `MEMORY_VERIFIED`; future independent proof is OPEN-Q11 |
| Dangling temporal edge | h2a rejects/removes the edge unless both source and target nodes are present; it never invents an endpoint or treats current output as induced |
| Store unavailable | retain graphify's existing no-post-selection-fallback behavior; a local source is used only when chosen before the request |
| Unstructured or non-verbatim evidence | h2a rejects a free evidence field; graphify `verifyVerbatim` rejects a structured quote absent from the named normalized source |
| Citation present but assertion false | neither citation gate may label the assertion true; approval/truth policy remains OPEN-Q8,Q13 |
| Missing `t` | current temporal recall legitimately omits the record; a future D8-ratified writer refuses an authored temporal record before element append if its receiver stamp is absent |
| Missing/ambiguous order coordinate | a future writer requires conversation+`turn_number`/`turn_src` and receiver-stamped `t`/`t_src`; every result entry exposes the operative `order_source`, while pass-through source labels alone are not truth verification |
| Author-controlled ordering time | the accepting writer overwrites/refuses caller `t`/`t_src` and stamps receiver time; graphify pass-through alone is not truth verification |
| Rewound record returned as current | ordinary search excludes the retained `no-longer-current` note; only an explicit discarded-path query may include it; mechanism is **PENDING D8** |
| Pending/unapproved record | any future graphify state/filter is **PENDING D8**; h2a never mixes the record silently with accepted memory |
| Invalid recovery copy | degraded recovery refuses when the selected committed artefact, production point, rebuild contract or live-comparison receipt is absent/mismatched; contract is **PENDING D8** |
| Unauthorized workspace | namespace partition is not authorization, so no current T6 response is promoted to authorized memory by namespace alone |
| Session/instance-derived key | h2a resolver refuses the address; a future graphify envelope refusal is **PENDING D8** and requires an accepted durable-subject kind/issuer/credential |

“Refuse memory injection” and “refuse the actor launch/first action” are separate
policies. The mechanical states are proposed as `MEMORY_VERIFIED`,
`DEGRADED_TEMPORAL`, `DEGRADED_BOOTSTRAP` and `MEMORY_UNAVAILABLE`. Current T6
can produce only `DEGRADED_TEMPORAL` because freshness is always unverified; the
consumer must disclose that status and remove dangling edges.
`DEGRADED_BOOTSTRAP` requires a successful read plus the future recovery
contract's receipt naming the bootstrap path, commit/blob digest, production
point, validation result and source revision;
absent, unreadable, untracked or drifted bootstrap data yields
`MEMORY_UNAVAILABLE`. Which state blocks launch, whether `required` or
`best-effort` is the default, and auditable break-glass behavior are
**OPEN-Q16**. No mode may convert unverified data into verified memory.

The h2a conformance test must mutate every row above and observe a refusal, not a
warning count. Required cases include wrong address, ambiguous root with zero
graphify dispatch, attempted namespace selection, `snapshot:null`, unverified
freshness, dangling edge, free-form ULID evidence, invented verbatim quote,
author-stamped `t`, missing/ambiguous turn-or-time order, missing `t`, malformed
POINT/OPEN bounds, whole-graph push attempted for one note, rewound-as-current,
unavailable store, an absent/unreadable/drifted recovery copy, and session-ID
churn. None of these h2a conformance tests exists or was run here.

## 7. What survives graphify or Postgres being absent

| Environment | Current evidence | Required seam posture |
|---|---|---|
| Postgres absent; graphify present; explicit graph source | Existing `recall --as-of … --graph … --json` returns POINT and OPEN stamped data, omits untimed data, reports `freshness: unverified`, and may return dangling edges (`graphify/src/temporal-recall.ts:243-271,357-404`; graphify-measured fixture at `tmp/ADDENDUM-2-retraction.md:61-72`) | expose only `DEGRADED_TEMPORAL`; remove dangling edges and never call the source attested |
| Postgres reachable; inspected 8,919-node graph | The graph printed zero numeric `t`, so an empty temporal result is legitimate; source and graphify-knowledge measurements show the whole-graph push/query chain is complete (§2.1) | no missing-feed project or `FEED_NOT_READY` error is introduced; live authored memory still waits for the **PENDING D8** per-note write |
| Postgres selected but unreachable | The error is surfaced and no file fallback occurs (`:317-355`; `graphify/tests/cli-temporal-recall.test.ts:250-285`) | retain refusal; any change to local mode is explicit and reconciliation-aware |
| File GraphStore selected | It declares `query:false` and lacks `queryWindow` (`graphify/src/storage/file.ts:58-67`; `graphify/tests/storage-postgres-time-window.test.ts:249-264`) | use the explicit `--graph` as-of path instead; do not pretend file GraphStore supports window queries |
| graphify absent | h2a source files and committed dossiers remain; `RECALL.md` would remain only if PR 90 or a successor merges. No D10 recovery-copy contract or artefact is implemented | no dynamic read or durable write; a future `DEGRADED_BOOTSTRAP` requires the D8-ratified committed copy plus its rebuild/comparison receipt, otherwise `MEMORY_UNAVAILABLE`; never a claim of current/full memory |

A perennial-memory design that requires reachable Postgres is **not acceptable**
as the laptop baseline. That judgment follows the mandate's explicit laptop
question (`tmp/BRIEF-graphify-seam-spec.md:84-87`) and the owner's unratified but
clear local-first direction
(`docs/decisions/2026-07-25-agent-memory-owner-answers.md:15-20,48-50`).
Explicit temporal degradation is acceptable when it is named, removes dangling
edges, refuses new durable writes when graphify is absent, and never reports
verified memory. The existing file as-of path satisfies the read primitive for
a laptop; what remains **PENDING D8** is authored-memory production, the
committed recovery contract and attestation—not an embedded query backend
(**OPEN-Q9..Q11**).

### 7.1 What can proceed now, and what waits

1. **May proceed without graphify-principal expansion:** h2a address/root
   refusal, tests for the existing `store push` temporal round trip, a degraded
   `--graph` reader that strips dangling edges, structured-citation validation,
   dual-coordinate/receiver-time skew tests, and validation of an already
   selected committed artefact. None of these authorizes graphify changes.
2. **PENDING D8 ratification by the owner as graphify's principal:** the interval
   comment freeze, MemoryNote/Persona semantics, per-note write and authored
   producer, any h2a write surface, final envelope/receipt, recovery-copy
   production/rebuild/comparison, rewind filtering, unified-repo/per-job sharing,
   caller namespace selection, cross-workspace reads, pagination/cursors, and a
   prospective graphify anti-cycle/version gate.
3. **Must wait for independent proofs:** any `MEMORY_VERIFIED` claim,
   authorization by workspace, bounded semantic completeness, and replacement
   of `RECALL.md`.

There is no missing **batch feed** gate in this sequence. OPEN-Q17 is retracted
only for that batch path; the live element-level write is **PENDING D8**.
OPEN-Q18 remains an h2a address-plane question.

## 8. Consensus questions for `graphify-knowledge`

Graphify-knowledge's measured answers to the seven questions in Addendum 2 are
recorded in §2.3 and are not reopened here. The remaining questions below are
**OPEN** unless explicitly marked **RETRACTED**. Every answer requiring graphify
work is also **PENDING D8 ratification by the owner as graphify's principal**;
an h2a-side answer alone does not ratify graphify behavior
(`tmp/ADDENDUM-2-retraction.md:90-95`).

1. **OPEN-Q1 — Contract ownership and transport.** Will graphify own and version
   the neutral authored-memory producer, read request, receipt and error schemas,
   with h2a limited to durable-address resolution and dispatch? Is the supported
   transport process JSON, a write-capable API/MCP service, or both? Will its
   principal ratify D8 and a prospective CI gate that refuses every h2a import
   and dependency? All graphify portions are **PENDING D8**.
2. **OPEN-Q2 — Record identity and idempotency.** Is `record_uid` alone the
   caller-visible identity within the workspace namespace, and who mints it?
   What exact `operation_id` collision/retry rules refuse two different writes
   under one idempotency key? The existing physical store key is
   `(city_slug, id)`; the seam proposes configured `city_slug = workspace_uid`
   (**PENDING D8**) and must not redesign it as `(host, workspace, role)`.
3. **OPEN-Q3 — Workspace identity.** Does `workspace_uid` mean logical project,
   git repository, clone, fork or linked worktree? What survives repo/remote
   rename, path move, history absorption and multiple clones, and which alias
   ambiguity refuses rather than merges or splits memory silently?
4. **OPEN-Q4 — Actor, role, typed authority and host semantics.** The unified
   repo graph plus retained per-job compartment capability is owner direction,
   not ratification. Within it, is memory shared by a role or owned by a durable
   actor occupying it? What typed
   subject kind, issuer or credential lets graphify refuse a session ID disguised
   as an opaque UID? How do role rename/split/merge and two same-role actors
   migrate? `host` and `role` are node attributes, not namespace components;
   which values and migration rules make those provenance attributes durable?
5. **OPEN-Q5 — Canonical store and recovery projection.** Does perennial memory make an append journal
   authoritative with the graph as projection, following owner direction D12,
   or retain current graphify `graph.json` authority with DB projections? What
   smaller committed artefact is sufficient to rebuild under D10(b), when is it
   produced, and what mechanism refuses journal/graph/recovery-copy drift? The
   existence of a committed recovery copy is decided; this mechanism is
   **PENDING D8**.
6. **OPEN-Q6 — Authored write surface and receipt.** What command/API appends one
   stamped memory record, and what atomic receipt proves durability? What are
   the ratified retry, idempotency and failure semantics, given that current
   `GraphStore` only pushes a whole graph? This spec does not invent an h2a
   envelope, projection receipt or failure-code vocabulary. All are **PENDING D8**.
7. **OPEN-Q7 — Concurrency.** Is V1 single-writer+namespace, optimistic append,
   or concurrent multi-writer? What revision precondition, conflict response and
   retry rule apply across Claude/Codex/Gemini/Hermes sessions? D10(a) fixes
   conversation turn plus receiver-stamped real write-time `t`; what receiver
   clock authority, multi-host skew bound and equal-time tie-breaker make the
   cross-conversation order reliable? The entry-level encoding is fixed as
   `turn_src=conversation-turn`, `t_src=received-at`, and each result entry's
   `order_source` selects the one it used; graphify support is **PENDING D8**.
8. **OPEN-Q8 — Approval, contradiction and lifecycle.** Which memory kinds may be
   automatic, pending, double-consensus-reviewed or human-approved? How are
   observed time, valid time, contradiction, supersession, correction,
   tombstone, retention, deletion and privacy represented? D10(c) already fixes
   `/rewind`: retain the note, mark it no-longer-current, omit it from ordinary
   search, include it only on explicit discarded-path recall. The exact
   representation/filter remains **PENDING D8**, not the user-visible outcome.
9. **OPEN-Q9 — Local-first authored production.** The existing
   `recall --as-of <t> --graph <file> --json` path supplies the degraded offline
   read primitive. D10(b) requires a smaller committed recovery copy; what
   graphify-owned producer makes it rebuild-sufficient without Postgres, and
   what RAM/OOM bounds apply? File freshness remains unverified rather than
   inferred. The contract is **PENDING D8**.
10. **OPEN-Q10 — Remote/local failure and reconciliation.** After a remote store
    is selected, may failure ever switch to local? If yes, only by which explicit
    policy, and how are live graphify and the decided committed recovery copy
    compared/reconciled without split-brain or h2a becoming an outbox/store?
    Any graphify mechanism is **PENDING D8**.
11. **OPEN-Q11 — Freshness proof.** Which monotonic revision/high-water mark can
    wake compare with an expected state independent of the serving replica?
    Which non-h2a authority persists and supplies that signed/pinned expected
    head to a cold session without making h2a a memory store? What exact
    condition returns `STALE` instead of today's
    `freshness: unverified`/`snapshot:null` success?
12. **OPEN-Q12 — Completeness and retrieval scale.** What atomic
   authoritative-journal range/root commitment, selection manifest,
   count/digest and cursor proves a bundle complete against an independently
   anchored head—not merely self-consistent? How are bounded semantic selection
   and pagination implemented—if graphify's principal ratifies pagination—without
   omitted records becoming silent partial memory or overflowing wake context?
13. **OPEN-Q13 — Evidence truth and authorization.** The citation shape is fixed:
   a quoted string plus named artefact, checked by literal normalized inclusion.
   When is the named artefact revalidated or quarantined, who evaluates the
   lesson's truth, and how is an authenticated workspace+subject bound to a
   namespace that is only a data partition? Who may read, write, approve,
   supersede and delete each memory kind?
14. **OPEN-Q14 — `RECALL.md` and the decided recovery copy.** D10(b) requires a
    committed recovery copy but does not select `RECALL.md`. Does graphify
    complement it, deterministically generate it or another neutral projection,
    or eventually replace it? What parity criteria cover doctrine, refutations, recurrent
    defects, incidents, locators, quarantine and mandatory pre-action delivery?
    What path/commit/blob/validation receipt makes a degraded bootstrap real
    rather than a label?
15. **OPEN-Q15 — Version and contract gates.** Which golden fixtures, supported
   version ranges and ownership rules jointly gate graphify providers and the
   h2a dispatcher? What fails release when schemas, refusal codes or local/server
   semantics diverge? Graphify measured the present anti-cycle and its branch
   has a strict file reader; which prospective CI gate and versioned fixtures
    make those properties durable? The prospective graphify gate is **PENDING D8**.
16. **OPEN-Q16 — Wake degradation policy.** Which failures refuse only memory
   injection and which refuse launch/first action? Is `required` or
   `best-effort` the default for durable actors, and what explicit audited
   break-glass is allowed when graphify and a receipt-validated committed
   bootstrap are absent? The policy must name current T6 file/store reads
   `DEGRADED_TEMPORAL`, preserve `freshness: unverified`, and remove dangling
   edges before any memory reaches a prompt.
17. **RETRACTED-Q17 — Bulk substrate feed and reachability.** This is not an open
    question. Addendum 2 refuted the missing-feed premise: complete `graph.json`
    → whole-graph `store push` → JSONB/index → `queryWindow` works. This
    retraction does **not** supply the absent element-level live write; that is
    graphify work under **OPEN-Q6 · PENDING D8**
    (`tmp/ADDENDUM-2-retraction.md:8-20,24-29`;
    `tmp/BRIEF-seam-finalize.md:36-39`).
18. **OPEN-Q18 — Address-plane topology, owner and neutral handoff (first routing
    gate).** Must h2a addressing use one authoritative bus root, or will an
    explicitly named h2a owner define federation?
    What pre-dispatch mechanism refuses an unknown, wrong or ambiguous bus root,
    and how does it prove one durable `subject_ref` without using either
    session-minted UUID? Which neutral proof/issuer may graphify validate without
    importing h2a or learning its bus topology? Root may be stored only as
    provenance for after-the-fact detection; graphify does not prevent h2a
    routing mistakes (`tmp/ADDENDUM-2-retraction.md:42-46`).
19. **OPEN-Q19 — Unified repo graph plus job compartments.** What `job_ref`,
    access/filter, pruning and leakage rules preserve per-job compartments while
    mutualizing common history in one repo graph? Which atomicity and performance
    bounds keep both properties true? H2a, harness, graphify and graphify's
    principal must agree; graphify work is **PENDING D8**. Cross-workspace sharing
    is future-important but outside this seam.

## 9. Refusal-oriented acceptance requirements

No requirement below is implemented by this document. Requirements that need
graphify changes remain **PENDING D8**, even when their desired result is
owner-decided.

1. Changing only an h2a session/instance ID preserves the resolved subject address
   and recalled records; introducing a session ID into an identity slot is
   refused.
2. The **PENDING D8** seam mapping uses configured `workspace_uid` as the single
   physical `city_slug` namespace; `host`, `role` and job remain attributes. A
   reader has no caller-chosen namespace selector, and namespace is never
   treated as authorization.
3. A production-shaped node carrying `t`, optional `t_end`, and `t_src` passes
   through existing `store push`, retains those attributes in Postgres props,
   and is retrieved by the temporal query at its eligible instant.
4. Temporal fixtures prove all four states: missing `t` never surfaces;
   `t_end === t` is a POINT visible at that instant only; absent `t_end` is OPEN
   and remains visible later; `t < t_end` is a bounded span. Malformed bounds are
   rejected rather than silently reinterpreted. Before D9's second axis, the
   **PENDING D8** `studio-scene.ts` comment is frozen to this already-executable
   closed-inclusive convention with zero behavior change.
5. The authorized writer requires `conversation_ref`, `turn_number` and
   `turn_src=conversation-turn`, stamps real write-time `t` at receipt with
   `t_src=received-at`, preserves untrusted author time separately as
   `authored_at`, and refuses an author value masquerading as receiver time.
   Every ordered result entry sets `order_source=turn_src` or
   `order_source=t_src` to identify the coordinate that produced its order.
   Writer/result support is **PENDING D8**; multi-receiver clock behavior remains
   gated by OPEN-Q7.
6. Every evidence-bearing entry uses a structured citation with a verbatim quote
   and named artefact. A fabricated ULID in a free field is rejected; a quoted
   ULID absent from the named source fails grounding. A successful inclusion
   check never labels the lesson true. MemoryNote binding is **PENDING D8**.
7. The offline file fixture proves POINT/OPEN/missing-`t` behavior, reports
   `source.kind = file` and `freshness: unverified`, and strips any edge whose
   endpoint is absent from returned nodes before h2a consumes the result.
8. Postgres failure does not silently select the file backend. File
   `GraphStore` window queries remain unsupported (`query:false`); only the
   explicit file as-of command is the offline read primitive.
9. An unknown, wrong or ambiguous h2a root refuses at dispatch and records zero
   graphify calls. A **PENDING D8** MemoryNote binding may make mismatched root
   provenance detectable afterward but is never credited with preventing the
   dispatch.
10. A graphify source or package that imports h2a fails the prospective graphify
    CI gate; the exact, non-symlinked, fail-closed registry file reader remains a
    data-file boundary rather than an h2a import. The prospective gate is
    **PENDING D8**; the present no-import measurement is not that gate.
11. The h2a refusal mutations live in
   `packages/h2a/test/perennial-memory-seam.test.js`, so the required root gate
   reaches them. Tests placed only in `packages/h2a-runtime` do not satisfy this
   requirement (`scripts/run-tests.mjs:10-19,29-58`).
12. The **PENDING D8** recovery contract produces a smaller committed,
   rebuild-sufficient copy and receipt naming contents, production point,
   commit/blob digest and live-comparison result. Absence, unreadability or drift
   refuses `DEGRADED_BOOTSTRAP`. `DEGRADED_TEMPORAL` is allowed for a successful
   current T6 file or store result only when the source was selected before the
   request, unverified freshness is disclosed, and dangling edges are removed.
   The explicit file path in requirement 7 is the only offline case. Neither
   state reports verified memory.
13. A **PENDING D8** element-write fixture appends one stamped note atomically,
    returns its durability receipt, and proves the writer did not re-push the
    whole graph. Bulk `pushGraph` conformance in requirement 3 does not satisfy
    this live-write requirement.
14. A **PENDING D8** rewind fixture retains a rewound note, marks it
    no-longer-current, excludes it from ordinary search, includes it only when
    discarded paths are requested, and never silently deletes it.
15. A multi-owner-ratified sharing fixture proves one repo/workspace graph
    mutualizes common history while retaining a per-job filtered compartment;
    namespace alone grants no access, and one job cannot leak into another. The
    graphify half is **PENDING D8**.

## 10. Defects and gaps observed but deliberately not fixed

1. **The measured anti-cycle and strict reader are not yet a durable cross-repo
   contract.** Graphify measured no h2a/a2a dependency or import. Its current
   feature branch reads only the exact non-symlinked
   `<project-root>/.h2a/registry/instances.jsonl` path and fails closed, but the
   agent-stats changes are branch-only, have no PR, and are not in graphify
   `origin/main`. No prospective graphify CI gate yet refuses future h2a imports.
   That prospective gate is **PENDING D8**. This spec edits neither repository's
   gate (`tmp/ADDENDUM-2-retraction.md:74-78`).
2. **Graph backend proposal status is at least narrower than the implemented
   temporal tree.** `graphify/spec/SPEC_GRAPH_DB_BACKENDS.md:1-13` says
   proposal/no implementation for its proposed read/aggregation projection,
   while temporal store/recall code and targeted tests exist at graphify
   `origin/main` commit `54d771aea8b1b5feb8e3f13f49f8f41eafd83632`.
   Whether the status is intentionally scope-specific or stale is not measured;
   the graphify document was read-only and not corrected.
3. **The only inspected `RECALL.md` is not on main.** PR 90 is open and
   `git ls-tree origin/main docs/agents/RECALL.md` printed no path. This spec does
   not merge that PR or manufacture a fallback file.
4. **A NUL byte is present in a graphify source file.** The read-only command
   `rg -n -i 'memory sink|memory_sink|memory-sink|MemoryNote|temporal recall|queryWindow|recall' ...`
   printed `src/extract.ts: WARNING: stopped searching binary file after match
   (found "\\0" byte around offset 241837)`. It is outside this seam and was not
   touched.
5. **REC-07's evidence row appears structurally malformed.** The four-column
   recurrent-defects table has duplicated trailing evidence/rung cells at
   `memory/wake-recall-main:docs/agents/RECALL.md:158`. It is on open PR 90 and
   was not edited.
6. **Track has two pre-existing markdown desynchronizations.** `track validate`
   printed `INVALID: 0 integrity + 2 desync finding(s)` for items
   `01KW9SYS9260VJHWMWSJ7T90CE` and `01KX944X2B7CC0E6D4BR41E03Q`, each naming a
   missing referenced specification. This task did not create either journal
   item and did not repair or write `.track/`.
7. **Production-time memory stamping and element-level write are absent.** The inspected
   `.graphify/graph.json` has 8,919 nodes and no numeric `t`; such nodes correctly
   do not surface in a temporal window. The bulk whole-graph chain is complete.
   What is absent is a D8-ratified authored-memory writer that atomically appends
   one note with conversation turn, `t`, optional `t_end` and `t_src`, then
   returns a durability receipt. That is graphify **WORK · PENDING D8**
   (`tmp/ADDENDUM-2-retraction.md:8-20`;
   `tmp/BRIEF-seam-finalize.md:36-39`).
8. **Author time is demonstrably unsafe as the ordering coordinate.** Addendum 2
   records an h2a envelope post-dated by about twelve minutes because the sender
   hand-wrote `createdAt`. D10(a) now keeps conversation turn plus
   receiver-stamped real write-time `t`, but a shared receiver clock authority,
   equal-time tie-break and multi-host ordering rule remain OPEN-Q7
   (`tmp/ADDENDUM-2-retraction.md:80-88`).
9. **The cross-repository majority-layer commitment is not ratified by
   graphify.** The h2a owner direction is the mandate for this document, while
   the interval contract freeze, authored MemoryNote/Persona semantics,
   element-level writes, any h2a write shape, recovery-copy mechanics, rewind
   filtering, unified-repo/per-job sharing, caller namespace, cross-workspace
   reads, pagination and prospective anti-cycle/version gates are **PENDING D8**
   by graphify principal `human:rhanka`
   (`tmp/BRIEF-seam-finalize.md:73-80`;
   `tmp/ADDENDUM-2-retraction.md:90-95`). This spec does not record a decision on
   that principal's behalf.
10. **H2a root refusal is not implemented by this specification.** Root is not a
    graphify key. H2a still needs an authoritative address-plane rule and
    pre-dispatch refusal; graphify can retain root provenance only for detection
    after the fact (`tmp/ADDENDUM-2-retraction.md:42-46`).
11. **The half-open interval statement is a latent contract trap, not code
    debt.** Graphify-knowledge reports that all executable behavior is already
    closed-inclusive and the renderer never reads `t_end`; only the
    self-contradictory `studio-scene.ts` comment needs a zero-behavior-change
    freeze before D9's second axis. That cross-renderer-role coordination is
    graphify-owned and **PENDING D8**
    (`tmp/BRIEF-seam-finalize.md:24-35`).
12. **The D10 recovery, rewind and sharing mechanisms do not exist here.** The
    owner-directed outcomes are folded into §5.3, but this lane did not implement
    or measure a rebuild-sufficient committed copy, live/copy comparison,
    no-longer-current search filter, or unified-repo/per-job isolation. Their
    graphify portions are **PENDING D8**
    (`origin/main:docs/decisions/2026-07-25-agent-memory-owner-answers-v2.json:20-26`).

## 11. Guarantee boundary

The following were measured in this work:

- the named h2a and graphify local remote-tracking commits and diffs;
- the exact architecture, decision, journal, Recall-branch, storage, recall,
  citation and previously inspected renderer lines cited above, excluding the
  explicitly relayed 2026-07-31 graphify corrections below;
- PR 90's printed open/unmerged state;
- local `origin/main` `e328248e…` D10 sources and PR #123's printed OPEN state,
  plus benchmark commit `5cc0b6b5` content; not the exxperts implementation;
- graphify's targeted fake/in-process temporal suites: 7 pass + 1 live-DB skip,
  then 12 pass;
- the bounded graphify `origin/main` source grep for `queryWindow`, whose only
  concrete storage implementation/capability assignment was in
  `src/storage/postgres.ts`;
- graphify's citation-policy, `verifyVerbatim`, grounding-emission and
  cited-source validation source lines named in §2.2;
- the inspected `.graphify/graph.json`: 8,919 nodes and zero numeric `t`
  attributes;
- the existing Postgres pass-through, temporal indexes, `store push` transaction,
  `queryWindow` reader, file temporal predicate and independent node/edge
  filtering paths cited in §2;
- the graphify feature-branch diff/status for its agent-stats temporal stamping
  and strict h2a registry-file reader, including that it is not merged and has
  no PR;
- h2a `track validate`: `INVALID: 0 integrity + 2 desync finding(s)`, with the
  two item IDs recorded in §10.

The following were **measured by graphify-knowledge and recorded by Addendum 2,
but not independently rerun in this lane**: all 58 agent-stats stamping sites;
the exact offline fixture outputs for POINT, OPEN, missing-`t` and the dangling
edge; the repository-wide anti-cycle scan; the approximately twelve-minute h2a
author-clock skew; `t_src` pass-through; and the graphify principal's unratified
status (`tmp/ADDENDUM-2-retraction.md:8-20,61-95`).

The following 2026-07-31 corrections were also **measured by
graphify-knowledge and relayed in the commissioning brief, not independently
rerun in this lane**: renderer code reads only `node.t`; the sole half-open claim
is the contradictory `studio-scene.ts` comment while executable recall is
closed-inclusive; `GraphStore` has only whole-graph `pushGraph` modes and no
element append; and the recommended namespace translation is workspace in the
configured namespace with host/role as attributes
(`tmp/BRIEF-seam-finalize.md:22-43`).

The exxperts benchmark is **README-declared and not code-verified**. This lane
read the characterization in commit `5cc0b6b5`, not the external implementation;
it establishes neither Git-committed files nor a rebuild/reconciliation contract
(`5cc0b6b5:docs/specs/2026-07-25-h2a-agent-memory-merged-design.md:531-561`).

The following were **not measured**: a live PostgreSQL round trip in this lane,
an authored-memory write, any accepted authored record schema, wake injection,
element-level append/receipt, verified freshness, recovery-copy production or
rebuild/comparison, rewind filtering, unified-repo/per-job isolation,
local/server reconciliation, concurrent multi-CLI writes, cross-host identity,
authorization/privacy policy, latency, memory footprint, OOM behavior, full h2a
root test gate, graphify full test gate, D8 ratification, deployment, or owner
UAT.

This branch can only propose and preserve the seam. Only the owner can accept it,
and agreement on every remaining `OPEN-Q` plus explicit D8 ratification for each
graphify commitment belongs in the consensus record before implementation.
RETRACTED-Q17 removes only the missing-bulk-feed premise; it is not authority for
the live element-write path.
