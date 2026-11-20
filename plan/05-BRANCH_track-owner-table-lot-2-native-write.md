# Feature: Track owner table — delivery lot 2 (native write: numbered demand in one command, stable decision number)

## Objective

- [ ] One Track command creates a demand and gives it the next number, atomically and idempotently.
- [ ] A decision receives a stable number at creation and keeps it when another decision is settled; an OWNER GATE never receives one.
- [ ] The h2a facade exposes the `demand` verb.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V11), 4 (G2), 5 and 6.3, tests T2-a to T2-g.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`, and `plugins` for the h2a facade. Consulted: `cond`.
- [ ] Prerequisite: lot 1 is merged.
- [ ] A demand and its number land in one command batch. No state exists in which a demand is created and its number is not: that state would open a hole in the registry, which refuses the whole table (G2).
- [ ] The next number is taken under the journal lock, over the entire journal — demands and legacy numbered items together. No filter by `workspace`.
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
  - `packages/track/src/events/types.ts`
  - `packages/track/src/state/fold.ts`
  - `packages/track/src/model/decision.ts`
  - `packages/track/src/model/demand.ts`
  - `packages/track/src/report/owner-table.ts`
  - `packages/track/src/report/owner-table-qualified.ts`
  - `packages/track/src/report/owner-table-qualified.test.ts`
  - `packages/track/src/demand-write.test.ts`
  - `packages/track/src/decision-number.test.ts`
  - `packages/h2a/src/cli.ts`
  - `packages/h2a/src/cli-contract.ts`
  - `packages/h2a/src/cli-command-map.ts`
  - `packages/h2a/test/track-facade-demand.test.js`
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `plan/05-BRANCH_track-owner-table-lot-2-native-write.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/events/store.ts`
  - `packages/track/src/events/lock.ts`
  - `packages/track/src/ingest/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `docs/contracts/golden/**` and `packages/h2a/test/fixtures/runtime-help-commands.json` (the facade verb changes the pinned verb list and its counts)
  - `packages/h2a/test/cli-command-map.test.js`, `packages/h2a/test/cli-contract.test.js`
  - `packages/track/skills/track-operation/SKILL.md` (only to name the new verb; no rule specific to h2a)
  - `packages/h2a/fixtures/native-host-catalog.json` (never hand-edited)
- **Exception process**:
  - Declare exception ID `BR805-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `plugins`: adding `demand` to the facade changes the public verb contract; the golden files and their hand-written counts move together and `bash scripts/check-public-contract.sh` must pass.
- [ ] `attention` to `cond`: after this lot the conductor of each journal runs the one-time numbering of existing decisions (Lot 3); until then they read `à numéroter`.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the facade change is one small commit on top of the Track change)
- [ ] **Multi-branch**
- Rationale: the facade test needs the Track verb of the same branch.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec sections 3 to 6; read `packages/track/src/track.ts` lines 254-294 (client token), 870-897 (`raiseDemand`), 960-975 (batch with recheck), 1050-1095 (`numberDemand`), 1411-1455 (`createDecision` and its batch); `packages/track/src/cli/index.ts` lines 1267-1335 (`cmdDemand`); `packages/h2a/src/cli.ts` lines 7897-7940 and 8017-8135 (facade verbs and dispatch).
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `npm test -w @sentropic/track -- src/demand.test.ts src/report/owner-table-qualified.test.ts`.
  - [ ] Tests (red first):
    - [ ] `T2-a` — `packages/track/src/demand-write.test.ts` — one command creates a numbered demand and a replay with the same key creates nothing (T2-a)
    - [ ] `T2-b` — `packages/track/src/demand-write.test.ts` — two concurrent creations receive two distinct consecutive numbers (T2-b)
    - [ ] `T2-c` — `packages/track/src/decision-number.test.ts` — a decision keeps its number when another one is settled (T2-c)
    - [ ] `T2-d` — `packages/track/src/demand-write.test.ts` — a demand and its number are one batch and no interruption leaves a hole (T2-d)
    - [ ] `T2-e` — `packages/track/src/decision-number.test.ts` — an OWNER GATE decision receives no number (T2-e)
    - [ ] `T2-f` — `packages/h2a/test/track-facade-demand.test.js` — the h2a facade routes the demand verb to Track (T2-f)
    - [ ] `T2-g` — `packages/track/src/report/owner-table-qualified.test.ts` — a structured decision without a number is listed to number and stays out of the reply line (T2-g)
  - [ ] T2-b spawns two real processes of the built CLI on one temporary journal and asserts the numbers are `n` and `n+1` and the journal validates clean.
  - [ ] T2-d reads the journal after the command and asserts the two events share one command identifier; it also asserts that a recheck failure appends neither event.
  - [ ] Red today: `track demand raise` is a usage error (exit 2); decisions carry no number; `h2a demand` is not a facade verb.
  - [ ] Lot gate:
    - [ ] The seven tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — `track demand raise`**
  - [ ] Add a facade method that appends `demand.raised` and `demand.owner-numbered` in one `emitBatch`, under the existing demand recheck hook: the number is the highest registered number of the entire journal plus one; on a recheck conflict it recomputes and retries a bounded number of times, then fails loud.
  - [ ] Add the sub-command `raise` to `cmdDemand`: `--text` or `--stdin` for the text, `--title`, `--type`, `--workspace`, `--source`, `--key`. With `--title` the owner summary is part of the same batch.
  - [ ] `--workspace` defaults to the durable workspace identity of the current repository; outside git it is required until lot 4a provides a folder identity.
  - [ ] `--key` is the idempotency key: a replay returns the original identifier and number and appends nothing.
  - [ ] Output: the demand identifier and its number on one line; update the `usage:` line of `cmdDemand` and the top-level usage.
  - [ ] Make `OWNER_TABLE_NO_DEMANDS_MESSAGE` cite `track demand raise` in place of the ingest route; T0-c keeps proving that the quoted commands run.
  - [ ] Lot gate:
    - [ ] `npm run typecheck`
    - [ ] `npm test -w @sentropic/track -- src/demand-write.test.ts src/demand.test.ts src/report/owner-table.test.ts` — T2-a, T2-b, T2-d green.

- [ ] **Lot 2 — Stable decision number**
  - [ ] Register the additive event type `decision.owner-numbered` in `events/types.ts`; fold it into `DecisionState.ownerNumber` in `state/fold.ts`.
  - [ ] In `createDecision`, append `decision.owner-numbered` in the same batch as `decision.created`, with the highest decision number of the journal plus one, unless the title starts with `OWNER GATE`.
  - [ ] Guard uniqueness under the lock the same way `numberDemand` does; a decision number is never reassigned, even after the decision is settled.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/decision-number.test.ts` — T2-c, T2-e green.
    - [ ] `npm test -w @sentropic/track -- src/cli/decision-ls.test.ts src/report/validated-report-shape.test.ts` — unchanged and green.

