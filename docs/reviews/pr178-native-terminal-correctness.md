# PR #178 final native Codex review — correctness and runtime lifecycle

- Status: **COMPLETE — NO-GO**
- Base / merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Exact implementation target: `c005e61c63c270a9341ec14c6cbf0ee363deafa5`
- Target binary-diff SHA-256: `52aa4a8d52f471dda26e00205e57880207a48dcb3595c641781ac547dffb454c`
- Diff surface: 23 files, 4,038 insertions, 35 deletions.
- Independence: this leg did **not** read
  `docs/reviews/pr178-native-terminal-security.md` or
  `docs/reviews/pr178-native-terminal-consensus.md` before reaching and writing
  its verdict. The preceding same-lens report was read only from commit
  `dbc7f796` with `git show`, as authorized.

## Reviewer identity and caveat

| Field | Value |
|---|---|
| Host | native Codex |
| Model | Codex, GPT-5 family; the exact runtime model ID is not exposed to this review session |
| Effort | not independently attestable from inside the session |
| Machine | `Linux 7.0.0-29-generic x86_64` |
| Node / npm | `v22.22.1` / `11.17.0` |
| Worktree | `/home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` |
| Lens | persistent host ownership; multi-session real-PTY lifecycle; incarnation/generation/epoch/connection fencing; reconnect/adoption/races; crash and bounded shutdown; escalation; replay, resource and request bounds; no spawn storm; emitted default spawn; tests; honest deferred cutover |

The host identity above distinguishes this native Codex leg from the other
independent reviewer. It is not an attestation of opaque platform routing or an
unexposed exact model/effort setting.

## Immutable target verification

The required checks ran before repository content inspection and matched the
assigned target exactly:

```text
$ git rev-parse HEAD
c005e61c63c270a9341ec14c6cbf0ee363deafa5
$ git merge-base HEAD origin/main
83bc1fa609fd0458833a2dcebc1bf56476657a56
$ git diff --binary origin/main...HEAD | sha256sum
52aa4a8d52f471dda26e00205e57880207a48dcb3595c641781ac547dffb454c  -
```

## Exact commands and results

