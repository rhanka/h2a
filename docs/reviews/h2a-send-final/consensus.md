---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: 681d65b2
legs:
  - path: docs/reviews/h2a-send-final/correctness.md
    status: completed
  - path: docs/reviews/h2a-send-final/security.md
    status: completed
consensus-verdict: GO with non-blocking follow-up
---

# Final consensus review — native signed `h2a send`

Both blind legs returned GO with no blocking or major finding.

## Reconciliation

- Accepted: the stale `deliver-hint` reason was misleading after direct full-id
  delivery. Fixed in follow-up commit `c57f18db` with a focused regression test.
- Accepted: missing coverage for `deliver-hint` and CLI workspace sender
  auto-detection. Both tests were added in `c57f18db`.
- Rejected for this delivery: the `safeKeyName` portability observation concerns
  a pre-existing Linux-safe helper; no traversal is possible because `/` is
  removed. A cross-platform unification can be handled separately.
- Rejected as non-defects: signing before active-key verification has no trust
  impact, and non-qualified senders already fail closed before persistence.

Consensus on `681d65b2`: GO. Because accepted feedback changed product code,
the final branch head requires a fresh exact-SHA review.

