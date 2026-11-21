# Feature: Track owner table — delivery lot 5a (adoption tool: dry run, then application)

## Objective

- [ ] A conductor can bring an existing journal to the point where the owner table passes `--strict`, through a tool that first shows every write it would make, then applies them.
- [ ] The tool never closes a decision, never invents an owner text, and never presents a reconstructed demand as captured.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V7), 4, 5 and 8 (lots 5a and 5b), annex B, tests T5a-a to T5a-e.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`. Consulted: `cond`.
- [ ] Prerequisite: lot 1 is merged. The numbering steps use lot 2's verbs when they are available; until then the dry run lists them as pending on lot 2.
- [ ] This lot builds the tool. Running it on a real journal is lot 5b, an operation of that journal's conductor, with the owner arbitrating what the tool cannot decide.
- [ ] The dry run writes nothing: no journal, no index, no side file.
- [ ] Every proposed write is either mechanical — derivable from the journal alone — or marked `to-decide`. A `to-decide` entry is never applied until a human-supplied value resolves it in the plan file.
- [ ] No decision is settled, withdrawn or archived by this tool without a recorded owner answer or a traced replacement: it only proposes, and the existing decision verbs record.
- [ ] A demand reconstructed from an old item is inscribed through the ordinary `cli` transport, never with the `capture` provenance: the reader therefore labels it `(non capté)` and never quotes it.
- [ ] Application is idempotent: each write carries an idempotency key derived from the plan entry.
- [ ] On an exclusive journal, application is refused unless the holder runs it.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; tests use `mkdtemp` only; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/track/src/adopt/**`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/cli/adopt.ts`
  - `packages/track/src/report/__fixtures__/**`
  - `packages/track/src/report/legacy-like-journal.fixture.test.ts`
  - `packages/track/src/index.ts`
  - `packages/track/README.md`
  - `plan/11-BRANCH_track-owner-table-lot-5a-adoption-tool.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/report/owner-table.ts`
  - `packages/track/src/events/**`
  - `packages/h2a/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/track/src/track.ts` (only if a facade method is missing for a mechanical write)
  - `packages/track/src/report/owner-table-qualified.ts` (read to reuse its classification; changed only to export it)
  - `packages/track/skills/track-operation/SKILL.md` (only to name the `adopt` command; no rule specific to h2a)
- **Exception process**:
  - Declare exception ID `BR811-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `cond`: the dry run of this repository's journal is the first real input; its list of `to-decide` entries is what the owner arbitrates in lot 5b.
- [ ] `attention` to `arch`: if the tool cannot bring a fixture to `--strict` without settling a decision, stop and report which gate forces it; do not add a way around the gate.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one tool, one fixture)
- [ ] **Multi-branch**
- Rationale: the dry run and the application are two halves of one plan format.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec sections 4, 5 and annex B; read the fixture data under `packages/track/src/report/__fixtures__/legacy-like-journal/`, its builder in `packages/track/src/report/legacy-like-journal.fixture.test.ts`, and the qualified reader of lot 1; read `packages/track/src/track.ts` for the existing verbs that number, summarise and archive a demand and that attach a dossier to a decision.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build -w @sentropic/track`.
  - [ ] Tests (red first):
    - [ ] `T5a-a` — `packages/track/src/adopt/adopt.test.ts` — the dry run writes nothing and lists every write it would make (T5a-a)
    - [ ] `T5a-b` — `packages/track/src/adopt/adopt.test.ts` — applying a plan twice writes nothing the second time (T5a-b)
    - [ ] `T5a-c` — `packages/track/src/adopt/adopt.test.ts` — a reconstructed demand is inscribed as not captured and is never quoted (T5a-c)
    - [ ] `T5a-d` — `packages/track/src/adopt/adopt.test.ts` — after a fully resolved plan is applied the legacy-like journal passes the strict table (T5a-d)
    - [ ] `T5a-e` — `packages/track/src/adopt/adopt.test.ts` — no decision is settled or archived without a recorded owner answer or a traced replacement (T5a-e)
  - [ ] T5a-a fingerprints the journal folder and the state home before and after the dry run.
  - [ ] T5a-e applies a plan in which a `to-decide` entry is left unresolved and asserts the application refuses that entry and names it; it then asserts the journal holds no new settling event.
  - [ ] Red today: no `adopt` command exists.
  - [ ] Lot gate:
    - [ ] The five tests fail on absence; outputs saved.

- [ ] **Lot 1 — Dry run**
  - [ ] Create `packages/track/src/adopt/plan.ts`: from a journal, build the adoption plan — a JSON document listing, per gap of the qualified reader, one entry with its class, the element concerned, the proposed write and its kind, `mechanical` or `to-decide`.
  - [ ] Mechanical entries: give the next number to a demand that has none; turn an owner-request item without a number into a numbered demand, inscribed through the `cli` transport; give a stable number to a structured decision that has none (class E9, once lot 2 is merged).
  - [ ] `to-decide` entries, each with the question a human must answer: the row a decision outside any demand belongs to; the options and recommendation of a decision to instruct; the dossier link of a decision; the cause of a blocked row; the rewrite of a masked text.
  - [ ] Add `track adopt plan [--out <file>]` in `packages/track/src/cli/adopt.ts`, dispatched as a read: it prints the plan and writes nothing but the output file when `--out` is given outside the journal folder.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/adopt/adopt.test.ts` — T5a-a green.

- [ ] **Lot 2 — Application**
  - [ ] Create `packages/track/src/adopt/apply.ts` and `track adopt apply <plan.json>`: it re-derives the plan from the journal, refuses a plan that no longer matches it, applies each resolved entry through the existing facade verbs with an idempotency key built from the entry, and refuses every unresolved `to-decide` entry by name.
  - [ ] An entry that would settle, withdraw or archive a decision is not a kind this tool knows: the plan format has no such entry.
  - [ ] Output: one line per entry, `applied`, `already applied` or `refused: <reason>`; exit 1 when at least one entry is refused.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/adopt/adopt.test.ts` — T5a-b, T5a-c, T5a-e green.

- [ ] **Lot 3 — Strict after adoption**
  - [ ] Extend the fixture with a fully resolved plan and assert `report --owner-table --strict` exits 0 on the adopted journal.
  - [ ] Document the command in `packages/track/README.md`: dry run first, resolve, apply; what the tool never does.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/adopt/adopt.test.ts src/report/owner-table-qualified.test.ts` — T5a-d green; T1-b still green.

- [ ] **Lot 4 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/adopt src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts`
  - [ ] `bash scripts/check-no-python.sh`
  - [ ] Replay outside CI: `track adopt plan` on a disposable copy of this repository's journal of reference; attach the plan and the count of `to-decide` entries; apply nothing.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T5a-a to T5a-e green on Node 22 and 24; the dry run leaves every fingerprint unchanged; no settling event is ever written by the tool.
