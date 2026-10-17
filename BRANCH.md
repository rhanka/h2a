# AGY Claude 5.5 model and quota contract

Current owner task: `feat/agy-claude-models`, resumed from `bd29f7b43` with
two uncommitted regression files. Scope: core MCP/doctor, runtime launch argv
and headless supervision, named tests, test inventory, documentation. Historical
branch sections below are inherited context, not this branch's task.

- [x] Explicit Opus/Sonnet 5.5 launch model, stdin prompt, max→high and typed xhigh refusal.
- [x] Build-role opt-in for the AGY Claude pool; reviews/challenges first.
- [x] Quota error/reset/status, no fallback/retry, declared output-file absence.
- [x] Offline fake AGY regressions, MCP late completion polling and doctor status.
- [x] Final Node 22/24: six named runtime files 222/222 per version, three
  CLI/MCP files 34/34 per version; four isolated package typechecks per version.
- [x] Trust-root test file 38/38 on Node 22; zero-Python guard exit 0.
- [ ] Commit, fast-forward push, English PR and per-job CI report.
- No Track writes or installed h2a/native host/provider access; only temporary
  test roots. Full local suite forbidden; CI/conductor owns integration.
- Review: selection-failed under confinement; no consensus claimed. See
  `docs/reviews/agy-claude-models.md` and `docs/agy-claude-models.md`.

# Inherited branch context from origin/main

# CI job budget — owner request 2026-10-17

Branch: `fix/ci-job-budget`, base `origin/main` at `596363908`.

Scope: `.github/workflows/ci.yml`, `docs/ci-job-budget.md`, this scope record,
`scripts/{report-test-durations,node-evidence-reporter,run-test-gates,run-tests}.mjs`
and `packages/h2a/test/{run-test-gates.test.js,helpers/node-track-observation-lab.js}`
only (the isolated observation lab must resolve the added diagnostic module).
Measure recent main runs,
preserve the complete test commands and required-check names, raise the two
integration job budgets to 25 minutes, and report slow suites from existing
execution evidence before cleanup. No product change or new dependency.

Targeted tests only, disposable HOME/XDG/TMP roots, Node 22/24, red before
green. No installed h2a, native host, owner state, full local suite or `.track`
write. The conductor retains the integration run. Push this feature branch and
open an English PR to main; retain measurements and the French owner report
at the requested scratchpad path.

Harness review dispatch requires installed h2a/mesh, prohibited by the owner's
confinement. Record selection-failed locally and claim no peer consensus.

# P1 — GitHub transport for the injected engram PR sync port

Branch: `feat/live-git-p1-github`; base: `origin/main` (`d2e0cfdc`).
Authority: owner request 2026-10-16, engram plan/09 P1 and LIVE §5,
engram PR #366 (`e432240f`). Cluster-mesh mapping is excluded.

## Scope amendment before implementation

The two host paths in plan/09 are extended only for the explicitly authorized
vendored entry refresh. Fourteen exact files are necessary across a vendoring
prerequisite (11 files) and the host change (3 files). Each commit stays below
the twelve-file ceiling; the complete shared contract closure stays together:

- `BRANCH.md`
- `packages/h2a-runtime/src/gateway-host/live-github.ts`
- `packages/h2a-runtime/src/gateway-host/live-github.test.ts`
- `packages/h2a-runtime/src/gateway-host/live-registration.test.ts` (pinned integrity guard)
- `packages/h2a/src/vendor/engram-live/contracts.js`
- `packages/h2a/src/vendor/engram-live/contracts.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/contracts.js`
- `packages/h2a-runtime/src/vendor/engram-live/contracts.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/registration.js`
- `packages/h2a-runtime/src/vendor/engram-live/registration.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/integration.js`
- `packages/h2a-runtime/src/vendor/engram-live/integration.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/pr-sync.js`
- `packages/h2a-runtime/src/vendor/engram-live/pr-sync.d.ts`

Source: read-only engram `origin/main` at `545a57b8`; fetch is refused by its
read-only mount. Compile the named four neutral entries with TypeScript,
preserve byte identity between core/runtime contracts, pin all runtime entry
digests. No dependency/lockfile change or cross-checkout runtime import.

## Implementation and verification

- Implement `GithubPrTransportPort` using host-approved `gh api`; authentication
  remains wholly in gh. No credential read, token field or stderr disclosure.
- REST all-state listing, no PR ceiling, repository/filter-bound continuations,
  checked Link evidence, strict facts, conditional validators per position,
  safe 304 replay, typed failures and bounded request duration/concurrency.
- Exercise the actual vendored neutral sync engine against a local fake GitHub
  through a temporary fake gh executable. No external network during tests.
- Red before green, guard mutations, targeted Node 22/24 checks only. Every
  fixture uses temporary HOME/XDG roots; close servers and owned children.
