# Fix: track can express a regression — reopen a closed item with a recorded motive

## Objective

- [x] A `done` or `cancelled` item can be REOPENED, so a workpackage percentage can recede to the truth.
- [x] Every reopening carries its motive (`closed-without-owner-uat` / `regression-observed`) and a reason.
- [x] The ordinary `item realize` verb keeps `done`/`cancelled` terminal — a reopening is never accidental.
- [x] The reopening is a TRANSITION in the append-only log, never a mutation: closure, reopening and motive all survive.

Mandate: item `01KYQ5KM21KEGWXTEAGRYB4STD` (WP8), decision `01KYQ5RRN67190YMZ08EGGBSBT` — owner GO on option A
(2026-07-29): "done -> in-progress et cancelled -> in-progress redeviennent legales. L'evenement de reouverture
porte son motif."

## Scope

**Allowed Paths (implementation scope)**
  - `BRANCH.md`
  - `packages/track/src/model/item.ts`
  - `packages/track/src/model/item.test.ts`
  - `packages/track/src/events/types.ts`
  - `packages/track/src/events/validate.ts`
  - `packages/track/src/events/validate.test.ts`
  - `packages/track/src/state/fold.ts`
  - `packages/track/src/track.ts`
  - `packages/track/src/ingest/contract.ts`
  - `packages/track/src/ingest/map.ts`
  - `packages/track/src/ingest/ingest.ts`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/reopen.test.ts`
  - `packages/track/src/cli.test.ts`
  - `packages/track/src/ingest/contract.test.ts`
  - `packages/track/src/ingest/map.test.ts`
  - `packages/track/src/ingest/demand-ingest.test.ts`
  - `packages/track/src/ingest/export.test.ts`
  - `packages/track/src/ingest/focus-l4.test.ts`
  - `packages/track/src/ingest/seam-v0.test.ts`
  - `packages/track/src/code-assign.test.ts`
  - `packages/track/src/a2-stream-role.test.ts`

**Forbidden Paths**
  - `.track/**`
  - `packages/track/src/report/format.ts`
  - `packages/h2a/**`
  - `packages/h2a-runtime/**`
  - `packages/h2a-cli/**`
  - `apps/**`
  - `.test-scratch/**`

**Conditional Paths**
  - `packages/track/src/report/**` — READ ONLY for this lot: the owner-validated report shape
    (`docs/specs/examples/track-report-contextual.md`) is not renegotiated here. A reopened item recedes out of
    DONE through the existing `bucketOf`; rendering the "reopened" marker in the human report is a separate item.

## Lot 1 — The reopening event and its legality

- [x] `realization.reopened` event type, payload `{itemId, motive, reason}`.
- [x] `assertReopenTransition`: legal only from `done` / `cancelled`; `rejected` refused (a no-go decision owns it).
- [x] `REALIZATION_TRANSITIONS` stays terminal — `item realize <id> in-progress` on a closed item still fails.
- [x] Fold: realization becomes `in-progress`, and the item carries its `reopenings[]` trace (from/motive/reason/at/by).
- [x] `validate`: a foreign/hand-written `realization.reopened` without a legal motive is an integrity finding.
- [x] Test: `reopen.test.ts` — model legality, fold, facade guards, bucket regression.

## Lot 2 — The surfaces

- [x] Facade `Track.reopenItem(itemId, {motive, reason}, clientToken?)`.
- [x] Ingest kind `item.reopen` (`settles: 'always'` — a reopening moves a WP percentage), contract MINOR bump.
- [x] CLI `track item reopen <itemId> --motive <m> --reason <r> [--client-token <t>]` + usage line.
- [x] `track item show` reads the reopening trace (motive + reason + previous realization) off the item.
- [x] Test: contract surface pins, ingest binding gate, CLI round-trip.

## Lot 3 — Verification and boundary

- [x] Run the track suite (`npm test -w @sentropic/track`) and the TypeScript build.
- [x] Gate: a reopened item leaves the DONE bucket, and its workpackage percentage recedes.
- [x] Gate: an unauthenticated ingest channel cannot reopen.
- [x] State where the guarantee STOPS: the motive is RECORDED, not verified — track has no owner-UAT marker
      today, so it cannot prove that a closure lacked one. That marker is item `01KYQ5KM99FDGN1PZVFXR8PRVJ` (WP9).
- [ ] Two-peer review consensus, then micro-PR. No npm publish, no `done` without the owner's UAT.

## Feedback Loop

- [ ] Traced, not done here: render the "reopened" marker in the human report (WP8, separate item).
- [ ] Traced, not done here: project the reopening into `lifecycleTrace` (a READ contract bump of its own).
- [ ] Traced, not done here: acceptance does not regress with the item — a reopened item keeps its passing
      criteria, so `--require-accepted` still reads them as accepted.
