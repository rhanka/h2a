# MH-L4 — attachment ownership and admitted operations

## Objective
- [x] Implement spec v7 §6.6–6.8: ownership, checkpoints, wake, conforming writers, launch receipts and drain.
- [x] Freeze executable contracts consumed by MH-L3; product acquisition/restoration remains .8.

## Scope / Guardrails
- [x] Branch feat/0.98.7-mh-l4 from c8a11016; main untouched; English conventional commits without trailers.
- [x] Targeted Node 22/24 tests, temporary HOME/XDG/store, no skip, nominal red/green and mutation proofs.
- [x] Prefix-sensitive integration from git archive plus npm ci under umask 022.
- [x] No installed h2a/dist, operator state, unrelated process, Python, version bump or publication.

## Branch Scope Boundaries
- [x] Allowed: runtime/handover/**; local-files/{store,presence,launch-index}.ts; mcp/{notifications,sessions,server,stdio,agent-launch,payload-store}.ts; mirror/serve.ts (audited mirror-seq writer); drive/inbox-wake.ts; blockage/registry.ts; identity/{bindings,live,migration}.ts; mcp-central{,-attachment}.ts; cli.ts internal seam; MH-L4 tests/scripts/docs; docs/plan/mh-l0/schemas.json ($defs regenerated, old definitions unchanged); BRANCH.md.
- [x] Conditional: mcp-run-async.test.js retains one-runtime/one-brief oracles while requiring parameter conflicts per §6.7.
- [x] Conditional: mh-l2-image.test.js source factory receives private maintained fixture proof; cold-cycle assertions preserved, successor remains production starter.
- [x] Conditional: additional business writers only when the audit proves fencing necessary; no native-terminal implementation.
- [x] Forbidden: main, .track, full suite, H4/live coordinator, MH-L3 shim/replay/catalogue work, gateway, package metadata.
- [x] BR-L4-EX1: cohesive protocol/test changes and evidence archives may exceed 150 lines / 15 files; selective staging; rollback by git revert.
- [x] No installed harness/Track recorders. Owner confinement overrides installed h2a review dispatch; conductor owns cross-host review.

## Lot 1 — Ownership and writer authority
- [x] Durable ownership and epoch CAS, independent operation rights, maintained writer-closure evidence.
- [x] Mutation guards inside critical sections, janitor revalidation and pure preparatory reads.
- [x] Gate: mh-l4-ownership.test.js and mh-l4-writers.test.js red/green.

## Lot 2 — Checkpoints, notifications and wake
- [x] Complete immutable checkpoints, lost ACK, producer/delivery/application receipt separation.
- [x] Wake intent before injection, serialized wakes, no automatic unknown replay.
- [x] Gate: mh-l4-checkpoint.test.js and mh-l4-wake.test.js red/green.

## Lot 3 — Launch receipts and drain
- [x] Atomic attachment/name reservation, argument conflict, token-bound receipts, no duplicate spawn/brief.
- [x] Drain children/briefs/callbacks/effects after launching reply; durable owner-directed completion.
- [x] Gate: mh-l4-launch.test.js and mh-l4-integration.test.js red/green.

## Lot 4 — Verification and delivery
- [x] Mutation proofs and explicit files on Node 22 and 24.
- [x] Scoped typecheck and affected existing tests; no full suite.
- [x] Frozen contracts/audit and French qualification with gaps and agent-hour/review estimates.
- [x] Delivery prepared for the authorized fast-forward push; its remote receipt and requested mhl4-report.md are recorded outside this checkout after push.

## Feedback Loop
- [x] bwrap fails before execution; reviewed commands confined to authorized files/private tests.
- [ ] Conductor independent review and MH-L5/MH-L8 qualification remain visible.

## Exact-source qualification
- [x] Source 008f2394c975ee84986dd9896be17a2b3fd0c95c archived into /tmp/mh-l4-release-check-RvMsgD; npm ci/build under explicit umask 022.
- [x] Node v22.22.1 and v24.21.0: 27 MH-L4 tests, 89 scoped regressions, 33 attachment regressions and 4 format tests per profile; all passed with zero skip.
- [x] Initial Node22 attachment idle ECONNRESET retained as evidence, then reproduced deterministically by slow synchronous preparation and fixed at durable readiness without raising the 100 ms fixture threshold.
- [x] Final 23-mutation campaign per profile: every mutant red code 1 and restored source green code 0; all tracked source/test/script bytes restored identically.
- [x] Local ownership/effects critiques re-read the final fixes without a remaining factual blocker; cross-host independent review is still required, no FUSIONNABLE claim.
