# PR #178 final native Codex review — correctness and runtime lifecycle

- Status: **COMPLETE — NO-GO**
- Base / merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Exact target: `fbd1839369faaeb13cd785623667bee0993cf714`
- Target binary-diff SHA-256: `cb837a214cb4665da1187e04507aa040ba7f40f3537389f5c79339b8b5104683`
- Diff surface: 23 files, 3,791 insertions, 35 deletions.
- Independence: this leg did **not** read `docs/reviews/pr178-native-terminal-security.md` or
  `docs/reviews/pr178-native-terminal-consensus.md` before reaching and writing its verdict.

## Reviewer identity

| Field | Value |
|---|---|
| Host | native Codex |
| Model | `gpt-5.6-sol` |
| Effort | `xhigh` |
| Machine | `Linux 7.0.0-29-generic x86_64` |
| Node / npm | `v22.22.1` / `11.17.0` |
| Worktree | `/home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` |
| Lens | persistent host ownership, multi-session PTY lifecycle, controller/generation/epoch/connection fencing, reconnect/adoption/races, crash and bounded shutdown, stop escalation, resource/request bounds, spawn backoff, compiled default spawn, test adequacy, and honest deferred cutover |

The model and effort are the declared native runtime identity for this review leg; they are not an
attestation of any opaque post-routing fallback.

## Immutable target verification

The required checks were run before inspecting repository content and matched exactly:

```text
$ git rev-parse HEAD
fbd1839369faaeb13cd785623667bee0993cf714
$ git merge-base HEAD origin/main
83bc1fa609fd0458833a2dcebc1bf56476657a56
$ git diff --binary origin/main...HEAD | sha256sum
cb837a214cb4665da1187e04507aa040ba7f40f3537389f5c79339b8b5104683  -
```

## Commands and results

