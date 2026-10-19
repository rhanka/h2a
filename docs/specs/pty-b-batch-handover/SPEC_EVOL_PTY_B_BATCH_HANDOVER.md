# SPEC EVOL — PTY option B, then batched handover (h2a)

Status: build specification, not code. Written 2026-10-18.
Base for all file paths: `origin/main` of `/home/antoinefa/src/h2a`
(`7670fbed6` at writing time). No version number is assigned by this
specification; version attribution is a conductor/owner decision.

## 0. Goal — the owner's outcome

**CLI sessions survive an h2a upgrade and a PTY-host restart. Terminals
migrate in batches from the old PTY owner to the new one. The same CLI
process keeps running throughout — never a relaunched conversation.**

Concretely, in order:

1. Phase B: upgrading h2a replaces the frontend and leaves the PTY owner
   (and therefore every live CLI) untouched.
2. Phase L: when the PTY owner itself must restart (its own fix, a Node
   update), its terminals move to the new owner in batches, without losing,
   duplicating, or reordering input/output, and without killing the CLIs.
   A failed batch affects only that batch.
3. Optional lot O1 (separate owner decision required): two PTY owners
   standing at the same time. Phase L already runs two owners transiently
   during a handover; a standing pair is **not** part of the validated goal.

Owner requests, verbatim, that ground this specification:

- `B (Recommandé)` — choice in the PTY continuity decision dossier
  (2026-10-17 ~17:55, `DECISIONS-owner.md`).
- `Faudrait pouvoir aussi faire un redem a chaud (y cpmpris le process pty
  qu il puisse passer par lot les terminaux) voire prevoir d en avoir 2 -
  possible ?` (2026-10-17).
- `Vas y pour un essai sous linux. Sur mac ca marcherait comment ?`
  (answered by spike2: Linux and macOS ARM64 CI green, §2 below).
- `Vas-y B puis lots` (2026-10-18) — B first, then batches. This ordering
  is binding for the lots in §5.

Anything the owner did not ask for or validate is marked
**proposition, not validated** wherever it appears.

## 1. Inputs read for this specification

| Input | What was taken from it |
|---|---|
| Decision dossier v2 (`dossier-pty/v2/dossier-pty-v2.md` + HTML) | Option B definition: stable PTY owner, replaceable frontend, listening socket preserved; B moves no PTY; no retroactive migration of already-running sessions; MCP-HANDOVER ≠ PTY-HANDOVER. |
| Spike2 report + details (`dossier-pty/spike2/report.md`, `details.md`, CI `39073867783`, code `33a4f5470`) | Batched handover proven on Linux and macOS ARM64; batch estimates B 48–82 agent-hours, B+batches supplement 54–94, total 102–176, 8–13 review rounds; explicit non-covered list. |
| Spike branch `spike/pty-batch-handover` (read via `git show`, never merged) | `DESIGN.md`, `handover.test.mjs`, `owner.mjs`, `native.c`: guardian = real CLI parent, `SCM_RIGHTS` transfer of master + status channel, freeze→offer→prepare→commit, queued inputs, isolated failed batch. |
| First bench branch `spike/pty-owner-reexec` (read via `git show`) | B mechanism: keeper holds the listener, frontends receive a copy, same-inode rename, backlog survives frontend `SIGKILL`; a fresh listener per frontend fails the availability test (red control). |
| Current code on `origin/main`: `packages/h2a-runtime/src/native-terminal/` + `src/pty.ts` | Starting architecture (§3) and the exact file inventory used for per-lot allow-lists. |
| `DECISIONS-owner.md` (authoritative) | H2: one PTY process, progressive withdrawal of `lf1` by draining; `h2a upgrade` never restarts the native host (0.98.7 line); Node ≥ 22 only (2026-10-12); platforms Linux, then macOS, then Windows (not urgent); estimates in agent-hours and review rounds. |

Spike evidence that this specification relies on (no more, no less):

- 13 sessions (12 Node programs + interactive Bash/readline), batches
  4/4/5, same PIDs/births after the emptied owner 1 exits by itself.
- 840 numbered inputs (Linux) / 864 (macOS), exact sequences, no loss,
  duplicate, or reorder; resize `37 109` confirmed via `SIGWINCH` and
  `stty size`; exact exit codes/signals (0/7/23/143, Bash 19, SIGTERM 15).
- A rejected batch and an injected `EBADF` resume only that batch;
  unrelated sessions in both owners keep producing (+16/+19 ticks).
- The guardian stays the real parent of the CLI and reaps it; the new
  owner's `waitpid(CLI)` returns `ECHILD` on both OSes. No parent transfer.
- macOS parent death is observed with `kqueue/EVFILT_PROC/NOTE_EXIT`;
  the guardian detects loss of the **last** owner by EOF on its STREAM
  status channel. No `prctl`/`PDEATHSIG`/subreaper in the normal path.
- Batch latency on the small bench: 1.4–2.9 ms request→commit without
  injected pause (`sendmsg` alone 0.009–0.027 ms). These are bench
  samples, **not** a product latency guarantee (spike2 states this).

## 2. Starting point on `origin/main` (facts, read in code)

One fused PTY host process per socket generation:

- `native-terminal/process.ts` — host process entry (`[h2a-pty-host]`
  log prefix). Builds one `NativeTerminalHost` plus one socket server in
  the **same** process. On `SIGINT`/`SIGTERM`/`SIGHUP` it stops **all**
  sessions (`stopAll`, then `forceStopAll` after 500 ms). Today, host
  restart = every CLI dies. This is the behaviour this EVOL removes.
- `native-terminal/host.ts` — `NativeTerminalHost`: session map, replay
  buffers, controller leases, process-group reaper, durable pgid rows in
  `../registry.js` (single-store coupling, documented in-file; do not
  remove it).
- `native-terminal/server.ts` — Unix-socket server: staged publication,
  same-inode rename, publication lock, owner record, endpoint-absence
  proof (`proveNativeTerminalEndpointAbsent`), request dispatch.
