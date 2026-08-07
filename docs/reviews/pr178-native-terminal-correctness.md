# PR #178 final native Codex review — correctness and runtime lifecycle

- Status: **COMPLETE — NO-GO**
- Base: `origin/main@83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Exact target: `0a20b7cbddb1e4a7ff986668274105c5d03d6a20`
- Target binary-diff SHA-256: `af56965a97f9e369176852873b19a6c393f09e7f56c08a7ef66ef2049824480b`
- Diff surface: 23 files, 3,383 insertions, 35 deletions.
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
| Lens | persistent native Node ownership, real multi-PTY lifecycle, generation/epoch/connection fencing, read-only observers, stop escalation and replacement, adoption/races, crash/graceful shutdown, resource and request bounds, startup backoff/diagnostics, execution-test adequacy, and honest deferred cutover |

The model and effort above are the native runtime identity assigned to this review leg, not inferred from
repository contents.

## Immutable target verification

The required pre-review check matched exactly:

```text
$ git rev-parse HEAD
0a20b7cbddb1e4a7ff986668274105c5d03d6a20
$ git rev-parse origin/main
83bc1fa609fd0458833a2dcebc1bf56476657a56
$ git diff --binary origin/main...HEAD | sha256sum
af56965a97f9e369176852873b19a6c393f09e7f56c08a7ef66ef2049824480b  -
```

The complete non-review implementation diff, its specification/branch/CI changes, and this leg's preserved
initial report at commit `114dbdcb` were inspected. The sibling and consensus artifact contents were excluded
as explicitly required. `git diff --name-only origin/main...HEAD -- packages/h2a-runtime/src/tmux.ts
packages/h2a-runtime/src/run.ts package.json package-lock.json docs/release.md` returned no paths.

## Commands and results

| ID | Exact command | Result |
|---|---|---|
| C1 | `git rev-parse HEAD` | `0a20b7cbddb1e4a7ff986668274105c5d03d6a20` |
| C2 | `git rev-parse origin/main` | `83bc1fa609fd0458833a2dcebc1bf56476657a56` |
| C3 | `git diff --binary origin/main...HEAD \| sha256sum` | `af56965a97f9e369176852873b19a6c393f09e7f56c08a7ef66ef2049824480b  -` |
| C4 | `git diff --no-ext-diff --find-renames origin/main...HEAD -- .github/workflows/ci.yml BRANCH.md docs/reviews/native-terminal-host-lot1.md docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md packages/h2a-runtime/src/index.ts packages/h2a-runtime/src/pty.ts packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts` | all hunks inspected |
| C5 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/protocol.ts packages/h2a-runtime/src/native-terminal/replay-buffer.ts packages/h2a-runtime/src/native-terminal/socket-path.ts packages/h2a-runtime/src/native-terminal/process.ts` | all hunks inspected |
| C6 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/host.ts` | all hunks inspected |
| C7 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/server.ts` | all hunks inspected |
| C8 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/client.ts packages/h2a-runtime/src/native-terminal/supervisor.ts` | all hunks inspected |
| C9 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts packages/h2a-runtime/src/native-terminal/host.test.ts` | all hunks inspected |
| C10 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/server.test.ts` | all hunks inspected |
| C11 | `git diff --no-ext-diff origin/main...HEAD -- packages/h2a-runtime/src/native-terminal/process.functional.test.ts` | all hunks inspected |
| C12 | `npx --no-install vitest run packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts packages/h2a-runtime/src/native-terminal/host.test.ts packages/h2a-runtime/src/native-terminal/server.test.ts packages/h2a-runtime/src/native-terminal/process.functional.test.ts --reporter=verbose` | **4 files / 23 tests passed**, 3.60 s; all five Linux real-PTY cases executed |
| C13 | `npx --no-install tsc -b packages/h2a-runtime --pretty false --force` | exit 0; exact-target `dist/native-terminal/*.js` emitted |
| C14 | `npx --no-install vitest run packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts --reporter=verbose` | **2 files / 6 tests passed** |
| C15 | `npm run typecheck` | exit 0 |
| C16 | `git diff --check origin/main...HEAD` | exit 0, no output |
| P0 | `node --input-type=module <<'NODE'` — first version of P1 | exit 1 before spawning: the nested probe source under-escaped `"$line"` and raised `SyntaxError: Unexpected identifier '$line'`; corrected in P1 |
| P1 | `node --input-type=module <<'NODE'` — inline compiled-default-spawn/adoption probe described below | exit 0; detached host PID 25, PTY PID 36, separate adopter used the same PIDs with zero spawn attempts and observed an echo; graceful shutdown removed host and socket |
| P2 | `node --input-type=module <<'NODE'` — inline malformed-peer probe described under F1 | outer probe exit 0; victim Node process exit **1** with uncaught `TypeError` from `NativeTerminalRemoteError` |

The P1 coordinator used the emitted `dist/native-terminal/supervisor.js` with no `spawnHost` override in a
child OS process, let that spawner exit, inspected `/proc`, then launched a second OS process whose override
would throw on any spawn. Its measured result was:

```json
{
  "spawnedIdentity": {
    "hostPid": 25,
    "generation": "default-spawn-generation",
    "ptyPid": 36
  },
  "hostProcStatus": {
    "Name": "node",
    "Pid": "25",
    "PPid": "1",
    "NSpgid": "25",
    "NSsid": "25"
  },
  "directChildren": [36],
  "ptyExe": "/usr/bin/dash",
  "adopted": {
    "adoptedHostPid": 25,
    "spawnAttempts": 0,
    "sessionPid": 36,
    "sawEcho": true
  },
  "shutdown": {
    "hostGone": true,
    "socketGone": true
  }
}
```

P1 therefore exercises the production-only details absent from the TSX functional spawners: emitted
`process.js` resolution, `defaultSpawnHost`, detached session/process-group ownership, ignored stdout,
unref'd child, cross-process adoption after the spawning process has exited, and graceful replacement-ready
cleanup. The host's only direct child was the real `dash` PTY; no Node subprocess was created per operation.

## Initial NO-GO issue classes revalidated

The initial correctness report preserved at `114dbdcb` was independently rechecked against the exact target:

| Initial class | Exact-target result |
|---|---|
| Per-session TERM-to-KILL escalation | **Resolved.** `NativeTerminalHost.stop` retains the matching lease while stopping and sends every validated signal. The real stubborn-PTY case executed: TERM left it alive, KILL ended it, and state became `exited`. |
| Observer could stop another controller's session | **Resolved.** Server `stop` now goes through `ownedLease`; the second-connection test rejects observer `write` and `stop`. |
| Exited sessions retained forever / IDs not recyclable | **Resolved.** `maxSessions` is capped, exited records are reaped under pressure, and explicit exited-ID reuse forgets the old record. Unit capacity/reuse execution passed. |
| Unbounded client and health requests | **Resolved for deadlines.** Every request has a positive timeout and supervisor health ping uses the 1 s health deadline. The stalled-peer test rejected at 50 ms. |
| Stale-socket race and old-server unlinking replacement | **Resolved.** Each server binds a unique staging socket, atomically publishes it with `link(2)`, and removes the canonical name only after dev/inode identity comparison. Replacement and competing-supervisor execution passed. |
| Restart spawn storm / discarded diagnostics | **Resolved.** Failures retain bounded stderr diagnostics and exponential 250 ms–5 s backoff prevents an immediate second spawn. The real startup-failure case observed one spawn, an immediate backoff rejection, then one allowed retry. |
| `PtyHandle.pid` broke historical test doubles | **Resolved.** Both doubles now carry inert PIDs; their 6 tests and runtime/root typechecks pass. |

## Runtime-lifecycle conclusions

- **Native ownership is real.** The committed suite and P1 show one persistent Node host directly owning
  multiple `node-pty` children. There is no tmux reference inside `src/native-terminal`, no tmux diff, and
  the `/proc` evidence shows `dash`, not Node, as the host's sole child during the default-spawn probe.
- **Controller fencing is coherent.** Generation, controller ID, epoch, and connection ownership are checked
  together. Exit/release/disconnect invalidates ownership; a stopping owner can escalate, and a disconnected
  stopping owner can be replaced without restoring write/resize authority.
- **Observers are read-only for session mutation.** Write, resize, release, and stop all require the lease
  stored on that connection.
- **Crash and graceful shutdown are bounded in the exercised cases.** SIGKILL of the host reaped its live PTY.
  Graceful shutdown drained a TERM-ignoring PTY through KILL, exited code 0, removed the socket, and allowed a
  distinct replacement generation.
- **Supervisor convergence and adoption work.** Competing supervisors spawned two candidates but converged
  on one surviving host; reconnects did not spawn again. P1 additionally proves adoption from a separate OS
  process after the original spawner exits.
- **Declared resource bounds are present.** Replay data is capped per session, retained session count is
  capped, frames are capped, requests have deadlines, startup publication retries are capped, and restart
  rate is backed off.
- **The five Linux functional cases are substantive.** They cover multi-session/reconnect/crash, graceful
  TERM-to-KILL host drain/restart, controller-owned stubborn-session escalation, diagnostic/backoff, and
  competing-supervisor convergence. Their custom TSX spawn wrappers do not exercise the compiled default
  spawn shape; P1 confirms that shape works on this exact target, but it remains manual rather than a committed
  regression case.
- **Production cutover is accurately deferred.** Repository search found no production constructor/caller of
  the client or supervisor outside exports/tests. `run.ts`, `tmux.ts`, package metadata, release material, and
  default backend call sites are unchanged. The specification explicitly makes local-server wiring, parity,
  soak, Greywall enforcement, and owner cutover later gates.

## Findings (severity-ranked)

### F1 — MEDIUM — A malformed error response crashes the client process instead of failing the request closed

Locations:

- `packages/h2a-runtime/src/native-terminal/client.ts:231-241`
- `packages/h2a-runtime/src/native-terminal/protocol.ts:85-91`

`NativeTerminalClient.#onData` validates only that the decoded value is a record with string `id` and boolean
`ok`, then casts it to `NativeTerminalResponse`. It does not validate top-level `version`, the discriminated
success/error shape, error code, or error message. For an `ok: false` frame whose ID matches a pending request,
the client deletes the pending entry and clears its deadline before constructing
`NativeTerminalRemoteError(response.error)`. If `error` is absent, the constructor dereferences
`undefined.message` inside the socket `data` callback. The exception is not routed through `#fail`, so it is
uncaught; with a process-level uncaught handler it would also leave the original promise unresolved because
the pending entry was already removed.

P2 used a real private Unix socket in an `0700` directory, changed its mode to `0600`, let the real compiled
client connect, decoded its ping request to obtain the matching ID, and replied:

```json
{"version":1,"id":"<matching request UUID>","ok":false}
```

The victim process result was:

```text
exit code: 1
stdout: <empty>
TypeError: Cannot read properties of undefined (reading 'message')
    at new NativeTerminalRemoteError (.../dist/native-terminal/protocol.js:22:21)
    at #onData (.../dist/native-terminal/client.js:182:32)
```

This requires a broken, incompatible, or hostile same-UID peer able to occupy the private socket path; it is
not a remote-network issue, and production cutover is deferred. It is still an actionable protocol-boundary
correctness defect: filesystem identity/mode checks establish which socket inode was connected, not that its
frames satisfy the versioned response contract. A malformed local peer must reject requests and close the
client, not terminate the calling control-plane process.

Required remediation: parse and validate every response before touching the pending map (including protocol
version, discriminator, and error `{code,message}`), and on invalid data destroy/fail the client so all pending
requests reject. Add a raw-socket regression proving a matching malformed error response rejects `ping()` and
the caller stays alive.

No other unresolved actionable correctness finding was found in the assigned lens.

## Verdict

**NO-GO.** The original seven issue classes are repaired and the native host foundation otherwise behaves as
claimed under real execution, including the compiled default-spawn/adoption path. However, F1 remains a
reproducible process-crash defect at the versioned local protocol boundary. The stated gate permits GO only
when no unresolved actionable finding remains; F1 therefore blocks this exact target.
