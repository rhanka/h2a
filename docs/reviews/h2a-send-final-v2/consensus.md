---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: c57f18db
legs:
  - path: docs/reviews/h2a-send-final-v2/correctness.md
    status: completed
  - path: docs/reviews/h2a-send-final-v2/security.md
    status: completed
consensus-verdict: GO
---

# Final consensus review v2 — native signed `h2a send`

Both blind legs returned GO with no blocking or major finding.

## Reconciliation

- Confirmed: the accepted `deliver-hint` reporting fix is accurate and its
  test pins both the full-id destination and the absence of a bare-channel
  write.
- Confirmed: the signing/active-key/MCP authority and bounded native→tmux wake
  properties remain unchanged at `c57f18db`.
- Rejected as an implementation defect: the `mcp-serve` headless warning says
  `use auto` inside the self-wake command where auto is explicitly bounded to
  native→tmux; behavior of the separate drumbeat relauncher does not make that
  contextual guidance false.
- Refuted: `sendContext` is exercised end-to-end by
  `pty-native-messaging.test.js`, which calls the real `h2a_send` tool through
  `runMcpServe --auto-open --wake auto` in both directions.
- Deferred as non-gating coverage debt: explicit no-candidate/ambiguous CLI
  sender tests. The branch already fails closed and the signed active-key gate
  is an independent barrier.
- Deferred as cosmetic: ternary indentation and the standard `--` escape for a
  message beginning with `--`.

Consensus on exact product commit `c57f18db`: **GO**.
