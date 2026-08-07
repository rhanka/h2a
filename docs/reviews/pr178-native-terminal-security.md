---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-sol
reviewer-effort: xhigh
target-ref: 0a20b7cbddb1e4a7ff986668274105c5d03d6a20
target-base: 83bc1fa609fd0458833a2dcebc1bf56476657a56
target-diff-sha256: af56965a97f9e369176852873b19a6c393f09e7f56c08a7ef66ef2049824480b
lens: native terminal security and trust boundaries
verdict: NO-GO
---

# PR #178 final native Codex review — security and trust boundaries

## Identity and independence

- Reviewer: native Codex, session-assigned `gpt-5.6-sol`, `xhigh`.
- Identity caveat: the native session exposes the assigned model and effort above, but no lower-level post-routing telemetry. I can attest to the native Codex session and its assigned identity, not independently prove the absence of an infrastructure fallback.
- This is a blind leg. I did not read `docs/reviews/pr178-native-terminal-correctness.md` or `docs/reviews/pr178-native-terminal-consensus.md` before writing this verdict.
- I modified only this assigned artifact. The correctness and consensus files were already modified by the coordinator when the review began and were left untouched.

## Mandatory target verification — performed first

```text
$ git rev-parse HEAD
0a20b7cbddb1e4a7ff986668274105c5d03d6a20

$ git rev-parse origin/main
83bc1fa609fd0458833a2dcebc1bf56476657a56

$ git diff --binary origin/main...HEAD | sha256sum
af56965a97f9e369176852873b19a6c393f09e7f56c08a7ef66ef2049824480b  -
```

All three values matched the assignment. I then inspected the complete implementation, tests, spec, CI change, branch scope, public exports, and relevant package configuration. The two current blind-review artifacts named above were deliberately excluded from content inspection. The initial security NO-GO preserved at `114dbdcb` was read from this same assigned artifact and its issue classes were independently revalidated.

## Verdict

**NO-GO.** Two unresolved actionable protocol-boundary defects remain. The first lets one filesystem-authorized client terminate the shared host, thereby losing every PTY owned by that host generation. The second accepts an incompatible response version and lets malformed peer data throw uncaught in the client process. A GO is unavailable under the assigned rule while either remains.

## Findings — severity ranked

### 1. MEDIUM — an exact-limit invalid request terminates the standalone shared host

The server correctly caps an input line at 32 MiB, but its invalid-request path can build a response larger than that cap and throw out of the socket event callback:

- `server.ts:217-220` allows a line whose byte length is exactly `NATIVE_TERMINAL_MAX_FRAME_BYTES`.
- `protocol.ts:104-105` then rejects an overlong request ID.
- `server.ts:233-234` reflects the unvalidated raw ID into the error response instead of using a bounded fallback ID.
- `server.ts:190-192` throws when the resulting response exceeds 32 MiB.
- `server.ts:246` calls `writeError` from a catch block without containing errors thrown by error serialization/writing. The exception escapes `consumeFrames` and the `socket.on("data")` callback.

I sent a JSON-lines request of exactly 33,554,432 bytes with an overlong correlation ID to the real separately executable `process.ts` host. The invalid-request response would be 104 bytes over the configured maximum. The host exited with code 1:

```text
requestBytes: 33554432
configuredMax: 33554432
hostExit: { code: 1, signal: null }
stderr: uncaught RangeError: terminal response exceeds the frame limit
```

This is not merely a rejected request or a dropped connection. The shared Node host dies, so all PTYs in that generation die with it. Access requires visibility of the owning user's `0600` socket, and the code is not wired into the default backend yet; those facts constrain current exposure but do not make a process-terminating parser path acceptable in the exported foundation.

Required fix: never reflect an invalid/unbounded raw ID into an error frame; make error responses bounded and exception-safe; and ensure no parse/dispatch/error-serialization exception can escape the per-socket data handler. Add a real-process regression proving the exact-limit request is rejected or the connection is closed while the host and an existing PTY remain alive.

### 2. MEDIUM — the client neither enforces response protocol version nor safely parses the error variant

`NativeTerminalClient.#onData` performs only three envelope checks (`object`, string `id`, boolean `ok`) at `client.ts:231-234`, then casts the value to `NativeTerminalResponse` at `client.ts:235`. It does not validate:

- `response.version === NATIVE_TERMINAL_PROTOCOL_VERSION`;
- the success/error discriminated shape;
- error `code` and `message` before constructing `NativeTerminalRemoteError`.

Two raw same-UID/mode-correct peer probes demonstrated the consequences:

```text
peer sent: { version: 999, id: <matching>, ok: true,
             result: { generation: "wrong-envelope-version",
                       hostPid: 2, protocolVersion: 1 } }
client outcome: accepted
```

and:

