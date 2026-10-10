# Native absence review R3 corrections

Scope: R3-F01, R3-F02 and R3-F03 from `review-sol3.md`, one commit per finding.
No push, PR, publication, tag, owner host/session/state access or `.track` writes.
Receipts: `.qual-tmp/builder/evidence/r3-*`. Tests run sequentially with private
HOME/XDG/socket/tmp/tmux paths. Final-SHA receipts are retained outside Git so
qualification does not change the SHA it qualifies.

## R3-F01: guard every real native test launch

RED: `r3-f01-probe-red.log` intercepts the new real `op.js probe` before
execution and fails the unexpected-spawn assertion in the destructive suite.
`r3-f01-guard-red.log` disables only the test-boundary installation; a fake
native entry point can then execute without HOME, and an indirect CLI child
bypasses the guard. No production native entry point runs in either RED.
GREEN: `r3-f01-guard-green.log` passes all four guard tests; the synchronous,
asynchronous, exec and fork APIs reject every missing private environment
variable before execution. A replaced child environment cannot escape the
boundary. `r3-f01-caught-red.log` demonstrates that a production catch could
hide an unsafe attempt; `r3-f01-caught-green.log` proves the same child now exits
nonzero even after resetting its exit code. Vitest checks the violation ledger
after every test; Node also checks it at process shutdown. Deliberate guard
canaries explicitly assert an expected refusal and cannot launch the operation.
`r3-f01-green.json` records 17 passing tests and two existing policy
TODOs, zero failures or skips, across the three partial-mock suites.

The new three-state probe is explicitly mocked in the destructive, host
selection and stop TOCTOU suites. Unexpected native calls are blocked, counted
and asserted absent after each case. Each suite installs and restores the
complete fixture environment. The existing attach and dead-tmux policy debt
cases are named TODOs, not executed/passing tests or hidden skips.

The boundary is installed by the root Node runner, both runtime Vitest configs,
the separate Track Vitest config
and the shared fixture helper. It checks effective child environments and
explicit socket/registry arguments at the actual spawn boundary. Node children
carry the preload even when callers replace their environment. The production
runtime imports none of this test-only code.
`r3-f01-track-config-red.log` exposes the missing Track setup before correction;
the repo-wide guard test checks all three default Vitest configs.

### Test-tree audit

Raw searches: `r3-f01-audit.txt`, `r3-f01-adapter-candidates.txt`,
`r3-f01-runtime-candidates.txt`, `r3-f01-mcp-launch-candidates.txt`.

Additional paths missed by the R2 audit:

| Test | Previously inherited native surface | Correction |
| --- | --- | --- |
| `destructive-act-unknown-failclosed.test.ts` | New `nativeSessionState` precheck, real `op.js` through partial spawn mock | Explicit probe mock, no-native-spawn assertion, full guarded private environment |
| `host-selection-invariants.test.ts` | Same partial native and spawn mocks | Same protection |
| `stop-reread-toctou.test.ts` | Same partial native and spawn mocks | Same protection |
| `restore-dead-session-recovery.test.js` | Real dry-run restore inventory with only HOME/config overridden | Private fixture root and complete guarded environment, restored in `finally` |

Previously guarded real entry paths were re-audited: native inventory,
generations, restore-native, PTY messaging, M02, M04; runtime native-host reuse,
process, server, journal, drive and terminal-mode fixtures; and the index and
conversation-guard partial mocks. Their direct helper launches now also pass
through the mandatory boundary, including production adapter/supervisor calls.
Outer node-pty launches retain their immediate private-environment assertions.
Client/fleet/op/supervisor units use fixture sockets or injected spawners.
Restore launch/live/wiring units mock the native inventory; ownership, wake
and launch-guard units mock the transport/adapter; host-decision, restart and
lease units inject their process views. Binary help tests exit before probing;
dispatch tests substitute the runtime; MCP run tests inject fake launchers.
These paths cannot spawn an owner native operation with inherited state.

## R3-F02

RED: `r3-f02-red.log` observes two canonicalization attempts on an unrelated
host's canary socket/directory. The global `/proc` is replaced with a synthetic
foreign row for this reproduction; interception stops both attempts before
external metadata is actually read. GREEN: `r3-f02-green.log` passes seven tests,
including the no-external-metadata canary, optional-environment preservation,
an external-process-root refusal and the R3-F01 guard regressions.

The existing `H2A_TEST_PROC_ROOT` injection now receives a private process view
from the test helper. Only fixture-started processes are registered. Proc
directories are pinned by descriptors, avoiding child-PID reuse; a detached
host installs its own pin before its launching parent exits. Child exit removes
its entry and closes the descriptor. Error-injection process trees remain
unchanged. Threads do not replace their coordinator's process pin. Views are
fresh for each campaign, shared across test module contexts, and the native
inventory/generation fixtures await their registered writer processes before
removing the private tree. In-process tests and Node/PTY children receive the same view.
As an additional test-only boundary, scanner canonicalization refuses a path
outside the qualification root before consulting its metadata. Production
`server.ts` and its fail-closed global process scan are unchanged.

`r3-f02-native-green.log`: 47 passing tests, zero failures/skips/TODOs, including
historical and current generations, lost socket names, surviving hosts without
owner sidecars, deleted aliases, unreadable process fixtures, and the newly
isolated restore dry-runs. `r3-f02-runtime-green.json`: all 34 server/process
tests pass, including publication contention and real PTY cleanup. The first
runtime check exposed optional undefined values being assigned to `process.env`;
the helper now installs only the two process-view variables and the regression
case preserves an absent `H2A_ROOT`. Final-SHA campaigns run sequentially.
The first complete qualification also exposed an `ENOTEMPTY` teardown race with
the independent journal writer. `r3-f02-teardown-green.log` verifies the dead-host
restore and pre-upgrade cases after adding a bounded wait for fixture processes.
An initially relative preload argument broke MCP workers after their cwd changed;
the qualification launcher now uses the absolute preload path, and
`r3-preload-absolute-green.log` passes all five PTY messaging cases.

## R3-F03

Pending mandatory private-seed MCP qualification and corrected attribution.
