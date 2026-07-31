---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: e62297a07eaa7b8d2214deebc8694b5d315e6712
lens: correctness, fail-closed prompt gating, and activity-proof state transitions
---

# Correctness review v2

## Reasoning

The exact-target path is correctly isolated from the explicitly preserved bare
`relaunch --apply` path. A supplied filter makes `forced` true
(`packages/h2a-runtime/src/index.ts:7752`); after the plan and preflight,
that branch kills/recreates the selected session and invokes the wake verifier
(`packages/h2a-runtime/src/index.ts:7934-8002`). The bare path returns earlier
through `relaunchInSession` (`packages/h2a-runtime/src/index.ts:7845-7862`) and
is not relied on for this behaviour.

The automatic decision is fail-closed. The long-context expression requires
all observed gate text, selected option `❯ 1. Resume from summary
(recommended)`, the other two alternatives, and `Enter to confirm`
(`packages/h2a-runtime/src/prompt-delivery.ts:49-50`). The generic modal
recognizer requires a numbered choice and confirmation before assigning that
special reason (`prompt-delivery.ts:99-112`). `wakeRelaunchedSession` sends
Enter only when the first delivery reports precisely that reason
(`packages/h2a-runtime/src/relaunch.ts:81-109`). It then polls for the exact
prompt to disappear; send failure and a still-present gate after 10 seconds
are terminal failures (`relaunch.ts:111-127`). A second occurrence reaches the
second delivery but cannot cause another Enter (`relaunch.ts:129-142`).

The continuation comes from the registered task when nonblank, otherwise asks
the resumed conversation to determine its standing objective
(`packages/h2a-runtime/src/relaunch.ts:24-39`); the CLI supplies the selected
registry entry's task (`packages/h2a-runtime/src/index.ts:7972-7989`). It is
not reported successful merely because submission succeeded: the delivery
routine first waits for a drawn, quiet, non-blocked pane
(`prompt-delivery.ts:459-476`), proves the single paste reached the composer,
sends one submit, and requires CPU above a bounded host-idle allowance
(`prompt-delivery.ts:490-635`). A submitted-but-idle continuation is converted
to a command failure (`relaunch.ts:89-98`, `133-142`; `index.ts:7996-8017`).

Compaction cannot be accepted as readiness: both the compaction and queued
message indicators are blocking (`prompt-delivery.ts:227-237`), and readiness
requires their absence (`prompt-delivery.ts:377-431`). The deterministic test
models the modal, four blocking captures, then readiness; it verifies no paste
while blocked, exactly one continuation submit, and working proof
(`packages/h2a-runtime/src/relaunch.test.ts:72-140`). The UAT independently
records the same exact-target command and the subsequent Read/tool activity
(`docs/uat/2026-07-31-h2a-relaunch-autonomy-lock.md:45-81`).

## Findings

None. I found no evidence-backed correctness defect in the forced exact-target
`h2a relaunch --apply <session>` path under this lens.

## Validation

- Inspected exact commit `e62297a07eaa7b8d2214deebc8694b5d315e6712`, its
  implementation ancestry, the CLI wiring tests, prompt-delivery tests, and
  the relaunch UAT.
- `npx vitest run packages/h2a-runtime/src/relaunch.test.ts` — passed: 12/12.
- Focused relaunch selector execution — passed: 4 selected tests, 8 skipped.
- `npm test -- --runInBand` — passed: 1,718 Node tests (1,701 passed, 17
  skipped) and 1,190 Vitest tests (87 files). The known 16 broad
  conv-guard-wiring failures were not attributed to this commit; the full gate
  is green.
- `git diff --check e62297a^ e62297a` and `git show --check e62297a` — clean.

## Final verdict

**GO** — the exact forced-target relaunch wires the fail-closed, one-Enter
Claude gate to a continuation with compaction-aware readiness and independent
CPU activity proof; failure paths return nonzero rather than claiming work.
