---
status: selection-failed
target-ref: feat/live-cross-cli-messaging, scripts/qualify-cross-cli.mjs
observed-failure: Owner forbids installed h2a and real h2a state; no installed h2a MCP review launch is available. Exact author model/effort metadata is not attested in this session.
---

# Cross-CLI measurement review

The owner request takes precedence over the installed-h2a launch prescribed
by `/home/antoinefa/.codex/skills/harness-review/SKILL.md`:
“Launch only through the installed h2a MCP server's `h2a_run` tool”.
No launch through that route was attempted. No consensus verdict is claimed.

Two independent local design readings under harness-brainstorm covered proof
correctness and product integration, without launching h2a or provider models.
Both converged on these requirements, adopted in the qualification harness:

| Finding | Resolution |
|---|---|
| No `h2a_receive` tool | Observe successful `h2a_inbox` with the exact envelope. |
| MCP subprocess alone is insufficient | Require successful initialize and messaging tools/list. |
| Delivery is not a live reaction | Require an idle barrier, then a matching inbox read without harness input. |
| Replies can be miscorrelated | Match reply actor, target, probe marker and durable envelope ID. |
| Default setup auto-upgrades | Preserve args and set existing `H2A_UPGRADE_REEXECED=1` guard. |
| Nested h2a could select installed code | Use private PATH shim targeting only the temporary source build. |
| Same-CLI can collapse identities | Use distinct workspaces and native session identifiers. |
| Errors can contain secrets | Persist only closed-vocabulary facts and protocol metadata. |

These readings do not satisfy the skill's formal cross-host model-selection
and installed-MCP dispatch contract. Formal review remains uncovered.
