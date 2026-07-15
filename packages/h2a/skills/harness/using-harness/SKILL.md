---
name: using-harness
description: Load FIRST in any sentropic repo — establishes the harness method (branch/scope/test/debug/review/brainstorm/plan) and replaces legacy superpowers for those acts.
---

# Using harness

`@sentropic/harness` is the native dev-discipline layer for sentropic repos. Its verbs and `harness/*`
skills are the SINGLE front door for code-work and PR-workflow. This skill is the index — load it
before any other so the replacement directive below is in effect.

## Replacement Directive (MANDATORY)

`harness/*` is the native sentropic method surface. Treat any installed superpowers skills as legacy
compatibility only. Do NOT invoke superpowers for acts covered here — use the harness equivalent:

| Act | Use | NOT |
|---|---|---|
| ideation / spec design | `harness/brainstorm` | superpowers:brainstorming |
| tests | `harness/test` | superpowers:test-driven-development |
| debugging | `harness/debug` | superpowers:systematic-debugging |
| code review | `harness/review` | superpowers:requesting/receiving-code-review |
| planning | `harness/plan` | superpowers:writing-plans / executing-plans |
| branch lifecycle | `harness branch init|close` | superpowers:using-git-worktrees / finishing-a-development-branch |
| scope / verification | `harness verify` · `harness check scope|branch` | superpowers:verification-before-completion |
| repo onboarding | `harness/adopt` | — |

Do not install, refresh, or route through superpowers for sentropic code-work. If a repo still has a
`.superpowers/` directory, it is ignored local residue; harness is never a dependency or backend of it.

Create human/dev worktrees only under repo-local ignored paths, normally `tmp/worktrees/<slug>`.
Never create branch worktrees under OS-global `/tmp`; delegated runtime jobs use their own
repo-local `.remote/jobs/<id>/wt` workspace.

## The CLI

`harness <verb> [<subject>] [--<option>]` — homogeneous with the sibling sentropic CLIs (`stp harness …`):

- **Producers** (compute → emit a neutral `VerificationRun`): `check scope|branch`, `verify --category`,
  `audit`, `init`.
- **Recorders** (emit a neutral `WorkEvent` + point to a skill): `brainstorm`, `test`, `debug`, `review`,
  `plan`, `branch init|close`, `skills install`.

A recorder verb does NOT do the thinking — it scaffolds + records, and the `harness/<verb>` skill carries
the reasoning. Run the verb to open the act, then follow its skill.


## Strict scope / minimal diff

Solve only the explicit request and directly blocking defect. Before editing, identify the smallest
necessary file/line set. Preserve existing work: do not rewrite, reformat, move, rename, delete, refactor,
add dependencies, add abstractions, or clean up opportunistically unless required by the task. Prefer a
local compatible fix over a broader redesign. If a useful improvement is outside scope, mention it as an
optional follow-up instead of implementing it. Before finishing, check every hunk: if it does not directly
serve the objective, remove it.

### No-dead-end diagnosis

Treat a gap, blocker, or missing implementation as actionable only when evidence shows that it prevents
the explicit objective or a required verification. Do not end with that diagnosis alone. If the smallest
directly blocking change is both authorized by the request and within the agreed scope, resolve it. A
diagnosis-only request remains diagnosis-only. Otherwise provide one evidence-backed handoff:
responsible role (or `owner: to be assigned`), bounded scope, observable acceptance criterion, and
proportionate verification.

For an evidenced, non-blocking observation outside the scope, do not implement it or create work by
default. Mention it as an optional follow-up only when useful to the user, and cite the evidence. Record a
follow-up only when the request explicitly authorizes creating or updating tracked work, using the task's
established tracking flow; otherwise recommend it without recording it. Never create, assign, or
duplicate follow-up work from speculation. A handoff closes the diagnosed blocking item; it does not
satisfy or defer any remaining explicit objective.

## Discipline first

Process skills (`harness/brainstorm`, `harness/debug`) decide HOW to approach the task — invoke them
before implementation skills. "Let's build X" → brainstorm first. "Fix this bug" → debug first.
