---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: 04584580b81ec2c4e98dfce257ca99d6f66456f9
lens: does-it-actually-reproduce, tmux timing races, unattended end-to-end evidence, and regression coverage
---

# Reproduction review

## Reasoning

The UAT document is useful evidence that the author observed the requested Claude
long-context gate on a real host: it records the pre-fix modal, the command, and
a post-resume transcript containing compaction, the continuation, a `Read` tool
call, and `UAT-WORKING`. The transcript therefore supports the narrow claim that
one prepared conversation reached the intended sequence.

It is not an unattended, reproducible test artifact, however. The conversation
was snapshotted and its timestamps and token counters were edited to force the
modal (docs/uat/2026-07-31-h2a-relaunch-autonomy-lock.md, lines 7-10), and the
successful run uses an already-built `packages/h2a-cli/dist/bin.js` (lines
38-40), with no checked-in fixture/setup/teardown or command that creates the
isolated tmux and registry state. The document is a capture/report, not an
executable end-to-end regression. That matters particularly for the timing claim:
the real transcript shows the result, but does not let CI or another reviewer
replay the compaction-to-queued-composer transition unattended.

I ran the focused Vitest command:

```text
npx vitest run packages/h2a-runtime/src/prompt-delivery.test.ts packages/h2a-runtime/src/relaunch.test.ts packages/h2a-runtime/src/conv-guard-wiring.test.ts
```

The prompt-delivery and relaunch suites passed (56 tests total); the wiring suite
reported 16 failures and 84/100 tests passed overall. The failures are existing
expectations of `startLocalSession`'s old call shape: the target implementation
now supplies `resumeId` and `attachedTerminal` at `packages/h2a-runtime/src/index.ts:7948-7959`,
while the assertions in `packages/h2a-runtime/src/conv-guard-wiring.test.ts`
expect the prior arguments. Thus the repository's focused regression suite is
red on this commit, independently of the UAT prose.

## Findings

### P1 — Focused regression suite fails on the target commit

Evidence: the focused command above exits 1 with 16 failures in
`packages/h2a-runtime/src/conv-guard-wiring.test.ts`. The first failure is
`conv-guard-wiring.test.ts:668`; the same old-call-shape failure repeats through
that suite (including lines 684, 714, 997, 1053, 1088, 1127, 1177, and 1252).
The changed production call at `packages/h2a-runtime/src/index.ts:7948-7959`
adds the options object and resume metadata. Until the checked-in tests are
updated or the implementation preserves the asserted contract, the target does
not pass its regression suite and should not be treated as merge-ready.

### P2 — No executable unattended reproduction covers the real compaction/queued-composer transition

The only committed race regression is the static fixture test at
`packages/h2a-runtime/src/prompt-delivery.test.ts:361-372`: it starts with a pane
whose capture remains `COMPACTING` forever and asserts that no paste occurs.
`paneHasBlockingActivity` itself is only the string predicate at
`packages/h2a-runtime/src/prompt-delivery.ts:233-236`. There is no test in
`relaunch.test.ts` that models “first delivery sees the long-context modal,
Enter clears it, compaction is visible for some polls, then the queued-message
indicator clears and the continuation is submitted.” The wake test at
`relaunch.test.ts:45-66` mocks the first and second delivery results, so it does
not exercise tmux polling, compaction, queue clearing, or the real
`deliverInitialPrompt` path. The UAT report documents one manual/prepared run,
but does not supply a replayable harness. A timing regression in the transition
could therefore pass all committed tests.

## Final verdict

**NO-GO** — the focused regression suite is demonstrably failing, and the
requested unattended end-to-end/timing evidence is a report rather than a
replayable regression. The real capture supports the narrow one-off sequence,
but not CI-grade reproduction or coverage of the compaction/queued composer
race.
