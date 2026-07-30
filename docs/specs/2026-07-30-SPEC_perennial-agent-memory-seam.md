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
rebase. `git diff --name-status af9e8e4c..815e0880 --` for the cited h2a
architecture, decision, journal and gate files printed no changes; the cited
track IDs were re-found in current local `origin/main`.

graphify baseline inspected: local `origin/main`
`54d771aea8b1b5feb8e3f13f49f8f41eafd83632`; the inspected checkout was the dirty
`feat/aclp-ontology-studio` worktree at `343690503748f325cc7673b577321271cb0cbb9f`,
but `git diff origin/main --` was empty for the temporal-recall, storage,
citation, and renderer files cited below. Neither local remote-tracking ref was
refreshed by this lane; graphify `origin/main` still printed `54d771ae…` during
the addendum pass.

This document uses five evidence labels:

- **MANDATED** — fixed by the commissioning brief; this spec does not reopen it.
- **VERIFIED** — observed in the named file, commit, event, command, or test output.
- **RELAYED** — measured by the named graphify conductor and preserved verbatim in
  `tmp/ADDENDUM-1-substrate-not-serving.md`; it was not re-measured in this lane.
- **REQUIRED** — proposed seam behavior, not present behavior. The named refusal
  and conformance test are what would falsify an implementation claim.
- **OPEN** — agreement is required from `graphify-knowledge` or another named
  owner; this document does not decide it.

The guarantee of this document stops at the evidence and proposed contract. It
does not establish implementation, deployment, owner acceptance, live-Postgres
behavior, latency, RAM/OOM behavior, privacy authorization, or cross-host
continuity.

## 1. What is settled, and how far it is settled

### 1.1 Boundary ruling

**MANDATED:** graphify is the majority layer for perennial agent memory and h2a
does not build a store. The mandate is the commissioning brief at
`tmp/BRIEF-graphify-seam-spec.md:28-31`.

**RELAYED cross-repository limit:** this is the h2a owner's architecture
direction, not a graphify-side decision. The graphify conductor names its
principal as `human:rhanka` and reports that nothing has been ruled on that side
(`tmp/ADDENDUM-1-substrate-not-serving.md:57-62`). This specification is written
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

**RELAYED simultaneous partition:** the same tmux session was observed through
two disjoint bus roots, `/home/antoinefa/src/a2a-cli/` and
`/home/antoinefa/h2a-workspace/.h2a/`. Each root minted a different UUID for the
same live `knowledge` role:
`claude:graphify:32ae534a470e` and `claude:graphify:d613c9cb8c9e`
(`tmp/ADDENDUM-1-substrate-not-serving.md:42-55`). This was not re-measured here.
It makes a durable key necessary but insufficient: presence and addressing can
be partitioned across roots, so an actor may be reachable through one root and
invisible through another at the same instant. These are h2a bus/address-plane
roots, not evidenced graphify storage roots. Before graphify dispatch, h2a must
therefore select one authoritative bus root or an explicit bus federation and
refuse a write intent resolved through the wrong or ambiguous address plane.
Graphify receives only the resulting durable-subject envelope under a neutral
contract; it never imports or owns h2a bus topology. Ownership of that resolution
and handoff proof is **OPEN-Q18**.

## 2. Substrate evidence, including its stopping point

### 2.1 Temporal storage, its missing feed, and the laptop path

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

**RELAYED correction — implemented and tested is not serving:** after the brief
was written, the graphify conductor measured the Postgres-backed window path on
its real bundle of 47,762 nodes. It returned **0 nodes / 0 edges** because push
reads `graph.json` while positions live in `scene.json`; the end-to-end feed into
`queryWindow` does not yet exist
(`tmp/ADDENDUM-1-substrate-not-serving.md:8-13`). This lane did not re-run that
measurement. The targeted test above establishes the conditional semantics
`queryWindow` would provide if correctly fed; it does **not** establish a usable
current read path or delivery readiness. The addendum identifies this as the
REF-05 failure family, “a capability recorded as delivered is not thereby
reachable” (`tmp/ADDENDUM-1-substrate-not-serving.md:17-20`;
`memory/wake-recall-main:docs/agents/RECALL.md:135-140`, open PR 90). No read path
in this specification may assume that the window currently serves data.

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

That direct-file chronological path does not repair the missing authored-memory
feed: it reads an already-produced `graph.json`, while the conductor's
measurement says the real Postgres window projection is not populated from the
current bundle layout. Ingestion is therefore a design dependency, not an
implementation detail (**OPEN-Q17**).

**Stopping point:** T6 explicitly models neither authored memory nor semantic
relevance (`graphify/src/temporal-recall.ts:1-8`). Every file/store result says
`freshness: "unverified"`; a store metadata failure becomes `snapshot: null`,
and the response still succeeds (`:46-75,336-350,368-398`). Its normative spec
says it is temporal graph recall only, adds no write path, treats namespace as
partition rather than authorization, and does not verify provenance, freshness,
authorship, integrity or trust
(`graphify/spec/SPEC_AGENTSTATS_TIMEORIENTED.md:183-188,241-271,280-296`). It
also says h2a has no ratified versioned MemoryNote/persona/knowledge body or
read/write command (`:285-296`). Current T6 is therefore useful evidence and a
possible lower-level primitive, not the perennial-memory seam.

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

