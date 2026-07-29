# Feature: set RACI on an existing track item

## Objective

- [x] Add a narrow, append-only RACI update for an existing item: `item.set-raci` → `item.raci-assigned`.
- [x] Preserve creation-payload field names and use field-wise last-write-wins folding.
- [x] Keep every pre-change event log byte-identical in its folded result.

## Scope / Guardrails

**Allowed Paths**

- `BRANCH.md`
- `packages/track/src/events/types.ts`
- `packages/track/src/model/item.ts`
- `packages/track/src/state/fold.ts`
- `packages/track/src/track.ts`
- `packages/track/src/cli/index.ts`
- `packages/track/src/ingest/contract.ts`
- `packages/track/src/ingest/map.ts`
- `packages/track/src/ingest/ingest.ts`
- `packages/track/src/deps-raci.test.ts`
- `packages/track/src/a2-stream-role.test.ts`
- `packages/track/src/code-assign.test.ts`
- `packages/track/src/ingest/contract.test.ts`
- `packages/track/src/ingest/map.test.ts`
- `packages/track/src/ingest/demand-ingest.test.ts`
- `packages/track/src/ingest/export.test.ts`
- `packages/track/src/ingest/focus-l4.test.ts`
- `packages/track/src/ingest/seam-v0.test.ts`
- `tmp/report-to-track.md`

**Forbidden Paths**

- `.track/**`
- `packages/track/src/read/**`
- `packages/track/src/report/**`
- `packages/h2a/**`
- `packages/h2a-runtime/**`
- `packages/h2a-cli/**`
- `apps/**`
- `Makefile`
- `docker-compose*.yml`
- `.cursor/rules/**`
- `.test-scratch/**`

**Conditional Paths**

- None — any need to change a read surface or renderer stops for owner direction.

## Lot 1 — Existing-item RACI event

- [x] Keep `accountable` and `responsible` in the creation-payload shape.
- [x] Append `item.raci-assigned` only through `Track.setRaci` after target and non-empty-update guards.
- [x] Fold the event field-wise last-write-wins; an omitted axis preserves the recorded value because this payload has no unambiguous clear representation.
- [x] Gate: unknown items and empty updates append nothing; historic logs fold unchanged.

## Lot 2 — Ingest and CLI surfaces

- [x] Add binding `item.set-raci` with `settles: 'always'` and a MINOR ingest-contract bump.
- [x] Contain mutation to the target item workspace and map it to the facade.
- [x] Add `track item set-raci <itemId> [--accountable <a>] [--responsible <a,a>] [--client-token <t>]`.
- [x] Gate: authenticated ingest and CLI paths append the same persisted event shape.

## Lot 3 — Evidence and handoff

- [x] Pin names, version, schema, mapper coverage, facade guards, LWW replacement, CLI behavior, and pre-change-log fold additivity.
- [x] Reproduce and record the pre-existing `h2a-runtime` build failure on the `origin/main`-based runtime source.
- [x] Run `cd packages/track && npx vitest run`; investigate any test-count gap before claiming the suite result.
- [x] Inspect scope and diff; commit scoped files, push branch, and open a PR against `main`.
- [x] Write `tmp/report-to-track.md` with observed counts, boundary, and out-of-scope findings; request independent owner-dispatched review.

## Feedback Loop

- [ ] AWAITED: owner UAT and two independent review legs; the builder supplies evidence only.
- [x] NOTED: `track item show 01KYQXJG77DQC368F4G2B2VGD8` returned `null` in this isolated worktree; the mandate body was not locally available.
- [x] NOTED: `packages/track/docs/reviews/track-raci-set-existing-item-review.md` is an inherited, untracked self-review artifact; it is outside this lot and will not be committed or used as a review leg.
