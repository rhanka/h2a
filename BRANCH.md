# Fix: restore compatibility with facade mesh accounts

## Objective

- [x] Restore accepts `llm-mesh.json` files containing public `meshAccounts` metadata and no legacy credential-bearing `accounts` array.
- [x] An explicit `restore --gw` acquires a usable gateway or fails clearly before restore opens any agent.

## Scope / Guardrails

**Allowed Paths**

- `BRANCH.md`
- `packages/h2a-runtime/src/index.ts`
- `packages/h2a-runtime/src/structured-gateway.test.ts`

**Forbidden Paths**

- `packages/h2a-runtime/src/tmux.ts` and status-bar tests (preserve #131 anti-storm behavior)
- dependency manifests and lockfiles
- global installs, live `~/.sentropic` state, and live tmux sessions
- publish and push surfaces

## Plan / Todo

- [x] **Lot 1 — deterministic regression**
  - [x] Add a unit fixture with `meshAccounts` and deliberately no `accounts` property.
  - [x] Prove required gateway restore cannot reach the agent-opening continuation without a valid gateway.
- [x] **Lot 2 — minimal restore fix**
  - [x] Route restore preparation through the existing fail-closed structured gateway boundary when `--gw` is explicit.
  - [x] Keep automatic restore behavior compatible and keep credentials out of `llm-mesh.json`.
  - [x] Run the focused tests and proportional runtime/package gates.

## Feedback Loop

- [x] Re-run the deterministic fixture after the fix and verify the #131 files remain unchanged.

## Root Cause

The restore command parsed `--gw` for the emitted layout but did not pass that
required mode to gateway preparation. Preparation therefore obeyed only the
auto-reactivation toggle and invoked the fallback-enabled `auto` path, allowing
`restoreLayout` to continue without a gateway. The facade migration exposed the
same path because public config now carries `meshAccounts` and no credential
array; credentials remain outside `llm-mesh.json`.

## Verification

- `npx vitest run packages/h2a-runtime/src/structured-gateway.test.ts packages/h2a-runtime/src/restore.test.ts packages/h2a-runtime/src/restore-launch.test.ts` — 42 passed.
- Same command plus `packages/h2a-runtime/src/llm-mesh.test.ts` — 52 passed, 2 base failures from stale pre-facade expectations (`google` legacy provider and credential round-trip); neither file is changed here.
- `npx tsc -b packages/h2a-runtime --pretty false` — blocked by two base `e49cd57a` errors outside this diff: incomplete `RelaunchCandidate` projection and missing `updateSessionToken` export.
- `git diff --check` — clean.
- `git diff --name-only e49cd57a --` over tmux/status-surface files — empty; #131 remains untouched.
