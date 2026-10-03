# Native host generations: phase A qualification

Owner decision: 2026-10-03, architecture (a), phase A only. Base for this
implementation: `f18cf3ae`, with the L0/L1 commits already present.

## Commits

- `824aa172`: native generation selection, fleet inventory/owner resolution,
  creation admission, guard ownership, restore and PTY actuator routing.
- `880f612b`: isolated historical fleet and MCP qualification; L0 is now
  blocking and GREEN, with no pending TODO marker.
- `3cb5948d`: fix the sole full-gate blocker by making the loop boundary
  fixture a sibling durable workspace inside the writable worktree, with the
  controller directory as its explicit boundary. No production change.
- `b35b138`: explicitly qualify stop and incarnation-stop aliases on both
  real endpoints, including duplicate-owner refusals.

## Behavior and limits

The historical socket remains `native-terminal.sock`. Automatic fenced
launches retain a historical host that reports `launchFence:true`; otherwise
the same supervisor starts/adopts `native-terminal.lf1.sock`. The selected
host must advertise the fence at handshake. Both directories/sockets retain
the existing 0700/0600, uid, AF_UNIX-length and identity checks. Selection
never stops or signals the historical host.

Canonical explicit endpoints still participate in the sibling inventory but
constrain launch selection. An incompatible imposed endpoint returns the L1
capability certificate without redirecting or creating a session. A custom,
noncanonical explicit socket remains a bounded single endpoint. No global
filesystem scan or discovery of additional socket names is introduced.

Inventory returns each session with its `socketPath`, retains duplicate names
and marks `complete:false` for unreachable endpoints. A sole observed owner
can be used even with an incomplete inventory; no observed owner plus an
unreachable endpoint is unknown. Duplicate owners return `ambiguous-owner`.
Each native operation retains its selected client; attach reconnects retain
the socket and repeat private-resource/handshake checks. Prompt delivery and
the PTY actuator retain the same socket from probe through write.

Admission checks both agent and companion names before the create marker,
then checks again before the host receives create. Active/stopping records
reserve names on either endpoint. Exited records on another endpoint also
reserve names, preventing a new session from becoming ambiguous immediately.
An exited record on the selected host can be replaced using that host's
existing incarnation/containment protections. Registry format and location
remain unchanged.

Known limits are intentional for phase A:

- A non-migrated producer creating directly on the historical host after
  admission is not covered; it can introduce a duplicate and overwrite a
  same-name containment row. There is no cross-host server reservation.
- Discovery is limited to the two known canonical endpoints. Durable fleet
  catalog, global admission, endpoint retirement/migration and full session
  identity persistence remain phase B.
- MCP name idempotence remains local to one launcher process, not durable
  across independent MCP servers or restarts.
- Unreachable known endpoints block absent-name creation/recovery. Only a
  cold private runtime directory can bootstrap the initial fleet; no
  unreachable historical endpoint in an initialized fleet is reclaimed.
- Older serialized guard receipts without an owner socket cannot be cleaned
  by the new guard; cleanup remains unproven rather than guessing a host.

## RED to GREEN

`phase-a-selection-red.log`, before implementation, executes L0 without TODO:

```text
# raw historical launch: {"status":1,"stdout":"","stderr":"Launch refused before creation: host legacy-ownVVW on /tmp/h2a-qual-ownVVW/h2a-nt/native-terminal.sock does not provide launchFence. No session was created by this attempt. Its existing sessions remain active. Use automatic generation selection with the corrected runtime; if this socket was explicitly imposed, remove that constraint only for the new launch. No restart of the existing host is necessary.\\n"}
# sentinel unchanged: {"pid":34,"generation":"legacy-ownVVW","incarnation":"d1d8eaf5-790d-4340-84ad-54c7c2b99e5d","io":"before/after on same connection"}
# tests 4
# pass 2
# fail 2
# skipped 0
# todo 0
```

`phase-a-routing-red.log`, before implementation:

```text
not ok 1 - should route each by-name operation to the observed owner across real historical and compatible hosts
not ok 2 - should refuse ambiguous owners without attaching, writing, driving or stopping either session
not ok 3 - should refuse agent and sidecar collisions before any containment registry write
not ok 4 - should report an incomplete inventory and unknown absence when the historical endpoint is unreachable
# pass 0
# fail 4
# skipped 0
# todo 0
```

The final real-host campaign passes the same requirements. The historical
sentinel keeps PID, generation, incarnation, status and observable before/after
I/O on the same client/controller. The compatible endpoint reports the fence;
the guard's preallocated incarnation matches the newly created session.
MCP `tools/call` launches a trivial fixture CLI through the real runtime,
returns `started`, records the compatible socket in both result and guard
receipt, and delivers one brief. A repeat with the same name and a different
brief returns the identical memorized result without another delivery.

## Routing matrix