**VERIFIED citation primitives and genuine refusal:** graphify has deterministic
citation identity, union and top-K selection
(`graphify/src/citations.ts:1-12,39-100`). Its corpus-aware policy controls the
description and inline citation caps
(`graphify/src/citation-policy.ts:1-24,39-56,136-159`). More importantly, both
emission helpers in the grounding path call the shared `verifyVerbatim` hard gate
before either `out.push`; every producer in `groundNodeCitations` routes through
one of those helpers, and term-mismatched quotes are also rejected
(`graphify/src/cite-grounding.ts:202-289,290-391`;
`graphify/src/source-grounding.ts:315-320`). The cited-source validator separately
requires a locator, modality-appropriate anchor and evidence text
(`graphify/src/cited-source-refs.ts:111-141`). This is a mechanical refusal, not
a documentation convention, and is the strongest verified reason to rest the
memory evidence boundary on graphify. It still does not prove that authored
memory reaches durable ingest or that wake uses the gate; those bindings are
**OPEN-Q13,Q17**.

**VERIFIED package boundary:** `@sentropic/graph` calls itself rendering-first
and exports buffers, layouts, matrices, positions, geometry and renderers
(`graphify/packages/graph/README.md:1-16` and
`graphify/packages/graph/src/index.ts:1-19`). It is not the memory store; the
storage and citation substrate inspected above lives under graphify `src/`. The
graphify conductor independently confirmed that boundary
(`tmp/ADDENDUM-1-substrate-not-serving.md:33-38`).

## 3. Seam boundary

The following is the proposed boundary. Every row is **REQUIRED**, not a claim
about current code.

| Concern | h2a | graphify | What must refuse |
|---|---|---|---|
| Authored record | Builds a graphify-versioned request from the actor's candidate and dispatches it; writes no local memory copy | Owns schema validation, durable acceptance, journal/store, reconciliation, projection and receipt | h2a refuses to say “persisted” without a graphify durable receipt; graphify refuses invalid/unauthorized/unapproved writes |
| Durable subject | Resolves exactly one stable workspace+subject address from h2a governance context | Stores and echoes that typed address; remains usable by direct graphify callers | h2a refuses zero/multiple/ambiguous/mismatched addresses |
| Bus/address-plane resolution | Resolves through one authoritative h2a bus root or explicit bus federation, then emits a neutral durable-subject proof; passes no bus UUID/path as identity | Consumes only the neutral typed subject/proof contract; owns no h2a bus discovery, path or federation | h2a refuses zero/multiple/wrong bus roots before invoking graphify; the graphify mock must observe zero calls on refusal |
| Graphify memory target | Selects one configured graphify endpoint/store namespace after subject resolution; does not implement it | Owns endpoint/store identity, namespace authority and the echo in write/read receipts | graphify refuses unknown/unauthorized namespaces or a mismatched target; h2a refuses a receipt that echoes another target |
| Substrate ingestion | Dispatches only; it neither transforms graphify bundle files nor populates a projection | Owns the authored append/feed from accepted record through canonical substrate to queryable projection, plus readiness proof | graphify returns `FEED_NOT_READY` until a deployed feed attests projection coverage through the independently expected head; h2a never treats an empty bundle or capability bit as readiness |
| Read at wake | Sends the exact address and freshness/completeness requirement; validates the returned receipt before prompt injection | Selects, reconciles and returns the bounded memory bundle plus proof metadata | h2a refuses injection of stale, partial, misaddressed, unverified or unsupported results |
| Offline operation | Selects a graphify-owned local mode explicitly or declares documentary degradation | Owns any embedded/file journal, local projection and later reconciliation | neither side silently changes source after a remote store was selected |
| Anti-cycle | Depends on the graphify binary/API or a graphify-owned neutral data contract | Imports no h2a package, type, runtime, config or CLI code | a graphify CI import/dependency gate and joint contract fixtures must exit nonzero on the forbidden edge |

The h2a-side conformance artifact must be a top-level JavaScript test under
`packages/h2a/test`, because the required root gate discovers that directory and
does not discover `packages/h2a-runtime`
(`scripts/run-tests.mjs:10-19,29-58`). The proposed filename is
`packages/h2a/test/perennial-memory-seam.test.js`. Graphify provider and schema
fixtures belong under graphify `tests/`, beside the three targeted suites above.
Those tests do not exist and were not run.

