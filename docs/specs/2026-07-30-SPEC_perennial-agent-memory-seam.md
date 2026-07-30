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

This document uses six evidence labels:

- **MANDATED** — fixed by the commissioning brief; this spec does not reopen it.
- **VERIFIED** — observed in the named file, commit, event, command, or test output.
- **GRAPHIFY-MEASURED** — measured directly by `graphify-knowledge` and preserved
  in `tmp/ADDENDUM-2-retraction.md`; source or data rechecked here is named
  separately.
- **RETRACTED** — appeared in commit `e74c4bd8` from superseded Addendum 1 and is
  explicitly not evidence or a requirement in this version.
- **REQUIRED** — proposed seam behavior, not present behavior. The named refusal
  and conformance test are what would falsify an implementation claim.
- **OPEN** — agreement is required from `graphify-knowledge` or another named
  owner; this document does not decide it.

The guarantee of this document stops at the evidence and proposed contract. It
does not establish implementation, deployment, owner acceptance, live-Postgres
behavior, latency, RAM/OOM behavior, privacy authorization, or cross-host
continuity.

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
   “missing-feed” delivery sequence, and OPEN-Q17 as an ingestion question.** No
   ingestion-side build is required. The missing component is a not-yet-ratified
   authored-memory producer that emits temporal attributes before the existing
   push (`tmp/ADDENDUM-2-retraction.md:18-26`).
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
cross-repository commitment pending that principal. It is not settled by this
document.

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
The second dossier says `owner direction, NOT a ratified design`, selects
graphify as one live+cold substrate and a journal-as-truth/graph-as-projection
direction, while keeping trigger, `/rewind`, commit mode, per-role memories,
live/commit reconciliation, and h2a mutualisation open
(`docs/decisions/2026-07-25-agent-memory-owner-answers-v2.md:1-6,19-40,59-64`).
This spec uses those answers as constraints and consensus inputs, never as
implemented or ratified behavior.

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

**REQUIRED temporal producer semantics:** a future authored-memory producer must
emit numeric epoch-ms `t`, optional numeric epoch-ms `t_end`, and string
provenance `t_src` according to one fixed contract:

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

**REQUIRED ordering choice:** perennial memory uses **receiver-stamped time**.
The accepting memory producer, not the author/agent, sets `t` to its
`received-at` instant and `t_src` to the exact derivation identifier
`received-at`. An author-supplied timestamp is retained separately as
`authored_at` and cannot control ordering. This adopts graphify-knowledge Q7
after it measured an envelope post-dated by about twelve minutes
(`tmp/ADDENDUM-2-retraction.md:80-88`). Graphify merely passes `t_src` through;
it does not verify that provenance claim. Therefore the accepting producer must
refuse a caller-supplied `t`/`t_src` masquerading as receiver time. Multi-host
receiver-clock authority and monotonic sequencing remain **OPEN-Q7**.

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
(`:179-260`). This conflicts with the unratified owner direction that a journal
should be truth and the graph its projection. Resolution is **OPEN-Q5**, not an
assertion by this spec.

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
this reusable gate to a future graphify MemoryNote producer remains pending
`human:rhanka`, not implemented behavior (**OPEN-Q13**).

**VERIFIED package boundary:** `@sentropic/graph` calls itself rendering-first
and exports buffers, layouts, matrices, positions, geometry and renderers
(`graphify/packages/graph/README.md:1-16` and
`graphify/packages/graph/src/index.ts:1-19`). It is not the memory store; the
storage and citation substrate inspected above lives under graphify `src/`.

### 2.3 Graphify-knowledge's seven measured answers

These answers supersede the corresponding assumptions in `e74c4bd8`. “Measured”
does not mean graphify's principal ratified the cross-repository contract.

