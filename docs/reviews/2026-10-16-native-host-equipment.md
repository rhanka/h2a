# Native equipment review and reconciliation

status: selection-failed
observed-failure: exact author model/effort are not attested; installed h2a MCP dispatch is unavailable and owner confinement forbids contacting its real host.
review-author: { host: codex, model: unknown, effort: unknown }
target-ref: 8c4dcdc3e28c4c965ca132fc513637bf35da04eb plus CLI/help/docs/inventory working tree
target-diff-sha256: f454c4d6daac14adf0f40e07c5ecacaf94df0d2dabad0a9a8f8b37eb4b34a72a

This is not a harness consensus approval. The harness-review skill requires
“Unknown author means no acceptable review”; the eligible opposite-host/model
selector cannot be satisfied. No installed h2a binary or real MCP host was used.
No merge is authorized by this document.

Two existing confined Codex collaboration reviewers provided technical findings
on the source target at 50bec5b9. Their effective model/effort and host diversity
are not attested. Those findings are useful technical review, not eligible
harness legs. Neither changed source files or launched a genuine native host.

| Lens | Reviewer | Actual checks |
|---|---|---|
| Pilot/accounting/oracles | review_native_pilot | native-host-qualification: 3 pass, 0 fail/skip (lane 91RAC7); synthetic guard/lifecycle false positives reproduced |
| Ownership/TOML/safety | review_native_safety | convergence/safety/recovery: initially 3 pass/3 fail (PgLAmC), then 5 pass/1 fail (v7QmRH) while proof fixture was being tightened |

| Finding | Reconciliation |
|---|---|
| Missing semanticDigest import | Accepted; restored and strict typechecks pass |
| Guard survives observable binding mismatch | Accepted; selected binding persisted, drift suspends; native-host-convergence covers it |
| Guard oracle accepts executed command/unrelated denial | Accepted; session, effect ID, command and failure state correlated; adversarial regression red then green |
| Lifecycle oracle lacks child/parent boundaries | Accepted; child boundary, parent hook timing, sampled single record transition and unrelated instances checked |
| Ban every fork post_agent hook invocation | Refuted: native wrapper must run to read parent_session_id and return without drumbeat. Hook execution is not a record effect. Wrapper tests require no record change for child/fork |
| Probe qualifies empty/uncorrelated journals | Accepted; persisted exact session/history, stats and resource/MCP/context oracles required; failure captures public IDs immediately, unknown cleanup remains incomplete |
| Cumulative watchdog/prior allocation validation | Accepted; exact per-slot accounting restored, global timer uses remaining time, no retry |
| Phase 2 overwrites phase 1 component evidence | Accepted; only exercised components updated, immutable per-attempt hashes retained |
| RECORD hash does not verify runtime files/evidence | Accepted; CSV hashes/sizes of relevant runtime files, generated-cache captured state and evidence hashes checked without executing Python |
| agy quoted resource roots produce invalid TOML | Accepted; strict validation and basic-string fallback; triple-apostrophe root regression |
| agy update notice ignores actual shared commands | Accepted; notice checks shared commands manifest and selected files |
| agy import always pending | Accepted; opt-in real import observation bound to current shared manifest; no discovery-only component qualification |
| Uncatchable interruption leaves lock | Safe blocking retained; explicit stopped-writer diagnostic and journal-preservation regression. Actual SIGKILL-at-every-write injection remains uncovered |

Final named verification after corrections: 17 files / 93 tests, 93 passed,
0 failed, 0 skipped, on Node 22.22.1 and 24.14.0. Evidence lanes: MPCLK8 and
vw4DBf under the private h2a-host-build temporary parent. Four package strict
typechecks pass on both runtimes (lanes GJBieO and zHhhXa). These are fixture
and source-consumer checks, not genuine native-host qualification or consensus.

External gates remain B/R5/R7, genuine Vibe CLI/app-server observations including
configuration persistence, and Muse/agy M-B. No fixture qualifies the owner's post.

## PR 340 — Tour 2

status: selection-failed
review-author: { host: codex, model: unknown, effort: unknown }
target-ref: feat/vibe-host-equip, corrections to independent rev340.md (findings 1–5)
target-diff-sha256: bf5aecfe2aa31755d8b9ad2892fdd7f578eef1a0eed8d27433a454acff490f9a
target-paths: git diff HEAD --no-ext-diff -- . ':!docs/reviews/2026-10-16-native-host-equipment.md' (dossier excluded)
observed-failure: exact author model/effort unavailable; eligible installed h2a MCP dispatch remains unavailable and forbidden by owner confinement. No eligible legs dispatched, no harness consensus verdict.

The harness-review requirement “Unknown author means no acceptable review” remains
in effect. This reconciliation records reproduced defects and validation; it does
not replace the next independent review or authorize merging the PR.

| Independent finding | Reconciliation and regression |
|---|---|
| 1: runtime oracle/status/CLI flags | Accepted: real H2A identity/session and Track handlers, explicit canonical bus/workspace, supported Vibe CLI flags with external watchdog, requested-component report/exit/cleanup and fixture-only status. Disposable Track stores are initialized by Track's actual CLI. |
| 2: project scope, stale residues, force, weakened test, hook scripts | Accepted: project skills/resources use distinct installation; user managed conflicts require force, unknown files and hooks remain protected; known-hash stale artifacts are backed up then removed; Gemini restored to historical overwrite test, all four native hosts covered; explicit Vibe installation ships scripts. |
| 3: relative paths/shared owner | Accepted: relative ownership survives relocation; former absolute layout is normalized; both Gemini and agy write the same authoritative shared-owner.json under one writer lock. |
| 4: proof timing/discovery/masking | Accepted: committed bytes/selections are re-read after repair; discovery sources, collisions and content enter the skills fingerprint; project masking suspends an already enabled guard. |
| 5: insertion/deletion | Accepted: a single ordered insertion preserves requested order; removal owns separator/newline without accumulating blanks, including the previous renderer's output. |

The requested force restoration of modified managed skills/scripts supersedes
spec-astra-v9 §5's earlier blanket customization-preservation sentence. Unknown
provenance and customized TOML hooks remain protected. The CLI flag adaptation
supersedes §11's unsupported `--time-limit`/`--output-dir` spelling while preserving
the budget and watchdog. These are explicit review/owner-requested corrections.

Local fixture/source-consumer checks do not demonstrate the owner's end-to-end
equipment: A/E delivers skills and hooks; B supplies the real MCP bootstrap and
attachment; C/spec §§11–12 requires the genuine target-post recipe. Muse/agy M-B,
settings-persistence observation and common RC-3 remain open.
