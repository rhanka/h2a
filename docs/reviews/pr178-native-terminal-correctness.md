# PR #178 review leg — correctness and runtime lifecycle

- Status: **COMPLETE — NO-GO**
- Exact target: `a6e46cf08a62af41afede2f423c4004e150cecc4`
- Base: `origin/main` @ `2544b16b81994563630fdb6d3d4f859806b9d2fb`
- Target diff SHA-256: `ed6bf6945d1eeea7826958a1430d219c30e692850d176d8c3167236c3814464a` — **verified, matches**

## Reviewer identity

| Field | Value |
|---|---|
| Reviewer host | `claude` (Claude Code CLI) |
| Model | `claude-opus-5` (Opus 5) |
| Effort | `xhigh` |
| Machine | `antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA`, `Linux 7.0.0-29-generic` |
| Node | `v22.22.1` |
| Worktree | `/home/antoinefa/src/h2a/tmp/worktrees/native-terminal-host` |
| Leg | independent / blind — the sibling review artifact and the consensus dossier were **not** read |
| Lens | native host process ownership, multi-session behaviour, controller generation/lease fencing, reconnect/adoption and competing-supervisor races, bounded shutdown/crash, absence of repeated Node spawn, adequacy of REAL local execution tests, native-vs-tmux-dressing, production-integration claims |

## Target verification

```
$ git rev-parse HEAD
a6e46cf08a62af41afede2f423c4004e150cecc4
$ git rev-parse origin/main
2544b16b81994563630fdb6d3d4f859806b9d2fb
$ git diff 2544b16b81994563630fdb6d3d4f859806b9d2fb a6e46cf08a62af41afede2f423c4004e150cecc4 | sha256sum
ed6bf6945d1eeea7826958a1430d219c30e692850d176d8c3167236c3814464a  -
```

Diff surface: 17 files, +2219/−35. Working tree at review time carried only `M BRANCH.md` and the three
untracked `docs/reviews/pr178-*` artifacts; unchanged at review end (only gitignored `dist/` and
`tsconfig.tsbuildinfo` were regenerated).

## Commands run and results

| # | Command | Result |
|---|---|---|
| C1 | `npx --no-install vitest run packages/h2a-runtime/src/native-terminal/*.test.ts` | **17 passed / 4 files**, 2.28 s |
| C2 | same, `--reporter=verbose` | 3 real-PTY Linux functional tests **executed** (not skipped): 304 ms / 1116 ms / 284 ms |
| C3 | `rm -f packages/h2a-runtime/tsconfig.tsbuildinfo && npx tsc -b packages/h2a-runtime --pretty false` | exit 0, `dist/native-terminal/process.js` re-emitted |
| C4 | `npm run typecheck` (root) | exit 0 |
| C5 | `npx --no-install vitest run packages/h2a-runtime/src/run.test.ts packages/h2a-runtime/src/run-ws-surface.test.ts` | 6 passed |
| C6 | `npx --no-install vitest run "…/native-terminal/zzz-nonexistent*.test.ts"` | exit **1**, "No test files found" → the new CI glob fails closed |
| E1 | production spawn probe: import `dist/native-terminal/supervisor.js`, **no `spawnHost` override** (exercises `defaultSpawnHost`), create a real `/bin/sh` PTY | host pid 565671, pgid=sid=565671 (detached), PTY pid 565682, `/proc/565682/exe` → `dash`, `/proc/565671/task/565671/children` = `565682` |
| E2 | E1's parent exits without closing; a **separate OS process** adopts the socket with a `spawnHost` that throws | `adoptedHostPid: 565671`, `spawnAttempts: 0`, `hostPpidNow: 229738`, same PTY pid, write→echo round trip `true` |
| E3 | `kill -9 565671` | host gone, **PTY 565682 gone**, `srw------- host.sock` **left behind** |
| E4 | 10 concurrent `node dist/native-terminal/process.js` on a stale socket | 1 host bound, 9 died |
| E5 | 40 barrier-synchronised 6-way races on a stale socket | **0/40** double-binds |
| E6 | real `startNativeTerminalHostServer` A bound → path unlinked → real server B bound → `A.close()` | B bound while A listened; `inoA=46602077 ≠ inoB=46602114`; **socket gone after `A.close()`** |
| E7 | plain `node:net`, no product code: A listen → unlink → B listen → `A.close()` | `inodeAfterAClose: null` → **node/libuv unlinks the bound path by name on close** |
| E8 | supervisor against a host that keeps the socket open but stops replying | `sup.client()` **STILL HANGING** after 8007 ms |
| E9 | 5 sequential `sup.client()` against a host that always fails to start | 5 distinct Node pids (580200, 580225, 580236, 580247, 580258), ~160 ms each, **no backoff** |
| E10 | two connections, one holds the lease; the other calls `write` / `acquire` / `stop` / `create` | write denied, acquire denied, **`stop("victim","SIGKILL")` ALLOWED**, `create` allowed |
| E11 | session whose PTY traps `TERM HUP INT`, then `stop` TERM, then `stop` KILL | alive after TERM; second stop returns `stopping/SIGTERM`, **still alive**; re-acquire denied; recreate denied |
| E12 | ad-hoc `tsc --noEmit` over `run.test.ts` + `run-ws-surface.test.ts` | **2× TS2322 "Property 'pid' is missing"** |

