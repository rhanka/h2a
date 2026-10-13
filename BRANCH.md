# MH-L2 — authority and authenticated cold succession

## Objective
- [x] Deliver author implementation of spec v7 MH-L2 only from 5cb66f7e with ratified QF A+B.

## Scope / Guardrails
- [x] Own branch feat/0.98.7-mh-l2; main untouched.
- [x] No installed h2a/dist, real state or unrelated process access.
- [x] Targeted tests in mkdtemp HOME/XDG/store, Node 22/24, red/green evidence, no skips or Python.
- [x] Ratifications recorded; real Claude qualification belongs to MH-L8.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/src/runtime/handover/**, mcp-central*.ts, packages/h2a/src/{bin,cli,cli-contract,index}.ts, packages/h2a-runtime/src/{central-mcp,proc-identity}.ts, packages/h2a/test/mh-l2*, scripts/mh-l2*, docs/plan/mh-l{1,2}/**, BRANCH.md.
- [x] Conditional: mh-l1-shim.test.js private physicalPrefix fixture required by L2 authority; assertions unchanged.
- [x] Conditional: CLI contract/map, their named tests and golden counts change together for central stop (§6.5).
- [x] Conditional: docs/plan/mh-l0/schemas.json regenerated for new L2 records; frozen L0 definitions unchanged.
- [x] Forbidden: main, installed state, native-terminal implementation, .track, full suite, version/publication, H4 coordinator, gateway, live product switch.
- [x] BR-L2-EX1: cohesive protocol/test commits and raw evidence archives may exceed 150 lines (evidence also 15 files); selective staging, rollback by git revert.
- [x] No Makefile: commit directly; no installed harness recorders or shared Track imports.

## Lot 1 — Authority and selection
- [x] Reuse exact .6 identity leaf; preclaim before writers through durable ready; marker generation/epoch/inode CAS.
- [x] Common absolute selection, pause and successor reservations for starters; QF npm router seam.
- [x] Gate: mh-l2-authority.test.js and mh-l2-starters.test.js red then green.

## Lot 2 — Authentication
- [x] Private v2 secret distinct from decoy; connection challenge, bounded expiring nonces, signed requests/frames.
- [x] No bearer admission or unchallenged application body on new TCP connection.
- [x] Gate: mh-l2-auth.test.js red then green.

## Lot 3 — Administration and cold stop
- [x] Durable serialized steps, idempotence/digest conflicts, barriers and drain.
- [x] Internal irreversible STOP_COMMITTED, lost ACK reconciliation, operator pause and armed deferred stop.
- [x] Shared successor budget ≤3 before spawn; refuse live/unknown candidates; pins preserved and explicit failure.
- [x] Gate: mh-l2-cold.test.js red then green.

## Lot 4 — Foreground integration and delivery
- [x] Raccord foreground, shim, run/restore, explicit/auto serve and operator routes.
- [x] Gate: seven explicit MH-L2 files, Node 22/24; scoped typecheck and required L0/L1 files.
- [x] Resume regression: L1 shim prefix_owner_mismatch red; private physicalPrefix fixture green on Node 22/24; no assertion weakened.
- [x] Own branch delivery: fast-forward push, conductor review handoff, French mhl2b-report.md with estimates; final receipt recorded in external report.

## Feedback Loop
- [x] bwrap userns unavailable; approved worktree/doc operations with private test environment.
- [x] Final .6 byte freeze and real-client qualification remain conductor/MH-L8 gates.
- [ ] Conductor independent review of final L2 SHA pending; no consensus claimed by author.
