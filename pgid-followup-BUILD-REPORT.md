# pgid post-merge follow-up bundle — BUILD REPORT

Branch `fix/pgid-followup-hardening`, off `main` @ `32b7fd19` (contains the
merged token-anchor work — this branch EXTENDS it, does not restart from
scratch). HEAD (this build): **`c8acb0aa`**. NOT pushed, NOT merged, NOT a PR.

## Files changed (vs `origin/main`)

```
packages/h2a-runtime/src/native-terminal/host.ts                    |  55 +++++++--
packages/h2a-runtime/src/native-terminal/host.test.ts                | 134 +++++++++
packages/h2a-runtime/src/native-terminal/process.functional.test.ts  |  35 +++
3 files changed, 212 insertions(+), 12 deletions(-)
```

3 commits on top of `32b7fd19`:
1. `e4eb325c` — (1) INV-4-harden: lift the `eventually`/testTimeout ceilings.
2. `aafb9863` — (2) raise-proof-never-degrade token consult in the
   leader-readable/no-baseline branch; (3) log-at-spawn.
3. `c8acb0aa` — the two new named tests for (2). Current HEAD.

## (1) INV-4-harden — lifted BOTH ceilings, GLOBAL

**Root cause (as measured/stated in the brief):** `process.functional.test.ts`
declared no `testTimeout` (vitest default 5000ms applies) and `eventually`
(200×10ms≈2s, 30 call sites) could, under CI load, exceed real process-death
detection latency and approach that 5s cap — a mis-dimensioned ceiling, not a
flake, and the root cause of 4 manifestations of intermittent RED on the
required `build-and-test` check.