- `native-terminal/protocol.ts` — wire protocol **version 1**; operations
  `ping/create/list/state/read-output/attach-observer/acquire-controller/
  acquire-controller-if-no-recent-human/release-controller/write/resize/
  stop/stop-if-incarnation`; max 256 sessions; replay 4 MiB/session.
- `native-terminal/client.ts` — `NativeTerminalClient` (request/response
  over the Unix socket, per-request timeout).
- `native-terminal/supervisor.ts` — spawns/adopts the host process,
  health-checks it, reconciles dead-host orphans, fail-closed containment
  (`NativeTerminalContainmentError`).
- `native-terminal/socket-path.ts` — `XDG_RUNTIME_DIR/h2a-nt/
  native-terminal.sock` plus the compatible `native-terminal.lf1.sock`;
  `knownNativeTerminalSocketPaths()` inventories both generations (the
  `lf1` drain of H2 is already shaped here).
- `src/pty.ts` — `nodePtySpawner` over `node-pty`. On Linux every CLI is
  wrapped by `setpriv --pdeathsig SIGUSR2` + a bash guardian script: host
  death kills the CLI group (containment). Inherited FDs ≥ 3 are scrubbed
  before exec (E1 fix line). On non-Linux the command is spawned directly.
  **`PtyHandle` exposes no master FD** (`pid/pgid/cols/rows/write/resize/
  kill/onData/onExit` only) — a `node-pty` master cannot be transferred
  by `SCM_RIGHTS` through this interface. Phase L therefore needs a new
  spawner backend (§5, lot L2); this is a fact of the current interface,
  not a preference.
- No `h2a upgrade` command implementation exists on `origin/main` under
  `packages/h2a-runtime/src/` (checked by grep; `upgrade.functional.test.ts`
  is a dist-vs-dist qualification test, control-plane "upgrade" is the
  WebSocket upgrade). Lot B4 is written against that fact.

Existing targeted tests that already pin surrounding behaviour and must
stay green whenever a lot touches their file's neighbour (named per lot):
`host.test.ts`, `server.test.ts`, `client.test.ts`, `supervisor.test.ts`,
`process.functional.test.ts`, `crash-safety.functional.test.ts`,
`listener-failure.functional.test.ts`, `respawn.test.ts`,
`publication-proof.test.ts`, `publication-refusal.test.ts`,
`upgrade.functional.test.ts`, `replay-buffer.test.ts`.

## 3. Decisions

Source column: **Owner** = verbatim/decision file; **Dossier** = decision
dossier v2 content the owner approved by choosing B; **Spike** = proven on
a bench (Linux + macOS ARM64 for spike2; Linux for spike1 B-bench);
**Proposition, not validated** = this specification's proposal, needs a
build-time or owner confirmation as noted.

