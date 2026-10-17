---
status: selection-failed
target-ref: e1cc9af08e60569f870451ce4d49d01a092cdc99
observed-failure: No h2a MCP is available in this confined session; the exact author model and effort are not supplied. Owner forbids reaching real host h2a state. No eligible review legs can be dispatched.
---

The harness review skill requires author-complementary legs launched only through
the installed h2a MCP, and says: "Unknown author means no acceptable review".
No consensus verdict is claimed. Source:
[/home/antoinefa/.codex/skills/harness-review/SKILL.md](/home/antoinefa/.codex/skills/harness-review/SKILL.md).

Two independent design lenses completed before implementation; their reconciled
findings are recorded in the EVOL spec. They are design evidence, not the required
author-complementary implementation consensus. Contacting h-cond is also unavailable
without the h2a MCP; the task was implemented directly within the assigned worktree.

Self-inspection led to regression coverage for multiple push destinations and URL
rewrites, index versus working-tree content, explicit pushed refs, full remote
manifests/private packages, native argv/environment/cwd, literal orchestration
patches, state writes, symlink journals and mandatory independent Vibe installation.
See the targeted test files and the delivery report for exact commands/results.

Post-push self-inspection additionally reproduced and corrected ordinary monorepo
workspace builds and release prose false positives (targeted red 0/1, final 97/0).
