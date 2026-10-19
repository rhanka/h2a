# SPEC EVOL — PTY option B, then batched handover (h2a) — v2

Status: build specification, not code. Written 2026-10-18. **v2 supersedes
v1** (`SPEC_EVOL_PTY_B_BATCH_HANDOVER.md`, kept for traceability). v2 applies
two independent reviews of v1, both `CORRECTIONS-REQUISES` (Astra max,
`revpty-last.md`, 9 remarks; Sol 6.1 max, `revpty2-last.md`, 9 remarks).
Every P1/P2 was re-verified against code before being applied; the
remark-by-remark disposition, with evidence, is in `changes-v2.md`. Short
result: **no review remark is rejected as wrong on its root claim**; one
remark (D13 attribution) is applied with a precision on wording, documented
in `changes-v2.md` and §3/D13. Scope grew where verification proved v1
incomplete; estimates are re-derived in §9 and marked as such.

Base for all file paths: `origin/main` of `/home/antoinefa/src/h2a`
(`7670fbed6` at writing time), read via `git show origin/main:<path>`. The
local working tree of that checkout is dirty and was **not** used as evidence.
No version number is assigned by this specification; version attribution is a
conductor/owner decision.

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
  (answered by spike2 for the bench primitives: Linux and macOS ARM64 CI
  green, §1. The **product** macOS substrate is a different, larger claim —
  see §2 and lot BM. v1 conflated the two; v2 separates them.)
- `Vas-y B puis lots` (2026-10-18) — B first, then batches. This ordering
  is binding for the lots in §5.

Platform qualification levels (owner platform order: Linux, then macOS, then
Windows — `DECISIONS-owner.md` 2026-10-12; QO13: Linux qualified, VM for
macOS/Windows):

- **B-Linux** is shippable on its own when the Linux gates of §5 are green.
- **B-macOS** may be claimed only after lot BM and the macOS gates of B5 are
  green on macOS ARM64 CI. Before that, macOS product behaviour is
  **NOT covered** (§8), however green the spike bench is.
- Phase L on a platform requires that platform's Phase B gate first
  (L-Linux after B-Linux; L-macOS after B-macOS).

Anything the owner did not ask for or validate is marked
**proposition, not validated** wherever it appears. Owner requirements and
propositions are kept in separate rows/paragraphs throughout; a proposition
never inherits an owner source by proximity.

## 1. Inputs read for this specification

| Input | What was taken from it |
|---|---|
| Decision dossier v2 (`dossier-pty/v2/dossier-pty-v2.md` + HTML) | Option B definition: stable PTY owner, replaceable frontend, listening socket preserved; B moves no PTY; no retroactive migration of already-running sessions; MCP-HANDOVER ≠ PTY-HANDOVER. |
| Spike2 report + details (`dossier-pty/spike2/report.md`, `details.md`, CI `39073867783`, code `33a4f5470`) | Batched handover proven on Linux and macOS ARM64 **as a bench**; original batch estimates B 48–82 agent-hours, B+batches supplement 54–94, total 102–176, 8–13 review rounds (superseded by §9 after re-verification); explicit non-covered list. |
| Spike branch `spike/pty-batch-handover` (read via `git show`, never merged) | `spike/pty-batch-handover/DESIGN.md`, `handover.test.mjs`, `owner.mjs`, `native.c`, `support.mjs`, `run.mjs`: guardian = real CLI parent, `SCM_RIGHTS` transfer of master + status channel **plus JSON metadata per session**, freeze→offer→prepare→commit, coordinator-held queues, isolated failed batch. Faults actually tested: receiver reject and injected `EBADF` **only** (`handover.test.mjs`: `fault: 'reject'`, `fault: 'ebadf'`). **No prepare timeout is implemented or tested in the spike** — v1 attributed it to spike2 in error (corrected in D9). |
| First bench branch `spike/pty-owner-reexec` (read via `git show`) | B mechanism: keeper holds the listener, frontends receive a copy, same-inode rename, backlog survives frontend `SIGKILL`; a fresh listener per frontend fails the availability test (red control). |
| Current code on `origin/main` (§2, re-read for v2) | Starting architecture and the exact file inventory used for per-lot allow-lists, now including the existing upgrade implementation (`packages/h2a/src/cli.ts`, `packages/h2a/src/runtime/upgrade/index.ts`, `packages/h2a/src/hosts/upgrade-equipment.ts`) that v1 §2 wrongly reported as absent. |
| `DECISIONS-owner.md` (authoritative) | H2: one PTY process, progressive withdrawal of `lf1` by draining; `h2a upgrade` never restarts the native host (0.98.7 line); Node ≥ 22 only (2026-10-12); platforms Linux, then macOS, then Windows (not urgent); estimates in agent-hours and review rounds; QO4: everything we deliver (installer, MCP, skills, tests, CI) stays 0 Python. |
| Reviews of v1 (Astra max `revpty-last.md`; Sol 6.1 max `revpty2-last.md`) | 18 remarks (7 distinct P1 roots + overlaps, 5 distinct P2 roots). Each verified in code; disposition in `changes-v2.md`. They are inputs to v2, not authorities: where code disagreed with a remark's wording, code wins and the precision is recorded. |

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
- The spike offer payload is **not** "2 FDs only": `owner.mjs` sends, per
  session, every session field except the two descriptors as JSON metadata
  (`sessions: ss.map(({master, control, ...meta}) => meta)`), which includes
  the pending-write list with per-write byte offsets (`writes[]/offset`) and
  the unparsed tail of the status stream (`controlText`). `DESIGN.md` states
  it explicitly: "Metadata includes partial control stream state and partial
  write offsets." v2 D22 generalises this to the product snapshot; v1 D8,
  which described the transfer as 2 FDs/session, was incomplete.
- Batch latency on the small bench: 1.4–2.9 ms request→commit without
  injected pause (`sendmsg` alone 0.009–0.027 ms). These are bench
  samples, **not** a product latency guarantee (spike2 states this).

## 2. Starting point on `origin/main` (facts, read in code — corrected in v2)

One fused PTY host process per socket generation:

- `packages/h2a-runtime/src/native-terminal/process.ts` — host process entry
  (`[h2a-pty-host]` log prefix). Builds one `NativeTerminalHost` plus one
  socket server in the **same** process. On `SIGINT`/`SIGTERM`/`SIGHUP` it
  stops **all** sessions (`stopAll`, then `forceStopAll` after 500 ms).
  Today, host restart = every CLI dies. This is the behaviour this EVOL removes.
- `native-terminal/host.ts` — `NativeTerminalHost`: session map
  (`SessionRecord`: id, incarnation, pty handle, durable group token, replay
  buffer, status/exit/stopSignal, controller id/activity/identity/epoch,
  last-human-activity, data/exit subscriptions), replay buffers, controller
  leases, process-group reaper, durable pgid rows in `../registry.js`
  (single-store coupling, documented in-file; do not remove it). The host
  carries an immutable `#generation`; **every lease is checked against it**
  (`#requireMatchingController`: `lease.generation !== this.#generation` ⇒
  `stale terminal controller lease`). A session moved to a host with a
  different generation therefore invalidates every outstanding lease unless
  the transfer explicitly translates them (D22). Output parsing state lives
  outside the replay chunks: `TerminalReplayBuffer` holds `latestSeq`,
  retained chunks and two `TerminalModeTracker`s (evicted + current, each
  with split-sequence parser state); the host adds a `TerminalResetRelay`
  (pending partial marker) and a DSR carry tail (`dsrTail`, ≤ 3 chars) per
  session. All of it is transfer-relevant state (D22).
- `native-terminal/server.ts` — Unix-socket server: staged publication
  (staged bind → `link` to published name → unlink staged name; same socket
  identity throughout), publication lock, owner record
  (`<socket>.owner`: pid + start time + socket identity, written by rename),
  endpoint-absence proof (`proveNativeTerminalEndpointAbsent`), request
  dispatch. Per-connection controller leases are held in the connection
  context (`context.leases`) and **released on socket close**
  (`releaseConnectionLeases`). Three Linux couplings matter for §6/lot BM:
  (a) the publication lock is a listening socket on a Linux **abstract**
  address (`\0h2a-terminal-lock-<sha256>`); `socketPublicationLockSecret`
  throws `native terminal socket publication requires Linux abstract Unix
  sockets` when `process.platform !== "linux"` — publication is impossible
  on macOS today; (b) endpoint-absence and active-host attribution read
  `/proc/<pid>/stat|cmdline|fd`, `/proc/<pid>/net/unix` and
  `/proc/self/ns/pid` (`src/proc-identity.ts` returns `undefined` — never a
  value — off Linux, and every caller must fail closed on it, so absence is
  unprovable on macOS: `proveNativeTerminalEndpointAbsent` returns
  `unknown` off Linux); (c) process-group census/token/zombie probes in
  `host.ts` enumerate `/proc`. The spike's macOS run proves none of these
  product mechanisms; it proves `SCM_RIGHTS`, guardian parentage and
  `kqueue` on a bench.
- `native-terminal/protocol.ts` — wire protocol **version 1**; operations
  `ping/create/list/state/read-output/attach-observer/acquire-controller/
  acquire-controller-if-no-recent-human/release-controller/write/resize/
  stop/stop-if-incarnation`; max 256 sessions; replay 4 MiB/session. A
  `write` request carries `{lease, data}` and returns `null`; there is **no
  write identity, no application ACK frontier, no deduplication** (see the
  in-flight fact below).
- `native-terminal/client.ts` — `NativeTerminalClient` (request/response
  over the Unix socket, per-request timeout, default 5 s). Each request
  mints a **fresh** `randomUUID()` id; on timeout the pending entry is
  deleted and the promise rejects, whether or not the host already executed
  the request. Retrying a `write` after such a failure is therefore a new,
  indistinguishable write.