The existing h2a anti-cycle check is not this refusal: it only rejects selected
dependency-name substrings from `packages/h2a/package.json`
(`scripts/check-public-contract.sh:30-36`). In the graphify checkout, `jq` over
the five dependency maps in `package.json` printed no h2a package, a bounded
import scan for `@sentropic/h2a`, `from …h2a`, `require(…h2a` or `import(…h2a`
under `src`, `packages`, `scripts`, `.github` and `package.json` printed no
matches, and a bounded gate scan for `anti-cycle`, `forbid/deny/refus … h2a`,
`no-restricted-imports`, dependency-cruiser or madge printed no matches in those
paths. Those negative scans establish neither repository-wide absence nor a
refusal mechanism. The required one-way edge is presently architectural text
plus no dependency/import found by those bounded scans.

## 4. Record key and address

### 4.1 Primary key

**Proposed answer, pending graphify agreement in OPEN-Q2..Q4 and address-plane
agreement in OPEN-Q18:** separate record identity, durable-subject identity,
h2a bus resolution, and the graphify memory target.

```text
physical record PK = record_uid
subject_ref = (workspace_uid, subject_uid[, host_partition_uid])
logical record locator = (subject_ref, record_uid)
address-plane context = one bus_root_ref OR bus_federation_ref (h2a-side only)
memory_target = graphify endpoint/store namespace (not part of record identity)
```

- `workspace_uid` is an immutable logical-project identifier carried across a
  repo rename or checkout move. It is not a path, basename, current branch,
  session ID, or mutable remote name.
- `subject_uid` is an immutable durable-subject identifier. Whether the subject
  is one role-shared memory or one durable actor occupying a role is OPEN-Q4;
  the current role slug is a mutable alias, not identity.
- `record_uid` is an immutable opaque record identifier. It distinguishes many
  memories for one subject. Whether graphify makes it globally unique or scopes
  its physical key by namespace is OPEN-Q2.
- `operation_id` is separate from the record key and makes retries idempotent.
- `bus_root_ref`/`bus_federation_ref` is h2a address-plane context, not a
  graphify store ID and not a session-minted actor UUID. It is never folded into
  `subject_ref`. h2a must reduce it to one durable-subject result or refuse
  before dispatch; graphify receives a neutral typed proof, not h2a paths or bus
  internals. Owner and proof semantics are **OPEN-Q18**.
- `memory_target` selects a graphify-owned endpoint/store namespace after h2a
  address resolution. It is echoed in graphify receipts but does not change the
  logical record locator. Endpoint and namespace semantics are **OPEN-Q1,Q13**.
- CLI provider, h2a instance/session IDs, tmux name, role display name, checkout
  path and branch are provenance or aliases only. Host is provenance by default;
  an intentional stable host partition may enter `subject_ref` only if
  graphify-knowledge selects and defines it in OPEN-Q4.
- `workspace_uid` and `subject_uid` travel in a typed identity envelope with an
  issuer/kind that graphify can validate. Opaque strings alone cannot let
  graphify distinguish a durable subject from a session ID; issuer, credential
  and validation rules are OPEN-Q2..Q4.

The physical-PK versus namespaced-locator composition, UID authority,
serialization, global-versus-namespaced uniqueness, typed issuer/credential and
alias migration are **OPEN-Q2..Q4**. A content hash alone is not recommended as
identity because correction, contradiction and supersession need distinct
append-only records; exact graphify semantics are **OPEN-Q8**.

The key cannot cure an h2a routing partition. Before graphify dispatch, the h2a
address plane must resolve one authoritative bus root or one explicitly
federated bus view and bind its neutral result to `subject_ref`. An envelope
written to an unselected bus root that the intended actor does not read is not a
successful memory dispatch, even if the bus reports delivery. Separately,
graphify binds its write/read receipt to `memory_target` and refuses an unknown
or unauthorized namespace. This separation preserves the anti-cycle: graphify
does not learn how h2a presence or bus paths are laid out.

The agreed key is falsified by
`packages/h2a/test/perennial-memory-seam.test.js` if changing a session loses an
otherwise unchanged subject's records, if a declared alias migration loses or
crosses records, or if two records in one subject scope collide. Host changes
must preserve records only when OPEN-Q4 selects host-independent memory; a
deliberate host partition must instead prove separation. The graphify fixture
must refuse an idempotency collision whose `operation_id` repeats with different
content and a typed identity whose issuer/kind is not an accepted durable-subject
authority. The h2a fixture must also model both relayed bus roots live at once:
the address resolver must either produce one `subject_ref` through the agreed
bus federation or return a typed address-plane refusal before the graphify mock
is invoked. A separate graphify fixture refuses an unknown/unauthorized
`memory_target` namespace.

### 4.2 Evaluation of `(host, workspace, role)`

The proposed `(host, workspace, role)` tuple is a serious **collection address**
because it omits session identity (`tmp/BRIEF-graphify-seam-spec.md:73-75`). It is
not a record primary key because it has no component that distinguishes two
records for the same subject.

