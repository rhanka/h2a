---
status: selection-failed
target-ref: 87d88fa1110365be2a58a020ab4a4b82faa5390b
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
