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
  error: |-
    native host cannot reserve launch ownership; restart the host before launching

    1 !== 0
  expected: 0
  actual: 1
# raw historical launch: {"status":1,"stdout":"","stderr":"native host cannot reserve launch ownership; restart the host before launching\n"}
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
