# PR #178 review leg — security and trust boundaries

- Status: COMPLETE
- Exact target: `a6e46cf08a62af41afede2f423c4004e150cecc4`
- Base: `2544b16b81994563630fdb6d3d4f859806b9d2fb` (`origin/main`)
- Target diff SHA-256: `ed6bf6945d1eeea7826958a1430d219c30e692850d176d8c3167236c3814464a`
- Reviewer host: `claude` (Claude Code CLI, non-interactive subagent leg)
- Reviewer model: `claude-sonnet-5` (Sonnet 5)
- Reviewer effort: session `reasoning_effort` parameter observed at `80`; the review-worker dispatch labeled this leg "xhigh" but I can only attest to the actual value exposed to this session, which is `80`. Recording the discrepancy rather than parroting the requested label, per the instruction to report actual identity.
- Lens: Unix socket directory/mode/ownership and stale-socket races; protocol parsing/version/frame and replay/resource bounds; controller authorization/generation fencing; PTY command/environment handling; denial-of-service and cleanup behavior; package/CI surface; accuracy of Greywall/security claims; spawn-storm and cross-session isolation risk.
- Independence: this is a blind leg. I did not read `docs/reviews/pr178-native-terminal-correctness.md` or `docs/reviews/pr178-native-terminal-consensus.md`.

## Verification of target/base/diff (done first, per instructions)

```
$ git rev-parse HEAD
a6e46cf08a62af41afede2f423c4004e150cecc4
$ git rev-parse origin/main
2544b16b81994563630fdb6d3d4f859806b9d2fb
$ git diff 2544b16b81994563630fdb6d3d4f859806b9d2fb a6e46cf08a62af41afede2f423c4004e150cecc4 > /tmp/pr178.diff
$ sha256sum /tmp/pr178.diff
ed6bf6945d1eeea7826958a1430d219c30e692850d176d8c3167236c3814464a  /tmp/pr178.diff
```

Both refs and the diff hash match exactly what was assigned. `git diff --stat` confirms the changed surface is limited to `packages/h2a-runtime/src/native-terminal/**` (new module), `packages/h2a-runtime/src/pty.ts` (adds a `pid` getter), `packages/h2a-runtime/src/index.ts` (adds re-exports only — **no call site wires this into any live command**), `.github/workflows/ci.yml` (+2 lines), `BRANCH.md`, and two new docs. No `package.json`/`package-lock.json` changes anywhere in the diff — no new dependency surface.

## Commands run and results

```
$ node -v && npm -v
v22.22.1 / 11.17.0

$ npx --no-install vitest run packages/h2a-runtime/src/native-terminal/*.test.ts --reporter=verbose
 ✓ replay-buffer.test.ts (4 tests)
 ✓ host.test.ts (6 tests)
 ✓ server.test.ts (3 tests)
 ✓ process.functional.test.ts (3 tests) — includes the real-PTY functional test
   and "should converge competing supervisors on one socket without repeated host spawns"
 Test Files  4 passed (4) / Tests  17 passed (17)

$ npm run typecheck
> tsc -b --pretty false   (repo-wide, clean, no output = success)
```

All claims in `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md` that are marked `test`-enforced were independently re-run by me on the exact target commit and pass — including the multi-supervisor race convergence test (HOST-02) and the graceful-drain/socket-removal test (ACCEPT-04). I did not take the doc's or the test file's word for it; I ran them myself. No fabricated-verdict risk here.

I also wrote a standalone, read-only reproduction (outside the repo, `/tmp/pr178-repro/mitm.mjs`, no repo files touched) to test a specific hypothesis about the client-side trust path — see Finding 1.

## Findings (severity-ranked)

### Finding 1 — HIGH: no ownership (uid) check anywhere in the socket trust chain; client accepts any first-bound listener validated only by a spoofable ping shape