| Point | Measured answer adopted here | Remaining gate |
|---|---|---|
| Q1 — write path | `store push` already carries stamped `t`/`t_end`/`t_src` through JSONB into `queryWindow`; absent `t_end` is OPEN and `t_end === t` is POINT | authored-memory producer/schema is pending `human:rhanka` |
| Q2 — key | store-configured namespace carries `workspace_uid`; node ID carries `record_uid`; host, role and durable subject are node attributes | namespace is a data partition, not authorization; caller selection is forbidden by the current seam |
| Q3 — roots | root never enters the key; h2a prevents wrong-root dispatch, while graphify may retain root only as provenance for after-the-fact detection | h2a resolver/topology owner remains OPEN-Q18 |
| Q4 — citations | memory evidence is structured named-source + verbatim quote; the gate proves inclusion only, never assertion truth | MemoryNote binding/approval remains OPEN-Q13 and pending principal |
| Q5 — offline | `recall --as-of … --graph … --json` exists; file freshness is always unverified; edges may lack returned endpoints; file GraphStore has no `queryWindow` | h2a must degrade explicitly and refuse dangling-edge inference |
| Q6 — anti-cycle | no h2a/a2a dependency or source import was found; graphify's only contact reads the exact workspace-local registry file and fails closed on path/symlink mismatch | strict reader is branch-only at `a7d605a6`; prospective CI import refusal remains OPEN-Q15 |
| Q7 — clock | author-stamped ordering silently inverts under skew; this spec chooses receiver-stamped `t` and retains author time separately | receiver clock authority/monotonic ordering remains OPEN-Q7 |

Evidence: `tmp/ADDENDUM-2-retraction.md:22-88`. The strict registry reader is at
`graphify/src/agent-stats/registry.ts:71-116` on graphify branch
`feat/aclp-ontology-studio`; `git merge-base --is-ancestor HEAD origin/main`
exited 1, no remote branch contained that HEAD, and `gh pr list --head
feat/aclp-ontology-studio` printed `[]`.

## 3. Seam boundary

The following is the proposed boundary. Every row is **REQUIRED**, not a claim
about current code.

| Concern | h2a | graphify | What must refuse |
|---|---|---|---|
| Authored record | May validate and dispatch only a graphify-principal-ratified contract; writes no local memory copy | Would own the MemoryNote/producer schema; current `store push` already ingests any stamped graph node | h2a refuses an invented/unratified envelope or success without graphify durability; authored-memory acceptance remains pending `human:rhanka` |
| Durable subject | Resolves exactly one stable workspace+subject from governance context | Stores subject, host and role as node attributes, not namespace components | h2a refuses zero/multiple/ambiguous/session-derived subjects |
| Bus/address plane | Prevents wrong-root dispatch before graphify and supplies root only as provenance | Knows no h2a roots; may preserve root provenance for detection, not prevention | h2a refuses ambiguous/wrong-root dispatch; graphify cannot provide that refusal and must not be credited with it |
| Namespace | Uses the graphify deployment already configured for one workspace; never chooses a namespace per request | Store config maps `workspace_uid` to one `city_slug`/namespace; namespace partitions data but does not authorize it | the h2a surface exposes no namespace selector; any future caller selection waits for graphify-principal ratification |
| Temporal producer | Does not accept author-controlled ordering; preserves author time separately | Future ratified producer stamps receiver-controlled `t`, `t_src=received-at`, and POINT/OPEN `t_end` semantics | producer refuses author-supplied receiver stamps, malformed/inverted bounds and unstructured evidence |
| Substrate ingestion | Dispatches only; builds no feed, projection or shadow store | Existing `graph.json` → `store push` → JSONB/index → `queryWindow` chain is complete | no invented `FEED_NOT_READY` gate; ordinary push/query errors are surfaced without h2a fallback |
| Read at wake | Uses the deployment-configured source, treats unverified freshness as degraded, and rejects dangling-edge inference | Returns temporal nodes and edges under existing T6 semantics; file/store results remain freshness-unverified | h2a refuses `MEMORY_VERIFIED` from current T6 and refuses any edge whose endpoint is absent |
| Offline operation | Selects `--graph <file>` explicitly or declares documentary degradation | Existing file as-of path reads stamped graph data; file GraphStore has no `queryWindow` | neither side silently changes source after a store was selected; offline output is never called attested |
| Anti-cycle | Depends on graphify's CLI/API or neutral contract only | Imports no h2a package/runtime; branch-only agent-stats reads one exact workspace-local file path, non-symlinked and fail-closed | current path filter returns no evidence on mismatch; a future graphify CI dependency/import gate must still fail the forbidden edge |

The h2a-side conformance artifact must be a top-level JavaScript test under
`packages/h2a/test`, because the required root gate discovers that directory and
does not discover `packages/h2a-runtime`
(`scripts/run-tests.mjs:10-19,29-58`). The proposed filename is
`packages/h2a/test/perennial-memory-seam.test.js`. Graphify provider and schema
fixtures belong under graphify `tests/`, beside the three targeted suites above.
Those tests do not exist and were not run.

