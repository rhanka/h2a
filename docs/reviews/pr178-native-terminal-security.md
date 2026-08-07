---
status: completed
reviewer-host: codex
reviewer-model: "GPT-5 family (exact runtime model ID not exposed to this session)"
reviewer-effort: "not exposed to this session"
target-ref: fbd1839369faaeb13cd785623667bee0993cf714
target-base: 83bc1fa609fd0458833a2dcebc1bf56476657a56
target-diff-sha256: cb837a214cb4665da1187e04507aa040ba7f40f3537389f5c79339b8b5104683
lens: native terminal security and trust boundaries
verdict: NO-GO
---

# PR #178 final native Codex review — security and trust boundaries

## Identity and independence

- Reviewer host: native Codex.
- Model/effort caveat: this session identifies itself only as the GPT-5 family; it exposes neither a
  more specific deployed model ID nor its reasoning-effort setting. I report both as unavailable rather
  than infer them from the earlier review or coordinator state.
- This was a blind independent leg. I did not read
  `docs/reviews/pr178-native-terminal-correctness.md` or
  `docs/reviews/pr178-native-terminal-consensus.md` before reaching or writing this verdict.
- I modified only this assigned artifact. The three review stubs were already modified when this review
  began; the sibling modifications were left untouched.

## Mandatory target verification — performed before content inspection

```text
$ git rev-parse HEAD
fbd1839369faaeb13cd785623667bee0993cf714

$ git merge-base HEAD origin/main
83bc1fa609fd0458833a2dcebc1bf56476657a56

$ git diff --binary origin/main...HEAD | sha256sum
cb837a214cb4665da1187e04507aa040ba7f40f3537389f5c79339b8b5104683  -
```

All values matched the immutable assignment. I then inspected the implementation, tests, spec, branch
claims, CI, public exports and package configuration, excluding the two forbidden sibling artifacts.
The prior same-lens report was read only afterward, with the permitted command:

```text
git show 34d230f1:docs/reviews/pr178-native-terminal-security.md
```

## Verdict

**NO-GO.** The correction resolves both prior MEDIUM protocol-containment defects, but one newly
demonstrated MEDIUM replay/resource-bound defect remains actionable. A GO is unavailable under the
assigned rule while it is unresolved.

## Findings — severity ranked

### 1. MEDIUM — fragmented PTY output defeats the advertised replay memory and wire bounds

The replay budget counts only UTF-8 payload bytes, while retaining two objects and one array entry for
every non-empty PTY `onData` callback:

- `host.ts:149-152` appends each callback independently.
- `replay-buffer.ts:24-25` stores an unbounded-by-count array.
- `replay-buffer.ts:39-45` creates a frozen chunk plus a frozen wrapper for every callback, but charges
  only `Buffer.byteLength(data)` to the budget.
- `replay-buffer.ts:47-50` evicts only when payload bytes exceed the limit; there is no entry-count cap
  or coalescing.
- `protocol.ts:7-9` allows 4 MiB of replay payload and a 32 MiB frame. The frame rationale accounts for
  sixfold JSON escaping but not the per-chunk `{seq,data}` JSON overhead.
- `replay-buffer.ts:67-70` allocates mapped/filtered arrays on read. `host.ts:373-375` even calls
  `readAfter(0)` merely to obtain `latestSeq`, transiently walking and copying the complete replay for
  `state`, `list`, `create` snapshots and stop results.
- `server.ts:189-218` correctly contains an oversized response by destroying only that socket. That
  protects the shared process, but it means a legitimate observer cannot retrieve otherwise-retained
  output.

I exercised the exact emitted implementation with 1,300,000 valid one-byte callbacks. This is only
1,300,000 payload bytes, 31% of the configured 4,194,304-byte cap, and is permitted by the declared
`PtySpawner`/`PtyHandle.onData` contract. The deterministic serialization probe produced:

```text
$ /usr/bin/time -v node --expose-gc --max-old-space-size=512 \
    /tmp/pr178-replay-chunk-bound-probe.mjs
{"payloadBytes":1300000,
 "replayLimit":4194304,
 "retainedChunks":1300000,
 "frameBytes":33989007,
 "frameLimit":33554432,
 "frameExceedsLimit":true,
 "heapUsedBefore":3366104,
 "heapUsedAfterAppend":117820640,
 "heapUsedAfterResponse":181668584,
 "rssAfterResponse":295256064,
 "appendMs":421,
 "readMs":40,
 "stringifyMs":141}
Maximum resident set size: 321616 kbytes
exit 0
```

The server-path probe then created a host and session through the real emitted server/client, delivered
the same valid callback sequence, and requested replay:

```text
$ /usr/bin/time -v node --max-old-space-size=512 \
    /tmp/pr178-fragmented-replay-server-probe.mjs
{"replayFailure":"terminal host connection closed",
 "hostStillResponsive":true,
 "retainedLatestSeq":1300000,
 "memory":{"rss":267329536,"heapTotal":183496704,"heapUsed":146869600,
           "external":2097966,"arrayBuffers":25161}}
Maximum resident set size: 329000 kbytes
exit 0
```

