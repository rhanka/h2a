# pgid-recycling-guard — BUILD REPORT

Branch `fix/pgid-recycling-guard`, off main `8f452044`. HEAD (this build):
**`950aa1f8`**. NOT pushed, NOT merged, NOT a PR.

## Files changed (vs `8f452044`)

```
packages/h2a-runtime/src/registry.ts                                |  51 ++-
packages/h2a-runtime/src/native-terminal/host.ts                    | 400 +++++++++++++++++++--
packages/h2a-runtime/src/native-terminal/host.test.ts                | 310 ++++++++++++++++
packages/h2a-runtime/src/native-terminal/process.functional.test.ts  | 114 ++++++
pgid-BUILD-REPORT.md (this file)                                     | new
pgid-verify-artifact.txt (gate transcript, committed)                 | new
6 files changed, 853 insertions(+), 22 deletions(-) [packages/ only]
```

9 commits on top of `8f452044` (chronological):
1. `d1573952` — core INV-4 fix: `pgidLeaderStartTime` persisted next to
   `pgid`, re-verified before `killGroup(pgid)`.
2. `ca31dba8` — `isGroupAlive`-first reordering (ratified by arch).
3. `40cfea6f` — first round's named tests.
4. `e55b5a59` — build report round 1.
5. `4bbb83e3` — `unverified-legacy` visibility correction (counter + log +
   `verified` field).
6. `c3dc26b8` — build report round 2.
7. `7d186564` — **this round**: the group-carried session-token anchor.
8. `72a92f68` — **this round**: token-verified / membership-unprovable tests.
9. `950aa1f8` — **this round**: the mandated real leader-dead-orphan
   invariant test. Current HEAD.

Rounds 1–2 (commits 1–6) are settled/ratified and summarized briefly below;
this report focuses on round 3 (the token anchor), which is what arch's
latest brief (`BRIEF-pgid-token-anchor.md`) requested.

## Round 3 — why round 2 (`c3dc26b8`) was insufficient (MEASURED)

The leader's start-time alone cannot discriminate a true orphan from a
recycled pgid **when the leader itself is gone**: `#readLeaderStartTime(pgid)`
returns undefined either way, and round 2's guard refused BOTH cases
identically (`leader-absent`). That refusal defeated `reapOrphan` for the
**ordinary** case it exists to collect: a shell that exits normally leaving a
backgrounded descendant (`cmd &`, then the shell returns) — leader gone,
group alive, no containment (pdeathsig) ever triggered (pdeathsig only fires
on a HOST death, not when the leader alone is killed or exits on its own).

This was confirmed as a real defect, not a flake: node-22 CI went red on
`should let a FRESH host … reap it from its durably persisted pgid after
brutal host death` — `expected "reaped"`, `received "refused"`,
`cause=leader-absent` — a genuine pdeathsig mid-cascade timing window where
the leader had already exited but a descendant had not yet been collected.

## Round 3 design — group-carried session token

**At spawn** (`create()`): generate `groupToken = randomUUID()` and inject
`H2A_SESSION_TOKEN=<token>` into the spawned tree's own environment (inherited
by every descendant — the spawner is now called with
`env: { ...options.env, H2A_SESSION_TOKEN: groupToken }`). Persisted on the
SAME durable write as `pgid`/`pgidLeaderStartTime` — a new optional
`RegistryEntry.pgidGroupToken` field, threaded through
`persistNativeTerminalPgid` (6th param) and read back by
`readNativeTerminalPgid`/`NativeTerminalPgidLookup.groupToken`. No new
persistence path.

**`#verifyGroupLeaderIdentity`'s new decision order** (leader branches
UNCHANGED from round 2; only the "leader absent" branch is new):

1. Leader **readable**, no start-time baseline persisted → PROCEED, cause
   `"unverified-legacy"`, `verified: false` (unchanged from round 2).
2. Leader **readable**, start-time **differs** → REFUSE, cause `"recycled"`
   (unchanged).
3. Leader **readable**, start-time **matches** → PROCEED, `verified: true`
   (unchanged).