The existing h2a anti-cycle check only rejects selected h2a-core dependency-name
substrings (`scripts/check-public-contract.sh:30-36`). Graphify-knowledge verified
no h2a/a2a dependency or source import and one file-only contact
(`tmp/ADDENDUM-2-retraction.md:74-78`). The inspected strict reader resolves
`<project-root>/.h2a/registry/instances.jsonl`, refuses symlink/path escape and
filters records to the exact workspace
(`graphify/src/agent-stats/registry.ts:71-116`, branch
`feat/aclp-ontology-studio`, commit `a7d605a6`, not on inspected
`origin/main`). That is verified present behavior on the named branch. It is not
a prospective CI mechanism that would refuse a newly added import; **OPEN-Q15**
retains that separate gate.

## 4. Record key and address

### 4.1 Primary key

**Adopted mapping from graphify-knowledge Q2, with semantic identity details
still OPEN-Q2..Q4:** workspace is the configured graphify namespace; host and
role are queryable node attributes, not namespace components.

```text
store-config namespace/city_slug = workspace_uid
physical graph-node PK = (workspace_uid, record_uid)
subject_ref = (workspace_uid, subject_uid)
logical record locator = (workspace_uid, record_uid)
node attrs include subject_uid, host, role, root_provenance, t, t_end?, t_src
address-plane context = one bus_root_ref OR bus_federation_ref (h2a-side only)
```

- `workspace_uid` is serialized as the single namespace chosen in graphify store
  config. Postgres keys nodes by `(city_slug,id)`
  (`graphify/src/storage/postgres.ts:285-304,327-352`). It is not selected by a
  read/write caller, and namespace is partition, not authorization
  (`tmp/ADDENDUM-2-retraction.md:31-40`).
- `subject_uid` is an immutable durable-subject identifier. Whether the subject
  is one role-shared memory or one durable actor occupying a role is OPEN-Q4;
  the current role slug is a mutable alias, not identity.
- `record_uid` is the graph node `id`, unique inside the configured workspace
  namespace. It distinguishes many records for one subject. Minting and alias
  rules remain OPEN-Q2.
- host and current role slug are attributes. They support `(host,role)` queries
  without multiplying store partitions and never become record identity.
- root is an optional provenance attribute only. Graphify can expose a
  wrong-root stamp for detection but cannot refuse the original h2a dispatch.
- a future `operation_id` is separate from the graph-node key and would make a
  ratified authored-write retry idempotent; that write contract remains OPEN-Q6.
- `bus_root_ref`/`bus_federation_ref` is h2a address-plane context, not a
  graphify store ID and not a session-minted actor UUID. It is never folded into
  `subject_ref`. h2a must reduce it to one result or refuse before dispatch;
  graphify sees only the provenance attribute emitted by the eventual producer.
  Owner semantics are **OPEN-Q18**.
- CLI provider, h2a instance/session IDs, tmux name, checkout path and branch are
  provenance or aliases only and never key components.
- `workspace_uid` and `subject_uid` travel in a typed identity envelope with an
  issuer/kind once graphify's principal ratifies a MemoryNote schema. Opaque
  strings alone cannot distinguish a durable subject from a session ID; issuer,
  credential and validation rules are OPEN-Q2..Q4.

UID authority, workspace serialization, typed issuer/credential and alias
migration are **OPEN-Q2..Q4**. A content hash alone is not recommended as
identity because correction, contradiction and supersession need distinct
records; exact lifecycle semantics are **OPEN-Q8**.

The key cannot cure an h2a routing partition. Before graphify dispatch, the h2a
address plane must resolve one authoritative bus root or one explicitly
federated bus view. Graphify records only the chosen root provenance after the
fact. This is deliberately asymmetric: h2a prevention, graphify detection.
Graphify does not learn how h2a presence or bus paths are laid out.

The agreed key is falsified by
`packages/h2a/test/perennial-memory-seam.test.js` if changing a session loses an
otherwise unchanged subject's records, if a declared alias migration loses or
crosses records, or if two records in one subject scope collide. Host changes
must preserve records because host is an attribute, not identity. The h2a
fixture must model an ambiguous/wrong root and observe refusal before graphify
dispatch. A graphify fixture must instead prove that the selected root survives
only as queryable provenance. No fixture may expose a caller-chosen namespace.

