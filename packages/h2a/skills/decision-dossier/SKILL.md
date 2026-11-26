---
name: decision-dossier
description: Author, validate, preview, publish and review Focus decision dossiers and informational reports using MCP tools only. Defers effort sizing to present-decision, imports Focus writing rules byte-for-byte, and hands decision recording to the single Track writer.
---

# Decision Dossier

## When

Defer to `present-decision` to choose the right effort level for the owner's stakes:

- **Decide-and-trace** — local, readily reversible, clear existing pattern.
- **Quick ask** — one low-stakes preference with 2–3 clear options and cheap rollback.
- **Decision dossier** — irreversible or costly rollback, public/frozen contract or schema change, security/access/migration risk, cross-owner impact, balanced trade-offs, or explicit owner request.

Do not duplicate `present-decision`'s owner-criteria table or self-audit here; follow `present-decision` for effort sizing and grounding, then apply this skill to author, validate, preview, publish, and review the Focus document (`DecisionDossierDocument` or `ReportDocument`).

## Write

<!-- FOCUS-WRITING-START -->
## Prepare a dossier the owner can read on its own

- Write `title` and `subject` as non-empty single lines of at most 100
  characters. Name the concrete subject and what the owner must decide:
  “Garden shed — choose its location”, not “Ratify the plan”. Review their
  meaning against the request; the gate checks length and form, not meaning.
- Quote the owner's literal request in `readability.ownerRequestQuote`.
  Preserve their words and trace how the questions serve them. Never invent
  a quotation. If no request exists, set `noOwnerRequest: true`; this blocks
  presentation until the request is established. Do not combine it with a quote.
- State the scope and why it matters to the owner in `readability.stakes`:
  cost, disruption, consequences, reversibility. Declare `stakesLevel`: `low`
  for a small reversible inconvenience, `medium` for meaningful cost or
  disruption, `high` for lasting, contractual or major personal impact.
- Set `readingBudgetMinutes` proportionately: at most 2 / 8 / 30 minutes for
  low / medium / high stakes, including shared context and glossary. These
  caps are defaults, not permission to inflate the stakes or fill the budget.
- Each question needs representative `context`, 2–4 short options, a
  `recommendedOptionId`, and a short reason in `recommendedAnswer`. Context
  must explain the situation, scope and trade-off without making the reader
  chase another document or decode an identifier.
  Keep questions and recommendations to one line of at most 300 characters,
  option-set titles to 100. No nested lists or inline a/b branches.
- Each option needs a one-line `consequence` for the owner. Labels are at most
  100 characters, consequences 160, optional bodies/comments 300. Keep them
  flat: no nested lists, inline a/b branches or multiple decisions in one
  option. Move essential explanation to question context.
- Estimate `readingTimeMinutes` for each question, context and options together:
  positive and at most 2 minutes. The gate checks a 180-word/minute lower bound.
  Allow time to understand the trade-off, not just pronounce the words. Shorten
  or split long questions; never understate the time to pass the gate.
- Every option set names its `questionId`; every decision, orientation or
  amendment outcome names the question it resolves. Choice-bearing prose also
  names its question. Audit *every* implied commitment, including defaults,
  rollout, spending and permissions. Split independent commitments into explicit
  questions. A reference alone does not prove that the question covers the text.
- Prefer plain words to codes such as `L06b`, `MH-L3`, `R5` or build identifiers,
  and to unexplained acronyms. If necessary, define each term in
  `readability.glossary` with a meaning the owner understands. The renderers show
  this glossary. Each definition must stand alone in plain words, with no
  self-reference or other code, even one defined elsewhere in the glossary.
- Enforce the 11/11 anti-wall-of-text rules: put the essential point first
  (plain guidance, never an imposed opening label); keep each prose
  cell or lead-and-bullet block, question block and option block to at most 60
  words; keep each sentence to at most 22 words and one idea (no `;`, no `(...)`,
  at most one `:`, and no inline enumeration); never place ULIDs, SHA hashes,
  internal lot/AC codes or raw digit counts in prose, even if listed in
  `glossary` (`ownerRequestQuote` is exempt as verbatim).
