# Feature: native multi-session terminal host foundation

## Objective

- [ ] Establish a typed, bounded terminal replay contract for a future single-process multi-session PTY host.
- [ ] Prove independent PTY lifecycle and fail-closed controller arbitration without changing the tmux default.

## Scope / Guardrails

**Allowed Paths (implementation scope)**

- [ ] `BRANCH.md`
- [ ] `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md`
- [ ] `docs/reviews/native-terminal-host-lot1.md`
- [ ] `packages/h2a-runtime/src/native-terminal/**`

**Forbidden Paths (must not change)**

- [ ] `.track/**`
- [ ] `package.json`
- [ ] `package-lock.json`
- [ ] `Makefile`
- [ ] `docker-compose*.yml`
- [ ] `.cursor/rules/**`
- [ ] `packages/h2a-runtime/src/tmux.ts`
- [ ] production terminal backend call sites

**Conditional Paths (require a recorded BRxx-EXn exception)**

- [ ] `packages/h2a-runtime/src/index.ts`
- [ ] `packages/h2a-runtime/src/run.ts`
- [ ] local-server transport and supervision files

## Plan / Todo (lot-based)

- [x] **Lot 1 — sequenced bounded replay**
  - [x] Add `replay-buffer.ts` with monotonic session-local sequence assignment and a strict byte budget.
  - [x] Add `replay-buffer.test.ts` for ordered replay, eviction gaps, oversized chunks and invalid cursors.
  - [x] Gate: focused replay tests and runtime TypeScript check pass.
- [x] **Lot 2 — independent multi-session PTY lifecycle**
  - [x] Add host create/list/stop lifecycle over injected `PtySpawner` without transport or daemon logic.
  - [x] Add host tests proving two PTYs have independent output, exit and stop state.
  - [x] Gate: focused host tests and runtime TypeScript check pass.
- [x] **Lot 3 — controller epoch and versioned contract**
  - [x] Add single-controller acquisition with an incrementing epoch and observer-only attachment.
  - [x] Reject stale input and resize epochs through an in-process typed contract.
  - [ ] Gate: focused native-terminal tests, runtime suite and root typecheck pass.

## Feedback Loop

- [ ] Stop for owner decision before adding a local socket, switching the default backend or claiming Greywall enforcement.
- [ ] Record any required out-of-scope path as a BRxx-EXn exception with reason, impact and rollback.
- [ ] Re-run consensus review with complete author metadata before marking this PR ready.
