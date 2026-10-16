---
status: selection-failed
target-ref: aa16ad17addc1d63f77d03b7fd2fad657b310220
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: Exact author model/effort were not provided; the required installed h2a MCP launch path is forbidden by owner confinement. No peer was dispatched.
legs: []
---

The harness-review skill requires at least two author-complementary peers and says: "Launch only through the installed h2a MCP server's `h2a_run` tool". The owner prohibits reaching the real native host/state or running installed h2a. The exact author model ID and effort are also unavailable; they were not inferred.

Review selection stops here. This dossier records no peer verdict and no consensus. Implementation and the requested isolated verification continue under the owner's explicit task authorization.

Manual checks covered every source hunk, the active-fence/succession exclusion from GC, conservative dead-PID and inode checks, retry admission, typed MCP errors and deadline coverage through backend initialization. Eleven named test files pass (96/96, no skips) and all four isolated package typechecks exit 0.

Remaining qualifications: real-host incident attribution, nine-hour soak, cross-CLI delivery/wake, other operating systems, and cancellation of already-dispatched mesh work. A send timeout leaves delivery unconfirmed.

## Owner-supplied independent review and round 2

The owner supplied `revpresence.md` from an Astra max review of the first round:
NON-FUSIONNABLE, with three blocking findings. This is an external review input,
not two eligible harness legs or an attestation of the reviewer's effective model.
The original first-round target was `b504c12f79f126b92c0c12ed98512edc85da37f0`.
The current target is the three corrective commits through `97e75967`.

| Finding | Disposition | Evidence |
|---|---|---|
| P1: periodic `tick()` unprotected | Accepted and fixed in `46a496ee` | Real MCP scan EIO crashed before; scan/notification/heartbeat/initialize recovery after. Throwing sink and diagnostic covered too. |
| P1: stale snapshot unlink races a fresh heartbeat | Accepted and fixed in `bf0d0c0c` | Deterministic replacement after expired/malformed/failed read. Scans no longer unlink published paths; no check-then-unlink race remains in that path. |
| P2: live admission uses only freshness | Accepted and fixed in `97e75967` | Exited real child rejected before local/real in-memory mesh dispatch. Live owner and mirrored compatibility controls pass. |

The isolated pre-fix regressions yielded 11 failures / 12 tests (`np5rWT`);
the one passing test is the mirrored compatibility control. Final targeted checks:
120/120, zero skipped (`Hd56eN`), sixteen explicitly named files. Four isolated package
typechecks exit 0. All 92 recorded test PIDs are gone. The reconnect check from round 1
already passed on the base; it is not regression proof.

No new peer was dispatched: harness-review requires "Launch only through the installed
h2a MCP server's `h2a_run` tool", which conflicts with the owner's confinement.
Exact author model/effort remain unavailable. The selection-failed status and absence
of consensus remain honest; closure here is implementation plus reproduced test evidence,
not a fresh independent approval to merge.

Additional limits: expired/malformed published files are retained on disk (TTL still filters
them); local PID existence is not proof of connected MCP consumption and cannot prevent
later death or PID reuse; mirrored owners are validated by remote heartbeat freshness only.
No real owner state, nine-hour soak, Node 24 rerun, cross-CLI end-to-end or full suite.

## Owner-supplied independent re-review and round 3

`revpresence2.md` reports NON-FUSIONNABLE on one remaining P2: the dead-PID
prefilter also removed a known display name, bypassing the typed live-admission
refusal. Accepted and fixed in `87d88fa1110365be2a58a020ab4a4b82faa5390b`.
Both transports share the corrected preparation path. Live owners retain
resolution priority; fresh rejected records supply only a unique diagnostic
name/alias, and the existing live-only admission still refuses before side effects.
The same pattern on an unregistered host:label alias was reproduced and fixed.
The other CLI/MCP resolver callers do not apply that PID prefilter.

Six regressions failed before the fix (13 tests: 7 pass, 6 fail, 0 skipped,
`myhpNJ`), including successful display-name sends while real owners lived.
After the fix: 15/15 admission checks (`d1EMBr`); 88/88 across five named files
(`B130fd`), zero skips. Four isolated package typechecks exit 0. All 44 recorded
test PIDs are gone. Source provenance was checked against the pre-fix commit
and final source bytes; commands/output are in scratch `presence-evidence/tour3/`.

Manual review checked the live-only admission, ambiguity preservation, dead alias
versus live display names, malformed/unknown addressing and dormant compatibility.
This is implementation plus regression evidence, not independent approval to merge.
The harness-review skill still requires "Launch only through the installed h2a
MCP server's `h2a_run` tool", forbidden by owner confinement; no peer was launched,
no consensus is claimed and the selection-failed status remains. Node 22.22.1 only
in this round; previous field/E2E/platform/endurance limitations remain.

## Owner-supplied independent re-review and round 4

`revpresence3.md`: NON-FUSIONNABLE on one P2 at send.ts:138. Accepted:
the diagnostic fallback still used TTL-filtered presence. Fixed in the exact
target above. Atomic instance/name hints now survive publication expiry,
session close/reap and restart; deletion preserves pre-upgrade publications too.
The diagnostic combines hints, expired records and registration names and may
only throw a refusal. It never supplies admission or a dormant inbox deposit.
Living candidates keep priority; duplicate known instances collapse and distinct
historical candidates remain ambiguous. CLI/API dormant behavior is unchanged.

The final 45-test admission file against exact pre-fix `a2297c25` yields
30 expected failures and 15 controls passing, zero skips (`eIl6Gs`). The same
tests pass in the final nine-file run: 140/140, zero skips (`ikccGb`). Four
isolated typechecks exit 0; 183 recorded test PIDs checked, none alive. Commands,
full TAP, source hashes, temporary environments and the intermediate fixture
error are retained in scratch `presence-evidence/tour4/`.

