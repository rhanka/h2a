# MH-L1 — 0.98.7 integration and packaging prototype

## Objective
- [x] Deliver only spec v7 §12 MH-L1 on cf690fe2, integrating #316 (25117303).

## Scope / Guardrails
- [x] Own branch feat/0.98.7-mh-l1 created from feat/0.98.7-mh-l0; main untouched.
- [x] Owner state, installed h2a/dist, native sockets and unrelated processes forbidden.
- [x] Targeted test files, private temporary HOME/XDG/stores; no Python or install scripts.
- [x] Node 22 minimum; Node 24 qualification belongs to the release matrix.
- [x] No live switch, H4 adoption/entrypoint decision, gateway or native restart.

## Branch Scope Boundaries
- [x] Allowed: #316 integration paths, packages/h2a/src/runtime/mcp-central-*, packages/h2a/src/bin.ts, packages/h2a/src/runtime/mcp/transport/**, packages/h2a/src/runtime/handover/{image,schemas}.js, docs/plan/mh-l0/schemas.json, packages/h2a/test/mh-l1-*, scripts/mh-l1-*, docs/plan/mh-l1/**, BRANCH.md.
- [x] Forbidden: main, installed state, native-terminal implementation, .track (conductor single writer), full suite, version bump/publication.
- [x] Conditional: packaging prototype is not a release freeze; QF/QC remain owner decisions.
- [x] BR-L1-EX1: preserve #316 history in an integration merge; cohesive integration/vendor/test commits may exceed 150 lines, rollback by git revert.
- [x] No Makefile in this repo: selective staging and git commit directly.

## Lot 1 — Integrate #316
- [x] Merge #316 onto L0 without rewriting source refs or losing L0 contracts.
- [x] Gate: node --test packages/h2a/test/mh-l1-preservation.test.js, assertion red then green.

## Lot 2 — Route before initialize
- [x] Read and retain first initialize; choose by exact clientInfo and qualification observations.
- [x] Replay first message and buffered tail in the same process on stdio or central; no response before choice.
- [x] Preserve exclusions, legacy connector behavior, explicit diagnostics and lightweight graph.
- [x] Gate: node --test packages/h2a/test/mh-l1-routing.test.js.

## Lot 3 — Isolate and integrate transport
- [x] Exercise conversation/workspace/terminal isolation and config preservation with targeted #316 tests.
- [x] Integrate corrected HTTP transport into h2a payload and prove batch correlation/cleanup with actual HTTP.
- [x] Gate: node --test packages/h2a/test/mh-l1-transport.test.js and mcp-central-attachments.test.js (named cases only).

## Lot 4 — Packaging prototype
- [x] Produce repeatable core/runtime payload with exact dependency resolution and published shrinkwrap.
- [x] Retain real node-pty legacy probe, no Python/node-gyp install path; record closure limits explicitly.
- [x] Close L0 R1 with a native digest mismatch vector that kills the missing-guard mutation; Node 20 refused, Node 24 ABI recognized.
- [x] Gate: node --test packages/h2a/test/mh-l1-package.test.js and mh-l0-image.test.js.

## Lot 5 — Delivery
- [x] Review diff/scope, record constrained review status without consensus claim.
- [ ] Push own branch fast-forward and write French mhl1-report.md, agent-hours and review rounds.

## Feedback Loop
- [x] No v0.98.6 tag locally: integrate current owner-mandated L0 base; byte freeze against final .6 remains release gate.
- [x] L0 R2 belongs to MH-L3; R3 QF/QC remain open; R4 installed-h2a review is forbidden by owner confinement.
- [x] Initial shared node_modules lacked workspace-local dependencies: npm ci --ignore-scripts creates checkout-local lockfile dependencies.
- [x] Harness recorders/Track imports are not invoked because they would use installed h2a or shared Track state.