- Metadata transport does not acquire Git objects or acknowledge object jobs;
  private-store acquisition/retention and cluster-mesh mappings stay external.
- Push this branch and open an English PR to main; record each CI job and
  remaining gaps in the requested French scratchpad report.

## Review limitation

The harness review requires installed h2a/mesh dispatch, which the owner
explicitly prohibits in this confinement. No external consensus is claimed.

## Evidence

- Vendor refresh RED: 1 failed / 21 passed (new pinned entry set absent).
- Unimplemented transport RED: 39 failed; implemented baseline: 61 passed
  across the transport and L6a registration files on Node 22 and 24.
- Headerless secondary-limit RED: 3 failed / 40 passed; corrected handling
  covers secondary limits and GitHub's abuse-detection refusal without
  exposing response bodies or gh stderr.
- A cached HTTP 304's old terminator was rejected by 2 new RED cases: current
  Link evidence is checked, or pagination is re-proven by unconditional GET.
- Final targeted set: 45 transport cases + 22 registration cases; isolated
  Node 22.22.1 and 24.21.0 runs. No full local suite was invoked.
- Eleven deliberate mutations killed: all-state filter, pagination proof,
  foreign row identity, cursor scope, ETag position, timeout, concurrency,
  secondary throttling, nonzero gh exit on 304, runtime digest, core parity.
- Repository typecheck and strict focused typecheck passed; packed runtime
  is exercised offline and vendor source/dist bytes are compared.
- The exact commands, outputs, pushed SHA, PR and individual CI jobs are
  preserved in the owner's requested `l6p1-report.md` and evidence directory.
- First PR CI correctly refused duplicate HTTP-403 test identities despite
  passing assertions. A focused JSON report reproduced the production
  execution verifier's refusal. Include the headers in parameterized case
  names; re-run that unchanged verifier on the targeted reports.

## Remaining qualification

Production GitHub/gh credentials, installed-host composition/supervision,
private Git object acquisition/retention, 1501-commit traversal, merge-strategy
attribution and cluster-mesh receipts are not qualified by this metadata
transport. The separate receiving lots and conductor integration retain
those gates. No merge, package publication or production activation occurs.

## Co-review gr-conductor — owner scope 2026-10-17

Close every PR #342 finding in the engram owner's co-review:

- Use one newest-first filter for requests and Link validation. A fake server
  actually re-sorts 150 PRs after updating a read row: the old ascending
  transport reports complete with 149 unique PRs, losing the unchanged boundary.
- Accept GitHub's numeric repositories Link path only with matching observed
  base repository ids. Keep that identity with cached pages to validate 304s;
  re-fetch if an empty cached body cannot attest the numeric repository.
- Require prev/first proof after page 1 and terminate only without next on
  that proven page. Preserve GitHub's headerless single-page response and
  unconditional revalidation when a 304 strips current Link evidence.
- Classify bare gh exit 4 as auth_required, bound the page cache to 32 entries,
  and import PrSyncErrorKind from the vendored neutral contract.

Only live-github.ts, its targeted test and this scope record change. Preserve
the interrupted attempt's work; merge origin/main normally, including #350
crash logs, without modifying main. No vendor conflict is expected: the
incoming registration maintenance guard and both provenance sets are retained.
Red/green commands, exact outputs, each CI job and the new head are appended
under "Co-revue gr-conductor" in the owner's existing scratchpad report.
Tests use disposable HOME/XDG directories and loopback fake GitHub only.
Installed h2a/mesh review dispatch remains prohibited by owner confinement;
no new independent consensus or production qualification is claimed.


# Vibe native equipment and registry transition

## Objective
- [ ] Implement validated spec-astra-v9 and close the three Opus v9 minor findings.

# Presence and identity liveness — 0.98.6

## CI compatibility — round 7

Run `38952358867` failed the mint/reclaim signed mesh round trips and the T4
deadline tail on Node 22/24 and npm-test-trust-root. The unchanged two files
reproduce exactly three failures on `12308394` (15/18 pass, zero skips), while
the same files pass 18/18 on `main@d2e0cfdc`. These are obsolete test contracts,
not product defects: the scope below explicitly requires live MCP recipients
and status-driven bounded identity retry.

- The mesh fixture registered a peer without publishing presence, so MCP now
  correctly returns `recipient_not_live`. The fixture's in-process mesh receiver
  now publishes a fresh attachment owned by the actual test PID. Both mint and
  reclaim cases additionally require typed refusal and zero transport puts
  before publication and after close. The delayed ACK, signer identity and
  signed round trip assertions remain intact.