### 4.2 Evaluation of `(host, workspace, role)`

The proposed `(host, workspace, role)` tuple does **not** align directly with
graphify storage. Graphify-knowledge's measured model has one store-configured
namespace string, not a per-record composite
(`tmp/ADDENDUM-2-retraction.md:31-40`). This spec adopts its recommended
translation: `workspace_uid` is the namespace; host and role are node
attributes; `record_uid` is the node ID.

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

### 5.1 Existing graphify infrastructure path

No ingestion component is missing:

1. A graph producer emits a node into `graph.json`, including numeric `t`,
   optional `t_end`, `t_src`, and arbitrary semantic/provenance attributes.
2. Store configuration fixes the one workspace namespace. The caller does not
   select it.
3. `graphify store push` reads the graph and preserves non-schema attributes in
   JSONB `props`; the temporal expression indexes make those values queryable.
4. `queryWindow` returns stamped nodes/edges under POINT/OPEN/span semantics.

This path is current graphify infrastructure, verified in §2.1 and measured by
graphify-knowledge. A producer that fails to stamp `t` produces a legitimately
timeless record. Building another feed, queue or projection is expressly outside
this seam.

### 5.2 Future authored-memory producer — pending graphify principal

Graphify has no ratified MemoryNote schema or h2a write surface. The fields and
transport therefore remain **OPEN-Q1,Q6**; this specification does not invent an
envelope inside graphify's hard gate
(`tmp/ADDENDUM-2-retraction.md:90-95`). It fixes only the seam invariants that a
future ratified producer must satisfy:

1. h2a resolves one durable subject and refuses a missing, ambiguous,
   session-derived or wrong-root address before dispatch. It stores no memory.
2. The candidate's evidence is a structured named-source/verbatim citation. A
   free evidence field is refused before graphify grounding.
3. The accepting producer stamps `t=received-at` and `t_src=received-at`; it
   keeps author time in `authored_at`, applies the POINT/OPEN rule in §2.1, and
   records the selected h2a root only as provenance.
4. The producer writes the node into the workspace-configured graph/namespace
   and invokes the existing push path. Host, role and subject remain attributes.
5. h2a may report durability only from graphify's eventual ratified success
   result. If graphify is unavailable or commit status is unknown, h2a reports
   exactly that uncertainty; it never claims persistence, switches namespace,
   or writes an `.h2a` WAL, queue, cache, shadow graph or automatic fallback.

Exact idempotency, receipt and failure-code semantics remain **OPEN-Q6** rather
than the invented `FEED_NOT_READY`/projection protocol retracted in §0.
`RECALL.md` is a read/bootstrap fallback, never a hidden write outbox.

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
only inspected form that carries those reading rules. Whether graphify generates
and commits that projection, merely complements it, or eventually replaces it is
**OPEN-Q14**.

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
**OPEN-Q11..Q15**. A self-consistent snapshot digest alone would still not prove
that an independently expected head was served.

### 6.3 What refuses

| Forbidden input/outcome | Required refusing mechanism |
|---|---|
| Wrong or ambiguous actor | h2a durable-address resolver refuses zero/multiple matches; response address must match byte-for-byte; it never picks the first candidate |
| Wrong or ambiguous h2a bus root | h2a address resolver refuses zero/multiple roots unless an agreed bus federation produces one subject; graphify is not invoked and does not import bus topology |
| Caller-selected namespace | h2a exposes no selector and uses only store configuration; any future selector is refused until `human:rhanka` ratifies it |
| Unratified authored-memory schema | h2a refuses dynamic write or verified-memory interpretation; existing T6 data remains generic temporal graph data |
| Stale or unverifiable snapshot | current `freshness: unverified` or `snapshot: null` can only yield degraded temporal context, never `MEMORY_VERIFIED`; future independent proof is OPEN-Q11 |
| Dangling temporal edge | h2a rejects/removes the edge unless both source and target nodes are present; it never invents an endpoint or treats current output as induced |
| Store unavailable | retain graphify's existing no-post-selection-fallback behavior; a local source is used only when chosen before the request |
| Unstructured or non-verbatim evidence | h2a rejects a free evidence field; graphify `verifyVerbatim` rejects a structured quote absent from the named normalized source |
| Citation present but assertion false | neither citation gate may label the assertion true; approval/truth policy remains OPEN-Q8,Q13 |
| Missing `t` | current temporal recall legitimately omits the record; the future memory producer refuses an authored temporal record before push if its receiver stamp is absent |
| Author-controlled ordering time | the accepting producer overwrites/refuses caller `t`/`t_src` and stamps receiver time; graphify pass-through alone is not truth verification |
| Pending/unapproved record | graphify keeps state machine-readable; h2a never mixes it silently with accepted memory |
| Unauthorized workspace | namespace partition is not authorization, so no current T6 response is promoted to authorized memory by namespace alone |
| Session/instance-derived key | h2a resolver refuses the address; graphify refuses an identity envelope whose kind/issuer/credential is not an accepted durable-subject authority |

