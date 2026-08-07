# PR #178 final independent review — local security and resource reliability

- Status: **COMPLETE — NO-GO**
- Reviewed target: `f40e24cc7e23a7bd88fef0a78325816cb4c22388`
- Required base / exact merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Target binary-diff SHA-256: `2ae714233d14b31baa5daafe1bf1dd77b6448acaadf97a20e20bdb9a529e9c61`
- Diff surface: 23 files, 4,047 insertions, 35 deletions
- Lens: Unix-socket trust and replacement safety; protocol bounds; connection,
  response, replay and session resources; controller/incarnation fencing; PTY
  ownership/reaping; isolation from malformed and slow local peers

## Independence and scope

I inspected the complete
`83bc1fa609fd0458833a2dcebc1bf56476657a56..f40e24cc7e23a7bd88fef0a78325816cb4c22388`
diff. I did not read the sibling correctness or consensus reports before reaching
the verdict below. I read them only afterward to finish inspection of every file
in the assigned diff. Neither sibling report covered the fatal-crash probe used
for F1.

The implemented security boundary is filesystem authorization for the owning
UID, not protection from hostile same-UID code. That limitation is stated
honestly in the spec. I did not treat the absence of kernel peer credentials or
Greywall policy as a defect in this foundation lot.

## Commands and results

| ID | Exact command | Result |
|---|---|---|
| C1 | `git rev-parse HEAD` | exit 0; `f40e24cc7e23a7bd88fef0a78325816cb4c22388` |
| C2 | `git merge-base 83bc1fa609fd0458833a2dcebc1bf56476657a56 f40e24cc7e23a7bd88fef0a78325816cb4c22388` | exit 0; exactly `83bc1fa609fd0458833a2dcebc1bf56476657a56` |
| C3 | `git diff --binary 83bc1fa609fd0458833a2dcebc1bf56476657a56...f40e24cc7e23a7bd88fef0a78325816cb4c22388 \| sha256sum` | exit 0; `2ae714233d14b31baa5daafe1bf1dd77b6448acaadf97a20e20bdb9a529e9c61` |
| C4 | `git diff --shortstat 83bc1fa609fd0458833a2dcebc1bf56476657a56..f40e24cc7e23a7bd88fef0a78325816cb4c22388` | exit 0; 23 files, 4,047 insertions, 35 deletions |
| C5 | `git diff --check 83bc1fa609fd0458833a2dcebc1bf56476657a56..f40e24cc7e23a7bd88fef0a78325816cb4c22388` | exit 0; no output |
| C6 | `git diff --name-only 83bc1fa609fd0458833a2dcebc1bf56476657a56..f40e24cc7e23a7bd88fef0a78325816cb4c22388 -- packages/h2a-runtime/src/tmux.ts packages/h2a-runtime/src/run.ts package.json package-lock.json docs/release.md` | exit 0; no paths |
| C7 | `npx --no-install tsc -b packages/h2a-runtime --pretty false` | exit 0 |
| C8 | `npx --no-install vitest run packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts packages/h2a-runtime/src/native-terminal/host.test.ts packages/h2a-runtime/src/native-terminal/server.test.ts packages/h2a-runtime/src/native-terminal/process.functional.test.ts --reporter=verbose` | exit 0; **4 files / 33 tests passed**, 14.57 s |
| C9 | `npx --no-install vitest run packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts --reporter=verbose` | exit 0; **2 files / 6 tests passed**, 430 ms |
| C10 | `node --import tsx /tmp/pr178-stubborn-crash-probe.mts` | exit 0; one host and one real PTY; after host `SIGKILL`, `{ "sessionExitedWithin1s": false, "sessionStillRunning": true }` |
| C11 | `if kill -0 55 2>/dev/null; then echo 'probe-session-55-still-running'; else echo 'probe-session-55-reaped'; fi` and the equivalent check for host PID 29 | probe cleanup confirmed both exact PIDs reaped |

C10 was deliberately small: it started the committed `process.ts`, created one
`/bin/sh` PTY running `trap '' HUP TERM INT; ...; sleep 1`, waited for its ready
marker, sent `SIGKILL` only to the host, and polled the returned PTY PID for one
second. The probe then killed only that exact PTY process group and verified
cleanup. It performed no network activity and no stress loop.

## Findings

### F1 — HIGH / BLOCKER — a SIGHUP-resistant PTY survives fatal host death and becomes an unowned orphan

Locations:

- `packages/h2a-runtime/src/pty.ts:28-39`
- `packages/h2a-runtime/src/native-terminal/host.ts:156-183`
- `packages/h2a-runtime/src/native-terminal/process.ts:113-145`
- `packages/h2a-runtime/src/native-terminal/process.functional.test.ts:144-149`

PTY ownership exists only as an in-memory `node-pty` handle. Graceful `SIGINT`,
`SIGTERM` and `SIGHUP` shutdown is bounded and does TERM→KILL, but an abrupt host
death has no OS-level parent-death fence, process-group custodian, cgroup, or
surviving reaper. The committed crash test uses a cooperative shell and therefore
proves only that the normal SIGHUP path exits.

C10 used a real PTY whose shell ignored HUP/TERM/INT. After the host was killed,
the host PID was gone but the PTY PID remained live beyond one second:

