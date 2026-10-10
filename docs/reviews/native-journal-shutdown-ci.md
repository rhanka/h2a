# PR #317: native journal writer shutdown

Baseline: `fd04f7c710d4bab7bf5ac67878994b7ac670d1c3`.
Product correction: `d976c537435f8dfb0302c24e6095df12e2840cf4`.
CI configuration correction: `f9db3be49134b70f79fd82574ad9ba59ea7784bf`.
Final qualification source: `6537691e5f2c007184ecc11622d49a4f6df6d324`.
Raw receipts and the repeat driver are under ignored `tmp/ci-shutdown-evidence/`.

## Cause and evidence

This is a product process leak. The independent journal writer can start its
module after its host's IPC connection has already disconnected. Node 20 keeps
`process.send` defined in that state. The old coordinator therefore starts its
I/O thread, installs a listener for a future `disconnect`, and never handles
the disconnection that already happened. The thread's MessagePort retains the
writer indefinitely. This is not a slower completion of normal teardown.

The unmodified native absence suite reproduced the CI signature under an empty
environment, plain HOME, Node 20.20.2 and one CPU: 17 passes, 8 failures,
zero skips/TODOs, 69.451 seconds. All eight survivors were actual Node journal
writer processes, state `S`, `PPid=1`, with command lines ending in
`journal.js --native-host-journal-writer <fixture-private-log>`. For example,
PID 231 belonged to `.qual-tmp/qT6JjKI`; its pinned process directory reported
12 threads and 59,132 KiB RSS after its host had exited. The other observed
writer PIDs were 1480, 2025, 2114, 2336, 2425, 2934 and 3377. Diagnostics read
only the process directories pinned by this run's fixture spawn boundary.
The same ordinary one-CPU baseline under Node 22.22.1 passed all 25 tests in
85.994 seconds; natural scheduling did not trigger the race there.

A focused trace on the stale-SIGKILL case records, for the leaked writer:

```json
{"phase":"preload","pid":32,"ppid":1,"connected":false,"send":"function","handles":[]}
{"phase":"entry","pid":32,"ppid":1,"connected":false,"send":"function","handles":[]}
{"phase":"handler-install","pid":32,"ppid":1,"connected":false,"send":"function","handles":["MessagePort"]}
```

No subsequent disconnect or exit was observed for that writer. Other writers
in the same fixture booted connected, received disconnect, and exited.
Receipts: `baseline-node20.log`, `baseline-node20-processes.json`,
`baseline-node22.log`, `ipc-node20.log`; the trace is in
`.qual-tmp/qoDePOT/ipc-trace.jsonl`.

The regression forces disconnect before importing the coordinator while a
MessageChannel keeps the test child alive through module evaluation. It waits
for an IPC readiness message, disconnects the owned ChildProcess, and waits for
its `exit` event with the existing one-second survival budget. Before the fix,
the exit wait failed under both Node 20 and 22. The Node 20 initial RED also
exposed a `close`-event cleanup wait; IPC fixtures now observe `exit` directly.
Receipts: `regression-node20-red.log`, `regression-node22-red.log`.

## Correction

The writer registers one idempotent EOF drain and also applies it when
`process.connected` is already false. The existing 100 ms journal drain stays
unchanged; it stops the writer process and its I/O thread even when EOF preceded
JavaScript module initialization. Host startup errors now await the same bounded
journal flush used on clean shutdown, so the writer has a chance to acknowledge
the startup observation before the host exits. No journal I/O is moved onto the
host thread.

The writer remains independent to record actual fatal/exit observations. A host
killed with SIGKILL cannot execute an asynchronous join: its child's bounded EOF
drain is the recovery path. This change fixes that path without manufacturing a
host signal or an exit event. The native absence fixture's one-second assertion,
process-state predicate and process ownership boundary are unchanged.

The journal's injected crash/explicit-exit fixtures now acknowledge installation
of their SIGUSR1 handlers before the test signals them. Native host readiness is
emitted before the wrapper installs those handlers; it cannot serve as their
readiness event. These fixtures and the new regression wait on observed IPC/exit
events, not elapsed sleeps. The complete journal suite has 25 passing tests.

## Independent Node 22 CI failure

The original CI run has eight native absence failures in Node 20. Its Node 22
job passed `npm test` and the native terminal step, then failed collecting the
llm-gateway app tests: the inherited root Vitest setup path was resolved relative
to `apps/llm-gateway`, yielding a nonexistent
`apps/llm-gateway/packages/h2a-runtime/vitest.native-isolation.mjs`.

Resolving the setup URL relative to `vitest.config.mjs` fixes collection from
both repository and workspace invocation directories. The exact workspace
command reproduced RED, then passed both files / all 5 tests after the change.
Local validation used the lockfile's `@sentropic/llm-gateway@0.19.1` package,
with the downloaded tarball's SHA-512 matching both lockfile integrity entries.
The workspace had otherwise fallen through to a shared ancestor's 0.10.0 copy;
that ancestor was not modified. Receipts: `gateway-node22-red.log`,
`gateway-node22-green.log`, `gateway-pack.log`.

## Repeated qualification

The first extended campaign stopped on the unchanged historical host's staging
socket limit: a four-digit PID made the lf1 staging path 108 bytes, over the
107-byte Unix limit. Shortening the fixture directory exposed another fixture
constraint: the test process keeps its process-view identity map after removing
the directory, so a randomly repeated short name reused a removed view. The
second campaign stopped on that ENOENT; a separate two-lifetime reproduction
confirmed it (`short-root-reuse-red.log`). These attempts are preserved in
`attempt1/` and `attempt2/` and excluded from the final consecutive-run table.