The new exception containment therefore works—the shared host survived and a fresh client could ping
it—but the reader was dropped and the host retained 1.3 million chunks. At the accepted one-byte
granularity, the nominal 4 MiB cap permits up to 4,194,304 retained entries. A long-lived or adversarial
terminal can produce small callbacks without ever accessing the private socket; this path remains
relevant even when Greywall later hides the UDS from untrusted same-UID workers.

Severity is MEDIUM rather than HIGH because this needs sustained, highly fragmented PTY output and the
foundation is not yet the production default. It still gates a serious shared multi-session host: the
configured byte budget is not a credible process-memory bound, a valid retained replay can become
unrepresentable on its own protocol, and routine snapshot operations amplify the allocation.

Required fix:

1. Bound retained chunk count and total in-memory overhead, or coalesce output so callback
   fragmentation cannot create millions of retained objects.
2. Make the maximum legal replay representable below the response-frame ceiling under worst-case JSON
   escaping and chunk metadata, or page/stream replay with an explicit bounded contract.
3. Expose `latestSeq` without materializing the replay.
4. Add a deterministic fragmented-output regression proving bounded retention and successful bounded
   replay (or explicit pagination) at the configured maximum.

Owner: PR author. Acceptance is a new pinned target where the above invariant and regression pass.

## Revalidation of previous findings and assigned trust boundaries

### Prior MEDIUM 1 — exact-limit invalid request killed the standalone host: resolved

The correction no longer reflects an unbounded raw ID. `safeResponseId` limits correlation IDs to
1-128 characters, `boundedErrorMessage` limits messages to 1,024 characters, `writeResponse` contains
serialization/write exceptions, and the per-socket data handler destroys only the offending socket if
anything still escapes frame consumption.

The required native suite executed the new standalone regression. It sent a JSON request line of exactly
33,554,432 bytes while a real PTY was active, received a bounded `invalid-request` response with ID
`invalid`, then proved the same host PID and controller lease still operated the PTY. Result: pass in
4,713 ms. This revalidates the prior reproducer as fixed.

### Prior MEDIUM 2 — malformed/incompatible responses were accepted or escaped: resolved

`parseNativeTerminalResponse` now validates version, bounded non-empty ID, the `ok` discriminant,
presence of a success result, error object, allowlisted error code, and bounded non-empty string message.
`client.ts:230-246` completes that parsing before looking up, deleting or resolving/rejecting a pending
entry. Malformed data fails all pending requests and closes the connection without throwing from the
socket callback.

The raw-peer regression executed five variants on this exact target: response version `999`, missing
error object, invalid error code, non-string error message, and success without `result`. All were
rejected, and the client was closed after each malformed peer. Result: pass.

### UDS trust boundary and publication/replacement races: acceptable for the declared scope

- The socket path must be absolute. The immediate parent is `lstat`-verified as a directory owned by
  `process.getuid()` with permission bits exactly `0700`; the endpoint is `lstat`-verified as a socket
  owned by the same UID with bits exactly `0600`.
- A pre-existing shared `0755` parent is rejected without silently chmod-ing it; a `0666` socket is
  rejected by the client. Both execution tests passed.
- Client connect records `{dev,ino}` before connecting and re-inspects after `connect`, rejecting a
  replacement inode.
- Publication listens on a private staged socket, chmods it to `0600`, then uses atomic hard-link
  publication. Stale removal checks activity and revalidates inode identity before unlink. Close unlinks
  only the inode published by that server. The replacement-close and competing-supervisor tests passed.
- This does not authenticate Linux peer credentials and does not defend against a hostile process that
  already shares the owning UID. The spec states that boundary honestly and defers visibility from
  untrusted same-UID workers to Greywall. I do not treat the documented residual as a defect in this
  no-cutover foundation.

### Authorization, fencing, signal and request bounds: acceptable except Finding 1

- Controller leases are bound to the socket connection as well as session ID, host generation,
  controller ID and epoch. A foreign connection cannot replay serialized lease fields; disconnect
  releases ownership; stale epochs fail closed. TERM-to-KILL escalation by the owner and takeover after
  disconnect both passed with stub and real stubborn PTYs.
- Stop signals are limited to `SIGHUP`, `SIGINT`, `SIGTERM` and `SIGKILL`; `SIGUSR1` was rejected.
- Connect and health checks have one-second deadlines; all client operations have a default five-second
  deadline with positive-safe-integer validation. The 50 ms stalled-peer test passed.
- Retained session count defaults to 32 and is hard-capped at 256; exited records are reaped under
  pressure or explicit ID reuse. Payload replay is capped at 4 MiB in the process/supervisor path, but
  Finding 1 shows why that payload counter is not a sufficient memory/wire bound.

### Lifecycle, cleanup and startup behavior: acceptable

