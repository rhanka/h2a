# Native inventory cold and stale endpoint hotfix

Target: `fix/native-inventory-cold-and-stale` from v0.98.1 (`origin/main`).
No release version change, push, PR, publication, tag, or `.track` mutation.

## Root cause

In v0.98.1, `packages/h2a-runtime/src/native-terminal/fleet.ts:24` made every
failed known endpoint connection an incomplete inventory. `op.ts:143` passed
both historical and lf1 endpoints without an independent absence classifier.
`op.ts:165` considered only a missing parent directory cold: a failed probe
or an earlier host could leave the directory present and permanently prevent
historical host initialization/reclamation. The CLI's `index.ts:6327` then
refused the launch because an incomplete inventory could not prove absence.

## Change and safety

Only ENOENT and ECONNREFUSED qualify for independent absence verification.
The existing private-directory and abstract publication lock protects a fresh
socket check and the identity check. A durable private `<socket>.owner` record
binds socket device/inode to PID, process start time, boot and PID namespace.
An existing refused endpoint must match that identity and its owner must be
proven dead through the existing `defaultOwnerHostProbe`. PID recycling uses
start-time comparison. Neither timestamps nor a bare PID establish death.

Pre-upgrade historical hosts use their durable PTY attribution instead. All
matching owners must have a start time, a matching process frame and a dead
verdict. Their endpoint proof is persisted under the publication lock before
the supervisor can reap/prune the last PTY row. A missing endpoint also checks
for live/unprovable durable owners. The inventory never removes a socket;
publication rechecks the proof and reclaims the stale inode under the lock.

Absent endpoints are excluded from uncertainty and reported as `absent: true`,
`reachable: false`. Live coexistence, launchFence certification, same-name
admission and ambiguous-owner routing remain intact. Timeout, invalid ping,
permission/security errors, malformed identities, unmatched inodes and
unattributed refused sockets remain unknown. Refusals carry the endpoint,
original failure and safe recovery, without host-restart advice. The ordinary
CLI preserves the probe detail without running the same failed probe twice.

## RED to GREEN

All native processes use private fixture endpoints and isolated runtime,
configuration, registry and tmux directories. Only fixture-created hosts are
stopped. The historical artifact is the existing build of `89bbd9af^` in
scratchpad `host-skew/legacy-host`; the required-legacy flag prevents L0 skips.

The production 0.98.1 op/server/fleet bytes were compiled from `git show HEAD`
for RED, then restored to the corrected build for GREEN. Logs live in ignored
`tmp/hotfix-evidence/`.

| Scenario | RED | GREEN |
| --- | --- | --- |
| Cold endpoint directory | Probe incorrectly unknown | Probe dead; historical launch succeeds, including ordinary CLI after probe creates the directory |
| SIGKILL historical host, stale socket | Probe incorrectly unknown | Probe dead; new generation starts; duplicate same-name creation is refused and inventory has one writer |
| lf1 absent, fenced historical host alive | Inventory incorrectly incomplete | Inventory complete; launch succeeds on unchanged historical generation |
| Both live and duplicate owners | Existing control passes | Both generations unchanged; duplicate owner remains ambiguous |
| SIGSTOP host | Existing unknown/refusal control passes | Unknown, typed refusal, no create; endpoint, timeout and recovery present |
| Host died before session restore | Probe incorrectly unknown | Restore's real batch-snapshot lookup reports dead; native replacement succeeds |
| Pre-upgrade historical host killed | Probe incorrectly unknown | Durable PID/start-time proof survives cleanup; replacement succeeds |
| Cold MCP h2a_run | Existing control passes | Starts on historical endpoint and delivers exactly one brief |
| Stale MCP h2a_run | Typed not-started refusal | Starts on historical endpoint and delivers exactly one brief |
| Live certified owner with missing pathname | Additional regression | Unknown; no replacement socket; same connection still pings |
| Live PID versus recycled PID | Additional regressions | Matching start time refuses; changed start time proves original owner dead |
| Missing/malformed owner identity with refused socket | Additional regressions | Unknown and no creation |

RED baseline: 5 failures / 2 passes in `red-real.log`. MCP/restore baseline:
2 failures / 1 pass in `red-mcp-restore.log`. An initial RED run lacked the
node-pty native binary; `npm rebuild node-pty` repaired the fixture dependency,
and only the subsequent real-host RED run is qualification evidence.

GREEN targeted Node: **30 passed**, no failure, skip or TODO (`node-final.log`).
GREEN native runtime: **12 files, 139 passed, 2 skipped**, no failure
(`runtime-green.log`), covering the existing native-terminal functional suites,
host, server, client, supervisor, op, fleet, drive and native reuse.
Final diagnostic/op siblings: **22 passed** (`diagnostic-final.log`).
`npm run build:h2a` and `git diff --check` passed.

Existing fixtures were updated where their premise changed: a missing cold
host is dead for attach, an unreachable living host is represented by SIGSTOP,
and competing-supervisor adoption now publishes after owner death with a
separate fixture registry so the adopting supervisor still owes containment.
The transport-only replacement test explicitly clears fixture attribution;
production does not discard a live identity. Publication-race qualification
now creates its stale socket by killing a real isolated host.

## Final root gate

One `npm test` invocation, after a read-only host process check returned no
active h2a test runner. Runtime/config/tmux isolation is supplied by
`tmp/hotfix-evidence/run-isolated.mjs`.

The gate passed (exit 0): Node **2,483 passed / 21 skipped / 21 TODO**, zero
failures (2,525 tests); Track **87 files / 1,193 passed**, zero failures.
This is the root gate's documented coverage; the native runtime suites above
are a separate targeted gate. Receipt: `tmp/hotfix-evidence/full-suite.log`.

## Files changed

- `packages/h2a-runtime/src/native-terminal/server.ts`: durable endpoint
  identity, locked death proof, guarded publication/reclamation and cleanup.
- `packages/h2a-runtime/src/native-terminal/fleet.ts`: distinguish proven
  absence from unknown inventory contributions.
- `packages/h2a-runtime/src/native-terminal/op.ts`: use the proof for inventory
  and launch selection; preserve exact failing endpoint in diagnostics.
- `packages/h2a-runtime/src/native-host.ts`: actionable typed refusal detail.
- `packages/h2a-runtime/src/index.ts`: preserve native probe detail and typed
  JSON refusal on the ordinary run admission path.
- `packages/h2a/test/native-inventory-absence.test.js`: real isolated cold,
  stale, coexistence, unknown, PID identity, CLI, MCP and restore regressions.
- `packages/h2a/test/native-host-generations.test.js`: use SIGSTOP to model a
  genuinely unknown endpoint; retain required historical L0 and phase A tests.
- `packages/h2a-runtime/src/native-host-reuse.test.ts`: cold native attach
  remains refused on its recorded host with the correct dead classification.
- `packages/h2a-runtime/src/native-terminal/server.test.ts`: real stale-host
  publication race and explicit transport-only replacement fixture.
- `packages/h2a-runtime/src/native-terminal/process.functional.test.ts`:
  preserve adoption-containment qualification after the new death gate.
- `BRANCH.md`: current hotfix scope and verification constraints.
- `docs/reviews/native-inventory-cold-and-stale.md`: qualification evidence.