| # | Decision | Source |
|---|---|---|
| D1 | Order is binding: Phase B first, shippable on its own; Phase L (batches) second; lot O1 (two standing owners) last and optional. No lot of a later phase starts before the previous phase's gate is green. | Owner (`Vas-y B puis lots`) |
| D2 | Target steady state = **one** PTY owner. A second owner exists only transiently during a batched handover and the emptied old owner exits by itself. A standing pair contradicts H2 until the owner revises H2 — hence O1 is optional and separately gated. | Owner (H2) + Spike2 (auto-exit when empty) |
| D3 | Option B = stable owner + replaceable frontend. B moves **no** PTY. The client-facing listening socket is preserved across frontend replacement (same inode, backlog kept); a fresh listener per frontend is a known-failing design (spike1 red control) and is forbidden. | Dossier + Spike1 |
| D4 | During Phase B, no upgrade path (manual or automatic) ever signals, stops, or respawns the PTY owner. Owner replacement happens only by drain (owner empty) until Phase L provides batched handover. | Owner (0.98.7 line: `h2a upgrade` never restarts the native host) + Dossier |
| D5 | Sessions born before B (incl. `lf1` generations) and sessions born under B before Phase L are **never** live-migrated. They stay reachable on their owner until they end; the old endpoint/owner is withdrawn only when empty (draining). No retroactive transfer is promised anywhere. | Owner (H2 `lf1` draining) + Dossier (common limit) |
| D6 | Per-session guardian = the real parent of the CLI for its whole life. It reaps the CLI and reports the exact wait status on a transferable `SOCK_STREAM` channel, retained until the receiving owner ACKs. The receiving owner never `waitpid`s the CLI (`ECHILD` is the expected, asserted outcome on Linux and macOS). No parent transfer, no adoption. | Spike2 (proven both OSes) |
| D7 | No dependency on `PR_SET_PDEATHSIG` or `PR_SET_CHILD_SUBREAPER` in the transfer/containment path of new (guardian-v2) sessions. Containment trigger = EOF of the guardian status channel when the **last** owner copy is gone, plus terminal HUP. The Linux test-only subreaper of the spike (container PID 1 compensation) is test scaffolding, never product behaviour. | Spike2 |
| D8 | Batch is the atomicity unit. Per batch: freeze reads/writes → offer (`SCM_RIGHTS`, master + status channel = 2 FDs/session) → prepare on receiver (staged, **no reads** from staged FDs) → commit (receiver publishes route, sender closes its copies). Inputs arriving during the move are queued per session and delivered in order after commit or after rollback drain; the route stays "moving" until the rollback queue is fully drained (spike2 reorder fix `33a4f5470` is normative here). Output stays in the PTY kernel buffer during the pause. | Spike2 |
| D9 | A failed batch (receiver reject, `sendmsg` error incl. `EBADF`, prepare timeout — all **before** commit) rolls back only its own sessions to the sender, in original input order, with no loss/duplicate/reorder. Sessions outside the batch, in either owner, are never frozen, stopped, or re-routed by another batch's failure. | Spike2 |
| D10 | Exactly-once input/output is claimed **only** for cooperative paths (no process crash at/after the commit point). Crash-at-commit behaviour is specified in §7 as "exactly one owner or confined, never two readers", is fault-tested in L5, and no stronger claim is made. See §8, NOT covered. | Spike2 limit, carried into product spec |
| D11 | Linux and macOS implement the same contract with the OS differences of §6 and the same test files where the spike did so. Windows/ConPTY is excluded: its handles are not Unix PTY masters transferable by `SCM_RIGHTS`; it would need a distinct backend, which is out of scope. | Owner (platform order) + Spike2 |
| D12 | Node ≥ 22 only (CI 22 + 24). No Node 20 support argument is used anywhere in design or tests. | Owner (2026-10-12) |
| D13 | Zero Python anywhere (code, tests, build, CI). Native code, where Phase L needs it, is C + N-API built with the Node toolchain of the repo; TypeScript/Node elsewhere. No new container image. | Owner rule |
| D14 | MCP-HANDOVER is a separate workstream with its own spec. This EVOL covers PTY only. The single `h2a upgrade` command (H4) may *sequence* both, but a PTY lot must not block on, reimplement, or silently absorb MCP handover behaviour; each reports its own per-component result (installed / loaded / switched / deferred), and a partial upgrade is always visible as partial. | Dossier §2/§6 + Owner H4 |
| D15 | FD hygiene is contract, not cleanup: every PTY master, status channel, and transfer socket is `CLOEXEC`; guardians/children close all inherited FDs ≥ 3 before `exec` (preserving the E1 fix); a session must never hold another session's master. Verified by test, per lot that spawns. | Owner (E1) + current `pty.ts` + Spike2 |
| D16 | All wire protocols touched by this EVOL are versioned and negotiated, never assumed: client↔frontend (existing v1), frontend↔owner (new, B1), owner↔owner batch transfer (new, L3), guardian↔owner status channel (new, L1). An unknown or mismatched version fails closed with a typed error; it never falls back to guessing. Compat window size (N↔N+1 only, or wider) is **proposition, not validated** — B1 proposes N↔N+1 and pins it by test; widening needs an owner/conductor call. | Proposition, not validated (mechanism); fail-closed style follows current code |
| D17 | Product topology for B — two processes (owner process holding `NativeTerminalHost` + spawner; frontend process holding the public listener + client protocol, forwarding to the owner over a private socket), owner-side keeper holds the listening FD and each frontend receives a copy at spawn: **proposition, not validated**. It is the direct product reading of the spike1 bench, but the owner validated the B *outcome*, not this mechanism. B1/B2 must keep the boundary reversible until B2's gate is green. | Proposition, not validated |
| D18 | Spike branches (`spike/pty-batch-handover`, `spike/pty-owner-reexec`) are evidence only. They are never merged, never cherry-picked. Product code is written fresh under `packages/h2a-runtime/` conventions; spike test *scenarios* are re-expressed as product RED tests (§5). | Spike reports ("never merged") + repo hygiene |
| D19 | Batch-size bound, per-session queue bound during a move, and any pause-duration budget are **proposition, not validated**. Spike2 proved batches ≤ 5 and queues on a 13-session bench; L3 must pick explicit bounds, fail closed beyond them (reject the batch, never truncate input), and L5 must measure them. No numeric bound in this spec is an owner commitment. | Proposition, not validated |
| D20 | Estimates are carried, not re-derived: B 48–82 agent-hours (4–6 review rounds), L supplement 54–94 (4–7 more rounds), total 102–176 (8–13 rounds), spike time excluded. They are ±-ranges from spike2, to be recalibrated after B1, not a schedule. | Spike2 (owner metric: agent-hours + rounds) |

Explicitly **rejected** by the inputs and therefore forbidden in every lot:
option C (in-place re-exec of the owner — lost-exit race reproduced on
spike1, not chosen); option A (standing multi-generation relay — dismissed
in the dossier, contradicts H2); copying a PTY master to a new process
without solving guardian parentage (dossier §2: insufficient, kills the
CLI group on parent death).

## 4. Architecture after each phase (target reading of D3/D17)

Phase B end state (proposition, not validated, per D17):

```
client ──unix──> frontend process ──private unix──> owner process ──> guardian ──> CLI
NativeTerminal    (public listener,   (versioned)     NativeTerminal   (bash      (same
Client             protocol v1)                        Host + spawner    guardian,  process)
                     ▲ replaceable    listening FD held owner-side,      pdeathsig
                     │ at upgrade     copied to each frontend (D3)       on Linux)
owner process: never signalled by upgrade (D4); exits only when empty + asked.
```

Phase L adds, for sessions born under the new backend only:

```
owner 1 ──batch: SCM_RIGHTS (master + status ch.)──> owner 2
   │            freeze → offer → prepare → commit        │
   └── guardian (unchanged, real parent of CLI) ─────────┘ status until ACK
frontend route table: session → owner 1 | moving(queue) | owner 2
old owner exits by itself when empty (D2). Standing pair = O1 only.
```

Placement of the batch coordinator / route table (frontend vs a dedicated
coordinator vs receiving owner as in spike2's bench) is **proposition, not
validated**; L4 must choose one, state it in the lot's report, and pin the
choice with the coordinator-death test of L4. The contract (D8/D9) does
not depend on the placement.

## 5. Lots

Rules that apply to **every** lot (not repeated per lot):

- RED first: the lot's named tests are written and run **before** the
  implementation, on the lot's base; the red output (failing for the
  stated reason, `skipped: 0`) is kept as evidence. A test that skips
  because real state is absent counts as FAILED, never as pass.
- Targeted tests only: `npx vitest run <file>` or `node --test <file>`
  for the files named in the lot. The full repo suite is run once by the
  conductor at integration, never by a lot.
- Tests use temporary dirs only (`mkdtemp`; `HOME`/`XDG_RUNTIME_DIR`/
  `TMPDIR` pointed at temp dirs the test creates), following the existing
  `native-isolation` helper pattern. Never the installed `h2a` binary,
  the installed dist, `~/.config/sentropic/h2a`, `~/.local/state/h2a`,
  `/run/user/*/h2a-nt`, or any process the test did not spawn. Stop only
  spawned PIDs; no `pkill -f`, no `killall`.