- On `prose` and `question` sections, optional `inputs[]` (`{ ref, kind, label? }`,
  non-blank strings, `label` ≤ 12 words and ≤ 100 characters) declare prerequisite
  artefacts with unique `ref` values (including across a linked `prose` and
  `question` sharing `prose.questionId === question.id`), and optional
  `completionCriterion` states a short verifiable exit condition (1 sentence, ≤ 22 words, ≤ 160 characters).
- A `diagram` section supports either inline mode (`syntax` + `source`, optional
  `diagramType` and `scene`) or reference mode (`sourceRef` + `renderComponent`,
  mutually exclusive with `source`, `syntax` and `scene`). Reference diagrams are
  resolved by the host `diagramResolver`; offline standalone exports bundle inline
  diagrams only.

### Choose the right `diagramType` for every diagram section

| Content | `diagramType` | Mode / DS profile | Expected rendering | Forbidden |
| --- | --- | --- | --- | --- |
| Ordered steps, runbook, validation circuit, CI/CD pipeline, agent loop | `workflow` | Mode A (`process@1` / `flowchart`) | Rounded centered simple boxes, clean arrows, zero component icons, zero fold buttons | Architecture component cards |
| Normative BPMN 2.0 process | *(outside inline Focus)* | A2UI `BpmnCanvas` | Dedicated BPMN 2.0 notation | Simulating BPMN with `generic@1` |
| Services, components, deployment, network zones, numbered flows | `architecture` | Mode A (`generic@2`, `archimate@2`, `ecosystem:*`, `flows`, or raw `flowchart` with `"diagramType": "architecture"`) | Compact r7 `v2` cards (opt-in), zones, visible links + legend | Simple process boxes without boundaries |
| Data model, tables, PK/FK, cardinalities | `erd` | Mode A (`erd@1` / `erDiagram`, upcoming lot) | ERD tables with PK/FK rows and crow's feet | Generic cards |
| Chronological exchanges between actors or services | `sequence` | Mode A (`sequence@1` / `sequenceDiagram`, upcoming lot) | Lifelines, sync/async/reply messages, `alt`/`loop` blocks | Flattened flowchart |
| ETL/ELT pipeline, stores, lineage | `dataflow` | Mode A (`dataflow@1`, upcoming lot) | Pipeline steps with store cylinders and documents | Uniform cards |
| Weighted flow distribution (volumes) | `dataflow` | Mode B (`SankeyChart`, later Focus lot) | Proportional ribbons | Unweighted flowchart |
| Entity states, guards, retries | `lifecycle` | Mode A (`state@1` / `stateDiagram-v2`, upcoming lot) | Initial/final states and guarded transitions | Cards lacking initial/final states |
| Classes, interfaces, attributes, inheritance | `class` | Mode A (`uml@2` / `classDiagram`, upcoming lot) | Three compartments and UML connectors | Cards without compartments |
| Hierarchy or single-parent taxonomy | `tree` | Mode B (`TreegraphChart`, upcoming lot) | Node-link tree | Card grid |
| Dated milestones or incident chronology | `timeline` | Mode B (`TimelineChart`, upcoming lot) | Time axis with lanes and milestones | Horizontal flowchart |
| Nested latencies, execution trace | `waterfall` | Mode B (`TraceWaterfallChart`, upcoming lot) | Indented spans with statuses | Flat bars |
| Cumulative numeric bridge (variances) | `waterfall` | Mode B (`WaterfallChart`, Focus only, upcoming lot) | Cumulative increase/decrease/total bars | Trace spans |

Diagram authoring rules:
1. Always declare `diagramType` on every new `diagram` section. Lot 1: the offline Focus builder accepts `diagramType` `"workflow"` and `"architecture"` only.
2. For a `workflow`, aim for 3 to 8 steps with short labels (at most 5 words per box).
3. If a builder warns `linear_chain_as_architecture_cards`, inspect intent and switch to `"diagramType": "workflow"` when the diagram represents steps rather than components.
4. Untyped Mermaid `flowchart` sources without `scene` render as `workflow` (`process@1`) boxes by default; set `"diagramType": "architecture"` explicitly to retain architecture component cards.
5. Write a standalone single-sentence `alt` description and never encode states by color alone.