**Evidence, host setup path:**
- `packages/h2a-runtime/src/native-terminal/server.ts:266-279` (`ensurePrivateSocketDirectory`): when the socket's parent directory already exists, the function checks `info.isDirectory()` and `(info.mode & 0o077) !== 0` — **mode bits only**. It never compares `info.uid` to `process.getuid()`.
- `packages/h2a-runtime/src/native-terminal/server.ts:253-264` (`removeStaleSocket`): decides "stale vs. live" purely via `socketAcceptsConnections` (a raw `connect()` probe). It never checks who owns the socket file before treating it as safe to delete/replace.

**Evidence, client connect path (the actually exploitable side):**
- `packages/h2a-runtime/src/native-terminal/client.ts:42-57` (`NativeTerminalClient.connect`): calls `createConnection(socketPath)` and resolves on the bare `"connect"` event. No `fs.lstat` of the target path, no ownership/mode check at all before treating the peer as trusted.
- `packages/h2a-runtime/src/native-terminal/supervisor.ts:44-74` (`connectHealthy`): the *only* gate before a caller trusts a socket as "the host" is that `ping()` returns a payload shaped like `{protocolVersion: 1, generation: <non-empty string>, hostPid: <positive safe integer>}`. This is a wire-format shape check, not an identity check, and the wire format is simple, documented JSON-lines (`protocol.ts`) that any local process can replicate.
- `packages/h2a-runtime/src/native-terminal/supervisor.ts:134-141` (`#connectOrStart`): `connectHealthy` is tried **first**, before any host is ever spawned. If something is already listening and answers a well-formed ping, the supervisor never attempts to start a real host at all — it hands back a client bound to whatever answered.

**Demonstrated, not just theorized.** I wrote a rogue Unix-socket listener that is not `NativeTerminalHost` at all — it just answers `ping` with a fabricated payload — and pointed the real `NativeTerminalClient.connect` at it:

```
$ node --import tsx /tmp/pr178-repro/mitm.mjs
rogue listener bound at .../h2a-mitm-34lpCl/host.sock mode 0700, uid 1000
client accepted rogue host ping as valid: { generation: 'attacker-controlled-generation', hostPid: 999999, protocolVersion: 1 }
passes connectHealthy's validation shape-check: true
```

The client fully accepted the rogue listener as a valid host. Nothing in `NativeTerminalClient` or `connectHealthy` would have rejected this even if the rogue listener had a *different* uid than the caller — the mode-bit check in `ensurePrivateSocketDirectory` only runs on the **host's own** startup path, and even that check verifies *mode*, never *uid*. Once "connected", a rogue listener that also implements `create`/`write`/`read-output` framing can transparently proxy to a real terminal while recording every byte of input and output (credentials, tokens, commands) — a full same-host MITM, not merely a denial of service.

**Why this matters for *this specific* codebase, not just in the abstract:** the project's own persistent record (and `docs/uat`/CI comments in this same repo) documents that h2a's actual deployment model runs *multiple different agent CLIs concurrently under the same OS user* (Claude, Codex, Gemini instances), and that at least one of those (Codex) runs with **no kernel-level sandboxing** (no Landlock, seccomp disabled) — i.e. "same uid" in this codebase is not a small, single-trust-level domain. It spans multiple agent processes with materially different trust levels. A same-uid squatter is a realistic adversary model here, not a contrived one.