- File scope: a lot may create/modify **only** its allow-list. Anything
  else appearing in `git diff --stat` fails the gate, however small.
- Commits: conventional English subject, no attribution trailer of any
  kind; branch per lot (or per phase, conductor's call — proposition,
  not validated), fast-forward push of that branch only, never force,
  never touch `main`.
- Green claim = command + output, quoted in the lot report, including
  `pass/fail/skipped` counts and exit code. `skipped > 0` on a gate test
  = gate failed.
- Type/static gate: the touched package must build with zero new type
  errors (`npm run build` in `packages/h2a-runtime`, i.e. `tsc -b`),
  checked on the lot branch; "pre-existing" is claimable only if the same
  command reports the identical error on the untouched base.
- Transient `bwrap: No permissions to create a new namespace`: retry the
  same command a few times with a short pause before concluding anything.

Test-name convention below: `it('should …')` inside the named file.
New test files are created by the lot that names them.

### Phase B — stable owner, replaceable frontend (D1: first, shippable alone)

#### Lot B1 — Owner/frontend boundary and versioned internal protocol

Purpose: carve the seam inside today's fused process without changing
externally visible behaviour. No new process yet.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/owner-protocol.test.ts`):

- `it('should reject an owner-protocol frame with an unknown version')`
- `it('should reject a truncated owner-protocol frame without dispatching')`
- `it('should round-trip every v1 client operation through the owner boundary unchanged')`
  (all 13 operations of `protocol.ts`, table-driven)
- `it('should keep controller-lease identity across the owner boundary')`
- `it('should fail closed when the owner side is absent, with a typed error')`

Allowed files:

- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts` (new)
- `packages/h2a-runtime/src/native-terminal/owner-protocol.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/server.ts`
- `packages/h2a-runtime/src/native-terminal/protocol.ts`

Forbidden: `process.ts`, `supervisor.ts`, `client.ts`, `pty.ts`,
`socket-path.ts`, `registry.ts`, any wire-format change to client
protocol v1, any new process/entry point, any dependency change.

Gate: `npx vitest run packages/h2a-runtime/src/native-terminal/owner-protocol.test.ts`
red-before (module absent) / green-after; plus
`host.test.ts`, `server.test.ts` green; `tsc -b` clean.

#### Lot B2 — Owner process extraction, preserved listener, lifecycle

Purpose: split `process.ts` into an owner process and a frontend process
(D17); the public listener survives frontend death/restart (D3); the
supervisor restarts/replaces only the frontend and never signals the
owner (D4). Existing publication proofs (staged rename, lock, owner
record, endpoint-absence proof, coded refusals) are preserved, not
weakened.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/owner-frontend.functional.test.ts`, real processes + real PTYs):

- `it('should keep every CLI alive across a frontend SIGKILL and replacement')`
  (same CLI PID/birth before/after; positive liveness = new input answered after, not `kill(pid,0)`)
- `it('should accept a client connection queued during frontend replacement')`
  (backlog/inode preserved; the spike1 direct-listener variant is the red control and must fail this test)
- `it('should refuse to start a second owner for the same socket')`
- `it('should exit the owner only when empty and explicitly stopped')`
- `it('should report owner and frontend loaded versions separately')`
- `it('should keep sessions confined when the owner itself is killed')`
  (current containment semantics unchanged: CLI groups die with the owner, no orphans)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/process.ts`
- `packages/h2a-runtime/src/native-terminal/owner-process.ts` (new, proposition name — keep parallel to `process.ts`)
- `packages/h2a-runtime/src/native-terminal/frontend-process.ts` (new, proposition name)
- `packages/h2a-runtime/src/native-terminal/server.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/socket-path.ts`
- `packages/h2a-runtime/src/native-terminal/owner-frontend.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/supervisor.test.ts`
- `packages/h2a-runtime/src/native-terminal/process.functional.test.ts`
- `packages/h2a-runtime/src/native-terminal/listener-failure.functional.test.ts`

Forbidden: `host.ts` session semantics, `pty.ts`, `client.ts` public API,
`registry.ts`, weakening any publication/refusal/containment check,
changing client protocol v1, session migration of any kind (that is
Phase L).

Gate: targeted run of the new functional file (red-before on fused
`process.ts`: frontend kill = host kill, sessions die) / green-after;
plus `process.functional.test.ts`, `listener-failure.functional.test.ts`,
`publication-refusal.test.ts`, `publication-proof.test.ts`,
`supervisor.test.ts` green, `skipped: 0` everywhere.

#### Lot B3 — Session continuity across frontend replacement

Purpose: attach/replay/write/resize/leases/quotas behave across a
frontend swap exactly as within one frontend life — no duplicated input,
no replay gap beyond the existing `TerminalReplayGap` contract, no lease
stealing by the new frontend.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/frontend-swap.functional.test.ts`):

- `it('should replay identical scrollback before and after a frontend swap')`
- `it('should deliver input written during a frontend swap exactly once, in order')`
- `it('should apply a resize issued after a frontend swap (SIGWINCH + size readback)')`
- `it('should keep the existing controller lease exclusive across a frontend swap')`
- `it('should keep enforcing session and replay quotas across a frontend swap')`
- `it('should surface the exact exit status of a CLI that exits during a frontend swap')`

Allowed files:

- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/replay-buffer.ts`
- `packages/h2a-runtime/src/native-terminal/server.ts`
- `packages/h2a-runtime/src/native-terminal/client.ts` (reconnect/resume behaviour only; no API break)
- `packages/h2a-runtime/src/native-terminal/frontend-swap.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/host.test.ts`
- `packages/h2a-runtime/src/native-terminal/client.test.ts`
- `packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts`

