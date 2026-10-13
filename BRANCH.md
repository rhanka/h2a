# MH-L4 — attachment ownership and admitted operations

## Objective
- [ ] Implement spec v7 §6.6–6.8: ownership, checkpoints, wake, conforming writers, launch receipts and drain.
- [ ] Freeze executable contracts consumed by MH-L3; product acquisition/restoration remains .8.

## Scope / Guardrails
- [x] Branch feat/0.98.7-mh-l4 from c8a11016; main untouched; English conventional commits without trailers.
- [ ] Targeted Node 22/24 tests, temporary HOME/XDG/store, no skip, nominal red/green and mutation proofs.
- [ ] Prefix-sensitive integration from git archive plus npm ci under umask 022.
- [x] No installed h2a/dist, operator state, unrelated process, Python, version bump or publication.

## Branch Scope Boundaries
- [x] Allowed: runtime/handover/**; local-files/{store,presence,launch-index}.ts; mcp/{notifications,sessions,server,stdio,agent-launch,payload-store}.ts; mirror/serve.ts (audited mirror-seq writer); drive/inbox-wake.ts; blockage/registry.ts; identity/{bindings,live,migration}.ts; mcp-central{,-attachment}.ts; cli.ts internal seam; MH-L4 tests/scripts/docs; docs/plan/mh-l0/schemas.json ($defs regenerated, old definitions unchanged); BRANCH.md.
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
- [ ] Mutation proofs and explicit files on Node 22 and 24.
- [ ] Scoped typecheck and affected existing tests; no full suite.
- [ ] Frozen contracts/audit, fast-forward push, French report with gaps and agent-hour/review estimates.

## Feedback Loop
- [x] bwrap fails before execution; reviewed commands confined to authorized files/private tests.
- [ ] Conductor independent review and MH-L5/MH-L8 qualification remain visible.