The third campaign stopped on a distinct Node 22 graceful-shutdown assertion:
the host exited by SIGTERM instead of exit code zero. No orphan assertion
failed. Signal traces did not reproduce it. The fourth campaign was stopped
at a suite boundary to investigate the startup window and is also excluded.

The server publishes its socket and can accept health/PTY requests while it
still awaits the owner-record rename and publication-lock cleanup. Previously,
the host installed its termination handlers only after that entire startup
promise resolved. A deterministic IPC barrier before the owner-record rename
proves that ping already succeeds but SIGTERM still exits by the default signal
action. The regression reproduces the same `{code: null, signal: "SIGTERM"}`
under both Node versions (`publication-node20-red.log` and
`publication-node22-red.log`). No sleep chooses the signal timing.

The host now installs its handlers before that asynchronous publication window.
Shutdown awaits publication and follows the existing server/PTY drain, forced
group termination and journal flush. It does not emit ready after a shutdown
request. The regression observes the actual signal event through IPC, releases
publication, waits for the ChildProcess exit event, and verifies exit zero and
socket removal. The original stubborn-PTY shutdown test remains unchanged.

The same window also caused a Node 22 competing-supervisor preflight to kill a
health-checked host before its owner record existed; replacement correctly
refused unproven stale-socket reclamation. Connections are now paused until
publication, owner-record persistence and lock cleanup finish. Health/PTY
requests can no longer succeed before that point. The combined journal,
process and server suites passed all 60 tests on one CPU under Node 22.

One preflight journal run timed out in the explicit-exit scenario. The fixture's
exit event now has a one-second deadline and reports its captured output on
failure; its journal/exit assertions remain strict. Twenty focused repetitions,
five full journal suites and the subsequent combined shutdown checks passed.
The original timeout is retained in the preflight receipt and is not counted
toward the ten consecutive campaigns.

The fifth campaign caught a separate teardown race in the restore scenario:
the detached host itself was still alive, state `D`, and its writer still had
that host as parent. A focused one-CPU reproduction failed on repetition 15
with host PID 4035 and writer PID 4046 (`restore-survivor-15.log`). This differs
from the original eight orphan writers whose parent was already PID 1.
`host-stop` returns immediately after sending SIGTERM; it does not join the
host. The fixture had started its one-second no-survivor check after that
signal acknowledgement. A syscall trace also records a registry rename taking
5.973618 seconds on this checkout's ext4 storage, explaining slow create/stop
progress independently of the IPC writer defect.

Detached fixture hosts now atomically record their actual Node `exit` event in
their own private directory. Teardown observes the receipt through `fs.watch`,
with a three-second exit deadline, then runs the unchanged one-second
no-survivor assertion. Direct fixture children still use ChildProcess `exit`.
No elapsed sleep substitutes for an exit observation. Twenty focused restore
repetitions passed on two CPUs after this correction. The fixture receipt does
not require a new exit-code contract; the functional shutdown tests retain
their existing exit-zero assertions. A preflight receipt also recorded a late
uncaught diagnostic write after clean stop (`.qual-tmp/qCGzDrx`); it was outside
the no-survivor contract and was not suppressed or relabelled.

The final complete 25-test absence suite also passed without skips/TODOs on one
CPU: Node 20 in 60.659 seconds and Node 22 in 88.005 seconds. Receipts:
`absence-final-node20-onecpu.log` and `absence-final-node22-onecpu.log`.

The sixth campaign completed every test assertion, then failed the Node 22
runtime afterAll with EACCES in a pinned process directory. Instrumenting only
the fixture spawn boundary identified that PID as the owned Node parent used
to create a zombie, not an unrelated machine process or the detached C fixture.
The host test's afterEach sent SIGKILL and immediately continued; the pinned
directory remained until ChildProcess emitted exit. That interval can expose
EACCES after the process dies. EACCES remains an error, never evidence of absence.
The cleanup now awaits the owned exit event with a three-second deadline and
uses negative process-group signals only for children it launched detached.
All 20 focused full host-test runs passed after the correction (53 passes and
one existing skip each). Receipts: `host-owned-spawn-red.log`,
`zl-full-red-1.log`, `host-exit-green-1.log` through `host-exit-green-20.log`.
The sixth attempt is preserved in `attempt6/` and excluded from the final count.

Historical fixtures now allocate guarded, private, three-character directory
names without reuse in the running test process. Exclusive mkdir skips an
existing directory without adopting or deleting it. Parent and candidate paths
are guarded before mutation. A seven-digit Linux PID still fits exactly within
107 bytes for the historical lf1 staging name. The historical source, endpoint
basenames and fixture process-survival assertion remain unchanged.

The driver starts each suite with only PATH, an empty plain HOME and the required
private legacy-build selectors. Suites provision their own HOME/XDG/socket
fixtures under this checkout's guarded `.qual-tmp`. Node versions are 20.20.2
and 22.22.1. Baseline, deterministic regressions and the final complete absence
checks use CPU 0; the ten consecutive full campaigns use CPUs 0,1. Node file
concurrency and Vitest worker count are one. All campaigns run sequentially.

Each round includes eight Node files (absence, generations, isolation, process
view, spawn guard, native PTY messaging, M02 and M04) and all fourteen native
terminal runtime files plus CLI index and conversation guard wiring. It includes
the four-file native CI step and the journal regression. Per successful round:
70 Node passes, zero failures/skips and 12 existing TODOs; 296 runtime passes,
zero failures and 2 existing policy/environment skips.

The exact file lists, source SHA-256 values, commands, exit codes and summaries
are in `repeat-plan.json`, `repeat.mjs`, `repeat-results.jsonl` and the per-suite
logs. The table and final CI receipt will be completed after qualification.
