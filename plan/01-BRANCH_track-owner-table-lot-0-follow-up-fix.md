# Feature: Track owner table — delivery lot 0 (follow-up fix to the strict reader)

## Objective

- [x] Close the fail-open hole of the strict owner table: a pending or deferred decision without options is counted, so the table refuses instead of stating that nothing is pending.
- [x] Make every refusal message cite only commands that exist and run as written.
- [x] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, section 4 (class E5), annex C (A3), tests T0-a, T0-b, T0-c.

## Scope / Guardrails

- [x] Accountable: `track`. Responsible: `track`, and `harness` for the skill text. Consulted: `cond`.
- [x] The reader stays strict in this lot: any violation still refuses the whole table. The qualified rendering is lot 1.
- [x] Out of scope, do not start: the integrity refusal G1 (lot 1, T1-f), the per-element rendering, the journal of reference, any new `demand` verb (lot 2).
- [x] No new CLI flag, no new event type, no change to `--status-table` output.
- [x] All new text in English; owner-facing strings stay in French as they are today.
- [x] No Python and no perl anywhere. Node and TypeScript only.
- [x] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; tests use `mkdtemp` only; the folder is removed at the end.
- [x] No `git stash` in any form. Selective staging only, never a whole worktree.
- [x] No write to `.track/**` from this branch.
- [x] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [x] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [x] Run targeted test files only; the conductor runs the complete suite at integration.
- [x] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`; never merge `main` into the branch.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/track/src/report/owner-table.ts`
  - `packages/track/src/report/owner-table.test.ts`
  - `packages/track/src/cli/read-serve-empty.test.ts`
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `plan/01-BRANCH_track-owner-table-lot-0-follow-up-fix.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/events/**`
  - `packages/track/src/cli/resolve.ts`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/track/src/cli/index.ts` (only if a refusal message is assembled there)
  - `packages/track/src/report/validated-report-shape.test.ts`
  - `packages/track/src/report/skill-truncation-warning.test.ts`
  - `packages/h2a/test/owner-gate-skill.test.js`
  - `packages/h2a/fixtures/native-host-catalog.json` (never hand-edited; regenerated only by `scripts/generate-native-host-catalog.mjs` when the release procedure asks for it)
- **Exception process**:
  - Declare exception ID `BR801-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `harness`: the skill line that lists the blocking gates changes wording (one sentence); three tests read that skill file and must stay green.
- [ ] `attention` to `cond`: after this lot, violation counts of journals holding a decision without options rise by design; the figures of annex C, A1, are the counts before this lot.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one package, one reviewer, one test cycle)
- [ ] **Multi-branch**
- Rationale: two small changes in one file and its test file; no independent CI need.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline and red tests**
  - [x] Read the spec sections 3, 4 and annex C (A3), and `packages/track/src/report/owner-table.ts` lines 139-155, 506-526, 889-917 and 1317-1374.
  - [x] Create the worktree under the repository's ignored `tmp/worktrees/` folder from `origin/main`; run `npm ci` then `npm run build -w @sentropic/track`.
  - [x] Confirm the baseline is green: `npm test -w @sentropic/track -- src/report/owner-table.test.ts src/cli/read-serve-empty.test.ts`.
  - [x] Tests (red first), written before any change to the reader:
    - [x] `T0-a` — `packages/track/src/report/owner-table.test.ts` — refuses a numbered journal that still holds a pending or deferred decision without options (T0-a)
    - [x] `T0-b` — `packages/track/src/report/owner-table.test.ts` — refuses a journal whose numbered demands are all archived with its own message and never the absolute sentence (T0-b)
    - [x] `T0-c` — `packages/track/src/report/owner-table.test.ts` — every command quoted by a refusal message runs without a usage error (T0-c)
  - [x] T0-a fixture: one demand raised and numbered through the `Track` facade, then one legacy decision appended directly with `EventStore.appendCommand` as a `decision.created` event whose dossier is `{ context, options: [], qa: [] }`. The facade cannot create it: the write boundary refuses a dossier with fewer than two options (`model/decision.ts:141-197`). Repeat with the decision set to `deferred`.
  - [x] T0-a assertions: `runCli(['report', '--owner-table', '--format', 'md'])` returns 1; stderr contains `[invalid-decision]`; stdout is empty; neither `Aucune décision en attente` nor `Réponse : aucune décision en attente` appears in stdout or stderr.
  - [x] T0-a red evidence to keep in the pull request: today the same fixture returns 0 and prints both reserved strings (spec annex C, A3).
  - [x] T0-b: move the all-archived assertions out of the existing test `fails closed when a journal has zero owner-numbered demands, all demands archived, or orphan pending decisions, while keeping --status-table unchanged` (around line 2164) into the new named test; do not duplicate them. It is green before and after: it pins behaviour that must not regress.
  - [x] T0-c: for every exported refusal-message constant and formatter of `owner-table.ts` (`OWNER_TABLE_NO_DEMANDS_MESSAGE`, `OWNER_TABLE_ALL_ARCHIVED_MESSAGE`, `formatOwnerTableNoJournalMessage`), extract each backticked fragment starting with `track `, substitute placeholders (`<id>` and `<demandId>` by the identifier of a raised, still unnumbered demand, `<n>` by the next free number, `<text>` by a short text, `<file.jsonl>` by a one-line `demand.raise` fixture, `<w>` by `ws`, `<dossier>` by the temporary journal folder), run it through `runCli` on a fresh journal, and assert the exit code is 0. The substitution table lives in the test and fails on a placeholder it does not know, so a message that gains a new placeholder cannot pass unnoticed.
  - [x] T0-c red evidence: `track demand raise` exits 2 (usage) and `track demand number <id> <n>` exits 1 (`missing required --number`).
  - [x] Lot gate:
    - [x] T0-a and T0-c fail for the stated reason; T0-b passes; the three outputs are saved for the pull request.

