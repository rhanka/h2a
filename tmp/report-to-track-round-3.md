# Track PR #89 Round 3 report

## What changed
- `packages/track/src/track.ts`: normalized and validated `accountable` / `responsible` in `Track.createItem` (trim + reject blank/empty entries), so creation path now matches `setRaci` behavior.
- `packages/track/src/track.ts`: centralized `createItem`/`setRaci` normalization in shared helpers and kept the existing `setRaci` required fields invariant (`setRaci` still requires at least one field).
- `packages/track/src/deps-raci.test.ts`:
  - Added direct `Track` coverage that writes padded actors through `item.create` and `setRaci` and verifies one canonical spelling.
  - Added `Track` creation-path blank rejection checks for `accountable` and `responsible`.
  - Added ingest-path coverage showing padded actor IDs are normalized on `item.create`.
  - Added regression coverage for post-update projection values through `report`, `query`, `snapshot`, and `item show`.

## Verification
- `git ls-tree -r --name-only origin/main packages/track/src | rg '\.test\.ts$' | wc -l` → `86`
- `cd packages/track && npx vitest run` → `86` files, `1157` tests passed.

## Guarantee stop
- Fixes are intentionally write-path only (normalization and validation).
- No clear operation was added.
- READ contract shapes were not changed.
- Did not write/update `.track/**`.

## Anything not fixed
- Nothing identified for this round.