Bad: “Ratify L06b under MH-L3? A: migrate, with a/b variants. B: defer.”
The request, stakes, consequences and recommendation are missing; several
choices are hidden behind codes.

Good (about one minute):
> Your request: “Keep the garden shed handy without spoiling the terrace view.”
> Stakes: the wrong spot means a longer walk every week or a blocked view for years.
> Question: where should the shed go? The permit covers both spots; only comfort differs.
> Side wall: a short walk and a clear terrace view.
> Back of garden: a longer walk, invisible from the house.
> Recommendation: side wall, because it meets both parts of your request.

Encode the good example as one question, two linked options, the recommended
option's id and reason, the literal quote and stakes, a declared stakes level,
and reading estimates. Let the renderer arrange the supplied questions/options;
never hand-author four parallel walls of text or imply that snapshot cards are
clickable.
<!-- FOCUS-WRITING-END -->

## Do

Use **MCP tools only** for every Focus, artifact, review, and coordination step. Never invoke raw shell CLI commands for Focus or h2a from a bash tool.

### 1. Select template and author `dossier.json`

- Call `h2a_focus_template` (`{ kind: "dossier" }` for a v1 decision dossier, `{ kind: "evidence" }` for a v2 embedded-evidence decision dossier, or `{ kind: "all" }`).
- Write `dossier.json` inside the current workspace (never under `/tmp`) and replace every placeholder.
- **Anchor and identity discipline (R1–R6):**
  - Every entity `id` (sections, options, sources, citations, evidence groups, annexes) must be unique across the document (R2), 1–128 characters with no whitespace or control characters (R5), and distinct from `doc.ref` which is reserved for the header anchor (R6).
  - `focus:<doc.ref>` must fit within 128 characters, and canonical `dossier.json` must not exceed 1 048 576 UTF-8 bytes.
  - Across revisions, keep each existing `id`'s family and `kind` unchanged (R3) and never reuse a retired `id` (R4).
- **Closed schemas (no unknown fields):**
  - **Decision dossier (v1, `1.2.0`):** `ref`, `subject`, `title`, `hash`, `cursor`, `readability` (`ownerRequestQuote` or `noOwnerRequest`, `stakes`, `stakesLevel`, `readingBudgetMinutes`, optional `glossary`), `sections` (`prose`, `question`, `optionSet`, `outcome`, `amendmentTrace`, `diagram`), `interactions: []`, `provenance` (`source`, `readAt`), `amendmentTrace: []`.
  - **Decision dossier with embedded evidence (v2, `2.2.0`):** same as v1 plus `schemaVersion: 2`, `sources[]` (base64 `data`, exact decoded `sha256` hex and byte `size`, frozen `origin`, plus `width`/`height`/`alt` for images), `citations[]`, `evidenceGroups[]`, and `annexes[]`.
  - **Informational report (`ReportDocument:1.1.0`):** `kind: "report"`, `schemaVersion: 2`, `sources`, `citations`, `evidenceGroups`, `annexes`, `interactions: []`, `readability`, and `sections` restricted strictly to `prose`, `diagram`, and `amendmentTrace` (no `question`, `optionSet`, or `outcome`).
  - **Diagrams:** inline `diagram` section with `diagramType` (closed 10-value Archify classification from the table above — always declare it on new sections), `syntax: "mermaid"` (or `"plantuml"`), non-empty `source` (`flowchart LR|TB|TD` for `workflow`, `ecosystem:overview` / `ecosystem:models` / `ecosystem:knowledge` / `ecosystem:interfaces` for `architecture`), and non-empty `alt`. Untyped Mermaid `flowchart` sources render as `workflow` simple boxes; add `"diagramType": "architecture"` explicitly to retain architecture component cards.

### 2. Validate through the gate

- Always call `h2a_focus_check` (`{ input }` or `{ input, previousManifest }` for a revision) before any preview or publication.
- Fix every structured refusal at its reported field path and re-run `h2a_focus_check` until `ok: true`.
- Never deduce document validity from HTML rendering alone, never drop evidence to bypass a refusal, and never fabricate or alter `ownerRequestQuote`.

