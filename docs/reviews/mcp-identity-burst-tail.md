# MCP identity burst deadline tail

Base: `ab7ff40eca8fbfd21fc5e268ccfb282b9661d4b0` (v0.98.1).
Branch: `fix/mcp-identity-burst-tail`.

## Incident and causal evidence

The supplied `release-run-failed.log`, lines 7217–7234, records the Ubuntu /
Node 20 release failure: T4 holder lasted **50,556.070807 ms**, expected 36
bindings, observed 35. Its preceding distinct/shared cohorts passed in
12,802.777628 / 17,539.843638 ms (lines 7207–7215). The log contains no
per-connection identity status: it cannot independently prove the missing
connection's exact cause or lock-queue position.

The reproduced mechanism is an expired identity attempt left idle:

- `identity-state.ts` starts one authoritative 20,000 ms deadline at entry to
  `identity_pending`, including worker startup, lock waits and preparation.
- `identity/worker.ts` retries live lock contention inside that budget, yielding
  between attempts; expiry becomes `identity_timeout` with `retryable:true`.
- `server.ts` invokes `identity.retry()` only for a known, guarded tool after a
  transient failure. `h2a_identity_status` and other independent reads bypass
  that guard. Releasing a lock alone never starts another attempt.
- T4 originally sent `initialize`, released the holder, and polled the bindings
  file for 40 s. This observation cannot revive an expired worker. A lost tail
  therefore remains missing even after the lock is available.

This confirms H-COND's timeout/no-tool-call mechanism deterministically. It is
consistent with the release's 35/36 and 50.556 s, without claiming the release
log proves the server's individual state.

## Contract decision

Correct the test, not the product. The public `h2a_identity_status` description
in `runtime/mcp/tools.ts` explicitly says a transient failure self-heals on a
**later tool call**, returning to pending with a fresh attempt ID. The
controller's documented single deadline and the T5 timeout / T-retry tests
agree. `docs/specs/2026-09-26-SPEC_lot4-identity-succession-lock.md` also preserves
the bounded on-demand retry from #291 (§6, “Reprise réconciliée avec #291”).
There is no idle-session convergence guarantee across an expired attempt.
Background retry or a renewed deadline would change that contract and the
existing timeout, cancellation and retry-rate guarantees.

T4's purpose is preserved: every connection initializes under the held lock,
no binding exists while it is held, and **all 36** reach activated readiness
and produce **36 distinct bindings** after release. The lab now performs the
documented recovery action for a timed-out connection, rather than requiring
unpromised autonomous recovery. The helper allows exactly one new attempt per
connection, rejects permanent failures and any second failure, and shares the
original 40 s post-release budget across all connections and attempts.
`H2A_IDENTITY_RETRY_MIN_MS=0` is confined to these private fixtures; the product's
20 s deadline and default 30 s retry interval are unchanged.

## Deterministic RED / GREEN

Environment: Linux, official Node **20.20.2**, CPU affinity **0** (one logical
CPU), synthetic private laboratory roots and secret-free child environments.
Official archive SHA-256:
`df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d`.

Command (identical for RED and GREEN):

```sh
rtk proxy taskset -c 0 tmp/burst-evidence/node-v20.20.2-linux-x64/bin/node \
  --test --test-name-pattern='T4 deadline tail' \
  packages/h2a/test/mcp-identity-burst.test.js
```

The real binary first activates the head connection. A live registry holder
then blocks the tail until its observed production deadline failure. Release
is driven by the failure state, not a calibrated sleep. Before recovery, the
test proves one binding, retryable timeout and the same failed attempt after a
status read. Only the post-release observation changes between RED (passive
status polling, the original expectation) and GREEN (one guarded tool call).

RED, exit 1, duration **21,156.254523 ms**, one failure / four name-filter skips:

```text
not ok 2 - T4 deadline tail: every connection resolves after release, including an expired attempt
all 2 resolve after release
1 !== 2
tail expired after 20000ms; bindings after release: 1/2
h2a mcp-serve: identity failed (identity_timeout): identity did not become ready within 20000ms
```

GREEN, exit 0, duration **21,605.573234 ms**, one pass / four name-filter skips:

```text
ok 2 - T4 deadline tail: every connection resolves after release, including an expired attempt
tail expired after 20000ms; bindings after release: 1/2
h2a mcp-serve: identity failed (identity_timeout): identity did not become ready within 20000ms
after one on-demand retry: 2/2 ready, 2 bindings, 2 distinct identities
```

The regression additionally requires a new tail attempt ID, a live signer,
two bindings and two distinct identities without restarting the MCP servers.
Raw receipts: ignored `tmp/burst-evidence/red-tail.log`, `green-tail.log`.

The RED post-release observer was:

```js
const finals = await Promise.all(handles.map((h) =>
  waitForIdentity(h, (s) => s.state !== "identity_pending")));
```

The GREEN observer is `await resolveCohortAfterRelease(handles)`. The holder,
two connections, real deadline and cardinality requirement are unchanged.

## Qualification

The ten-run campaign aborts on the first failure; it never retries a failed
suite. Each run includes the three 36-process cohorts, mixed CLI/MCP writers,
and the forced 20 s deadline-tail regression. All runs used Node 20.20.2,
`taskset -c 0`, default cohort size 36, separate private roots and no seed from
owner state. No test code changed during the campaign.