| ID | Exact command | Result |
|---|---|---|
| C1 | `git rev-parse HEAD` | exit 0; exact assigned HEAD |
| C2 | `git merge-base HEAD origin/main` | exit 0; exact assigned merge-base |
| C3 | `git diff --binary origin/main...HEAD \| sha256sum` | exit 0; exact assigned digest |
| C4 | `npm run typecheck` | exit 0 |
| C5 | `npx --no-install vitest run packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts packages/h2a-runtime/src/native-terminal/host.test.ts packages/h2a-runtime/src/native-terminal/server.test.ts packages/h2a-runtime/src/native-terminal/process.functional.test.ts --reporter=verbose` | exit 0; **4 files / 30 tests passed**, 9.02 s; all seven Linux real-process cases executed |
| C6 | `npx --no-install vitest run packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts --reporter=verbose` | exit 0; **2 files / 6 tests passed**, 444 ms |
| C7 | `node /tmp/pr178-default-spawn-probe.mjs` | exit 0; emitted default host PID 13 owned real PTY PID 24 as its only direct child, reconnect adopted PID 13, socket was mode 0600, and graceful stop removed host, PTY and socket |
| C8 | `node /tmp/pr178-malformed-peer-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; matching-ID malformed error rejected the request, closed the client and did not crash the caller |
| C9 | `node --max-old-space-size=2048 /tmp/pr178-dense-replay-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; 1,300,000 one-byte callbacks remained readable through the server, the host survived and reconnect read the tail |
| C10 | `node --expose-gc /tmp/pr178-replay-chunk-bound-probe.mjs` | exit 0; 1,300,000 callbacks retained 65,536 chunks, emitted a 1,769,608-byte response below the 32 MiB frame, and used 15,365,144 heap bytes after append/GC |
| C11 | `node /tmp/pr178-fragmented-replay-server-probe.mjs` | exit 0; no replay failure, live client, responsive host and `latestSeq: 1300000` |
| C12 | `node --check /tmp/pr178-real-reincarnation-fenced-probe.mjs && node /tmp/pr178-real-reincarnation-fenced-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; two emitted real PTYs reused ID, generation, controller ID and epoch but had distinct incarnations; stale write, resize, release and stop all rejected; replacement stayed running and accepted its current lease |
| C13 | `node --check /tmp/pr178-hung-startup-probe.mjs && node /tmp/pr178-hung-startup-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; reproduced F1 against emitted supervisor code |
| C14 | `node --check /tmp/pr178-slow-reader-backpressure-probe.mjs && node --expose-gc /tmp/pr178-slow-reader-backpressure-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; reproduced F2 against emitted host/server/client code |
| C15 | `git diff --check origin/main...HEAD` | exit 0; no output |
| C16 | `git diff --name-only origin/main...HEAD -- packages/h2a-runtime/src/tmux.ts packages/h2a-runtime/src/run.ts package.json package-lock.json docs/release.md` | exit 0; no paths |

All custom probe files and their transient sockets/processes were confined to
`/tmp` and cleaned up. No product file was changed by the probes.

## Prior-finding revalidation

The preceding exact-lens NO-GO at `dbc7f796` identified session-incarnation
aliasing and replay/frame non-composition. Both are resolved on this target:

| Previous finding or claim | Exact-target result |
|---|---|
| Recycled-ID stale lease could control a replacement PTY | **Resolved.** A server-minted UUID incarnation is present in state, replay, observer attachments, controller leases/state, server parsing, connection equality and host lease matching. C12 independently repeated session ID, generation, controller ID and epoch across two connections and two distinct emitted real PTYs. The old lease was rejected for write, resize, release and stop; the replacement survived and the current lease still worked. |
| Fragmented replay could exceed its response frame | **Resolved.** Payload bytes, actual JSON-escaped chunk encoding and a 65,536-chunk limit compose below the 32 MiB frame. C9-C11 executed 1.3 million one-byte callbacks with a live client and bounded representation. The committed 65,636-callback transport regression returned exactly 65,536 chunks, an explicit `{ fromSeq: 1, toSeq: 100 }` gap and a live ping. |
| `state`/`list` materialized replay just to obtain the sequence | **Resolved.** `TerminalReplayBuffer.latestSeq` is constant-time and snapshots use it directly. |
| Matching-ID malformed response crashed the caller | **Resolved.** C8 and the five committed incompatible/malformed variants fail closed without an uncaught exception. |
| Exactly 33,554,432-byte invalid request killed the host | **Resolved.** The committed exact-limit real-process case passed in 4.918 s while preserving the same host and live real PTY. |
| TERM→KILL escalation and bounded graceful shutdown | **Resolved in exercised paths.** Both the owner escalation and stubborn-child host shutdown cases passed. |
| Connection-foreign mutation, stale socket cleanup race, exited-record capacity, request deadlines, startup diagnostic/backoff, and historical `PtyHandle.pid` doubles | **Resolved in the previously reported and newly rerun committed cases.** Typecheck, 30 native tests and 6 historical tests are green. |

## Findings — severity ranked

### F1 — HIGH — A live child that misses startup readiness is never terminated or replaced

Locations:

- `packages/h2a-runtime/src/native-terminal/supervisor.ts:173-217`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts:220-254`

The supervisor spawns only when `#spawned` is absent or has exited. If its own
child remains alive but never publishes a healthy socket, the five-second
startup deadline records a failure and throws, but does not signal, await, or
clear that child. After backoff, the same live `#spawned` value suppresses a new
spawn; the retry simply enters another startup polling window. This is not a
spawn storm, but it is an unbounded detached-process and recovery stall.

C13 used the emitted supervisor with a detached Node child that stayed alive
without publishing a socket. The first call failed after 5,023 ms, while the
child was still alive. After the 250 ms backoff, a retry was still unsettled
after 400 ms, `spawnCount` remained 1, and `spawnedPid` still named the same
live child. Only the probe's external `SIGKILL` made the retry reject:

```json
{
  "firstElapsedMs": 5023,
  "aliveAfterDeadline": true,
  "retryObservation": {
    "retrySettled": false,
    "spawnCount": 1,
    "sameSpawnedPid": true,
    "childStillAlive": true
  },
  "retryFailure": "native terminal host exited before accepting connections (SIGKILL)"
}
```