- T4 asserted that status reads never retry, the opposite of the required
  recovery for read-only clients. It now uses status calls alone after release,
  verifies exactly one fresh attempt reaches signing-ready, and retains the
  real 20-second expiry, binding count and distinct identity checks. No signed
  fallback or increased timeout is used in this case. The shared cohort helper's
  comment now acknowledges status-driven recovery and its historical fallback.

Targeted source-build validation (Node 22.22.1), command:
`rtk env TMPDIR=/tmp IDLOCK_SUMMARY=1 node packages/h2a/test/helpers/identity-isolated-run.mjs packages/h2a/test/mcp-mesh-activation.test.js packages/h2a/test/mcp-identity-burst.test.js`.
Red lane `xRByZt`: 18 tests, 15 pass, 3 fail, zero skipped, exit 1.
Green lane `qbiP0D`: 18/18, zero skipped, exit 0. Main control `tlkc9c`
uses the same command with `IDLOCK_CANDIDATE_REF=d2e0cfdc`: 18/18, exit 0.
No product code, CI gate, test inventory or deadline changed; no full local
suite was run. Full TAP and environments: scratch `presence-evidence/tour7/`.

Branch: `fix/presence-identity-liveness`. Base: `58f111b3` (origin/main at checkout).

## Scope / Guardrails
- [x] Branch feat/vibe-host-equip; base origin/main 58f111b3; package 0.98.6.
- [x] Isolated HOME/XDG roots, repository sources only, named tests, no Python or installed h2a.
- [x] Preserve historical Claude/Codex contracts, guards, customizations and registry prerequisites.
- [x] No real-host qualification inferred from fixtures; Muse/agy M-B remains required.
- [x] Track imports reserved for the conductor in this concurrent worktree.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/{src/hosts,src/cli.ts,src/runtime/{mcp,upgrade},skills,hooks,scripts,test,package.json}, scripts, docs, package-lock.json, BRANCH.md.
- [x] Forbidden: main, owner configuration/state, installed distribution, .track writes, unrelated fixes.
- [x] Conditional: CI wiring for named tests and Node 22/24 parser checks only.

## Lots
- [x] A1: isolated source runner and historical render catalog/generator; offline tests 2/2.
- [x] A2: safe native artifact writer, TOML 1.0 validation, ownership/backups/concurrency.
- [x] A3: Vibe guard/lifecycle wrappers and independent qualification freshness; hooks 2/2, convergence 2/2.
- [x] A4/E: skills/resources, VIBE_HOME, Muse and shared agy/Gemini ownership.
- [x] A5/E: doctor/status/install/plugin convergence and setup/connect diagnostics.
- [x] A6: explicit upgrade convergence and in-memory MCP operator notices.
- [x] A7/C: opt-in bounded qualification pilot, fork wording and phase-2 budget proof.
- [x] C/code: clean tarball consumers, 17 named files / 93 pass, 0 fail/skip on Node 22.22.1 and 24.14.0; four package typechecks on both.
- [x] Opus minors: mandatory doctor diagnostic oracle; corrected two-session phase-2 double with inclusive child accounting; session/fork default attachment wording.
- [ ] C/acceptance: genuine native observations/config persistence and author-complementary harness consensus remain unqualified.
- [ ] Delivery: conventional commits, fast-forward push, English PR, CI/report in French.

- Keep MCP heartbeats alive after transient presence write failures; log the failure and retry on the next tick.
- Clean failed atomic publications immediately; collect old orphan presence temporary files.
- Make status/discovery/read calls drive the existing bounded identity retry, retaining permanent-failure and blocker-change gates.
- Reuse the 0.98.6 identity fence recovery. Collect only old dead-holder `.lock.stale-*` archives, never active fences or succession/journal files.
- Refuse live MCP discussion without fresh recipient presence (`recipient_not_live`). Bound mesh initialization/send acknowledgement to 10 seconds (`send_timeout`, delivery unconfirmed).

The parallel `feat/live-cross-cli-messaging` lot owns delivery, host wake and cross-CLI end-to-end measurements. This lot changes only presence/identity and the requested MCP send admission/deadline boundary. `sendLocalMessage` and the CLI retain the existing dormant-deposit contract; MCP opts into live-only admission.

## Isolation and collection invariants

- Repository source builds only, into mkdtemp lanes; temporary HOME, TMPDIR and XDG roots, with the existing forbidden-state/owned-PID guard.
- Targeted test files only. No installed h2a invocation, owner state/workspace, unowned process access, full suite, PR or release. Rounds 5 and 6 explicitly authorize merging origin/main into this branch.
- GC requires age >=24 hours, regular file, one link, a provably dead PID (ESRCH), and unchanged inode/timestamps before unlink. Presence filenames must also carry an old creation timestamp.
- Retain live/unknown holders, malformed archives, young files, symlinks and linked files. Read-only presence scans disable GC.
- Expiry stays honest during storage failure or disconnection. An MCP reconnect publishes a new session for the same instance; EOF removes the old attachment presence.