- [ ] **Lot 3 — One-time numbering of existing decisions**
  - [ ] Add `track decision number <decisionId>` and `track decision number --all-unnumbered`: the second numbers every unsettled structured decision that has no number, in creation order, skipping OWNER GATE records. Both are ordinary writes, refused like any other by a journal's write policy once lot 3a exists.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/decision-number.test.ts` — the command is idempotent: a second run appends nothing.

- [ ] **Lot 4 — Reader**
  - [ ] In the qualified reader, a decision with a recorded number renders `D<number>`; positional numbering is removed.
  - [ ] A structured decision without a number is listed `à numéroter` and stays out of the `Réponse` line.
  - [ ] Row cells that reference decisions use the recorded numbers.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts` — T2-g green; T1-b still green (the frozen strict refusal does not depend on numbers of settled fixtures; if it does, record exception `BR805-EX1` with the diff and the reason before regenerating the file).

- [ ] **Lot 5 — h2a facade**
  - [ ] Add `demand` to `TRACK_FACADE_VERBS` and to `TRACK_NATIVE_WRITE_VERBS` (`packages/h2a/src/cli.ts:7897-7933`); add its contract entry to `cli-contract.ts` and its group to `cli-command-map.ts`.
  - [ ] Regenerate the pinned verb list and update its hand-written counts as `docs/contracts/golden/README.md` describes; update `runtime-help-commands.json` if the help rows change.
  - [ ] Lot gate:
    - [ ] `npm run build`; `node --test packages/h2a/test/track-facade-demand.test.js packages/h2a/test/cli-command-map.test.js packages/h2a/test/cli-contract.test.js` — T2-f green.
    - [ ] `bash scripts/check-public-contract.sh`

- [ ] **Lot 6 — Skill**
  - [ ] In `packages/h2a/skills/harness/track-report/SKILL.md`: decision numbers are stable and may not be contiguous; an answer names the stable number; the command that records a demand is `track demand raise`.
  - [ ] Same file: when the table lists decisions `à numéroter` on an open journal, the session runs `track decision number --all-unnumbered` once and renders again; on a held journal it tells the holder. The report itself never writes.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`; `node --test packages/h2a/test/owner-gate-skill.test.js`.

- [ ] **Lot 7 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/demand-write.test.ts src/decision-number.test.ts src/report/owner-table-qualified.test.ts src/report/owner-table.test.ts src/demand.test.ts`
  - [ ] `node --test packages/h2a/test/track-facade-demand.test.js packages/h2a/test/cli-command-map.test.js`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T2-a to T2-g green on Node 22 and 24; a journal written before this lot replays byte-identical; the refusal messages of lot 0 now cite `track demand raise` and T0-c stays green.
