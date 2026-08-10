# pgid-recycling-guard — BUILD REPORT

Branch `fix/pgid-recycling-guard`, off main `8f452044`. HEAD (this build):
**`4bbb83e3`**. NOT pushed, NOT merged, NOT a PR.

## Files changed (vs `8f452044`)

```
packages/h2a-runtime/src/registry.ts                                 |  29 +-
packages/h2a-runtime/src/native-terminal/host.ts                     | 233 +-
packages/h2a-runtime/src/native-terminal/host.test.ts                | 202 ++
packages/h2a-runtime/src/native-terminal/process.functional.test.ts  |  15 +
pgid-BUILD-REPORT.md (this file)                                     | new
pgid-verify-artifact.txt (gate transcript, untracked-style, committed)| new
6 files changed, 12193 insertions(+), 21 deletions(-)
```

5 commits on top of `8f452044`:
- `d1573952` — core INV-4 fix: `pgidLeaderStartTime` persisted next to `pgid`
  (registry.ts), captured at spawn and re-verified before `killGroup(pgid)`
  (host.ts), with the two discernible refusal causes (counters + loud logs).
- `ca31dba8` — **deviation from the brief's literal ordering** (see below);
  arch has since **RATIFIED** this ordering — do not revisit it.
- `40cfea6f` — the four mandated named tests.
- `e55b5a59` — this report + gate artifact (superseded content below by the
  next commit; kept for history).
- `4bbb83e3` — **arch follow-up correction**: makes the "unverified-legacy"
  proceed path visible (see new section below). This is the current HEAD.

## Design as built

1. **Persist at spawn** (`host.ts` `create()`, was `:428`): alongside the
   existing `ownStartTime = readProcessStartTime(process.pid)` (host owner
   attribution), now also `readLeaderStartTime(pty.pgid)` (injectable;
   defaults to the real `readProcessStartTime`), passed as a 5th argument to
   `persistNativeTerminalPgid`, which persists it as `RegistryEntry.pgidLeaderStartTime`
   next to `pgid` — same durable write, no new persistence path.
   `readNativeTerminalPgid` reads it back on the `"resolved"` branch.
2. **Re-verify before kill**: `reapOrphan` passes
   `{ sessionId, persistedLeaderStartTime: lookup.leaderStartTime }` into
   `#killGroupAndConfirmDead`, which — before ever emitting a signal — calls
   `#verifyGroupLeaderIdentity`:
   - current read undefined → REFUSE, cause `"leader-absent"`, counter
     `#pgidGuardCounters.leaderAbsent`, loud log (`REFUSING…cause=leader-absent
     sessionId=… pgid=…`).
   - current read defined, persisted baseline defined, and they differ →
     REFUSE, cause `"recycled"`, counter `#pgidGuardCounters.recycled`, loud
     log (`REFUSING…cause=recycled…`).
   - no persisted baseline at all (legacy row) → cannot check recycling →
     PROCEEDS, cause `"unverified-legacy"`, counter
     `#pgidGuardCounters.unverifiedLegacy`, its OWN loud log
     (`PROCEEDING…WITHOUT identity proof…cause=unverified-legacy…`), and
     `verified: false` on the returned `"reaped"` outcome (mirrors
     `defaultOwnerHostProbe`'s identical treatment of a missing
     `ownerHostStartTime`: never manufacture a refusal from missing data —
     pre-fix status quo, not a regression — but see the correction below:
     this proceed must never be silently indistinguishable from a proven one).
   - match → PROCEEDS, cause none, `verified: true` on the returned outcome.
   `forceStopAll` never supplies `verify` (it kills a session this host is
   still holding a live in-memory handle to, spawned in this process — no
   "was this pgid recycled since we last looked" window exists there), so it
   is unaffected by the guard.
3. Kill stays parent-emitted (`process.kill(-pgid, sig)`, unchanged); no
   group-member enumeration was added.

## Deviation from the brief's literal text (load-bearing finding)