Forbidden: `process.ts`/`owner-process.ts`/`frontend-process.ts`
lifecycle, `pty.ts`, `registry.ts`, replay-size or quota value changes
(any new value = proposition, not validated, needs its own decision).

Gate: targeted run of the new file red-before/green-after; plus the three
unit files above and `respawn.test.ts`, `crash-safety.functional.test.ts`
green.

#### Lot B4 — Upgrade integration (PTY side)

Purpose: manual and automatic upgrade take the same PTY path — replace
frontend, keep owner, report per-component state, allow returning to the
previous compatible frontend. Fact from §2: no `h2a upgrade` command
exists on `origin/main` yet; it belongs to the separate upgrade
workstream (D14). B4 therefore delivers the **PTY-side contract and
supervisor behaviour** the command will call, plus its tests. Wiring a
CLI command surface is **proposition, not validated** and out of B4
unless the command exists on the lot's base — the lot report must state
which case applied.

RED tests first (extend `packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`; new file `packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts`):

- `it('should never signal the PTY owner during a frontend upgrade')`
  (assert owner PID/birth unchanged and no stop journal entry for the owner)
- `it('should report installed, loaded, switched and deferred versions per component')`
- `it('should keep serving sessions on the previous frontend when the new frontend fails its handshake')`
  (frontend rollback; owner untouched)
- `it('should refuse a frontend whose owner-protocol version is outside the compat window')`
- `it('should leave a visible partial state when the frontend swap is interrupted')`
  (never a false full-success report)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/frontend-process.ts`
- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts`
- `packages/h2a-runtime/src/native-terminal/journal.ts`
- `packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`
- `packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/journal.test.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.test.ts`

Forbidden: inventing a new top-level CLI command/file for upgrade,
MCP-handover code of any kind, `host.ts`, `pty.ts`, `registry.ts`,
auto-update scheduling/policy (when to upgrade is not a PTY decision).

Gate: targeted runs red-before/green-after; `supervisor.test.ts`,
`journal.test.ts` green; dist-vs-dist scenario of
`upgrade.functional.test.ts` still green on its existing terms.

#### Lot B5 — Legacy drain (`lf1`) and real-agent qualification of Phase B

Purpose: pre-B generations (incl. `lf1`) stay reachable until their last
session ends, then their endpoint/owner is withdrawn; new sessions are
never created on a draining generation (D2/D5). Phase B is qualified
with real agents in isolated environments before anyone claims it.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts`):

- `it('should keep a legacy-generation session reachable until it exits by itself')`
- `it('should never create a new session on a draining generation')`
- `it('should withdraw the legacy endpoint only after its last session ends')`
- `it('should inventory both generations with their loaded versions')`
  (over `knownNativeTerminalSocketPaths()`, both socket names)
- `it('should preserve a real interactive shell session across a frontend upgrade')`
  (Bash/readline: command before, command after, `stty size` after resize)

Real-agent qualification (Claude/Codex/etc. in isolated HOME, simulated
models first per the 2026-10-12 test-matrix decision) is a named
qualification step of this lot, executed as targeted functional files
added under the same directory; the exact agent matrix is the existing
test-matrix workstream's, **proposition, not validated** here. No agent
is claimed supported without its green targeted file (owner rule:
nothing announced without proof).

Allowed files:

- `packages/h2a-runtime/src/native-terminal/socket-path.ts`
- `packages/h2a-runtime/src/native-terminal/op.ts`
- `packages/h2a-runtime/src/native-terminal/fleet.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/fleet.test.ts`
- `packages/h2a-runtime/src/native-terminal/op.test.ts`

Forbidden: force-killing a legacy generation that still holds sessions,
migrating a legacy session live (D5), removing the `lf1` socket name
from inventory before drain completes, `pty.ts`, `host.ts`.

Gate: targeted runs red-before/green-after; `fleet.test.ts`, `op.test.ts`
green; qualification files green with `skipped: 0`, on Linux **and**
macOS CI (§6). Phase B is done only when B5's gate is green.

### Phase L — batched handover between two owners (requires Phase B green)

#### Lot L1 — Portable session guardian v2 + status channel

Purpose: replace the Linux-only bash guardian + `setpriv --pdeathsig`
for **new** sessions with a small native guardian that is the CLI's real
parent on Linux and macOS, reaps it, and holds the exact status on a
`SOCK_STREAM` channel until ACK (D6/D7/D15). Old-guardian sessions are
untouched and drain (D5). No transfer yet.

RED tests first (new files `packages/h2a-runtime/src/native-terminal/guardian-channel.test.ts` and `guardian-v2.functional.test.ts`):

- `it('should report the exact exit code and signal through the status channel')` (codes 0/7/23/143, SIGTERM 15)
- `it('should retain the status until the owner ACKs, then release the guardian')`
- `it('should confine the CLI group on last-owner channel EOF')`
- `it('should not kill the CLI when a non-last owner copy closes')`
- `it('should start the CLI with no inherited FD at or above 3')` (D15; also asserts no other session's master is visible)
- `it('should keep the guardian as the CLI parent for the CLI whole life')` (ppid check; owner `waitpid` ⇒ `ECHILD` where applicable)
- Negative control, red by construction: `it('should kill the CLI under the legacy parent-death control')`
  (spike2 `SPIKE_LEGACY_PARENT_DEATH` equivalent — proves the test can see parent-death coupling; must be red with the coupling on, green-path with it off)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/native/guardian.c` (new)
- `packages/h2a-runtime/src/native-terminal/native/` build glue (new, Node-driven, no Python — D13; exact files named in the lot report)
- `packages/h2a-runtime/src/pty.ts` (new spawner path for guardian-v2 sessions only; legacy path byte-preserved)
- `packages/h2a-runtime/src/native-terminal/guardian-channel.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/guardian-v2.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/process.functional.test.ts` (regression only)

Forbidden: removing or altering the legacy bash-guardian path, `host.ts`
transfer logic (none yet), `SCM_RIGHTS` code (L2/L3), changing
containment for legacy sessions, `PR_SET_PDEATHSIG`/`setpriv` in the v2
path (negative control excepted, test-only).

