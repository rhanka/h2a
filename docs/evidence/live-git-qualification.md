# Live Git read-side exploratory timing (L9-H) — `unverified`

Prototype run, NOT installed qualification. Everything below is `unverified`:
no installed reader, no cluster-mesh verification, no operator-level T0.

## Corpus and fixture

- Manifest: `tests/fixtures/live-read-side-cases.json` at engram `02ac925c`,
  sha256 `9fdbb8795c3eaea5cb55a6bec4ca18270a8c5691e7169ca3b56e4087b6fc926c`
  (`manifestPinned: true`, oracle `native-git-read-side/1`).
- Fixtures rebuilt under `$TMPDIR` only (no owner worktree use): the ten
  `F_*` controls were recommitted deterministically and are byte-identical
  to the frozen pins; the engram history was restored from the checksummed
  snapshot pack (`a7f51a4f…`, 6132 objects). All 53 native Git controls
  re-verified (status/bytes/sha256) before timing.
- Harness: `scripts/bench-live.mjs` (prototype `bench-live/1`).
  Expected answers were hashed BEFORE timing and hidden from the timed path
  (`expectationsFrozenAt < timingStartedAt`, `operatorReceivedExpected: false`).
  Evidence JSON carries hashes/counts/OIDs only — no source content.
- T0 is the currently available workflow; this prototype times its native
  Git component on authorized local data. Human document/memory search
  overhead is declared unmeasured, never reduced to bare Git alone.
  T1 is the native service with what is available (authorization pre-check
  plus the same Git controls). Existing planned readers are explicitly
  `reader-absent` (unmeasured), kept separate from native additions.

## Result (20/20 retained, no case removed)

`median(1 − T1ᵢ/T0ᵢ) = −0.21%` over all 20 first investigations at constant
quality (every T1 outcome matched its frozen expectation, including the
explicit non-success states). Fixed threshold `≥ 30%` was NOT retuned:
**continuation: NO**. Per-case timings are millisecond Git-component noise
(±30% swings on 1–11 ms bases), not operator workflow timing.

| No. | Order | State | T0 first | T1 first | Gain | Saving |
|---|---|---|---|---|---|---|
| 1 | T0/T1 | verified | 4.1 ms | 4.0 ms | +1.40% | yes |
| 2 | T1/T0 | verified | 8.3 ms | 8.3 ms | −0.56% | no |
| 3 | T0/T1 | capability-absent (G3, documented) | 6.1 ms | 4.3 ms | +29.70% | no |
| 4 | T1/T0 | verified | 4.9 ms | 4.6 ms | +4.57% | yes |
| 5 | T0/T1 | verified | 11.1 ms | 9.3 ms | +16.06% | yes |
| 6 | T1/T0 | capability-absent (G3, documented) | 5.7 ms | 5.4 ms | +5.32% | no |
| 7 | T0/T1 | capture-absent (recovery retained) | 1.1 ms | 1.0 ms | +6.24% | no |
| 8 | T1/T0 | capability-absent (G3, `inconnu`) | 3.2 ms | 3.6 ms | −12.87% | no |
| 9 | T0/T1 | verified | 3.2 ms | 3.0 ms | +6.71% | yes |
| 10 | T1/T0 | verified | 3.0 ms | 3.1 ms | −5.51% | no |
| 11 | T0/T1 | capability-absent (G3, `inconnu`) | 1.0 ms | 1.3 ms | −31.21% | no |
| 12 | T1/T0 | capability-absent (G3, `inconnu`) | 1.0 ms | 1.0 ms | −10.02% | no |
| 13 | T0/T1 | verified | 8.2 ms | 10.0 ms | −20.99% | no |
| 14 | T1/T0 | capability-absent (G5, no causality) | 1.7 ms | 2.0 ms | −16.34% | no |
| 15 | T0/T1 | verified | 1.2 ms | 1.1 ms | +14.01% | yes |
| 16 | T1/T0 | verified | 2.6 ms | 3.4 ms | −30.86% | no |
| 17 | T0/T1 | verified | 6.6 ms | 6.8 ms | −2.59% | no |
| 18 | T1/T0 | capability-absent (G3, `inconnu`) | 1.5 ms | 1.5 ms | +0.15% | no |
| 19 | T0/T1 | verified | 6.5 ms | 5.9 ms | +9.40% | yes |
| 20 | T1/T0 | `policy-unavailable` (G4, 0 bytes) | 1.3 ms | 1.4 ms | −7.72% | no |

Resources (separate): bootstrap 6.2 ms, CPU 92.1 ms, RSS 70.3 MiB,
storage 1.77 MiB, 216 Git child processes, wall 333 ms.
Warm repeats tracked separately per case; first answers score the median.
Zero errors; zero failed/slow/denied cases dropped (none occurred; the
harness retains them with recovery costs by construction, covered by
`live-read-side.test.ts` case 19/20 mechanics).

G4 (case 20) stays closed: the typed `policy-unavailable` refusal fired
before any content was retained (0 bytes emitted, `countsAsSaving: false`).
Undocumented reasons stayed `inconnu` (cases 8/11/12/18); nothing invented.
No model call, no network, no execution lot; G5 optional and absent.

## NOT covered

- Installed qualification (artifacts, backends, SLO budgets): untouched.
- Cluster-mesh L9-S reader verification and cross-repository generations.
- Any L8 disclosure policy: G4 remains `policy-unavailable` by design.
- Operator-level T0/T1 timing with hidden answers (human workflow): the
  only remaining input to a real continuation decision, with installed
  readers and all applicable engineering/privacy gates.
- Execution pilot (`≥ 20%` additional gain): not authorized, not run.
