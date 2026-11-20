# Feature: Track owner table — delivery lot 1 (qualified reader)

## Objective

- [ ] The owner table renders everything it knows and qualifies what it lacks: a gap about one element no longer refuses the whole table.
- [ ] Only four gates still refuse entirely (integrity, number registry, unproven status, no readable source); `--strict` keeps the refusal of the lot-0 reader, byte for byte.
- [ ] The table names the journal it read, reads the main checkout from a linked worktree, and never emits the reserved absolute sentences.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3, 4, 5, 6.1 (steps 1, 2, 5, 7) and annex B, tests T1-a to T1-t.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`, and `harness` for the skill text. Consulted: `cond`.
- [ ] Prerequisite: lot 0 is merged. The first commit of this branch freezes the lot-0 reader's refusal output before any reader change (Lot 0 below).
- [ ] The strict audit `auditOwnerTable` keeps every code and every message. The qualified reader is a layer over it, not a rewrite of it.
- [ ] The reader never rewrites a text, never invents a number, a cause or a recommendation, and never prints a masked text.
- [ ] A read writes nothing: no journal, no index entry, no lock, no side file (spec V4).
- [ ] Out of scope, do not start: the index, designation, satellites and the journal outside the repository (lot 4a); any write verb (lot 2); the queue and the capture state per CLI (lot 3a); stable decision numbers (lot 2).
- [ ] The new resolver serves `report --owner-table` only in this lot. Every other verb keeps `resolveTrackDir` (spec DS-6).
- [ ] Owner-facing strings are French and are exactly those of spec section 5; all other new text is English.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; tests use `mkdtemp` only; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/track/src/report/owner-table.ts`
  - `packages/track/src/report/owner-table-qualified.ts`
  - `packages/track/src/report/owner-table-scope.ts`
  - `packages/track/src/report/owner-table-qualified.test.ts`
  - `packages/track/src/report/owner-table.test.ts`
  - `packages/track/src/report/fixtures/**`
  - `packages/track/src/cli/journal-reference.ts`
  - `packages/track/src/cli/journal-reference.test.ts`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/cli/desync.ts`
  - `packages/track/src/state-home.ts`
  - `packages/track/src/state-home.test.ts`
  - `packages/track/src/read/contract.ts`
  - `packages/track/src/cli/read-serve-empty.test.ts`
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `plan/04-BRANCH_track-owner-table-lot-1-qualified-reader.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/events/**`
  - `packages/track/src/cli/resolve.ts`
  - `packages/track/src/workspace-id.ts`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/track/src/mcp/**` (only if the read tool must expose `--strict`)
  - `packages/track/src/report/validated-report-shape.test.ts`, `packages/track/src/report/skill-truncation-warning.test.ts`, `packages/h2a/test/owner-gate-skill.test.js`
  - `packages/h2a/fixtures/native-host-catalog.json` (never hand-edited)
  - `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md` (only to correct a statement the build proves wrong, with the evidence)
- **Exception process**:
  - Declare exception ID `BR804-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `cond`: the default output of `report --owner-table` changes for every session; sessions that need the old all-or-nothing behaviour pass `--strict`.
- [ ] `attention` to `cond`, before this repository's dry run is applied: its command file must drop the quotation marks around reconstructed demands or mark them as manual; the reader labels them `(non capté)` either way (T1-r).
- [ ] `attention` to `harness`: the skill section on the owner table is rewritten (Lot 8).

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one reader; its layers are tested against the same fixtures)
- [ ] **Multi-branch**
- Rationale: the strict path, the qualified path and the header share fixtures and one frozen expectation.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline, frozen expectation and red tests**
  - [ ] Read spec sections 3 to 6 and annex B; read `owner-table.ts` in full; `packages/track/src/read/contract.ts` lines 1258-1272; `packages/track/src/cli/index.ts` lines 1339-1530 and 1854-1882; `packages/track/src/cli/desync.ts`; `packages/track/src/cli/resolve.ts`.
  - [ ] Create the worktree under `tmp/worktrees/` from an `origin/main` that contains lot 0; `npm ci`; `npm run build -w @sentropic/track`.
  - [ ] Build the fixture builder `packages/track/src/report/fixtures/legacy-like-journal.ts`: through the `Track` facade and, for legacy shapes, direct `EventStore.appendCommand` events, it produces a journal with 14 numbered demands, 13 owner-request items that never received a number, and 18 unsettled decisions — 16 attached to no row, 15 without a dossier link, 1 deferred without options — one of which holds 30 dossier questions without an answer.
  - [ ] Freeze the lot-0 refusal: run the unchanged reader on that fixture, save stderr verbatim as `packages/track/src/report/fixtures/owner-table-strict-refusal.txt`, and commit builder and file before any reader change.
  - [ ] Tests (red first), all in the files named; each title ends with its identifier:
    - [ ] `T1-a` — `packages/track/src/report/owner-table-qualified.test.ts` — renders 14 rows, 13 demands to attach, 18 decisions of which 16 outside a demand, 15 without dossier and 1 to instruct, and counts 30 dossier questions (T1-a)
    - [ ] `T1-b` — `packages/track/src/report/owner-table-qualified.test.ts` — strict mode refuses with the frozen lot-0 output, byte for byte (T1-b)
    - [ ] `T1-c` — `packages/track/src/report/owner-table-qualified.test.ts` — a journal with no demand and no decision renders its header and the partial-scope sentence with exit 0, and refuses no-owner-demands under strict (T1-c)
    - [ ] `T1-d` — `packages/track/src/report/owner-table-qualified.test.ts` — a pending or deferred decision without options is listed to instruct, without number or letters, outside the reply line (T1-d)
    - [ ] `T1-e` — `packages/track/src/report/owner-table-qualified.test.ts` — an OWNER GATE decision is rendered to answer in its session, without number, outside the reply line (T1-e)
    - [ ] `T1-f` — `packages/track/src/report/owner-table-qualified.test.ts` — an integrity finding refuses in every mode; a desynchronisation finding alone renders and is counted (T1-f)
    - [ ] `T1-g` — `packages/track/src/cli/journal-reference.test.ts` — from a linked worktree the table reads the main checkout journal, names it, and reports events held only by the local copy (T1-g)
    - [ ] `T1-h` — `packages/track/src/report/owner-table-qualified.test.ts` — a masked cell never shows the offending text and no text is rewritten (T1-h)
    - [ ] `T1-i` — `packages/track/src/report/owner-table-qualified.test.ts` — a journal whose demands are all archived renders zero active demand and the archived count (T1-i)
    - [ ] `T1-j` — `packages/track/src/report/owner-table-qualified.test.ts` — the reserved absolute sentences are emitted by no mode on any fixture (T1-j)
    - [ ] `T1-k` — `packages/track/src/report/owner-table-qualified.test.ts` — document references are resolved against the journal folder, not the current directory (T1-k)
    - [ ] `T1-l` — `packages/track/src/state-home.test.ts` — the private-term policy is found beside the journal, then in the user state directory (T1-l)
    - [ ] `T1-m` — `packages/track/src/report/owner-table-qualified.test.ts` — header counters equal the sum of the sections (T1-m)
    - [ ] `T1-n` — `packages/track/src/report/owner-table-qualified.test.ts` — a vanished number, a number held twice or a hole below the highest number refuses in every mode (T1-n)
    - [ ] `T1-o` — `packages/track/src/report/owner-table-qualified.test.ts` — a row that would show done or on-track without its witness refuses in every mode (T1-o)
    - [ ] `T1-p` — `packages/track/src/report/owner-table-qualified.test.ts` — rendering leaves the journal folder byte-identical and creates no file anywhere (T1-p)
    - [ ] `T1-q` — `packages/track/src/report/owner-table-qualified.test.ts` — the Markdown form prints no decision identifier and the JSON form carries it (T1-q)
    - [ ] `T1-r` — `packages/track/src/report/owner-table-qualified.test.ts` — a text that was not captured is labelled non capté and never quoted (T1-r)
    - [ ] `T1-s` — `packages/track/src/cli/read-serve-empty.test.ts` — with no journal and no active capture the table refuses as not covered (T1-s)
    - [ ] `T1-t` — `packages/track/src/report/owner-table-qualified.test.ts` — every row-level gap is flagged on its row and counted, and the row stays (T1-t)
  - [ ] Red evidence to keep: T1-a, T1-c, T1-d, T1-e, T1-h, T1-i, T1-m, T1-q, T1-r and T1-t fail because the reader refuses; T1-f and T1-n to T1-p are specified below; T1-g fails because the worktree copy is read; T1-k fails because validation uses the current directory; T1-l fails because only the journal folder is searched.
  - [ ] T1-f red evidence: on a copy of a rendering fixture, a head record that disagrees with the stream, then an event whose content no longer matches its hash, both render with exit 0 today (spec finding F-1).
  - [ ] T1-j is written as a sweep: it renders every fixture of the file in default and strict mode, in `md`, `text` and `json`, and asserts neither `Aucune décision en attente` nor `Réponse : aucune décision en attente` occurs.
  - [ ] T1-t is table-driven over annex B: one case per check classified E3, each asserting exit 0, the row present, the flag in the cell named, and the header count.
  - [ ] Lot gate:
    - [ ] Every test above fails for its stated reason, except T1-b which passes on the frozen file; T1-s fails only on the missing « non couvert » wording; outputs saved.

- [ ] **Lot 1 — A stable identifier per check**
  - [ ] In `owner-table.ts`, add an additive field `check` to `OwnerTableGateViolation` and set it on every `violations.push` with a stable identifier per check of annex B (for example `registry.duplicate`, `registry.missing`, `registry.hole`, `status.unproven`, `row.unnumbered`, `decision.no-row`, `decision.to-instruct`, `decision.no-dossier`, `text.commit-hash`, `text.internal-id`, `text.jargon`, `text.reserved`).
  - [ ] Change no `code`, no `message`, no order of violations: the refusal text stays byte-identical.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table.test.ts src/report/owner-table-qualified.test.ts` — T1-b green; every existing test green.

- [ ] **Lot 2 — Integrity, registry and unproven status: the gates that still refuse**
  - [ ] Add the code `journal-integrity` to `OwnerTableGateCode`. On the owner-table path (`read/contract.ts` `ownerTable`, or `cmdReport`), run `validate(events, readHead(eventsPath))` and refuse with `- [journal-integrity] <n> finding(s): <kinds>` in every mode; turn an unparsable line into the same refusal.
  - [ ] In `owner-table-qualified.ts`, define the four global classes from the `check` identifiers: G1 integrity, G2 the three registry checks, G3 `status.unproven`, G4 no source. Any violation in one of them refuses; nothing else does in default mode.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts` — T1-f (integrity part), T1-n, T1-o green; T1-b still green.

- [ ] **Lot 3 — Journal of reference for the table**
  - [ ] Create `packages/track/src/cli/journal-reference.ts` with `resolveJournalOfReference({ cwd, flag, env })` returning the journal folder, how it was resolved (`--track-dir`, `TRACK_DIR`, `dépôt principal`, `dossier`), a label, and, when the start folder has its own copy, the number of its events absent from the journal retained.
  - [ ] Step 2: detect a linked worktree as `workspace-id.ts:78-86` does (`--git-dir` differs from `--git-common-dir`), take the main checkout from the first entry of `git worktree list --porcelain`, and continue the resolution from there. When the main checkout has no journal, fall through to step 5 from the start folder.
  - [ ] Count local events absent from the reference with the existing event-id containment used by `track events-contains`; do not re-implement it.
  - [ ] Wire `cmdReport` so that `--owner-table` uses this resolver; leave every other verb on `resolveTrackDir`.
  - [ ] No journal and no active capture: keep the existing refusal and make its message say « non couvert » and why.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/cli/journal-reference.test.ts src/cli/resolve.test.ts src/cli/read-serve-empty.test.ts` — T1-g and T1-s green; `resolve.test.ts` unchanged and green.

- [ ] **Lot 4 — Desynchronisation and policy lookup**
  - [ ] Make the owner-table path compute `desyncFindings(state, <folder that holds the journal>)`; do not change what `track validate` prints in this lot, only make it resolve against the journal folder too and record that change in the pull request (spec DS-7, finding F-2).
  - [ ] Create `packages/track/src/state-home.ts`: `trackStateHome(env)` returns `TRACK_STATE_HOME`, else `sentropic/track` under `XDG_STATE_HOME`, else under `.local/state` of the home directory. It creates nothing.
  - [ ] Policy lookup order for the owner table: `--policy`, the two existing environment variables, `owner-report-policy.json` beside the journal, then the same file name in the state home. When none exists the header says `politique de termes privés absente`.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/state-home.test.ts src/report/owner-table-qualified.test.ts` — T1-k, T1-l and the desynchronisation part of T1-f green.

- [ ] **Lot 5 — Qualified sections**
  - [ ] In `owner-table-qualified.ts`, build the qualified view from the strict view and its violations: numbered rows stay in the table; rows with `row.unnumbered` move to « À rattacher » with their date and what is missing.
  - [ ] Decisions: add the creation date, the count of unanswered dossier questions and the deferred mark to each listed decision (additive fields of the view). Classify each as numbered, `hors demande`, `à instruire` or OWNER GATE; an OWNER GATE is recognised by its title prefix and its session name is read from the field labelled `Session` or `Target session` in the recorded context.
  - [ ] Row-level gaps (class E3) flag the cell concerned with a short motif and keep the row.
  - [ ] Text-gate hits mask the cell: `texte masqué (<motif>), à réécrire`, the motif chosen from the `check` identifier and never revealing the text.
  - [ ] Request cells: a text is followed by `(non capté)` unless the `demand.raised` event that carries it has the capture provenance defined by lot 3a; nothing is captured before that lot, so every text is labelled.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts` — T1-a, T1-d, T1-e, T1-h, T1-i, T1-r, T1-t green.

- [ ] **Lot 6 — Header, scope and reserved sentences**
  - [ ] Create `packages/track/src/report/owner-table-scope.ts`: it evaluates conditions (a) to (f) of spec V1 and returns the ordered motifs. Condition (f) is the constant false of decision DS-1, with its motif; before lot 3a the capture motif is the single `captation inactive`.
  - [ ] Render the header of spec section 5, the three sections, the counts line of the decisions section, and the partial-scope sentence `Aucune décision enregistrée au journal (périmètre partiel : <motifs>)` when no decision is listed.
  - [ ] Remove the two absolute strings from the success branch of `renderOwnerTable` as well: strict mode obeys V1.
  - [ ] The `Réponse` line lists only numbered decisions that carry a recorded recommendation and is omitted otherwise.
  - [ ] JSON form: the qualified view with header, rows, items to attach, decisions with their identifier, counts and scope; Markdown and text forms never print an identifier.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts` — T1-c, T1-j, T1-m, T1-q green; existing tests updated only where they pinned an absolute string on a success path, each change listed in the commit message.

- [ ] **Lot 7 — CLI wiring**
  - [ ] In `cmdReport`: accept `--strict` only together with `--owner-table`; default mode renders the qualified view with exit 0; `--strict` calls the unchanged strict renderer and exits 1 on any violation.
  - [ ] Print the existing policy notice on stderr in strict mode only; in default mode the header carries it.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/read/owner-report-contract.test.ts` — T1-b, T1-p green; `--status-table` output unchanged.

- [ ] **Lot 8 — Skill**
  - [ ] Rewrite the owner-table section of `packages/h2a/skills/harness/track-report/SKILL.md` (lines 8-50): the header and what each part means, the three sections, the four gates that refuse, `--strict` for conductors and CI, the rule that an answer is recorded by the identifier of the JSON form of the same rendering, and the rule never to recompose a refused table by hand.
  - [ ] Keep the sentences pinned by `owner-gate-skill.test.js`, `validated-report-shape.test.ts` and `skill-truncation-warning.test.ts`.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`; `npm run build`; `node --test packages/h2a/test/owner-gate-skill.test.js packages/h2a/test/install-skills-hosts.test.js`.

- [ ] **Lot 9 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts src/cli/journal-reference.test.ts src/state-home.test.ts src/cli/read-serve-empty.test.ts src/cli/resolve.test.ts src/read/owner-report-contract.test.ts`
  - [ ] `bash scripts/check-no-python.sh`
  - [ ] Acceptance replay outside CI, on a disposable copy of this repository's journal of reference with its dry run applied: recompute the expected counts with `node scripts/owner-table-measure.mjs`, render in default mode, and attach both outputs. Counts that differ from annex C because the journal moved are stated, not adjusted.
  - [ ] Replay on the main journals of the measurement list: every journal renders or refuses with one of the four gates, none prints a reserved sentence, and the 8 decisions without options appear `à instruire`.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T1-a to T1-t green on Node 22 and 24; `--strict` output byte-identical to the frozen file; no reserved sentence in any output; `--status-table` byte-identical before and after.