- [x] **Lot 1 — Count decisions without options**
  - [x] In `projectOwnerTable` (`owner-table.ts`, the loop near lines 1317-1330), stop excluding an unsettled decision whose dossier has no options: keep the exclusion of settled decisions and of owner-pause deferrals only.
  - [x] Build the listed decision from `d.dossier?.options ?? []` so a legacy dossier without an `options` array cannot throw; it is listed with zero options and an empty recommended letter.
  - [x] Change nothing in `auditOwnerTable`: the existing check `must carry a question, at least 2 options with consequences, and a valid recommendation` now fires on that decision and refuses.
  - [x] Update the one existing test that pins positional decision references on this repository's journal: `Round 4 & Round 5: real .track 5 blueDossierIds & D17 base-26 optionLetter…` (near line 1210). The journal's only unsettled decision without options is the earliest unsettled one, so every reference moves by one: `['D2', 'D8', 'D9', 'D12']` (near line 1245) becomes `['D3', 'D9', 'D10', 'D13']` and `D17` (near line 1251) becomes `D18`. Confirm the values by running the test before editing them, and state the shift in the commit message.
  - [x] The replay test `replays the real .track log in read-only mode…` (near line 756) asserts row counts and violation codes only: it stays as it is.
  - [x] Lot gate:
    - [x] `npm run typecheck`
    - [x] `npm test -w @sentropic/track -- src/report/owner-table.test.ts` — T0-a green, T0-b green; the only other expectation changed is the one-step shift of the references named above.
    - [x] `npm test -w @sentropic/track -- src/report/velocity-eta.test.ts src/read/owner-report-contract.test.ts` — unchanged and green (they share the reader).

- [x] **Lot 2 — Refusal messages cite runnable commands**
  - [x] Rewrite `OWNER_TABLE_NO_DEMANDS_MESSAGE` (`owner-table.ts:139-143`) so it cites only: `track ingest <file.jsonl> --workspace <w>` for a `demand.raise` line, `track demand number <demandId> --number <n>`, and `track report --status-table`.
  - [x] Keep the code `no-owner-demands` and the leading French sentence unchanged; only the parenthesis that names commands changes.
  - [x] Update the pinned copies of that message in `owner-table.test.ts` (near lines 2080-2087) and in `packages/track/src/cli/read-serve-empty.test.ts` if it quotes the message.
  - [x] Lot gate:
    - [x] `npm test -w @sentropic/track -- src/report/owner-table.test.ts src/cli/read-serve-empty.test.ts` — T0-c green.

- [x] **Lot 3 — Skill wording**
  - [x] In `packages/h2a/skills/harness/track-report/SKILL.md`, item 7 of the owner-table section (blocking gates, near lines 41-50): add that a pending or deferred decision without options refuses the table, and replace any command the skill quotes for recording demands by the commands of Lot 2.
  - [x] Lot gate:
    - [x] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`
    - [x] `npm run build` then `node --test packages/h2a/test/owner-gate-skill.test.js packages/h2a/test/install-skills-hosts.test.js`

- [x] **Lot 4 — Final validation**
  - [x] `npm run typecheck`
  - [x] `npm test -w @sentropic/track -- src/report/owner-table.test.ts src/cli/read-serve-empty.test.ts src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`
  - [x] `bash scripts/check-no-python.sh`
  - [x] Replay measurement A3 of the spec with `node scripts/owner-table-measure.mjs --track-bin packages/track/dist/cli/bin.js --journal <folder> --a3 <the same> --scratch <lane folder>`. The journal must hold no `demand.*` event, at least one unsettled decision without options, and no other gap — otherwise the script answers `not observable`: write the fixture of T0-a, without its demand, to a folder of the lane and use it. Expected: `Hole reproduced` reads **no (the table now refuses because of that decision)** and `Commands quoted by the refusal message that fail as written` reads **0 of N**. Attach the output to the pull request.
  - [ ] Open the pull request in English with the red and green evidence; follow CI to green; do not merge.
  - [x] Acceptance criteria: T0-a, T0-b and T0-c green on Node 22 and 24; the A3 replay no longer reproduces the hole; `--status-table` output byte-identical before and after on the fixtures of `owner-report-contract.test.ts`.