## Feedback Loop
- [x] B receipt discovery/API not accepted: no production reader or invented MCP writer.
- [x] Native target-host qualification and common RC-3 remain external acceptance gates.
- [x] bwrap unavailable; scoped shell calls require reviewed escalation.

## Delivery evidence
- [x] Two confined technical reviews reconciled in docs/reviews/2026-10-16-native-host-equipment.md; no harness consensus claimed.
- [x] Main inherited red: CI 38885431018, npm-test-trust-root B5 harmless proc entry case 2; legacy inventory 250ms exceeded. No guard weakened.
- [ ] B/R5/R7 receipt API, target-post Vibe qualification, Muse/agy M-B and common RC-3 remain external; A/E does not close the original MCP demand.

## Integration with refreshed main
- [x] Merge origin/main d2e0cfdc (PR 339 CI fixes); keep exact lockstep pins and vendored live-copy build step.
- [x] Track tree identical on both parents (3f3318b40d597af507216a184b9bd0e054987168); no Track repair/import/consolidation in this concurrent conductor-owned store.
- [x] CI-revealed help golden, documentation status and Focus dependency fixture corrected; three named files: 19/19 on Node 22 and 24.
- [x] Merge origin/main c771395a (PR 341 presence/identity liveness); conflict in BRANCH.md and h2a_identity_status resolved keeping both behaviours (operator notices + status-driven retry).

## PR 340 — Tour 2
- [x] Review finding 1: real identity/session/Track handler oracle, bounded supported CLI probe, component-based report/exit status and private Track workspaces.
- [x] Review findings 2/3: separate project installation with resources; managed force/conflicts; obsolete known-hash cleanup; relative manifests and one shared Gemini/agy owner with legacy-layout adoption.
- [x] Review finding 4: re-read qualification after repair; fingerprint discovery and actual installed bytes; suspend an enabled guard on project masking.
- [x] Review finding 5: stable hook insertion order and exact separator removal, including older rendered blocks.
- [x] Historical overwrite test restored for Gemini and extended to Vibe/Muse/agy; independent user-scope managed/unknown-provenance assertions retained.
- [x] CI trust-root integration: versioned inventory follows the two corrected test names and requires the new regressions; run-test-gates.test.js reproduced 37/38 then passed 38/38 on Node 22 and 24 in temporary source/HOME copies.
- [x] Direct CI blocker, bounded scope extension: gateway-host/live-registration.test.ts fixtures disable automatic Git maintenance/GC. TRACE2 reproduced two detached maintenance children before the fix (22/23); targeted file passes 23/23 on Node 22 and 24 after the fix. The strict inventory of every observed repository/Git file is retained; no production behavior changed.
- [x] Named source-consumer regression campaign: 22 files, 135 passed / 0 failed / 0 skipped on Node 22 and 24; targeted MCP compatibility: 16 passed / 0 failed / 0 skipped.
- [x] Obsolete-file cleanup requires a complete source inventory: missing packages report failure and preserve previously managed skills (red 16/17, then 17/17); versioned inventory, 22-file matrix and four package typechecks reverified.
- [x] Fetch/merge origin/main: already contained by the normal two-parent merge 53cfa83f; Track tree still identical to origin/main. No Track writes or consolidation by this worker.
- [ ] Real equipment: A/E distributes skills/resources/hooks; B (C contract §§8–11, R5/R7 bootstrap/attachment) delivers the actual MCP route; C/spec §§11–12 qualifies the target post. The owner's skills + MCP demand remains open until B and the genuine Vibe recipe pass.
- [ ] Harness consensus: exact author model/effort unavailable and installed MCP dispatch forbidden; selection-failed, no consensus claimed.

| Evidence | Result |
|---|---|
| New regression files against original HEAD, lane BR9xYC | 12 tests, 1 pass, 11 fail, 0 skipped |
| Punctuated historical archive suffix regression, lane Fp9xl8 | 11 tests, 9 pass, 2 fail, 0 skipped |
| Eleven targeted files on final sources, lane RQHurs | 96 tests, 96 pass, 0 fail, 0 skipped |
| Isolated typecheck of RQHurs | track, remote-protocol, h2a, h2a-runtime: exit 0 |

Run tests through `packages/h2a/test/helpers/identity-isolated-run.mjs` with explicit file arguments. The selected files are presence-identity-liveness, presence-identity-recovery, identity-state, send, mcp-sessions, mcp-stdio, presence-workstatus, identity-lock-recovery, identity-lock-mcp-v6, cluster-mesh-messaging and presence-confidence (`packages/h2a/test/*.test.js`).

The real-process regressions cover an injected heartbeat write failure while MCP still answers, and a live v2 holder that times out, dies without unlinking its fence, then is reclaimed by a second real identity worker triggered by status alone. Every fork is awaited during teardown.