- `native-terminal/op.ts` (attach) — the user path makes the consequence
  explicit: `pumpInput` awaits `client.write` for the head chunk; on **any**
  error it drops that one chunk ("The host may have accepted the write
  before the response path broke. Drop this ONE uncertain chunk … replaying
  it could duplicate a command") and prints `terminal input delivery
  became uncertain during reconnect; the in-flight chunk was not replayed`.
  **Fact:** on `origin/main`, a keystroke chunk in flight across a
  reconnect is already lost-or-duplicated by design choice (dropped, with a
  warning). A preserved listening socket does not change this: it protects
  queued *connections*, not an executed write whose response vanished with
  the connection/frontend. Phase B cannot claim "input written during a
  frontend swap is delivered exactly once" (v1 B3) without the write
  identity/ACK/dedup contract of D21.
- `native-terminal/supervisor.ts` — spawns/adopts the host process,
  health-checks it, reconciles dead-host orphans, fail-closed containment
  (`NativeTerminalContainmentError`). Takeover runs
  `reconcileDeadHostOrphans` before spawning a replacement.
- Durable ownership (`src/registry.ts` + `host.ts`): at session creation the
  host persists, on the session's registry row, `pgid`,
  `pgidLeaderStartTime`, `pgidGroupToken` (per-session `randomUUID`), the
  pid-space frame (namespace/boot/machine) and the **creating** host's
  attribution (`ownerHostPid`, `ownerHostStartTime`, `ownerHostSocketPath`).
  `reconcileDeadHostOrphans` snapshots every row, probes **that row's**
  owner, and for a proven-dead owner calls `reapOrphan`, which re-reads the
  row and compares **pgid and group token only** against the snapshot before
  verifying group identity and issuing `kill(-pgid, SIGKILL)`. It does **not**
  re-compare the owner fields. **Fact (the D23 hazard):** pgid and token are
  exactly the two values a batch transfer conserves. A session transferred
  to owner 2 keeps a row naming dead owner 1; even if the row is
  re-attributed *after* a reconcile pass has snapshotted it, that pass's
  reap still matches pgid+token and kills the transferred group. Re-attribution
  alone is insufficient; the kill-side fence must include the owner
  attribution (D23).
- `native-terminal/socket-path.ts` — `XDG_RUNTIME_DIR/h2a-nt/
  native-terminal.sock` (or `tmpdir()/h2a-nt-<uid>/…` without
  `XDG_RUNTIME_DIR`) plus the compatible `native-terminal.lf1.sock`;
  `knownNativeTerminalSocketPaths()` inventories both generations (the
  `lf1` drain of H2 is already shaped here). Path budget 107 bytes Linux /
  103 bytes Darwin, fail-closed.
- `src/pty.ts` — `nodePtySpawner` over `node-pty`. On Linux every CLI is
  wrapped by `setpriv --pdeathsig SIGUSR2` + a bash guardian script: host
  death kills the CLI group (containment). Inherited FDs ≥ 3 are scrubbed
  before exec (E1 fix line). On non-Linux the command is spawned directly —
  i.e. **off Linux there is no parent-death containment at all today**, and
  `nativePtyRequirements()` only preflights `setpriv`/`bash` on Linux.
  **`PtyHandle` exposes no master FD** (`pid/pgid/cols/rows/write/resize/
  kill/onData/onExit` only) — a `node-pty` master cannot be transferred
  by `SCM_RIGHTS` through this interface. Phase L therefore needs a new
  spawner backend (§5, lot L2); this is a fact of the current interface,
  not a preference. `host.write` is a synchronous `pty.write(data)` of a
  whole string: "partially executed write" state does not exist in today's
  host, but **will** exist in the native backend's write queue (as in the
  spike's `writes[]/offset`) and must be part of the snapshot (D22).
- Keeper components today (all inside the fused host): the listening
  `net.Server`, the abstract-socket publication lock server, the published
  pathname (hard link to the staged socket inode) and the `.owner` record.
  Cleanup unlinks the published path and the owner record **only** when the
  on-disk identity still matches this process's own socket/pid/start time
  (`unlinkOwnedPath`). Any B topology that moves "the keeper" must move all
  four consistently; moving only the listening FD orphans the lock and the
  owner record (D24).
- **`h2a upgrade` exists on `origin/main`** (v1 §2 said the opposite; that
  was wrong — the grep was scoped to `packages/h2a-runtime/src/` and missed
  `packages/h2a/`):
  - Manual path: `packages/h2a/src/cli.ts` `cmdUpgrade` (`h2a upgrade
    [--check]`, DEC-107/EVO-8) calls `performAutoUpgrade`, then
    `convergeAfterExplicitUpgrade` (`packages/h2a/src/hosts/
    upgrade-equipment.ts`, `doctor --repair` per native host).
  - Automatic path: the detached MCP boot worker (`MCP_UPGRADE_WORKER_SOURCE`
    in `cli.ts`) imports the same upgrade module and calls the same
    `performAutoUpgrade`. Manual and automatic are one implementation.
  - `performAutoUpgrade` (`packages/h2a/src/runtime/upgrade/index.ts`):
    staged install in a sibling prefix, version + native-load probes, then
    an atomic rename swap (`current → <pkg>.h2a-prev-<ver>-<pid>-<rand>`,
    `staging → current`). On verified success it **deletes the previous
    install** (`rmSyncSafe(swapped.prevDir)`) and sweeps residues
    (`sweepUpgradeResidues`, which also removes older `h2a.h2a-prev-*` dirs
    whose recorded pid is certainly dead or past the age threshold). Inodes
    of already-launched processes stay valid, so a *running* old frontend
    keeps executing — but **no new previous-version frontend can be spawned
    after a successful upgrade**, which voids v1's "rollback = start the
    previous compatible frontend" unless retention is built (D28, lot B4).
  - Existing upgrade tests: `packages/h2a/test/upgrade.test.js`,
    `upgrade-swap.test.js`, `upgrade-boot-worker.test.js`,
    `cli-contract.test.js` (Node test runner, against `dist/`).
    `packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts` is
    a dist-vs-dist PTY qualification (published 0.98.4 vs candidate), a
    different thing with a similar name.
- CI today: `.github/workflows/ci.yml` `build-and-test` runs
  `os: [ubuntu-latest]`, Node 22/24 (macOS/Windows parked inactive by owner
  decision 2026-07-28, quoted in-file). There is **no macOS CI cell** for the
  product suites. The spike had its own throwaway workflow on its branch;
  nothing equivalent exists on `origin/main`. Any macOS gate in §5 needs its
  workflow file owned by a named lot (lot BM).
- Test skipping today: the functional suites this EVOL touches are
  Linux-only by construction — `crash-safety.functional.test.ts`,
  `listener-failure.functional.test.ts`, `process.functional.test.ts`,
  `drive.functional.test.ts`, `terminal-modes.functional.test.ts`,
  `upgrade.functional.test.ts`, `supervisor.test.ts` use
  `describe.skipIf(process.platform !== "linux")`, and `host.test.ts` /
  `server.test.ts` skip their `/proc`-dependent cases off Linux. A blanket
  `skipped: 0` gate "on Linux and macOS" (v1) is therefore unexecutable as
  written; §5 defines gates **per platform file set** (D27).

Existing targeted tests that already pin surrounding behaviour and must
stay green whenever a lot touches their file's neighbour (named per lot):
`host.test.ts`, `server.test.ts`, `client.test.ts`, `supervisor.test.ts`,
`op.test.ts`, `process.functional.test.ts`, `crash-safety.functional.test.ts`,
`listener-failure.functional.test.ts`, `respawn.test.ts`,
`publication-proof.test.ts`, `publication-refusal.test.ts`,
`upgrade.functional.test.ts`, `replay-buffer.test.ts`, and for lot B4 the
`packages/h2a/test/upgrade*.test.js` family above.

## 3. Decisions

Source column: **Owner** = verbatim/decision file; **Dossier** = decision
dossier v2 content the owner approved by choosing B; **Spike** = proven on
a bench (Linux + macOS ARM64 for spike2; Linux for spike1 B-bench);
**Code** = fact read on `origin/main` (§2) that constrains the design;
**Proposition, not validated** = this specification's proposal, needs a
build-time or owner confirmation as noted. v2 changes to v1 decisions are
marked **[v2]**; new decisions are D21–D28.

| # | Decision | Source |
|---|---|---|
| D1 | Order is binding: Phase B first, shippable on its own; Phase L (batches) second; lot O1 (two standing owners) last and optional. No lot of a later phase starts before the previous phase's gate **on that platform** is green (D27). | Owner (`Vas-y B puis lots`) |
| D2 | Target steady state = **one** PTY owner. A second owner exists only transiently during a batched handover and the emptied old owner exits by itself — **after** keeper succession (D24) and durable re-attribution (D23) complete, never before **[v2]**. A standing pair contradicts H2 until the owner revises H2 — hence O1 is optional and separately gated. | Owner (H2) + Spike2 (auto-exit when empty) |
| D3 | Option B = stable owner + replaceable frontend. B moves **no** PTY. The client-facing listening socket is preserved across frontend replacement (same inode, backlog kept); a fresh listener per frontend is a known-failing design (spike1 red control) and is forbidden. Preservation covers *connections*; executed-but-unacknowledged writes need D21, not the listener **[v2]**. | Dossier + Spike1 |
| D4 | During Phase B, no upgrade path — **neither the existing manual `h2a upgrade` (`cmdUpgrade`) nor the automatic boot worker, both of which call `performAutoUpgrade` today [v2, Code]** — ever signals, stops, or respawns the PTY owner. Owner replacement happens only by drain (owner empty) until Phase L provides batched handover. The upgrade implementation must also *retain* the installs live components still need (D28); today's delete-previous-on-success behaviour is incompatible with frontend rollback and is changed by lot B4. | Owner (0.98.7 line: `h2a upgrade` never restarts the native host) + Dossier; retention mechanics = Proposition, not validated |
| D5 | Sessions born before B (incl. `lf1` generations) and sessions born under B before Phase L are **never** live-migrated. They stay reachable on their owner until they end; the old endpoint/owner is withdrawn only when empty (draining). No retroactive transfer is promised anywhere. | Owner (H2 `lf1` draining) + Dossier (common limit) |
| D6 | Per-session guardian = the real parent of the CLI for its whole life. It reaps the CLI and reports the exact wait status on a transferable `SOCK_STREAM` channel, retained until the receiving owner ACKs. The receiving owner never `waitpid`s the CLI (`ECHILD` is the expected, asserted outcome on Linux and macOS). No parent transfer, no adoption. | Spike2 (proven both OSes) |
| D7 | No dependency on `PR_SET_PDEATHSIG` or `PR_SET_CHILD_SUBREAPER` in the transfer/containment path of new (guardian-v2) sessions. Containment trigger = EOF of the guardian status channel when the **last** owner copy is gone, plus terminal HUP. The Linux test-only subreaper of the spike (container PID 1 compensation) is test scaffolding, never product behaviour. | Spike2 |
| D8 **[v2]** | Batch is the atomicity unit. Per batch: freeze reads/writes → offer (`SCM_RIGHTS`, master + status channel = 2 FDs/session **plus the versioned session snapshot of D22**) → prepare on receiver (staged, **no reads** from staged FDs, snapshot imported invisibly) → commit (durable re-attribution D23, receiver publishes route, sender closes its copies). The **commit point** is defined in D25. Inputs arriving during the move are queued per session **under the custody rule of D25** and delivered in order after commit or after rollback drain; the route stays "moving" until the rollback queue is fully drained (spike2 reorder fix `33a4f5470` is normative here). Output stays in the PTY kernel buffer during the pause. | Spike2 (freeze/offer/prepare/commit, queues, reorder fix); snapshot content, commit-point and custody definitions = D22/D25 |
| D9 **[v2]** | A failed batch rolls back only its own sessions to the sender, in original input order, with no loss/duplicate/reorder. Sessions outside the batch, in either owner, are never frozen, stopped, or re-routed by another batch's failure. Failure sources **proven by spike2**: receiver reject at prepare, `sendmsg` error incl. `EBADF` — both before commit. **Prepare timeout is not spike-proven** (the spike implements no timeout; v1 listed it as spike behaviour in error): it is a product requirement of this spec, specified in D25 and first tested in L3. | Spike2 (reject/EBADF); timeout = Proposition, not validated (product need) |
| D10 | Exactly-once input/output is claimed **only** for cooperative paths (no process crash at/after the commit point, and for Phase B no owner crash). Within cooperative paths the claim now explicitly includes writes in flight across a frontend replacement or a batch move — via D21 ACK/dedup, not via listener preservation **[v2]**. Crash-at-commit behaviour is specified in §7 as "exactly one owner or confined, never two readers", is fault-tested in L5, and no stronger claim is made. See §8, NOT covered. | Spike2 limit, carried into product spec |
| D11 **[v2]** | Linux first, then macOS, same *contract* — but the product mechanisms differ per OS (§6) and macOS product support requires the substrate port of lot BM (D27); the spike's portable primitives do not by themselves qualify the product on macOS. Windows/ConPTY is excluded: its handles are not Unix PTY masters transferable by `SCM_RIGHTS`; it would need a distinct backend, which is out of scope. | Owner (platform order) + Spike2 + Code (§2) |
| D12 | Node ≥ 22 only (CI 22 + 24). No Node 20 support argument is used anywhere in design or tests. | Owner (2026-10-12) |
| D13 **[v2 — split]** | **Owner requirement:** zero Python in everything we deliver — installer, MCP, skills, tests, CI (QO4 verbatim: "l'essentiel est que nous on livre 0 python"; standing rule: 0 Python in repos and jobs, validated stack = Node/TS + already-present native binaries). The owner's stated *motive* (a Python job means shipping an unvalidated container image) is recorded as motive, **not** generalised into a ban on any new container image: v1's "No new container image" went beyond the cited decisions and is withdrawn. **Proposition, not validated:** native code for Phase L in C + N-API, compiled by a Node-driven direct-`cc` build script (the spike's method: `cc -shared/-bundle`, no `node-gyp`, no Python in the build). The owner mandated no language for the native part; C/N-API is the spike-proven route, and lot L2 must state the build/distribution choice in its report before code. TypeScript/Node elsewhere follows repo convention. | Owner (0 Python livré); C + N-API + direct-`cc` build = Proposition, not validated (Spike2 method) |
| D14 | MCP-HANDOVER is a separate workstream with its own spec. This EVOL covers PTY only. The single `h2a upgrade` command (H4) may *sequence* both, but a PTY lot must not block on, reimplement, or silently absorb MCP handover behaviour; each reports its own per-component result (installed / loaded / switched / deferred), and a partial upgrade is always visible as partial. | Dossier §2/§6 + Owner H4 |
| D15 | FD hygiene is contract, not cleanup: every PTY master, status channel, and transfer socket is `CLOEXEC`; guardians/children close all inherited FDs ≥ 3 before `exec` (preserving the E1 fix); a session must never hold another session's master. Verified by test, per lot that spawns. | Owner (E1) + current `pty.ts` + Spike2 |
| D16 | All wire protocols touched by this EVOL are versioned and negotiated, never assumed: client↔frontend (existing v1, **extended additively by D21 — a write-identity field a v1 peer ignores must never silently downgrade the exactly-once claim; the negotiated capability decides the claim [v2]**), frontend↔owner (new, B1), owner↔owner batch transfer incl. snapshot (new, L3/D22), guardian↔owner status channel (new, L1). An unknown or mismatched version fails closed with a typed error; it never falls back to guessing. Compat window size (N↔N+1 only, or wider) is **proposition, not validated** — B1 proposes N↔N+1 and pins it by test; widening needs an owner/conductor call. | Proposition, not validated (mechanism); fail-closed style follows current code |
| D17 | Product topology for B — two processes (owner process holding `NativeTerminalHost` + spawner; frontend process holding the public listener + client protocol, forwarding to the owner over a private socket), owner-side keeper holds the listening FD and each frontend receives a copy at spawn: **proposition, not validated**. It is the direct product reading of the spike1 bench, but the owner validated the B *outcome*, not this mechanism. B1/B2 must keep the boundary reversible until B2's gate is green. **[v2]** Whichever process holds the keeper, D24 (keeper succession) is normative: the frontend must never end up as the sole holder of the listener, the publication lock, or the owner record. | Proposition, not validated |
| D18 | Spike branches (`spike/pty-batch-handover`, `spike/pty-owner-reexec`) are evidence only. They are never merged, never cherry-picked. Product code is written fresh under `packages/h2a-runtime/` conventions; spike test *scenarios* are re-expressed as product RED tests (§5). | Spike reports ("never merged") + repo hygiene |
| D19 **[v2]** | Batch-size bound, per-session queue bound during a move, and any pause-duration budget are **proposition, not validated** as *numbers*. Spike2 proved batches ≤ 5 and queues on a 13-session bench. The *behaviour at the bound* is no longer left to the lot: it is fixed by D26 (admission before ACK, typed backpressure, fate of the exceeding write). L3 picks explicit numeric bounds, fails closed beyond them per D26 (never truncate, never ACK-then-drop), and L5 measures them. No numeric bound in this spec is an owner commitment. | Proposition, not validated (numbers); D26 (behaviour) |
| D20 **[v2]** | Estimates are **re-derived in §9**, not carried: re-verification proved work v1/spike2 had not priced (existing-upgrade retention, macOS substrate port, write ACK/dedup, transfer snapshot, durable-ownership fence, keeper succession, coordinator custody). §9 shows v1 numbers, per-cause deltas, and v2 numbers side by side. All figures are ±-ranges in agent-hours + review rounds (owner metric), spike time excluded, to be recalibrated after B1 and after BM — not a schedule. | Owner metric; numbers = author estimate, not validated |
| D21 **[new]** | **In-flight write contract (Phase B and L).** Every controller write carries a stable identity — proposition: `(session id, incarnation, controller epoch, per-controller monotonic write sequence)` minted by the *client* (attach/drive), never per transport attempt. The owner ACKs a contiguous applied frontier per controller; a re-sent write at or below the frontier is a duplicate: ACKed again, **not** written to the PTY a second time. A write above `frontier+1` (gap) fails closed with a typed error. The dedup record is owner-side state, bounded (proposition: frontier + the bytes needed to recognise the last in-flight chunk; exact bound pinned by B3 tests), and survives frontend replacement because the owner survives it. **Lease resume:** after a reconnect, the same controller identity re-presents itself; the owner either resumes the same epoch (if it is still the holder and no takeover intervened) or issues a new epoch and reports the applied frontier, from which the client resumes its queue — already-ACKed bytes are never re-sent as new, un-ACKed bytes are re-sent **under their original sequence numbers**. Takeover by a different controller fences the old epoch exactly as today. The `op.ts` drop-on-error behaviour (§2) is removed on the D21-capable path; on a non-D21 (v1-only) peer the drop remains and **no exactly-once claim is made** (capability-negotiated, D16). RED coverage must cut the connection at three points — before execution, after PTY execution but before the response, and on client timeout — and assert the exact bytes the CLI received (B3). | Requirement: D10/Dossier continuity + Code (§2 in-flight loss); mechanism (identity shape, frontier, bounds) = Proposition, not validated |
| D22 **[new]** | **Transferred state snapshot (Phase L).** The offer carries, per session, a versioned snapshot (`TransferSnapshotV1`, proposition name) in addition to the 2 FDs. Minimum content, each field traced to §2 state: session `id` and `incarnation` (**preserved unchanged** — logical identity survives the move); sender `generation` (for lease translation, below); `pid/pgid` + durable `groupToken` + pid-space frame; terminal size (`cols/rows`); `status`/`exit`/`stopSignal`; controller state (`controllerId`, activity, identity, `controllerEpoch`, `lastHumanActivityAt`) **and the D21 applied frontier per controller**; replay state (`latestSeq`, every retained chunk with its `seq`, the eviction gap base, and both `TerminalModeTracker` states serialised — enabled modes, cursor/keypad/modifyOtherKeys, main+alternate Kitty stacks, **and mid-sequence parser state**); output-relay state (`TerminalResetRelay` pending tail, DSR carry tail); pending input already accepted by the sender but not yet fully written to the master (per-write bytes + written offset, spike `writes[]/offset` equivalent); guardian-channel state (unparsed status-stream tail — spike `controlText` equivalent — plus any parsed-but-unACKed exit status and whether the guardian ACK was already sent). **Import is atomic and staged:** the receiver builds the full session record invisibly at prepare (no reads from staged FDs, no route published, no replay served from it); commit activates it in one step; abort discards it whole. **Sequence continuity:** a replay cursor (`afterSeq`) obtained before the move stays valid after it — `readAfter` on the receiver continues the same `seq` space with the same gap semantics; history is never reset. **Lease translation:** the receiver's host generation differs, so pre-move leases cannot validate as-is (§2). The commit therefore re-issues each live controller lease under the receiver generation with the **same controller id, epoch lineage and D21 frontier**, and the routing layer (frontend/coordinator) translates in-flight old-generation lease references to the re-issued lease exactly once; a client reconnecting afterwards with an old-generation lease receives a typed `migrated` outcome carrying the re-issued lease iff its controller identity matches, otherwise `stale`. An already-attached real client must observe commit and rollback **without losing its lease, its replay cursor, or its history** (L3 tests). Snapshot size is bounded by the existing replay/frame limits; an oversized or malformed snapshot rejects the batch before commit (D9), never truncates. | Code (§2 SessionRecord/replay/lease generation check) + Spike (metadata precedent); snapshot format + lease-translation mechanics = Proposition, not validated |
| D23 **[new]** | **Durable session ownership moves at commit, fenced against stale snapshots.** The registry row's owner attribution (`ownerHostPid/StartTime/SocketPath`) plus a new monotonic **ownership epoch** (proposition field, e.g. `ownerEpoch`, incremented on every transfer; absent = 0 for legacy rows) is part of the batch commit: for each session, compare-and-swap the row from *(expected pgid, group token, old owner pid+start time, old epoch)* to *(new owner pid+start time, epoch+1)*, durably written **before** the sender closes its FD copies and before the sender may exit. If the CAS fails, the batch has not committed (D25) and rolls back. The reaper is hardened in the same lot: `reconcileDeadHostOrphans`/`reapOrphan` must re-read and compare the **owner attribution and epoch** immediately before any group signal, exactly as they already compare pgid+token; any mismatch = row changed ⇒ **no signal**, reported as skipped/row-changed, row kept. The sender's own exit-time prune/cleanup paths get the same owner-compare (compare-and-delete on pgid+token+owner+epoch). Required proof (L4): a reconcile pass snapshotted *before* a transfer, resumed *after* the old owner exits, signals nothing; and transfer → sender exit → fresh supervisor reconcile signals nothing. No cleanup anywhere may act on owner attribution it has not just re-read. | Code (§2 durable-ownership hazard); epoch field + CAS mechanics = Proposition, not validated |
| D24 **[new]** | **Keeper succession (Phase L, prerequisite of old-owner exit).** The keeper is four things held together (§2): listening FD (+backlog/inode), publication lock, published pathname, `.owner` record. Before an emptied owner 1 may exit, keeper authority passes to owner 2 in this order: (1) owner 2 receives its own copy of the listening FD (proposition: `SCM_RIGHTS` over the owner↔owner channel, or inheritance at spawn — L4 chooses and pins it) and ACKs that it holds a listening copy of the **same** socket identity; (2) under the publication lock, the `.owner` record is atomically re-stamped to owner 2 (pid+start time+same socket identity) by the existing rename mechanism — the published pathname is **never unlinked** during succession; (3) publication-lock holding transfers or is re-acquired by owner 2 without a window in which nobody holds it while the endpoint is published (exact hand-off pinned by L4 tests); (4) only then does owner 1 close its listener copy and exit, and its exit cleanup must observe that the on-disk identities no longer match it and therefore unlink **nothing** (existing `unlinkOwnedPath` semantics, now load-bearing — tested). If any step fails, owner 1 stays alive and the owner restart is reported deferred (D2). The frontend is never the sole keeper holder at any instant. Required gate (L4): full transfer → owner 1 exit → frontend `SIGKILL` → frontend replacement → a connection queued during the frontend outage is served on the **same inode**. | D3/D17 consequence + Code (§2 keeper components); transfer mechanics = Proposition, not validated |
| D25 **[new]** | **Coordinator custody and batch state machine — fixed before L3, not in L4.** Placement (which process *drives* the batch) remains **proposition, not validated** and is chosen at L3 design time, but the following are normative for any placement: **(a) Custody:** input bytes that have been ACKed toward the client (D21) are held, until commit or abort completes, by the **sender owner** (which also retains its master/status FDs until commit). The frontend/coordinator may hold routing state and *un-ACKed* bytes only; it is never the sole holder of ACKed bytes. Coordinator/frontend death before commit therefore loses nothing ACKed: the batch times out into abort and the sender drains its own queue in order. **(b) States per batch:** `offered → prepared → committed` or `… → aborted`, with a per-batch id + incarnation-scoped batch epoch carried in every message. **Commit point** = the sender has received `PREPARED(batch, epoch)`, completed the D23 durable CAS for every session in the batch, and sent `COMMIT(batch, epoch)`; before that point abort is always possible, after it the receiver owns the sessions (§7 crash wording applies from there). **(c) Late/stale messages:** a `PREPARED`/`COMMIT`/`ABORT` whose batch id or epoch is not the live one (e.g. a `PREPARED` arriving after the prepare timeout already aborted the batch), and any duplicate of an already-applied message, is discarded with a typed/logged outcome — it never resurrects a batch, never closes FDs twice, never re-publishes a route. On abort the receiver closes its staged FD copies and discards staged snapshots; on commit the sender closes its copies. Double-close is a test failure, not a tolerated race. **(d) Prepare timeout:** bounded (number = proposition, pinned in L3); expiry = abort path (D9). Tests required in L3/L4: coordinator death with a non-empty queue, timeout followed by a late `PREPARED`, duplicated `COMMIT`, saturation during rollback (D26). | Requirement: D8/D9/D10; placement + timeout number = Proposition, not validated |
| D26 **[new]** | **Queue admission, backpressure, and the exceeding write.** Bounds (D19 numbers) are enforced at **admission, before ACK**: a write is ACKed (D21 frontier advances) only once it is either written to the master or durably queued within the session's bound on the current custodian (D25). A write that would exceed the per-session queue bound — during normal operation, during a move's freeze/prepare, or during rollback drain — is **not ACKed and not truncated**: the client receives a typed backpressure outcome (`queue-full`, proposition name) with the current frontier, keeps the bytes in its own queue under their original sequence numbers, and retries when the route reopens/drains. Bytes already ACKed are never dropped to make room. A batch whose *snapshot + queued bytes* would exceed transfer bounds is rejected **before freeze** where the excess is knowable in advance; excess arising mid-move from new writes is handled by the backpressure rule above, not by aborting a healthy batch and not by unbounded queueing. If the master itself is saturated (kernel buffer full), partial-write offsets (D22) advance as bytes land; the ACK frontier advances only over fully-queued writes per the rule above — L3 pins the exact frontier semantics by test with a saturated master. RED coverage: bound exceeded during prepare, then during rollback drain, asserting the CLI eventually receives the exact byte sequence once, in order. | Requirement: D9/D21 ("never truncate" made operational); error name + numbers = Proposition, not validated |
| D27 **[new]** | **macOS product substrate is its own lot (BM), and gates are per-platform.** Before any macOS gate can run, BM ports the §2 Linux couplings with equivalent proofs or explicit fail-closed behaviour: publication lock without abstract sockets; endpoint-absence/active-host attribution without `/proc` (proposition: `libproc`/`sysctl`-based identity, peer credentials, socket-file identity — BM states the chosen proofs and their limits in its report; "unknown ⇒ refuse" semantics are preserved, never weakened to pass); process identity/start-time equivalents for `proc-identity.ts`; process-group census/token/zombie equivalents or a stated, tested reduction; non-Linux spawn containment story for `pty.ts` (today: direct spawn, no parent-death containment — BM must state what macOS containment *is* before L1 builds on it). BM also owns the macOS ARM64 CI workflow (§5). **Gate rule (replaces v1's blanket `skipped: 0`):** every lot names a Linux file set and, where applicable, a macOS file set. Within a platform's set, `skipped: 0` is absolute — a skip counts as FAILED. A file in neither set on a platform is *not run* there (listed as such in the lot report), which is different from running-and-skipping. Linux gates never lose a proof to make room for macOS (`skipped: 0` on Linux is resolved by platform sets, not by deleting Linux assertions). No macOS claim of any kind before BM + the relevant macOS gate are green; until then macOS is listed in §8 NOT covered. | Owner (platform order, QO13) + Code (§2); proof mechanisms = Proposition, not validated |
| D28 **[new]** | **Upgrade retention and the two rollbacks.** Both existing upgrade paths (manual `cmdUpgrade`, boot auto-upgrade worker — one `performAutoUpgrade`) are in B4's scope. **Retention:** a successful upgrade must not delete an install that a live PTY component still needs. Live components (each owner, each frontend) report their loaded version **and code identity** (proposition: install prefix / entrypoint path recorded at spawn); the swap's prev-dir deletion and `sweepUpgradeResidues` must skip any `h2a.h2a-prev-*` directory still referenced by a live component (liveness by the same pid+start-time proof family as §2; undecidable ⇒ keep, fail-closed). Retained dirs are reaped only once unreferenced, by a later sweep. **Two distinct rollbacks, never conflated:** (1) *Frontend rollback within B* — start the previous **B-compatible** frontend (possible only because of retention) against the untouched owner; (2) *Abandoning B* — returning to the pre-B fused host. A fused host binary has no owner/frontend boundary and **cannot adopt a live B owner**, whatever the client protocol version; abandoning B therefore requires the B owner to be empty (sessions ended or drained per D5), its endpoint withdrawn, and only then a fused host started. B components (owner-capable build) are retained until the last B session ends. B4 tests must qualify (2)'s refusal/deferral **with live B sessions present**, not on an empty system. Keeping client protocol v1 is necessary for client compatibility; v1 §7's claim that it makes abandoning B sufficient is withdrawn. | Code (§2 upgrade deletion; fused `process.ts` has no adoption path) + Owner D4 intent; retention mechanics = Proposition, not validated |

Explicitly **rejected** by the inputs and therefore forbidden in every lot:
option C (in-place re-exec of the owner — lost-exit race reproduced on
spike1, not chosen); option A (standing multi-generation relay — dismissed
in the dossier, contradicts H2); copying a PTY master to a new process
without solving guardian parentage (dossier §2: insufficient, kills the
CLI group on parent death); **[v2]** transferring FDs without the D22
snapshot, the D23 fence, or the D24 succession (each independently loses
leases/history, kills transferred CLIs, or strands the listener — §2);
claiming exactly-once in-flight delivery on listener preservation alone
(§2, D21).

## 4. Architecture after each phase (target reading of D3/D17)

Phase B end state (proposition, not validated, per D17):

```
client ──unix──> frontend process ──private unix──> owner process ──> guardian ──> CLI
NativeTerminal    (public listener,   (versioned,     NativeTerminal   (bash      (same
Client             protocol v1+D21)    D21-aware)      Host + spawner    guardian,  process)
                     ▲ replaceable    listening FD held owner-side,      pdeathsig
                     │ at upgrade     copied to each frontend (D3)       on Linux)
owner process: never signalled by upgrade (D4); holds D21 frontiers + dedup;
exits only when empty + asked. Frontend holds no sole copy of ACKed bytes (D25a
applies to B as custody discipline: the owner is the ACK authority).
```

Phase L adds, for sessions born under the new backend only:

```
owner 1 ──batch: SCM_RIGHTS (master + status ch.) + TransferSnapshotV1──> owner 2
   │            freeze → offer → prepare(staged import) → D23 CAS → COMMIT   │
   │            ACKed queue stays with owner 1 until COMMIT (D25a)           │
   └── guardian (unchanged, real parent of CLI) ─────────────────────────────┘ status until ACK
frontend route table: session → owner 1 | moving(sender-drained queue) | owner 2
keeper: listener+lock+pathname+.owner pass owner1 → owner2 BEFORE owner1 exits (D24)
registry row: owner attribution + epoch CAS at COMMIT (D23); reaper re-checks owner+epoch
old owner exits by itself when empty AND succession done (D2). Standing pair = O1 only.
```

Placement of the batch coordinator / route table (frontend vs a dedicated
coordinator vs receiving owner as in spike2's bench) is **proposition, not
validated**; it is chosen at **L3** design time (v1 deferred it to L4, after
the queues existed — corrected), stated in the L3 report, and pinned by the
coordinator-death test in L3. The contract (D8/D9/D21–D26) does not depend
on the placement; custody (D25a) constrains every placement equally.

## 5. Lots

Rules that apply to **every** lot (not repeated per lot):

- RED first: the lot's named tests are written and run **before** the
  implementation, on the lot's base; the red output (failing for the
  stated reason, `skipped: 0` within the platform's file set, D27) is kept
  as evidence. A test that skips because real state is absent counts as
  FAILED, never as pass.
- Targeted tests only: `npx vitest run <file>` (runtime TS suites) or
  `node --test <file>` (`packages/h2a/test/*.test.js`, after the package
  build the lot names) for the files named in the lot. The full repo suite
  is run once by the conductor at integration, never by a lot.
- Tests use temporary dirs only (`mkdtemp`; `HOME`/`XDG_RUNTIME_DIR`/
  `TMPDIR` pointed at temp dirs the test creates), following the existing
  `packages/h2a/test/helpers/native-isolation.js` pattern (used read-only;
  modifying that helper requires it to appear in the lot's allow-list).
  Never the installed `h2a` binary, the installed dist,
  `~/.config/sentropic/h2a`, `~/.local/state/h2a`, `/run/user/*/h2a-nt`, or
  any process the test did not spawn. Stop only spawned PIDs; no
  `pkill -f`, no `killall`.
- File scope — **closed lists [v2]**: a lot may create/modify **only** its
  allow-list, which enumerates every production, test, helper, build and CI
  file **before** the lot starts. No directory wildcards (`native/` is not
  an allow-list entry anywhere in v2; every native file is named). No lot
  report may define its authorised perimeter retroactively; a missing file
  requires a spec amendment *before* code. Scope control is
  `git status --porcelain` **and** `git diff --stat` (the former catches
  untracked files, which `git diff` alone ignores — v1 named only the
  latter). Anything outside the allow-list in either output fails the gate,
  however small.
- Commits: conventional English subject, no attribution trailer of any
  kind; branch per lot (or per phase, conductor's call — proposition,
  not validated), fast-forward push of that branch only, never force,
  never touch `main`.
- Green claim = command + output, quoted in the lot report, including
  `pass/fail/skipped` counts and exit code, **per platform**. `skipped > 0`
  inside a platform's gate set = gate failed (D27). Files not in a
  platform's set are listed as "not run on <platform>", never silently
  omitted.
- Type/static gate: every touched package must build with zero new type
  errors (`npm run build` in the touched package, i.e. `tsc -b`; lot B4
  builds both `packages/h2a-runtime` and `packages/h2a`), checked on the lot
  branch; "pre-existing" is claimable only if the same command reports the
  identical error on the untouched base.
- Transient `bwrap: No permissions to create a new namespace`: retry the
  same command a few times with a short pause before concluding anything.

Test-name convention below: `it('should …')` inside the named file.
New test files are created by the lot that names them. All paths below are
repo-relative; `native-terminal/` abbreviates
`packages/h2a-runtime/src/native-terminal/` in prose only — allow-lists
always spell full paths.

### Phase B — stable owner, replaceable frontend (D1: first, shippable alone)

#### Lot B1 — Owner/frontend boundary, versioned internal protocol, write-identity seam

Purpose: carve the seam inside today's fused process without changing
externally visible behaviour. No new process yet. The internal protocol is
designed from day one to carry D21 write identities and frontiers end-to-end
(client → frontend → owner), so B3 does not re-open the boundary.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/owner-protocol.test.ts`):

