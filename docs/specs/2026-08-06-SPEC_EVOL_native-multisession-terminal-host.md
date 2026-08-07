# EVOL — Native multi-session terminal host

- **Decision** — build a native terminal-host foundation behind the existing tmux backend.
- **Date** — 2026-08-06.
- **Status** — owner-authorized realization; no default-backend cutover in this branch.

## Problem

The local h2a control plane shells out to tmux for session lifecycle and terminal operations. The
anti-storm fix removes the unbounded status-bar subprocess loop, but tmux still makes routine
terminal control a subprocess protocol. h2a already owns a Node runtime and a `node-pty` adapter, so
one long-lived child can own many PTYs and expose a typed local protocol.

## Decisions

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| HOST-01 | One host generation owns zero or more PTYs in one long-lived Node process. | `NativeTerminalHost` multi-session tests (not yet written). | test | A fatal host crash ends its PTYs, exactly as a fatal failure of the shared default tmux server ends its panes. |
| HOST-02 | The existing local server is the control plane and starts at most one host generation; clients never spawn a host per operation. | local-server integration test (not yet written). | test | Startup supervision is outside the first foundation lot. |
| PROTO-01 | Every output chunk has a host-generation identity and a session-local monotonically increasing sequence. | replay-buffer unit tests plus host integration tests. | test | Sequence continuity does not cross host generations. |
| PROTO-02 | Replay is memory-bounded and reports an explicit gap when requested output was evicted. | `replay-buffer.test.ts`. | test | A gap is reported, not reconstructed; durable transcripts remain owned by the agent CLI. |
| CTRL-01 | One controller lease may write or resize; observers are read-only. Controller changes increment an epoch and stale epochs fail closed. | controller unit tests (not yet written). | test | Multi-user authorization is not introduced here. |
| LIFE-01 | Create, list, attach, input, resize, exit and stop are typed host operations; PTY exit is terminal and idempotently observable. | host lifecycle tests (not yet written). | test | Restore/relaunch semantics remain on tmux until a later migration lot. |
| GREY-01 | The terminal host is not Greywall. A later launch adapter may carry policy identity and measured process identity, while enforcement stays below the PTY host. | adapter contract and enforcement probe (not yet written). | spec-line | This branch creates no new OS guarantee. |
| MIG-01 | tmux remains the default and fallback until parity, soak and explicit owner acceptance. | no production call-site changes in foundation commits. | structural | Coexistence temporarily keeps both implementations. |

## First realization slice

- Define and test the bounded sequenced replay primitive.
- Build an in-memory multi-session host around the injected `PtySpawner`.
- Add controller-epoch arbitration and a versioned in-process contract.
- Do not add a socket, daemon supervisor, default-route switch, tmux deletion or Greywall claim.

## Acceptance

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| ACCEPT-01 | A single host instance can own two independently sequenced PTYs. | focused runtime unit test. | test | In-process proof only. |
| ACCEPT-02 | Reconnect can distinguish complete replay from truncation. | focused replay unit test. | test | Memory replay only. |
| ACCEPT-03 | A stale controller cannot write or resize. | focused controller unit test. | test | Process-local lease only. |
| ACCEPT-04 | Existing runtime typecheck and tests remain green, and no tmux call site changes. | branch verification plus diff inspection. | test | Does not establish production soak. |

## Deferred migration gates

- Local transport authentication and peer-credential policy.
- Host supervision, generation recovery and clean orphan handling.
- Attach/restore/wake/enumeration parity with tmux.
- Greywall launch-adapter enforcement on supported kernels.
- Soak metrics, fallback drill and explicit owner cutover decision.