| Operation | Historical owner | Compatible owner | Duplicate / missing owner evidence |
| --- | --- | --- | --- |
| list | Aggregated, socket retained | Aggregated, socket retained | Two same-name rows retained; incomplete inventory flagged |
| state / probe / PID | Real host GREEN | Real host GREEN | `ambiguous-owner`; unreachable without another match is unknown |
| capture | Real host GREEN | Real host GREEN | Refused on duplicate owners |
| write / paste / enter / resize | Real I/O GREEN | Real I/O GREEN | No input or controller acquired on duplicate owners |
| attach / reattach | Real attach/detach GREEN | Real attach/detach GREEN | Duplicate attach refused; recovery unit suite GREEN |
| drive | Real guarded write GREEN | Real guarded write GREEN | Duplicate drive refused; #307 functional scenario GREEN |
| PTY actuator | Real probe/drive GREEN, socket pinned | Real probe/drive GREEN, socket pinned | Unknown health, failed drive and deferred relaunch; zero relaunch calls |
| kill / stop / incarnation stop | Real owner stopped | Real owner stopped | Duplicate stop refused; guard stops only its receipt socket |
| sidecar / tree cleanup | Companion created/stopped on owner | Companion created/stopped on owner | Agent and sidecar collision certificates before registry mutation |
| restore | Live pre-fence attach preserved | Existing native restore suite GREEN | Duplicate owners / unknown absence open no restore tab |

`stop` and `stop-if-incarnation` are also exercised on real PTYs on both
endpoints and are included in the duplicate-owner refusal matrix.
Live restore retains the single-controller gate and requires no launch fence.

## Isolation and reproducibility

Legacy artifact: scratchpad `host-skew/legacy-host`, archive of `89bbd9af^`
(`dd52059c13c16a62b65b8fe9fc2736bd2b1c8b9a`), built in L0 with `npm ci`
then `npm run build`. No Python is used.

The harness constructs its environment rather than inheriting owner overrides:
private HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, REMOTE_CLI_CONFIG_HOME,
H2A_ROOT, TMPDIR, TMUX_TMPDIR, explicit socket/registry and workspace paths.
Lexical owner paths and escaping symlinks are refused before owner filesystem
access. Each fixture starts both real hosts by owned child handles, allowing
teardown without inferring ownership from a PID. Runtime selection/adoption
is exercised against that fleet; supervisor startup/containment is separately
covered by its real-process functional suite.

Representative GREEN fixture: `/tmp/h2a-qual-s0yBvu` (0700), historical
socket `h2a-nt/native-terminal.sock`, compatible socket
`h2a-nt/native-terminal.lf1.sock`, HOME `home`, workspace `workspace`, single
registry `home/.config/sentropic/h2a/registry.json`. Sentinel PID 1738,
generation `legacy-s0yBvu`, incarnation `6bc2791e-b013-4c30-aa08-4667b45918ed`;
new launch PID 1803, compatible host PID 1741, separately fenced incarnation.
All are fixture-local PIDs, not owner process identities.

Reproduce with the checked harness in ignored `tmp/host-gen-evidence/`:

```sh
rtk node tmp/host-gen-evidence/run-isolated.mjs --test packages/h2a/test/native-host-generations.test.js
```

The required-legacy flag prevents a missing artifact from silently skipping
the evidence campaign. CI still skips explicitly on non-Linux or when the
historical artifact is unavailable. No test disables those failure checks.

## Verification

- TypeScript build (`npm run build:h2a`) and `git diff --check`: passed.
- Runtime targeted campaign: 13 files, 93 passed, 1 existing platform skip.
  Includes native-terminal functional protections #298/#299/#307, supervisor,
  launch guard/ownership, native reuse and restore wiring.
- Node targeted campaign: 76 passed, zero failure/skip/TODO across historical
  generations, MCP run/async, drive, PTY actuator and outer messaging tests.
  Repeated focused runs are excluded from these distinct-test counts.
- Supplemental real-host stop-alias qualification: 2/2 passed, zero
  skip/TODO. These rerun the routing and ambiguity scenarios above and are
  excluded from the distinct-test counts.
- Exactly one full `npm test` gate was invoked after the targeted campaigns
  and an empty `pgrep -af '[v]itest|[r]un-tests|[n]ode --test'`.
  Build, Focus/vendor/import checks and Track passed. Node: 2,509 tests,
  2,464 passed, 1 failed, 23 skipped, 21 TODO. Track: 87 files,
  1,193 passed. This full gate did not return GREEN.
- Its only failure was fixture creation in the read-only parent of this
  worktree: `EROFS: read-only file system, mkdtemp
  '/home/antoinefa/src/h2a/tmp/h2a-loop-outside-XXXXXX'`, in
  `loop-launch.test.js`. The fixture now stays inside the worktree while
  retaining an actual sibling outside its explicit controller boundary.
  The entire corrected file passes 9/9 in an isolated targeted run.
  The full suite was not rerun, honoring the owner's one-full-run limit.

Raw local logs are retained in ignored `tmp/host-gen-evidence/`. No `.track`
write, owner host/session operation, push, PR, publication or tag was performed.
External consensus review was not dispatched: the installed MCP launch tool
has no verified fixture-bound runtime configuration, and using its ambient
host would violate the owner's absolute isolation requirement. The review
skill requires dispatch through that installed tool; no consensus is claimed.

Review selection receipt: ignored `tmp/host-gen-evidence/phase-a-review-selection.md`.
The exact instruction is "Launch only through the installed h2a MCP server's
`h2a_run` tool" in
`/home/antoinefa/.codex/plugins/cache/sentropic/h2a/0.98.0/skills/harness/review/SKILL.md`.
