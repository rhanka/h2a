# Track Report — blocker.raise owner flag passthrough

## What changed
- Updated `packages/track/src/cli/index.ts` so `blocker raise` accepts `--owner <actor>` and forwards it to `track.openBlocker`.
- Added CLI normalization for owner values:
  - trims whitespace
  - rejects blank values with `--owner must be a non-empty actor id`
- Updated CLI usage line to include `--owner <a>` on `blocker raise`.
- Added CLI tests in `packages/track/src/cli.test.ts` covering:
  - owner present is recorded in event payload and folded blocker state
  - blank owner is rejected and does not append any event
  - owner omitted behaves as before (no owner in payload/state)

## Repro before (origin/main)
Command reproduced on the baseline:
`blocker raise --target <i> --kind dependency --scope extra --engagement-ref eng:x --rule manual --reason "..." --owner claude:h2a:runtime`
- Exit: `0`
- Blocker created successfully
- `blocker.opened` payload had no `owner` key despite flag being passed

## Repro after
- Command:
`/home/antoinefa/.npm-global/bin/tsx packages/track/src/cli/bin.ts --track-dir <tmp> init`
`item new --kind feature --title repro --workspace ws`
`blocker raise --target <i> --kind dependency --scope extra --engagement-ref eng:x --rule manual --reason depends --owner claude:h2a:runtime`
- Exit: `0`
- `blocker.opened` payload includes:
`"owner":"claude:h2a:runtime"`
- Folded blocker state includes `owner: "claude:h2a:runtime"`

- Blank owner repro:
`--owner "   "`
- Exit: `1`
- Message: `error: --owner must be a non-empty actor id`
- No blocker event appended (only original `item.created` exists)

- No owner repro:
same command without `--owner`
- Exit: `0`
- `blocker.opened` payload has no `owner` key
- folded blocker state has `owner` undefined

## Verification numbers
- `cd packages/track && npx vitest run`
  - `Test Files  86 passed (86)`
  - `Tests  1145 passed (1145)`
- `git ls-tree -r --name-only origin/main -- packages/track/src | wc -l`
  - `189`

## Guarantee scope and limits
- This lot only changes CLI pass-through and validation.
- It intentionally does not change ingest contract version, fold logic, event types, report renderers, read contract, or unknown-flag handling.
- No `.track/**` files written in this lot.
- Outstanding/found-but-not-fixed: none.