```text
peer sent: { version: 1, id: <matching>, ok: false }
process event: uncaughtException
TypeError: Cannot read properties of undefined (reading 'message')
```

In the malformed-error case, `client.ts:238-241` removes the pending request and clears its deadline before `NativeTerminalRemoteError` dereferences the missing error object. Without a global uncaught handler the client process terminates; with one, that request promise is left unsettled because it is no longer in the pending map.

Required fix: introduce a strict response parser that checks the envelope protocol version and validates both response variants before touching the pending entry. On malformed or incompatible peer data, fail closed by destroying the connection and rejecting all pending requests, without throwing through the event callback. Add raw-peer regressions for version `999`, a missing error object, invalid error code/message, and malformed success shape.

## Revalidation of the initial NO-GO classes

The earlier issue classes are materially improved and did not produce additional findings:

- **Parent/socket UID, type, and exact permission modes:** `socket-path.ts` requires an absolute path; a directory owned by `process.getuid()` with permission bits exactly `0700`; and a socket owned by the same UID with permission bits exactly `0600`. The compiled-host smoke observed UID `1000`, socket type true, and mode `0600`. The suite rejects a pre-existing `0755` parent without chmod-ing it and rejects a `0666` socket.
- **Pre/post-connect identity:** the client records `{dev, ino}` before connect and compares it after the connection event. In 20 forced replacement attempts, all 20 were rejected: 14 as inode changes, two as `ENOENT`, and four while the replacement had not yet reached mode `0600`. No replacement was accepted.
- **Stale/replacement and old-server cleanup:** stale removal checks UID/type/mode, probes liveness, re-stats the inode before unlinking, and retries if identity changed. Publication uses a staged socket plus atomic hard link. Close only unlinks the inode it published. The replacement-close integration test and the two-supervisor real-process convergence test passed.
- **Filesystem authorization versus peer credentials/Greywall:** a correctly owned, `0700`/`0600`, same-UID rogue listener that returned a valid ping was accepted. That is expected under filesystem-level same-UID authorization; there is no `SO_PEERCRED` authentication. The spec now says this explicitly and requires Greywall to hide the socket from untrusted same-UID workers. I treat the claim as honest, not as a finding. This residual boundary must remain explicit when production wiring is added.
- **Controller authorization including stop:** write, resize, release, and stop all require a lease stored on the same connection. A foreign connection cannot reuse serialized lease fields. Stop remains available to the owning lease during `stopping` so TERM can be escalated to KILL; disconnect releases it so a replacement controller can acquire and escalate. The unit, socket, and stubborn real-PTY tests passed.
- **Signal allowlist:** protocol stop and host shutdown accept only `SIGHUP`, `SIGINT`, `SIGTERM`, and `SIGKILL`; the `SIGUSR1` negative test passed.
- **Session/replay/resource ceilings:** replay is capped at 4 MiB per session; frame size is 32 MiB; default retained sessions are 32 with a hard configuration maximum of 256. Exited records are reaped under pressure or explicit ID reuse. A real host launched with `--max-sessions 2` retained two running sessions and rejected the third with `terminal host session limit reached: 2`.
- **Deadlines:** connect defaults to 1 second, health ping to 1 second, and every client request to 5 seconds (configurable positive safe integers). The stalled-peer test rejected after the configured 50 ms. Finding 1 is a containment defect in the error path, not an absence of the input frame ceiling.
- **Startup backoff/spawn storm:** 100 concurrent callers coalesced to one failed spawn; an immediate second wave of 100 produced no new spawn; after the 250 ms first backoff, a third wave produced exactly one additional spawn. Retained stderr appeared in the failure. Counts were `1 → 1 → 2`, with all 300 calls rejected cleanly.
- **Cleanup/drain:** the real-process suite proved bounded TERM-to-KILL shutdown, PTY death, code-0 host exit, socket removal, and a fresh next generation. Host crash also removed its remaining real PTY.
- **Package/CI/claim accuracy:** no package manifest, lockfile, release, `tmux.ts`, or production backend call site changed. A clean emit to `/tmp` included `native-terminal/process.js` beside `supervisor.js`, and the compiled default-spawn smoke successfully started that process and pinged it. CI names the four test files explicitly on Ubuntu with Node 20 and 22, avoiding shell-glob portability. The spec scopes real execution proof to Linux and does not claim this Unix-socket implementation works on Windows; I did not independently execute another OS.

## Commands and results

### Repository inspection

```text
$ git status --short
 M docs/reviews/pr178-native-terminal-consensus.md
 M docs/reviews/pr178-native-terminal-correctness.md
 M docs/reviews/pr178-native-terminal-security.md

$ git diff --check origin/main...HEAD
(no output; exit 0)

$ git diff --name-only origin/main...HEAD -- package.json package-lock.json packages/h2a-runtime/package.json packages/h2a-runtime/src/tmux.ts docs/release.md
(no output; exit 0)
```

