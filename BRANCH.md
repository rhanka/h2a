# MH-L0 — 0.98.7 contract foundations

## Objective
- [ ] Deliver only spec v7 §12 MH-L0, including the measured npm BX correction.

## Scope / Guardrails
- [x] Branch feat/0.98.7-mh-l0, base e3fc1a52 (0.98.5); no integration of #316 or .6 here.
- [x] Owner state, installed h2a/dist, native sockets and unrelated processes forbidden.
- [x] Private temporary test directories; targeted files only; no Python.
- [x] Public strategies, CLI routing, native restart and .8 coordinator/verifier forbidden.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/src/runtime/handover/**, packages/h2a/test/mh-l0-*, packages/h2a/test/helpers/mh-l0-*, docs/plan/mh-l0/**, scripts/mh-l0-*, BRANCH.md.
- [x] Forbidden: other runtime files, package versions/dependencies, installed state, main, .track (shared writer), full-suite commands.
- [x] Conditional: QF entrypoint/layout contract provisional until owner ratification; runtime routing belongs to MH-L6.
- [x] BR-L0-EX1: cohesive contract/test commits may exceed 150 lines; one concern, selective staging, rollback by git revert.

## Lot 1 — Canonical bytes and authentication vectors
- [x] Strict RFC 8785 bytes, SHA-256, domain-separated HKDF/HMAC and negative vectors.
- [x] Gate: node --test packages/h2a/test/mh-l0-wire.test.js, red then green.

## Lot 2 — Versioned formats
- [x] Marker, namespace/authority, readiness, requests/frames, evidence, ownership/checkpoint, H4/selection, manifest/native formats.
- [x] Gate: node --test packages/h2a/test/mh-l0-formats.test.js, red then green.

## Lot 3 — Durable private state
- [x] Private reads, exclusive publication, replacement under caller exclusion, fsync and reconciliation errors.
- [x] Gate: node --test packages/h2a/test/mh-l0-state.test.js, red then green.

## Lot 4 — Domain, layout and image audit
- [x] Physical prefix identity, private authority domain and bounded abstract pre-claim.
- [x] Closed/native manifest and no-Python native feasibility.
- [x] Gate: node --test packages/h2a/test/mh-l0-authority.test.js and mh-l0-image.test.js and mh-l0-native.test.js, red then green.

## Lot 5 — Heritage, npm and pair
- [ ] Audit source refs, native relaunch closure, legacy probe, dependencies and pending .6 dist gate.
- [x] Reproduce BX with private prefix/cache, local tarballs/registry; revise U09 and prepare QF dossier.
- [ ] Test-only network peer, evidence and CAS/ACK fault primitives.
- [ ] Gate: node --test packages/h2a/test/mh-l0-npm.test.js and mh-l0-peer.test.js, red then green.

## Lot 6 — Delivery
- [ ] Reconcile scope/evidence/review limitations; recalibrate MH-L1–MH-L8.
- [ ] Push own branch fast-forward; write owner mhl0-report.md in French.

## Feedback Loop
- [x] Final .6 dist unavailable: audit source closure now; U13 byte qualification remains MH-L1/MH-L8.
- [x] QF/QC/QD/QE/QG remain owner decisions; no runtime entrypoint chosen by MH-L0.
- [x] Installed-h2a harness review/recorders conflict with owner confinement: do not invoke; no consensus claim.
