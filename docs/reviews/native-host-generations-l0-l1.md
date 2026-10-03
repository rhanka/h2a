# Native host generations: L0/L1 qualification

Scope: spec-astra.md §7 (D5), §8 (L0/L1), against `d122a559`.
Generation selection, admission and routing (L2+) are pending owner ratification.
No owner socket or session is used. No push, PR, publication or tag is authorized.

## Historical build

Archive `89bbd9af^` (`dd52059c13c16a62b65b8fe9fc2736bd2b1c8b9a`)
into the supplied scratchpad's `host-skew/legacy-host`, then run
`npm ci --no-audit --no-fund` and `npm run build` there.
The native host entry is `packages/h2a-runtime/dist/native-terminal/process.js`.
The initial `build:h2a` attempt did not build Track first; `npm run build`
is the complete build command. Native node-pty prebuilds load without Python.

Evidence command (all shell commands are prefixed with `rtk`):

```sh
H2A_TEST_LEGACY_HOST_DIR=<absolute legacy-host archive directory> \
H2A_TEST_REQUIRE_LEGACY_HOST=1 H2A_TEST_LEGACY_RED=1 \
node --test packages/h2a/test/native-host-generations.test.js
```

`H2A_TEST_REQUIRE_LEGACY_HOST=1` makes unavailable artifacts fail instead of
skipping. `H2A_TEST_LEGACY_RED=1` removes the L2 TODO marker to expose the raw
failure. CI discovers the test through the existing Node test runner; without
the artifact it skips with a reason, and with the artifact it executes the
L2 assertion as a TODO. Non-Linux platforms skip with a reason.

## L0 RED on d122a559

```text
not ok 1 - should select a second compatible host and preserve the historical sentinel (spec §8/L0; L2 pending)
  ---
  duration_ms: 456.288812
  type: 'test'
  location: '/home/antoinefa/src/h2a/tmp/host-gen/packages/h2a/test/native-host-generations.test.js:122:1'
  failureType: 'testCodeFailure'
  error: |-
    native host cannot reserve launch ownership; restart the host before launching
    
    
    1 !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 1
  operator: 'strictEqual'
# raw historical launch: {"status":1,"stdout":"","stderr":"native host cannot reserve launch ownership; restart the host before launching\\n"}
# sentinel unchanged: {"pid":34,"generation":"legacy-MY4vkr","incarnation":"22552d55-ebcd-4922-83eb-2de2984666d3","io":"before/after on same connection"}
# tests 1
# pass 0
# fail 1
# skipped 0
# todo 0
```

Private fixture: `/tmp/h2a-qual-MY4vkr` (0700), socket
`/tmp/h2a-qual-MY4vkr/h2a-nt/native-terminal.sock`, HOME
`/tmp/h2a-qual-MY4vkr/home`, registry
`/tmp/h2a-qual-MY4vkr/home/.config/sentropic/h2a/registry.json`, workspace
`/tmp/h2a-qual-MY4vkr/workspace`.

The harness discards inherited environment overrides, checks every computed
path including real ancestors, and refuses owner-runtime paths or paths outside
its fixture before spawn. Automatic-selection reproduction intentionally sets
`H2A_NATIVE_SOCKET` to an empty value and supplies/checks the isolated
`XDG_RUNTIME_DIR`-derived endpoint. The explicit-endpoint case supplies the
nonempty private socket override. This distinction is necessary to exercise
the two endpoint-selection contracts. All subprocesses inherit isolated HOME,
configuration, runtime, registry and workspace paths. Cleanup uses only child
handles started by the fixture; sentinel identity and I/O are checked before
cleanup on the same client/controller connection.

Raw local logs: `tmp/host-gen-evidence/` (ignored).

## Implementation and final validation

- `03de313`: historical host reproduction and L0 evidence.
- `f8de096`: typed capability refusal across native runtime, CLI and MCP;
  creation markers at native `create`/tmux `new-session` emission; regression tests.
- The CLI message is the English translation of spec §7, preserving all recovery
  instructions and the statement that existing sessions do not need a restart.