| Change/case | What the tuple survives | Where it fails |
|---|---|---|
| New session/instance | Yes, if none of the three fields is derived from session state | Any hidden use of a presence/bus/instance ID repeats REC-07 |
| Two simultaneous bus roots | The tuple can name the same logical subject only after the h2a address plane selects one root or explicitly federates them | Without that resolution, the same live role has two disjoint addresses; h2a must refuse before graphify dispatch rather than write an unread bus envelope |
| Repo rename | Only if `workspace` is an opaque stable UID | A repo name, basename or remote-derived key changes |
| Workspace move | Only if the UID is independent of the path | A cwd/path key changes |
| Role rename | No, if `role` is the slug | An immutable `subject_uid` plus alias/migration is required |
| Two repos each with `architect` | Yes only if their workspace UIDs are distinct | Clone/fork/logical-project semantics are not yet agreed |
| Host rename, reinstall or another machine | No, if host is identity | Perennial cross-host memory fragments unless OPEN-Q4 intentionally selects a stable host partition |
| Two records for one actor | No | `record_uid` is required |
| Two actors sharing one role in one workspace | No | graphify must decide role-shared versus actor-owned memory |

The current track workspace key must not be reused by assumption. REC-06 reports
a history-absorption failure for that key
(`memory/wake-recall-main:docs/agents/RECALL.md:157`, open PR 90 head
`9c45dc2…`). Whether a clone, fork, worktree or absorbed history is the same
logical workspace is **OPEN-Q3**.

## 5. Write path

All field names in this section are a proposed minimum; graphify owns the final
schema (**OPEN-Q1**). This is a required future path, not a description of a
working one: the relayed real-bundle measurement says the feed into the current
Postgres window path does not exist (**OPEN-Q17**).

1. The actor produces a candidate carrying schema version, the logical record
   locator, `operation_id`, memory kind, assertion/body, observed/valid times,
   evidence locators and source revision/digest, author/provenance, enforcement
   rung, review state, sensitivity class, and explicit
   `supersedes`/`contradicts` links.
2. The h2a address plane resolves one typed durable-subject address through one
   authoritative bus root or explicit bus federation. It refuses before
   graphify dispatch if the result is absent, ambiguous, derived from a
   session/instance, outside the authorized workspace, or visible only through
   an unselected root. It emits the neutral subject/proof and separately selects
   one configured graphify `memory_target`; it does not persist graph internals.
3. h2a dispatches the graphify-owned request through the independently released
   graphify surface. The transport may be process JSON, API, or an explicit
   write-capable service; selection is **OPEN-Q1**. A read-only MCP surface is not
   silently treated as writable.
4. graphify validates `memory_target`/namespace authority, the neutral subject
   issuer/proof, approval state, schema, idempotency, citations/locators,
   temporal fields and concurrency preconditions; durably appends the accepted
   or pending candidate to the agreed canonical substrate; then ingests/folds it
   into the queryable projection under graphify's contradiction model. It does
   not inspect h2a bus roots. The append-to-projection feed and its
   deployment/readiness test are first-class graphify deliverables, not an
   assumed internal detail.
5. graphify returns a durable receipt echoing `memory_target` and the subject
   address, `record_uid`, `operation_id`, content digest, accepted/pending state,
   committed revision or high-water mark, ingestion revision, and projection
   status. h2a reports persistence only after validating the durable-append
   receipt; it does not report the record wake-readable until graphify proves the
   corresponding ingestion/projection revision ready.

The outcomes are deliberately distinct:

- `ADDRESS_DOMAIN_UNRESOLVED` is an h2a pre-dispatch refusal for zero, multiple,
  wrong or unfederated bus roots. The graphify endpoint must not be called.
- `NOT_PERSISTED` is returned only when graphify authoritatively rejects before
  durable append, including an unknown/unauthorized `memory_target`, or when h2a
  can prove the endpoint was never reached. If the connection disappears after
  dispatch and commit state is unknowable, h2a returns `PERSISTENCE_UNKNOWN` and
  retries with the same `operation_id`; it must not assert non-persistence.
- `PERSISTED_NOT_PROJECTED` means the append receipt is durable but its
  ingestion/projection is failed or behind. The write remains persisted, wake
  returns `FEED_NOT_READY`, and an idempotent retry must not create a second
  record.

None of these outcomes creates an h2a `.h2a` memory WAL, queue, cache, shadow
graph, or automatic file fallback. If graphify later supplies an embedded
writer, it remains graphify storage and must be selected explicitly;
remote/local reconciliation is **OPEN-Q9..Q10**, while h2a bus-root resolution
and its neutral handoff remain **OPEN-Q18**. `RECALL.md` is a read/bootstrap
fallback, never a hidden write outbox. The refusal is falsified if the h2a
conformance test can bypass address-plane refusal, report persistence without a
durable graphify receipt, misreport a committed append as `NOT_PERSISTED`, or
find newly persisted memory under `.h2a`.

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

### 6.2 Required wake receipt

Before first-action prompt construction, the h2a address plane resolves the
exact subject or refuses; h2a then requests it from the selected graphify
`memory_target` with a declared freshness/completeness policy. This contract
does not call `queryWindow` usable merely because its capability bit exists. A
graphify response eligible for injection must include at least:

- supported schema version and exact echoed workspace/subject address;
- source kind and selected namespace;
- exact echoed `memory_target` and a neutral durable-subject proof identifier and
  issuer; no h2a bus path or session-minted UUID;
- feed identity/version, last accepted ingestion revision, projection revision,
  and a machine-decidable ready/not-ready result;
- journal/commit high-water mark and projection high-water mark;
- an expected-head anchor independent of the serving replica/projection, such as
  a graphify-owned signed receipt pinned in the committed bootstrap or supplied
  by an agreed external authority; h2a reads this anchor but does not store
  memory content;
- authoritative journal range/root commitment plus atomic snapshot/bundle ID,
  record count, content digest, query/selection manifest and completion marker;
- built/committed/source-cutoff times and a machine-decidable freshness result;
- pagination cursor state or an explicit complete/untruncated marker;
- accepted, pending and quarantined record sets kept distinct;
- per-record evidence locator, source revision/digest and locator-validation
  result.

The anchor owner/location, exact fields and scale contract are
**OPEN-Q11..Q13,Q15,Q17..Q18**. A serving replica's own internally consistent revision,
count and digest are not independent proof of freshness or semantic
completeness. Current T6's
`unpaged: true` proves it does not deliberately paginate its chronological
snapshot; it does not prove semantic completeness, current locators, authored
truth, or projection freshness
(`graphify/spec/SPEC_AGENTSTATS_TIMEORIENTED.md:263-271`).

### 6.3 What refuses

| Forbidden input/outcome | Required refusing mechanism |
|---|---|
| Wrong or ambiguous actor | h2a durable-address resolver refuses zero/multiple matches; response address must match byte-for-byte; it never picks the first candidate |
| Wrong or ambiguous h2a bus root | h2a address resolver refuses zero/multiple roots unless an agreed bus federation produces one subject; graphify is not invoked and does not import bus topology |
| Wrong graphify memory target | graphify refuses an unknown/unauthorized store namespace; h2a refuses unless the receipt's `memory_target` matches byte-for-byte |
| Capability exists but feed is absent | graphify returns `FEED_NOT_READY` unless a deployed feed identifies itself and proves projection coverage through the independently expected head; h2a refuses a capability bit, `0 nodes / 0 edges`, or an empty bundle without that proof |
| Unsupported schema | h2a receipt validator refuses before prompt injection; graphify refuses unsupported write bodies |
| Stale or unverifiable snapshot | graphify returns a typed stale/unverified outcome when below an independently anchored expected head/minimum revision; h2a rejects a self-reported-only head, `freshness: unverified`, missing/incomparable anchor or revision, and `snapshot: null` |
| Partial/corrupt result | graphify commits the authoritative journal range/root separately from its projection, publishes atomic bundles, and binds the selection manifest to that root; h2a refuses a head/root mismatch, unexplained journal gap/omission, missing pages, nonterminal cursor, truncation, manifest absence, or count/digest mismatch |
| Store unavailable | retain graphify's existing no-post-selection-fallback behavior; a local source is used only when chosen before the request |
| Unresolved evidence | graphify citation/locator validator quarantines the record; h2a excludes quarantined records from asserted memory and discloses the count/reasons |
| Pending/unapproved record | graphify keeps state machine-readable; h2a never mixes it silently with accepted memory |
| Unauthorized namespace/workspace | graphify authorization refuses; h2a also rejects a mismatched echo. Current T6 namespace partition is explicitly not authorization |
| Session/instance-derived key | h2a resolver refuses the address; graphify refuses an identity envelope whose kind/issuer/credential is not an accepted durable-subject authority |

“Refuse memory injection” and “refuse the actor launch/first action” are separate
policies. The mechanical states are proposed as `MEMORY_VERIFIED`,
`DEGRADED_BOOTSTRAP` and `MEMORY_UNAVAILABLE`. `DEGRADED_BOOTSTRAP` requires a
successful read plus a receipt naming the bootstrap path, commit/blob digest,
validation result and source revision; absent, unreadable, untracked or drifted
bootstrap data yields `MEMORY_UNAVAILABLE`, never degraded success. Which state
blocks launch, whether `required` or `best-effort`
is the default, and the auditable break-glass behavior are **OPEN-Q16**. No mode
may convert stale/partial data into verified memory.

The h2a conformance test must mutate every row above and observe a refusal, not a
warning count. Required cases include wrong address, multiple aliases, revision
behind an independently anchored expected head, `snapshot:null`, missing
manifest, count/digest mismatch, a journal record removed before projection,
truncated response, unresolved locator, pending state, unsupported version,
unavailable graphify, an absent/unreadable/drifted bootstrap, and session-ID
churn, two simultaneous unfederated bus roots with an assertion that graphify
was not invoked, a mismatched graphify `memory_target`, and an empty response
from an unready feed. A legitimately empty subject may pass only when the independent head,
ingestion range, projection coverage and selection manifest jointly prove that
zero records—not a missing feed—is the complete result. None is implemented or
measured here.