The same branch also governs a supervisor-owned host process that remains alive
but stops answering health pings. Consequently, a wedged owned host or startup
can leave all operations stalled indefinitely and can leave a detached Node
process after its producer exits. The existing backoff test covers only a child
that exits on its own.

Required remediation: treat expiry of the startup contract for a
supervisor-spawned child as a bounded lifecycle transition. TERM then KILL it
if necessary, await exit, clear the owned child reference, and only then apply
restart backoff. Do not signal merely adopted/foreign hosts. Add a real-child
regression that never publishes readiness and proves bounded reaping followed
by one backoff-governed replacement spawn.

### F2 — HIGH — A slow reader can queue unbounded replay responses in the shared host

Locations:

- `packages/h2a-runtime/src/native-terminal/server.ts:230-241`
- `packages/h2a-runtime/src/native-terminal/server.ts:256-295`
- `packages/h2a-runtime/src/native-terminal/server.ts:391-410`

Each individual replay response is now representable, but aggregate outbound
resources are not bounded. `writeResponse` ignores the boolean returned by
`socket.write`, and `consumeFrames` continues parsing, serializing and queuing
responses after backpressure. There is no per-connection queued-byte/request
cap and no server connection cap. A paused local peer can therefore amplify
small valid requests into arbitrary queued replay bytes inside the one process
that owns every PTY.

C14 paused a raw private-UDS client after creating one legal 4 MiB replay, then
sent 16 valid `read-output` requests totaling only 1,526 bytes. All 16 large
server writes returned `false`; nevertheless the server queued every response
and reached `writableLength: 67112006` (about 64 MiB). The host still answered a
second client at that point, so the probe stopped safely rather than driving it
to OOM. There is no structural ceiling preventing linear continuation.

This is a runtime correctness/resource fault, not a claim that mode 0600 is a
cross-UID security boundary. A buggy or concurrent owner client is sufficient,
and exhaustion would take down unrelated PTYs in the shared host.

Required remediation: enforce a hard per-connection outbound queue budget and
request/pipeline bound; pause request consumption on backpressure and resume on
`drain`, or close the slow connection before the budget can be exceeded. Bound
accepted connections as well. Add a paused-socket regression that pipelines
maximum legal replay requests and proves queued bytes stay under the declared
limit while another real PTY and client remain live.

## Runtime-lifecycle conclusions

- **The core architecture is genuinely native.** The emitted default path uses
  one detached persistent Node host that owns real PTYs directly. Reconnect
  adopts the same PID, two real sessions remain independent, and operations do
  not create per-operation Node children or wrap tmux.
- **Session/controller fencing is now coherent across reincarnation.** Host
  generation, server-minted incarnation, controller ID, epoch and connection
  ownership all participate, and the adversarial repeated-tuple real-PTY case
  fails closed for every mutation.
- **Replay representation is now compositionally bounded per session.** The
  1.3-million-fragment execution remains representable, exposes the current
  sequence without replay materialization and keeps the client connected.
  F2 is a distinct aggregate transport-queue bound.
- **Crash, normal shutdown and stop escalation are truthful in the exercised
  cases.** SIGKILL ended the host and its live PTY; graceful shutdown drained a
  stubborn PTY through KILL and removed the socket. F1 leaves the startup/wedged
  owned-child path unbounded.
- **Private UDS checks are real but deliberately limited.** Absolute path,
  owning UID, directory mode 0700, socket type/mode 0600 and inode replacement
  checks are present. No kernel peer-credential or Greywall guarantee is
  claimed.
- **Deferred scope is honest.** Search/diff inspection found only the exported
  seam and foundation/tests; there is no production constructor/caller, tmux
  remains the default, and Greywall enforcement, service-manager ownership,
  parity/soak and owner-approved cutover remain explicit later gates.

## Verdict

**NO-GO.** The target successfully resolves both preceding blockers and proves
the central native multi-session PTY design, emitted adoption, reincarnation
fencing, exact frame survival and fragmented replay bounds. It still has two
actionable shared-host lifecycle/resource defects: a supervisor-owned child can
remain detached and permanently suppress recovery after readiness timeout, and
a slow valid client can queue outbound replay without bound. The review
contract permits GO only when no actionable finding remains.
