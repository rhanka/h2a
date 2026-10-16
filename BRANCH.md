# Presence and identity liveness — 0.98.6

Branch: `fix/presence-identity-liveness`. Base: `58f111b3` (origin/main at checkout).

## Scope

- Keep MCP heartbeats alive after transient presence write failures; log the failure and retry on the next tick.
- Clean failed atomic publications immediately; collect old orphan presence temporary files.
- Make status/discovery/read calls drive the existing bounded identity retry, retaining permanent-failure and blocker-change gates.
- Reuse the 0.98.6 identity fence recovery. Collect only old dead-holder `.lock.stale-*` archives, never active fences or succession/journal files.
- Refuse live MCP discussion without fresh recipient presence (`recipient_not_live`). Bound mesh initialization/send acknowledgement to 10 seconds (`send_timeout`, delivery unconfirmed).

The parallel `feat/live-cross-cli-messaging` lot owns delivery, host wake and cross-CLI end-to-end measurements. This lot changes only presence/identity and the requested MCP send admission/deadline boundary. `sendLocalMessage` and the CLI retain the existing dormant-deposit contract; MCP opts into live-only admission.

## Isolation and collection invariants

- Repository source builds only, into mkdtemp lanes; temporary HOME, TMPDIR and XDG roots, with the existing forbidden-state/owned-PID guard.
- Targeted test files only. No installed h2a invocation, owner state/workspace, unowned process access, full suite, PR or release. Round 5 explicitly authorizes merging origin/main into this branch.
- GC requires age >=24 hours, regular file, one link, a provably dead PID (ESRCH), and unchanged inode/timestamps before unlink. Presence filenames must also carry an old creation timestamp.
- Retain live/unknown holders, malformed archives, young files, symlinks and linked files. Read-only presence scans disable GC.
- Expiry stays honest during storage failure or disconnection. An MCP reconnect publishes a new session for the same instance; EOF removes the old attachment presence.

## Verification

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
