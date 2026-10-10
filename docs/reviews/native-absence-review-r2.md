# Native absence independent review R2

Scope: fix R2-F01 through R2-F05 from `review-sol2.md`, one commit per
finding, then rebase onto `origin/main` at `5ca5c7bc` and qualify without skips.
No push, PR, release, tag, owner host/session/state access or `.track` writes.
Receipts are retained under `.qual-tmp/builder/evidence/r2-*`.

## R2-F01: isolation at the real-operation boundary

RED: `r2-f01-red.log` fails because the previous shared guard accepts a
missing native socket. GREEN: the strict guard rejects missing, empty,
relative, external and escaping-symlink paths for all five required variables;
an unsafe child environment cannot execute its marker-writing operation.
Real attach/stop reuse tests supply and restore a complete fixture environment.
Real host/op child launchers validate the environment and explicit socket and
registry arguments immediately before spawning. Outer PTYs validate their env.

Fleet tests explicitly requesting the default generations validate both
effective default socket paths under their private XDG runtime. They do not
substitute a single-endpoint override, which would invalidate Phase A evidence.

## Test-tree isolation audit

The repository test tree was searched for native host/op entry points, native
clients/supervisors, registry liveness and native adapter calls, including
partial mocks. The raw inventory is `r2-f01-audit.txt`.

Tests that could reach owner resources before R2-F01:

| Test | Unprotected surface |
| --- | --- |
| `packages/h2a-runtime/src/native-host-reuse.test.ts` | Real attach/stop and default native inventory; only config home overridden |
| `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts` | Real host/sidecar/op with inherited HOME/XDG; minimal inner PTY env |
| `packages/h2a-runtime/src/native-terminal/terminal-modes.functional.test.ts` | Real host journal with inherited HOME/XDG; outer attach/PTY env |
| `packages/h2a/test/pty-native-messaging.test.js` | Real host journal and inherited HOME/XDG; in-process adapter |
| `packages/h2a/test/m02-drive-characterization.test.js` | Real host journal and inherited HOME/XDG; default tmux server |
| `packages/h2a/test/m04-wake-characterization.test.js` | Real host journal and inherited HOME/XDG; default tmux server |
| `packages/h2a-runtime/src/index.test.ts` | Partial native adapter mock leaves real native functions available |
| `packages/h2a-runtime/src/conv-guard-wiring.test.ts` | Partial spawn mock passes unrecognized native operations through |
| `packages/h2a-runtime/src/native-terminal/process.functional.test.ts` | Existing suite guard omitted socket requirement and did not recheck each real spawn |
| `packages/h2a-runtime/src/native-terminal/server.test.ts` | Existing suite guard omitted socket requirement and did not recheck stale-host spawn |
| `packages/h2a-runtime/src/native-terminal/journal.test.ts` | Existing child guard omitted native socket; ancestor writes addressed separately in F02 |
| `packages/h2a/test/native-inventory-absence.test.js` | Existing guard omitted effective default sockets; ancestor writes addressed separately in F02 |
| `packages/h2a/test/native-host-generations.test.js` | Existing guard omitted effective default sockets |
| `packages/h2a/test/runtime-restore-native.test.js` | Real restore dry-run inherits the native socket override and XDG state/config despite private HOME/runtime |

The PTY pair also bounds Git discovery at its private fixture. Otherwise moving
previous `/tmp` workspaces under the checkout makes both same-host terminals
share the enclosing repository's durable workspace id and fallback identity.
Its first post-rebase qualification fails the second terminal's workspace
assertion; the corrected fixture retains separate identities and round trips.
The CLI wiring suite also owns a complete private environment and registry;
it no longer shares `/tmp/registry.json`. Its full post-rebase run checks the
launch wiring introduced by #313 without requiring an exact options-object
shape that excludes the new creation-attempt callback.

Client, host and supervisor unit fixtures use explicit private sockets/registries
or fake hosts; they now also require the common environment guard. The remaining
native candidates use injected transports, fake spawners, complete adapter mocks
or pure selector/registry data. They cannot reach the default host. Launch-guard
child fixtures contain empty session ownership and execute no native stop.
No owner path was probed to establish this audit: unsafe paths are lexical
negative cases, and alias fixtures are private.

## R2-F02: validate ancestors before fixture mutation