Gate: targeted runs red-before (no v2 guardian) / green-after;
`process.functional.test.ts`, `crash-safety.functional.test.ts`,
`terminal-modes.functional.test.ts` green; same files green on macOS CI.

#### Lot L2 — Native PTY/FD backend, distribution, security

Purpose: a spawner backend that exposes the PTY master FD and can
send/receive FDs (`SCM_RIGHTS` over a private Unix `SOCK_DGRAM` pair),
with `node-pty` kept for legacy sessions. Includes build/distribution
for Linux + macOS (arch matrix, ABI, macOS signing needs) — the
distribution mechanism is **proposition, not validated** and must be
stated in the lot report before code (prebuilds vs build-at-install is
an owner-visible supply-chain choice; D13 forbids a Python build).

RED tests first (new file `packages/h2a-runtime/src/native-terminal/fd-backend.test.ts`, plus functional `fd-transfer.functional.test.ts`):

- `it('should expose a CLOEXEC master FD for a v2 session')`
- `it('should pass a master FD to a peer process and keep the terminal usable there')` (write/read/resize from the receiver)
- `it('should reject a transfer message with a mismatched FD count')`
- `it('should surface EBADF as a typed transfer error, not a crash')`
- `it('should refuse a transfer peer that is not the expected owner')` (peer credential/identity check — mechanism proposition, not validated)
- `it('should load the native backend or fail closed with a typed unavailable error')` (never a silent fall-back to a non-transferable session presented as transferable)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/native/` (addon sources + build glue, new)
- `packages/h2a-runtime/src/pty.ts` (backend selection behind the spawner interface)
- `packages/h2a-runtime/src/native-terminal/fd-backend.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/fd-transfer.functional.test.ts` (new)
- `packages/h2a-runtime/package.json` (files/scripts for the native artefact only; no new runtime dependency without naming it in the lot report)

Forbidden: `host.ts` batch logic (L3), removing `node-pty`, any Python
in build/CI, network fetch of prebuilt binaries at install time unless
the lot report proposes it and the conductor accepts it (supply-chain),
weakening D15.

Gate: targeted runs red-before/green-after on Linux and macOS CI;
`tsc -b` clean; package builds from a clean checkout in a temp prefix.

#### Lot L3 — Batch transaction (freeze → offer → prepare → commit/abort)

Purpose: the D8/D9 protocol between two owners, with bounded per-session
input queues while moving, single-reader exclusion (staged FDs are never
read before commit), and rollback that drains the queue to the sender
before the route reopens. Bounds per D19 (proposition, not validated):
the lot must pick and test explicit max-batch and max-queued-bytes
values; beyond them the batch is rejected whole, input is never
truncated.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/batch-handover.functional.test.ts`, re-expressing spike2's three scenarios as product tests):

- `it('should preserve live terminal I/O and guardian-reaped exits in owner 2 after batched moves')`
  (numbered inputs exact, no loss/duplicate/reorder; same PID/birth; guardian still parent; owner 2 `ECHILD`; resize after move; exits 0/7/23/143/signal)
- `it('should retain exact statuses for exits before, during and after a move')`
- `it('should confine a session on last-owner EOF while another session continues')`
- `it('should roll back only the rejected batch and keep unrelated sessions flowing in both owners')`
- `it('should roll back a batch whose sendmsg fails with EBADF')`
- `it('should deliver inputs queued during a rejected batch in original order after rollback')`
  (spike2 reorder regression; the injected drain delay variant must be part of the test, as in the spike)
- `it('should reject a batch larger than the configured bound without freezing any session')`
- `it('should never read a staged FD before commit')` (single-reader proof: output produced mid-stage is delivered once, by the post-commit owner)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/batch-transfer.ts` (new, proposition name)
- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts`
- `packages/h2a-runtime/src/native-terminal/native/` (transfer primitives only)
- `packages/h2a-runtime/src/native-terminal/batch-handover.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/host.test.ts`

Forbidden: frontend/client protocol changes, `supervisor.ts` admission
(L4), durable on-disk batch journal unless proposed in the lot report as
the crash-recovery mechanism (proposition, not validated — and if added,
its files must be allow-listed by amendment before code), any
exactly-once claim past D10.