- `creationAttempted` covers the whole launch, including agent and sidecar.
  MCP checks every required field and rejects contradictory creation/delivery
  evidence. Generic failures, timeouts, unknown and launching states retain
  their existing treatment. Same-name MCP results remain memorized.
- The pending L2 assertion is a nested TODO; fixture, isolation, sentinel I/O
  and unexpected runtime errors remain blocking. L2 must extend fixture cleanup
  to own the second host's process handle before removing the TODO.

| Final targeted campaign | Passed | Skipped | TODO |
| --- | ---: | ---: | ---: |
| native-host, native-host-reuse, launch-ownership, tmux | 119 | 0 | 0 |
| native-terminal/process.functional | 19 | 0 | 0 |
| launch-guard, launch-guard-lifecycle, agent-launch-args, native-terminal/op | 30 | 0 | 0 |
| mcp-run, mcp-run-async | 25 | 0 | 0 |
| historical host, explicit endpoint and isolation guard | 3 | 0 | 1 |
| **Total (distinct tests; excludes repetitions)** | **196** | **0** | **1** |

`npm run build`, `npm run typecheck` and `git diff --check` passed. No full
suite was launched on the shared machine. Runtime/functional suites used one
Vitest worker, an environment stripped of inherited overrides and a private
runner root (examples: `/tmp/h2a-qual-0v4tV3`, `/tmp/h2a-qual-SoX1pL`).
Existing functional fixtures keep their explicitly supplied sockets/registries
inside that private TMPDIR. Their simple shell-only PTY workloads use minimal
PATH/TERM environments and execute no native client operations.

Artifact-unavailable verification: 1 isolation check passed, 2 historical
checks skipped with the explicit build-unavailable reason. With
`H2A_TEST_REQUIRE_LEGACY_HOST=1`, a missing artifact fails: 0 skipped, 1 failed.
The evidence campaigns use the real historical artifact and have zero skips.

One MCP check was inadvertently started while typecheck was rebuilding Track;
its import failed because the build temporarily removes `track/dist`. The log
is retained as `l1-mcp-during-build.log`. After build completion, the final
MCP campaign passed 25/25. No functional failure was suppressed or retimed.

No harness recorder command was run because this checkout's historical plan
forbids `.track` writes and that store has another writer. External consensus
review was not dispatched: no reviewer launch context was verified to satisfy
the owner's mandatory private-runtime environment. See the selection-failure
dossier; no independent consensus is claimed. No live owner endpoint, identity
or token store was consulted. No push, PR, publication or tag was performed.

## L1 RED evidence

Ownership unit tests, before implementation:

```text
 ❯ packages/h2a-runtime/src/launch-ownership.test.ts (8 tests | 4 failed) 18ms
      Tests  4 failed | 4 passed (8)
AssertionError: expected undefined to deeply equal { kind: 'h2a.run.failure', …(10) }
AssertionError: expected [ 'probe', 'create' ] to deeply equal [ 'probe', 'creation-attempted', …(1) ]
```

Real CLI against the isolated historical endpoint, before implementation:

```text
not ok 1 - should refuse an explicitly imposed historical endpoint before creation with the typed CLI diagnostic (spec §7/D5)
    [h2a] h2a.run.phase/v1 {"launchId":"qualification-explicit","phase":"pre-creation"}
    [h2a] h2a.run.phase/v1 {"launchId":"qualification-explicit","phase":"creation-attempted"}
    h2a runtime:run: fatal: native host cannot reserve launch ownership; restart the host before launching
```

MCP agent-launch bridge, before implementation:

```text
not ok 1 - should propagate a proven pre-create failure through the asynchronous launcher and remember the same name
    +   retrySafe: false,
    +   state: 'unknown'
not ok 2 - should accept the typed pre-create refusal through the synchronous CLI bridge
not ok 4 - should expose the typed refusal unchanged through MCP tools/call
    +   retrySafe: false,
    +   state: 'unknown'
# tests 8
# pass 5
# fail 3
# skipped 0
# todo 0
```

Tmux marker regression, run against the baseline tmux source before restoring the change:

```text
      Tests  2 failed | 1 passed | 91 skipped (94)
AssertionError: expected [ 'new-session' ] to deeply equal [ 'creation-attempted', 'new-session' ]
-   "creation-attempted",
```
