# Round-4 report — PR #89

## What changed per fix

### FIX 1 — keep item.create acceptance and trim only
- `packages/track/src/track.ts`
  - `createItem` now normalizes `accountable` and `responsible` by trimming only.
  - Blank/empty values are no longer rejected on creation.
  - `setRaci` still trims and rejects blank/empty values (`accountable` or `responsible`), with `item.set-raci` unchanged as the narrow new verb.
- `packages/track/src/ingest/contract.ts`
  - Clarified that `INGEST_CONTRACT_VERSION = 2.1.0` remains MINOR and does not narrow existing `item.create` payload acceptance; normalisation is write-time write-path trimming.

### FIX 2 — make set-raci CLI rejection reachable
- `packages/track/src/cli/index.ts`
  - Removed the implicit silence in `item set-raci`’s responsible parsing (`filter(Boolean)` was already absent; behavior is now explicit with no pre-facade elision).
  - `item new` remains intentional and lenient (`filter(Boolean)` kept there), matching its pre-existing behavior.
  - Updated usage/help lines to call out the deliberate difference between `item new` and `item set-raci`.
- `packages/track/src/deps-raci.test.ts`
  - Added/updated CLI assertions that:
    - `track item set-raci ... --responsible 'agent:codex,   '` fails (non-zero, error message).
    - `track item new --responsible 'agent:codex,   '` still keeps its pre-existing behavior and stores `['agent:codex']`.
  - Adjusted creation-path unit tests to verify whitespace is trimmed but not rejected.

### FIX 3 — document limits of normalization
- `packages/track/src/track.ts`
  - Added normalization comment block explaining that this is write-time-only and not canonicalization.

## Observed numbers
- `git ls-tree -r --name-only origin/main packages/track/src | rg '\.test\.ts$' | wc -l` => `86`
- `cd packages/track && npx vitest run` => `Test Files 86 passed (86)` and `Tests 1158 passed (1158)`

## Guarantee stops
- `legacy padded actor already in the log is NOT migrated: the fold and reads expose it with its original padding, because normalisation happens at write time.`
- `trim() is not canonicalisation. A U+200B-prefixed actor is an invisible duplicate spelling and passes.`
- No replay migration was implemented.

## Anything found and not fixed
- No additional unfixed issues were identified in scope for this round.
