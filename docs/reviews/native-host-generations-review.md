---
review-author:
  host: codex
  model: gpt-6.1-sol
  effort: high
target-ref: f8de096
status: selection-failed
observed-failure: No reviewer launch context was verified to enforce the mandatory private runtime, HOME and registry paths; inherited-context h2a_run was not invoked.
---

# Native host generations L0/L1 review boundary

Author metadata is the owner's declared builder profile, not effective-routing
attestation. Target: implementation commit `f8de096`, following L0 `03de313`.

The harness-review skill requires: "Launch only through the installed h2a MCP
server's `h2a_run` tool". Source:
[/home/antoinefa/.codex/skills/harness-review/SKILL.md](/home/antoinefa/.codex/skills/harness-review/SKILL.md).
The owner requires private explicit socket/runtime/HOME/registry paths for
every host launch and forbids any use of the inherited live native host.
Available tool metadata lists `mcp__h2a__h2a_run`, but no safe reviewer context
was established. No peer discovery or reviewer launch was attempted, and no
consensus verdict is issued. This is a builder handoff for independent review.

Builder diff inspection covered refusal before ownership/create, whole-attempt
creation evidence, strict MCP parsing, preserved name idempotence and unknown
states, isolated historical PTY continuity and the limited L2 TODO. Validation
and raw RED excerpts are in `native-host-generations-l0-l1.md`.