“Refuse memory injection” and “refuse the actor launch/first action” are separate
policies. The mechanical states are proposed as `MEMORY_VERIFIED`,
`DEGRADED_TEMPORAL`, `DEGRADED_BOOTSTRAP` and `MEMORY_UNAVAILABLE`. Current T6
can produce only `DEGRADED_TEMPORAL` because freshness is always unverified; the
consumer must disclose that status and remove dangling edges.
`DEGRADED_BOOTSTRAP` requires a successful read plus a receipt naming the
bootstrap path, commit/blob digest, validation result and source revision;
absent, unreadable, untracked or drifted bootstrap data yields
`MEMORY_UNAVAILABLE`. Which state blocks launch, whether `required` or
`best-effort` is the default, and auditable break-glass behavior are
**OPEN-Q16**. No mode may convert unverified data into verified memory.

The h2a conformance test must mutate every row above and observe a refusal, not a
warning count. Required cases include wrong address, ambiguous root with zero
graphify dispatch, attempted namespace selection, `snapshot:null`, unverified
freshness, dangling edge, free-form ULID evidence, invented verbatim quote,
author-stamped `t`, missing `t`, malformed POINT/OPEN bounds, unavailable store,
an absent/unreadable/drifted bootstrap, and session-ID churn. None of these h2a
conformance tests exists or was run here.

## 7. What survives graphify or Postgres being absent

| Environment | Current evidence | Required seam posture |
|---|---|---|
| Postgres absent; graphify present; explicit graph source | Existing `recall --as-of … --graph … --json` returns POINT and OPEN stamped data, omits untimed data, reports `freshness: unverified`, and may return dangling edges (`graphify/src/temporal-recall.ts:243-271,357-404`; graphify-measured fixture at `tmp/ADDENDUM-2-retraction.md:61-72`) | expose only `DEGRADED_TEMPORAL`; remove dangling edges and never call the source attested |
| Postgres reachable; inspected 8,919-node graph | The graph printed zero numeric `t`, so an empty temporal result is legitimate; source and graphify-knowledge measurements show the push/query chain is complete (§2.1) | a future ratified memory producer stamps data; no ingestion project or feed-readiness error is introduced |
| Postgres selected but unreachable | The error is surfaced and no file fallback occurs (`:317-355`; `graphify/tests/cli-temporal-recall.test.ts:250-285`) | retain refusal; any change to local mode is explicit and reconciliation-aware |
| File GraphStore selected | It declares `query:false` and lacks `queryWindow` (`graphify/src/storage/file.ts:58-67`; `graphify/tests/storage-postgres-time-window.test.ts:249-264`) | use the explicit `--graph` as-of path instead; do not pretend file GraphStore supports window queries |
| graphify absent | h2a source files and committed dossiers remain; `RECALL.md` would remain only if PR 90 or a successor merges. It is absent from inspected `origin/main` | no dynamic read or durable write; `DEGRADED_BOOTSTRAP` only after a successful read and commit/blob/validation receipt, otherwise `MEMORY_UNAVAILABLE`; never a claim of current/full memory |

