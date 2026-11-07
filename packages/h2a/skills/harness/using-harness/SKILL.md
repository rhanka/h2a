---
name: using-harness
description: Load FIRST in any sentropic repo — establishes the harness method (branch/scope/test/debug/review/security/track-report/brainstorm/plan) and replaces legacy superpowers for those acts.
---

# Using harness

## Questions for the human

When a useful clarification needs a human answer, use the native structured-question tool exposed in the current mode of the current host:

| Host | Native question tool |
| --- | --- |
| claude | `AskUserQuestion` |
| codex | `request_user_input` |
| muse | `request_user_input` |
| agy | `ask_question` |
| gemini | `ask_user` |
| vibe | `ask_user_question` |

Codex may expose `request_user_input_async` instead; use the variant actually available. Gemini disallows `ask_user` in non-interactive mode; Muse removes `request_user_input` in `--yolo` or when disabled. For other hosts, use their exposed native question tool without guessing its name.

Offer clear choices and preserve native free-text input. Do not change modes or permissions to obtain a tool. A preference is not authorization; existing authorization remains valid. Continue independent work when the mode allows.

For a decision with stakes, present a decision dossier with a diagram before the native question; never a bare text question or an unexplained option menu. If the native tool is unavailable, explain the limitation and leave the decision pending. Plain text is acceptable only for a low-stakes clarification when no native question tool is available.

## Owner gates and conductor duty

An owner gate is a pending GO/signature/decision blocking the target's own authorized work. Reuse
existing authorization. In the required session, immediately present a short stakes dossier (action,
why this session, options/consequences, recommendation, small diagram), then invoke the permitted
native question tool. Neither a status row nor an instruction to type elsewhere raises that question.

The originating conductor is the single writer of one pending binding. Prefer an explicit Track
pending item; an active loop may hold it only with durable discovery from full `h2a loop logs` and
transfer to Track before done/stop, or immediately on unexpected terminal state. A loop's last-ten
status tail is insufficient. Record gate id/revision, human owner, conductor, action boundary, exact
instance and discovered h2a/native session identities, UTC escalation deadline, cadence/next reminder,
executor and close condition. Use agreed timing, otherwise 15-minute reminders/30-minute escalation.
These deadlines never approve or cancel. On restart query Track pending items and the full loop
journal; restore each still-open gate. A receiver verifies the existing binding and its own task/session;
it never creates a second binding or joins the conductor's ticking loop merely to report.

A qualified reminder executor must demonstrably wake the conductor at `nextReminderAt`, expose
liveness and have budget for continued due checks. Naming an agent or starting today's bounded loop
controller is insufficient. Without this, record `reminders-unavailable`, report the follow-up rule
unmet and immediately alert the owner in the conductor's session or a designated safe owner-facing
session. Storage failure likewise triggers an immediate alert and repair, never a claim of saved state.

**Never send h2a traffic or inject loop/drumbeat/drive wakes into an open or unknown native dialog.**
Current wakes can type Enter. This also applies to the conductor/relay and sibling sessions sharing
an inbox. Keep the questioning target out of a ticking loop. Due reminders go to the conductor's
own native attention surface, or a known-safe owner-facing session, as `OWNER GATE ALERT <id>` with
acknowledge-only choices and the required answer session. They never offer GO elsewhere. Re-raise
at the target only after confirmed failed/closed/not-displayed state and safe delivery; uncertainty
remains pending with an owner alert, not another target message. Reuse an open attention question.

Record evidence as `missing`, `unavailable`, `peer-reported` or `trace-verified` (gate/revision, tool,
session, time, call/trace reference). In this method lot, cross-session reports remain peer-reported
unless independently inspectable host evidence exists. A signed report is not such evidence. Before
a blocking call the target reports question-planned, then after the answer reports the tool result;
use signed replies only to a safe recipient, otherwise retain the report locally until safe delivery.
Planned, attempted/rejected calls, delivery, wake and `decision-raised:<id>` never prove display.

Only the required session acts on its attributable owner answer and required signature. The conductor
may close follow-up on a correlated peer-reported answer recorded with that evidence level; it grants
no authority elsewhere. No report reply slot or `track decision select/outcome` may manufacture a
session-bound GO. Deferral stays pending; cancellation or native-session rebinding requires explicit
owner authorization. Without a permitted native tool, show the limitation, retain pending and alert
through a safe owner-facing surface; never change modes/permissions. Continue independent work.

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
| dependency / vulnerability debt | `harness/security` | — |
| track report / status / advancement | `harness/track-report` | — |
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

## Rebase, never cherry-pick

To move committed work between branches, rebase — never cherry-pick. Cherry-pick copies a commit under a
new SHA, so the same change now exists twice with different identities: history diverges, a later merge or
rebase sees "different" commits, and the duplicate resurfaces in diffs, reviews, and merge-loss checks.

- To retarget a branch onto an updated base, `git rebase <base>` (or `git rebase --onto <newbase> <upstream>`
  to replay only a specific range). The commits keep their logical identity and the branch stays linear.
- To isolate one feature's commits from an entangled branch, `git rebase --onto origin/main <commit>~1 <branch>`
  replays exactly that range onto the base — a rebase, not a copy.
- `git cherry-pick` is reserved for the narrow case of applying a change to a branch that will NEVER share
  history with the source (e.g. a backport to a frozen release line). It is not a tool for normal
  branch-to-branch movement, and never a substitute for rebasing a feature onto a fresh base.

Rationale: this is the same non-duplication discipline the branch-lifecycle event-containment gate enforces
for `.track` — a copied commit is a second identity for one change, and every downstream tool then has to
reconcile two things that should have been one.

## Discipline first

Process skills (`harness/brainstorm`, `harness/debug`) decide HOW to approach the task — invoke them
before implementation skills. "Let's build X" → brainstorm first. "Fix this bug" → debug first.