Manual review checked all four changed files, pre-side-effect refusals on both
backends, TTL without PID death, removed/collected names, rename isolation,
legacy data, unknown/malformed errors, live precedence, ambiguity and recovery.
No independent peer was dispatched. [harness-review](/home/antoinefa/.codex/plugins/cache/sentropic/h2a/0.98.6/skills/harness/review/SKILL.md)
requires "Launch only through the installed h2a MCP server's `h2a_run` tool";
the owner's prohibition takes precedence. Author metadata remains unavailable;
selection-failed stands, with no consensus or merge approval claimed.

Node 22 only in this round. No full suite, owner state, field/endurance or
cross-CLI E2E qualification. Hints are retained without TTL for diagnostics;
already erased pre-upgrade evidence cannot be recovered without another source.


## Owner-supplied independent re-review and round 5

revpresence4.md retains one P2: rememberRecipient could throw after presence
publication and permanently prevent deferred MCP activation. Accepted and fixed
in the exact target above, following normal merge aed130eb of origin/main
7d87b4fb. Diagnostic history failures are swallowed at both exported boundaries;
there is one attempt per call, bounded file reads and directory traversal, and
new history writes stop at observed capacity. History still never admits a send.

The final regression file on the exact pre-fix merge yields 12/12 expected
failures (VJbyY9); identical test bytes pass with eleven compatibility files:
169/169, zero skips (9OPDPN). Four source-build typechecks exit 0. Real identity
workers reproduce session_open_failed before the fix and identity_ready,
heartbeat progress, initialize response and clean EOF afterward. Persistent
EIO/ENOSPC, corrupt/non-file/oversized history and capacity are covered. Manual
review checked cleanup, finite attempts, live-admission separation, read-error
fallback and source provenance. Evidence is in scratch presence-evidence/tour5/.

Selection remains failed, not a consensus verdict. The skill
[harness-review](/home/antoinefa/.codex/skills/harness-review/SKILL.md) requires
"Launch only through the installed h2a MCP server's h2a_run tool"; that path
is explicitly forbidden by the owner. No peer was dispatched, no independent
approval to merge is claimed. Exact author model/effort remain unavailable.

Budgets are 16 KiB per hint and 1,024 entries per traversal; new writes stop at
observed capacity without deleting old evidence. Concurrent writers may exceed
the observed threshold; existing excess is not purged. Loss of diagnostic detail
at failure/capacity is intentional. Node 22 only; full suite, other OSes,
field/endurance and cross-CLI E2E remain unqualified.

## CI compatibility review — round 7

Manual review of the two failing files against `BRANCH.md` and the changes to
`runtime/mcp/server.ts` / `runtime/send.ts` confirms both intentional contracts:
status-only clients drive bounded retry; MCP discussion requires fresh living
recipient presence. Original tests: main d2e0cfdc 18/18, branch 12308394 15/18
(exactly the three CI failures). Updated tests: branch 18/18, zero skips.
The mesh fixture now includes refusal before presence and after close, with no
transport put, while preserving both signed directions and delayed readiness.
T4 now requires status-only recovery, one fresh activated attempt, and both
distinct bindings after the unchanged production deadline expires.

No product change or weakened assertion; written test-evolution justification
and exact command are in `BRANCH.md`, round 7. No fresh independent consensus
is claimed. The owner's supplied last verdict is FUSIONNABLE; the installed
h2a review path remains prohibited by owner confinement.

## Owner-supplied independent re-review and round 6

`revpresence5.md`: FUSIONNABLE-AVEC-RESERVES, a single P3: three writers
observing 1,023 entries can all append. Accepted and fixed in the exact target
above, after normal merge a9991995 of origin/main d2e0cfdc (#339).

Three real child processes pause after their actual directory snapshots, then
publish simultaneously: the exact pre-fix source yields 1,026 entries instead
of 1,024. One expected failure / 16 targeted history tests, 15 controls passing,
zero skips (3SYT0W). Identical final test/helper bytes pass with eleven additional
compatibility files: 173/173, zero skips (jReCeb). Incoming version preparation,
release helpers and controlled publish rehearsal: 47/47. Four temporary package
typechecks exit 0; all 183 recorded spawned PIDs are gone. The merge retains all
1,512 Track events from each parent, with exact internal 0.98.6 pins.

Manual review checked quota reservation before any temporary write, a single
exclusive mkdir attempt, the finite slot-index range with stable legacy files,
reservation cleanup, crash isolation, atomic visibility, preservation/repair of
legacy evidence, duplicate hints, bounded reads and unchanged live admission.
The new adversarial controls kill and await a real writer, publish through its
unoccupied remaining pool, overlap different and identical recipients, exercise
session lifecycle at capacity, and verify failed writes release empty places.
Existing excess is retained without growth; a crashed reservation consumes one
finite place, never a global lock. No findings remain from the supplied review.

Evidence: owner's scratch `presence-evidence/tour6/`, with full commands/TAP,
source provenance, environments and PID audit; report section Tour 6.
This is the correction and manual validation, without a new independent verdict.
[harness-review](/home/antoinefa/.codex/skills/harness-review/SKILL.md) requires
"Launch only through the installed h2a MCP server's `h2a_run` tool"; the owner's
confinement forbids this path. No peer was dispatched; author metadata remains
unknown and selection-failed stands. Field attribution, nine-hour soak, Node 24,
other OSes, cross-CLI E2E and the full integration suite remain unqualified here.