## 7. What survives graphify or Postgres being absent

| Environment | Current evidence | Required seam posture |
|---|---|---|
| Postgres absent; graphify present; no store selected or explicit graph source | T6 can recall a local `graph.json`, but only as freshness-unverified chronological graph data (`graphify/src/temporal-recall.ts:357-398`; targeted 12/12 tests above) | graphify must provide a local authored-memory writer/reader with the same receipts as the remote backend; until then this is not verified perennial memory |
| Postgres reachable; current real bundle | **RELAYED, not re-measured:** the window path returned 0 nodes / 0 edges on 47,762 nodes because its feed is absent (`tmp/ADDENDUM-1-substrate-not-serving.md:8-13`) | report `FEED_NOT_READY`; do not present the tested capability or empty result as a serving perennial-memory path |
| Postgres selected but unreachable | The error is surfaced and no file fallback occurs (`:317-355`; `graphify/tests/cli-temporal-recall.test.ts:250-285`) | retain refusal; any change to local mode is explicit and reconciliation-aware |
| File GraphStore selected | It lacks `queryWindow` and is refused for T6 (`graphify/tests/storage-postgres-time-window.test.ts:249-264`) | graphify decides whether to extend it or ship another embedded backend |
| graphify absent | h2a source files and committed dossiers remain; `RECALL.md` would remain only if PR 90 or a successor merges. It is absent from inspected `origin/main` | no dynamic read or durable write; `DEGRADED_BOOTSTRAP` only after a successful read and commit/blob/validation receipt, otherwise `MEMORY_UNAVAILABLE`; never a claim of current/full memory |

A perennial-memory design that requires reachable Postgres is **not acceptable**
as the laptop baseline. That judgment follows the mandate's explicit laptop
question (`tmp/BRIEF-graphify-seam-spec.md:84-87`) and the owner's unratified but
clear local-first direction
(`docs/decisions/2026-07-25-agent-memory-owner-answers.md:15-20,48-50`).
Explicit documentary degradation is acceptable only when it is named, refuses
new durable writes, does not inject stale/partial data as true, and never reports
verified perennial memory. A graphify-owned embedded mode with parity is needed
for the full local-first requirement; its backend and reconciliation remain
**OPEN-Q9..Q10**.

### 7.1 Delivery sequence imposed by the missing feed

The memory lane can ship only refusal-safe and documentary pieces before a
graphify feed exists:

1. **May proceed independently:** finalize the neutral contract, a fail-closed
   address-plane interface, and fixtures for both observed bus roots; implement
   receipt validation and the `FEED_NOT_READY`/`MEMORY_UNAVAILABLE` states; and
   preserve a commit/blob-validated `RECALL.md` bootstrap if PR 90 or a successor
   is accepted. Actual single-root selection or federation implementation waits
   for OPEN-Q18's topology and owner decision. A dispatcher may exist behind
   those refusals, but it must not claim dynamic memory is serving.
2. **Graphify feed gate:** graphify must own and deliver an authored append from
   accepted record to canonical substrate, projection population,
   `memory_target`/namespace authority, and a readiness receipt. A
   production-shaped seeded end-to-end fixture using the real
   `graph.json`/`scene.json` split must append known records and retrieve those
   same records; replaying only the current unit/fake `queryWindow` tests does
   not cross this gate. This commitment is pending `human:rhanka`.
3. **Must wait for that gate:** enabling dynamic wake injection, calling a
   persisted record wake-readable, advertising remote or embedded perennial
   memory, and replacing `RECALL.md`. Provider parity, independent freshness and
   completeness proofs, and the h2a refusal mutations must then pass before any
   `MEMORY_VERIFIED` claim.

This order deliberately permits useful contract/refusal work without producing
a day-one design that looks complete and returns empty. The exact ingestion path
and exit evidence are **OPEN-Q17**; h2a bus-root topology and the neutral handoff
are **OPEN-Q18**.

## 8. Consensus questions for `graphify-knowledge`

Every question below is **OPEN**. An answer changes the seam and must be recorded
before implementation. **OPEN-Q17 is the first delivery gate and OPEN-Q18 is the
first routing gate despite their stable identifiers; neither may be deferred as
an implementation detail.**

1. **OPEN-Q1 — Contract ownership and transport.** Will graphify own and version
   the neutral authored-memory read/write request, receipt and error schemas,
   with h2a limited to durable-address resolution and dispatch? Is the supported
   transport process JSON, a write-capable API/MCP service, or both? Will
   graphify accept a CI gate that refuses every h2a import/dependency?
2. **OPEN-Q2 — Record identity and idempotency.** Is `record_uid` alone the
   physical primary key, or is the physical key namespaced/composite while the
   subject remains a separate address? Is it minted by the caller or graphify,
   globally unique or namespace-scoped, and what exact `operation_id`
   collision/retry rules refuse two different writes under one idempotency key?