- The real suite proved two independent real PTYs under one host, stable host/PTY PIDs across reconnect,
  no Node child per operation, isolated session stop, host-crash PTY death, graceful bounded
  TERM-to-KILL drain, socket cleanup, fresh generation, backoff, and two-supervisor convergence.
- Concurrent callers are coalesced through one `#connecting` promise. Failed starts use exponential
  250 ms-to-5 s backoff and retain at most 4,096 stderr bytes. The suite observed spawn counts remaining
  stable during the backoff regression; the race test converged two supervisors on one surviving host
  with no repeated reconnect spawns.

### Emitted/default-spawn, package, CI and claim accuracy: acceptable

The committed functional tests inject a `tsx` spawn, so I separately exercised the emitted default path
created by the required typecheck:

```text
$ node /tmp/pr178-default-spawn-probe.mjs
{"generation":"compiled-default-spawn-final-review",
 "hostPid":13,
 "supervisorSpawnedPid":13,
 "ptyPid":24,
 "directChildren":[24],
 "adoptedHostPid":13,
 "hostStable":true,
 "socketMode":"600",
 "socketUid":1000,
 "socketType":true}
exit 0
```

The probe imported emitted `dist/native-terminal/supervisor.js`, used its unoverridden detached spawn,
created and drove a real shell PTY, verified that the PTY was the host's only direct child, disconnected
and adopted the same host, then sent SIGTERM and asserted host death, PTY death and socket removal before
exiting 0.

No root/runtime package manifest, lockfile, release document, production `tmux.ts` route or default
backend changed. The public root export adds the client/host/supervisor seam only. Package dry-run
included emitted JS and declarations for client, host, process, protocol, replay buffer, server, socket
path and supervisor. CI explicitly runs the four native-terminal files on Ubuntu/Node 20 and 22 after
typecheck and the root suite; the spec limits real-PTY proof to Linux and explicitly defers production
cutover, peer-credential policy, Greywall enforcement and cross-platform execution.

`BRANCH.md` records the earlier Lot 6 gate as 4 files / 23 tests; the corrected exact target now executes
4 files / 25 tests. I read the former as historical gate evidence, not a current test-count claim.

## Commands and exact results

### Required execution evidence

```text
$ node --version
v22.22.1

$ npm --version
11.17.0

$ npm run typecheck
> h2a@0.91.0 typecheck
> npm run build -w @sentropic/track && tsc -b --pretty false
exit 0
```

Npm emitted only the environment's existing `globalignorefile` deprecation warnings.

```text
$ npx --no-install vitest run \
    packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts \
    packages/h2a-runtime/src/native-terminal/host.test.ts \
    packages/h2a-runtime/src/native-terminal/server.test.ts \
    packages/h2a-runtime/src/native-terminal/process.functional.test.ts \
    --reporter=verbose
Test Files  4 passed (4)
Tests       25 passed (25)
Duration    8.27s
exit 0
```

```text
$ npx --no-install vitest run \
    packages/h2a-runtime/src/run.test.ts \
    packages/h2a-runtime/src/run-ws-surface.test.ts \
    --reporter=verbose
Test Files  2 passed (2)
Tests       6 passed (6)
Duration    399ms
exit 0
```

### Repository/package integrity

```text
$ git diff --check 83bc1fa609fd0458833a2dcebc1bf56476657a56...HEAD
(no output; exit 0)

$ git diff --name-only 83bc1fa609fd0458833a2dcebc1bf56476657a56...HEAD -- \
    package.json package-lock.json packages/h2a-runtime/package.json \
    packages/h2a-runtime/src/tmux.ts docs/release.md
(no output; exit 0)
```

```text
$ npm pack --dry-run --json -w @sentropic/h2a-runtime | \
    jq '.[0] | {name, version, filename, nativeTerminalFiles: \
      [.files[].path | select(test("^dist/native-terminal/(client|host|process|protocol|replay-buffer|server|socket-path|supervisor)\\\\.(js|d.ts)$"))]}'
name: @sentropic/h2a-runtime
version: 0.91.0
filename: sentropic-h2a-runtime-0.91.0.tgz
nativeTerminalFiles: 16 expected JS/declaration entries, including process.js and supervisor.js
exit 0
```

The three `/tmp` probes were review-only execution artifacts. Their SHA-256 identities were:

```text
c7adab02c79635a49150216659f2e44dbd03af82841ddef2aec08c8c80300b26  /tmp/pr178-default-spawn-probe.mjs
7316a60b6b35ca11f2e4a96e21023d02dbecef53c70b489886a7eb92a225baa2  /tmp/pr178-replay-chunk-bound-probe.mjs
5d3c428f4d4d7793d3b33b4d6ad000e93b024afa4af979c8ef8dbb7f45feb85f  /tmp/pr178-fragmented-replay-server-probe.mjs
```

Final worktree check before report verification still showed only the three coordinator-owned review
artifacts modified; no product file was changed.