## Limits and review

- No nine-hour soak or reproduction on the real Antigravity/Claude host. The reproduced failure routes explain code defects, not an attestation of the exact field incident.
- No end-to-end cross-CLI delivery qualification or Darwin/Windows qualification; the conductor owns integration.
- An already dispatched mesh operation has no cancellation contract. Timeout bounds the response and reports unconfirmed delivery; it cannot assert non-delivery or safe automatic retry.
- The required peer review could not be dispatched under owner confinement. See `docs/reviews/presence-identity-liveness.md`; no consensus is claimed.

## Review fixes — round 2

Independent review supplied by the owner: `revpresence.md`, verdict NON-FUSIONNABLE.
All three blocking findings were reproduced before source changes and corrected:

| Finding | Commit | Regression |
|---|---|---|
| P1: unprotected notification tick kills MCP on scan EIO | `46a496ee` | `presence-scan-recovery.test.js`: real MCP survives, next scan emits the missed peer notification, heartbeat advances, initialize responds; throwing sink/error reporter also recovers |
| P1: scan deletes a heartbeat published after its stale read | `bf0d0c0c` | `presence-sweep-race.test.js`: expired, malformed and EIO snapshots each replaced by a verified fresh publication before scan continuation |
| P2: fresh local presence from a dead PID passes live admission | `97e75967` | `presence-live-admission.test.js`: real exited PID refused on both backends before side effects, real in-memory mesh, live recovery, invalid/missing PID, alias filtering, EPERM/unknown probe errors, mirrored PID never probed locally |

The safe scan contract filters expired/malformed records without unlinking published paths.
A stat/read recheck would still leave a check-to-unlink race; no such partial fix is claimed.
`sweep` now controls orphan temporary-file GC only; explicit owner close/reap stays separate.
The former removal assertion in `mcp-sessions.test.js` now checks filtering, unchanged stored
bytes and rediscovery after refresh. The send fixture publishes its actual test PID because
MCP live admission now requires proof of a local owner (legacy missing-PID records are refused).
Mirrored records retain the remote heartbeat contract and never undergo local PID probing.
The dormant API/CLI contract remains unchanged; local PID existence cannot prove an active
MCP consumer, prevent later process death, or distinguish PID reuse.

Repro lane `np5rWT`: 12 tests, 1 control pass, 11 expected failures, zero skipped.
P1 scan lane `syuEEY`: 18/18. P1 sweep lane `v2De7L`: 31/31.
P2 admission lane `VEYUws`: 42/42. Final lane `Hd56eN`: 120/120 across sixteen
explicitly named files; zero failures/skips. Node 22.22.1. Four isolated package typechecks
exit 0: track, remote-protocol, h2a, h2a-runtime. Tests ran only through the isolated source
build helper with temporary HOME/TMPDIR/XDG roots and the forbidden-path/owned-PID guard.
Audit of 92 recorded test PIDs: none alive, no probe errors.
Command/output evidence is in the owner's scratch report `presence-report.md`, section Tour 2,
and `presence-evidence/tour2/`. No global suite or real-host validation was run.

The prior reconnect test already passed on the base; it is compatibility coverage, not a
newly fixed regression. No second independent review or multi-peer consensus is claimed;
the installed h2a MCP review launch path remains forbidden. See the review dossier.

## Review fix — round 3

Owner-supplied `revpresence2.md` retained one P2: PID filtering removed display
names before resolution, so a known dead peer returned an unqualified/phantom
error rather than the typed `recipient_not_live` refusal.

Fixed in `87d88fa1`: resolve living owners first; when no living candidate is
resolved, use the fresh records only to recover a unique known name/alias for
the existing admission check. That check still uses only qualifying live owners
and runs before signing, inbox writes or mesh dispatch. Living candidates and
their ambiguity retain priority; unknown/malformed targets keep addressing errors.
The same defect affected an unregistered peer's host:label alias and is covered
on both backends. Other CLI/MCP resolver callers do not prefilter owner PIDs;
the dormant deposit contract and the shared address resolver remain unchanged.

| Targeted isolated validation | Observed result |
|---|---|
| New regressions on unchanged pre-fix sources (`954cdc10`, lane `myhpNJ`) | 13 tests, 7 pass, 6 expected failures, 0 skipped; exit 1 |
| Admission file after fix, including two added compatibility controls (`d1EMBr`) | 15/15, 0 skipped; exit 0 |
| Five named files: presence-live-admission, send, wp2-resolve-before-send, presence-identity-liveness, cluster-mesh-messaging (`B130fd`) | 88/88, 0 skipped; exit 0 |
| Isolated typecheck of the same final build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |
| Audit of recorded test PIDs across the three lanes | 44 checked, none alive |

