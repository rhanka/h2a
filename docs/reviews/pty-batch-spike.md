---
status: selection-failed
review-author:
  host: codex
  model: unavailable
  effort: unavailable
target-ref: 33a4f54701c11b963eb144d7c5d4570432ad515f
target-path: spike/pty-batch-handover
target-diff-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
observed-failure: Exact author model/effort are not exposed. The installed h2a MCP and live mesh access required for complementary reviewer selection are unavailable and explicitly prohibited by the owner confinement. No legs dispatched and no consensus claimed.
---

This branch is a disposable spike and must never merge. The owner explicitly
authorizes isolated Linux execution, a macOS Actions trial, and costing only.
No product implementation, main mutation, installed h2a execution, real state
access, Track writes, or full-suite gate is authorized here.

The target was committed and clean when the diff digest was taken (empty
`git diff HEAD --no-ext-diff`). This dossier is the sole subsequent change.
The existing untracked starting lab was preserved outside the repository in
the owner-requested spike2/baseline directory before adaptation.

Local adversarial evidence is not an independent review:

- Restoring Linux parent-death coupling kills moved CLIs: expected failing
  survival assertion, zero skipped tests. Default guardian survives owner 1.
- Suppressing the guardian status channel loses exit reporting: expected
  timeout, zero skipped tests. Default channel delivers exact codes/signals.
- Removing the subreaper from both owners exposed a dropped-session tracking
  leak during cleanup. The red log fails the normal-cleanup assertion; dropping
  its stale tracking entry restores normal cleanup without a forced kill.
- macOS compiled and executed the initial lab but rejected the closed Unix
  datagram peer with ECONNRESET. The fix handles that peer closure explicitly.
- The next macOS run caught reordered inputs during a rejected batch's
  rollback. A controlled drain pause reproduced it on Linux before the fix.
  Keeping the route moving until queued input is fully drained fixed it.
- Final code CI run 39073867783 passes all three tests with zero skips on
  both ubuntu-latest and macos-latest (Darwin arm64). The macOS main test
  checks kqueue NOTE_EXIT and 864 ordered inputs across the three batches.
- Read/write/control state and descriptors transfer only after freezing a
  batch. The receiver does not pump staged descriptors. Receiver rejection and
  an invalid sender FD resume the affected sessions; other sessions continue.

Boundaries for any later product review: commit ambiguity/crashes, authenticated
and versioned IPC, bounded buffers and backpressure, complete terminal/replay
state, durable exit acknowledgments, independent owner startup, descendant
containment, packaging/signing, old sessions, sustained real agent workloads.
The guardian remains old until its CLI ends even when the PTY owner is replaced.

Commands and actual outputs, all test failures, Linux batch timings, macOS CI
results, and costing are recorded in the owner-requested external
`dossier-pty/spike2/report.md` with adjacent raw logs. No publication or merge
readiness is claimed by this selection-failed dossier.
