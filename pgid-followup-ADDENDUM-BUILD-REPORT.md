# Addendum — zombie-aware `running()` — BUILD REPORT

Branch `fix/pgid-followup-hardening`, adding to HEAD `277b5701` (the
follow-up bundle). HEAD (this addendum): **`421e7669`**. NOT pushed, NOT
merged, NOT a PR.

## Files changed (this addendum, vs `277b5701`)

```
packages/h2a-runtime/src/native-terminal/host.ts                    |  49 insertions (refactor)
packages/h2a-runtime/src/native-terminal/process.functional.test.ts |  24 insertions (running() rewrite)
2 files changed
```

2 commits:
1. `1dd2958c` — factor the shared `/proc/<pid>/stat` comm-anchor parse;
   export `readProcessState`.
2. `421e7669` — rewrite `running()` to be zombie-aware. Current HEAD.

## The change

`running(pid)` (`process.functional.test.ts`) previously did
`process.kill(pid, 0)` → `true` on success — which returns `true` for a
**zombie** (killed, not yet reaped by its parent/init, still occupying a
`/proc/<pid>` entry). The INV-4 assertion at the "forced-reap-tree" check
(`[replacementPing.hostPid, ...forcedReapPids].map(running)` → all
not-running) therefore wanted the descendants **reaped**, not merely
**killed** — a temporal race against init's reap latency under load, not a
defect in what the test actually verifies.

**New semantics:** a pid counts as RUNNING iff `/proc/<pid>/stat` exists AND
its state (`man 5 proc` field 3) is one of `R`, `S`, `D`, `T`. State `Z`
(zombie) = DEAD. An absent `/proc/<pid>/stat` (ENOENT) = DEAD.

**Framing (per arch, load-bearing property of this fix):** this predicate is
correct **independent of whether zombies are actually the residual's
cause**. A reap test verifies the process was **killed**, not that init
**reaped** it — reaping is outside `reapOrphan`'s contract, and a zombie IS
a killed process. If the residual's cause were something else entirely, this
predicate still accepts ONLY `Z` (or ENOENT) as dead, so a genuinely-alive
process (R/S/D/T) still fails the assertion regardless — nothing is masked.
The remedy does not depend on the diagnosis being right.

## The 4 conditions