Gate: targeted run red-before (no transfer: sessions die / stay put on
owner stop) / green-after, `skipped: 0`, on Linux and macOS CI; negative
controls of L1 still behave (parent-death control red, exit-channel-off
control red — spike2's two red proofs re-expressed).

#### Lot L4 — Independent owner startup, admission, routing, owner restart

Purpose: the product path the spike did **not** prove: owner 2 is
started on demand **after** sessions exist (spike2 started it first),
admission decides which sessions may move (guardian-v2 + fd-backend
only; legacy sessions stay and drain), the frontend routes per session
to the current owner, the emptied owner 1 exits by itself, and
`h2a upgrade` (PTY side, per B4 limits) can request a full owner
restart as a sequence of batches. Coordinator placement per §4
(proposition, not validated) is decided and pinned here.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/owner-restart.functional.test.ts`):

- `it('should move every transferable session to an owner started after the sessions')`
- `it('should keep legacy sessions on owner 1 and report the owner restart as deferred for them')` (visible partial state, D14-style; never force-migrated, never hidden)
- `it('should exit owner 1 by itself once empty, and not before')`
- `it('should route new sessions to owner 2 only after the switch point')`
- `it('should abort the in-flight batch and keep sessions on owner 1 if the coordinator dies before commit')`
- `it('should refuse a second concurrent owner-restart request')`
- `it('should report per-batch and per-session outcomes of an owner restart')`

Allowed files:

- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/owner-process.ts`
- `packages/h2a-runtime/src/native-terminal/frontend-process.ts`
- `packages/h2a-runtime/src/native-terminal/batch-transfer.ts`
- `packages/h2a-runtime/src/native-terminal/socket-path.ts`
- `packages/h2a-runtime/src/native-terminal/journal.ts`
- `packages/h2a-runtime/src/native-terminal/owner-restart.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/supervisor.test.ts`
- `packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts`

Forbidden: standing two-owner admission (that is O1), `client.ts` API
breaks, MCP code, auto-triggering an owner restart without an explicit
upgrade request (trigger policy is proposition, not validated).

Gate: targeted runs red-before/green-after on Linux and macOS CI;
B2/B4 files (`owner-frontend.functional.test.ts`,
`upgrade-pty-contract.test.ts`) still green.

#### Lot L5 — Faults, load, soak, N↔N+1, real-agent qualification of Phase L

Purpose: close, or explicitly bound, everything spike2 left open before
any product claim: crash windows, saturation, large writes, complex
terminal traffic, scale, duration, version skew, real CLIs.

RED/characterization tests first (new files `batch-faults.functional.test.ts`, `batch-load.functional.test.ts`):

- `it('should leave a session owned by exactly one owner or confined after a crash at each batch step')`
  (fault injection at freeze/offer/prepare/commit/sender-close; D10 wording is the assertion — no exactly-once past it)
- `it('should keep input order under saturated masters during a move')` (large writes, back-pressure; bound behaviour per D19)
- `it('should move sessions under UTF-8, ANSI and TUI redraw traffic without corruption')`
- `it('should complete an owner restart at the qualified session ceiling')`
  (ceiling = proposition, not validated; the lot measures and reports the largest green value, starting from today's 256-session cap as the value to test, not to assume)
- `it('should transfer between N and N+1 owner builds in both directions')`
- `it('should survive a soak run of repeated owner restarts without FD or process leaks')`
  (duration/repetitions = proposition, not validated; leak assertion = FD table + spawned-PID inventory back to baseline)
- `it('should preserve a real interactive agent session across an owner restart')`
  (per qualified agent, isolated HOME; same rule as B5: no green file, no claim)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/batch-faults.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/batch-load.functional.test.ts` (new)
- Fault-fix amendments only: `batch-transfer.ts`, `host.ts`,
  `native/`, `owner-protocol.ts` — each fix lands with its own
  red-before/green-after pair in the files above; no other file without
  a spec amendment.

Forbidden: raising D19 bounds, the session ceiling, or any guarantee
wording (D10) to make a red test pass; long soak on the owner's real
machine/state (temp dirs + CI only); full-suite runs (conductor's).

Gate: all named files green, `skipped: 0`, Linux + macOS CI; a written
limits table (measured ceiling, batch bound, queue bound, soak length)
in the lot report replaces every proposition number it measured.
Phase L is done only when L5's gate is green.

### Optional lot O1 — two standing PTY owners (explicitly optional)

**Not validated. Do not start without a new explicit owner decision**
revising H2 (D2). The owner's verbatim asks whether two owners are
possible (`voire prevoir d en avoir 2 - possible ?`); the validated
answer delivered by Phase L is "two owners transiently, during a
batched handover". A standing pair (both admitting new sessions,
indefinitely) is a different product: per-owner quotas, routing policy
for new sessions, two owner lifecycles to upgrade/drain, doubled
failure surface. None of that was asked to be built.

If the owner later decides O1, its RED-first sketch (proposition, not
validated, to be re-specified at decision time):

- `it('should admit new sessions on both owners under an explicit routing policy')`
- `it('should enforce quotas per owner and in total')`
- `it('should restart either owner by batches to the other without downtime')`
- `it('should report both owners loaded versions and session counts')`

Allowed files, bounds, and gate: to be specified by amendment after the
owner decision. Estimated cost: not estimated (spike2 did not estimate a
standing pair; inventing a number here would be unfounded).

## 6. Linux and macOS behaviour

Same contract, same product test files where spike2 used one file for
both OSes. Differences (spike2, proven; product lots must re-prove them):

| Concern | Linux | macOS |
|---|---|---|
| FD transfer | Unix `SOCK_DGRAM` + `sendmsg`/`recvmsg` + `SCM_RIGHTS` | Same mechanism (`SCM_RIGHTS` present); datagram peer close can yield `ECONNRESET` and must be handled as closure (spike2 fix `8104a9ba7`) |
| Parentage / reaping | Guardian = real parent, `waitpid` there; receiver gets `ECHILD` | Identical; no `prctl`, no `PDEATHSIG`, no subreaper exists to lean on |
| Orphaned guardian reaping | Product: guardian exits after status ACK or last-owner EOF; reaping of an orphaned guardian itself relies on init. The spike's subreaper was **test-only** (container PID 1). Product lots must not require a subreaper. | `launchd` reaps orphaned guardians |
| Owner-death observation | Node child `exit` event in the bench; product equivalent pinned in L4 | `kqueue` / `EVFILT_PROC` / `NOTE_EXIT`; informational only — confinement still comes from status-channel EOF (D7), never from the death notice alone |
| Native headers/APIs | `pty.h`, `close_range` (loop fall-back), `/proc` identity of self/spawned PIDs only | `util.h`, `libproc` identity, full FD close loop, `fcntl` for `CLOEXEC`/non-blocking (no socket type flags, no `MSG_CMSG_CLOEXEC`) |
| Socket path budget | 107 bytes (existing `socket-path.ts`) | 103 bytes (existing) |
| Qualified matrix | Linux + Node 22/24 (existing CI) | macOS ARM64 only (spike2 CI). Intel macOS and older macOS: **not qualified**, proposition, not validated — claim nothing there until a CI cell exists |
| Answer to "on Mac, how?" | — | Same design as Linux: guardian stays parent, masters move by `SCM_RIGHTS` in batches, death watched by `kqueue`, confinement by channel EOF. No macOS-specific fork of the protocol. |

Windows/ConPTY: excluded (D11).

## 7. Failure isolation and rollback

Phase B:

- Frontend crash/`SIGKILL`: queued client connections survive in the
  preserved listener backlog; a replacement frontend serves the same
  owner; sessions, leases, replay are owner-side and untouched (B2/B3
  tests). Rollback of a bad frontend = start the previous compatible
  frontend; the owner is never part of the rollback (B4 test).
- Owner crash: containment as today — its CLI groups are killed, no
  orphans, durable pgid rows let a later start reconcile/prove absence
  (existing `server.ts`/`supervisor.ts` proofs, preserved). Phase B does
  **not** make sessions survive owner death; only Phase L's *planned*
  restart moves them first. An owner crash with live sessions remains a
  collective loss for those sessions — stated, not hidden (dossier §3).

Phase L, per batch (D8/D9/D10):

| Failure point | Required outcome |
|---|---|
| Receiver rejects at prepare; `sendmsg` fails (`EBADF`, …); prepare timeout — all before commit | Batch rolls back to sender; queued inputs drain to the sender **in order** before the route reopens; other batches/owners unaffected; batch retryable. |
| CLI exits before/during/after move | Guardian holds the exact status until ACK by whichever owner currently holds the channel; delivered exactly once to the product (statuses-before/during/after test, L3). |
| Coordinator/frontend dies before commit | Batch aborts as above (L4 test); sessions stay with the sender. |
| Sender or receiver crashes **at/after** commit; machine crash | **Not exactly-once.** Required floor (L5 fault tests): each session ends owned by exactly one owner **or** confined by its guardian (last-owner EOF); never two readers on one master; the outcome is reported per session, never as silent success. Anything stronger needs a durable-journal design that is proposition, not validated (L3 amendment path). |
| Old owner asked to exit while non-empty (legacy/draining sessions remain) | Refused/deferred and reported as deferred with the blocking session count (L4 test); sessions are never force-migrated or killed to empty an owner. |
| Guardian crashes | Its CLI loses its parent: NOT covered beyond existing group containment on terminal HUP (spike2 limit). The guardian binary itself is only upgraded for **new** sessions; a running guardian stays as-is until its CLI ends (dossier common limit). |
| Descendants escaping the CLI process group | NOT covered (spike2 limit), same as today. |

Rollback of the EVOL itself: Phase B lots keep client protocol v1 and
the legacy spawn path intact, so abandoning B = keep running the fused
host build; abandoning L after B = B stands alone (owner replaced only
by drain, as in B). No lot removes the previous path before its
replacement's gate is green.

## 8. What is NOT covered

Carried from the inputs; nothing here may be claimed until a named lot
above turns it green — and several items stay uncovered even then:

- Exactly-once delivery across a crash at/after the batch commit point,
  disk-level recovery of an interrupted owner restart, machine crash /
  reboot continuity (sessions do not survive reboot; never promised).
- Live migration of sessions born before guardian-v2 (incl. all `lf1`
  and all Phase-B-era sessions): drain only (D5).
- Upgrading a running guardian or a running CLI in place; descendants
  that escape the CLI's process group; guardian-crash recovery.
- Saturation limits, very large writes/messages, thousands of sessions,
  long soak, complex UTF-8/ANSI/TUI behaviour, and real Claude/Codex
  workloads — unproven until L5's measured limits table exists; the
  spike proved 13 sessions, batches ≤ 5, ASCII + Bash only.
- Any latency/pause guarantee for a batch or a frontend swap. Spike
  numbers (§1) are bench samples. Maximum acceptable pause is an open
  owner question in the dossier; this spec sets **no** number
  (proposition, not validated, if a lot proposes one).
- MCP-HANDOVER (separate workstream, D14); the `h2a upgrade` command
  surface itself if it does not yet exist on a lot's base (B4); update
  scheduling/policy; any new UI.
- Windows/ConPTY; Intel macOS; older macOS; Node < 22.
- Two standing PTY owners (O1) — optional, unvalidated, unestimated.
- Batch bound, queue bound, session ceiling, compat-window width,
  coordinator placement, native distribution mechanism, exact new-file
  names: propositions, not validated (D16/D17/D19, §4, L2). Each lot
  report must convert its own propositions into tested values or carry
  them forward explicitly as still-unvalidated.
- Harness peer review of the spike itself was `selection-failed` (no
  consensus exists on spike code, per spike2); product lots follow the
  normal review rules of the repo, which this spec does not replace.
- Verification on the owner's real machine/state, full-suite runs, and
  version attribution: conductor/owner steps, outside every lot.

## 9. Lot summary and carried estimates

| Lot | One-line outcome | Agent-hours (spike2, D20) |
|---|---|---:|
| B1 | Owner boundary + versioned internal protocol | 6–10 (with B2's boundary work) |
| B2 | Owner/frontend process split, preserved listener, lifecycle | 12–20 |
| B3 | Attach/replay/input/resize/leases/quotas across frontend swap | 10–18 |
| B4 | Upgrade PTY contract: frontend-only swap, per-component reporting, frontend rollback | 8–14 |
| B5 | `lf1` drain + real-agent qualification (Phase B gate) | 12–20 |
| **Phase B total** | Sessions survive h2a/frontend upgrade | **48–82** (4–6 review rounds) |
| L1 | Guardian v2 + status channel until ACK | 8–14 |
| L2 | Native FD backend + distribution + security | 12–20 |
| L3 | Batch transaction, bounded queues, rollback | 16–28 |
| L4 | On-demand owner 2, admission, routing, owner restart | 6–10 |
| L5 | Faults/load/soak, N↔N+1, real agents (Phase L gate) | 12–22 |
| **Phase L supplement** | Sessions survive PTY-owner restart, in batches | **54–94** (4–7 more rounds) |
| **B + L total** | Owner's goal, §0 items 1–2 | **102–176** (8–13 rounds) |
| O1 (optional) | Two standing owners — new owner decision required | not estimated |

Per-lot hour splits inside each phase follow spike2's lot table; B1+B2
share its first two lines. Ranges include code/tests/review/fixes and
uncertainty margin; they are not calendar deadlines and exclude the
already-done spikes (D20).
