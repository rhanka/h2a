---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: e62297a07eaa7b8d2214deebc8694b5d315e6712
lens: exact-target reproduction, tmux timing races, unattended evidence, and regression coverage
---

# Reproduction review v2

## Reasoning

The requested exact-target operation is represented by the real UAT command
`node packages/h2a-cli/dist/bin.js relaunch --apply relaunch-autonomy-uat` in
`docs/uat/2026-07-31-h2a-relaunch-autonomy-lock.md:43-81`. Its recorded output
shows the exact sequence relevant to this lens: the Claude stale-session modal
was auto-passed once, the verifier waited through `Compacting conversation` and
the queued-message state, then the transcript shows the continuation, a
`Read package.json` tool result, `UAT-WORKING`, and measured process activity.
The report also records the pre-fix exact-target failure at lines 17-35, where
the modal caused a non-zero relaunch result. This is unattended host evidence,
although the fixture is prepared/snapshotted rather than a CI-replayable test
harness (lines 3-15 and 37-41). That limitation does not invalidate the UAT's
observed sequence; it means the deterministic test is the repeatable regression
for the transition while the UAT is the real-host acceptance evidence.

The new test at `packages/h2a-runtime/src/relaunch.test.ts:72-147` exercises the
actual `deliverInitialPrompt` implementation after the exact modal is cleared,
not merely mocked delivery results. Its capture model returns blocking
compaction/queued-message text for four observations, then an idle composer.
The test therefore makes the ordering observable: `wakeRelaunchedSession`
must auto-submit the confirmation, `deliverInitialPrompt` must poll past the
blocking captures without pasting, and only then may it paste and submit the
continuation. The assertions at lines 142-146 cover auto-pass, post-blocking
observations, no paste while blocked, and exactly one continuation submit.
The synthetic clock and bounded delivery options remove wall-clock timing
flakiness; the focused test passed.

Failure reporting remains fail-closed in the exercised path: modal-clear
failure returns a failed result with the last capture in
`packages/h2a-runtime/src/relaunch.ts:111-127`, while undelivered or
submitted-idle continuation results are converted to failed wake results at
lines 129-142. The UAT's pre-fix failure transcript also demonstrates that a
modal does not get reported as successful work.

## Findings

None. I found no evidence-backed defect in this commit's deterministic
compaction-transition coverage or in the UAT evidence for the exact-target
relaunch path. The broad three-file Vitest command's 16 conv-guard-wiring
failures are baseline failures on detached `origin/main` e328248e and are not
attributed to this commit, per the review scope.

## Validation

- `npx vitest run packages/h2a-runtime/src/relaunch.test.ts -t 'waits through summary compaction before submitting the continuation'`
  — 1 passed, 11 skipped.
- Inspected the target diff, `relaunch.ts`, `prompt-delivery.ts`, the new
  transition test, and `docs/uat/2026-07-31-h2a-relaunch-autonomy-lock.md`.

## Final verdict

**GO** — the real UAT establishes modal auto-pass → compaction/queued-message
wait → continuation → tool activity, and the new deterministic test covers the
same transition without a timing gap that would allow a paste during the
blocking state.