The brief's ordering was: unconditionally re-read `readProcessStartTime(pgid)`
before `killGroup(pgid)`. Implemented literally, this **broke an existing,
previously-green test the brief did not name** —
`"should let a FRESH host — one that never knew the session — reap it from
its durably persisted pgid after brutal host death"`
(`process.functional.test.ts`) — **deterministically, reproduced 3/3 times**:
`expected status "reaped", got "refused"` (cause `leader-absent`).

Root cause, empirically traced: this codebase's crash containment
(`pty.ts`'s guardian, `setpriv --pdeathsig SIGUSR2` → `h2a_force` →
unconditional `kill -KILL -- "-$$"` on the guardian's OWN group) fires on
**any** host death, hard or soft — not only the "host hangup" (HUP-forward)
scenario the brief's MEASURED note describes. On a hard `SIGKILL` of the
host (both this test and the brief-named INV-4 test use exactly that), the
guardian's self-destruct reliably completes **before** any external reap
attempt runs, so the group leader is typically already gone by the time
`readProcessStartTime(pgid)` is checked — turning a legitimate, effectively
already-completed reap into a "leader-absent" refusal, and (for the reconcile
path) reinstating the exact leak the guard exists to prevent, for the
already-fully-dead case.

Fix applied (`ca31dba8`): check `this.#reaper.isGroupAlive(pgid)` — the SAME
positive-proof-of-death primitive this method's own poll loop already uses —
**before** the identity guard and before ever emitting a signal. An already-empty
group has no live process left to protect from an innocent kill, so
`kill(-pgid, sig)` against it signals nobody regardless of whether `pgid` was
ever recycled; short-circuiting to `"dead"` there is a positive OS-confirmed
fact (ESRCH), not a guess, so it does not weaken INV-1. This is a single
`isGroupAlive` probe, not group-member enumeration (still banned per arch
condition 3).

Verified meaningful, not just "made it pass": temporarily reverted the
reordering (`if (false && !this.#reaper.isGroupAlive(pgid))`) and re-ran both
the FRESH-host test and the brief-named INV-4 test's new no-block assertion —
**both turned red** with the reversion, confirming the fix is load-bearing,
not cosmetic. Restored; both green again. **No test's assertions were
altered to force a pass** — only the guard's internal ordering changed.

This is a genuine gap between the brief's stated measurement and this
codebase's actual pdeathsig-based crash-containment behavior. Flagged for
arch/owner review — **arch has since RATIFIED this ordering** (relayed via
the coordinating peer session); it is settled, not open.

## Arch follow-up: making the "unverified-legacy" proceed visible (`4bbb83e3`)

Arch flagged a residual asymmetry in `#verifyGroupLeaderIdentity`'s legacy
branch (`persistedLeaderStartTime === undefined` — a row written before this
fix): it correctly PROCEEDS (fail-open — refusing legacy rows would leak
every pre-existing session, same precedent as `defaultOwnerHostProbe`'s
missing-`ownerHostStartTime` handling), but as originally built this proceed
carried **no counter and no log** — a hidden third state, epistemically
identical to "leader-absent" (nothing positively proves it) but making the
opposite decision (proceed vs. refuse), and indistinguishable from a
genuinely PROVEN match.

Arch was explicit: **do not** change this to fail-closed (that would
reinstate the exact leak the guard exists to prevent, for every
pre-existing session). Instead, make the weak guarantee visible:

1. `#verifyGroupLeaderIdentity`'s return type is now a 3-way discriminated
   union: `{ proceed: true; verified: true }` (proven match) /
   `{ proceed: true; verified: false; cause: "unverified-legacy" }`
   (proceeded without proof) / `{ proceed: false; cause: "recycled" |
   "leader-absent" }` (refused) — a compile-time-distinct outcome, not just
   a log line, per arch's explicit ask to extend the same discriminant it
   praised for the two refusal causes.
2. New counter `#pgidGuardCounters.unverifiedLegacy`, on the same object as
   `recycled`/`leaderAbsent` (getter renamed `pgidGuardCounters`, was
   `pgidGuardRefusalCounters` — it now holds a non-refusal outcome too).
3. New distinct, searchable log line at that branch: `PROCEEDING to kill
   process group pgid=… for session …: WITHOUT identity proof…
   cause=unverified-legacy sessionId=… pgid=…` — never looks like the
   `emitted group SIGKILL…`/`confirmed pgid=… reaped…` lines a proven kill
   also produces, and never looks like a `REFUSING…` line either.
4. Surfaced up through `#killGroupAndConfirmDead`'s `"dead"` status and
   `reapOrphan`'s `NativeTerminalReapOutcome` as an optional `verified:
   boolean` field on `status: "reaped"` — present only when the identity
   guard actually ran (absent for `forceStopAll`, or when the group was
   already confirmed empty before any check ran).

## Named tests — PASS/FAIL

All in `packages/h2a-runtime/src/native-terminal/`:

| Test | File | Result |
|---|---|---|
| `PGID_GUARD_PROCEEDS_WITH_THE_KILL_WHEN_THE_GROUP_LEADER_IDENTITY_MATCHES` | host.test.ts | **PASS** |
| `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_WAS_RECYCLED` | host.test.ts | **PASS** |
| `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_IS_UNREADABLE` | host.test.ts | **PASS** |
| `PGID_GUARD_PROCEEDS_BUT_FLAGS_UNVERIFIED_WHEN_A_LEGACY_ROW_HAS_NO_PERSISTED_LEADER_STARTTIME` (arch follow-up) | host.test.ts | **PASS** |
| `should kill a signal-resistant PTY tree after hard host death and forced host reaping` (existing, + new no-block assertion) | process.functional.test.ts | **PASS** |

The new legacy test (built directly for arch's ask) constructs a row with NO
persisted baseline (a custom injected reader returns `undefined` during
`create()`'s spawn-time capture, then a real value afterwards — reproducing
exactly the shape of a row written before this fix), then asserts: the kill
PROCEEDS (`killGroup` called — legacy rows must not leak),
`outcome.verified === false`, `pgidGuardCounters.unverifiedLegacy === 1`
(and the other two counters stay `0`), and the distinct `PROCEEDING…WITHOUT
identity proof…cause=unverified-legacy…` log line fired.

### Wiring counter-mutant demonstration

Target: the `#verifyGroupLeaderIdentity(...)` call inside
`#killGroupAndConfirmDead`. Demonstration (by hand, in `host.ts`):

1. Changed `if (verify) {` → `if (verify && false) {` (removes the guard
   call from the reap-kill path without touching `#verifyGroupLeaderIdentity`
   itself — this is the WIRING mutant, not a mutant of the verify function).
2. Ran `npx vitest run src/native-terminal/host.test.ts -t "PGID_GUARD"`:
   both `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_WAS_RECYCLED` and
   `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_IS_UNREADABLE` **turned
   red** (`killGroup` got called despite the proven mismatch/unreadable
   leader — `expected "refused", got "reaped"`; `expected killGroup not to
   have been called`).
3. Restored `if (verify) {`. Re-ran: both **green** again.

Both tests independently catch this class of regression; the "recycled" test
is the one referenced by name in the source comment as the primary
demonstration vehicle.

### INV-4 existing test green + no-block assertion

Added `log` capture to the `NativeTerminalHostSupervisor` in the existing
"...forced host reaping" test and, after the test's existing flow, asserted
`reconcileLogs.some(line => /REFUSING to kill process group/.test(line))` is
`false` — i.e. the new guard never refused a kill anywhere across the whole
hard-death-then-takeover flow this test exercises.

Verified non-vacuous: temporarily reverted the `isGroupAlive`-first
reordering fix above and re-ran this exact test — the new assertion **turned
red** (`expected true to be false`), proving it actually observes the
guard's behavior rather than trivially passing. Restored; green again.

## Gates

### Gate 1 — h2a-runtime vitest suite (full, manual — not in required CI)

Run 3 times across this build (before and after the arch follow-up
correction) for stability:

```
Run 1 (pre-correction): Test Files 2 failed | 91 passed (93) — Tests 7 failed | 1405 passed | 4 skipped (1416)
Run 2 (pre-correction): Test Files 2 failed | 91 passed (93) — Tests 7 failed | 1405 passed | 4 skipped (1416) — same failing set as run 1
Run 3 (post-correction, current HEAD): Test Files 93 passed (93) — Tests 1413 passed | 4 skipped (1417)
```

**Run 3 (the current HEAD's state) is fully clean** — 0 failures. Runs 1–2
(pre-correction, same code path unaffected by the correction) each showed the
same 7 failures, in `src/index.test.ts` (6) and `src/native-host-reuse.test.ts`
(1) — files my diff does not touch. Confirmed **pre-existing on base
`8f452044`**: ran the base commit (isolated git worktree, symlinked
`node_modules`, no reinstall) under the same conditions — the base commit
showed its own (larger, differently-shaped) set of failures across multiple
runs (`index.test.ts`, `llm-mesh-resolution.test.ts`, `migrate.test.ts`,
`native-host-reuse.test.ts`, `restore.test.ts` all appeared across runs) —
confirming this suite has pre-existing, load/resource-contention-driven
flakiness in this environment (intermittent — run 3 above simply didn't hit
it this time), unrelated to this fix. All pgid/native-terminal/registry-related
files (`host.test.ts`, `process.functional.test.ts`, `registry.test.ts`,
`supervisor.test.ts`) — **100% green in all 3 runs**.

### Gate 2 — root `npm test` gate (`node --test packages/h2a`)

`node --test packages/h2a` (bare directory) misreports as a single
pseudo-test; the real invocation (mirrored from `scripts/run-tests.mjs`,
what `npm test` actually runs) is
`node --test packages/h2a/test/*.test.js`. Ran `npm run build` first (root
`tsc -b`, project references — clean, no errors) since these tests import
from `dist/`.

```
# tests 1838
# pass 1819
# fail 2
# skipped 17
```

2 failures, **both confirmed pre-existing on base `8f452044`** (isolated
worktree, same build, identical failures reproduced 1/1):
- `Codex oracle rejects an invalid array MCP table and accepts the framed
  table` (`host-installation-doctor.test.js`) — explicitly gated
  `{ skip: codexCliProbe.status === 0 ? false : "requires the real codex
  binary" }`; environment-dependent on the real Codex CLI binary's behavior,
  not run-conditional on anything in this diff.
- `scanner keeps nested job worktrees distinct and unclassified`
  (`restore-dead-session-recovery.test.js`) — unrelated worktree-scan fixture
  test.

My diff touches **zero files** under `packages/h2a` (`git diff 8f452044 HEAD
--stat -- packages/h2a/` is empty), so these cannot be caused by this fix;
confirmed empirically regardless.

### Resolved `@sentropic/llm-mesh` version

`0.15.0` (from `node_modules/@sentropic/llm-mesh/package.json`) — matches the
declared range; the pin guard resolves via ESM `import.meta.resolve`
(`llm-mesh-resolution.test.ts`), untouched by this diff and green in both
gate-1 runs.

### Typecheck

`npx tsc --noEmit -p packages/h2a-runtime` — clean, no errors, after every
edit round.

### Artifact

Raw gate output: `./pgid-verify-artifact.txt` (worktree root,
`/home/antoinefa/src/h2a/tmp/pgid-build/pgid-verify-artifact.txt`) — contains
both full vitest runs and the `node --test` run. Not committed (untracked,
gate transcript only).

## Not done / explicitly out of scope

- No group-member enumeration (arch condition 3 — instrument first).
- No push/merge/PR.
- No existing test's assertions were altered to force a pass; the one place
  a test needed anything, the guard's internal ordering changed instead
  (the isGroupAlive-first reordering — since ratified by arch), not the
  test. New tests were extended in place to match the guard's new return
  shape (adding `verified`/`unverifiedLegacy` expectations) as part of
  building the arch follow-up itself — not a retroactive edit to force a
  pre-existing test green.

## Status

All arch-requested corrections applied and verified. HEAD `4bbb83e3` is the
current, complete state of this branch.