3. **OPEN-Q3 — Workspace identity.** Does `workspace_uid` mean logical project,
   git repository, clone, fork or linked worktree? What survives repo/remote
   rename, path move, history absorption and multiple clones, and which alias
   ambiguity refuses rather than merges or splits memory silently?
4. **OPEN-Q4 — Actor, role, typed authority and host semantics.** Is memory
   shared by a role or owned by a durable actor occupying it? What typed
   subject kind, issuer or credential lets graphify refuse a session ID disguised
   as an opaque UID? How do role rename/split/merge and two same-role actors
   migrate? Is host provenance or intentional partition, and what durable host
   UID would survive rename/reinstall if partitioned?
5. **OPEN-Q5 — Canonical store.** Does perennial memory make an append journal
   authoritative with the graph as projection, following owner direction D12,
   or retain current graphify `graph.json` authority with DB projections? What
   mechanism refuses journal/graph projection drift?
6. **OPEN-Q6 — Authored write surface and receipt.** What command/API appends one
   memory record, and what atomic receipt proves durability: address, record and
   operation IDs, content digest, committed revision, projection cursor and
   accepted/pending state? Which exact protocol distinguishes authoritative
   pre-append `NOT_PERSISTED`, indeterminate `PERSISTENCE_UNKNOWN`, and durable
   `PERSISTED_NOT_PROJECTED`, and how does an idempotent retry recover each?
7. **OPEN-Q7 — Concurrency.** Is V1 single-writer+namespace, optimistic append,
   or concurrent multi-writer? What revision precondition, conflict response and
   retry rule apply across Claude/Codex/Gemini/Hermes sessions?
8. **OPEN-Q8 — Approval, contradiction and lifecycle.** Which memory kinds may be
   automatic, pending, double-consensus-reviewed or human-approved? How are
   observed time, valid time, contradiction, supersession, correction,
   tombstone, retention, deletion, privacy and `/rewind` represented without
   destructive mutation?
9. **OPEN-Q9 — Local-first backend.** Which graphify-owned embedded/file backend
   supplies authored writes and freshness-aware reads without Postgres, with
   semantic parity to the server backend and acceptable RAM/OOM bounds?
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
    and pagination implemented without omitted records becoming silent partial
    memory or overflowing the wake context?
13. **OPEN-Q13 — Evidence and authorization.** Which citations/locators are
    mandatory, when are they revalidated/quarantined, and how is an authenticated
    workspace+subject bound to a namespace that is currently only a partition?
    Who may read, write, approve, supersede and delete each memory kind?
14. **OPEN-Q14 — `RECALL.md` relationship.** Does graphify complement it,
    deterministically generate a committed bootstrap projection, or eventually
    replace it? What parity criteria cover doctrine, refutations, recurrent
    defects, incidents, locators, quarantine and mandatory pre-action delivery?
    What path/commit/blob/validation receipt makes a degraded bootstrap real
    rather than a label?
15. **OPEN-Q15 — Version and contract gates.** Which golden fixtures, supported
    version ranges and ownership rules jointly gate graphify providers and the
    h2a dispatcher? What fails release when schemas, refusal codes or local/server
    semantics diverge?
16. **OPEN-Q16 — Wake degradation policy.** Which failures refuse only memory
    injection and which refuse launch/first action? Is `required` or
    `best-effort` the default for durable actors, and what explicit audited
    break-glass is allowed when graphify and a receipt-validated committed
    bootstrap are absent?
17. **OPEN-Q17 — Substrate ingestion and reachability (first delivery gate).**
    What graphify-owned path writes one accepted authored-memory record into the
    canonical substrate and then into each queryable projection? Does any such
    end-to-end path exist today? Which feed identity, ingestion/projection
    watermarks and readiness receipt distinguish a legitimately empty result
    from the relayed 0-node/0-edge unfed result? What representative seeded test
    must pass before h2a may enable dynamic writes or wake reads?
18. **OPEN-Q18 — Address-plane topology, owner and neutral handoff (first routing
    gate).** Must h2a addressing use one authoritative bus root, or will an
    explicitly named h2a owner federate the two simultaneously observed paths?
    What pre-dispatch mechanism refuses an unknown, wrong or ambiguous bus root,
    and how does it prove one durable `subject_ref` without using either
    session-minted UUID? Which neutral proof/issuer may graphify validate without
    importing h2a or learning its bus topology? Separately, which graphify-owned
    endpoint/store-namespace identifier is echoed as `memory_target`?

## 9. Refusal-oriented acceptance requirements

No requirement below is implemented by this document.

1. Changing only an h2a session/instance ID preserves the resolved subject address
   and recalled records; introducing a session ID into an identity slot is
   refused.
2. Two records under one subject do not collide; two different workspaces with an
   `architect` do not cross-read; ambiguous aliases refuse.
3. A write is called durable only after a receipt with matching address,
   operation ID, record ID, digest and committed revision.
