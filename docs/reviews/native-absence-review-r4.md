# Native absence review R4 corrections

Target reviewed: `911f40ec`; findings: R4-F01 and R4-F02 from `review-sol4.md`.
One commit per finding. Receipts: `.qual-tmp/builder/evidence/r4-*`.

## R4-F01: self-provisioning native fixtures

The Node PTY/M02/M04 suites and nine runtime suites required a private
HOME/XDG/socket environment at import, but ordinary npm and CI runners did
not create one. The private qualification launcher concealed this collection
failure. Each affected suite now calls `setupNativeTestEnvironment` before
using native fixtures. It creates a fresh guarded root under this checkout's
`.qual-tmp`, installs the complete private environment, waits for its owned
processes at suite teardown, removes its root and restores the caller's env.
Inherited tmux and journal overrides are replaced with private fixture values.

The existing path, symlink, native spawn and process-view guards are unchanged.
No production code, runtime entry point, Node runner or CI command is changed.
The regression starts with owner paths as lexical canaries and verifies private
provisioning, complete environment restoration and directory removal. Those
owner paths are never used for filesystem access or native operations.

### RED before implementation

Commands start with only `PATH=/usr/bin:/bin` and a different HOME,
`$PWD/.qual-tmp/r4-ci-home`; no native isolation variables are supplied.

```sh
env -i PATH=/usr/bin:/bin HOME="$PWD/.qual-tmp/r4-ci-home" \
  node --test --test-concurrency=1 --test-name-pattern='^R4_COLLECTION_ONLY$' \
  packages/h2a/test/pty-native-messaging.test.js \
  packages/h2a/test/m02-drive-characterization.test.js \
  packages/h2a/test/m04-wake-characterization.test.js
```

`r4-f01-node-red.log`: 0 passes, 3 failures; each import throws
`REFUSING missing or relative isolation variable: XDG_RUNTIME_DIR`.
`r4-f01-fixture-red.log`: 3 passes, 1 failure before the setup helper existed.

The same four files as CI, with `--configLoader native --maxWorkers=1
--no-file-parallelism` for the RED, produce 3 failed suites and 7 replay-buffer
passes (`r4-f01-ci-import-red.log`). A preceding default-config invocation
hit EROFS because node_modules pointed at another worktree; its receipt is
`r4-f01-ci-red.log`. Qualification then copied dependencies into this worktree,
preserving workspace links to its own packages. No shared cache was mutated.

### GREEN from the ordinary environment

The identical Node command without the name filter runs all PTY/M02/M04 bodies:
21 passes, 0 failures/skips, 12 existing TODOs (`r4-f01-node-green.log`).
The isolation, spawn-guard and process-view suites pass all 11 tests, without
failures/skips/TODOs (`r4-f01-guards-green.log`). `npm run build` also passes.

The exact native step from `.github/workflows/ci.yml`, without extra flags:

```sh
env -i PATH=/usr/bin:/bin HOME="$PWD/.qual-tmp/r4-ci-home" \
  npx --no-install vitest run \
  packages/h2a-runtime/src/native-terminal/replay-buffer.test.ts \
  packages/h2a-runtime/src/native-terminal/host.test.ts \
  packages/h2a-runtime/src/native-terminal/server.test.ts \
  packages/h2a-runtime/src/native-terminal/process.functional.test.ts
```

`r4-f01-ci-green.log`: 4 passed files, 94 passes, 0 failures, 1 existing
environment skip (no root-owned process group yielding EPERM to the liveness
probe). No private launcher, custom config, preload or XDG/socket env is needed.

The other six modified runtime suites (client, supervisor, drive, terminal modes,
CLI index and conversation guard) run with the same ordinary environment and
`--maxWorkers=1 --no-file-parallelism`: 150 passes, 0 failures, 1 existing skipped
supervisor policy case (`r4-f01-runtime-green.log`). Thus all twelve suites
previously validating the inherited environment at import are covered.

### Ordinary npm runner and final-SHA protocol

The initial full-root attempt was:

```sh
env -i PATH=/usr/bin:/bin HOME="$PWD/.qual-tmp/r4-ci-home" \
  H2A_MCP_TEST_N=2 taskset -c 0 npm test
```

The runner discovered 279 Node files and 87 Track/Vitest files. With one CPU,
the Node campaign reached its unchanged 600,000 ms backstop after 2,334 displayed
test results (`r4-f01-npm-plain.log`); this is not a full-root passing result.
Track completed with all 87 files and 1,193 tests passing; the gate exits 124.

Final-SHA collection uses the maintained npm/Node runner, a different HOME
outside `.qual-tmp`, and Node's supported name filter:

```sh
env -i PATH=/usr/bin:/bin HOME="$PWD/tmp/r4-ci-home" \
  NODE_OPTIONS='--test-name-pattern=^R4_COLLECTION_ONLY$' taskset -c 0,1 npm test
```

The name filter suppresses Node test bodies after importing the files; it
does not prepare any native environment. Track/Vitest still runs its full
suite. No HOME/XDG/socket/tmp fixture launcher or custom config is used.
Final receipts are `r4-final-npm-collection.log`, `r4-final-node.log`,
`r4-final-ci.log`, `r4-final-runtime.log` and `r4-final-head.txt`. The completion
report records their exact exit codes, counts and target SHA. The same plain
environment then executes all affected suites and the guard regressions.
