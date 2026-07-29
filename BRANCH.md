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
  - `packages/track/src/read/contract.ts`
  - `packages/track/src/report/blocker-status.ts`
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
  - `packages/track/src/read/contract.test.ts`
  - `packages/track/src/read/demand-reads.test.ts`
  - `packages/track/src/read/read-self-contained.test.ts`

**Forbidden Paths**
  - `.track/**`
  - `packages/track/src/report/format.ts`
  - `packages/h2a/**`
  - `packages/h2a-runtime/**`
  - `packages/h2a-cli/**`
  - `apps/**`
  - `.test-scratch/**`

**Conditional Paths**
  - `packages/track/src/report/**` — the RENDERERS stay untouched: the owner-validated report shape
    (`docs/specs/examples/track-report-contextual.md`) is not renegotiated here. A reopened item recedes out of
    DONE through the existing `bucketOf`; rendering the "reopened" marker is a separate item. `blocker-status.ts`
    is IN scope after review leg A: a reopening had to propagate to a `linked-accepted` dependent, which is a
    defect this change introduced, not a rendering choice.

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

## Lot 3 — Review reconciliation (two independent legs, 2026-07-29)

Artefacts: `tmp/review/leg-a.md` (gpt-5.6-terra xhigh, NO-GO), `tmp/review/leg-b.md` (gpt-5.6-luna xhigh,
GO-WITH-CONDITIONS). Neither leg is the builder. Both ran the suite themselves; leg B ran an operator
walkthrough in a throwaway store.

- [x] ACCEPTED (leg A, blocking 1) — the fold half-applied an illegal foreign reopening: it advanced the
      realization while recording NO trace. Now ALL-OR-NOTHING, and `validate` reports the event
      (`reopen-illegal`) instead of leaving it silent. Also flags a `payload.itemId` that addresses another item.
- [x] ACCEPTED, NARROWED (leg A, blocking 2) — a `linked-accepted` dependent stayed unblocked when its
      prerequisite was reopened, while `linked-done` re-opened. Leg A's shape (require `done`) would have
      rewritten the owner-ratified acceptance-driven rule and broke 6 of its specs; the shipped fix keys on the
      EXPLICIT new signal (ref reopened and not delivered again), so an item that was never reopened projects
      byte-identically.
- [x] ACCEPTED (leg A, blocking 3) — `lifecycleTrace` now carries `realization.reopened`; READ contract
      1.21.0 → 1.22.0. Deferring an EXISTING projection was hiding the new audit fact, not deferring a rendering.
- [ ] TRACED, not fixed here (leg A, blocking 3, second half) — no MCP tool exposes the reopening trace, so an
      MCP consumer sees `in-progress` without the motive. A new tool is a product surface, not this bugfix.
- [ ] NOTED, no action (leg B) — `auth:'signed'` is recorded, never verified, and a direct `EventStore` append
      bypasses the ingest binding gate. Both are pre-existing, documented properties of track (it records, it
      does not verify); the authorization claim here is scoped to the ingest channel, as leg B concluded.

## Lot 4 — Verification and boundary

- [x] Run the track suite (`npm test -w @sentropic/track`) and the TypeScript build. 1178 tests green after
      reconciliation (1171 before, +7 pinning the review findings).
- [x] Gate: a reopened item leaves the DONE bucket, and its workpackage percentage recedes.
- [x] Gate: an unauthenticated ingest channel cannot reopen.
- [x] State where the guarantee STOPS: the motive is RECORDED, not verified — track has no owner-UAT marker
      today, so it cannot prove that a closure lacked one. That marker is item `01KYQ5KM99FDGN1PZVFXR8PRVJ` (WP9).
- [x] Two-peer review consensus obtained and reconciled; micro-PR #83 open. No npm publish, and no `done`
      claimed — that needs the owner's UAT.

## Feedback Loop

- [ ] Traced, not done here: render the "reopened" marker in the human report (WP8, separate item).
- [x] DONE after review instead of deferred: the reopening is projected into `lifecycleTrace`.
- [ ] Traced, not done here: acceptance does not regress with the item — a reopened item keeps its passing
      criteria, so `--require-accepted` still reads them as accepted.