The four display-name regressions send successfully through the same name while
a real child owner lives, terminate and await that child, then check typed refusal
without inbox/mesh effects and successful recovery with a live attachment.
Two further regressions cover unregistered aliases. Compatibility checks preserve
live names over dead duplicates, live ambiguity even with a dead alias, and
unknown/malformed errors. Node 22.22.1; temporary builds/HOME/XDG roots and the
owned-PID/forbidden-path guard. Commands, full TAP, environments and source hashes
are in the owner's scratch report, Tour 3, and `presence-evidence/tour3/`.
No full suite, real owner state, installed h2a, Python or independent consensus
review. Node 24, other OSes, nine-hour endurance and cross-CLI delivery remain
unqualified in this round. The installed MCP review launch path remains forbidden.

## Review fix — round 4

Owner-supplied `revpresence3.md`: NON-FUSIONNABLE, one P2. A known display name
lost `recipient_not_live` after TTL expiry. Fixed in `7271e66251ccb2a346c5a1c1fb1c889b316d5b7b`.

Addressing evidence now survives independently of session liveness in
`<root>/recipient-hints/`: atomic, deduplicated instance/name records, retained
without a TTL. Publications remember their recipient; explicit close/reap also
preserves legacy publications before unlink. Only the refusal path reads hints,
expired publications and registration names. Live resolution retains priority;
historical resolution can only throw `recipient_not_live`, never admit delivery.
Duplicate evidence for one canonical instance is one diagnostic candidate;
distinct historical identities remain ambiguous. Dormant CLI/API unchanged.

| Isolated targeted verification | Observed output |
|---|---|
| Initial table on unchanged round-3 source, `ZcRA35` | 27 tests, 15 pass, 12 expected failures, 0 skipped; exit 1 |
| Complete regression file on exact `a2297c25`, `eIl6Gs` | 45 tests, 15 pass, 30 expected failures, 0 skipped; exit 1 |
| Nine explicitly named files on final sources, `ikccGb` | 140 tests, 140 pass, 0 fail, 0 skipped; exit 0 |
| Typechecks of that temporary build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |
| Audit of all six campaigns' recorded test PIDs | 183 checked, none alive |

The table covers bare/legacy-prefixed names, local/mesh, fresh-dead/expired/
removed/GC-swept sessions, success with the real child owner alive, no refusal
side effects, reopened stores and recovery. Controls cover TTL alone with a
living PID, renamed living instances, pre-upgrade records, registration-only
names, unregistered aliases, duplicate evidence, ambiguity and unknown targets.
One intermediate run had two missing-directory fixture errors; excluded from
product regression proof and recorded in scratch `presence-evidence/tour4/runs.md`.
Source hashes, full TAP, environments and process audit accompany that file.

No full suite, owner state, installed h2a, Python or process discovery. Node
22.22.1 only; other runtimes/OSes, field incident, endurance and cross-CLI E2E
remain unqualified. Already erased pre-upgrade names absent from registrations
cannot be reconstructed. New hints intentionally outlive session collection;
they contain no PID, heartbeat, key or launch context. No new independent
consensus review: installed MCP dispatch remains forbidden by the owner.


## Review fix — round 5

Owner-supplied revpresence4.md: NON-FUSIONNABLE, one P2 at presence.ts:79.
Accepted and reproduced: a history EIO after publishing presence left deferred
identity permanently failed (session_open_failed, retryable:false), with no
registered session or heartbeat. Fixed in 14b3aaa61ebba509a06419a75dfa33cdc70af883.

Recipient history is now best-effort at its read/write boundary. No history
failure escapes into open, heartbeat, close or reap; directory read failure
returns no diagnostic evidence. One attempt per call, no synchronous retry.
Reads are limited to 16 KiB per regular file (including growth after stat),
and directory walks to 1,024 entries. New hints are forgone when that observed
capacity is reached; unchanged hints still use the direct read fast path.
The cap is an observed admission budget, not a lock across concurrent writers;
pre-existing excess is not deleted. No TTL or liveness permission is added.
Oversized/malformed evidence is ignored; a later successful heartbeat can
repair/recreate hints. A non-file entry cannot block session lifecycle.

Normal merge aed130eb5532f9b8da50f15269bf633608b15e94 incorporates
origin/main at 7d87b4fba1734cf6d98341edbfd374f2530fa1af, with no conflict.
The merge and both parents have the identical Track blob. Source-built Track
events-contains independently confirms all 1,512 events from each parent.
Read-only query/report at the merge found 69 done items without fresh acceptance;
they remain NOT consolidated — to treat by the designated conductor/writer.
This concurrent worktree does not append or consolidate the shared journal.

