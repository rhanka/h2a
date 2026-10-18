---
status: completed
review-kind: independent-design-conformance
reviewer: /root/design_safety
identity-basis: collaboration session; effective host/model not attested
lens: security, scope and process safety
---

Independent findings from the implementation review, reconciled by the author:

| Finding | Disposition and evidence |
| --- | --- |
| Mixed-major baseline permitted an occurrence major bump | Fixed: compare each retained occurrence's identity/major; policy regression red then green. |
| Codex sandbox did not attach workspace guard | Fixed contract: trusted authority's fresh exact-workspace bundle qualification and atomic reserve, native plugin explicitly enabled; absent receipt refuses spawn. Live qualification remains external, not claimed. |
| Read-only reviewers lacked baseline/diff | Fixed: separate pinned diff, before/after locks and controller evidence in each review worktree. |
| Quota cap per seat instead of CLI | Fixed: shared CLI capacity and daily counts, plus atomic authority reservation at actual launch. |
| Broad test selector accepted beside a file | Fixed: every selector must be a named relative targeted test file. |
| Crash left a permanent lock | Fixed: Linux kernel flock holder exits on controller pipe EOF; own-process SIGKILL regression. |
| Timeout waited indefinitely on inherited pipes | Fixed: bounded rejection, stream destruction, own-child signal and repository quarantine. |
| Scanner/supply-chain aggregation erased quarantine | Fixed: rethrow quarantined process errors; regression red then green. |

The independent recheck confirmed the first six corrections and identified the
quarantine propagation regression, subsequently corrected and tested. No live
seat/provider/process-tree qualification, native host access or h2a consensus
was performed. This is technical feedback, not a qualified h2a review leg.