- `it('should reject an owner-protocol frame with an unknown version')`
- `it('should reject a truncated owner-protocol frame without dispatching')`
- `it('should round-trip every v1 client operation through the owner boundary unchanged')`
  (all 13 operations of `protocol.ts`, table-driven)
- `it('should keep controller-lease identity across the owner boundary')`
- `it('should carry a stable write identity and applied frontier across the owner boundary unchanged')`
  (D21 seam: identity survives forwarding; no re-minting per hop)
- `it('should negotiate the write-identity capability and fail closed on an unknown capability')` (D16)
- `it('should fail closed when the owner side is absent, with a typed error')`

Allowed files:

- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts` (new)
- `packages/h2a-runtime/src/native-terminal/owner-protocol.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/server.ts`
- `packages/h2a-runtime/src/native-terminal/protocol.ts`

Forbidden: `process.ts`, `supervisor.ts`, `client.ts`, `op.ts`, `pty.ts`,
`socket-path.ts`, `registry.ts`, any wire-format change to client
protocol v1 beyond additive D21 fields, any new process/entry point, any
dependency change, any CI file.

Gate (Linux set; macOS set = same unit file only, no functional file yet —
macOS functional gates start at BM):
`npx vitest run packages/h2a-runtime/src/native-terminal/owner-protocol.test.ts`
red-before (module absent) / green-after; plus `host.test.ts`,
`server.test.ts` green; `tsc -b` clean in `packages/h2a-runtime`.

#### Lot B2 — Owner process extraction, preserved listener, lifecycle

Purpose: split `process.ts` into an owner process and a frontend process
(D17); the public listener survives frontend death/restart (D3); the
supervisor restarts/replaces only the frontend and never signals the
owner (D4). Existing publication proofs (staged rename, lock, owner
record, endpoint-absence proof, coded refusals) are preserved, not
weakened. Each spawned component records its loaded version + code
identity (install entrypoint/prefix) for B4 retention and per-component
reporting. Linux only; macOS publication is lot BM (B2 must not fake it:
on `darwin` the new processes fail closed with the existing typed
publication error, asserted by test).

RED tests first (new file `packages/h2a-runtime/src/native-terminal/owner-frontend.functional.test.ts`, real processes + real PTYs):

- `it('should keep every CLI alive across a frontend SIGKILL and replacement')`
  (same CLI PID/birth before/after; positive liveness = new input answered after, not `kill(pid,0)`)
- `it('should accept a client connection queued during frontend replacement')`
  (backlog/inode preserved; the spike1 direct-listener variant is the red control and must fail this test)
- `it('should refuse to start a second owner for the same socket')`
- `it('should exit the owner only when empty and explicitly stopped')`
- `it('should report owner and frontend loaded versions and code identities separately')`
- `it('should keep sessions confined when the owner itself is killed')`
  (current containment semantics unchanged: CLI groups die with the owner, no orphans)
- `it('should fail closed with a typed publication error on darwin until lot BM')`
  (unit-level platform assertion in `supervisor.test.ts`; on Linux this case is *not run*, listed per D27 — never run-and-skipped)

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

Forbidden: `host.ts` session semantics, `pty.ts`, `client.ts`/`op.ts`
public API, `registry.ts`, weakening any publication/refusal/containment
check, changing client protocol v1 semantics, session migration of any
kind (that is Phase L), any CI file (BM owns CI).

Gate (Linux set): targeted run of the new functional file (red-before on
fused `process.ts`: frontend kill = host kill, sessions die) / green-after;
plus `process.functional.test.ts`, `listener-failure.functional.test.ts`,
`publication-refusal.test.ts`, `publication-proof.test.ts`,
`supervisor.test.ts` green, `skipped: 0`. macOS set at B2: **none**
(functional files not run; B-macOS starts at BM).

#### Lot BM — macOS product substrate port + macOS ARM64 CI [new in v2]

Purpose: make the *product* mechanisms of §2 work on macOS with equivalent
proofs, so that later lots' macOS gates are executable at all (D27). BM
changes no B/L semantics; it ports substrate. It must complete before the
B5 macOS gate and before any L lot claims a macOS gate. BM's report states,
**before code**, the chosen macOS proof for each item below and its limits;
"unknown ⇒ refuse" is preserved everywhere — a proof that cannot be made
equivalent stays a typed refusal, and the affected behaviour is listed in
§8 NOT covered for macOS rather than silently passing.

Scope of the port (each item needs its RED test below):

1. Socket publication without Linux abstract sockets (lock + staged
   publication + owner record + same-identity guarantees).
2. Endpoint-absence and active-host attribution without `/proc`.
3. Process identity: start-time / pid-recycling discriminant, namespace/
   boot/machine frame equivalents for `proc-identity.ts` (or an explicit,
   tested statement of which frame fields macOS cannot provide and which
   proofs therefore refuse).
4. Process-group probes used by the reaper: membership census, token
   carriage, zombie-group detection — or stated reductions with tests.
5. Spawn containment on macOS: what replaces `setpriv --pdeathsig` + bash
   guardian for *legacy* (pre-L1) sessions, or an explicit tested
   fail-closed/refusal boundary. (Guardian-v2 containment is L1; BM defines
   the floor L1 builds on.)
6. macOS ARM64 CI: a workflow that runs the macOS file sets named by B5/L
   lots with `skipped: 0` enforcement, Node 22 + 24.

RED tests first (new files `packages/h2a-runtime/src/native-terminal/darwin-publication.test.ts` and `packages/h2a-runtime/src/native-terminal/darwin-identity.test.ts`; platform sets: darwin files run only on macOS, Linux regression files only on Linux — D27):

- `it('should publish, lock and attribute a socket on darwin without abstract sockets')`
- `it('should refuse a second publisher for the same socket on darwin')`
- `it('should prove endpoint absence on darwin only from positive evidence, else refuse')`
  (live owner ⇒ not absent; unreadable owner ⇒ unknown/refuse, never absent)
- `it('should distinguish a recycled pid from the same process on darwin, or refuse the proof')`
- `it('should attribute a pathname-less live host on darwin, or refuse double publication')`
- `it('should confine a legacy session group on host death on darwin, or refuse to start it')`
  (whichever floor BM states — the test pins the stated floor, not a wish)
- `it('should keep every Linux publication proof green after the port')`
  (Linux set: existing `publication-proof.test.ts` / `publication-refusal.test.ts` / `server.test.ts` unchanged and green)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/server.ts`
- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/socket-path.ts`
- `packages/h2a-runtime/src/proc-identity.ts`
- `packages/h2a-runtime/src/pty.ts` (darwin spawn-containment floor only; Linux path byte-preserved)
- `packages/h2a-runtime/src/native-terminal/darwin-publication.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/darwin-identity.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/server.test.ts`
- `packages/h2a-runtime/src/native-terminal/host.test.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.test.ts`
- `packages/h2a-runtime/src/native-terminal/publication-proof.test.ts`
- `packages/h2a-runtime/src/native-terminal/publication-refusal.test.ts`
- `.github/workflows/pty-macos-qualification.yml` (new, proposition name — runs the darwin file sets on `macos-latest` ARM64, Node 22/24)
- `.github/workflows/ci.yml` (only if BM's report chooses a matrix cell there *instead of* the dedicated workflow; exactly one of the two workflow files is touched, stated before code)

Forbidden: weakening any Linux proof/refusal to share code with darwin,
`client.ts`/`op.ts`/`protocol.ts` semantics, `registry.ts` row semantics
(frame *values* on darwin are BM; row *shape* changes are L3/D23),
guardian-v2 or transfer code (L1+), frontend/owner lifecycle semantics (B2).

Gate: darwin set green on macOS ARM64 CI (`skipped: 0` in the two new
files; red-before = today's typed Linux-only publication error); Linux set
(`server.test.ts`, `host.test.ts`, `supervisor.test.ts`,
`publication-proof.test.ts`, `publication-refusal.test.ts`,
`process.functional.test.ts`, `crash-safety.functional.test.ts`,
`listener-failure.functional.test.ts`) green on Linux, `skipped: 0`;
`tsc -b` clean. The workflow file itself is validated by a green run of
the darwin set it defines (run URL quoted in the lot report).

#### Lot B3 — Session continuity across frontend replacement, incl. in-flight writes (D21)

Purpose: attach/replay/write/resize/leases/quotas behave across a
frontend swap exactly as within one frontend life — **including writes in
flight at the moment of the swap** — with no lost or duplicated input, no
replay gap beyond the existing `TerminalReplayGap` contract, and no lease
stealing by the new frontend. This lot implements D21 end-to-end (client
write identity, owner frontier/dedup, lease resume) and removes the
`op.ts` drop-on-error behaviour on the D21-capable path. Without B3, the
§0 outcome is not claimable for interactive use (§2).

RED tests first (new files `packages/h2a-runtime/src/native-terminal/write-ack.test.ts` and `packages/h2a-runtime/src/native-terminal/frontend-swap.functional.test.ts`; the functional file drives the **real attach path** (`op.ts` semantics) against a real CLI fixture and asserts bytes received by the CLI, not bytes the client believes it sent):

- `it('should replay identical scrollback before and after a frontend swap')`
- `it('should deliver a write cut before execution exactly once after a frontend swap')`
  (connection killed before the owner executes: retry under the same write identity lands once)
- `it('should not duplicate a write cut after execution but before its response')`
  (owner already wrote to the PTY; the response dies with the frontend; the retry is recognised as duplicate — CLI receives the bytes once)
- `it('should resolve a client timeout without losing or duplicating the timed-out write')`
  (timeout ≠ not-executed: after reconnect the frontier decides; CLI byte-exact)
- `it('should reject a write with a sequence gap instead of applying it out of order')`
- `it('should resume the same controller lease after reconnect and refuse a different controller without takeover')`
  (lease resume per D21; takeover still fences the old epoch; a reconnect never steals from a newer attach)
- `it('should apply a resize issued after a frontend swap (SIGWINCH + size readback)')`
- `it('should keep enforcing session and replay quotas across a frontend swap')`
- `it('should surface the exact exit status of a CLI that exits during a frontend swap')`
- `it('should keep the legacy drop-with-warning behaviour only on a non-D21 peer')`
  (capability gate: no silent downgrade of the claim, D16/D21)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/replay-buffer.ts`
