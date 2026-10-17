---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 3b06e62f8f0cd57bc7992707455235a4861d4321
observed-failure: Exact author model/effort unavailable; owner confinement forbids the installed h2a MCP review dispatch and real model calls.
---

No multi-peer consensus is claimed. The owner-provided implementation contract
is followed directly; targeted offline regressions and typechecks provide
technical evidence. The review mechanism required by harness-review cannot
run inside this confinement. This does not certify real AGY/provider behavior.

## Tour 2 — owner-supplied review

Target: `853de4d22` (rebased onto `origin/main` at `596363908`). The owner's
`rev359.md` findings 1–5 were accepted and reproduced before correction:
interactive quota (idle and busy), stale results, PID-probe completion race,
stream/reset/non-zero completion handling, and embedded model efforts.
The four named runtime regression files reproduce 14 failures on `5704df47c`
and pass 103/103 after correction. Additional regressions reject a stale result
with a future timestamp and retain quota before a large event; both were red
before their respective fixes. Final eight-file runtime campaign is 292/292
and three-file CLI/MCP campaign is 38/38 on Node 22/24, without skips.

This is reconciliation of the supplied review and a technical self-review.
No new independent consensus is claimed: the author metadata and installed
h2a dispatch constraints in the header still prevent the harness selector.
No real provider/native-host qualification, integration suite or Track write.

## Tour 3 — owner-supplied re-review

Target: implementation `d6ce6c4`, correcting `8563ee35a` and accepting both findings in
`rev359-r2.md`. Regressions reproduce filesystem-clock lag in CLI and MCP,
old custom-path results, fast completions, real AGY_ERROR terminal wrapping,
and the six-line diagnostic-tail loss. The correction removes cross-clock
checks, retains file-generation exclusion, reassembles anchored complete JSON,
and carries a typed quota error from the full-screen observation to the CLI.

On the original sources, the three named runtime files reproduce 8 failures
(92/100 pass), and the MCP file reproduces 3 failures (12/15 pass), including
Node 24. A guard regression also reproduced false Claude-pool attribution for
a non-Claude model (10/12 launch tests), then passed after retaining the model
check. Final Node 22/24 campaigns pass 303/303 across eight named runtime files
and 41/41 across three CLI/MCP files per version, with no skips. Four package
typechecks pass per version. Source hashes match all four final test lanes.

No additional independent consensus is claimed. Per
`/home/antoinefa/.codex/skills/harness-review/SKILL.md`, selection requires
exact author model/effort and dispatch through the installed h2a MCP server;
those metadata remain unavailable and owner confinement forbids that dispatch.
The supplied re-review is reconciled with offline regression evidence only.