A perennial-memory design that requires reachable Postgres is **not acceptable**
as the laptop baseline. That judgment follows the mandate's explicit laptop
question (`tmp/BRIEF-graphify-seam-spec.md:84-87`) and the owner's unratified but
clear local-first direction
(`docs/decisions/2026-07-25-agent-memory-owner-answers.md:15-20,48-50`).
Explicit temporal degradation is acceptable when it is named, removes dangling
edges, refuses new durable writes when graphify is absent, and never reports
verified memory. The existing file as-of path satisfies the read primitive for
a laptop; what remains unratified is authored-memory production and attestation,
not an embedded query backend (**OPEN-Q9..Q11**).

### 7.1 What can proceed now, and what waits

1. **May proceed without graphify-principal expansion:** h2a address/root
   refusal, tests for the existing `store push` temporal round trip, a degraded
   `--graph` reader that strips dangling edges, structured-citation validation,
   receiver-time skew tests, and a commit/blob-validated `RECALL.md` bootstrap.
2. **Must wait for `human:rhanka`:** MemoryNote/Persona semantics, an authored
   graph producer or h2a write surface, the final envelope/receipt, caller
   namespace selection, cross-workspace reads, and pagination/cursors.
3. **Must wait for independent proofs:** any `MEMORY_VERIFIED` claim,
   authorization by workspace, bounded semantic completeness, and replacement
   of `RECALL.md`.

There is no feed gate in this sequence. OPEN-Q17 is retracted; OPEN-Q18 remains
an h2a address-plane question.

## 8. Consensus questions for `graphify-knowledge`

Graphify-knowledge's measured answers to the seven questions in Addendum 2 are
recorded in §2.3 and are not reopened here. The remaining questions below are
**OPEN** unless explicitly marked **RETRACTED**. Every cross-repository
commitment remains pending `human:rhanka`; an answer from h2a's owner alone does
not ratify graphify behavior (`tmp/ADDENDUM-2-retraction.md:90-95`).

1. **OPEN-Q1 — Contract ownership and transport.** Will graphify own and version
   the neutral authored-memory producer, read request, receipt and error schemas,
   with h2a limited to durable-address resolution and dispatch? Is the supported
   transport process JSON, a write-capable API/MCP service, or both? Will its
   principal ratify a prospective CI gate that refuses every h2a import and
   dependency?
2. **OPEN-Q2 — Record identity and idempotency.** Is `record_uid` alone the
   caller-visible identity within the workspace namespace, and who mints it?
   What exact `operation_id` collision/retry rules refuse two different writes
   under one idempotency key? The existing physical store key is already
   `(city_slug, id)`, with `city_slug = workspace_uid`; this question must not
   redesign it as `(host, workspace, role)`.
3. **OPEN-Q3 — Workspace identity.** Does `workspace_uid` mean logical project,
   git repository, clone, fork or linked worktree? What survives repo/remote
   rename, path move, history absorption and multiple clones, and which alias
   ambiguity refuses rather than merges or splits memory silently?
4. **OPEN-Q4 — Actor, role, typed authority and host semantics.** Is memory
   shared by a role or owned by a durable actor occupying it? What typed
   subject kind, issuer or credential lets graphify refuse a session ID disguised
   as an opaque UID? How do role rename/split/merge and two same-role actors
   migrate? `host` and `role` are node attributes, not namespace components;
   which values and migration rules make those provenance attributes durable?
5. **OPEN-Q5 — Canonical store.** Does perennial memory make an append journal
   authoritative with the graph as projection, following owner direction D12,
   or retain current graphify `graph.json` authority with DB projections? What
   mechanism refuses journal/graph projection drift?
6. **OPEN-Q6 — Authored write surface and receipt.** What command/API appends one
   stamped memory record, and what atomic receipt proves durability? What are
   the ratified retry, idempotency and failure semantics? This spec does not
   invent an h2a envelope, projection receipt or failure-code vocabulary.
7. **OPEN-Q7 — Concurrency.** Is V1 single-writer+namespace, optimistic append,
   or concurrent multi-writer? What revision precondition, conflict response and
   retry rule apply across Claude/Codex/Gemini/Hermes sessions? Receiver-stamped
   `t` is fixed for ordering; what receiver clock authority, multi-host skew
   bound and equal-time tie-breaker make that ordering reliable?
8. **OPEN-Q8 — Approval, contradiction and lifecycle.** Which memory kinds may be
   automatic, pending, double-consensus-reviewed or human-approved? How are
   observed time, valid time, contradiction, supersession, correction,
   tombstone, retention, deletion, privacy and `/rewind` represented without
   destructive mutation?