- `packages/h2a-runtime/src/native-terminal/server.ts`
- `packages/h2a-runtime/src/native-terminal/client.ts` (write identity + resume; no API break for existing callers — additive options only)
- `packages/h2a-runtime/src/native-terminal/protocol.ts` (additive D21 fields + capability)
- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts`
- `packages/h2a-runtime/src/native-terminal/op.ts` (attach `pumpInput`/reconnect: stable identities, frontier-based resume, drop removed on D21 path)
- `packages/h2a-runtime/src/native-terminal/write-ack.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/frontend-swap.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/host.test.ts`
- `packages/h2a-runtime/src/native-terminal/client.test.ts`
- `packages/h2a-runtime/src/native-terminal/op.test.ts`
- `packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts`

Forbidden: `process.ts`/`owner-process.ts`/`frontend-process.ts`
lifecycle, `pty.ts`, `registry.ts`, replay-size or quota value changes
(any new value = proposition, not validated, needs its own decision),
weakening takeover fencing, any exactly-once wording beyond D10/D21
(owner crash still excluded).

Gate: targeted runs of both new files red-before (on today's code the
three cut-point tests fail by construction: fresh request ids, dropped
chunk) / green-after; plus `host.test.ts`, `client.test.ts`, `op.test.ts`,
`replay-buffer.test.ts`, `respawn.test.ts`,
`crash-safety.functional.test.ts` green. Platform sets — Linux: all of
the above; macOS (only after BM): `write-ack.test.ts`, `host.test.ts`,
`client.test.ts`, `op.test.ts`, `replay-buffer.test.ts`, and
`frontend-swap.functional.test.ts` iff BM's darwin floor supports real-PTY
functional runs (stated in BM's report; otherwise listed not-run on
macOS, and B-macOS interactive continuity stays NOT covered, §8).

#### Lot B4 — Upgrade integration on the existing `h2a upgrade` (PTY-safe, retentive)

Purpose: wire Phase B into the **existing** upgrade implementation (§2) so
that manual and automatic upgrades take the same PTY-safe path: replace
frontend, never signal the owner (D4), retain installs live components
need (D28), report per-component state, and support frontend rollback
within B. Abandoning B (return to the fused host) is specified as
drain-then-switch, never as adoption (D28). v1 B4, written against the
false "no `h2a upgrade` exists" premise and forbidding the real files, is
replaced wholesale.

RED tests first (new file `packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts`; extensions to the named `packages/h2a` upgrade suites; the dist-vs-dist `upgrade.functional.test.ts` keeps its existing scenario plus the B case below):

- `it('should never signal the PTY owner during a frontend upgrade')`
  (assert owner PID/birth unchanged and no stop journal entry for the owner)
- `it('should take the same PTY-safe path for manual upgrade and boot auto-upgrade')`
  (both entry points observable through the same `performAutoUpgrade` + PTY step; the boot worker's quiet-outcome set must not hide a PTY deferral)
- `it('should retain the previous install while a live owner or frontend still runs from it')`
  (red on today's code: verified swap deletes `prevDir`; green = referenced prev dirs survive swap + sweep, unreferenced ones are still reaped, undecidable liveness keeps)
- `it('should roll back to the retained previous B frontend when the new frontend fails its handshake')`
  (previous frontend actually spawnable after the upgrade — retention made real; owner untouched)
- `it('should report installed, loaded, switched and deferred versions per component')`
- `it('should refuse a frontend whose owner-protocol version is outside the compat window')`
- `it('should leave a visible partial state when the frontend swap is interrupted')`
  (never a false full-success report)
- `it('should refuse to abandon B for a fused host while B sessions are live, and allow it after drain')`
  (D28: with live B sessions the fused start is refused/deferred with the blocking count; owner empty ⇒ endpoint withdrawn ⇒ fused host may start; B-capable build retained until the last B session ends)

Allowed files:

- `packages/h2a/src/cli.ts`
- `packages/h2a/src/runtime/upgrade/index.ts`
- `packages/h2a/src/hosts/upgrade-equipment.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/frontend-process.ts`
- `packages/h2a-runtime/src/native-terminal/owner-process.ts`
- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts`
- `packages/h2a-runtime/src/native-terminal/journal.ts`
- `packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`
- `packages/h2a-runtime/src/native-terminal/journal.test.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.test.ts`
- `packages/h2a/test/upgrade.test.js`
- `packages/h2a/test/upgrade-swap.test.js`
- `packages/h2a/test/upgrade-boot-worker.test.js`
- `packages/h2a/test/cli-contract.test.js`

Forbidden: MCP-handover code of any kind, `host.ts`, `pty.ts`,
`registry.ts`, auto-update scheduling/policy (when to upgrade is not a PTY
decision), weakening the upgrade prefix lock / staged-swap / repair
semantics, deleting a retained install on any best-effort path (retention
checks fail closed: keep).

Gate: `npx vitest run` on `upgrade-pty-contract.test.ts`,
`upgrade.functional.test.ts`, `journal.test.ts`, `supervisor.test.ts`
(red-before/green-after, `skipped: 0` in the Linux set); `npm run build`
in `packages/h2a` then `node --test packages/h2a/test/upgrade.test.js
packages/h2a/test/upgrade-swap.test.js
packages/h2a/test/upgrade-boot-worker.test.js
packages/h2a/test/cli-contract.test.js` green; `tsc -b` clean in both
packages. macOS set (after BM): `upgrade-pty-contract.test.ts` +
`supervisor.test.ts` + the `packages/h2a/test/upgrade*.test.js` family;
`upgrade.functional.test.ts` runs on macOS only if its dist-install
harness is ported by amendment — otherwise listed not-run (its current
`skipIf(linux)` describe must not be carried into a macOS "green").