### 3. Build off-loop asynchronously and deliver (`output` and/or `publish`)

- **Preferred async workflow (`h2a_focus_submit_build` → `h2a_focus_build_result`):**
  1. Call `h2a_focus_submit_build` (`{ input, output?, publish?, mode?, target?, renderer?, themeCss?, themeId? }`) — `output` writes the standalone `.html` file inside the workspace, `publish` (`{}` or `{ federation?, workspaceRef?, previousManifest?, expectedCurrentReleaseId?, title? }`) publishes the immutable `focus-dossier/1` release (`dossier.json`, `focus.manifest.json`, and derived `views.json`) via `publishFocusRelease` (`artifacts_ensure` + `artifacts_publish` on the bound Sentropic artifact surface), or pass **both** in one job. Validation runs immediately and returns `{ ok: true, jobId, state: "queued" }` right away; heavy diagram routing and rendering run in a dedicated child worker off the central event loop and survive client reconnects in central MCP mode (in direct stdio mode, closing the server cancels active jobs).
  2. Retrieve the result with `h2a_focus_build_result` (`{ jobId, waitMs? }`, bounded up to `20000` ms, default `15000` ms). If `state` is `"queued"` or `"running"`, call `h2a_focus_build_result` again with the same `jobId` until `state` is `"succeeded"` (`output`, `bytes`, `warnings`, `publish`) or `"failed"` (`error`, structured `refusals`).
- **Offline standalone export & compatibility fallback:**
  - `h2a_focus_submit_build({ input, output })` + `h2a_focus_build_result({ jobId })` (or bounded compatibility wrapper `h2a_focus_build({ input, output })`, which uses the same off-loop worker and returns `{ ok: true, pending: true, jobId, state, output }` instead of dropping or aborting if its bounded wait expires) builds portable offline HTML. Check the returned `warnings` array: if `linear_chain_as_architecture_cards` appears on a sequential workflow, set `"diagramType": "workflow"`.
- **Central / bound publication rules (`h2a_focus_submit_build` with `publish`):**
  - **Announce federation and space first:** before the first publication of a dossier, explicitly tell the owner which federation and space/workspace will receive it. Never publish without an explicit session and space binding.
  - **Keep access `restricted`:** preserve `restricted` access on every publication; never widen artifact access automatically.
  - **No automatic send on a simple time-series render:** a simple temporal / time-series render never triggers an automatic publication or external send; publish only when persistence or sharing as an artifact is explicitly intended.
  - Report the stable URL (`stableUrl`), version URL (`versionUrl`), release id (`releaseId`), and artifact `digest` returned in `publish` by `h2a_focus_build_result` (along with canonical `documentDigest` from `h2a_focus_check`).
  - Use surface `artifacts_*` tools (`artifacts_list_versions`, `artifacts_revert`, `artifacts_delete` with human confirmation) or `h2a_focus_status` / `h2a_focus_get` when exposed by the bound surface to inspect release state and retrieve canonical sources.

### 4. Follow review threads and republish

- Inspect anchored block threads (and general threads anchored on the header `doc.ref`) via `artifact_comments_list_by_target`, `artifact_comments_list_thread_summaries`, and `artifact_comments_list_thread`.
- Human comments relayed to the owning session arrive through `h2a_send`.
- For each accepted revision: edit `dossier.json` while keeping anchor identity intact (R3/R4), re-validate with `h2a_focus_check` against the previous manifest, republish with `h2a_focus_submit_build` passing `publish: { previousManifest, expectedCurrentReleaseId }` (then await `h2a_focus_build_result`), then reply on each resolved thread with `artifact_comments_add` (for example `"Resolved in rev. n"`) before closing it with `artifact_comments_set_state` (`"closed"`).

### 5. Hand off decision recording to the single Track writer

- A page selection, card click, or copied **response line** never records a decision on its own.
- Once the owner gives an explicit choice (via the copied response line or the host's native question tool), hand off decision selection and the `rendered-view` release link to the single Track writer (`track decision select` / `track decision add-artifact` performed by the authorized Track writer). Never mutate `.track/` directly outside that writer.
- After the decision is recorded, republish the dossier with its recorded outcome if requested.