**Accuracy of the security claims (explicitly in scope for this lens).** `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md:22` (CTRL-01) and `:41` (ACCEPT-03) state: *"Same-UID socket authorization only; Greywall must hide the socket from workers."* This phrasing asserts that same-UID authorization **is** the achieved baseline. It is not: no code path checks UID anywhere in this diff (`grep -rn "uid\|getuid\|SO_PEERCRED" packages/h2a-runtime/src/native-terminal/*.ts` returns zero hits). What is actually implemented is "mode-bit hygiene on the directory the *host* creates, plus first-bind-wins" — which is weaker than "same-UID authorization" and does not defend against the squat-and-answer-ping scenario demonstrated above. `GREY-01` ("This branch creates no new OS guarantee") is honestly worded and not overclaiming; `ACCEPT-03`'s "Same-UID socket authorization" phrase is the one that overstates what the code does. The `SPEC_EVOL`'s "Deferred migration gates" section defers "Peer-credential policy beyond private same-UID socket permissions" — that reads as deferring the *stronger*, kernel-verified guarantee (`SO_PEERCRED`, unavailable without native bindings via Node's public `net` API), not as disclosing the absence of even a basic `fs.lstat`-based uid/mode check on the path being trusted. That plain stat-based check is cheap, requires no native code, and is the standard mitigation used by comparable local-socket tools (ssh-agent, gpg-agent, tmux) — it is missing here.

**Mitigating context.** Nothing in this diff wires these primitives into a live command (`index.ts` only adds re-exports; there are no callers of `NativeTerminalHostSupervisor`/`socketPath` outside `native-terminal/**` and the new exports). Today's blast radius is zero because nothing reachable calls this code yet. But this PR is explicitly the foundation other lots will build on as-is ("this branch exports the seam"), so the gap should be closed in the primitive now rather than inherited silently by the wiring lot.

**Recommended fix, concrete and scoped to this module:**
1. In `ensurePrivateSocketDirectory` (server.ts:266-279), when the directory pre-exists, also reject if `info.uid !== process.getuid()`.
2. In `removeStaleSocket` (server.ts:253-264), check the socket file's `uid` before treating it as reusable/stale-and-deletable.
3. In `NativeTerminalClient.connect` / `connectHealthy` (client.ts:42-57, supervisor.ts:44-74), `lstat` the target path before connecting and refuse to trust it (or refuse to accept its ping) unless it is a socket, mode `0600`, and owned by `process.getuid()`.
4. Document, in the spec's "Deferred migration gates", that only filesystem-level uid/mode verification is provided — true kernel peer-credential verification (`SO_PEERCRED`) remains deferred — rather than asserting "Same-UID socket authorization" as already achieved.

This is the reason for my NO-GO below.

### Finding 2 — MEDIUM: no upper bound on concurrent sessions per host (resource-exhaustion DoS)

`NativeTerminalHost.create()` (`packages/h2a-runtime/src/native-terminal/host.ts:101-139`) rejects a duplicate id or an empty id, but enforces no maximum on the number of live sessions. Any client that can reach the socket (or a caller with a retry-loop bug) can call `create` in a loop and spawn unbounded real OS processes/PTYs with no host-level safety valve. This is inconsistent with the otherwise careful resource bounding elsewhere in the same PR (replay bytes capped at `NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION`, frames capped at `NATIVE_TERMINAL_MAX_FRAME_BYTES` — see `protocol.ts:7-9`). Given the review lens explicitly calls out "denial-of-service" and "spawn-storm" risk, and this module is the direct successor to a tmux-based design whose prior status-bar subprocess spawn-storm was serious enough to require its own remediation (referenced in this repo's own history), a session-count ceiling (even a generous, configurable one, mirroring the `--replay-bytes` pattern in `process.ts:31-40`) belongs in this primitive before it is relied upon.

### Finding 3 — LOW: `stop` signal string is unvalidated

`packages/h2a-runtime/src/native-terminal/server.ts:164-171` only checks that `record.signal`, if present, is a `string` — any non-empty string is forwarded through `host.stop(id, signal)` to `record.pty.kill(signal)` (`host.ts` `stop()`) and ultimately to `node-pty`'s `kill()`. There is no allowlist of valid POSIX signal names. Impact is low — a same-uid caller already has equivalent kill capability over its own child processes via the exposed `pid` field — but this is a basic input-hygiene gap worth closing (e.g. validate against `SIGTERM|SIGKILL|SIGINT|SIGHUP|...`) since a malformed value could produce a confusing failure mode rather than a clean `TypeError` at the protocol boundary, where every other parameter in this file is strictly validated (see `requiredString`/`requiredInteger`/`createOptions` in the same file).

### Finding 4 — LOW / informational: new CI step reintroduces a known glob-fragility pattern, unguarded by OS

`.github/workflows/ci.yml:111-112` adds:
```
- name: Exercise the native multi-session terminal host
  run: npx --no-install vitest run packages/h2a-runtime/src/native-terminal/*.test.ts
```
to the `build-and-test` matrix job. This is a bare shell glob passed to a `run:` step, not gated by `if: runner.os == 'Linux'` (contrast with the very next step in the same file, `check-public-contract.sh`, which is so gated). `scripts/run-tests.mjs`'s own header comment (lines 4-8 of that file) explains *why* the repo's root test runner deliberately avoids shell globs: they "silently break on PowerShell (Windows runners), where the literal asterisk is forwarded to node." Today this is harmless because `matrix.os` is pinned to `[ubuntu-latest]` (Windows is parked per DEC-061/062, documented in `ci.yml:80-99`), so bash glob expansion is guaranteed. It is a latent trap for whenever that parked Windows leg is reactivated — worth a one-line `if: runner.os == 'Linux'` guard now so it fails loudly rather than silently matching zero files (or a differently-broken glob) if the matrix changes later. Not a security vulnerability; flagged because "package/CI surface" is explicitly in this lens.

## Things I verified are done correctly (not findings — recorded so the consensus step doesn't have to re-derive them)

- **Controller-lease binding to the connection** (CTRL-01): `packages/h2a-runtime/src/native-terminal/server.ts:68-75` (`ownedLease`) requires the presented lease to be an object already present in *this specific connection's* `context.leases` map — not merely field-equal to the host's current state. A different connection that somehow learned another connection's lease fields (id/generation/controllerId/epoch) still cannot `write`/`resize`/`release-controller` with it, because `ownedLease` checks map membership keyed to the connection, not equality against host state. Confirmed by both code reading and the passing test `"should bind controller authority to its connection and release it on disconnect"` (server.test.ts:136-157), which I re-ran.
- **Epoch fencing fails closed** (host.ts `#requireController`, lines 282-294): generation, running-status, controllerId and epoch must all match; a stale lease (post-release, post-stop, post-exit) is rejected with `"stale terminal controller lease"`. Confirmed by re-running `host.test.ts`'s "should reject stale controller epochs..." and "should fence the active controller when its session becomes terminal" tests.
- **Symlink-safety of stale-socket cleanup**: `removeStaleSocket` (server.ts:253-264) uses `lstat` (not `stat`) and `unlink` (which never dereferences a symlink for removal), so a symlink planted at the socket path can neither be silently followed into "is this a socket" logic nor cause deletion of an arbitrary target file. This correctly avoids the classic CWE-367/CWE-378 symlink-race deletion bug.
- **Shutdown-path identity check**: `server.ts:333-337` compares `dev`/`ino` of the file currently at `socketPath` against the socket this server actually bound before unlinking it on close — this is exactly the kind of identity check that Finding 1 shows is missing on the *connect* path. Its presence here shows the pattern was known to the author; it just wasn't applied where it matters most (the client trusting a peer).
- **Frame/replay bound consistency**: `NATIVE_TERMINAL_MAX_FRAME_BYTES` (32 MiB, `protocol.ts:9`) comfortably covers the worst-case JSON-escaping expansion of `NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION` (4 MiB, `protocol.ts:7`) at the documented ~6x NUL-escaping factor, and the bound is enforced symmetrically on both server (`server.ts:196-240`) and client (`client.ts:130-163`) read paths, and on both request/response write paths. Per-connection unconsumed input is also capped (`server.ts:236-239`), preventing unbounded buffer growth from a slow-lined or malicious sender.
- **Cross-session read openness is intentionally and accurately scoped, not a silent gap**: any connected client can `list`/`state`/`read-output`/`attach-observer`/`stop` *any* session id, with no per-session ownership — but this is explicitly and accurately disclosed as the model in `SPEC_EVOL` CTRL-01/ACCEPT-03 ("Multi-user authorization is not introduced here"). Given the socket is meant to be single-owning-process/same-uid, and the doc says so plainly, I do not treat this as a defect — it's a legitimate design choice for a same-uid multiplexer, accurately labeled. It is, however, downstream of Finding 1: it accurately describes the *intended* boundary, but Finding 1 shows the boundary "same UID" is not actually code-enforced at the socket layer.
- **No new dependency/package surface**: confirmed via `git diff` against `**/package.json` and `package-lock.json` — zero hits. `node-pty` predates this branch (`git log --follow -- packages/h2a-runtime/src/pty.ts`); this PR only adds a `pid` getter to the existing spawner wrapper (`pty.ts:6-9,41-43`) and a `createRequire` shim, both of which are inert with respect to attack surface.
- **`env` handling in the PTY spawner** (`pty.ts:28-39`): `options.env` is passed to `node-pty`'s `spawn` verbatim — it *replaces* rather than merges with `process.env`, so the caller fully controls the child's environment. This is appropriate for a same-uid terminal-execution primitive (the caller already has equivalent capability) and is not a privilege-escalation vector.

## Reasoning against each requested lens item

- **Unix socket directory/mode/ownership and stale-socket races** — mode is checked and enforced correctly (0700 dir / 0600 socket, confirmed by `server.test.ts` assertions and my own test run); ownership is not checked anywhere → Finding 1. Stale-socket detection is safe against symlink tricks but relies entirely on a connect-probe, which the client-side race (supervisor tries "already healthy" before "spawn new") makes moot for an attacker who's pre-squatted the path — see Finding 1's reproduction.
- **Protocol parsing/version/frame and replay/resource bounds** — solid: strict version/operation/id/params validation (`protocol.ts:77-105`), symmetric frame-size caps, replay budget caps enforced at construction (`replay-buffer.ts:28-33`) and at supervisor/process-arg parsing (`process.ts:31-40`, `supervisor.ts:93-101`). No overflow/underflow or unbounded-growth issue found. Session-count is the one resource dimension left unbounded — Finding 2.
- **Controller authorization/generation fencing** — correctly implemented and tested; see "verified correct" section above. This is the strongest part of the change.
- **PTY command/environment handling** — appropriate for the trust model (same-uid, caller already can run arbitrary commands); no injection surface beyond what the caller already has.
- **Denial-of-service and cleanup behavior** — bounded graceful/forced drain (`process.ts:22-29,88-117`) verified by a real functional test I re-ran; unbounded session count is the residual gap (Finding 2).
- **Package/CI surface** — no new dependencies; one latent CI-glob fragility, non-blocking (Finding 4).
- **Accuracy of Greywall/security claims** — GREY-01 is honestly scoped; ACCEPT-03/CTRL-01's "Same-UID socket authorization" phrasing overstates what the code enforces (Finding 1).
- **Spawn-storm / cross-session isolation risk** — the multi-supervisor race-convergence mechanism (HOST-02) works correctly and safely *among cooperating, legitimately-started supervisors* (verified by re-running the "should converge competing supervisors..." test) because it ultimately rests on the kernel's atomic `bind()`. It does **not** protect against a non-cooperating, pre-positioned listener, because the supervisor tries "is something already answering ping" before "should I even care whether that something is mine" — that's Finding 1, not a spawn-storm issue in the benign-race sense the test covers. Cross-session isolation between different logical sessions on one legitimate host is intentionally absent and accurately documented (see above) — not a defect in itself, but it raises the stakes of Finding 1 (a MITM socket doesn't just intercept one session, it can intercept everything routed through it).

## Verdict

**NO-GO** (security/trust-boundary lens).

Rationale: Finding 1 is a concrete, demonstrated (not hypothetical) gap in the exact trust boundary this lens was asked to assess, in code the PR's own spec document claims provides "Same-UID socket authorization." It is squarely actionable (three specific, small call sites need an added `uid` comparison; no design rework required) and unresolved as of the reviewed commit. Per the review instructions, an unresolved actionable finding means GO is not available. Finding 2 (unbounded session count) is a secondary, also-actionable blocking-severity DoS gap for the same reason. Findings 3 and 4 are non-blocking, informational hygiene notes for the follow-up.

None of this reflects poorly on the engineering quality of the controller-fencing, replay-bounding, or drain/shutdown work, which is unusually careful and was independently verified to work as claimed. The gap is specifically in the "is the thing I'm about to trust actually mine" check at the one layer (socket connect) that will matter most once this foundation is wired into a live command.