1. **`Z` alone counts as dead; `R`/`S`/`D`/`T` stay alive, named explicitly**
   (`ALIVE_PROCESS_STATES = new Set(["R", "S", "D", "T"])`, with a comment
   naming `D` — uninterruptible I/O — as the trap: classing it dead would
   mask exactly "it will not die".
2. **Reused the existing hardened parse, no second parser.** Factored
   `readProcStatFieldsAfterComm` (the `") "`-anchored split
   `readProcessStartTime` already used) into one shared helper; both
   `readProcessStartTime` (field 22) and the new `readProcessState` (field
   3, `rest[0]`) call it. `readProcessStartTime`'s own behavior verified
   unchanged (full `host.test.ts` + `supervisor.test.ts` green,
   24/25 → 25/25 tests, after the refactor alone).
3. **Vacancy-checked** — see below.
4. **Ceilings unchanged**: `EVENTUALLY_TIMEOUT_MS = 15_000`,
   `PROCESS_TEST_TIMEOUT_MS = 30_000` — confirmed untouched by this diff.

## Vacancy check (mandatory)

Temporarily injected `process.pid` (this test runner itself — state `S`/`R`,
guaranteed to never die during the test) into the `forcedReapPids` check's
array:
```js
() => [replacementPing.hostPid, ...forcedReapPids, process.pid].map(running)
```
Ran the INV-4 test and confirmed:
- The assertion **still FAILS** (not vacuously passes).
- Failure message: `Error: condition did not become true; last value:
  [false,false,false,false,true]` — the 4 real pids correctly `false`
  (dead), the injected genuinely-alive `process.pid` correctly `true`
  (alive) — proving `running()` still distinguishes alive from dead, not
  just always-false.
- Failed in **~17.86s** (measured), well under the 30s cap.

Reverted before commit; re-ran to confirm green again (3.36s that run).

## Existing greens + counter-mutants — regression check

- Full `host.test.ts`: **22/22 passed**, unaffected (guard decision logic
  untouched by this addendum — only the shared `/proc/stat` parsing helper
  was factored, and `running()`/`readProcessState` live outside the guard).
- Full `process.functional.test.ts`: **13/13 passed** with the new
  predicate.
- Re-ran all 3 relevant counter-mutant demonstrations from prior rounds with
  this addendum's code in place — each reddens **only** its target test,
  confirming no regression:
  - Leader-readable token consult (`persistedGroupToken !== undefined && …`)
    forced off → only `PGID_GUARD_PROCEEDS_VIA_TOKEN_WHEN_THE_LEADER_IS_READABLE_BUT_HAS_NO_STARTTIME_BASELINE`
    reddens.
  - `recycled` check (`currentStartTime !== persistedLeaderStartTime`)
    forced off → only `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_WAS_RECYCLED`
    reddens.
  - Leader-absent token consult (`this.#findGroupMemberToken(pgid,
    persistedGroupToken)`) forced off → only
    `PGID_GUARD_PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN_WHEN_THE_LEADER_IS_ABSENT`
    reddens.

All 3 restored; `host.ts` confirmed byte-identical to its committed state
(`git diff` empty) after restoring; typecheck clean throughout.

## Decisive step: `process.functional.test.ts`, repeated

**node v22.22.1 (this environment's system default), full file, 25×:**

```
25/25 passed. 0 failures.
```

**node v20.20.2 (via nvm), full file, 25×:**

```
24/25 passed. 1 failure (run 16).
```

**node v20.20.2, additional sample, full file, 15× more (to characterize
the finding below):**

```
15/15 passed. 0 failures.
```

**Combined node-20 total this addendum: 39/40 (97.5%).**

### The TARGETED residual (zombie-race at `running()`/`forcedReapPids`): ELIMINATED

Across all 65 runs this addendum performed (25 node-22 + 40 node-20), plus
the vacancy check and the prior counter-mutant re-verifications, **zero**
occurrences of the specific failure signature this addendum targeted
(`last value: [...boolean array from running()...]` at the
`forcedReapPids`/`replacementPing.hostPid` check). That specific residual is
eliminated by this fix, verified.

### A DIFFERENT, out-of-scope residual — full disclosure

Run 16/25 (node v20.20.2, first batch) failed with a **different**
signature, at a **different** `eventually` call — NOT the one this addendum
targeted:

```
Error: condition did not become true; last value: [
  {"pid":2191964,"missing":true,"error":"...ENOENT..."},
  {"pid":2191968,"state":"S","parentPid":229738,"processGroup":2191964,"session":2191964},
  {"pid":2191969,"state":"S","parentPid":2191968,"processGroup":2191964,"session":2191964}
]
```

This is the test's **first** `eventually` call
(`Promise.all(hardCrashPids.map(processObservation))`, checking
`state.missing === true` after `process.kill(firstPing.hostPid, "SIGKILL")`
— the "hard-crash-tree" workload, upstream of `forcedReapPids` entirely),
using `processObservation`, **not** `running()`. The array shape
(`{pid, state, ...}` objects, not plain booleans) confirms this
unambiguously.

Critically: the two lagging descendants report state **`S`** — genuinely
**alive**, not `Z`. This is **not a zombie-reap race** (the exact class of
bug this addendum fixes) — the processes had not yet actually died within
the 15s window. No predicate change can make an actually-alive process
appear dead faster; this is a real process-death-latency observation under
heavy load (45+ consecutive real-PTY-spawning test-file runs on one
sandboxed machine across this session), separate from and outside this
addendum's stated scope (`running()` specifically, per the brief).

I did **not** attempt to fix this:
- It is not a predicate defect — `processObservation`'s `missing` check
  (`ENOENT` only) already correctly reports `S` as "not missing" (alive);
  there is nothing to correct here analogous to the zombie-blindness fix.
- The brief scoped this addendum narrowly to `running()`; unilaterally
  modifying `processObservation` or its call sites, or raising ceilings
  further, was not authorized here and risks touching code this addendum's
  verification didn't cover with the same rigor.
- The failure surfaced correctly and informatively — `condition did not
  become true; last value: […]` — exactly the guarantee the prior round's
  ceiling-raising established: even this different, unaddressed residual
  never hangs or fails silently.

Flagging this precisely, the same way the `isGroupAlive` reordering and the
prior round's node-20 anomaly were flagged, for arch's own next decision —
not deciding it myself.

### Typecheck

`npx tsc --noEmit -p packages/h2a-runtime` — clean throughout.

### Artifact

`./pgid-followup-verify.txt` — appended with this addendum's full gate
transcript (node-22 25×, node-20 25× + 15× more, including the one
failure's complete output).

## Not done / explicitly out of scope

- No push/merge/PR.
- No test assertion weakened.
- Ceilings NOT touched (still 15s/30s, per condition 4).
- `processObservation`/`hardCrashPids` NOT modified — the newly-discovered,
  different residual there is reported, not patched, pending arch's call.

## Status

The addendum's targeted fix (zombie-aware `running()`) is complete, correct,
verified with a mandatory vacancy check, and shown to eliminate its
targeted residual across 65 repeated runs. A separate, unrelated, lower-
probability (~2.5% on node-20 in this local sample, 0% on node-22) residual
was discovered during verification and is disclosed in full above, not
concealed, pending arch's decision on next steps. HEAD `421e7669`.