I inspected changed-file inventory and history with:

```text
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
git log --oneline --decorate --reverse origin/main..HEAD
git diff --unified=100 origin/main...HEAD -- <each non-forbidden changed path>
git diff --unified=40 114dbdcb..HEAD -- <implementation, tests, spec, CI, BRANCH.md>
nl -ba packages/h2a-runtime/src/native-terminal/{protocol,socket-path,replay-buffer,process,host,server,client,supervisor}.ts
nl -ba packages/h2a-runtime/src/native-terminal/{replay-buffer,host,server,process.functional}.test.ts
```

### Required four-file native suite

```text
$ node --version
v22.22.1
$ npm --version
11.17.0

$ npx --no-install vitest run \
    packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts \
    packages/h2a-runtime/src/native-terminal/host.test.ts \
    packages/h2a-runtime/src/native-terminal/server.test.ts \
    packages/h2a-runtime/src/native-terminal/process.functional.test.ts \
    --reporter=verbose
Test Files  4 passed (4)
Tests       23 passed (23)
Duration    3.49s
exit 0
```

### Read-only typecheck and isolated compiler/package smoke

```text
$ npx --no-install tsc -p packages/h2a-runtime/tsconfig.json \
    --noEmit --incremental false --pretty false
TS6379: Composite projects may not disable incremental compilation.
exit 2 (invalid verification command shape, not a product diagnostic)

$ npx --no-install tsc -p packages/h2a-runtime/tsconfig.json \
    --noEmit \
    --tsBuildInfoFile /tmp/pr178-native-terminal-security.tsbuildinfo \
    --pretty false
exit 0

$ npx --no-install tsc -p packages/h2a-runtime/tsconfig.json \
    --outDir /tmp/pr178-native-terminal-security-build.4Pgn7k \
    --tsBuildInfoFile /tmp/pr178-native-terminal-security-build.4Pgn7k/tsconfig.tsbuildinfo \
    --pretty false
exit 0; emitted client.js, host.js, process.js, protocol.js, replay-buffer.js,
server.js, socket-path.js, and supervisor.js plus declarations/maps under native-terminal/.

$ node --input-type=module -e '<import the isolated supervisor; start its default host; ping; stat; SIGTERM>'
{"ping":{"generation":"compiled-default-spawn","hostPid":13,"protocolVersion":1},
 "spawnedPid":13,"socketMode":"600","socketUid":1000,"socketType":true}
exit 0
```

All compiler outputs and probe state were written under `/tmp`, not into the repository.

### Adversarial probes

The probes were fileless `node -e` programs importing the exact checkout through `tsx` (or the isolated emitted JavaScript). Their operation sequences and observed results were:

```text
1. Same-UID rogue peer:
   createServer(host.sock); chmod 0600; NativeTerminalClient.connect(); ping()
   -> parent uid/mode/type = 1000/0700/directory
   -> socket uid/mode/type = 1000/0600/socket
   -> accepted generation "same-uid-rogue" (documented residual boundary)

2. Forced connect-time replacement, repeated 20 times:
   pre-inspect original inode; accept; unlink; bind replacement; post-inspect
   -> 14 "socket changed", 2 ENOENT, 4 non-0600 transitional rejection
   -> 0 accepted

3. Incompatible response envelope:
   peer replies {version:999,id:<matching>,ok:true,result:<valid ping>}
   -> accepted (Finding 2)

4. Malformed error envelope:
   peer replies {version:1,id:<matching>,ok:false}
   -> uncaught TypeError reading error.message (Finding 2)

5. Exact-limit raw request against in-process server:
   send 33,554,432-byte JSON line with overlong request id; await write flush
   -> uncaught RangeError "terminal response exceeds the frame limit"
   A preliminary 3-second probe that did not await sender flush was inconclusive;
   the corrected flush-aware probe reproduced in about 16 seconds.

6. Same exact-limit request against standalone process.ts host:
   -> host exit {code:1, signal:null} (Finding 1)

7. Real host capacity:
   process.ts --max-sessions 2; create two sleeping shell PTYs; create third
   -> two retained/running; third rejected "terminal host session limit reached: 2"

8. Startup failure waves:
   100 concurrent client() calls; 100 immediate; wait 275ms; 100 concurrent
   -> spawn counts 1, 1, 2; rejected counts 100, 100, 100
   -> failure and backoff messages retained the intentional child stderr
```

The exact commands for the two gating reproducers were:

