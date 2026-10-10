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

Client, host and supervisor unit fixtures use explicit private sockets/registries
or fake hosts; they now also require the common environment guard. The remaining
native candidates use injected transports, fake spawners, complete adapter mocks
or pure selector/registry data. They cannot reach the default host. Launch-guard
child fixtures contain empty session ownership and execute no native stop.
No owner path was probed to establish this audit: unsafe paths are lexical
negative cases, and alias fixtures are private.