#### Lot B5 — Legacy drain (`lf1`) and real-agent qualification of Phase B

Purpose: pre-B generations (incl. `lf1`) stay reachable until their last
session ends, then their endpoint/owner is withdrawn; new sessions are
never created on a draining generation (D2/D5). Phase B is qualified
with real agents in isolated environments before anyone claims it.
**[v2] Every qualification file, scenario and command is named here, in
advance** (v1 B5 demanded unnamed extra files — corrected). The agent
scenarios are: (a) interactive Bash/readline; (b) a scripted agent fixture
(numbered-input echo fixture driven through the real attach path,
including a frontend swap mid-conversation with D21 cuts); (c) for each
real CLI the conductor enrols under the existing test-matrix workstream
(2026-10-12 decision: simulated models first), the same scenario file run
with that CLI binary in an isolated HOME. A CLI with no green targeted
run is **not** claimed (owner rule: nothing announced without proof); the
exact real-CLI list executed is recorded in the lot report — adding a CLI
later needs no spec change (same file, new run), removing a scenario does.

RED tests first (new files `packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts` and `packages/h2a-runtime/src/native-terminal/phase-b-agent-qualification.functional.test.ts`):

- `it('should keep a legacy-generation session reachable until it exits by itself')`
- `it('should never create a new session on a draining generation')`
- `it('should withdraw the legacy endpoint only after its last session ends')`
- `it('should inventory both generations with their loaded versions')`
  (over `knownNativeTerminalSocketPaths()`, both socket names)
- `it('should preserve a real interactive shell session across a frontend upgrade')`
  (Bash/readline: command before, command after, `stty size` after resize)
- `it('should preserve a scripted agent conversation across a frontend swap with in-flight writes')`
  (numbered inputs exact through the real attach path; a write cut mid-swap lands once, D21)
- `it('should preserve an enrolled real CLI session across a frontend upgrade')`
  (table-driven per enrolled CLI; zero enrolled CLIs in the environment = the qualification is reported incomplete, never skipped-green)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/socket-path.ts`
- `packages/h2a-runtime/src/native-terminal/op.ts`
- `packages/h2a-runtime/src/native-terminal/fleet.ts`
- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/phase-b-agent-qualification.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/fleet.test.ts`
- `packages/h2a-runtime/src/native-terminal/op.test.ts`

Forbidden: force-killing a legacy generation that still holds sessions,
migrating a legacy session live (D5), removing the `lf1` socket name
from inventory before drain completes, `pty.ts`, `host.ts`, any new
qualification file beyond the two named (amend first), modifying
`packages/h2a/test/helpers/native-isolation.js` (read-only use).

Gate: targeted runs red-before/green-after; `fleet.test.ts`, `op.test.ts`
green. **Phase B-Linux is done** when B5's Linux set (both new files +
`fleet.test.ts` + `op.test.ts`) is green on Linux with `skipped: 0`.
**Phase B-macOS is done** when, additionally, BM is green and B5's macOS
set (both new files + `fleet.test.ts` + `op.test.ts`, on BM's CI workflow,
macOS ARM64) is green with `skipped: 0`. The lot report states the two
verdicts separately; a Linux-only green must never be reported as "Phase
B done" without the platform qualifier.

### Phase L — batched handover between two owners (requires Phase B green on that platform)

Native file names used by L1/L2/L3 (proposition names, fixed here so every
allow-list is closed; renaming needs an amendment before code):

