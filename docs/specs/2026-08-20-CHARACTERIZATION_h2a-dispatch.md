# Characterization — current h2a dispatch

Date: 2026-08-20
Track item: 01M0GWVWJ40MSSSEMZNNA3S7P3
Measured tree: f02776888d4881d1c773208f7ff5b4f445405bad on
wp13/dispatch-goldens. Production source remains the fresh origin/main base
13fae66e; the measured commit only adds these tests.

This is characterization, not a behavior change. No production file changed.
The binary tests invoke node plus an isolated dist/bin.js programmatically,
never the installed h2a command. Each child gets a fresh temporary HOME,
REMOTE_CLI_CONFIG_HOME, H2A_ROOT, loader marker, and working directory. The
test removes all of them in finally. Its loader models only the optional
runtime boundary: it never resolves the user's runtime, config, bus, tmux
server, or workspace.

Test file: packages/h2a/test/dispatch-characterization-goldens.test.js.

## Positive controls

Re-checked at f02776888d4881d1c773208f7ff5b4f445405bad:

| Query | Result |
|---|---:|
| dispatchMode or dispatch_mode in packages/*/src | 0 occurrences |
| dispatch in packages/h2a/src/cli.ts | 16 occurrences |

There is no present DispatchMode schema to test. The binary authority remains
bin.ts, whose final decision is the first-token shouldDispatchRuntime(argv)
predicate.

## Binary measurements

Stdout and stderr below are byte-for-byte assertions. The common core-help
stream is 13,112 UTF-8 bytes with SHA-256
45b8ab4d2fe82095ce0246096767ceb28ff78a6b4ab5d319ad65a0f5fca90797.
The test hashes the full captured stream, not a prefix, so this is a compact
exact golden for the otherwise very large output.

| Form | Level | Exit | Stdout | Stderr | Runtime / config / session |
|---|---|---:|---|---|---|
| h2a help | binary | 0 | core-help hash above | empty | no runtime import; no config home; no session |
| h2a --help | binary | 0 | same core-help bytes | empty | no runtime import; no config home; no session |
| h2a -h | binary | 0 | same core-help bytes | empty | no runtime import; no config home; no session |
| bare h2a | binary | 0 | same core-help bytes | empty | no runtime import; no config home; no session |
| h2a run --help, runtime absent | binary | 127 | empty | h2a run: ce verbe requiert le runtime h2a (sessions / k8s / tunnel). then newline plus two-space Répare l'installation lockstep : npm i -g @sentropic/h2a@latest and newline | runtime import attempted; main not reached; no migration/session |
| h2a run -h, runtime absent | binary | 127 | empty | same exact run loader diagnostic | runtime import attempted; no migration/session |
| exact h2a run, runtime absent | binary | 127 | empty | same exact run loader diagnostic | runtime import attempted; no migration/session |
| h2a --resume, runtime absent | binary | 127 | empty | same loader diagnostic with h2a --resume prefix | runtime import attempted; no migration/session |
| h2a --root /isolated status, runtime absent | binary | 127 | empty | same loader diagnostic with h2a --root prefix | runtime import attempted; no migration/session |
| h2a --, runtime absent | binary | 127 | empty | same loader diagnostic with h2a -- prefix | runtime import attempted; no migration/session |
| h2a -hv, runtime absent | binary | 127 | empty | same loader diagnostic with h2a -hv prefix | runtime import attempted; no migration/session |
| exact h2a run, runtime API version 2 | binary | 64 | empty | h2a run: runtime incompatible — runtime CLI API 2 is incompatible; expected 1. then newline plus two-space Mets à jour l'installation lockstep : h2a upgrade and newline | runtime import attempted; dispatch not called; no migration/session |
| exact h2a run, transitive runtime module missing | binary | 127 | empty | exact same run loader diagnostic as runtime absent | direct specifier resolved, but broad ERR_MODULE_NOT_FOUND catch hides the distinction; no migration/session |

Exact stderr byte sequences used by the binary goldens:

~~~
h2a run: ce verbe requiert le runtime h2a (sessions / k8s / tunnel).
  Répare l'installation lockstep : npm i -g @sentropic/h2a@latest
~~~

~~~
h2a run: runtime incompatible — runtime CLI API 2 is incompatible; expected 1.
  Mets à jour l'installation lockstep : h2a upgrade
~~~

The same first sequence substitutes the first argv token after h2a for
--resume, --root, --, or -hv exactly as stated in the table.

The run --help and run -h rows are deliberately surprising: they are not core
help paths. With the optional runtime absent they attempt import and yield
loader exit 127 rather than help/0.

## Parser and source-trace measurements

| Surface | Level | Result |
|---|---|---|
| run, run notacli, --resume, --root /isolated status, --, -hv | bin-routing.ts parser | shouldDispatchRuntime is true for every vector |
| decision, report, accept, blocker, item, query, consolidate, priority, branch, focus, ingest, restructure, snapshot | bin-routing.ts parser | every Track facade verb is core-routed; no optional-runtime import is part of its dispatch decision |
| unknown run selector | runtime source trace | localCliCommand remains LOCAL_CLI[profile] ?? profile; the Commander run action uses that command and calls enrollFromRun after startup |
| host for a new run | runtime source trace | current default is native PTY, not tmux; --tmux remains an explicit local-tmux override |
| local-tmux wrapper | runtime source trace | LOCAL_WRAPPER ends by execing /bin/bash -l when stdin is a TTY |

## Crown-jewel status — unknown run selector

The compatible-runtime, end-to-end h2a run notacli form is uncharacterized at
binary level. It was not run: the current worktree cannot compile/load a
compatible runtime safely. npm run build:h2a fails before emitting
packages/h2a-runtime/dist/index.js because the installed Commander, llm-mesh,
and llm-gateway dependencies do not match the source tree. A fake runtime
would not honestly establish Commander launch behavior. Running the installed
runtime against the real user environment was prohibited because main()
migrates config home before parsing.

The closest honest coverage is the source-trace golden. It proves the
unvalidated fallback and registration call, preserves the login-shell wrapper
for the explicit --tmux route, and records the current-tree surprise that new
sessions now default to native PTY. The July review's statement that a plain
unknown run creates a tmux session is therefore not re-asserted as current
default behavior. No real tmux or native session was started or left behind.

## Surprises and limits

- Bare h2a still renders core help and exits 0, contrary to the frozen
  grammar's native-bare intent.
- --resume, leading options, a terminator, and combined -hv all take the
  runtime fallback today; only their isolated missing-runtime boundary is
  executable in this checkout.
- Exit 127 is a broad module-not-found bucket: absent runtime and a runtime
  with a transitive module failure have identical stdout, stderr, and exit.
- All executed binary cases used an empty temporary config home. None created
  it, and none reached runtime main, so compatible-runtime migration remains
  uncharacterized.
- Compatible-runtime output for run help, exact run, --resume, leading
  options, --, and -hv remains uncharacterized for the same dependency-state
  reason. No fabricated result is recorded as a golden.

## Test run

Actual command:

~~~
node --test packages/h2a/test/dispatch-characterization-goldens.test.js
~~~

Actual output:

~~~
TAP version 13
# Subtest: binary golden: core help spellings stay local with the runtime absent
ok 1 - binary golden: core help spellings stay local with the runtime absent
  ---
  duration_ms: 1369.941463
  type: 'test'
  ...
# Subtest: binary golden: bare h2a remains core help with the runtime absent
ok 2 - binary golden: bare h2a remains core help with the runtime absent
  ---
  duration_ms: 422.963367
  type: 'test'
  ...
# Subtest: binary golden: run help spellings attempt the lazy runtime before help
ok 3 - binary golden: run help spellings attempt the lazy runtime before help
  ---
  duration_ms: 896.657355
  type: 'test'
  ...
# Subtest: binary golden: selector-less run and frozen --resume take the broad loader bucket
ok 4 - binary golden: selector-less run and frozen --resume take the broad loader bucket
  ---
  duration_ms: 879.878894
  type: 'test'
  ...
# Subtest: binary golden: leading options and terminators are runtime-routed
ok 5 - binary golden: leading options and terminators are runtime-routed
  ---
  duration_ms: 1268.232615
  type: 'test'
  ...
# Subtest: binary golden: loader ambiguity is pinned separately from API incompatibility
ok 6 - binary golden: loader ambiguity is pinned separately from API incompatibility
  ---
  duration_ms: 876.384628
  type: 'test'
  ...
# Subtest: parser golden: runtime routing keeps run, leading options, and terminators out of core
ok 7 - parser golden: runtime routing keeps run, leading options, and terminators out of core
  ---
  duration_ms: 200.351805
  type: 'test'
  ...
# Subtest: parser golden: every Track facade verb remains core-routed
ok 8 - parser golden: every Track facade verb remains core-routed
  ---
  duration_ms: 0.369886
  type: 'test'
  ...
# Subtest: source-trace golden: unknown run selector remains an unvalidated executable fallback
ok 9 - source-trace golden: unknown run selector remains an unvalidated executable fallback
  ---
  duration_ms: 1.148621
  type: 'test'
  ...
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 6047.930938
~~~

npm run build:h2a was also attempted and is red in this checkout because the
installed dependency set does not match this source tree, not because of this
characterization-only diff. Its real diagnostics are in the durable hand-off
report.