```bash
# Finding 1 — standalone host termination
node --input-type=module -e '
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";
const MAX = 32 * 1024 * 1024;
const directory = await mkdtemp(join(tmpdir(), "pr178-real-frame-dos-"));
const socketPath = join(directory, "host.sock");
const entry = resolve("packages/h2a-runtime/src/native-terminal/process.ts");
const child = spawn(process.execPath, ["--import", "tsx", entry,
  "--socket", socketPath, "--generation", "raw-frame-probe",
  "--replay-bytes", "1024", "--max-sessions", "2"],
  {stdio: ["ignore", "pipe", "pipe"], env: process.env});
let stdout = "", stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const readyDeadline = Date.now() + 5000;
while (!stdout.includes("h2a.native-terminal.ready") &&
       child.exitCode === null && Date.now() < readyDeadline) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
}
if (!stdout.includes("h2a.native-terminal.ready")) {
  throw new Error("host did not become ready: " + stderr);
}
const socket = createConnection(socketPath);
socket.on("data", () => {});
await new Promise((resolveConnect, reject) => {
  socket.once("connect", resolveConnect);
  socket.once("error", reject);
});
const empty = JSON.stringify({version: 1, id: "", operation: "ping"});
const frame = JSON.stringify({
  version: 1,
  id: "A".repeat(MAX - Buffer.byteLength(empty)),
  operation: "ping",
});
await new Promise((resolveWrite, reject) =>
  socket.write(frame + "\n", (error) => error ? reject(error) : resolveWrite()));
const exited = await Promise.race([
  once(child, "exit").then(([code, signal]) => ({code, signal})),
  new Promise((resolveTimeout) =>
    setTimeout(() => resolveTimeout({timeout: true}), 15000)),
]);
console.log(JSON.stringify({
  requestBytes: Buffer.byteLength(frame),
  hostExit: exited,
  stderrTail: stderr.slice(-240),
}));
socket.destroy();
if (child.exitCode === null && child.signalCode === null) {
  child.kill("SIGKILL");
  await once(child, "exit");
}
await rm(directory, {recursive: true, force: true});
'
```

```bash
# Finding 2a — incompatible response version accepted
node --import tsx --input-type=module -e '
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { NativeTerminalClient } from
  "./packages/h2a-runtime/src/native-terminal/client.ts";
const directory = await mkdtemp(join(tmpdir(), "pr178-version-"));
const socketPath = join(directory, "host.sock");
const server = createServer((socket) => {
  socket.setEncoding("utf8");
  socket.once("data", (chunk) => {
    const request = JSON.parse(String(chunk).split("\n")[0]);
    socket.write(JSON.stringify({
      version: 999,
      id: request.id,
      ok: true,
      result: {
        generation: "wrong-envelope-version",
        hostPid: process.pid,
        protocolVersion: 1,
      },
    }) + "\n");
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolve);
});
await chmod(socketPath, 0o600);
const client = await NativeTerminalClient.connect(socketPath);
const ping = await client.ping();
console.log(JSON.stringify({
  outcome: "accepted",
  responseEnvelopeVersionSent: 999,
  ping,
}));
client.close();
await new Promise((resolve) => server.close(resolve));
await rm(directory, {recursive: true, force: true});
'
```

```bash
# Finding 2b — malformed error throws out of the socket callback
node --import tsx --input-type=module -e '
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { NativeTerminalClient } from
  "./packages/h2a-runtime/src/native-terminal/client.ts";
const directory = await mkdtemp(join(tmpdir(), "pr178-malformed-response-"));
const socketPath = join(directory, "host.sock");
const server = createServer((socket) => {
  socket.setEncoding("utf8");
  socket.once("data", (chunk) => {
    const request = JSON.parse(String(chunk).split("\n")[0]);
    socket.write(JSON.stringify({
      version: 1,
      id: request.id,
      ok: false,
    }) + "\n");
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolve);
});
await chmod(socketPath, 0o600);
const client = await NativeTerminalClient.connect(socketPath,
  {requestTimeoutMs: 200});
let resolveUncaught;
const uncaughtPromise = new Promise((resolve) => {
  resolveUncaught = resolve;
});
process.once("uncaughtException", (error) =>
  resolveUncaught({name: error.name, message: error.message}));
void client.ping();
const outcome = await Promise.race([
  uncaughtPromise,
  new Promise((resolve) =>
    setTimeout(() => resolve("no-uncaught-exception"), 500)),
]);
console.log(JSON.stringify(outcome));
client.close();
await new Promise((resolve) => server.close(resolve));
await rm(directory, {recursive: true, force: true});
'
```

## Acceptance required for a new review

Owner: PR author.

1. Bound and contain every server error-response path so an exact-limit invalid request cannot terminate the host or unrelated PTYs.
2. Strictly parse client responses, enforce envelope version 1, and fail the connection without uncaught exceptions or orphaned promises on malformed variants.
3. Add the raw-peer and standalone-process regressions described in Findings 1 and 2.
4. Re-run the explicit four-file suite, read-only typecheck, compiled default-spawn smoke, and the new adversarial regressions on a newly pinned target/diff.
