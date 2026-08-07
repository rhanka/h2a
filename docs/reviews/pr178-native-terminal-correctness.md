# PR #178 independent final review — correctness and native terminal lifecycle

- Status: **COMPLETE — NO-GO**
- Reviewed target: `f40e24cc7e23a7bd88fef0a78325816cb4c22388`
- Required base / exact merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Binary diff SHA-256: `2ae714233d14b31baa5daafe1bf1dd77b6448acaadf97a20e20bdb9a529e9c61`
- Diff surface: 23 files, 4,047 insertions, 35 deletions
- Environment: Linux `7.0.0-29-generic` x86_64; Node `v22.22.1`; npm `11.17.0`
- Review role: first independent final correctness reviewer; prior reports were used only as historical context, and every current conclusion below was reverified against the assigned target.

## Scope and immutable-target verification

I inspected the complete diff from the required base through the target, `BRANCH.md`, the EVOL specification, package/test conventions, CI wiring, and the prior review artifacts. The checkout had no `AGENTS.md`. I did not change implementation, tests, dependencies, release files, or Track state.

```text
$ git rev-parse HEAD
f40e24cc7e23a7bd88fef0a78325816cb4c22388

$ git merge-base 83bc1fa609fd0458833a2dcebc1bf56476657a56 f40e24cc7e23a7bd88fef0a78325816cb4c22388
83bc1fa609fd0458833a2dcebc1bf56476657a56

$ git diff --binary 83bc1fa609fd0458833a2dcebc1bf56476657a56..f40e24cc7e23a7bd88fef0a78325816cb4c22388 | sha256sum
2ae714233d14b31baa5daafe1bf1dd77b6448acaadf97a20e20bdb9a529e9c61  -
```

`git diff --check` passed. The target diff contains no changes to `packages/h2a-runtime/src/tmux.ts`, `packages/h2a-runtime/src/run.ts`, dependency manifests/lockfiles, `.track`, or release files.

## Commands and results

| ID | Command | Result |
|---|---|---|
| C1 | `npm run typecheck` | exit 0 |
| C2 | `npx --no-install vitest run packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts packages/h2a-runtime/src/native-terminal/host.test.ts packages/h2a-runtime/src/native-terminal/server.test.ts packages/h2a-runtime/src/native-terminal/process.functional.test.ts --reporter=verbose` | exit 0; **4 files / 33 tests passed**; all nine Linux real-process tests executed |
| C3 | `npx --no-install vitest run packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts --reporter=verbose` | exit 0; **2 files / 6 tests passed** |
| C4 | `npm test` | exit 0; build, vendor/package/import checks and the full discovered root test suite passed |
| C5 | `npm run audit:security` | exit 0; security-debt gate passed with zero moderate-or-higher findings; the independent Focus audit reported three low findings only |
| C6 | `node /tmp/pr178-default-spawn-probe.mjs` | exit 0; emitted default supervisor started host PID 35, whose sole direct child was real PTY PID 46; reconnect retained host PID 35; socket was an owned mode-0600 Unix socket; graceful stop removed host, PTY and socket |
| C7 | `node --expose-gc /tmp/pr178-slow-reader-backpressure-probe.mjs <workspace>` | exit 0; only 7 of 16 legal 4 MiB replay writes were admitted; all 7 encountered backpressure; maximum `writableLength` was 29,361,500 bytes, below the 32 MiB per-connection ceiling; another client remained responsive |
| C8 | `node /tmp/pr178-connection-cap-probe.mjs` | exit 0; with one healthy client plus 63 held peers, the overflow connection was closed; the healthy client and a replacement connection both retained the same host PID |
| C9 | `node /tmp/pr178-hung-startup-probe.mjs <workspace>` | exit 0; a non-ready owned child was dead after the 5 s readiness deadline, backoff allowed a second spawn only after 250 ms, and no first child remained |
| C10 | `node /tmp/pr178-adoption-owned-child-probe.mjs` | **exit 2; reproduced F1**: winner host PID 21 was adopted, while the losing supervisor continued to report and retain its distinct live owned child PID 20 |
| C11 | `node /tmp/pr178-stubborn-crash-probe.mjs` | **exit 2; reproduced F2**: after hard-killing host PID 13, real PTY PID 24 was still `R (running)` under PID 1 two seconds later |
| C12 | `node /tmp/pr178-stubborn-startup-reap-probe.mjs` | **exit 2; reproduced F2 through the new reaper**: a frozen owned host was TERM→KILL reaped and disappeared, while its real PTY remained `R (running)` under PID 1 two seconds later |

The custom probes used emitted `dist` code built from the exact target and real Linux processes/PTYs. Their processes and socket directories were cleaned after each run.

## Findings

### F1 — HIGH — adoption can return while a different supervisor-owned child remains live

Locations:

- `packages/h2a-runtime/src/native-terminal/supervisor.ts:256-265`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts:286-301`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts:305-320`

