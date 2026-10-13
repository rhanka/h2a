# MH-L2 — authority and authenticated cold succession

## Objective
- [ ] Deliver spec v7 MH-L2 only from 5cb66f7e with ratified QF A+B.

## Scope / Guardrails
- [x] Own branch feat/0.98.7-mh-l2; main untouched.
- [x] No installed h2a/dist, real state or unrelated process access.
- [x] Targeted tests in mkdtemp HOME/XDG/store, Node 22/24, red/green evidence, no skips or Python.
- [x] Ratifications recorded; real Claude qualification belongs to MH-L8.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/src/runtime/handover/**, mcp-central*.ts, packages/h2a/src/{bin,cli,cli-contract,index}.ts, packages/h2a-runtime/src/{central-mcp,proc-identity}.ts, packages/h2a/test/mh-l2*, scripts/mh-l2*, docs/plan/mh-l{1,2}/**, BRANCH.md.
- [x] Forbidden: main, installed state, native-terminal implementation, .track, full suite, version/publication, H4 coordinator, gateway, live product switch.
- [x] BR-L2-EX1: cohesive protocol/test commits may exceed 150 lines; selective staging, rollback by git revert.
- [x] No Makefile: commit directly; no installed harness recorders or shared Track imports.

## Lot 1 — Authority and selection
- [ ] Reuse exact .6 identity leaf; preclaim before writers through durable ready; marker generation/epoch/inode CAS.
- [ ] Common absolute selection, pause and successor reservations for starters; QF npm router seam.
- [ ] Gate: mh-l2-authority.test.js and mh-l2-starters.test.js red then green.

## Lot 2 — Authentication
- [ ] Private v2 secret distinct from decoy; connection challenge, bounded expiring nonces, signed requests/frames.
- [ ] No bearer admission or unchallenged application body on new TCP connection.
- [ ] Gate: mh-l2-auth.test.js red then green.

## Lot 3 — Administration and cold stop
- [ ] Durable serialized steps, idempotence/digest conflicts, barriers and drain.
- [ ] Internal irreversible STOP_COMMITTED, lost ACK reconciliation, operator pause and armed deferred stop.
- [ ] Shared successor budget ≤3 before spawn; refuse live/unknown candidates; pins preserved and explicit failure.
- [ ] Gate: mh-l2-cold.test.js red then green.

## Lot 4 — Foreground integration and delivery
- [ ] Raccord foreground, shim, run/restore, explicit/auto serve and operator routes.
- [ ] Gate: mh-l2-integration.test.js, scoped typecheck and required L0/L1 files.
- [ ] Push own branch fast-forward; conductor review handoff and French mhl2b-report.md with estimates.

## Feedback Loop
- [x] bwrap userns unavailable; approved worktree/doc operations with private test environment.
- [x] Final .6 byte freeze and real-client qualification remain conductor/MH-L8 gates.
- [ ] Conductor independent review of final L2 SHA pending; no consensus claimed by author.
