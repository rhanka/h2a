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
| HOST-01 | One host generation owns zero or more PTYs in one long-lived Node process. | `NativeTerminalHost` unit tests plus the real-process multi-PTY functional test. | test | A fatal host crash ends its PTYs, exactly as a fatal failure of the shared default tmux server ends its panes. |
| HOST-02 | One control-plane supervisor coalesces concurrent starts, adopts its persistent socket, and clients never spawn a host per operation. | `process.functional.test.ts` asserts one spawn and stable host/PTY PIDs across operations and reconnect. | test | Production local-server wiring is a later opt-in lot; this branch exports the seam without changing the default path. |
| PROTO-01 | Every output chunk has both host-generation and server-minted session-incarnation identity plus a session-local monotonically increasing sequence. | replay-buffer unit tests plus host integration tests. | test | Sequence continuity does not cross host generations or recycled session incarnations. |
| PROTO-02 | Replay is bounded independently by payload bytes, serialized wire bytes and retained chunk count; admitted replay remains representable below the frame ceiling and reports an explicit gap when output is evicted. Retained session records are bounded and exited records recycle under pressure or explicit id reuse. | `replay-buffer.test.ts`, fragmented local-transport execution and host capacity/reuse tests. | test | A gap is reported, not reconstructed; durable transcripts remain owned by the agent CLI. |
| CTRL-01 | One controller lease may write, resize or stop; observers are read-only. The same lease can escalate a stopping PTY from TERM to KILL, and a disconnected stop owner can be replaced. Controller changes increment an epoch, every lease carries a non-reused session incarnation, and stale epochs/incarnations fail closed. A lease is also bound to its local connection. | host controller unit tests, two-connection recycled-ID real-PTY execution, local-transport integration tests and a real stubborn-PTY escalation test. | test | Multi-user authorization is not introduced here; filesystem uid/type/mode checks restrict the socket to the owning user, while Greywall must hide it from untrusted same-UID workers. |
| LIFE-01 | Create, list, attach, input, resize, replay, exit and stop are typed host operations; PTY exit is terminal and idempotently observable. | host lifecycle unit tests and Linux real-PTY functional tests. | test | Restore/relaunch semantics remain on tmux until a later migration lot. |
| GREY-01 | The terminal host is not Greywall. A later launch adapter may carry policy identity and measured process identity, while enforcement stays below the PTY host. | adapter contract and enforcement probe (not yet written). | spec-line | This branch creates no new OS guarantee. |
| MIG-01 | tmux remains the default and fallback until parity, soak and explicit owner acceptance. | no production call-site changes in foundation commits. | structural | Coexistence temporarily keeps both implementations. |

## First realization slice

- Define and test the bounded sequenced replay primitive.
- Build a multi-session host around the injected `PtySpawner` and run it in one separately executable Node process.
- Add controller-epoch arbitration and a versioned in-process contract.
- Add a bounded versioned JSON-lines transport over a private Unix socket plus a connect-or-start supervisor with request deadlines and startup backoff.
- Do not add a default-route switch, tmux deletion or Greywall enforcement claim.

## Acceptance

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| ACCEPT-01 | A single host process can own two independently sequenced real PTYs. | focused runtime unit tests plus Linux functional execution test. | test | Linux execution proof; other platforms retain compile/smoke coverage. |
| ACCEPT-02 | Reconnect can distinguish complete replay from truncation, and callback fragmentation cannot exceed retained-object or response-frame bounds. | focused replay unit tests plus fragmented server/client execution. | test | Memory replay only. |
| ACCEPT-03 | A stale, prior-incarnation or connection-foreign controller cannot write, resize or stop. Filesystem ownership/type/mode and socket identity are checked before a client trusts the peer. | focused controller, recycled-ID real-PTY, local-transport and socket replacement integration tests. | test | This is filesystem-level same-UID authorization, not kernel peer-credential authentication; Greywall must hide the socket from untrusted same-UID workers. |
| ACCEPT-04 | Client disconnect does not end PTYs; host crash does, and host stop cleans PTYs/socket with a bounded TERM→KILL drain before a new generation starts. | Linux functional process test, including a shell that installs TERM/HUP/INT ignore traps before shutdown. | test | Does not establish long-duration production soak. |
| ACCEPT-05 | Existing runtime typecheck and tests remain green, and no tmux call site changes. | branch verification plus diff inspection. | test | Does not establish production soak. |

## Deferred migration gates

- Kernel peer-credential policy beyond private filesystem uid/type/mode checks.
- Service-manager ownership, generational draining and clean orphan handling beyond connect-or-start recovery.
- Attach/restore/wake/enumeration parity with tmux.
- Greywall launch-adapter enforcement on supported kernels.
- Soak metrics, fallback drill and explicit owner cutover decision.
