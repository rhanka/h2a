# Native absence and host life journal qualification

Historical receipt, superseded by [independent review R2 corrections](native-absence-review-r2.md).
The A F03 RED below has been corrected; the old `f03-red.log` is withdrawn.

Branch: `fix/0.98.2-native-absence-minimal`; base `686fd129`.
Code target: `9f9e937c2dd91f270be594e627764e81998f8215`.
Owner decision: 2026-10-10. No release version bump, push, PR, publish, tag,
upgrade deferral, additional second-host protection, or `.track` writes.
The package version recorded by the host is the version actually loaded
(`0.98.1` in this checkout), rather than a fabricated release version.

## Findings and independently rerun evidence

| Finding | Commit | RED | GREEN |
| --- | --- | --- | --- |
| A F01: failed `/proc` stat/readlink observation is unknown | `4b281855` | 2 failures using the compiled `f34b1fff` server | 2 passes |
| A F02: deleted startup alias must not prove absence | `656c1f89` | 1 failure using the compiled `4b281855` server | 1 pass; original client still answers |
| A F03: failed owner recording rolls back only the proven socket inode | `9b54c662`; corrected proof in R2-F05 | Previous `656c1f89` RED withdrawn: injection absent. Current-build rollback-only mutation retains the socket and blocks retry | 1 pass; identical injection, rollback restored, retry succeeds |
| A F04: required historical/generation qualification and isolation | `25663f4a`, `4f5a9f0f` | Shared textual guard allowed a symlink escape: 1 failure | 36 Node passes, 0 skips; all four environment variables and symlink escapes checked |
| B F04: observed lifecycle, PID plus start time, real fatal behavior | `9f9e937c` | Lifecycle metadata/cause assertions failed; previous rejection listener suppressed fatal termination | Start, SIGTERM/SIGINT/SIGHUP, clean stop, exit code, real uncaught exception/rejection and `process.abort()` pass |
| B F10: diagnostic field allowlist | `9f9e937c` | Arbitrary secret and raw env/header fields persisted | 8 arbitrary/header/cookie/key/token/env diagnostic cases pass; only verified code locations retained |
| B F11: exclusive lock without reclamation/waiting | `9f9e937c` | Five live-lock attempts consumed 250 ms; orphan lock was removed; storage drops uncounted | No retry or unlocked write; live/orphan locks preserved; 80 concurrent attempts = writes + counted drops; rotation JSON intact |

A F01/F02 RED checks ran in the isolated lab against the actual pre-fix server sources,
transpiled into the local ignored dist directory, which was restored in a
`finally` block. These runs were not claims inherited from the stopped builder.
B RED against its four pending files: **10 failed / 6 passed**, followed by
**16 passed** and two additional real-host lock/startup checks, **18 passed**.
The pending `index.ts` journal exports were removed: no public API is needed.

## Isolation and historical build

All runners use `env -i`, private HOME/runtime/state/config/TMPDIR paths under
this checkout's `.qual-tmp`, one Vitest worker, and no inherited owner override.
The shared helper rejects missing variables, owner paths, paths outside the lab,
and symlink ancestors pointing at owner state before spawning any process.
Real shell PTYs receive the same four isolation variables. Teardown uses only
fixture-created child handles or private fixture endpoints. No owner runtime,
session, native host, configuration or state directory is accessed.

The historical archive is from
`dd52059c13c16a62b65b8fe9fc2736bd2b1c8b9a` (`89bbd9af^`), in
`.qual-tmp/legacy`. Its native runtime was compiled from those sources with
the available dependency tree; no version-string substitution was used.
`tsc -b .qual-tmp/legacy/packages/h2a-runtime --pretty false` passed.
An attempted whole historical repository build could not resolve its old
cluster-mesh dependency; the scoped runtime build supplies the needed real host.
The sentinel assertions independently verify that this host lacks launchFence.
`H2A_TEST_REQUIRE_LEGACY_HOST=1` is set for the entire Node qualification.

The first broadened runtime invocation accidentally collected the archive's
tests and exposed fixture socket paths over 107 bytes. Its failure receipt is
retained as `runtime-final.log`, not counted as GREEN. The lab config now
excludes `.qual-tmp`, and socket fixture basenames are short enough to retain
isolation under the worktree. Corrected process/server checks passed 34/34.

## Journal behavior

Location: `${XDG_STATE_HOME:-$HOME/.local/state}/h2a/native-host.log`.
Files and rotation are 0600; the containing directory is private. Rotation
is checked at 1 MiB while holding the exclusive writer lock. Lifecycle writes
run in a worker with a bounded mailbox; journal errors do not crash the host.
R2-F03 moves final exception/exit observations to an independent writer process,
with no journal filesystem operation on the host thread. Host flush and writer
drain are bounded to 100 ms, including blocked storage. Lock acquisition never waits.

