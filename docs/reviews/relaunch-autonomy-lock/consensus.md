---
status: incomplete
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: 04584580b81ec2c4e98dfce257ca99d6f66456f9
legs:
  - path: docs/reviews/relaunch-autonomy-lock/claude-terra-correctness.md
    status: failed
  - path: docs/reviews/relaunch-autonomy-lock/claude-luna-reproduction.md
    status: completed
observed-failure: Terra leg exited successfully but did not complete its required metadata or provide a final verdict
---

# Initial review: unattended relaunch autonomy lock

This review cycle is structurally incomplete because the Terra leg did not
produce a conforming completed artefact. Its technical claim concerned bare
`h2a relaunch --apply`, whose in-pane crash recovery is explicitly preserved at
`index.ts:7844`; the requested and changed operation is the forced exact-target
form, `h2a relaunch --apply <session>`. The claim is therefore rejected as out
of this lot's scope.

The Luna leg's P1 is rejected: its exact 16 failures reproduce unchanged in a
detached `origin/main` worktree at `e328248e`; the target adds two passing tests
and the scoped `-t 'h2a relaunch'` run passes 9/9. Its P2 is accepted in part:
the real-host UAT is intentionally a capture rather than a stable CI dependency,
but the modal → compaction/queued-message → ready → continuation → activity
transition now has a deterministic regression test in `relaunch.test.ts`.

Because the accepted change amends the reviewed target, a fresh two-leg review
is required against the new commit; this incomplete dossier has no consensus
verdict.