| Isolated targeted verification | Observed result |
|---|---|
| Final regression file on exact pre-fix merge aed130eb (VJbyY9) | 12 tests, 12 expected failures, 0 skipped; exit 1 |
| Same regression file and eleven compatibility files on final sources (9OPDPN) | 169/169, 0 failures/skips; exit 0 |
| Typechecks of the same temporary build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |

The fault table covers one-shot read/rename EIO during real identity-worker
activation, persistent ENOSPC while MCP heartbeats and answers initialize,
manual open/touch/close under open/write/close/rename/mkdir errors, unreadable
history directories, malformed JSON, a file replaced by a directory, oversized
records and capacity exhaustion. Tests check actual injection hits, EOF removal,
later history recovery and temporary-file cleanup. Every real worker is awaited.
Commands, full TAP, source hashes, temporary environments, Track output and the
owned-PID audit are retained in scratch presence-evidence/tour5/. Final runtime:
Node 22.22.1. No full suite, real owner state, installed h2a or Python.

No independent review consensus is claimed: the installed MCP dispatch required
by harness-review remains forbidden by the owner. Full integration, Node 24,
other OSes, nine-hour endurance and cross-CLI delivery/wake remain unqualified.
At capacity or on failure only historical refusal detail can be lost; live
admission still requires fresh qualifying presence. Under concurrent writers the
observed entry threshold may be exceeded; each traversal/read remains bounded.


CI exposed additional blocking fixtures after the historical builds ran:
the namespace registry parent was absent, the reaper probed a group before
checking its frame, mandatory host configuration oracles were not installed,
the 30x24 lock stress reloaded the full API per worker, and Node 24 selected
the spec reporter for a nested timeout proof. Targeted checks cover the fixes;
the stress load and 120-second deadline stay unchanged. The single local full
run passed before these CI follow-ups; final acceptance belongs to head CI.


## Main CI repair — 2026-10-16

Current branch: `fix/main-ci-green`, based on `origin/main` at `58f111b3`.
Owner scope supersedes the historical branch's dependency-range restriction:
repair B5 scheduling, restore the exact published R6 pair, and pin internal
h2a / h2a-cli / h2a-runtime / track dependencies and peers to exact versions.
Keep release preparation, lockfile and release/rehearsal gates in lockstep.

- B5 is a scheduling-dependent test assumption: a 300 ms pause reproduces
  the CI's 250 ms incomplete-inventory refusal. Completeness uses a test-only
  monotone clock. Six boundary cases retain refusal at and beyond both the
  inventory cap and a shorter attempt deadline; product evidence is unchanged.
- R6's published core 0.98.5 must install runtime 0.98.5 explicitly; both
  real election orders fail before the pin and pass after it.
- Exact internal requirements prevent future npm resolution from combining
  incompatible patch releases. Version preparation preserves pins, and
  release verify/publish reject floating or mismatched internal requirements.
- Targeted source-built identity lane: 70 passed, 0 failed/skipped.
  Release helper/workflow/order checks: 60 passed, 0 failed/skipped.
  Red/green commands and outputs are retained in the owner's final report.

Only named test files run locally under temporary HOME/XDG/H2A roots. No
installed h2a, native host, foreign PID, full local suite, merge or publication.
CI on the PR is the integration authority. External review through the real
h2a/mesh is excluded by the owner's confinement; no consensus is claimed.


## Main CI repair — Tour 2

Owner scope: integrate #338 and origin/main (#333) through normal merge
commits, without rebase or force-push. This supersedes the historical merge
restriction above. No merge into main or real publication is authorized.

The rejected offline workaround is removed. Rehearsal stamps the disposable
CI workspace after build and before pack with
`<version>-rehearsal.<run_id>.<attempt>`, rewriting all internal manifest pins
and the independent smoke literal. The exact-version gate still runs before
pack and accepts those exact prerelease pins. Release manifests and lockfile
stay at 0.98.6 in git; the real release path is unchanged.

Publish parity permits only --dry-run and the explicit default prerelease
tag; no offline/cache exception remains. Execution tests retain all four
publish bodies, default/backfill selection and npm failure propagation.
The owner report records strict-test red/green, broken-package rejection,
targeted regressions and final PR CI. No full local suite is authorized.


## RC on npm next — owner decision 2026-10-16, part B

Branch: feat/release-rc-next, based on origin/main at d2e0cfdc.
Owner scope: require a successful same-source-tree RC before every stable
release; no tag push, npm publication, main write or full local suite.

- Keep stable versions in Git; stamp disposable RC manifests, all internal
  exact pins and the independent artifact smoke literal after the test gate.
- Publish the four verified tarballs on next only for vX.Y.Z-rc.N, preserving
  the same verify/pack/smoke and strict publish-rehearsal body parity.
- Record a repository/run/attempt/commit/tree attestation only after completed
  post-publish install/doctor smoke, all four next tags and registry integrity
  matching the verify-built tarballs. This also protects idempotent skips.