- `packages/h2a-runtime/src/native-terminal/native/guardian.c` — guardian v2 + status channel (L1).
- `packages/h2a-runtime/src/native-terminal/native/pty-fd-addon.c` — N-API addon: PTY allocation exposing the master FD, `SCM_RIGHTS` send/receive, resize, peer checks (L2).
- `packages/h2a-runtime/src/native-terminal/native/build-native.mjs` — Node-driven direct-`cc` build (D13 proposition: no `node-gyp`, no Python; `cc -shared` Linux / `-bundle` Darwin as in the spike's `support.mjs`).
- `packages/h2a-runtime/src/native-terminal/native/native-loader.ts` — typed loader that fails closed when the artefact is absent/mismatched (L1 creates it for the guardian path; L2 extends it for the addon).

#### Lot L1 — Portable session guardian v2 + status channel

Purpose: replace the Linux-only bash guardian + `setpriv --pdeathsig`
for **new** sessions with a small native guardian that is the CLI's real
parent on Linux and macOS, reaps it, and holds the exact status on a
`SOCK_STREAM` channel until ACK (D6/D7/D15). Old-guardian sessions are
untouched and drain (D5). No transfer yet. On macOS, L1 builds on BM's
stated containment floor; where BM could only refuse, L1's macOS set is
reduced accordingly and the gap stays in §8 — L1 must not invent a macOS
proof BM did not establish.

RED tests first (new files `packages/h2a-runtime/src/native-terminal/guardian-channel.test.ts` and `packages/h2a-runtime/src/native-terminal/guardian-v2.functional.test.ts`):

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
- `packages/h2a-runtime/src/native-terminal/native/build-native.mjs` (new; guardian target only in L1)
- `packages/h2a-runtime/src/native-terminal/native/native-loader.ts` (new)
- `packages/h2a-runtime/src/pty.ts` (new spawner path for guardian-v2 sessions only; legacy path byte-preserved)
- `packages/h2a-runtime/src/native-terminal/guardian-channel.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/guardian-v2.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/process.functional.test.ts` (regression only)
- `packages/h2a-runtime/package.json` (build script entry for `build-native.mjs` only; no new dependency)
- `packages/h2a-runtime/tsconfig.json` (only if excluding `native/*.mjs` from `tsc` requires it; the diff must show nothing else)

Forbidden: removing or altering the legacy bash-guardian path, `host.ts`
transfer logic (none yet), `SCM_RIGHTS` code (L2/L3), changing
containment for legacy sessions, `PR_SET_PDEATHSIG`/`setpriv` in the v2
path (negative control excepted, test-only), `node-gyp`/Python anywhere
in the build (D13).

Gate: targeted runs red-before (no v2 guardian) / green-after;
`process.functional.test.ts`, `crash-safety.functional.test.ts`,
`terminal-modes.functional.test.ts` green. Platform sets — Linux: all
named files, `skipped: 0`. macOS (requires BM green): both new files with
`skipped: 0` — this is achievable precisely because the new files test
guardian-v2 behaviour, not the Linux-only legacy suites; the three Linux
regression files are listed not-run on macOS (their proofs stay Linux,
D27), **not** run-and-skipped, and no Linux assertion is removed to make
room. If BM's darwin floor refuses real-PTY functional runs, the macOS
functional file is not-run and L-macOS is blocked at L1, reported as such.

#### Lot L2 — Native PTY/FD backend, distribution, security

Purpose: a spawner backend that exposes the PTY master FD and can
send/receive FDs (`SCM_RIGHTS` over a private Unix `SOCK_DGRAM` pair),
with `node-pty` kept for legacy sessions. Includes build/distribution
for Linux + macOS (arch matrix, ABI, macOS signing needs) — the
distribution mechanism is **proposition, not validated** and must be
stated in the lot report before code (prebuilds vs build-at-install is
an owner-visible supply-chain choice; D13's owner rule forbids delivered
Python in the build, which already excludes a `node-gyp` build).

RED tests first (new file `packages/h2a-runtime/src/native-terminal/fd-backend.test.ts`, plus functional `packages/h2a-runtime/src/native-terminal/fd-transfer.functional.test.ts`):

- `it('should expose a CLOEXEC master FD for a v2 session')`
- `it('should pass a master FD to a peer process and keep the terminal usable there')` (write/read/resize from the receiver)
- `it('should reject a transfer message with a mismatched FD count')`
- `it('should surface EBADF as a typed transfer error, not a crash')`
- `it('should refuse a transfer peer that is not the expected owner')` (peer credential/identity check — mechanism proposition, not validated)
- `it('should load the native backend or fail closed with a typed unavailable error')` (never a silent fall-back to a non-transferable session presented as transferable)
- `it('should build the native artefacts from a clean checkout with no Python and no network fetch')`
  (temp-prefix clean build via `build-native.mjs`; artefact loads under Node 22 and 24)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/native/pty-fd-addon.c` (new)
- `packages/h2a-runtime/src/native-terminal/native/build-native.mjs` (addon target added)
- `packages/h2a-runtime/src/native-terminal/native/native-loader.ts`
- `packages/h2a-runtime/src/pty.ts` (backend selection behind the spawner interface)
- `packages/h2a-runtime/src/native-terminal/fd-backend.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/fd-transfer.functional.test.ts` (new)
- `packages/h2a-runtime/package.json` (`files`/scripts for the native artefacts only; no new runtime dependency without naming it in the lot report before code)

Forbidden: `host.ts` batch logic (L3), removing `node-pty`, any Python
(incl. `node-gyp`) in build/CI, network fetch of prebuilt binaries at
install time unless the lot report proposes it and the conductor accepts
it (supply-chain), weakening D15, any CI workflow edit (BM's workflow
already runs the named darwin sets; a new cell needs an amendment naming
the workflow file).

Gate: targeted runs red-before/green-after; Linux set = both new files;
macOS set (after BM) = both new files on BM's workflow; `skipped: 0` per
set; `tsc -b` clean; clean-checkout temp-prefix build green (command +
output quoted).

#### Lot L3 — Batch transaction: snapshot, custody, state machine, rollback

Purpose: the D8/D9 protocol between two owners **with** the D22 snapshot
and lease translation, the D25 custody rule and state machine (coordinator
placement chosen and stated in this lot's report *before* code), D26
admission/backpressure, single-reader exclusion (staged FDs are never
read before commit), and rollback that drains the sender-held queue
before the route reopens. Bounds per D19/D26: the lot picks and tests
explicit max-batch, max-queued-bytes and prepare-timeout values
(propositions); beyond them behaviour follows D26 — reject before freeze
where knowable, backpressure without ACK where not, never truncate.
The D23 durable CAS mechanics live here at the commit step (registry row
helper); the reaper hardening and supervisor-level proofs are L4.

RED tests first (new files `packages/h2a-runtime/src/native-terminal/transfer-snapshot.test.ts` and `packages/h2a-runtime/src/native-terminal/batch-handover.functional.test.ts`, re-expressing spike2's three scenarios as product tests and adding the product-only cases spike2 never had):

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
- `it('should keep an attached client lease, replay cursor and history valid across commit')`
  (real client attached *before* the move: same controller keeps writing after commit under the translated lease, `readAfter(preMoveSeq)` continues without reset or spurious gap — D22)
- `it('should keep an attached client lease, replay cursor and history valid across rollback')`
- `it('should resume a partially written input at its exact offset after commit')`
  (master saturated so a write is half-landed at freeze; receiver continues at the offset; CLI byte-exact, once)
- `it('should deliver an exit status split across the guardian channel at freeze exactly once after commit')`
  (fragmented status line: first fragment parsed pre-move, remainder post-move; status delivered once, guardian ACKed once)
- `it('should preserve terminal mode and parser state split mid-sequence across commit')`
  (CSI/OSC sequence and reset-marker split at freeze; post-move output continues the same parse — asserts mode prefix/restore behaviour, D22)
- `it('should abort on prepare timeout and ignore a late PREPARED for the aborted batch')` (D25c; first product test of the timeout — not spike-derived)
- `it('should ignore a duplicated COMMIT without double-closing or double-publishing')` (D25c)
- `it('should lose no ACKed input when the coordinator dies before commit with a non-empty queue')`
  (custody proof, D25a: coordinator/frontend killed mid-move; batch aborts; sender drains its own queue in order; CLI byte-exact)
- `it('should backpressure the write that exceeds the queue bound during prepare, then deliver it once in order')` (D26)
- `it('should backpressure the write that exceeds the queue bound during rollback drain, then deliver it once in order')` (D26; saturated master variant included)
- `it('should re-attribute durable ownership to owner 2 at commit and leave it untouched on abort')`
  (registry CAS per D23; abort leaves owner+epoch as before; commit bumps epoch exactly once)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/batch-transfer.ts` (new, proposition name)
- `packages/h2a-runtime/src/native-terminal/transfer-snapshot.ts` (new, proposition name — snapshot encode/decode + lease translation)
- `packages/h2a-runtime/src/native-terminal/replay-buffer.ts` (snapshot export/import of chunks + tracker states)
- `packages/h2a-runtime/src/native-terminal/terminal-modes.ts` (tracker state serialise/restore)
- `packages/h2a-runtime/src/native-terminal/reset-relay.ts` (pending-tail export/import)
- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts`
- `packages/h2a-runtime/src/native-terminal/protocol.ts` (typed `migrated`/`queue-full` outcomes only)
- `packages/h2a-runtime/src/registry.ts` (ownership-epoch field + CAS helper only; no other row semantics)
- `packages/h2a-runtime/src/native-terminal/native/pty-fd-addon.c` (transfer primitives only)
- `packages/h2a-runtime/src/native-terminal/transfer-snapshot.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/batch-handover.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/host.test.ts`
- `packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts`
- `packages/h2a-runtime/src/native-terminal/terminal-modes.test.ts`

Forbidden: frontend/client protocol changes beyond the two typed
outcomes above, `supervisor.ts` admission/reaper changes (L4), durable
on-disk batch journal unless proposed in the lot report as the
crash-recovery mechanism *before* code with its files allow-listed by
amendment (proposition, not validated), any exactly-once claim past D10,
holding ACKed bytes anywhere but the sender before commit (D25a — a
design that violates custody fails review even if tests pass).

Gate: targeted runs red-before (no transfer: sessions die / stay put on
owner stop; snapshot/coordinator tests fail for missing protocol) /
green-after, `skipped: 0`; Linux set = both new files + the three unit
files above; macOS set (after BM+L1/L2 macOS gates) = same files on BM's
workflow; negative controls of L1 still behave (parent-death control
red, exit-channel-off control red — spike2's two red proofs re-expressed).

#### Lot L4 — Independent owner startup, admission, routing, durable fence, keeper succession, owner restart

Purpose: the product path the spike did **not** prove: owner 2 is
started on demand **after** sessions exist (spike2 started it first),
admission decides which sessions may move (guardian-v2 + fd-backend
only; legacy sessions stay and drain), the frontend routes per session
to the current owner, durable ownership is fenced end-to-end (D23
reaper hardening + sender cleanup), keeper authority succeeds to owner 2
(D24), the emptied owner 1 exits by itself, and `h2a upgrade` (PTY side,
per B4) can request a full owner restart as a sequence of batches.

RED tests first (new files `packages/h2a-runtime/src/native-terminal/owner-restart.functional.test.ts` and `packages/h2a-runtime/src/native-terminal/durable-ownership.test.ts`):

- `it('should move every transferable session to an owner started after the sessions')`
- `it('should keep legacy sessions on owner 1 and report the owner restart as deferred for them')` (visible partial state, D14-style; never force-migrated, never hidden)
- `it('should exit owner 1 by itself once empty and keeper succession completed, and not before')`
- `it('should route new sessions to owner 2 only after the switch point')`
- `it('should abort the in-flight batch and keep sessions on owner 1 if the coordinator dies before commit')`
  (product-level restatement of the L3 custody proof with the real supervisor/frontend in place)
- `it('should refuse a second concurrent owner-restart request')`
- `it('should report per-batch and per-session outcomes of an owner restart')`
- `it('should signal nothing when reconcile runs after a transfer and the old owner exit')`
  (transfer succeeds → owner 1 exits → concurrent + fresh-supervisor `reconcileDeadHostOrphans`: zero signals to transferred pgids, sessions still answer input — D23)
- `it('should signal nothing when a reconcile snapshot taken before transfer resumes after it')`
  (suspended pass: snapshot + owner-dead verdict obtained pre-transfer, reap attempted post-commit/post-exit; owner+epoch re-check refuses the kill — the stale-snapshot race of §2)
- `it('should not prune a transferred session row from the old owner cleanup paths')`
- `it('should serve a queued connection on the same inode after owner succession and a frontend SIGKILL')`
  (the D24 gate, in order: full transfer → owner 1 exit → frontend `SIGKILL` → replacement frontend → connection queued during the outage served, same listening inode, `.owner` naming owner 2, published pathname never unlinked)
- `it('should keep owner 1 alive and report deferred when keeper succession fails')`

Allowed files:

- `packages/h2a-runtime/src/native-terminal/supervisor.ts`
- `packages/h2a-runtime/src/native-terminal/owner-process.ts`
- `packages/h2a-runtime/src/native-terminal/frontend-process.ts`
- `packages/h2a-runtime/src/native-terminal/batch-transfer.ts`
- `packages/h2a-runtime/src/native-terminal/host.ts` (reaper owner+epoch re-check + prune compare only)
- `packages/h2a-runtime/src/native-terminal/server.ts` (keeper re-stamp / listener-copy hand-off only)
- `packages/h2a-runtime/src/native-terminal/socket-path.ts`
- `packages/h2a-runtime/src/native-terminal/journal.ts`
- `packages/h2a-runtime/src/native-terminal/owner-restart.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/durable-ownership.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/supervisor.test.ts`
- `packages/h2a-runtime/src/native-terminal/host.test.ts`
- `packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts`

Forbidden: standing two-owner admission (that is O1), `client.ts` API
breaks, MCP code, auto-triggering an owner restart without an explicit
upgrade request (trigger policy is proposition, not validated), weakening
any pre-existing reconcile refusal (the owner+epoch check only *adds*
refusals), unlinking the published pathname during succession (D24).

Gate: targeted runs red-before/green-after; Linux set = both new files +
`supervisor.test.ts` + `host.test.ts`; macOS set (after BM) = same on
BM's workflow; B2/B4 files (`owner-frontend.functional.test.ts`,
`upgrade-pty-contract.test.ts`) still green on their platform sets.

#### Lot L5 — Faults, load, soak, N↔N+1, real-agent qualification of Phase L

Purpose: close, or explicitly bound, everything spike2 left open before
any product claim: crash windows, saturation, large writes, complex
terminal traffic, scale, duration, version skew, real CLIs. Every file,
scenario and command is named here in advance (same rule as B5).

RED/characterization tests first (new files `packages/h2a-runtime/src/native-terminal/batch-faults.functional.test.ts`, `packages/h2a-runtime/src/native-terminal/batch-load.functional.test.ts`, `packages/h2a-runtime/src/native-terminal/phase-l-agent-qualification.functional.test.ts`):

- `it('should leave a session owned by exactly one owner or confined after a crash at each batch step')`
  (fault injection at freeze/offer/prepare/CAS/COMMIT/sender-close; D10 wording is the assertion — no exactly-once past it; includes coordinator crash and receiver crash *at* commit)
- `it('should keep input order under saturated masters during a move')` (large writes, back-pressure; D26 frontier asserted byte-exact)
- `it('should move sessions under UTF-8, ANSI and TUI redraw traffic without corruption')`
  (includes a sequence split **across** the freeze point, D22 parser state)
- `it('should complete an owner restart at the qualified session ceiling')`
  (ceiling = proposition, not validated; the lot measures and reports the largest green value, starting from today's 256-session cap as the value to test, not to assume)
- `it('should transfer between N and N+1 owner builds in both directions')`
  (snapshot + owner-protocol compat window, D16; an out-of-window peer fails closed before freeze)
- `it('should survive a soak run of repeated owner restarts without FD or process leaks')`
  (duration/repetitions = proposition, not validated, stated in the lot report before the run; leak assertion = FD table + spawned-PID inventory back to baseline)
- `it('should preserve an interactive shell session across an owner restart')`
  (Bash/readline, `stty size` after post-move resize)
- `it('should preserve a scripted agent conversation across an owner restart with in-flight writes')`
  (numbered inputs exact; D21 frontier continuous across the move)
- `it('should preserve an enrolled real CLI session across an owner restart')`
  (table-driven per enrolled CLI, isolated HOME; same rule as B5: no green run, no claim; zero enrolled = qualification incomplete, not skipped-green)

Allowed files:

- `packages/h2a-runtime/src/native-terminal/batch-faults.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/batch-load.functional.test.ts` (new)
- `packages/h2a-runtime/src/native-terminal/phase-l-agent-qualification.functional.test.ts` (new)
- Fault-fix amendments only, each landing with its own red-before/green-after pair in the files above and named in the lot report *before* the fix commit: `packages/h2a-runtime/src/native-terminal/batch-transfer.ts`, `packages/h2a-runtime/src/native-terminal/transfer-snapshot.ts`, `packages/h2a-runtime/src/native-terminal/host.ts`, `packages/h2a-runtime/src/native-terminal/native/pty-fd-addon.c`, `packages/h2a-runtime/src/native-terminal/native/guardian.c`, `packages/h2a-runtime/src/native-terminal/owner-protocol.ts`. No other file without a spec amendment.

Forbidden: raising D19 bounds, the session ceiling, or any guarantee
wording (D10) to make a red test pass; long soak on the owner's real
machine/state (temp dirs + CI only); full-suite runs (conductor's); any
new qualification file beyond the three named (amend first).

Gate: all named files green, `skipped: 0` per platform set (Linux set =
three new files; macOS set = three new files on BM's workflow, macOS
ARM64); a written limits table (measured ceiling, batch bound, queue
bound, prepare timeout, soak length) in the lot report replaces every
proposition number it measured. **Phase L is done per platform** only
when that platform's L5 gate is green (same separate-verdict rule as B5).

### Optional lot O1 — two standing PTY owners (explicitly optional)

**Not validated. Do not start without a new explicit owner decision**
revising H2 (D2). The owner's verbatim asks whether two owners are
possible (`voire prevoir d en avoir 2 - possible ?`); the validated
answer delivered by Phase L is "two owners transiently, during a
batched handover". A standing pair (both admitting new sessions,
indefinitely) is a different product: per-owner quotas, routing policy
for new sessions, two owner lifecycles to upgrade/drain, two keepers or
a shared keeper (D24 generalisation), doubled failure surface. None of
that was asked to be built.

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

Same *contract*, **different product mechanisms**, per-platform gates
(D27). Spike-proven primitive differences are listed as such; everything
in the "Product substrate" half is lot BM's work and is **unproven until
BM is green** — v1 presented the two halves as one qualified whole.

Bench primitives (spike2, proven on both OSes; product lots re-prove them):

| Concern | Linux | macOS |
|---|---|---|
| FD transfer | Unix `SOCK_DGRAM` + `sendmsg`/`recvmsg` + `SCM_RIGHTS` | Same mechanism (`SCM_RIGHTS` present); datagram peer close can yield `ECONNRESET` and must be handled as closure (spike2 fix `8104a9ba7`) |
| Parentage / reaping | Guardian = real parent, `waitpid` there; receiver gets `ECHILD` | Identical; no `prctl`, no `PDEATHSIG`, no subreaper exists to lean on |
| Orphaned guardian reaping | Product: guardian exits after status ACK or last-owner EOF; reaping of an orphaned guardian itself relies on init. The spike's subreaper was **test-only** (container PID 1). Product lots must not require a subreaper. | `launchd` reaps orphaned guardians |
| Owner-death observation | Node child `exit` event in the bench; product equivalent pinned in L4 | `kqueue` / `EVFILT_PROC` / `NOTE_EXIT`; informational only — confinement still comes from status-channel EOF (D7), never from the death notice alone |
| Native headers/APIs | `pty.h`, `close_range` (loop fall-back) | `util.h`, full FD close loop, `fcntl` for `CLOEXEC`/non-blocking (no socket type flags, no `MSG_CMSG_CLOEXEC`) |

Product substrate (today = Linux only, §2; lot BM ports or refuses each):

| Concern | Linux today (origin/main) | macOS requirement (BM) |
|---|---|---|
| Publication lock | Abstract-socket listener (`\0h2a-terminal-lock-…`); non-Linux throws | Equivalent mutual exclusion + lock-id file semantics without abstract sockets; same coded refusals |
| Endpoint absence / active-host attribution | `/proc/<pid>/stat\|cmdline\|fd`, `/proc/net/unix`, staged-name grammar | Positive-evidence-only equivalent (mechanism = BM proposition); unreadable ⇒ `unknown` ⇒ refuse, never "absent" |
| Process identity frame | `/proc` start time, pid-namespace inode, boot id, machine id (`proc-identity.ts`) | Start-time/recycling discriminant + boot/machine equivalents, or explicit per-proof refusals where no equivalent exists |
| Reaper group probes | `/proc` census, environ token scan, zombie census | Equivalent census/membership proofs or stated tested reductions; no silent weakening |
| Legacy spawn containment | `setpriv --pdeathsig` + bash guardian | BM-stated floor (equivalent confinement or fail-closed refusal to start); guardian-v2 (L1) supersedes for new sessions |
| Socket path budget | 107 bytes (existing `socket-path.ts`) | 103 bytes (existing) |
| Qualified matrix | Linux + Node 22/24 (existing CI, `ubuntu-latest`) | macOS ARM64 + Node 22/24 **via BM's workflow only**. Intel macOS and older macOS: **not qualified** — claim nothing until a CI cell exists |
| Answer to "on Mac, how?" | — | Same design as Linux: guardian stays parent, masters move by `SCM_RIGHTS` in batches, death watched by `kqueue`, confinement by channel EOF — **plus** the BM substrate port above, without which the product cannot even publish its socket on macOS today. No macOS-specific fork of the *protocol*; the fork, where unavoidable, is in proof mechanisms and is enumerated by BM. |

Windows/ConPTY: excluded (D11).

## 7. Failure isolation and rollback

Phase B:

- Frontend crash/`SIGKILL`: queued client connections survive in the
  preserved listener backlog; a replacement frontend serves the same
  owner; sessions, leases, replay, **D21 frontiers and dedup state** are
  owner-side and untouched (B2/B3 tests). A write in flight at the crash
  resolves by D21: re-sent under its original identity after reconnect,
  applied iff above the frontier, duplicate-ACKed iff at/below it — the
  CLI sees it exactly once (B3 cut-point tests). On a non-D21 peer the
  chunk is dropped with the existing warning and nothing stronger is
  claimed. Rollback of a bad frontend = start the previous compatible
  **B** frontend **from its retained install** (D28); the owner is never
  part of the rollback (B4 tests).
- Owner crash: containment as today — its CLI groups are killed, no
  orphans, durable pgid rows let a later start reconcile/prove absence
  (existing `server.ts`/`supervisor.ts` proofs, preserved; on macOS the
  BM equivalents). Phase B does **not** make sessions survive owner
  death; only Phase L's *planned* restart moves them first. An owner
  crash with live sessions remains a collective loss for those sessions
  — stated, not hidden (dossier §3). D21 does not change this: frontiers
  die with the owner.

Phase L, per batch (D8/D9/D10/D25/D26):

| Failure point | Required outcome |
|---|---|
| Receiver rejects at prepare; `sendmsg` fails (`EBADF`, …); malformed/oversized snapshot; D23 CAS failure — all before the commit point (D25b) | Batch rolls back to sender; receiver closes staged FDs and discards staged snapshots; sender-held queued inputs drain to the sender **in order** before the route reopens; attached clients keep lease + cursor (D22 rollback test); other batches/owners unaffected; batch retryable. |
| Prepare timeout (product mechanism, D9/D25d) | Same abort as above. A `PREPARED` arriving after the abort is stale (batch epoch) and discarded; it must not resurrect the batch or close anything (L3 test). |
| Duplicate or out-of-epoch `COMMIT`/`ABORT` | Discarded with a typed/logged outcome; no double-close, no double-publish, no second epoch bump (L3 test). |
| Write exceeding the queue bound during freeze/prepare or during rollback drain | Not ACKed, not truncated (D26): typed backpressure + frontier to the client, which retries under the original sequence numbers after reopen/drain; final CLI byte stream exact, once, in order (L3 tests, incl. saturated master). |
| CLI exits before/during/after move | Guardian holds the exact status until ACK by whichever owner currently holds the channel; delivered exactly once to the product, **including when the status line is split across the freeze point** (D22 test). |
| Coordinator/frontend dies before commit, queue non-empty | No ACKed byte is lost (custody, D25a): the batch aborts on timeout, the **sender** drains its own queue in order, sessions stay with the sender (L3 + L4 tests). §7 of v1 promised this restitution while allowing the queues to live solely in the (mortal) coordinator — v2 fixes the custody so the promise is implementable. Un-ACKed bytes held only by the dead coordinator are the client's to re-send under D21 identities; they were never ACKed. |
| Reconcile/supervisor activity concurrent with transfer or after sender exit | No signal to any transferred group: post-commit rows name the live owner 2 (+epoch), and a stale pre-transfer snapshot is refused at kill time by the owner+epoch re-check (D23, L4 tests). The sender's own cleanups compare-and-delete on owner+epoch and therefore prune nothing transferred. |
| Keeper succession failure (D24 step 1–3) | Owner 1 does **not** exit; owner restart reported deferred with the failing step; endpoint, pathname and backlog untouched throughout. |
| Sender or receiver crashes **at/after** the commit point; machine crash | **Not exactly-once.** Required floor (L5 fault tests): each session ends owned by exactly one owner **or** confined by its guardian (last-owner EOF); never two readers on one master; the outcome is reported per session, never as silent success. Anything stronger needs a durable-journal design that is proposition, not validated (L3 amendment path). |
| Old owner asked to exit while non-empty (legacy/draining sessions remain) | Refused/deferred and reported as deferred with the blocking session count (L4 test); sessions are never force-migrated or killed to empty an owner. |
| Guardian crashes | Its CLI loses its parent: NOT covered beyond existing group containment on terminal HUP (spike2 limit). The guardian binary itself is only upgraded for **new** sessions; a running guardian stays as-is until its CLI ends (dossier common limit). |
| Descendants escaping the CLI process group | NOT covered (spike2 limit), same as today. |

Rollback of the EVOL itself — **two different operations** (D28; v1 §7
conflated them):

1. **Frontend rollback within B:** start the previous B-compatible
   frontend from its retained install against the live owner (B4).
   Available at any time; sessions unaffected.
2. **Abandoning B (return to the pre-B fused host):** the fused binary
   has no owner protocol and **cannot adopt a live B owner** — keeping
   client protocol v1 does not change that. Abandoning B requires: stop
   admitting new B sessions, let the B owner drain to empty (sessions
   end naturally, D5), withdraw its endpoint, then start the fused host.
   With live B sessions the fused start is refused/deferred (B4 test).
   The B-capable build is retained (D28) until the last B session ends.
   Symmetrically, abandoning L after B = B stands alone (owner replaced
   only by drain, as in B); sessions born under guardian-v2/fd-backend
   drain on their owner and are never force-migrated back. No lot removes
   the previous path before its replacement's gate is green.

## 8. What is NOT covered

Carried from the inputs and the v2 re-verification; nothing here may be
claimed until a named lot above turns it green — and several items stay
uncovered even then:

- Exactly-once delivery across a crash at/after the batch commit point
  (D25b), across a Phase-B owner crash, disk-level recovery of an
  interrupted owner restart, machine crash / reboot continuity (sessions
  do not survive reboot; never promised).
- Exactly-once in-flight delivery on any non-D21 (v1-only) peer: there
  the existing drop-with-warning behaviour remains (D21).
- Live migration of sessions born before guardian-v2 (incl. all `lf1`
  and all Phase-B-era sessions): drain only (D5).
- Adopting a live B owner with a pre-B fused host (impossible by
  construction; abandon-B is drain-then-switch, D28/§7).
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
- macOS product behaviour of any kind before lot BM is green; after BM,
  any macOS behaviour whose proof BM could only refuse (enumerated in
  BM's report), and any lot whose macOS set is not-run (stated per lot).
  The spike's macOS green covers bench primitives only (§6).
- MCP-HANDOVER (separate workstream, D14); update scheduling/policy
  (when upgrades trigger); any new UI. The `h2a upgrade` **command
  surface itself exists** (§2) — what B4 adds is its PTY-safe,
  retentive behaviour, not the command.
- Windows/ConPTY; Intel macOS; older macOS; Node < 22.
- Two standing PTY owners (O1) — optional, unvalidated, unestimated.
- Batch bound, queue bound, prepare timeout, session ceiling,
  compat-window width, coordinator placement, snapshot wire format,
  ownership-epoch field shape, keeper FD-transfer mechanics, native
  distribution mechanism, exact new-file names: propositions, not
  validated (D16/D17/D19/D21–D27, §4, L2). Each lot report must convert
  its own propositions into tested values or carry them forward
  explicitly as still-unvalidated. Behaviour *at* the bounds (D26) and
  custody/commit rules (D25) are normative despite the numbers being open.
- Harness peer review of the spike itself was `selection-failed` (no
  consensus exists on spike code, per spike2); product lots follow the
  normal review rules of the repo, which this spec does not replace.
- Verification on the owner's real machine/state, full-suite runs, and
  version attribution: conductor/owner steps, outside every lot.

## 9. Lot summary and re-estimated effort [v2]

Why the numbers moved: v1 carried spike2's estimates unchanged. The two
reviews + code re-verification proved seven bodies of work those numbers
had not priced. The table below re-derives per-lot ranges (agent-hours,
code+tests+review+fixes, spike time excluded) and shows the delta cause
per lot. Ranges are author estimates, **not validated**, to be
recalibrated after B1 and again after BM (the two largest unknowns).

| Lot | One-line outcome | v1/spike2 (h) | v2 (h) | Delta cause |
|---|---|---:|---:|---|
| B1 | Owner boundary + versioned internal protocol + D21 seam | 6–10 (shared) | 8–14 | Write-identity/frontier carried from day one (D21 seam) |
| B2 | Owner/frontend split, preserved listener, lifecycle, code identities | 12–20 | 14–22 | Loaded-version + code-identity recording for retention (D28 input) |
| BM **[new]** | macOS substrate port (publication, identity, reaper probes, containment floor) + ARM64 CI | — (counted as given) | 16–28 | §2: abstract sockets + `/proc` proofs + no CI cell — none of it existed (D27) |
| B3 | Continuity across frontend swap **incl. in-flight ACK/dedup + lease resume** | 10–18 | 16–26 | D21 end-to-end + 3 cut-point byte-exact proofs; v1 assumed the listener sufficed |
| B4 | Existing `h2a upgrade` made PTY-safe + **install retention** + two rollbacks | 8–14 | 14–22 | Real `performAutoUpgrade` on both paths; prev-dir deletion must become retention (D28); cross-package |
| B5 | `lf1` drain + named agent qualification, per-platform verdicts | 12–20 | 14–22 | Qualification files/scenarios now closed in advance; dual-platform gate |
| **Phase B total** | Sessions survive h2a/frontend upgrade | **48–82** | **82–134** (Linux-only subset: 66–106 excl. BM) | 5–8 review rounds (v1: 4–6) |
| L1 | Guardian v2 + status channel until ACK | 8–14 | 10–16 | Closed native file list + Python-free build plumbing (D13) |
| L2 | Native FD backend + distribution + security | 12–20 | 14–22 | Clean-build/no-Python proof + distribution statement now gated |
| L3 | Batch transaction **+ D22 snapshot/lease translation + D25 custody/state machine + D26 backpressure + D23 CAS** | 16–28 | 26–42 | Largest delta: v1 moved 2 FDs; the product moves replay, parsers, leases, frontiers, partial writes/statuses — and must survive coordinator death |
| L4 | On-demand owner 2, admission, routing **+ D23 reaper fence + D24 keeper succession** + owner restart | 6–10 | 14–22 | Two mechanisms v1 omitted entirely; stale-snapshot and same-inode-after-succession proofs |
| L5 | Faults/load/soak, N↔N+1, real agents (Phase L gate, per platform) | 12–22 | 14–24 | Commit-point crash matrix + split-sequence/partial-write fault cases from D22/D25 |
| **Phase L supplement** | Sessions survive PTY-owner restart, in batches | **54–94** | **78–126** | 5–8 more review rounds (v1: 4–7) |
| **B + L total** | Owner's goal, §0 items 1–2 | **102–176** (8–13 rounds) | **160–260** (10–16 rounds) | Scope proved larger in code, §2; not padding — each delta names its mechanism above |
| O1 (optional) | Two standing owners — new owner decision required | not estimated | not estimated | unchanged |

Reading guidance: B-Linux alone (B1+B2+B3+B4+B5 Linux sets) is the
66–106 h subset and is independently shippable; BM (16–28 h) buys every
macOS claim and nothing else — deferring BM defers macOS, it does not
cheapen Linux. L3 remains the risk centre: if its design-time choices
(coordinator placement, snapshot format, timeout/bounds) slip, both L3
and L5 grow; the ranges assume the D25/D26 rules in this spec are
accepted as written. No figure here is a calendar deadline or an owner
commitment (D20).