## What the lens confirms in the PR's favour

These are demonstrated, not assumed.

- **Genuinely native, not tmux dressing.** E1 shows a real `node-pty` child (`/proc/<pid>/exe` → `dash`) owned
  directly by the Node host, listed in `/proc/<host>/task/<host>/children`. `grep -rni tmux
  packages/h2a-runtime/src/native-terminal/` → 0 hits; `packages/h2a-runtime/src/tmux.ts` is untouched in the
  diff (MIG-01 holds structurally).
- **Real process ownership and adoption — stronger than the suite proves.** E2 is the load-bearing result: the
  host survived its spawning process's exit (reparented to ppid 229738) and a *separate OS process* adopted it
  with **zero** spawn attempts, saw the same session and PTY pid, and completed a full write→echo round trip.
  The committed functional tests never prove this: their spawners omit `detached: true` and pipe stdio
  (`process.functional.test.ts:57-71, 156-167`), so the production `defaultSpawnHost` shape
  (`supervisor.ts:22-37`) is exercised by no test. It does work — E1/E2 verify `./process.js` resolves in the
  emitted layout, `isEntryPoint()` matches, and `files: ["dist"]` ships it.
- **HOST-01 crash semantics hold.** E3: killing the host `-9` reaped its PTY. The kernel's pty hangup is the
  real safety net, so an abrupt host death cannot orphan terminals.
- **Generation/lease fencing is sound where it is applied.** `host.ts:282-294` checks generation, liveness,
  controller id *and* epoch together; `#invalidateController` (`host.ts:296-300`) bumps the epoch on exit,
  stop and release, so a lease can never survive a terminal transition. Connection-binding
  (`server.ts:68-75`, `releaseConnectionLeases` at `server.ts:97-106`) is correct and covered.
- **Bounds are coherent.** 4 MiB replay/session × 6 worst-case JSON expansion < the 32 MiB frame ceiling
  (`protocol.ts:7-9`), and `responseFrame` (`server.ts:175-181`) enforces it. Socket hardening verified live:
  parent `0700`, socket `srw-------`.
- **Single-call spawn discipline is real.** `#connecting ??=` (`supervisor.ts:122`) coalesces concurrent
  callers; the `spawnCount` assertions in the functional tests are honest, and E4/E5 confirm concurrent hosts
  converge to exactly one survivor.
- **CI placement is right and fails closed.** The new step sits in the `build-and-test` matrix (ubuntu, node
  20 and 22) after `npm test`, i.e. on the required gate, and C6 shows a non-matching glob exits 1 rather than
  passing silently.
- **Production-integration claims are honest, not overclaimed.** `grep` across the repo finds **no** production
  caller of `NativeTerminalHostSupervisor`/`NativeTerminalClient` outside the module, its `index.ts` export and
  the tests. BRANCH.md BR178-EX2, spec HOST-02 LIMIT and MIG-01 all state wiring is a later opt-in lot. Nothing
  in the branch claims a production path it does not have. This part of the lens passes cleanly.

## Findings (severity-ranked)

### F1 — HIGH — A PTY that ignores SIGTERM becomes permanently unkillable, and the escalating `stop` silently reports success

`packages/h2a-runtime/src/native-terminal/host.ts:223-226`

```ts
stop(id: string, signal = "SIGTERM"): NativeTerminalSessionState {
  const record = this.#requireSession(id);
  if (record.status !== "running") return this.#snapshot(record);
```

