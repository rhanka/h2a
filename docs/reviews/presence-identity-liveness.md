---
status: selection-failed
target-ref: b504c12f79f126b92c0c12ed98512edc85da37f0
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
