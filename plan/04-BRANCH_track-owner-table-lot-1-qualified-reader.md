# Feature: Track owner table — delivery lot 1 (qualified reader)

## Objective

- [ ] The owner table renders everything it knows and qualifies what it lacks: a gap about one element no longer refuses the whole table.
- [ ] Only four gates still refuse entirely (integrity, number registry, unproven status, no readable source); `--strict` keeps the refusal of the lot-0 reader.
- [ ] The table names the journal it read, reads the main checkout from a linked worktree, never looks above the temporary root, and never emits the reserved absolute sentences.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3, 4, 5, 6.1 (steps 1, 2, 5, 7 and the ceiling), annexes B and F, tests T1-a to T1-u.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`, and `harness` for the skill text. Consulted: `cond`.
- [ ] Prerequisite: lot 0 is merged. The first commits of this branch build the fixture and freeze the lot-0 reader's refusal before any reader change (Lot 0 below).
- [ ] The strict audit `auditOwnerTable` keeps every code, every message and their order. The qualified reader is a layer over it, not a rewrite of it.
- [ ] Every owner-facing string is one of annex F of the spec, with its order, its plural forms and its date format. A string that is not in that annex is not rendered; if one is missing, stop and report it rather than invent it.
- [ ] The reader never rewrites a text, never invents a number, a cause or a recommendation, and never prints a masked text.
- [ ] A read writes nothing: no journal, no index entry, no lock, no side file (spec V4).
- [ ] **Temporary-root ceiling.** The new resolver never looks above the temporary root when it starts under it: git discovery is capped there and the ancestor walk stops there, exactly as `cli/resolve.ts:56-66` and `workspace-id.ts:43-54` do. Tests of this lot run in temporary folders that sit inside a checkout: without the ceiling they would resolve to that checkout's real journal.
- [ ] Out of scope, do not start: the index, designation, satellites and the journal outside the repository (lot 4a); any write verb (lot 2); the queue and the capture state per CLI (lot 3a); stable decision numbers (lot 2).
- [ ] The new resolver serves `report --owner-table` only in this lot. Every other verb keeps `resolveTrackDir` (spec DS-6).
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
  - `packages/track/src/report/owner-table-strings.ts`
  - `packages/track/src/report/owner-table-qualified.test.ts`
  - `packages/track/src/report/owner-table.test.ts`
  - `packages/track/src/report/legacy-like-journal.fixture.test.ts`
  - `packages/track/src/report/__fixtures__/**`
  - `packages/track/src/read/commands.ts`
  - `packages/track/src/read/contract.ts`
  - `packages/track/src/cli/journal-reference.ts`
  - `packages/track/src/cli/journal-reference.test.ts`
  - `packages/track/src/cli/events-contains.ts`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/cli/desync.ts`
  - `packages/track/src/cli/read-serve-empty.test.ts`
  - `packages/track/src/state-home.ts`
  - `packages/track/src/state-home.test.ts`
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `plan/04-BRANCH_track-owner-table-lot-1-qualified-reader.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/events/**`
  - `packages/track/src/cli/resolve.ts`
  - `packages/track/src/workspace-id.ts`
  - `packages/track/src/mcp/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/track/src/report/validated-report-shape.test.ts`, `packages/track/src/report/skill-truncation-warning.test.ts`, `packages/h2a/test/owner-gate-skill.test.js`
  - `packages/track/src/read/owner-report-contract.test.ts` (only if it pins an owner-table output)
  - `packages/h2a/fixtures/native-host-catalog.json` (never hand-edited)
  - `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md` (only to correct a statement the build proves wrong, or to add a string missing from annex F, with the evidence)
- **Exception process**:
  - Declare exception ID `BR804-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `cond`: the default output of `report --owner-table` changes for every session; sessions that need the old all-or-nothing behaviour pass `--strict`.
- [ ] `attention` to `cond`, before this repository's dry run is applied: its command file must drop the quotation marks around reconstructed demands; the reader labels them `(non capté)` either way (T1-r).
- [ ] `attention` to `harness`: the skill section on the owner table is rewritten (Lot 8).
- [ ] `attention` to `arch`: report any string the build needs that annex F does not give.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one reader; its layers are tested against the same fixtures)
- [ ] **Multi-branch**
- Rationale: the strict path, the qualified path and the header share fixtures and one frozen expectation.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline, fixture, frozen expectation and red tests**
  - [ ] Read spec sections 3 to 6, annexes B and F; read `owner-table.ts` in full; `packages/track/src/read/contract.ts` lines 1258-1272; `packages/track/src/read/commands.ts` lines 484-499 (where the JSON form is assembled); `packages/track/src/cli/index.ts` lines 1339-1530 and 1854-1882; `packages/track/src/cli/desync.ts`; `packages/track/src/cli/resolve.ts`; `packages/track/src/cli/events-contains.ts`.
  - [ ] Create the worktree under `tmp/worktrees/` from an `origin/main` that contains lot 0; `npm ci`; `npm run build -w @sentropic/track`.
  - [ ] Fixture as data. Create `packages/track/src/report/legacy-like-journal.fixture.test.ts`: a test file (so it is neither compiled into the package nor published) holding a builder that, through the `Track` facade with an injected clock and an injected identifier generator and, for legacy shapes, direct `EventStore.appendCommand` events, produces a journal with 14 numbered demands, 13 owner-request items that never received a number, and 18 unsettled decisions — 16 attached to no row, 15 without a dossier link, 1 deferred without options — one of which holds 30 dossier questions without an answer.
  - [ ] Commit the builder's output as data under `packages/track/src/report/__fixtures__/legacy-like-journal/` (`events.jsonl`, `head.json`); the same test file asserts the committed data equals what the builder produces. Other tests copy that folder into a temporary directory.
  - [ ] Freeze the lot-0 refusal: run the unchanged reader on a copy of the fixture with `--now` and `--commit` fixed and with `TRACK_OWNER_POLICY_FILE` and `TRACK_OWNER_REPORT_POLICY` unset; save stderr verbatim as `packages/track/src/report/__fixtures__/owner-table-strict-refusal.txt`; commit builder, data and file before any reader change.
  - [ ] Tests (red first), all in the files named; each title ends with its identifier:
    - [ ] `T1-a` — `packages/track/src/report/owner-table-qualified.test.ts` — renders 14 rows, 13 demands to attach, 18 decisions of which 16 outside a demand, 15 without dossier and 1 to instruct, and counts 30 dossier questions (T1-a)
    - [ ] `T1-b` — `packages/track/src/report/owner-table-qualified.test.ts` — strict mode refuses with the frozen lot-0 output, byte for byte (T1-b)
    - [ ] `T1-c` — `packages/track/src/report/owner-table-qualified.test.ts` — a journal with no demand and no decision renders its header and the partial-scope sentence with exit 0, and refuses no-owner-demands under strict (T1-c)
    - [ ] `T1-d` — `packages/track/src/report/owner-table-qualified.test.ts` — a pending or deferred decision without options is listed to instruct, without number or letters, outside the reply line (T1-d)
    - [ ] `T1-e` — `packages/track/src/report/owner-table-qualified.test.ts` — an OWNER GATE decision is rendered to answer in its session, without number, outside the reply line, and never refused under strict (T1-e)
    - [ ] `T1-f` — `packages/track/src/report/owner-table-qualified.test.ts` — an integrity finding refuses in every mode; a desynchronisation finding alone renders and is counted, and refuses under strict (T1-f)
    - [ ] `T1-g` — `packages/track/src/cli/journal-reference.test.ts` — from a linked worktree the table reads the main checkout journal, names it, and reports events held only by the local copy (T1-g)
    - [ ] `T1-h` — `packages/track/src/report/owner-table-qualified.test.ts` — a masked cell never shows the offending text and no text is rewritten (T1-h)
    - [ ] `T1-i` — `packages/track/src/report/owner-table-qualified.test.ts` — a journal whose demands are all archived renders zero active demand and the archived count (T1-i)
    - [ ] `T1-j` — `packages/track/src/report/owner-table-qualified.test.ts` — the reserved absolute sentences are emitted by no mode on any fixture (T1-j)
    - [ ] `T1-k` — `packages/track/src/report/owner-table-qualified.test.ts` — document references are resolved against the journal folder, not the current directory (T1-k)
    - [ ] `T1-l` — `packages/track/src/state-home.test.ts` — the private-term policy is found beside the journal, then in the user state directory (T1-l)
    - [ ] `T1-m` — `packages/track/src/report/owner-table-qualified.test.ts` — each header counter equals the number of elements it names, and overlapping qualifiers are not summed (T1-m)
    - [ ] `T1-n` — `packages/track/src/report/owner-table-qualified.test.ts` — a vanished number, a number from 1 up held twice or a hole below the highest number refuses in every mode, and rows without a number never trip that gate (T1-n)
    - [ ] `T1-o` — `packages/track/src/report/owner-table-qualified.test.ts` — a row that would show done or on-track without its witness refuses in every mode (T1-o)
    - [ ] `T1-p` — `packages/track/src/report/owner-table-qualified.test.ts` — rendering leaves the journal folder byte-identical and creates no file anywhere (T1-p)
    - [ ] `T1-q` — `packages/track/src/report/owner-table-qualified.test.ts` — the Markdown form prints no decision identifier and the JSON form carries it (T1-q)
    - [ ] `T1-r` — `packages/track/src/report/owner-table-qualified.test.ts` — a text that was not captured is labelled non capté and never quoted (T1-r)
    - [ ] `T1-s` — `packages/track/src/cli/read-serve-empty.test.ts` — with no journal and no active capture the table refuses as not covered (T1-s)
    - [ ] `T1-t` — `packages/track/src/report/owner-table-qualified.test.ts` — every row-level gap is flagged on its own row and cell and counted, and the row stays (T1-t)
    - [ ] `T1-u` — `packages/track/src/cli/journal-reference.test.ts` — a folder under the temporary root never resolves to a journal above that root (T1-u)
  - [ ] Red today, by test: T1-a, T1-c, T1-d, T1-e, T1-h, T1-i, T1-m, T1-q, T1-r, T1-t — the reader refuses the fixture instead of rendering it. T1-f — a head record that disagrees with the stream, then an event whose content no longer matches its hash, both render with exit 0 (spec finding F-1). T1-g — the worktree copy is read. T1-j — a fixture with one numbered demand and no decision prints both reserved strings. T1-k — validation resolves against the current directory. T1-l — only the journal folder is searched. T1-s — the refusal does not say « non couvert ». T1-u and T1-p fail on the absence of the new resolver.
  - [ ] T1-b passes from the start on the frozen file: it pins what must not move.
  - [ ] T1-n and T1-o are written against the default-mode entry point, so they fail on its absence; once it exists they are proven by mutation instead of by a red start: classifying a registry check as per-element must turn T1-n red, and removing the unproven-status gate must turn T1-o red; restore after each. T1-o builds its view by hand, as the existing test `refuses rendering on every one of the 7 blocking gates` does: the projection never yields a done or on-track row without a witness.
  - [ ] T1-n also renders the fixture's 13 rows without a number and asserts exit 0: today those rows all carry 0 and trip the duplicate and ordering checks (`owner-table.ts:534-577`).
  - [ ] T1-j is a sweep: it renders every fixture of the file in default and strict mode, in `md`, `text` and `json`, and asserts neither `Aucune décision en attente` nor `Réponse : aucune décision en attente` occurs.
  - [ ] T1-t is table-driven over annex B: one case per check classified E3, each asserting exit 0, the row present, the flag on the cell named, and the header count.
  - [ ] T1-u creates, under the temporary root, a folder outside git and a throwaway repository with a linked worktree, and asserts that no resolution returns a path outside the temporary root — in particular never the journal of the checkout the tests run in.
  - [ ] Lot gate:
    - [ ] Every test above fails for its stated reason, except T1-b; outputs saved.

- [ ] **Lot 1 — Attribute each violation to its element**
  - [ ] In `owner-table.ts`, add four additive fields to `OwnerTableGateViolation` and set them on every `violations.push`: `check` (a stable identifier per check of annex B, for example `registry.duplicate`, `registry.missing`, `registry.hole`, `status.unproven`, `row.unnumbered`, `decision.no-row`, `decision.to-instruct`, `decision.no-dossier`, `text.commit-hash`, `text.internal-id`, `text.jargon`, `text.reserved`), `rowId` (the `id` of the row), `cell` (`request`, `done`, `todo`, `eta`, `decision`, `status`, `stage`), and `decisionId`.
  - [ ] Rows share numbers — every row without a number carries 0 and the lots of a demand carry its number — so the row number alone cannot attribute a gap: every later step uses `rowId`.
  - [ ] Change no `code`, no `message`, no order of violations: the refusal text stays byte-identical.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table.test.ts src/report/owner-table-qualified.test.ts` — T1-b green; every existing test green.

- [ ] **Lot 2 — The four gates that still refuse**
  - [ ] Add the codes `journal-integrity` and `document-desync` to `OwnerTableGateCode`. On the owner-table path (`read/commands.ts` `ownerTableText`, fed by `read/contract.ts`), run `validate(events, readHead(eventsPath))` and refuse with `- [journal-integrity] <n> finding(s): <kinds>` in every mode; turn an unparsable line into the same refusal.
  - [ ] In `owner-table-qualified.ts`, classify from the `check` identifier and the row's number: a registry check concerning a number from 1 up is G2; `status.unproven` is G3; every check tripped by a row whose number is not a positive integer — not positive, duplicate of 0, ordering — is E1. Any violation in G1 to G3 refuses; nothing else does in default mode.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts` — T1-f (integrity part), T1-n, T1-o green, each with its mutation proof; T1-b still green.

- [ ] **Lot 3 — Journal of reference for the table**
  - [ ] Create `packages/track/src/cli/journal-reference.ts` with `resolveJournalOfReference({ cwd, flag, env })` returning the journal folder or none, how it was resolved (`--track-dir`, `TRACK_DIR`, `dépôt principal`, `dossier`), a label, and, when the start folder has its own copy, the number of its events absent from the journal retained.
  - [ ] Ceiling first: when `cwd` is under the temporary root, run every git command with discovery capped at that root and stop the ancestor walk at that root.
  - [ ] Step 2: detect a linked worktree as `workspace-id.ts:78-86` does (`--git-dir` differs from `--git-common-dir`), take the main checkout from the first entry of `git worktree list --porcelain`, and continue from there. The worktree's own copy is never read as the journal: when the main checkout has no journal, the result is « none » and the refusal says that the main checkout has no journal.
  - [ ] Count local events absent from the reference with the event-identifier containment of `cli/events-contains.ts`: export the function that file keeps private and call it; do not write a second one.
  - [ ] Wire `cmdReport` so that `--owner-table` uses this resolver; leave every other verb on `resolveTrackDir`.
  - [ ] No journal and no active capture: keep the existing refusal and make its message say « non couvert » and why.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/cli/journal-reference.test.ts src/cli/resolve.test.ts src/cli/read-serve-empty.test.ts` — T1-g, T1-s, T1-u green; `resolve.test.ts` unchanged and green.

- [ ] **Lot 4 — Desynchronisation and policy lookup**
  - [ ] Make the owner-table path compute `desyncFindings(state, <folder that holds the journal>)`. Make `track validate` resolve against that same folder and record the change of behaviour in the pull request (spec DS-7, finding F-2).
  - [ ] Create `packages/track/src/state-home.ts`: `trackStateHome(env)` returns `TRACK_STATE_HOME`, else `sentropic/track` under `XDG_STATE_HOME`, else under `.local/state` of the home directory. It creates nothing.
  - [ ] Policy lookup order for the owner table: `--policy`, the two existing environment variables, `owner-report-policy.json` beside the journal, then the same file name in the state home. When none exists the motif `politique de termes privés absente` is rendered.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/state-home.test.ts src/report/owner-table-qualified.test.ts` — T1-k, T1-l and the desynchronisation part of T1-f green.

- [ ] **Lot 5 — Qualified sections**
  - [ ] Create `packages/track/src/report/owner-table-strings.ts`: every string of annex F as a named constant or a function of its counts, with the plural rule, the date format, the age clause, the label derivation and the display cut. No other file of the reader holds an owner-facing literal added by this lot.
  - [ ] In `owner-table-qualified.ts`, build the qualified view from the strict view and its violations: numbered rows stay in the table; rows of class E1 move to « À rattacher » with their date and what is missing.
  - [ ] Decisions: add the creation date, the count of unanswered dossier questions and the deferred mark to each listed decision (additive fields of the view). An OWNER GATE — recognised by its title prefix — is taken out before the strict audit, so it never produces a violation; its session name is the value of the first context line of the form `Target instance and session: <value>`, matched without regard to case. Every other decision is numbered, `hors demande`, `à instruire`, or several of these.
  - [ ] Row-level gaps (class E3) flag the cell named by `cell` on the row named by `rowId`, with the flag motif of annex F, and keep the row.
  - [ ] Text-gate hits mask the cell with the mask of annex F; the motif is chosen from the `check` identifier and never reveals the text.
  - [ ] Request cells follow the table « The Ta demande cell » of spec section 5: before lot 3a no demand is captured, so every text is followed by `(non capté)` and none is quoted.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts` — T1-a, T1-d, T1-e, T1-h, T1-i, T1-r, T1-t green.

- [ ] **Lot 6 — Header, scope and reserved sentences**
  - [ ] Create `packages/track/src/report/owner-table-scope.ts`: it evaluates conditions (a) to (f) of spec V1 and returns the motifs in the fixed order of annex F, each tagged scope or gap. Condition (f) is the constant false of decision DS-1; before lot 3a the capture motif is the single `captation inactive`.
  - [ ] Render the header lines of spec section 5, the sections, the decisions heading with its counts, and the partial-scope sentence with the scope motifs only, when no decision is listed.
  - [ ] Remove the two absolute strings from every rendering path: no mode emits them.
  - [ ] The `Réponse` line lists only numbered decisions that carry a recorded recommendation and is omitted otherwise.
  - [ ] JSON form, assembled in `read/commands.ts`: `kind`, `mode` (`default` or `strict`), `header` (label, resolution, last event, local-copy divergence), `scope` (`complete`, `motifs` with their kind), `rows` (the existing row fields plus `flags`, `masks`, `captured`), `toAttach`, `decisions` (with `id`, `ref` or null, `kind`, `qualifiers`, `createdAt`, `ageDays`, `deferred`, `openQuestionCount`, and `session` for an OWNER GATE), `gaps` (class, check, `rowId` or `decisionId`, cell), `counts`, `replyLine` or null. Markdown and text forms never print an identifier.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts` — T1-c, T1-j, T1-m, T1-q green.

- [ ] **Lot 7 — CLI wiring and migration of existing expectations**
  - [ ] In `cmdReport`: accept `--strict` only together with `--owner-table`. Default mode renders the qualified view with exit 0. Under `--strict`, any gap of classes E1 to E8 refuses with the strict audit's text — its codes, messages and order unchanged — followed by one `[document-desync]` line per desynchronisation finding; with no gap, `--strict` renders exactly what the default mode renders.
  - [ ] Existing expectations of a refusal on a per-element gap are refusals of the strict mode from now on: add `--strict` to their command lines and change nothing else in what they assert. This concerns the CLI cases of `owner-table.test.ts` near lines 2107, 2152, 2197, 2219 and 2245, the tests T0-a, T0-b and T0-c of lot 0, and any case of `read/owner-report-contract.test.ts` that expects such a refusal. List each migrated test in the commit message.
  - [ ] Existing expectations that pin an absolute string on a success path are updated to the partial-scope sentence; list each one in the commit message.
  - [ ] Print the existing policy notice on stderr in strict mode only; in default mode the motif carries it.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts src/read/owner-report-contract.test.ts` — T1-b, T1-p green; `--status-table` output unchanged.

- [ ] **Lot 8 — Skill**
  - [ ] Rewrite the owner-table section of `packages/h2a/skills/harness/track-report/SKILL.md` (lines 8-50): the header and what each part means, the sections, the four gates that refuse, `--strict` for conductors and CI, the rule that an answer is recorded by the identifier of the JSON form of the same rendering, and the rule never to recompose a refused table by hand.
  - [ ] Keep the sentences pinned by `owner-gate-skill.test.js`, `validated-report-shape.test.ts` and `skill-truncation-warning.test.ts`.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`; `npm run build`; `node --test packages/h2a/test/owner-gate-skill.test.js packages/h2a/test/install-skills-hosts.test.js`.

- [ ] **Lot 9 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts src/report/legacy-like-journal.fixture.test.ts src/cli/journal-reference.test.ts src/state-home.test.ts src/cli/read-serve-empty.test.ts src/cli/resolve.test.ts src/read/owner-report-contract.test.ts`
  - [ ] `bash scripts/check-no-python.sh`
  - [ ] Acceptance replay outside CI, on a disposable copy of this repository's journal of reference with its dry run applied: recompute the expected counts with `node scripts/owner-table-measure.mjs`, render in default mode, and attach both outputs. Counts that differ from annex C because the journal moved are stated, not adjusted.
  - [ ] Replay on the main journals of the measurement list: every journal renders or refuses with one of the four gates, none prints a reserved sentence, and the 8 decisions without options appear `à instruire`.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T1-a to T1-u green on Node 22 and 24; `--strict` output byte-identical to the frozen file; no reserved sentence in any output; `--status-table` byte-identical before and after; no test of this lot resolves a journal outside the temporary root.
