---
review-author:
  host: codex
  model: unknown-not-exposed-by-runtime
  effort: unknown-not-exposed-by-runtime
target-ref: docs/2026-09-26-cli-host-feature-matrix.md@working-tree
target-diff-sha256: 5e03990fc4035b6afe536dc5c5089e1785cc85ca58a2ea6c955be0399af880df
status: selection-failed
observed-failure: >-
  The runtime exposes neither the author's exact model id nor effort. The
  harness-review selector forbids inference and requires both before choosing
  two author-complementary h2a reviewers. In addition, h2a MCP calls are
  refused by the approval wrapper before reaching the server.
---

# Review dossier — CLI host feature matrix

No peer leg was dispatched and no consensus verdict is claimed. The pull
request must receive two independent reviews, with at least one reproducing the
native-loader evidence, before merge consideration.
