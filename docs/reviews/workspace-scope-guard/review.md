---
status: selection-failed
target-ref: c156ef882c85b77fbae40a275812476f1d6b8ae9
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

Private npm package/query controls: targeted red 0/2, mixed private/published
workspace regression red 0/1; final targeted verification 100 passed, no skips.

Helper execution/inspection controls: targeted red 0/2; final targeted verification
102 passed, 0 failed, 0 skipped. SessionStart binding cannot be minted through a
classified manual invocation of the initializer.