RED: `r2-f02-inventory-red.log` observes a new `q*` directory and `ws` in
the external private canary; `r2-f02-journal-red.log` observes a new `j*`
directory despite refusal. GREEN: both canaries remain empty. Inventory checks
both its root and `ws` ancestor before creating any fixture directory; journal
checks its parent before `mkdir`/`mkdtemp` and validates its full environment
before creating HOME/XDG directories. The shared directory constructor also
protects generation, isolation and reuse fixtures. An aliased qualification
root is refused even if its target is outside the owner's known paths.
The additional `r2-f02-metadata-red.log` observes metadata reads at an external
canary before refusal. `r2-f02-metadata-green.log` proves that direct outside
paths and escaping aliases are refused before inspecting their target metadata.

## R2-F03: independent, bounded journal delivery

RED: `r2-f03-red.log` fails the 1,500 ms SIGTERM exit bound with an actual
writer blocked indefinitely in `openSync` by `Atomics.wait`. GREEN:
`r2-f03-green.log` passes all 20 journal tests without skips. The blocked
writer is observed, the host still answers ping, host callbacks perform no
journal disk operation, and both host and its writer terminate.

Every observation, including terminal exceptions and actual exit, is queued to
an independent writer process. Its coordinator delegates all journal I/O to a
thread, so it can enforce a 100 ms drain deadline even on blocked storage.
The host never refs that writer; its optional graceful flush also has a 100 ms
deadline. Fatal Node semantics are unchanged. Final delivery is best effort
and may complete just after host exit; tests await the observed final entry.
The mailbox remains bounded to 64 entries and diagnostic stacks to 32 KiB.
No PID watcher synthesizes a lifecycle event.
Real contention exposed a second interaction: stdio and journal IPC are Unix
socket pairs, so the old scan treated an unbound contender as an active host.
The scan now verifies the FD inode against its Unix table and the canonical or
PID-attributed staged native address. Unreadable Unix tables remain unknown;
unlinked real native listeners still block a second writer. The two regression
REDs in `r2-f03-transport-red.log` distinguish transport-only sockets and an
unreadable Unix table; the complete absence and contention suites qualify both.
Process-functional checks identify the fixed journal coordinator separately
from the two real PTYs, verify reconnect/operations create no additional Node
processes, and observe the coordinator terminating after host death.

## R2-F04: canonical diagnostic file allowlist

RED: `r2-f04-red.log` has four sentinel leaks: existing traversal target,
symlink to an external regular file, directory disguised as a code file and
an internal symlink alias. The sentinel is explicitly absent from environment
values. GREEN: `r2-f04-green.log` passes all 24 journal tests without skips.
Stack locations and the trusted entry point are canonicalized, containment is
checked on canonical paths, and only regular files are retained. Serialization
uses the verified canonical location, so even an allowed internal alias cannot
retain arbitrary path text. These filesystem checks run on the writer side.

## R2-F05: relevant rollback-only mutation evidence

The former A F03 RED against `656c1f89` is withdrawn: that version did not
implement the injection and failed with `Missing expected rejection`.
`scripts/qualify-native-owner-rollback.mjs` now mutates the current compiled
server by removing only its published-inode rollback block, preserving the
owner-write injection byte for byte. The same test observes initial injection,
endpoint retention and retry outcome before asserting either final effect.

RED: `r2-f05-red.log` reports `socketLeftBehind: true`, `restarted: false`
and the unattributable stale-socket retry refusal. GREEN: `r2-f05-green.log`
passes with `socketLeftBehind: false`, `restarted: true`. The runner checks
the exact failure reason, rejects `Missing expected rejection`, stores the
removed block and SHA-256 hashes in `r2-f05-mutation.json`, and restores the
original build in `finally`. Both runs contain one test and zero skips/TODOs.

## Final qualification protocol

After rebasing onto `5ca5c7bc` (#313), run the full absence/generation/isolation
selection with the required historical host, all journal/process/server/client/
op/fleet/native-host/reuse tests, drive and terminal-mode qualification (#314),
and all concrete PTY messaging/M02/M04 tests. Process-functional qualification
includes the real native socket publication-contention cases. These cases
do not qualify #312, which concerns MCP identity recovery. Qualify
`mcp-identity-burst.test.js` and `mcp-startup-contention.test.js` separately
with their required private seed on the final SHA (R3-F03). Re-run the rollback
mutation on the rebased build. Use one worker and private HOME/XDG/socket/tmp/
tmux paths throughout. Final results, commit mapping and final SHA are recorded
in the owner's French completion report; machine receipts are `r2-final-*`.