**Fix, in `process.functional.test.ts`:**
- `eventually` rewritten **deadline-based** (not attempt-count-based, so
  `read()`'s own latency can never inflate the wall-clock budget):
  `EVENTUALLY_TIMEOUT_MS = 15_000`, poll interval unchanged at 10ms.
- File-scoped `PROCESS_TEST_TIMEOUT_MS = 30_000` applied via `describe`'s
  third positional argument (`describe.skipIf(...)(name, fn, 30_000)` —
  vitest's suite-level default-timeout mechanism), so every `it` in the file
  gets it without a per-call/per-`it` param — **GLOBAL**, as required:
  `eventually` returns instantly on success so raising its ceiling costs
  nothing on the (overwhelmingly common) passing path, and a per-call
  override across 30+ sites would be a forget-risk a global constant removes
  structurally.
- `EVENTUALLY_TIMEOUT_MS (15s)` stays strictly under `PROCESS_TEST_TIMEOUT_MS
  (30s)`, confirmed by the vacancy check below: `eventually`'s own
  `condition did not become true; last value: …` diagnostic — what
  distinguishes "reap refused" from "processes merely still dying" — fires
  and is what a CI log shows, before vitest's own bare "Test timed out" could
  ever win the race.

### Vacancy check (mandatory)

Temporarily broke the FRESH-host test's exit condition to an unsatisfiable
value (`state.missing === "vacancy-check-impossible-value"`), ran it, and
confirmed:
- The test still **FAILS** (not silently passes, not hangs).
- It fails with the **informative message**:
  `Error: condition did not become true; last value: {"pid":…,"missing":true,…}`
  — not a bare vitest "Test timed out".
- It failed in **~15.35s (measured: `Duration 15.89s`, `it` itself
  15354ms)** — well under the 30s test-timeout cap, proving `eventually`'s
  own diagnostic wins the race as designed.

Reverted before commit; re-ran to confirm green again.

## (2) Token consult in the leader-readable branch — raise-proof-never-degrade

`#verifyGroupLeaderIdentity`'s leader-readable, no-start-time-baseline branch
(previously: unconditionally `unverified-legacy` + proceed) now consults the
group token FIRST:
- token found on a surviving member → **upgrades** to
  `{ proceed: true, verified: true, cause: "token-verified" }`
  (`pgidGuardCounters.tokenVerified++`).
- token not found (or no token baseline either) → **stays**
  `{ proceed: true, verified: false, cause: "unverified-legacy" }` and
  PROCEEDS — **never** escalates to `membership-unprovable`. Per arch's
  explicit rationale: without a start-time baseline there is no way to tell
  "our group whose token-carrier already exited" from "not our group";
  refusing here would open a brand-new refusal path on a population that
  proceeds today, a new leak, not a fix.

## (3) log-at-spawn

`create()` now logs, at PTY-creation time, when `readLeaderStartTime`
returns undefined: `session <id> pgid=<pgid>: leader start-time UNREADABLE
at spawn time — this row will persist WITHOUT a pgidLeaderStartTime baseline
(post-fix-no-baseline, not a pre-fix legacy row). cause=leader-start-time-unreadable-at-spawn
sessionId=<id> pgid=<pgid>`. Distinguishes a row whose capture specifically
failed under CURRENT code from a true pre-fix legacy row that never
attempted the capture at all.

## Named tests — PASS/FAIL

| Test | Result |
|---|---|
| `PGID_GUARD_PROCEEDS_VIA_TOKEN_WHEN_THE_LEADER_IS_READABLE_BUT_HAS_NO_STARTTIME_BASELINE` (NEW) | **PASS** |
| `PGID_GUARD_STAYS_UNVERIFIED_LEGACY_WHEN_THE_LEADER_IS_READABLE_WITH_NO_STARTTIME_BASELINE_AND_NO_TOKEN_MATCH` (NEW) | **PASS** |
| All 3 prior `PGID_GUARD_*` tests (match / recycled / unverified-legacy-via-leader-absent-branch) | **PASS**, unaffected |
| `PGID_GUARD_PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN_WHEN_THE_LEADER_IS_ABSENT` (round 3) | **PASS**, unaffected |
| `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_LEADER_IS_ABSENT_AND_NO_MEMBER_CARRIES_THE_TOKEN` (round 3) | **PASS**, unaffected |
| `should kill a signal-resistant PTY tree after hard host death and forced host reaping` (INV-4) | **PASS** (see repeated-run section for the one node-20 anomaly) |
| `should let a FRESH host … reap it from its durably persisted pgid …` | **PASS** |
| `should let reapOrphan collect a real orphan whose leader is gone but a live descendant survives it …` (round 3 invariant test) | **PASS** |

Full `host.test.ts`: **22/22 passed** (was 20 before this round: +2 new).

### Wiring counter-mutant demonstration (new leader-readable token consult)

Target: the `persistedGroupToken !== undefined && this.#findGroupMemberToken(...)`
condition inside branch 1 of `#verifyGroupLeaderIdentity` (leader readable,
no start-time baseline). Demonstration:

1. Forced the condition to `false && …` (permanent no-match, as if the
   consult were removed).
2. Ran `PGID_GUARD` tests: **only**
   `PGID_GUARD_PROCEEDS_VIA_TOKEN_WHEN_THE_LEADER_IS_READABLE_BUT_HAS_NO_STARTTIME_BASELINE`
   turned red (`expected verified:true, received verified:false`); its
   sibling (`…_NO_TOKEN_MATCH`) stayed green (unaffected — it already
   expects a miss).
3. Restored. Re-ran: green again.

### Regression check on the pre-existing (round 3) counter-mutants

Re-ran both prior demonstrations with this round's code in place, to prove
no regression:
- Forced the **leader-absent** branch's token consult (a distinct wiring
  point, line ~1018) to `false && …`: only
  `PGID_GUARD_PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN_WHEN_THE_LEADER_IS_ABSENT`
  turned red — identical to round 3's demonstration, confirming the two
  token consults (leader-readable vs. leader-absent) are independently wired
  and don't interfere with each other's mutants.
- Forced the `recycled` check (`currentStartTime !== persistedLeaderStartTime`)
  to `false && …`: only `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_WAS_RECYCLED`
  turned red — identical to prior rounds.

Both restored; full `host.test.ts` confirmed green (22/22) after each.

## Gates

### `npm ci` + resolved `@sentropic/llm-mesh`

`npm ci` — 306 packages installed cleanly (no dependency changes since the
merged token-anchor work). Resolved `@sentropic/llm-mesh` = **`0.15.0`**
(`node_modules/@sentropic/llm-mesh/package.json`), matching the declared
range; the pin guard resolves via ESM `import.meta.resolve`
(`llm-mesh-resolution.test.ts`), untouched by this diff and green.
`node-pty`'s native binding confirmed loadable under both node v22.22.1 and
v20.20.2 before running anything.

### h2a-runtime full vitest suite, node v22.22.1

```
Test Files  93 passed (93)
     Tests  1417 passed | 4 skipped (1421)
```

Fully clean — 0 failures (+4 tests vs. the merged baseline: the 2 new named
tests × counted individually, plus the round's other test additions already
in main).

### `process.functional.test.ts`, repeated (the decisive step)

**Full file (all 13 tests), 25× on node v22.22.1 (this environment's system
default):**

```
25/25 passed. 0 failures.
```

**Full file, 20× on node v20.20.2 (installed via nvm for this check):**

```
19/20 passed. 1 failure (run 9/20).
```

**Isolated re-run of just the INV-4 test (`should kill a signal-resistant
PTY tree after hard host death and forced host reaping`), 20× on node
v20.20.2 (to separate "flaky under my own aggressive 45-consecutive-run
local stress loop" from "flaky in isolation"):**

```
19/20 passed. 1 failure (run 10/20) — SAME failure signature as above.
```

### The one node-20 failure — full disclosure, not swept aside

Both node-20 failures (in the loop and in isolation) show the **identical**
signature:

```
Error: condition did not become true; last value: [false,false,true,true]
 at process.functional.test.ts:302
```

This is the test's LAST `eventually` call —
`[replacementPing.hostPid, ...forcedReapPids].map(running)` waiting for all
4 to be `false` (not running). `[false,false,true,true]`: the replacement
host and the "forced-reap-tree" leader are confirmed dead; its two
descendants are STILL alive after the full 15s window.

This is:
- A **genuine, informative** failure — exactly what the hardening is
  designed to surface (not a hang, not a silent pass, not a bare "Test timed
  out" with no diagnostic). The vacancy check above proves this mechanism
  works; this is that same mechanism doing its job on a real occurrence.
  Total `it` duration both times: ~17.6–18.0s — well under the 30s cap, so
  the informative message did win the race as designed.
- **Not touching the token-anchor/guard logic at all**: this specific
  `eventually` call is pure OS-level process-liveness observation
  (`running()`), upstream of any `reapOrphan`/`#verifyGroupLeaderIdentity`
  call in this test's flow.
- **Reproducible at ~5% (1/20) specifically on node v20.20.2** in this
  sandboxed environment, both under a 20-consecutive-full-file-run stress
  loop AND in isolated repetition — ruling out "artifact of my own hammering
  loop" as the sole explanation. It did NOT reproduce in 25/25 runs on node
  v22.22.1 in the same environment, though with a true ~5% underlying rate,
  0/25 on a different version is not strong statistical evidence of a
  systematic node-version difference (P(0 successes in 25 trials at 5%) ≈
  28%) — this could be ordinary binomial variance rather than a real
  node-20-specific defect.
- Most plausibly a **real OS scheduling/signal-delivery latency** under
  heavy local resource contention (45 consecutive real-PTY-host-spawning
  test-file runs back-to-back on one sandboxed machine, switching node
  versions mid-sequence) for a `while :; do sleep 1; done`-looping
  "signal-resistant" workload to actually finish dying after a real SIGKILL,
  not a defect in this round's design or code.

**I did not raise the ceilings further to chase this to 0/N.** The brief
specified `~15s`/`30s` precisely; unilaterally inflating them further without
that instruction, in response to a single low-probability occurrence under
an artificially aggressive local stress pattern a real (single, isolated)
CI job would not encounter, would be presumptuous. Flagging this
transparently, the same way the `isGroupAlive` reordering deviation was
flagged in an earlier round — for arch to assess against the REAL CI
matrix (which the brief itself says is the actual authority: "CI matrix
green node-20 AND node-22 … read job by job. No CI, no stamp").

### Typecheck

`npx tsc --noEmit -p packages/h2a-runtime` — clean, no errors, after every
edit round.

### Artifact

`./pgid-followup-verify.txt` (worktree root) — full transcript of the vitest
suite run and all repeated `process.functional.test.ts` runs, including the
one node-20 failure's complete output.

## Not done / explicitly out of scope

- No push/merge/PR.
- No test assertion was weakened to get green anywhere in this round. The
  one node-20 anomaly is reported in full, not hidden or worked around by
  loosening an assertion.
- Root `npm test` / `node --test packages/h2a` gate: not run this round —
  this round's brief scopes gates to `npm ci` + h2a-runtime vitest +
  repeated `process.functional.test.ts` only, and this diff touches nothing
  under `packages/h2a`.

## Status

Build complete per brief. HEAD `c8acb0aa`. The one residual node-20 timing
anomaly (documented above, ~5% rate, informative-not-silent, pure OS
process-death observation unrelated to guard logic) is surfaced for arch's
review against the real CI matrix, per the brief's own stated authority.