| ID | Exact command | Result |
|---|---|---|
| C1 | `git rev-parse HEAD` | exact assigned HEAD |
| C2 | `git merge-base HEAD origin/main` | exact assigned merge-base |
| C3 | `git diff --binary origin/main...HEAD \| sha256sum` | exact assigned digest |
| C4 | `npm run typecheck` | exit 0 |
| C5 | `npx --no-install vitest run packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts packages/h2a-runtime/src/native-terminal/host.test.ts packages/h2a-runtime/src/native-terminal/server.test.ts packages/h2a-runtime/src/native-terminal/process.functional.test.ts --reporter=verbose` | **4 files / 25 tests passed**, 8.24 s; all six Linux real-process cases executed |
| C6 | `npx --no-install vitest run packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts --reporter=verbose` | **2 files / 6 tests passed**, 440 ms |
| C7 | `node /tmp/pr178-default-spawn-probe.mjs coordinator /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host "$(mktemp -d /tmp/pr178-default-spawn-XXXXXX)"` | exit 0; emitted default host detached under PID 1, owned one real `dash` PTY, was adopted with zero spawn attempts, and removed host/PTY/socket on SIGTERM |
| C8 | `node /tmp/pr178-malformed-peer-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; the prior matching-ID malformed error rejected the request, closed the client, and did not crash the caller |
| C9 | `node /tmp/pr178-reincarnation-fence-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; reproduced F1 through two real socket clients and stub PTYs |
| C10 | `node /tmp/pr178-real-reincarnation-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; reproduced F1 in the emitted standalone host with two distinct real PTYs |
| C11 | `node --max-old-space-size=2048 /tmp/pr178-dense-replay-probe.mjs /home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` | exit 0; reproduced F2 through the emitted host/server/client implementation |
| C12 | `git diff --name-only origin/main...HEAD -- packages/h2a-runtime/src/tmux.ts packages/h2a-runtime/src/run.ts package.json package-lock.json docs/release.md` | exit 0, no paths |
| C13 | `git diff --check origin/main...HEAD` | exit 0, no output |

All probe files were temporary `/tmp` artifacts. No product file was changed by the review.

### Emitted default-spawn/adoption evidence

C7 imported the exact `dist/native-terminal/supervisor.js` emitted by C4 and used no `spawnHost`
override in the producer. After that producer process exited, a separate adopter whose spawn override
would throw connected to the same host and PTY:

```json
{
  "identity": { "hostPid": 21, "ptyPid": 32, "generation": "compiled-default-generation" },
  "procStatus": { "Name": "node", "Pid": "21", "PPid": "1", "NSpgid": "21", "NSsid": "21" },
  "directChildren": [32],
  "childExecutables": ["dash"],
  "adopted": { "hostPid": 21, "ptyPid": 32, "spawnAttempts": 0, "sawEcho": true },
  "shutdown": { "hostGone": true, "ptyGone": true, "socketGone": true }
}
```

This confirms the compiled `process.js` resolution, detached/unref'd default spawn, cross-process
adoption, stable process ownership, absence of a Node subprocess per operation, and graceful cleanup on
this exact target.

## Revalidation of previous findings and correction claims

The prior same-lens NO-GO report at commit `34d230f1` was read only with `git show` and revalidated:

| Previous class | Exact-target result |
|---|---|
| TERM-to-KILL escalation | **Resolved.** The same owner can escalate a stopping PTY; unit and real stubborn-PTY execution passed. |
| Observer/foreign stop | **Resolved for a live session incarnation.** Mutations require the connection-owned lease. F1 below shows that ownership can alias after ID reuse. |
| Exited-record retention / ID reuse | **Capacity repair works, but exposes F1.** Exited records are reaped and IDs recycle; the new record resets its epoch and lacks an incarnation discriminator. |
| Unbounded request deadlines | **Resolved.** Requests and health pings have positive deadlines; the stalled-peer regression passed. |
| Stale-socket publication/unlink race | **Resolved in exercised cases.** Atomic staging publication, inode-guarded cleanup, replacement, and competing-supervisor tests passed. |
| Restart spawn storm / diagnostics | **Resolved in exercised default failure path.** Bounded diagnostics and exponential restart backoff passed. |
| Historical `PtyHandle.pid` doubles | **Resolved.** The historical 2-file/6-test surface and root typecheck pass. |
| Matching-ID malformed error crashed the caller | **Resolved.** `parseNativeTerminalResponse` validates version, ID, discriminator, error code/message, and success result before pending-map mutation. C8 replayed the original malformed payload: the caller survived, the first request rejected as invalid, and the next rejected because the client was closed. |

The correction-specific committed evidence also executed successfully:

- The malformed-peer test sends five incompatible/malformed variants: wrong version, missing error,
  wrong error code, non-string error message, and success without `result`. All reject closed.
- Server response IDs and error messages are bounded, and per-socket transport/framing exceptions are
  contained instead of escaping the server's data callback.
- The standalone-host regression sends an exactly 33,554,432-byte invalid request while a real PTY is
  active. It returned bounded `id: "invalid"`, kept the same host PID alive, and the PTY still echoed
  afterward. That case passed in 4.755 s.

## Findings (severity-ranked)

### F1 — HIGH — Recycling a session ID can resurrect a stale lease on another connection

Locations:

- `packages/h2a-runtime/src/native-terminal/host.ts:120-145`
- `packages/h2a-runtime/src/native-terminal/host.ts:194-213`
- `packages/h2a-runtime/src/native-terminal/host.ts:334-370`
- `packages/h2a-runtime/src/native-terminal/server.ts:29-32`
- `packages/h2a-runtime/src/native-terminal/server.ts:70-84`
- `packages/h2a-runtime/src/native-terminal/server.ts:142-184`

An exited record is deleted and its replacement starts `controllerEpoch` at zero while retaining the same
host generation and user-selected session ID. The first acquisition on the replacement therefore returns
epoch 1 again. A connection context also retains its old lease after PTY exit. If another connection
recreates the same session ID and acquires it with the same caller-selected controller ID, the old and new
leases have the identical tuple `(session id, host generation, controller id, epoch)`. Both the server's
`ownedLease` comparison and the host's `#requireMatchingController` then accept the stale connection.

C9 first reproduced this deterministically through the actual server/client transport. The old connection
successfully wrote and resized the replacement stub PTY, then released the replacement controller; the
rightful controller's next write failed as stale.

C10 confirmed the same result against the emitted default standalone host and real `node-pty` processes:

```json
{
  "hostPid": 13,
  "originalPtyPid": 24,
  "replacementPtyPid": 26,
  "distinctRealPtys": true,
  "leasesByteIdentical": true,
  "staleWriteReachedReplacement": true,
  "currentAfterStaleRelease": {
    "resolved": false,
    "error": "stale terminal controller lease"
  }
}
```

This breaks session lifecycle isolation, epoch fencing, and connection fencing. The same matching path is
used by `stop`, so this is not limited to input. The replay/state identity has the same root ambiguity:
sequence numbers reset on an ID-reused session, but the response exposes only the unchanged host generation
and session ID, not a session incarnation.