The startup loop accepts any healthy socket and returns immediately. It does not compare the healthy ping's `hostPid` with the live child in `#spawned`, and it does not reap that child before adopting a different winner. Owned-child cleanup is reached only after the readiness deadline expires.

C10 forced this exact race. The losing supervisor spawned a child that stayed live without publishing a socket; a second supervisor then published the healthy host. Both clients converged on winner PID 21, but the losing supervisor retained `spawnedPid: 20`, and PID 20 remained live after adoption:

```json
{
  "winningHostPid": 21,
  "losingSupervisorAdoptedPid": 21,
  "sameHealthyHost": true,
  "losingSupervisorSpawnedPid": 20,
  "hungOwnedPid": 20,
  "hungOwnedStillAlive": true
}
```

This leaks a detached Node child in the exact convergence path meant to guarantee one persistent host. It also poisons later recovery: while that stale child remains live, `#connectOrStart` treats it as the owned startup and suppresses a replacement if the adopted winner later fails.

Required acceptance: when a supervisor adopts a healthy PID different from its live owned spawn, it must boundedly reap only the losing owned spawn before completing convergence, without signaling the adopted host. A real-child race test must prove one surviving Node host and no losing child, then prove that supervisor can restart normally after the winner exits.

### F2 — HIGH — hard host death and TERM→KILL startup reaping can orphan live PTYs

Locations:

- `packages/h2a-runtime/src/native-terminal/supervisor.ts:29-53`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts:305-320`
- `packages/h2a-runtime/src/native-terminal/process.ts:113-145`
- `packages/h2a-runtime/src/pty.ts:28-39`
- `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md:18`
- `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md:42`

The supervisor tracks and signals only the detached Node host PID. Real PTYs are ordinary children of that host, and the only explicit PTY drain is in catchable host signal handlers. A hard crash cannot run those handlers. Closing the PTY master is not a lifetime fence for a child that ignores terminal hangup signals.

C11 created a real shell PTY that installed `trap '' HUP TERM INT` and entered a busy loop, then sent `SIGKILL` to the host. The host disappeared, but the PTY was still actively running and reparented to PID 1 after two seconds:

```json
{
  "hostPid": 13,
  "ptyPid": 24,
  "hostAlive": false,
  "ptyAlive2000msAfterCrash": true,
  "statusLines": ["State:\tR (running)", "PPid:\t1"]
}
```

C12 then exercised the new readiness reaper itself: the host was frozen with `SIGSTOP`, the supervisor's health/readiness checks expired, TERM could not be handled, and the new code escalated to KILL. The host died and `spawnedPid` cleared, but the signal-resistant real PTY again remained running under PID 1:

```json
{
  "failure": "native terminal host did not become ready: Error: terminal host ping request timed out after 1000ms",
  "hostAlive": false,
  "ptyAlive2000msAfterReap": true,
  "statusLines": ["State:\tR (running)", "PPid:\t1"]
}
```

This directly contradicts HOST-01 and ACCEPT-04. The orphan is no longer visible or controllable through the host protocol, can outlive a newly started generation, and may retain compute, files, credentials, and descendant processes.

Required acceptance: use a lifetime-containment mechanism that does not depend on the Node host executing JavaScript after a fatal crash (for example an independently owned process group/cgroup or an equivalent kernel-enforced parent-death boundary). A Linux real-PTY regression must install HUP/TERM/INT ignores, hard-kill the host, and prove the entire PTY workload disappears; the same proof must cover forced startup reaping.

## Verified behavior that is not blocking

- The core runtime path is genuinely native: one persistent Node host directly owns multiple `node-pty` children. No changed runtime path invokes or wraps tmux, and operations/reconnect do not spawn per-operation Node children.
- Two real PTYs have independent output, input, stop and exit behavior. Client reconnect preserves the host and PTY PIDs; controller connection ownership, epoch, generation and session incarnation fences rejected stale/foreign mutations in the committed real-process cases.
- Replay is bounded by payload bytes, serialized wire bytes and chunk count; truncation is explicit, `latestSeq` is read without replay materialization, and exact-limit malformed frames do not kill the shared host.
- The response-queue remediation is effective in the exercised attacks. Per-connection response bytes/count are bounded, a shared pending-byte budget exists, the 64-connection ceiling is enforced, and a slow peer is dropped while another client and PTY remain usable.
- Graceful TERM→KILL shutdown works when the host remains able to execute its drain handler. F2 is specifically the uncatchable/frozen-host boundary that graceful tests cannot establish.
- The foundation remains behind the tmux default; no production terminal call site or release surface changed.

## Verdict

**NO-GO on `f40e24cc7e23a7bd88fef0a78325816cb4c22388`.**

The target resolves the preceding unbounded response-queue defect and the simple non-ready-child timeout case, and it demonstrates the intended persistent multi-session native architecture. It still has two actionable HIGH lifecycle defects: convergence can leak a losing supervisor-owned Node child, and a hard or forced host death can leave signal-resistant PTYs running outside all host ownership. Both violate the core one-host/crash-containment contract and must be corrected and independently re-reviewed on a new exact target before merge.
