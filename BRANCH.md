# Track: reopen lifecycle, persisted RACI, scoped report, blocker owner

## Objective

- [ ] Deliver four additive Track capabilities in one draft pull request.
- [ ] Preserve append-only event history and every existing producer contract outside the declared new verbs.

## Scope / Guardrails

**Allowed Paths**

- `BRANCH.md`
- `tmp/report-to-track.md`
- `packages/track/src/cli/**`
- `packages/track/src/events/**`
- `packages/track/src/ingest/**`
- `packages/track/src/model/**`
- `packages/track/src/read/**`
- `packages/track/src/report/**`
- `packages/track/src/state/**`
- `packages/track/src/track.ts`
- `packages/track/src/*.{test.ts,ts}` only where each lot needs its regression coverage.

**Forbidden Paths**

- `.track/**`
- `Makefile`
- `docker-compose*.yml`
- `.cursor/rules/**`
- any package outside `packages/track`

**Conditional Paths**

- `package-lock.json` only if a command proves this package’s declared dependencies require a lock update; otherwise unchanged.

## Lot 1 — reopen a closed item

- [x] Add an additive reopening event with declared motive and non-blank reason; reject rejected items.
- [x] Derive the prior realization from folded state and apply reopening atomically only to a correctable closure.
- [x] Re-block only dependents whose reference was reopened and not delivered again; preserve acceptance-driven behavior otherwise.
- [x] Record reopening in the lifecycle trace and document that motive is recorded, not verifiable without an owner-UAT marker.
- [x] Add ingest kind, binding, workspace-contained contract-minor bump and honest pinned-gate updates.
- [x] Add `item reopen` and show the trace through `item show`.
- [x] Test: malformed, foreign, unclosed, and valid reopening; dependent projection; event/fold/CLI/ingest contracts.
- [x] Gate: illegal reopening changes neither realization nor trace.

## Lot 2 — assign RACI on an existing item

- [ ] Add a past-tense RACI event with last-write-wins folding and an additive CLI write path.
- [ ] Preserve omitted axes and expose no clear operation.
- [ ] Trim at every write path; reject empty, whitespace-only, and separator-only assignment values in the shared facade.
- [ ] Preserve legacy state key ordering and padded legacy actor values during replay.
- [ ] Keep `item.create` producer compatibility, including its pre-existing blank-actor acceptance.
- [ ] Test: direct ingest, CLI, facade, ordering, trim, and legacy replay contracts.
- [ ] Gate: an attempted blank assignment cannot alter an existing assignment.

## Lot 3 — render one reproducible scope report

- [ ] Resolve role-container selectors by id, assigned code, or derived label and reject unknown/ambiguous selectors loudly.
- [ ] Project from one event-log snapshot so rows and revision attest the same head.
- [ ] Render the prescribed FAIT / À-FAIRE / DÉCISIONS / RECOMMANDATION shape and scoped handle command.
- [ ] Redact every owner-facing string at the rendering boundary and render blockage as a sibling row using its target title.
- [ ] Preserve report arithmetic and every named golden fixture unchanged.
- [ ] Test: scope resolution, stable snapshot, no-ULID owner-facing output, blocked-row presentation, command scope, and golden preservation.
- [ ] Gate: no rendered owner-facing field contains a ULID.

## Lot 4 — pass blocker owner through the CLI

- [ ] Read `--owner`, trim it, reject blank values, and pass it into blocker-open payloads.
- [ ] Leave general unknown-flag behavior unchanged.
- [ ] Test: persisted owner, trimming, and blank-value rejection.
- [ ] Gate: `blocker raise --owner` records the supplied counterparty.

## Feedback Loop

- [ ] Owner UAT remains required before any item is claimed done.
- [ ] Review is delegated by the owner to two independent legs after this branch is ready.
- [ ] Report unrelated findings without adding them to this diff.
