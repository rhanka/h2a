# Feature: Track owner table — delivery lot 4a (identities, index, journal outside the repository)

## Objective

- [ ] Every folder has a journal: a project is recognised by its git identity, a folder outside git by a folder identity, and a local index designates the journal of reference.
- [ ] A folder without a journal gets one outside the repository at its first inscription; nothing is added to the repository.
- [ ] `track journal which` explains which journal is retained and why.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V4, V5, V10) and 6, tests T4a-a to T4a-i.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`. Consulted: `cond`, `cyber`.
- [ ] Prerequisite: lot 1 is merged. T4a-a and T4a-f use the `track demand raise` verb of lot 2: this lot may start in parallel with lot 2 and rebases when lot 2 merges.
- [ ] `packages/track/src/workspace-id.ts` is not modified: the `ws:` conformance vectors must pass unchanged. A folder outside git receives a `dir:` identity computed in a new module.
- [ ] Designation is never guessed. No rule of the form « first copy seen » exists anywhere in this lot.
- [ ] A read creates neither a journal nor an index entry. The index is written by inscription and by the designation commands only.
- [ ] When several copies of a project are known and none is designated, nothing is inscribed into a copy.
- [ ] The state directory and its files are created with modes 0700 and 0600.
- [ ] No Track command of this lot imports, spawns or requires h2a (spec V10).
- [ ] The resolver of this lot serves the owner table, `track demand raise` and the `journal` commands. Existing verbs keep `resolveTrackDir` (spec DS-6, open question OQ-1).
- [ ] Out of scope, do not start: the queue and capture (lot 3a); the write policy (lot 3a); the call from a conductor's claim (lot 4b); sessions on another machine.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; tests use `mkdtemp` and a temporary `TRACK_STATE_HOME`; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/track/src/journal/**`
  - `packages/track/src/cli/journal-reference.ts`
  - `packages/track/src/cli/journal-reference.test.ts`
  - `packages/track/src/cli/journal.ts`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/state-home.ts`
  - `packages/track/src/track.ts`
  - `packages/track/src/report/owner-table-qualified.ts`
  - `packages/track/src/report/owner-table-qualified.test.ts`
  - `packages/track/src/index.ts`
  - `plan/06-BRANCH_track-owner-table-lot-4a-journal-of-reference.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/workspace-id.ts`
  - `packages/track/src/cli/resolve.ts`
  - `packages/track/src/events/**`
  - `packages/h2a/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/track/src/mcp/**` (only to make the read tool use the new resolver for the owner table)
  - `packages/track/skills/track-operation/SKILL.md` (only to name the `journal` commands; no rule specific to h2a)
  - `packages/track/README.md`
- **Exception process**:
  - Declare exception ID `BR806-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `cyber`: review the content of the index (absolute paths of journals on the machine) and the file modes before merge.
- [ ] `attention` to `cond`: a project with several separate clones needs one designation; until it is made, each clone reads its own copy and says `copie non désignée`.
- [ ] `attention` to `arch`: two distinct projects grown from one git history share a project identity (spec annex E). If a real case is met, stop and report; do not invent a tie-break.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (identity, index and resolver are one mechanism)
- [ ] **Multi-branch**
- Rationale: each piece is only testable through the resolver.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec section 6; read `packages/track/src/workspace-id.ts` (do not modify), `packages/track/src/cli/journal-reference.ts` as lot 1 left it, `packages/track/src/state-home.ts`, `packages/track/src/events/lock.ts` (reuse `withFileLock` for the index).
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build -w @sentropic/track`.
  - [ ] Baseline green: `npm test -w @sentropic/track -- src/cli/journal-reference.test.ts src/cli/resolve.test.ts`, and `npm test -w @sentropic/track -- src/workspace-id.test.ts`.
  - [ ] Tests (red first):
    - [ ] `T4a-a` — `packages/track/src/journal/off-repo-journal.test.ts` — in a folder without a journal, git or not, an inscribed demand is displayed and git status is unchanged, with no h2a on the machine (T4a-a)
    - [ ] `T4a-b` — `packages/track/src/journal/identity.test.ts` — two clones of one repository share the project identity (T4a-b)
    - [ ] `T4a-c` — `packages/track/src/journal/designation.test.ts` — with one designated journal both clones render the same table (T4a-c)
    - [ ] `T4a-d` — `packages/track/src/journal/designation.test.ts` — with several copies and none designated the table says copie non désignée and nothing is inscribed into a copy (T4a-d)
    - [ ] `T4a-e` — `packages/track/src/journal/identity.test.ts` — a folder outside git gets a dir identity and the ws conformance vectors pass unchanged (T4a-e)
    - [ ] `T4a-f` — `packages/track/src/journal/satellite.test.ts` — an attached satellite takes the next numbers of its conductor journal, is read on the entire journal and carries its origin label (T4a-f)
    - [ ] `T4a-g` — `packages/track/src/journal/which.test.ts` — journal which prints the identity, each step tried and the journal retained (T4a-g)
    - [ ] `T4a-h` — `packages/track/src/journal/designation.test.ts` — a read creates neither a journal nor an index entry (T4a-h)
    - [ ] `T4a-i` — `packages/track/src/journal/designation.test.ts` — the first copy seen is never designated on its own (T4a-i)
  - [ ] Test repositories are created with `git init` in `mkdtemp` folders; clones with `git clone` of those; each test sets `TRACK_STATE_HOME` to a temporary folder.
  - [ ] T4a-a asserts `git status --porcelain` is empty in the folder before and after, and that the journal exists only under the temporary state home.
  - [ ] T4a-h snapshots the state home and the folder before and after `report --owner-table`, `journal which` and `decision ls`.
  - [ ] Red today: no identity for a folder outside git, no index, no `journal` command.
  - [ ] Lot gate:
    - [ ] The nine tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Identities**
  - [ ] Create `packages/track/src/journal/identity.ts`: `projectIdentity(cwd)` returns `computeDurableWorkspaceId(<sorted root commits>, '')`, imported from `workspace-id.ts`; `folderIdentity(dir)` returns `dir:` followed by the SHA-256 hex digest of the real path; `identityOf(cwd)` returns the project identity inside git, else the folder identity of exactly that directory.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/journal/identity.test.ts src/workspace-id.test.ts` — T4a-b, T4a-e green; conformance vectors untouched.

- [ ] **Lot 2 — Index**
  - [ ] Create `packages/track/src/journal/index-store.ts`: `journals.json` in the state home, schema version 1; per identity: `reference` (journal path, who designated it, when), `copies` (path, first seen, last seen), `attachedTo` (the conductor identity of a satellite).
  - [ ] Reads never create the file or its folder. Writes go through `withFileLock` on the index path and replace the file atomically; folder mode 0700, file mode 0600.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/journal/designation.test.ts` — the store unit cases green.

- [ ] **Lot 3 — Resolver steps 3 to 6**
  - [ ] Extend `resolveJournalOfReference`: after the worktree rewrite of lot 1, look up the identity in the index — a designated journal wins (step 3); else an attachment resolves to the conductor's designated journal (step 4); else the nearest-ancestor `.track` (step 5), announced `copie non désignée (N copies connues)` when the index knows several copies and none is designated; else the journal outside the repository at `journals/<identity digest>/.track` under the state home (step 6), reported as absent until it is created.
  - [ ] The result carries a flag « inscription allowed »: false for a non-designated copy among several.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/cli/journal-reference.test.ts src/journal/designation.test.ts` — T4a-c, T4a-d (read part), T4a-h, T4a-i green; T1-g still green.

- [ ] **Lot 4 — Inscription through the resolver**
  - [ ] Make `track demand raise` resolve its journal with this resolver: it creates the journal outside the repository when step 6 is reached, records the copy it wrote to in the index, and refuses with a message naming `track journal designate` when inscription is not allowed.
  - [ ] The demand's `workspace` defaults to the identity of the folder it is raised from.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/journal/off-repo-journal.test.ts src/journal/designation.test.ts` — T4a-a, T4a-d (write part) green.

- [ ] **Lot 5 — Commands and reader labels**
  - [ ] Create `packages/track/src/cli/journal.ts` and dispatch `journal` in `cli/index.ts` before store resolution: `journal which [--format json]`, `journal designate <dir> [--by <name>]`, `journal attach --to <dir>`, `journal detach`.
  - [ ] `designate` and `attach` are the only commands that persist a designation; both print what they recorded.
  - [ ] Reader: the header uses `journal désigné`, `satellite de <label>`, `copie non désignée (N copies connues)` and `journal hors dépôt`; a row whose demand was raised from another identity shows that identity's label.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/journal/which.test.ts src/journal/satellite.test.ts src/report/owner-table-qualified.test.ts` — T4a-f, T4a-g green.

- [ ] **Lot 6 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/journal src/cli/journal-reference.test.ts src/cli/resolve.test.ts src/report/owner-table-qualified.test.ts`
  - [ ] `bash scripts/check-no-python.sh`
  - [ ] Replay: on a throwaway state home, from two clones of a throwaway repository, the measurement of spec annex C (A4) shows the same journal retained from both once designated.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T4a-a to T4a-i green on Node 22 and 24; `resolve.test.ts` and `workspace-id.test.ts` unchanged; no file created by any read.