After the first `stop`, `status` is `"stopping"`, so **every subsequent `stop` returns early without sending
any signal** — including a deliberate `SIGKILL`. It returns `ok: true` and echoes `stopSignal: "SIGTERM"`.
No protocol operation exposes escalation: `NativeTerminalOperation` (`protocol.ts:11-22`) has no force/kill,
and `forceStopAll` (`host.ts:247`) is reachable only from host shutdown (`process.ts:99`). Meanwhile
`host.ts:229` has already fenced the controller and `host.ts:274-279` refuses re-acquisition for a non-running
session, while `host.ts:105-107` keeps the id reserved.

Failure scenario (measured, E11 — a shell with `trap '' TERM HUP INT`, exactly the shape the PR's own
functional test uses at `process.functional.test.ts:176`):

```json
{"pid":582529,"firstStop":"stopping","aliveAfterTerm":true,
 "secondStopKill":"stopping/SIGTERM","aliveAfterKillRequest":true,
 "reacquireControl":"denied: terminal session is not running: stubborn",
 "writeWithOldLease":"denied: stale terminal controller lease",
 "recreateSameId":"denied: terminal session already exists: stubborn",
 "finalState":{"status":"stopping","exit":null,"stopSignal":"SIGTERM"}}
```

The terminal is left alive, unwritable, unkillable and un-recreatable for the entire life of the host, and the
caller is told the kill succeeded. This is a failure that is indistinguishable from a success at the protocol
surface. The graceful-shutdown TERM→KILL drain proven by `process.functional.test.ts:143-200` covers only the
whole-host path and makes this per-session gap easy to read as covered.

Remediation shape: let `stop` re-signal (or add an explicit `force`) when `status === "stopping"`, and/or
return a distinguishable outcome instead of a success snapshot.

### F2 — HIGH — Any connection can `stop` a session another connection controls; CTRL-01's "observers are read-only" is false

`packages/h2a-runtime/src/native-terminal/server.ts:164-171`

```ts
case "stop": {
  const record = requiredRecord(params, "params");
  const id = requiredString(record.id, "session id");
  ...
  return host.stop(id, record.signal as string | undefined);
}
```

`write` and `resize` go through `ownedLease` (`server.ts:148-163`); `stop` does not, and neither does the host
method. Any connected client may terminate any session with an arbitrary signal.

Failure scenario (measured, E10):

```json
{"observerWrite":"denied: controller lease is not owned by this connection",
 "observerAcquire":"denied: terminal session already has a controller: victim",
 "observerStop":"ALLOWED -> stopping/SIGKILL",
 "victimStateAfterObserverStop":"exited",
 "controllerWriteAfterObserverStop":"denied: stale terminal controller lease"}
```

The spec decision CTRL-01 states "One controller lease may write or resize; **observers are read-only**." An
observer issuing SIGKILL is not read-only. Note the internal inconsistency the tests inherit: acceptance
criterion ACCEPT-03 is narrowly worded ("cannot write or resize"), so the suite is green while the decision
clause is contradicted. The second-order effect matters too — the fenced controller sees "stale terminal
controller lease" and cannot distinguish "a peer killed my terminal" from "my lease rotated".

Remediation shape: gate `stop` on the owned lease (with an explicit unarbitrated/force variant if the control
plane needs one), **or** amend CTRL-01 to state that stop is deliberately unarbitrated among same-UID peers.

### F3 — MEDIUM — No session reaping in a persistent host: exited sessions are retained forever and ids can never be recycled

`packages/h2a-runtime/src/native-terminal/host.ts:80` (`#sessions`, never deleted),
`host.ts:105-107` (duplicate id rejected regardless of status), `protocol.ts:11-22` (no remove/forget op).

Failure scenario (measured, on the live E1/E2 host after its PTY exited cleanly):

```json
{"listAfterExit":[{"id":"prod","status":"exited","exit":{"exitCode":0,"signal":15}}],
 "recreateSameId":"REJECTED: terminal session already exists: prod"}
```