| Run | Wall time (s) | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 87.557 | 5 | 0 | 0 | 0 |
| 2 | 87.062 | 5 | 0 | 0 | 0 |
| 3 | 87.876 | 5 | 0 | 0 | 0 |
| 4 | 87.616 | 5 | 0 | 0 | 0 |
| 5 | 87.630 | 5 | 0 | 0 | 0 |
| 6 | 86.134 | 5 | 0 | 0 | 0 |
| 7 | 85.936 | 5 | 0 | 0 | 0 |
| 8 | 85.941 | 5 | 0 | 0 | 0 |
| 9 | 86.763 | 5 | 0 | 0 | 0 |
| 10 | 87.368 | 5 | 0 | 0 | 0 |

**50 passed, 0 failed, 0 skipped, 0 cancelled, 0 TODO.** Raw receipts:
`tmp/burst-evidence/burst-01.log` through `burst-10.log` and
`repeat-results.json`; reproducible driver `repeat-burst.mjs` in that directory.
Focused sibling check: Node 20.20.2, `taskset -c 0`, `node --test
--test-concurrency=1`, the following seven existing files plus four laboratory
observer controls in `tmp/burst-evidence/observer-contract.test.mjs`:

- `identity-state.test.js`: deadline/activation boundary, cancellation,
  on-demand retry interval, one pending worker, permanent failures.
- `mcp-identity-readiness.test.js`: transport decoupling, pending/ready/failed
  guards, the real 20 s timeout and the dead-holder on-demand recovery.
- `mcp-startup-contention.test.js`: mixed shared/distinct conversations under
  the live registry lock, exact readiness and binding cardinalities.
- `mcp-storage-readonly.test.js`: permanent storage failure and read-only
  transport availability.
- `mcp-mesh-activation.test.js`: preparation/activation failures, signer and
  messaging readiness, timeout and transport closure.
- `succession-lock-operator.test.js`: operator intervention during retry never
  creates two holders or removes the winner's lock.
- `mcp-stdio.test.js`: real transport and readiness ACK wiring.

Result: **63 tests, 62 passed, 0 failed, 0 cancelled, 1 skipped, 0 TODO**,
83,235.958124 ms TAP duration, exit 0. The existing skipped case requires a
read-only bind mount (EROFS); none is available in this environment. The
negative observer controls all pass: permanent failure is never retried;
a second timeout is rejected after exactly one retry; a stale attempt ID and
a tool call that does not start recovery are rejected. Raw receipt:
`tmp/burst-evidence/siblings.log`; driver: `run-validation.mjs siblings`.

The one full final root gate runs on test commit
`e75e835fad4aae77ab875241402502196f4be6e2`: Node 20.20.2, `taskset -c 0-3 npm
test`, private HOME / XDG configuration / runtime configuration / H2A_ROOT,
no inherited credentials. The root test script builds first, verifies Focus
vendor bytes and packaged assets, checks Focus imports, then runs the Node
suite and Track Vitest sequentially. All gates passed, exit 0, **143,304 ms**
wall time; there was exactly one full run.

| Gate | Files | Tests | Passed | Failed | Cancelled | Skipped | TODO |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node h2a / Focus Interactive | 274 | 2,509 | 2,456 | 0 | 0 | 32 | 21 |
| Track Vitest | 87 | 1,193 | 1,193 | 0 | 0 | 0 | 0 |

Node TAP duration: **130,538.807068 ms**; Track duration: **7.97 s**.
This root gate is not a whole-monorepo source-suite count. Receipt:
`tmp/burst-evidence/full.log`, Node totals at lines 12677–12684 and Track
totals at lines 12783–12786. T4 deadline tail and the 36-connection holder
pass at lines 7210 and 7223. Driver: `run-validation.mjs full`.
Read-only host `pgrep -af '[v]itest|[r]un-tests|[n]ode --test'` checks found
no runner before sibling/full launch or after final completion; the campaign
check found only its own current burst runner. No unrelated process was killed.

## Scope and risk

Changed test code: `packages/h2a/test/mcp-identity-burst.test.js`,
`packages/h2a/test/mcp-startup-contention.test.js`, and
`packages/h2a/test/helpers/mcp-cohort-readiness.js`. Planning/evidence changes:
`BRANCH.md` and this document. No production or dependency changes.

Risk is confined to test observation: the lab explicitly allows a first
retryable timeout to recover. Exact binding/cardinality assertions are retained;
permanent errors, repeated timeouts, stale attempt IDs, RPC failure and cohort
budget expiry remain failures. The deterministic test adds about 21 s to this
test file and intentionally covers expiry in every campaign run.

Harness peer review: **selection-failed**. Target:
`e75e835fad4aae77ab875241402502196f4be6e2`, the three test-code paths above.
Author: host `codex`, requested model
`gpt-6.1-sol`, effort `high`. The review skill requires two distinct
Claude-hosted model legs launched through the installed h2a MCP server. Its
live discovery/launch path uses owner runtime state, which this task forbids
accessing. No dispatch, owner-store access or consensus verdict is claimed.
Local diff inspection and executable evidence remain available for review.