4. **Leader absent** (NEW — replaces round 2's bare `leader-absent` refusal):
   - no group-token baseline was ever persisted either (a legacy row
     predating even this fix) → nothing to check membership against →
     PROCEED, cause `"unverified-legacy"` (same fail-open bucket as branch 1
     — folds into it rather than inventing a 5th cause, since the mandated
     count is exactly four).
   - a token baseline exists and `groupCarriesSessionToken(pgid, token)`
     finds it on a **surviving member** (enumerates `/proc/*/stat` for
     `pgrp === pgid`, reads each candidate's `/proc/<pid>/environ`) →
     POSITIVE, leader-independent proof of membership → PROCEED,
     `verified: true`, cause `"token-verified"`.
   - a token baseline exists and **no member carries it** → cannot positively
     prove identity by any means → REFUSE, a cause DISTINCT from
     `"recycled"` — `"membership-unprovable"` — its own counter
     (`pgidGuardCounters.membershipUnprovable`), its own loud/searchable log.

`leader-absent` is **retired** as a terminal cause/counter — it is no longer
a final decision on its own; every leader-absent case now resolves into one
of the three outcomes above. `pgidGuardCounters` is now
`{ recycled, membershipUnprovable, unverifiedLegacy, tokenVerified }`.

INV-1 held throughout: proceed ONLY on positive proof (start-time match OR
token found on a surviving member); everything else refuses or fails open
only where round 1/2 already established that precedent for missing
baselines. Kill stays parent-emitted (`process.kill(-pgid, sig)`); the
`isGroupAlive` short-circuit (round 2, ratified) is unchanged and runs before
any of this.

**Declared limits** (in code comments on `groupCarriesSessionToken`, host.ts):
`/proc/<pid>/environ` is readable only for same-uid processes (true here — 
host and every PTY tree it spawns share a uid); a process can rewrite its own
environ, so this is a **non-adversarial** proof — sufficient, because the
threat modeled is the CHANCE of pgid recycling, not an active attacker;
member enumeration runs ONLY on the leader-absent path (rare — the fast
leader-start-time check covers the common case).

## Named tests — PASS/FAIL

All in `packages/h2a-runtime/src/native-terminal/`:

| Test | File | Result |
|---|---|---|
| `PGID_GUARD_PROCEEDS_WITH_THE_KILL_WHEN_THE_GROUP_LEADER_IDENTITY_MATCHES` | host.test.ts | **PASS** |
| `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_WAS_RECYCLED` | host.test.ts | **PASS** |
| `PGID_GUARD_PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN_WHEN_THE_LEADER_IS_ABSENT` (NEW) | host.test.ts | **PASS** |
| `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_LEADER_IS_ABSENT_AND_NO_MEMBER_CARRIES_THE_TOKEN` (NEW) | host.test.ts | **PASS** |
| `PGID_GUARD_PROCEEDS_BUT_FLAGS_UNVERIFIED_WHEN_A_LEGACY_ROW_HAS_NO_PERSISTED_LEADER_STARTTIME` | host.test.ts | **PASS** |
| `should kill a signal-resistant PTY tree after hard host death and forced host reaping` (INV-4, existing + no-block assertion) | process.functional.test.ts | **PASS** |
| `should let a FRESH host … reap it from its durably persisted pgid after brutal host death` (previously node-22-flaky) | process.functional.test.ts | **PASS**, deterministic (see repeated-run section) |
| `should let reapOrphan collect a real orphan whose leader is gone but a live descendant survives it (group-token path)` — **THE mandated invariant test** (NEW) | process.functional.test.ts | **PASS**, deterministic |

`PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_IS_UNREADABLE` (round 2) was
**retired**, not weakened: the bare "leader-absent → refuse" terminal state
it exercised no longer exists in the design (branch 4 above replaces it with
three finer-grained outcomes). Replaced by the two new named tests above,
which exercise its two real successors separately.

### THE mandated invariant test (`process.functional.test.ts`)

Constructs the EXACT ordinary-leak scenario: spawns a real stubborn workload
via a real host process, then `process.kill(leaderPid, "SIGKILL")` —
**directly on the single leader pid**, never `-leaderPid` (that would be the
group kill this test exists to prove works WITHOUT) and never the owning
host (that would trigger pdeathsig containment, collecting the orphan by an
unrelated mechanism and hiding whether the token path itself works). Confirms
the leader is gone AND the descendant/grandchild are still alive (not already
collected) before ever calling `reapOrphan`. A FRESH, never-spawned host then
calls `reapOrphan` and the test asserts `status: "reaped"`, `verified: true`,
AND `pgidGuardCounters.tokenVerified === 1` — proving the reap happened via
the token path specifically, not by accident.

### Wiring counter-mutant demonstration (new token path)

Target: `this.#findGroupMemberToken(pgid, persistedGroupToken)` inside
`#verifyGroupLeaderIdentity`'s leader-absent branch. Demonstration (by hand,
in `host.ts`):

1. Changed `if (this.#findGroupMemberToken(...))` → `if (false && this.#findGroupMemberToken(...))`
   (the token consultation becomes a permanent no-match, exactly as if the
   call were removed from the wiring).
2. Ran `npx vitest run src/native-terminal/host.test.ts -t "PGID_GUARD"`:
   `PGID_GUARD_PROCEEDS_VIA_A_SURVIVING_MEMBERS_SESSION_TOKEN_WHEN_THE_LEADER_IS_ABSENT`
   **turned red** (`expected status "reaped"/verified:true, received "refused"/cause:"membership-unprovable"`).
   `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_LEADER_IS_ABSENT_AND_NO_MEMBER_CARRIES_THE_TOKEN`
   stayed green (unaffected — it already expected no match).
3. Also ran the REAL functional invariant test with the same mutation in
   place: `should let reapOrphan collect a real orphan whose leader is gone
   but a live descendant survives it (group-token path)` **also turned red**
   (`expected "reaped", received "refused"`) — the mutant is caught by both
   the fast unit test AND the real end-to-end invariant test.
4. Restored `if (this.#findGroupMemberToken(...))`. Re-ran both: **green**
   again.

### Existing greens confirmed still green

- 3 prior `PGID_GUARD_*` tests (match/recycled/unverified-legacy): green.
- `isGroupAlive` short-circuit (round 2): unaffected, green — full
  `host.test.ts` suite passes (20/20).
- INV-4 `should kill a signal-resistant PTY tree after hard host death and
  forced host reaping` (with round-2's no-block assertion): green.
- `should let a FRESH host … durably persisted pgid …` (the test that was
  node-22-flaky before round 3): green, and now DETERMINISTIC — see below.

## Decisive step: FRESH-host + the new invariant test, repeated ≥20× on BOTH node-20 and node-22

The node-22 CI failure that bounced round 2 was timing-sensitive
(pdeathsig-cascade race window). Repeated both the previously-flaky
`FRESH host … durably persisted pgid` test AND the new mandated invariant
test 25× each, on both node versions (via `nvm`; `node-pty`'s native binding
is N-API/ABI-stable across both, confirmed loadable on each before testing):

```
node v22.22.1 (this environment's system default — the SAME major version CI red on):
  FRESH-host test:                25/25 passed
  leader-dead-orphan invariant test: 25/25 passed

node v20.20.2 (installed via nvm for this check):
  FRESH-host test:                25/25 passed
  leader-dead-orphan invariant test: 25/25 passed
```

**100/100 across both node versions.** Zero flakes observed.

## Gates

### Gate 1 — h2a-runtime vitest suite (full, manual — not in required CI), node v22.22.1

```
Test Files  93 passed (93)
     Tests  1415 passed | 4 skipped (1419)
```

Fully clean — 0 failures. (Rounds 1–2 measured 7 pre-existing, environment/
load-flaky failures in `src/index.test.ts` and `src/native-host-reuse.test.ts`
— files this diff never touches — cross-checked against base `8f452044` in
an isolated worktree; see round-2 history below. This round's run happened
to hit none of them.)

### Gate 2 — root `npm test` gate (`node --test packages/h2a/test/*.test.js`), node v22.22.1

Rebuilt first (`npm run build` — root `tsc -b`, clean, no errors) so
`packages/h2a`'s tests pick up the round-3 `host.ts`/`registry.ts` changes
via `@sentropic/h2a-runtime`'s rebuilt `dist/`.

```
# tests 1838
# pass 1819
# fail 2
# skipped 17
```

Same 2 failures as round 2, **both already confirmed pre-existing on base
`8f452044`** in an isolated worktree (identical, 1/1 reproduction):
`Codex oracle rejects an invalid array MCP table…` (explicitly
`{ skip: … "requires the real codex binary" }`-gated) and `scanner keeps
nested job worktrees distinct and unclassified` (unrelated worktree-scan
fixture). This diff touches zero files under `packages/h2a`.

### Resolved `@sentropic/llm-mesh` version

`0.15.0` (`node_modules/@sentropic/llm-mesh/package.json`) — matches the
declared range; the pin guard resolves via ESM `import.meta.resolve`
(`llm-mesh-resolution.test.ts`), untouched by this diff, green in gate 1.

### Typecheck

`npx tsc --noEmit -p packages/h2a-runtime` — clean, no errors, after every
edit round.

### Artifact

`./pgid-verify-artifact.txt` (worktree root) — contains every gate run
across all three rounds, including this round's full vitest run, the root
build + `node --test` run, and the node version markers.

## Not done / explicitly out of scope

- No group-member enumeration on the MATCH path (only on the rare
  leader-absent path, as the brief specifies).
- No push/merge/PR.
- No test's assertions were weakened to force a pass anywhere in this round.
  `PGID_GUARD_REFUSES_A_KILL_WHEN_THE_GROUP_LEADER_IS_UNREADABLE` was
  RETIRED, not weakened — its invariant (bare leader-absent refusal) no
  longer exists in the design; it is replaced by two new, more precise
  named tests covering its two real successor states.

---

## Round 1–2 history (settled, ratified — kept for provenance)

**Round 1** (`d1573952`, `ca31dba8`, `40cfea6f`): built the leader-start-time
anchor (`pgidLeaderStartTime`), re-verified before kill; discovered and fixed
a genuine conflict between the brief's literal check-ordering and an
existing test (`isGroupAlive`-first short-circuit, since ratified by arch —
do not revisit).

**Round 2** (`4bbb83e3`): arch flagged that the guard's legacy branch (no
persisted `pgidLeaderStartTime`) correctly proceeds (fail-open — refusing
would leak every pre-existing session) but did so silently, with no counter
and no log — indistinguishable from a proven match. Fixed by extending
`#verifyGroupLeaderIdentity`'s return type to a 3-way discriminant
(`verified: true` / `verified: false, cause: "unverified-legacy"` /
`proceed: false`), a dedicated counter, and a distinct log line.

**What round 2 missed** (why round 3 exists): the leader-start-time anchor
cannot cover the case where the leader is simply gone — this is what round 3
closes with the group-carried session token.

## Status

All arch-requested corrections through round 3 applied and verified. HEAD
`950aa1f8` is the current, complete state of this branch.