For a host whose whole purpose is to be long-lived this is unbounded: one `TerminalReplayBuffer` per session
is retained after exit (up to `NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION` = 4 MiB each, `protocol.ts:7`),
`list()` grows toward the 32 MiB frame ceiling until `responseFrame` starts throwing (`server.ts:175-181`),
and an agent can never be restarted under its own session id. LIFE-01 lists no removal operation and none of
the spec's "Deferred migration gates" covers session reaping or id recycling, so this is an undeclared gap
rather than an accepted one — and it directly blocks the later wiring lot, where session ids map to agent
identities.

### F4 — MEDIUM — The supervisor's liveness check has no timeout, so a wedged host blocks every caller forever

`packages/h2a-runtime/src/native-terminal/supervisor.ts:113-121`

```ts
if (this.#client) {
  try {
    await this.#client.ping();   // no deadline
```

The connect path deliberately races a 1 s timeout (`supervisor.ts:48-57`), so the need for a deadline was
recognised — but the reuse path, which is the one that must *detect* a dead host, has none. Underneath,
`NativeTerminalClient.#request` (`client.ts:110-128`) has no per-request deadline either, so `create`,
`write`, `readOutput` and `stop` all inherit an unbounded wait.

Failure scenario (measured, E8 — host keeps the connection open and stops answering, e.g. a blocked event
loop or a half-open connection that TCP-less unix sockets never surface):

```json
{"result":"STILL HANGING","waitedMs":8007}
```

There is no recovery: the supervisor never falls through to reconnect-or-restart.

### F5 — MEDIUM — Concurrent start on a stale socket can leave two live hosts, and `server.close()` then deletes the survivor's socket

`packages/h2a-runtime/src/native-terminal/server.ts:253-264` — `lstat` → `socketAcceptsConnections` →
`unlink` → `listen` is not atomic. The window spans a whole connect round trip (`server.ts:242-251`). The
precondition is routinely produced: E3 confirms a host `kill -9` **leaves the socket file behind**.

If host A binds between B's accept-probe and B's `unlink`, B removes A's live socket and binds its own. E6
measures the consequence with the real product code (path replaced, then A shut down):

```json
{"inoA":46602077,"inoB":46602114,"inodeRecycled":false,
 "bBoundWhileAStillListening":true,"generationReachableByPath":"B",
 "socketStillPresentAfterAClose":false}
```

The dev/ino guard at `server.ts:314` + `server.ts:334-337` does **not** prevent this, and not because of inode
recycling — E7 isolates the actor with plain `node:net` and no product code: `net.Server.close()` unlinks the
bound path **by name**, unconditionally, inside libuv (`inodeAfterAClose: null`). The explicit guard therefore
runs *after* the deletion it is meant to prevent; it only covers the narrow window between libuv's unlink and
its own `lstat`.

Net effect: a host orphaned by the race is invisible (unreachable by path) while still owning live PTYs, and
the ordinary operator response — SIGTERM the stray host — silently removes the *live* host's socket, pushing
the next client into spawning yet another host.

**Honest limit on this finding:** I could not reproduce the timing. E4 (10-way) and E5 (**0/40**
barrier-synchronised 6-way races on a stale socket) never produced a double bind; the window is a single
event-loop turn. The *consequence* is proven; the *reachability* rests on reading the non-atomic sequence. The
spec's deferred gate "clean orphan handling beyond connect-or-start recovery" partially acknowledges the
orphan class, but the unconditional path unlink in `close()` is a defect in shipped code, not a deferred
feature. Bind-to-temp + `rename(2)`, or an `O_EXCL` lock file, closes both halves.

### F6 — MEDIUM-LOW — No backoff across `client()` calls on a persistent start failure, and production discards the host's diagnostic

`packages/h2a-runtime/src/native-terminal/supervisor.ts:134-158` spawns at most once per `#connectOrStart` —
correct in isolation — but nothing rate-limits across calls, and there is no circuit breaker.

Failure scenario (measured, E9 — socket parent at `0755`, which `server.ts:271-273` correctly refuses):

```json
[{"attempt":0,"ms":163,"pid":580200,"err":"native terminal host exited before accepting connections (1)"},
 {"attempt":1,"ms":181,"pid":580225,"err":"…"}, {"attempt":2,"ms":156,"pid":580236,"err":"…"},
 {"attempt":3,"ms":180,"pid":580247,"err":"…"}, {"attempt":4,"ms":156,"pid":580258,"err":"…"}]
```

