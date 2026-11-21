# Feature: Track owner table — delivery lot 2 (native write: numbered demand in one command, stable decision number)

## Objective

- [ ] One Track command creates a demand and gives it the next number, atomically and idempotently.
- [ ] A decision receives a stable number at creation and keeps it when another decision is settled; an OWNER GATE never receives one.
- [ ] Both new commands write into the journal of reference, never into the copy of a linked worktree.
- [ ] The h2a facade exposes the `demand` verb.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V5, V11), 4 (G2, E9), 5, 6.1 and 6.2, tests T2-a to T2-h.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`, and `plugins` for the h2a facade. Consulted: `cond`.
- [ ] Prerequisite: lot 1 is merged.
- [ ] A demand and its number land in one command batch. No state exists in which a demand is created and its number is not: that state would open a hole in the registry, which refuses the whole table (G2).
- [ ] The next number is taken under the journal lock, over the entire journal — demands and legacy numbered items together. No filter by `workspace`.
- [ ] `track demand raise` and `track decision number` resolve their journal with `resolveJournalOfReference` of lot 1, temporary-root ceiling included. They never fall back to the nearest-ancestor rule of the older verbs (spec DS-6).
- [ ] New events are additive. A journal written before this lot replays byte-identical; a reader of an earlier version ignores the new event types.
- [ ] The freeze of `demand.*` writes is lifted by this lot for journals other than this repository's. On this repository's journal the single-writer rule stays in force: only its conductor writes (spec DS-4).
- [ ] Out of scope, do not start: the queue and capture (lot 3a); the index and the journal outside the repository (lot 4a); adoption of existing journals (lot 5a).
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; tests use `mkdtemp` only; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/track/src/track.ts`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/cli/journal-reference.ts`
  - `packages/track/src/journal/identity.ts`
  - `packages/track/src/journal/identity.test.ts`
  - `packages/track/src/events/types.ts`
  - `packages/track/src/state/fold.ts`
  - `packages/track/src/model/decision.ts`
  - `packages/track/src/model/demand.ts`
  - `packages/track/src/report/owner-table.ts`
  - `packages/track/src/report/owner-table.test.ts`
  - `packages/track/src/report/owner-table-qualified.ts`
  - `packages/track/src/report/owner-table-strings.ts`
  - `packages/track/src/report/owner-table-qualified.test.ts`
  - `packages/track/src/report/__fixtures__/owner-table-strict-refusal.txt`
  - `packages/track/src/demand-write.test.ts`
  - `packages/track/src/decision-number.test.ts`
  - `packages/h2a/src/cli.ts`
  - `packages/h2a/src/bin-routing.ts`
  - `packages/h2a/test/track-native.test.js`
  - `packages/h2a/test/bin-routing.test.js`
  - `packages/h2a/test/dispatch-characterization-goldens.test.js`
  - `packages/h2a/test/track-facade-demand.test.js`
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `plan/05-BRANCH_track-owner-table-lot-2-native-write.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/events/store.ts`
  - `packages/track/src/events/lock.ts`
  - `packages/track/src/ingest/**`
  - `packages/track/src/workspace-id.ts`
  - `packages/track/src/cli/resolve.ts`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/test/cli-command-map.test.js` and `packages/h2a/test/fixtures/runtime-help-commands.json` (only if they pin a count that includes the facade verbs)
  - `packages/track/skills/track-operation/SKILL.md` (only to name the new verb; no rule specific to h2a)
  - `packages/h2a/fixtures/native-host-catalog.json` (never hand-edited)
- **Exception process**:
  - Declare exception ID `BR805-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `plugins`: the facade verbs are not part of the pinned verb contract — they are listed in `cli.ts` and duplicated in `bin-routing.ts`, and three tests pin the lists. No golden file moves; `bash scripts/check-public-contract.sh` must still pass.
- [ ] `attention` to `cond`: after this lot, existing structured decisions read `à numéroter` until the writer of each journal numbers them once (Lot 3).
- [ ] `BR805-EX1`: allow updating `packages/track/src/report/legacy-like-journal.fixture.test.ts` (added by lot 1 after this plan was authored). Reason: its `buildLegacyLikeJournal` called `track.createDecision`, which now appends `decision.owner-numbered` under lot 3, whereas the committed pre-lot-2 legacy fixture must remain unnumbered so E9 (`[decision-unnumbered]`) is tested on T1-a and T1-b. Impact: emits pre-lot-2 unnumbered `decision.created` + `blocker.opened` batches via `EventStore.appendCommand` (the same pattern already used in that file for the pre-structured legacy decision); the committed fixture files stay byte-identical. Rollback: revert the commit on `legacy-like-journal.fixture.test.ts`.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the facade change is one small commit on top of the Track change)
- [ ] **Multi-branch**
- Rationale: the facade test needs the Track verb of the same branch.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec sections 3 to 6; read `packages/track/src/track.ts` lines 249-250 and 296-307 (the client token and `withClientToken`), 870-897 (`raiseDemand`), 960-975 (a batch under the demand recheck), 1050-1095 (`numberDemand`), 1411-1455 (`createDecision` and its batch); `packages/track/src/cli/index.ts` lines 512-545 and 628-640 (dispatch and the resolution of write verbs) and 1267-1335 (`cmdDemand`); `packages/track/src/workspace-id.ts` (not modified); `packages/h2a/src/cli.ts` lines 7897-7940 and 8017-8135 (facade verbs and dispatch); `packages/h2a/src/bin-routing.ts` lines 14-26.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `npm test -w @sentropic/track -- src/demand.test.ts src/report/owner-table-qualified.test.ts`; `node --test packages/h2a/test/track-native.test.js packages/h2a/test/bin-routing.test.js`.
  - [ ] Tests (red first):
    - [ ] `T2-a` — `packages/track/src/demand-write.test.ts` — one command creates a numbered demand and a replay with the same key creates nothing (T2-a)
    - [ ] `T2-b` — `packages/track/src/demand-write.test.ts` — two concurrent creations receive two distinct consecutive numbers (T2-b)
    - [ ] `T2-c` — `packages/track/src/decision-number.test.ts` — a decision keeps its number when another one is settled (T2-c)
    - [ ] `T2-d` — `packages/track/src/demand-write.test.ts` — a demand and its number are one batch and no interruption leaves a hole (T2-d)
    - [ ] `T2-e` — `packages/track/src/decision-number.test.ts` — an OWNER GATE decision receives no number (T2-e)
    - [ ] `T2-f` — `packages/h2a/test/track-facade-demand.test.js` — the h2a facade routes the demand verb to Track (T2-f)
    - [ ] `T2-g` — `packages/track/src/report/owner-table-qualified.test.ts` — a structured decision without a number is listed to number, stays out of the reply line, and refuses under strict (T2-g)
    - [ ] `T2-h` — `packages/track/src/demand-write.test.ts` — from a linked worktree both commands write to the main checkout journal and leave the worktree copy untouched (T2-h)
  - [ ] T2-b spawns two real processes of the built CLI on one temporary journal and asserts the numbers are `n` and `n+1` and the journal validates clean.
  - [ ] T2-a also retries the same key from fresh CLI processes, sequentially and concurrently: both return the original identifier and number, with exactly one creation/number batch and an unchanged journal on subsequent replay.
  - [ ] T2-g covers two linked E9 decisions, two linked E5 decisions, a mix with numbered decisions and OWNER GATE, an orphan E9, and blocking versus nonblocking links. Assert distinct `decisionIds`, exact annex-F cells and strict labels, no duplicate-ref or blocked-without-cause false finding, and genuine duplicate nonempty `D<n>` refs still refused under strict. Re-run T1-a: the legacy fixture still has exactly 16 outside-demand decisions, not 18, and its two attached decisions retain their links and any blocking cause.
  - [ ] T2-d reads the journal after the command and asserts the two events share one command identifier; it also asserts that a recheck failure appends neither event.
  - [ ] T2-h builds a throwaway repository with a journal and a linked worktree under the temporary root, runs each command from the worktree, and compares the fingerprints of both journals before and after.
  - [ ] Red today: `track demand raise` is a usage error (exit 2); decisions carry no number; `h2a demand` is not a facade verb; a write verb run from a linked worktree writes into the worktree's copy.
  - [ ] Lot gate:
    - [ ] The eight tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Project identity**
  - [ ] Create `packages/track/src/journal/identity.ts` with `projectIdentity(cwd)`: it lists the root commits itself (`git rev-list --max-parents=0 HEAD`, with git discovery capped at the temporary root when `cwd` is under it), sorts them ascending, joins them with a comma, and returns `computeDurableWorkspaceId(<that string>, '')` imported from `workspace-id.ts`. It returns nothing outside git.
  - [ ] This is the identity shared by every clone and every worktree. It is not `durableWorkspaceId(cwd)`, which differs per worktree (`workspace-id.ts:86`); the git helper of that file is private and the file is not modified, hence the small re-implementation.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/journal/identity.test.ts src/workspace-id.test.ts` — the same identity from a repository, its linked worktree and a clone; the conformance vectors unchanged.

- [ ] **Lot 2 — `track demand raise`**
  - [ ] Add a facade method that appends `demand.raised` and `demand.owner-numbered` in one `emitBatch`, under the existing demand recheck hook: the number is the highest registered number of the entire journal plus one; on a recheck conflict it recomputes and retries a bounded number of times, then fails loud.
  - [ ] Wrap that batch in `this.withClientToken(key, fn, { dedupe })`. The under-lock hook searches all existing `demand.raised` events of the journal for `clientToken === key`, independent of the newly minted aggregate identifier, and returns that original demand's batch; derive the returned identifier and number from the persisted events. The store's default `(clientToken, aggregateId)` deduplication cannot detect a replay after `newId()` and is not sufficient. Preserve the demand-number recheck after deduplication; no store or ingest edit is needed.
  - [ ] Add the sub-command `raise` to `cmdDemand`: `--text` or `--stdin` for the text, `--title`, `--type`, `--workspace`, `--source`, `--key`. With `--title` the owner summary is part of the same batch.
  - [ ] Dispatch `demand raise` before the branch that resolves write verbs with `resolveTrackDir`, and resolve its journal with `resolveJournalOfReference`; the other `demand` sub-commands keep their resolution.
  - [ ] `--workspace` defaults to `projectIdentity` of the current folder; outside git it is required until lot 4a provides a folder identity.
  - [ ] `--key` is the journal-wide idempotency key for this creation command: a replay, including a concurrent one through the hook above, returns the original identifier and number and appends nothing.
  - [ ] Output: the demand identifier and its number on one line; update the `usage:` line of `cmdDemand` and the top-level usage.
  - [ ] Make `OWNER_TABLE_NO_DEMANDS_MESSAGE` cite `track demand raise --text <text>` in place of the ingest route, and update the pinned copies of that message in `owner-table.test.ts` (near lines 2080-2087); T0-c keeps proving that the quoted commands run.
  - [ ] Lot gate:
    - [ ] `npm run typecheck`
    - [ ] `npm test -w @sentropic/track -- src/demand-write.test.ts src/demand.test.ts src/report/owner-table.test.ts` — T2-a, T2-b, T2-d green, and T2-h for `demand raise`.

- [ ] **Lot 3 — Stable decision number**
  - [ ] Register the additive event type `decision.owner-numbered` in `events/types.ts`; fold it into `DecisionState.ownerNumber` in `state/fold.ts`.
  - [ ] In `createDecision`, append `decision.owner-numbered` in the same batch as `decision.created`, with the highest decision number of the journal plus one, unless the title starts with `OWNER GATE`.
  - [ ] Guard uniqueness under the lock the same way `numberDemand` does; a decision number is never reassigned, even after the decision is settled.
  - [ ] Add `track decision number <decisionId>` and `track decision number --all-unnumbered`: the second numbers every unsettled structured decision that has no number, in creation order, skipping OWNER GATE records. Both resolve their journal with `resolveJournalOfReference`. A second run appends nothing.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/decision-number.test.ts src/demand-write.test.ts` — T2-c, T2-e green, and T2-h for `decision number`.
    - [ ] `npm test -w @sentropic/track -- src/cli/decision-ls.test.ts src/report/validated-report-shape.test.ts` — unchanged and green.

- [ ] **Lot 4 — Reader**
  - [ ] In the qualified reader, a complete decision with a recorded number renders `D<number>`; positional numbering is removed. E5/E9 decisions and OWNER GATE have internal `ref: ''` and JSON `ref: null`. E5 hides even a recorded number until its dossier is complete. Only nonempty `D<n>` refs participate in duplicate-reference checks; an empty ref is never a key in `decisionMap`.
  - [ ] Retain lot 1's lookup by `d.id` and row `decisionIds`, `blockingDecisionIds`, `sansObjetDecisionIds`: E4 uses the referenced identity set, and blocking/withdrawn-row checks use identities even without a number. Do not reconstruct attachment or causes from display refs. Each linked unnumbered decision keeps annex F's `à numéroter` or `à instruire` cell and its own blocking cause; repeat labels for distinct identities. Synthetic `:expectation` decisions also retain identity and qualify as E5 without invented numbering.
  - [ ] Every strict message interpolation uses a nonempty ref or annex F's deterministic diagnostic label; machine violations retain `decisionId`. Never print internal identifiers or use an empty ref as a diagnostic label. Preserve check codes, occurrence counts and ordering, including E4's 16 findings on the legacy fixture.
  - [ ] A structured decision without a number is class E9: listed `à numéroter`, out of the `Réponse` line, counted among the decisions to complete; under `--strict` it adds the line `[decision-unnumbered]` after the strict audit's text. Add the code to `OwnerTableGateCode` and the strings of annex F to `owner-table-strings.ts`.
  - [ ] Regenerate `__fixtures__/owner-table-strict-refusal.txt` once, with the procedure of lot 1 (fixed clock, fixed commit, policy variables unset); only decision labels and the added E9 lines may differ. No added duplicate-reference, unreferenced-decision or blocked-without-cause finding is allowed. Put the diff and the unchanged attachment counts in the pull request.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts` — T2-g green; T1-b green on the regenerated file.

- [ ] **Lot 5 — h2a facade**
  - [ ] Add `demand` to `TRACK_FACADE_VERBS` and to `TRACK_NATIVE_WRITE_VERBS` in `packages/h2a/src/cli.ts` (lines 7897-7933), and to the duplicate list of `packages/h2a/src/bin-routing.ts` (lines 18-23) that light routing reads.
  - [ ] Update the three tests that pin those lists: `track-native.test.js` (near lines 92-95, the exact list of write verbs), `bin-routing.test.js` (near lines 43-47), `dispatch-characterization-goldens.test.js` (near lines 230-236).
  - [ ] Nothing changes in `cli-contract.ts` or in the golden verb list: facade verbs are not part of that contract, and `cli-command-map.ts` derives its rows from the facade list on its own.
  - [ ] Lot gate:
    - [ ] `npm run build`; `node --test packages/h2a/test/track-facade-demand.test.js packages/h2a/test/track-native.test.js packages/h2a/test/bin-routing.test.js packages/h2a/test/dispatch-characterization-goldens.test.js packages/h2a/test/cli-command-map.test.js` — T2-f green.
    - [ ] `bash scripts/check-public-contract.sh`

- [ ] **Lot 6 — Skill**
  - [ ] In `packages/h2a/skills/harness/track-report/SKILL.md`: decision numbers are stable and may not be contiguous; an answer names the stable number; the command that records a demand is `track demand raise`.
  - [ ] Same file: decisions listed `à numéroter` are numbered once by whoever writes that journal, with `track decision number --all-unnumbered`; a session that is not the writer named by the repository's own rules tells that writer instead. The report itself never writes.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`; `node --test packages/h2a/test/owner-gate-skill.test.js`.

- [ ] **Lot 7 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/demand-write.test.ts src/decision-number.test.ts src/journal/identity.test.ts src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts src/demand.test.ts`
  - [ ] `node --test packages/h2a/test/track-facade-demand.test.js packages/h2a/test/track-native.test.js packages/h2a/test/bin-routing.test.js packages/h2a/test/cli-command-map.test.js`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Open the pull request in English with red and green evidence and the diff of the frozen file; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T2-a to T2-h green on Node 22 and 24; a journal written before this lot replays byte-identical; T0-c stays green with the new message; no command of this lot writes into a worktree copy.