4. An authoritative pre-append rejection or a graphify endpoint proven not
   reached produces `NOT_PERSISTED`; an indeterminate post-dispatch disconnect
   produces `PERSISTENCE_UNKNOWN`; durable append followed by feed/projection
   failure produces `PERSISTED_NOT_PROJECTED` plus `FEED_NOT_READY`. Every retry
   uses the same `operation_id`, creates no duplicate and creates no h2a spool.
5. Wrong address, a head behind the independent anchor, `snapshot:null`,
   unsupported schema, missing journal-root/selection manifest, unexplained
   journal omission, count/digest mismatch, nonterminal cursor, truncation,
   unresolved locator and unapproved state all refuse verified prompt injection.
6. Local and Postgres providers run the same authored-memory golden fixture and
   either return semantically identical receipts/bundles or a named unsupported
   capability; no silent fallback is accepted. The fixture begins with an
   authored append through a production-shaped `graph.json`/`scene.json` bundle
   and proves that known seeded records reach the queried projection; a passing
   isolated `queryWindow` suite is insufficient.
7. A graphify source or package that imports h2a fails graphify CI; h2a only
   consumes the graphify-owned contract.
8. The h2a refusal mutations live in
   `packages/h2a/test/perennial-memory-seam.test.js`, so the required root gate
   reaches them. Tests placed only in `packages/h2a-runtime` do not satisfy this
   requirement (`scripts/run-tests.mjs:10-19,29-58`).
9. `DEGRADED_BOOTSTRAP` requires a readable bootstrap plus matching path,
   commit/blob digest and validation receipt; absence, unreadability or drift
   yields `MEMORY_UNAVAILABLE`.
10. With both relayed h2a bus-root shapes represented concurrently, the
    address-plane fixture either selects/federates one durable subject or returns
    `ADDRESS_DOMAIN_UNRESOLVED`; on refusal the graphify mock records zero calls.
    A separate provider fixture refuses an unknown/unauthorized
    `memory_target` namespace.
11. A capability-present but feed-absent provider returns `FEED_NOT_READY`. An
    empty `MEMORY_VERIFIED` bundle is accepted only with independent head,
    ingestion coverage, projection coverage and selection-manifest proof.

## 10. Defects and gaps observed but deliberately not fixed

1. **Anti-cycle is not mechanically enforced across the seam.** The architecture
   calls the edge hard, but h2a's inspected gate only checks selected h2a-core
   dependency substrings (`scripts/check-public-contract.sh:30-36`). Graphify's
   five printed dependency maps contained no h2a package, and the bounded import
   and gate-pattern scans described at §3 printed no matches. These scans do not
   establish repository-wide absence; they found no mechanism that refuses the
   forbidden edge in the inspected paths. This spec adds a requirement and does
   not edit either gate.
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
7. **The implemented/tested Postgres window is not an end-to-end serving path.**
   The graphify conductor relayed 0 nodes / 0 edges on its 47,762-node real
   bundle and attributed it to the absent feed between `graph.json`/`scene.json`
   and `queryWindow` (`tmp/ADDENDUM-1-substrate-not-serving.md:8-13`). This lane
   did not re-measure or fix graphify; the missing ingestion path remains
   **OPEN-Q17**.
8. **Two live bus roots partition the same actor's addressing.** The graphify
   conductor relayed distinct simultaneous UUIDs for the same `knowledge` role
   under two disjoint h2a bus roots
   (`tmp/ADDENDUM-1-substrate-not-serving.md:42-55`). These are not evidenced as
   graphify storage roots. This lane did not consolidate h2a address stores or
   assign a federation owner; pre-dispatch topology, neutral handoff and refusal
   remain **OPEN-Q18**.
9. **The cross-repository majority-layer commitment is not ratified by
   graphify.** The h2a owner direction is the mandate for this document, while
   the graphify conductor reports no decision by its principal `human:rhanka`
   (`tmp/ADDENDUM-1-substrate-not-serving.md:57-62`). This spec does not record a
   decision on that principal's behalf.

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
- h2a `track validate`: `INVALID: 0 integrity + 2 desync finding(s)`, with the
  two item IDs recorded in §10.

The following were **relayed by the graphify conductor and not re-measured in
this lane**: the real 47,762-node bundle returning 0 nodes / 0 edges through the
Postgres-backed window because its feed is absent; the two simultaneous bus
roots and UUIDs for the same live role; and the absence of a graphify-side
decision by principal `human:rhanka`. Their preserved locator is
`tmp/ADDENDUM-1-substrate-not-serving.md:8-13,42-55,57-62`.

The following were **not measured**: a live PostgreSQL query, an authored-memory
write, an end-to-end substrate feed, any accepted record schema, wake injection,
local/server reconciliation,
concurrent multi-CLI writes, cross-host identity, authorization/privacy policy,
latency, memory footprint, OOM behavior, full h2a root test gate, graphify full
test gate, deployment, or owner UAT.

This branch can only propose and preserve the seam. Only the owner can accept it,
and agreement on every `OPEN-Q` belongs in the graphify-knowledge consensus
record before implementation.
