# Scoped report projection

## Objective

- [x] Deliver one reproducible workpackage-scoped projection of the validated four-section track report.
- [x] Remove the blockage sibling row that duplicates its target title.

## Scope

**Allowed Paths**

- `BRANCH.md`
- `packages/track/src/cli/index.ts`
- `packages/track/src/read/commands.ts`
- `packages/track/src/read/commands.test.ts`
- `packages/track/src/read/commands.scope.test.ts`
- `packages/track/src/report/format.ts`
- `packages/track/src/report/validated-report-shape.test.ts`
- `packages/track/src/report/*.test.ts` only when directly required by scoped rendering coverage
- `tmp/report-to-track.md`

**Forbidden Paths**

- `.track/**`
- `packages/track/src/state/fold.ts`
- `packages/track/src/events/**`
- `packages/track/src/write/**`
- `Makefile`
- `docker-compose*.yml`
- `.cursor/rules/**`
- Workspace-selector code and tests
- `packages/track/src/report/html.ts`

## Lot 1 — Scope contract and projection

- [x] Resolve `--scope` by exact workpackage container ID, durable assigned code, or unique derived label.
- [x] Reject unknown and ambiguous scope selectors before rendering.
- [x] Include the selected workpackage subtree and account for excluded rows in the unchanged header.
- [x] Keep global reports byte-identical and preserve the JSON field contract.
- [x] Test: focused report command and renderer tests.
- [x] Gate: scoped rows are byte-consistent with their global counterparts.

## Lot 2 — Blockage presentation

- [x] Render a blockage as a blockage instead of a sibling row that repeats its target title.
- [x] Preserve WP progress arithmetic and the five-column À-FAIRE table.
- [x] Test: validated-shape coverage for the title-twin case.
- [x] Gate: one target title maps to one work row while its blockage remains legible.

## Lot 3 — Verification and handoff

- [x] Run focused tests and the complete `packages/track` Vitest suite.
- [x] Confirm the origin/main Track test-file count and inspect golden-file changes.
- [ ] Commit the scoped implementation, push the branch, and open a draft PR to `main`.
- [ ] Write the bounded execution report for the accountable track lane.