Required remediation: add a server-minted, non-reused session-incarnation discriminator to session state,
replay identity, observer attachments, controller leases, connection ownership, and all lease checks (or
otherwise prove an equally strong non-reuse invariant). Clearing a connection's lease on observed exit is
useful but is not sufficient for the exported in-process host surface. Add a two-connection regression that
recycles an exited ID, deliberately repeats the controller ID, and proves the old lease cannot write,
resize, release, or stop the new real PTY.

### F2 — MEDIUM — A legal fragmented replay cannot be framed, so reconnect replay closes the client

Locations:

- `packages/h2a-runtime/src/native-terminal/replay-buffer.ts:22-73`
- `packages/h2a-runtime/src/native-terminal/host.ts:373-374`
- `packages/h2a-runtime/src/native-terminal/server.ts:189-219`
- `packages/h2a-runtime/src/native-terminal/server.ts:263-272`

The replay budget counts only UTF-8 payload bytes, but retains and serializes one object per `onData` event.
The 32 MiB frame calculation accounts for escaped payload but not per-chunk `{seq,data}` metadata. A
long-lived PTY can therefore remain below the admitted replay payload budget while producing a response
that the transport cannot represent.

C11 appended 1,300,000 legal one-byte chunks: 1,300,000 retained payload bytes under the 4,194,304-byte
budget. Their JSON chunk array alone measured 33,988,895 bytes, already above the 33,554,432-byte frame
limit. `readOutput("dense", 0)` closed the client with `terminal host connection closed`; it returned neither
the complete replay nor an explicit gap/error. The host survived and a new client could read the final
chunk from cursor 1,299,999. The process reported 193,484,208 heap bytes in use for this 1.3 MiB replay
case. In addition, every `state`/`list` snapshot calls `readAfter(0)` and constructs the entire chunk array
merely to obtain `latestSeq`.

This contradicts the claimed memory-bounded replay and reconnect contract for an admitted buffer state.
It is less immediate than F1 because it requires highly fragmented long-lived output, but the `PtySpawner`
contract establishes no minimum event size and the host is explicitly persistent.

Required remediation: make every admitted replay representable—e.g. coalesce output, bound retained chunk
metadata/wire bytes, and/or paginate replay under the response frame ceiling—and expose `latestSeq` without
materializing all chunks. Add an execution regression with fragmented output proving a reconnect gets
complete replay or an explicit gap without losing its connection.

## Runtime-lifecycle conclusions

- **Ownership and adoption are real.** One persistent detached Node host owns multiple real PTYs; emitted
  default-spawn adoption works after the original spawner exits, and operations create no Node child.
- **Crash, graceful stop, escalation, and restart behave correctly in the exercised paths.** Host SIGKILL
  reaped its PTY; graceful TERM drained a stubborn child through KILL, removed the socket, and allowed a new
  generation; owner escalation and startup backoff passed.
- **Live-record connection fencing is coherent but incomplete across reincarnation.** Generation,
  controller ID, epoch, and connection ownership reject normal foreign/stale leases, but F1 shows those
  fields are not unique across an intentionally recycled session ID.
- **Nominal bounds exist.** Session count, replay payload, request/response frames, request deadlines,
  startup diagnostics, publication retries, and restart rate are capped. F2 shows the replay payload and
  wire/heap bounds are not compositionally consistent.
- **The tests are substantive but miss both defects.** Six Linux functional cases exercise real PTYs,
  including the new exact-limit malformed request. They do not combine exited-ID recycling with a retained
  lease on another connection, nor fragmented replay with response framing. The compiled default spawn is
  also still manual evidence rather than a committed regression.
- **Scope is honest.** No production constructor/caller exists outside exports/tests, the targeted forbidden
  path diff is empty, tmux remains the default, and the specification explicitly defers local-server
  cutover, parity/soak, service-manager ownership, peer-credential/Greywall enforcement, and owner acceptance.

## Verdict

**NO-GO.** The correction resolves the previous malformed-response crash and survives the claimed
33,554,432-byte adversarial request with a live real PTY. The architecture also proves genuine persistent
native ownership and compiled cross-process adoption. However, F1 is a reproduced real-PTY controller and
connection-fencing failure across supported exited-ID reuse, and F2 is a reproduced mismatch between legal
replay state and the transport frame bound. Both are actionable; the gate permits GO only with no unresolved
actionable finding.