Locks are never reclaimed based on age or bare PID. Each writer records a
unique token and releases only its own inode/token. Contention or storage
failure drops and counts the entry, with a dropped receipt on a later successful
write. An orphan lock conservatively causes drops until its owner/operator
removes it. Concurrent qualification accounts for every attempt, including
drops, and checks unique entries, valid JSON and rotation modes.

All lifecycle entries carry the actual PID and process start time, or `unknown`
if start time cannot be observed. There is no PID watcher. A real abort or
SIGKILL cannot execute JavaScript exit handlers: the last start remains, and
no invented signal/exit cause is appended. An observed exit with no known cause
is explicitly `unknown`. The uncaught exception monitor leaves Node's fatal
exception and rejection semantics intact.

Messages are always `[REDACTED]`. Stacks retain verified existing code file
locations and numeric positions; arbitrary message/function/header/env content
is omitted. Unknown fields are never spread into the serialized record.

## Actual isolated journal sample

Excerpt from `.qual-tmp/builder/evidence/journal-sample.jsonl`. The error host
threw a Basic Authorization credential; its journal retains only the location.

```jsonl
{"timestamp":"2026-10-10T06:22:48.100Z","event":"start","pid":11,"startTime":10019705,"generation":"sample-stop","version":"0.98.1","codePath":"/home/antoinefa/src/h2a/tmp/hotfix-min/packages/h2a-runtime/dist/native-terminal/process.js","socket":"/home/antoinefa/src/h2a/tmp/hotfix-min/.qual-tmp/sKaC6hF/ok.sock"}
{"timestamp":"2026-10-10T06:22:48.111Z","event":"signal","pid":11,"startTime":10019705,"generation":"sample-stop","signal":"SIGTERM"}
{"timestamp":"2026-10-10T06:22:48.114Z","event":"stop","pid":11,"startTime":10019705,"generation":"sample-stop","clean":true}
{"timestamp":"2026-10-10T06:22:48.115Z","event":"exit","pid":11,"startTime":10019705,"generation":"sample-stop","exitCode":0,"cause":"clean-stop"}
{"timestamp":"2026-10-10T06:22:48.299Z","event":"uncaughtException","pid":23,"startTime":10019724,"generation":"sample-error","error":"[REDACTED]","stack":"at /home/antoinefa/src/h2a/tmp/hotfix-min/.qual-tmp/sKaC6hF/sample-error.mjs:3:39"}
{"timestamp":"2026-10-10T06:22:48.300Z","event":"exit","pid":23,"startTime":10019724,"generation":"sample-error","exitCode":1,"cause":"uncaughtException"}
```

## Final targeted gates and receipts

| Gate | Passed | Failed | Skipped | TODO |
| --- | ---: | ---: | ---: | ---: |
| Node absence + generations + isolation, real historical artifact required | 36 | 0 | 0 | 0 |
| Runtime: journal, process functional, server, client, op, fleet, native host/reuse | 83 | 0 | 0 | 0 |
| **Distinct total** | **119** | **0** | **0** | **0** |

`npm run build:h2a` and `git diff --check` pass. No full-suite campaign.
The ignored lab launcher is `.qual-tmp/builder/run.sh`; Vitest uses the lab
config with its cache under `.qual-tmp`, `--configLoader native`,
`--maxWorkers=1 --no-file-parallelism`. Node uses `--test-concurrency=1`.
Final-SHA receipts are `final-head.txt`, `final-build.log`, `final-node.log`,
`final-runtime.log` and `final-diff-check.log` under
`.qual-tmp/builder/evidence/`; RED receipts are `f01-red.log`, `f02-red.log`,
`f03-red.log`, `f04-isolation-red.log`, `journal-red.log`.

## Independent review boundary

```yaml
review-author:
  host: codex
  model: gpt-6.1-sol
  effort: xhigh
target-ref: 9f9e937c2dd91f270be594e627764e81998f8215
status: selection-failed
observed-failure: Installed h2a_run has no HOME/XDG environment override; dispatch cannot satisfy the owner's absolute host/session/state isolation. No owner-bound MCP launch was attempted.
```

The harness-review skill requires dispatch through installed `h2a_run`, with
two author-complementary peers. That launch cannot be isolated using its exposed
schema, so no consensus verdict is claimed. The supplied Sol reviews were
critically checked against the code and the independently rerun evidence above.