9. **OPEN-Q9 — Local-first authored production.** The existing
   `recall --as-of <t> --graph <file> --json` path supplies the degraded offline
   read primitive. What graphify-owned offline producer/durability mechanism,
   if any, supplies authored writes without Postgres, and what RAM/OOM bounds
   apply? File freshness remains unverified rather than inferred.
10. **OPEN-Q10 — Remote/local failure and reconciliation.** After a remote store
    is selected, may failure ever switch to local? If yes, only by which explicit
    policy, and how are the two journals reconciled without split-brain or h2a
    becoming an outbox/store?
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
14. **OPEN-Q14 — `RECALL.md` relationship.** Does graphify complement it,
    deterministically generate a committed bootstrap projection, or eventually
    replace it? What parity criteria cover doctrine, refutations, recurrent
    defects, incidents, locators, quarantine and mandatory pre-action delivery?
    What path/commit/blob/validation receipt makes a degraded bootstrap real
    rather than a label?
15. **OPEN-Q15 — Version and contract gates.** Which golden fixtures, supported
   version ranges and ownership rules jointly gate graphify providers and the
   h2a dispatcher? What fails release when schemas, refusal codes or local/server
   semantics diverge? Graphify measured the present anti-cycle and its branch
   has a strict file reader; which prospective CI gate and versioned fixtures
   make those properties durable?
16. **OPEN-Q16 — Wake degradation policy.** Which failures refuse only memory
   injection and which refuse launch/first action? Is `required` or
   `best-effort` the default for durable actors, and what explicit audited
   break-glass is allowed when graphify and a receipt-validated committed
   bootstrap are absent? The policy must name current T6 file/store reads
   `DEGRADED_TEMPORAL`, preserve `freshness: unverified`, and remove dangling
   edges before any memory reaches a prompt.
17. **RETRACTED-Q17 — Substrate ingestion and reachability.** This is not an open
    question. Addendum 2 refuted the missing-feed premise: `graph.json` →
    `store push` → JSONB/index → `queryWindow` is complete. The remaining work is
    an authorized producer that stamps temporal attributes, not an ingestion
    project (`tmp/ADDENDUM-2-retraction.md:8-20,24-29`).
18. **OPEN-Q18 — Address-plane topology, owner and neutral handoff (first routing
    gate).** Must h2a addressing use one authoritative bus root, or will an
    explicitly named h2a owner define federation?
    What pre-dispatch mechanism refuses an unknown, wrong or ambiguous bus root,
    and how does it prove one durable `subject_ref` without using either
    session-minted UUID? Which neutral proof/issuer may graphify validate without
    importing h2a or learning its bus topology? Root may be stored only as
    provenance for after-the-fact detection; graphify does not prevent h2a
    routing mistakes (`tmp/ADDENDUM-2-retraction.md:42-46`).

## 9. Refusal-oriented acceptance requirements

No requirement below is implemented by this document.

1. Changing only an h2a session/instance ID preserves the resolved subject address
   and recalled records; introducing a session ID into an identity slot is
   refused.
2. Store configuration maps `workspace_uid` to the single `city_slug`
   namespace; `host` and `role` remain attributes. A reader has no caller-chosen
   namespace selector, and the namespace is never treated as authorization.
3. A production-shaped node carrying `t`, optional `t_end`, and `t_src` passes
   through existing `store push`, retains those attributes in Postgres props,
   and is retrieved by the temporal query at its eligible instant.
4. Temporal fixtures prove all four states: missing `t` never surfaces;
   `t_end === t` is a POINT visible at that instant only; absent `t_end` is OPEN
   and remains visible later; `t < t_end` is a bounded span. Malformed bounds are
   rejected rather than silently reinterpreted.
5. The authorized producer stamps `t` at receipt and `t_src = received-at`,
   preserves an untrusted author time separately as `authored_at`, and refuses
   an author-supplied value masquerading as receiver time. Multi-receiver clock
   behavior remains gated by OPEN-Q7.
6. Every evidence-bearing entry uses a structured citation with a verbatim quote
   and named artefact. A fabricated ULID in a free field is rejected; a quoted
   ULID absent from the named source fails grounding. A successful inclusion
   check never labels the lesson true.
7. The offline file fixture proves POINT/OPEN/missing-`t` behavior, reports
   `source.kind = file` and `freshness: unverified`, and strips any edge whose
   endpoint is absent from returned nodes before h2a consumes the result.