- Stable publication (backfill included) requires a successful RC push run
  from release.yml, a nonexpired artifact for its current attempt, matching
  release train/tree and corroboration from GitHub's Git commit API.
- Operator docs require owner installation of @sentropic/h2a@next and a real
  machine reboot before tagging the stable version on the same merged commit.

Targeted red/green evidence is retained in tmp/release-rc-evidence and in the
owner's requested scratchpad report. npm/GitHub publication is simulated;
GitHub metadata inspection is read-only. No installed h2a is invoked locally.
Native h2a/mesh consensus review is excluded by the owner's confinement;
review metadata/eligible hosts cannot be established, so no consensus is claimed.
CI on the PR is the integration authority; machine reboot remains owner UAT.

## RC review reserves — owner scope 2026-10-16

Close both P2 findings from the independent review of PR #345: document the
explicit exact-version stable installation after publication because upgrade
rejects prerelease versions, and make generated release instructions follow
RC publication, attestation and owner reboot acceptance before the stable tag.
Both tags retain signing and target the same verified merged commit.

The operator-flow regressions failed before the fix (27 passed, 3 failed,
0 skipped) and passed after it (30 passed, 0 failed/skipped). Merge origin/main
through a normal merge commit, run named release regression files only, and
push this branch. No main write, tag push, publication or installed CLI run.
Evidence and final CI job results are appended under "Réserves Astra" in the
owner's scratchpad report; physical reboot and real publication remain owner UAT.
## Review fix — round 6

Owner-supplied `revpresence5.md`: FUSIONNABLE-AVEC-RESERVES, one P3.
Accepted and reproduced with three real subprocesses held after actual directory
enumeration: each observes the same 1,023 entries, then the old implementation
publishes all three (1,026 entries). Fixed in `aa16ad17addc1d63f77d03b7fd2fad657b310220`.
This section supersedes round 5's concurrency limitation.

New history uses a fixed pool of numbered slots: one exclusive, non-recursive
mkdir reserves the first missing slot in the bounded snapshot. Contenders for
the same snapshot make one attempt at the same slot; losers return immediately.
With L stable legacy entries, admission can only claim slot indices below
1,024-L. Arbitrary interleavings of updated writers therefore cannot grow a
directory initially within capacity beyond 1,024 places. Each slot contains at
most one temporary or published file; no extra temporary file sits outside its
reservation. Legacy hints remain readable and oversized/corrupt legacy files
are repaired atomically through a reserved temporary place. Existing excess is
not evicted, and receives no new places. No dependencies or global lock added.

An interrupted writer can consume one place but cannot lock out the remaining
pool. Failed writes clean their temporary and empty reservation best-effort;
incomplete places count against capacity and never become addressing evidence.
Overlapping identical publications are deduplicated on read. No history record
admits a send; unchanged live-admission and dormant API contracts still apply.

Normal merge `a99919956c594733e51fcd2ba230c172484038e9` incorporates origin/main
`d2e0cfdc069f5714bc3d15ce75eb07ac7c1c240c` (#339). The sole conflict was in
BRANCH.md; both contents were preserved. Exact internal dependencies/peers and
lockfile remain at 0.98.6. Track events-contains confirms all 1,512 events from
each parent. Read-only query/report on a temporary copy still exposes 69 done
items without fresh acceptance: NOT consolidated — to treat by the designated
single writer/conductor, with no journal edits in this concurrent worktree.

| Targeted verification | Observed command output |
|---|---|
| Final regression bytes on exact pre-fix merge a9991995 (3SYT0W) | 16 tests, 15 pass, 1 expected failure (1,026 != 1,024), 0 skipped; exit 1 |
| Thirteen named history/presence/send/MCP compatibility files (jReCeb) | 173/173, 0 failures/skips; exit 0 |
| Three named incoming version/release/rehearsal files in the same temporary lane | 47/47, 0 failures/skips; exit 0 |
| Typechecks of the same temporary source build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |
| Spawned-PID audit over all four campaigns plus merge checks | 183 checked, none alive, no errors |

Full commands, TAP, SHA-256 red/green provenance, temporary environments and
process audit are retained in scratch `presence-evidence/tour6/`; owner report
`presence-report.md`, Tour 6. Runtime Node 22.22.1. The final test/helper bytes
are identical on red and green; all tested source bytes match the fix commit.
No full suite, installed h2a, owner state, Python or foreign process access.

No new independent consensus or merge approval is claimed. The required installed
MCP review launch remains prohibited by the owner; the review dossier records
selection-failed. Node 24, other OSes, field/endurance and cross-CLI end-to-end
remain outside this round. Capacity/failure may lose optional historical detail;
the root concurrency defect is fixed without introducing a persistent global lock.