```json
{
  "hostPid": 29,
  "sessionPid": 55,
  "hostExited": true,
  "sessionExitedWithin1s": false,
  "sessionStillRunning": true
}
```

This leaves a command launched with the session environment and working
directory executing outside all host session, lease, stop and replay controls.
A replacement generation can start while the orphan continues consuming
resources or retaining access to inherited credentials. This contradicts the
branch claim that host crash ends its PTYs and fails the requested child
ownership/reaping review.

Required acceptance before merge: demonstrate a durable owner-death mechanism
under the supported Linux runtime such that a HUP-resistant PTY and its process
group cannot outlive fatal host termination, plus a bounded real-process
regression for that exact case. The review does not prescribe the implementation.

### F2 — MEDIUM — inode checks do not make replacement unlink atomic

Locations:

- `packages/h2a-runtime/src/native-terminal/server.ts:374-398`
- `packages/h2a-runtime/src/native-terminal/server.ts:422-438`
- `packages/h2a-runtime/src/native-terminal/server.ts:531-537`
- `packages/h2a-runtime/src/native-terminal/server.test.ts:348-379`
- `packages/h2a-runtime/src/native-terminal/process.functional.test.ts:660-716`

Stale removal and shutdown each `lstat` the canonical path, compare `(dev, ino)`,
then later `unlink(socketPath)` by name. The comparison and unlink are separate
filesystem operations. With two legitimate same-UID publishers racing over a
stale socket, both can validate the stale inode; one can unlink it and publish
its staged socket before the other performs its already-approved unlink. The
second unlink then removes the newly published live socket. There is a second
misattribution window because `publishSocket` hard-links the staged inode but
records whatever inode is found at the canonical path afterward without proving
it is the staged inode.

The sequential replacement test and the no-stale two-supervisor race both pass,
but neither composes stale cleanup with competing publication/close. The impact
is availability and ownership confusion: a live canonical socket can disappear,
and a losing host can believe it owns a different host's socket and later remove
it. Mode 0700 does not eliminate this legitimate same-UID supervisor race.

Required acceptance: serialize publication/removal or otherwise make ownership
validation and destructive unlink indivisible for this protocol; verify the
staged and published identities match; add a bounded stale-socket plus competing
publishers/old-close regression.

## Verified controls and residual boundaries

- **Filesystem trust boundary:** absolute path, non-symlink directory/socket
  checks via `lstat`, current UID ownership, exact parent mode 0700 and socket
  mode 0600 are enforced (`socket-path.ts:21-52`). The client checks socket inode
  identity before and after connection (`client.ts:50-110`). F2 is the remaining
  publication/cleanup race; no cross-UID bypass was found.
- **Protocol validation:** version, bounded non-empty IDs, operation allow-list,
  object params, lease fields, stop signal allow-list, non-negative replay cursor,
  and positive safe integer dimensions are checked. Frames are capped at 32 MiB,
  response IDs at 128 characters and error messages at 1,024 characters
  (`protocol.ts:6-21,107-186`; `server.ts:47-131,144-239,317-360`). Malformed
  response variants close only that client.
- **Resource limits:** replay is capped independently by 4 MiB payload, 24 MiB
  serialized representation and 65,536 chunks per session; session records
  default to 32 and hard-cap at 256; accepted connections cap at 64; pending
  responses cap at 64/connection, 32 MiB/connection and 64 MiB globally
  (`protocol.ts:7-21`; `replay-buffer.ts:23-95`; `host.ts:97-127,143-167`;
  `server.ts:241-302,452-485`). Client requests and health checks have deadlines,
  and startup failure has bounded TERM→KILL reaping plus exponential backoff
  (`client.ts:50-78,170-208`; `supervisor.ts:16-20,256-338`). No unbounded
  response/replay/session/startup queue found on the reviewed paths.
- **Controller and incarnation fencing:** mutations require the exact
  connection-owned lease; generation, server-minted incarnation, controller ID
  and epoch all match before write/resize/release/stop. Disconnect and PTY exit
  invalidate authority (`server.ts:96-110,133-142,172-215,480-483`;
  `host.ts:220-300,345-405`). The repeated-ID real-PTY test passed.
- **Rejected-peer isolation:** the committed exact-limit malformed-frame test
  rejected a 32 MiB invalid peer while the same host PID and healthy real PTY
  remained writable. The slow pipelined reader was dropped while another client
  pinged and wrote through its healthy PTY. Both cases passed in C8
  (`process.functional.test.ts:275-378,477-556`).
- **Child lifecycle:** graceful host shutdown, controller TERM→KILL escalation,
  host-startup timeout reaping, socket removal and ordinary child exit/reaping
  passed. Fatal host death remains unsafe for signal-resistant descendants (F1).

## Verdict

**NO-GO on `f40e24cc7e23a7bd88fef0a78325816cb4c22388`.** The target resolves the
previous startup-child and outbound-backpressure defects, and the local
filesystem/protocol/fencing/resource controls are otherwise coherent within the
stated same-UID trust model. F1 is a reproduced HIGH lifecycle/security blocker:
a real PTY can continue executing after its owning host is dead. F2 also leaves
the claimed socket replacement safety vulnerable to a legitimate concurrent
publisher race. No implementation or test changes were made by this review.