8. Postgres failure does not silently select the file backend. File
   `GraphStore` window queries remain unsupported (`query:false`); only the
   explicit file as-of command is the offline read primitive.
9. An unknown, wrong or ambiguous h2a root refuses at dispatch and records zero
   graphify calls. Graphify may detect mismatched root provenance afterward but
   is never credited with preventing the dispatch.
10. A graphify source or package that imports h2a fails the prospective graphify
    CI gate; the exact, non-symlinked, fail-closed registry file reader remains a
    data-file boundary rather than an h2a import.
11. The h2a refusal mutations live in
   `packages/h2a/test/perennial-memory-seam.test.js`, so the required root gate
   reaches them. Tests placed only in `packages/h2a-runtime` do not satisfy this
   requirement (`scripts/run-tests.mjs:10-19,29-58`).
12. `DEGRADED_BOOTSTRAP` requires a readable bootstrap plus matching path,
   commit/blob digest and validation receipt; absence, unreadability or drift
   refuses memory injection. `DEGRADED_TEMPORAL` is allowed for a successful
   current T6 file or store result only when the source was selected before the
   request, unverified freshness is disclosed, and dangling edges are removed.
   The explicit file path in requirement 7 is the only offline case. Neither
   state reports verified memory.

## 10. Defects and gaps observed but deliberately not fixed

1. **The measured anti-cycle and strict reader are not yet a durable cross-repo
   contract.** Graphify measured no h2a/a2a dependency or import. Its current
   feature branch reads only the exact non-symlinked
   `<project-root>/.h2a/registry/instances.jsonl` path and fails closed, but the
   agent-stats changes are branch-only, have no PR, and are not in graphify
   `origin/main`. No prospective graphify CI gate yet refuses future h2a imports.
   This spec edits neither repository's gate (`tmp/ADDENDUM-2-retraction.md:74-78`).
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
7. **Production-time memory stamping is absent.** The inspected
   `.graphify/graph.json` has 8,919 nodes and no numeric `t`; such nodes correctly
   do not surface in a temporal window. The ingestion chain is complete. What is
   absent is a principal-ratified authored-memory producer that stamps `t`,
   optional `t_end`, and `t_src` when producing a memory node
   (`tmp/ADDENDUM-2-retraction.md:8-20`).
8. **Author time is demonstrably unsafe as the ordering coordinate.** Addendum 2
   records an h2a envelope post-dated by about twelve minutes because the sender
   hand-wrote `createdAt`. Receiver-stamped `t` is selected here, but a shared
   receiver clock authority and multi-host ordering rule remain OPEN-Q7
   (`tmp/ADDENDUM-2-retraction.md:80-88`).
9. **The cross-repository majority-layer commitment is not ratified by
   graphify.** The h2a owner direction is the mandate for this document, while
   authored MemoryNote/Persona semantics, any h2a write shape, caller namespace,
   cross-workspace reads and pagination remain unratified by graphify principal
   `human:rhanka` (`tmp/ADDENDUM-2-retraction.md:90-95`). This spec does not
   record a decision on that principal's behalf.
10. **H2a root refusal is not implemented by this specification.** Root is not a
    graphify key. H2a still needs an authoritative address-plane rule and
    pre-dispatch refusal; graphify can retain root provenance only for detection
    after the fact (`tmp/ADDENDUM-2-retraction.md:42-46`).

## 11. Guarantee boundary

The following were measured in this work:

- the named h2a and graphify local remote-tracking commits and diffs;
- the exact architecture, decision, journal, Recall-branch, storage, recall,
  citation and renderer lines cited above;
- PR 90's printed open/unmerged state;
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

The following were **not measured**: a live PostgreSQL round trip in this lane,
an authored-memory write, any accepted authored record schema, wake injection,
verified freshness, local/server reconciliation,
concurrent multi-CLI writes, cross-host identity, authorization/privacy policy,
latency, memory footprint, OOM behavior, full h2a root test gate, graphify full
test gate, deployment, or owner UAT.

This branch can only propose and preserve the seam. Only the owner can accept it,
and agreement on every remaining `OPEN-Q` belongs in the graphify-knowledge
consensus record before implementation. RETRACTED-Q17 is not such a gate.