A caller that retries produces ~6 Node process creations per second indefinitely. Compounding it,
`defaultSpawnHost` uses `stdio: "ignore"` (`supervisor.ts:33`), so the host's fatal stderr — here the precise
cause, "terminal host socket parent must not be accessible by group or others" — is discarded, and the only
signal the operator ever sees is `exited before accepting connections (1)`. The `h2a.native-terminal.ready`
line the host writes to stdout (`process.ts:80-86`) is likewise discarded in production; readiness is
polled instead, so that line is observable nowhere.

No production caller exists today, so no storm exists today; this is a hazard the wiring lot inherits, and it
is the same shape as the repo's #131 status-bar spawn thrash.

### F7 — LOW — The diff adds a required member to a shared type and leaves two existing implementations broken, invisible to the gate

`packages/h2a-runtime/src/pty.ts:7` adds `readonly pid: number;` to `PtyHandle`. Two pre-existing
implementations were not updated:

- `packages/h2a-runtime/src/run.test.ts:19`
- `packages/h2a-runtime/src/run-ws-surface.test.ts:40`

Ad-hoc typecheck (E12) reports on both: `error TS2322: … Property 'pid' is missing in type '{ cols: number;
rows: number; … }' but required in type 'PtyHandle'`.

Nothing catches it: `packages/h2a-runtime/tsconfig.json` sets `"exclude": ["**/*.test.ts"]` and vitest does not
typecheck, so root `npm run typecheck` exits 0 (C4) and both suites pass (C5). The same hole means the PR's
three new test files are themselves never typechecked. No runtime impact today — nothing reads `.pid` from
those stubs — which is exactly why it will stay broken silently.

## Reasoning on the remaining lens questions

**Adequacy of REAL local execution tests.** The functional suite is genuine, not mocked: three tests run real
`node-pty` shells in a separately spawned Node host on Linux and assert PTY pids, `/proc` parentage, that no
child is a `node` binary, replay round trips, one-spawn discipline, host-crash PTY reaping, TERM→KILL drain
with a signal-trapping shell, socket removal, a distinct next generation, and two-supervisor convergence. That
is well above the usual bar. Two adequacy gaps are worth recording: (a) the production `defaultSpawnHost`
shape (`detached: true`, `stdio: "ignore"`, `./process.js` in the emitted layout) is covered by **no** test —
I verified it works in E1/E2, but the branch does not; and (b) the suite's own vocabulary points away from the
gaps — `host.test.ts`'s "should stop one session idempotently" reads as coverage of repeated stop, when what
F1 shows is that the repeat is silently swallowed even with a stronger signal.

**Controller generation/lease fencing.** Sound. Generation is stamped into every lease and re-checked on every
privileged call (`host.ts:282-294`); the epoch is bumped on acquire, release, stop and exit; leases are also
bound to the owning connection and released on disconnect. The one hole is not in the fencing but in what it
guards: `stop` sits outside it entirely (F2).

**Bounded shutdown/crash.** Host shutdown is genuinely bounded (500 ms graceful + 500 ms forced,
`process.ts:15-16, 88-121`), exits 0, and its PTYs die — proven both by the branch's own test and by E3 for
the abrupt case. `process.once` for the signals means a second SIGTERM takes the default disposition mid-drain,
which is safe here precisely because pty hangup reaps the children. Per-session shutdown is *not* bounded
(F1).

**Absence of repeated Node spawn.** Within a call, yes — coalesced and single-spawn, verified. Across calls,
no bound (F6).

**Production-integration claims.** Match the implementation. No overclaim found.

## Verdict

**NO-GO.**

Two actionable defects are unresolved in shipped code and are not covered by any declared limit or deferred
gate in `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md`:

- **F1** — a stop that cannot escalate and reports success while sending nothing. A terminal is left alive,
  unwritable, unkillable and un-recreatable, and the caller is told it was killed.
- **F2** — `stop` is ungated, falsifying CTRL-01's "observers are read-only" as written.

F3 (no session reaping / no id recycling) is an undeclared gap that blocks the later wiring lot and should be
resolved or explicitly deferred in the spec before merge. F4, F5, F6 and F7 are actionable but would not on
their own hold the gate.

The foundation itself is sound and genuinely native — process ownership, cross-process adoption, generation
and epoch fencing, socket hardening, replay bounds and host-level crash/shutdown semantics all verified
independently on this machine. The blockers are narrow and local; F1 and F2 are each a small change in
`host.ts`/`server.ts` plus a test.
