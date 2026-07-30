# Fix: expose `--owner` on `track blocker raise`

## Objective
- Make `blocker raise` accept `--owner <actor>` and record it on the emitted `blocker.opened` payload.
- Ensure owner follows the same CLI-boundary trim + non-empty convention used for RACI-like actor fields.
- Guarantee unchanged behavior when `--owner` is omitted (no `owner` key in `blocker.opened`).

## Scope

**Allowed Paths (implementation scope)**
- `BRANCH.md`
- `packages/track/src/cli/index.ts`
- `packages/track/src/cli.test.ts`
- `tmp/report-to-track.md`

**Forbidden Paths**
- `packages/track/src/track.ts`
- `packages/track/src/model/blocker.ts`
- `packages/track/src/ingest/contract.ts`
- `packages/track/src/state/fold.ts`
- `packages/track/src/report/**`
- `.track/**`

## Lot — Blocker owner passthrough
- [x] Update CLI usage text to advertise `--owner` for `blocker raise`.
- [x] Parse and trim `--owner` on `cmdBlocker('raise', ...)`.
- [x] Reject blank `--owner` with `--owner must be a non-empty actor id`.
- [x] Forward trimmed `owner` into `track.openBlocker`.
- [x] Add CLI tests for:
  - owner present → payload and folded state include owner
  - blank owner → exit 1 and no append
  - owner omitted → payload and folded state omit owner
- [x] Add `tmp/report-to-track.md` with execution notes.
