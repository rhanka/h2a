# Delegation preamble — what a subcontractor reads before it starts

WP11 · Memory & context. Companion to [`RECALL.md`](./RECALL.md). Owner-facing state:
**proposed, not accepted.**

A subcontractor is a fresh model with no memory. It starts blank, it will re-propose a
hypothesis this repo already refuted, and it will return something plausible. From
2026-07-29 twelve lanes delegate to such models, so they are more numerous and faster than
the actors, and amnesiac by construction.

## Why this is not an extract of RECALL.md

The obvious answer — cut RECALL.md into twelve per-lane extracts — fails three ways, and
each failure is already a recorded defect:

- An extract still asks a **context-free** model to judge what is relevant to its task.
  Deciding relevance is the one thing a blank model cannot do.
- Twelve extracts are twelve copies that drift. That is REC-01's mechanism —
  a claim outliving its proof — industrialised twelvefold.
- A **file reference can be skipped**. INC-01 already proved that a memory nobody is
  forced to open is not a memory.

## The shape that works

You cannot give a blank model a memory. You can do two things instead:

1. Put the constraints **inside the only artefact it is guaranteed to read — its prompt.**
2. **Refuse its return** when the return asserts more than it proves.

So the subcontractor's memory lives in two places, neither of them the subcontractor: the
preamble the delegating actor prepends, and the gate the return passes through. Block 1 is
composed per task from `RECALL.md`; blocks 2 and 3 are fixed and copied verbatim.

## The preamble — paste this at the head of a subcontractor prompt

Self-contained, thirteen lines, no pointer to any document. A subcontractor that must read
three files before starting reads none of them.

**Short is a measured constraint, not a style.** `h2a run` truncates a long prompt silently:
`runtime` measured 10 977 characters cut by both hosts and 9 830 passing whole; `gateway` lost
the tail of both its subcontract briefs, and `conductor` lost the tail of a review brief —
which is where its honesty rules were. So the preamble must fit in a prompt that arrives
whole, and **the hard stops go first, because it is the end that disappears.** Line 1 is the
one that must survive; line 13 is the one you check has arrived.

```
Before you start, and these override any instinct you have about this repo:
1. Report nothing you did not see printed. If you did not run it, write "not measured".
2. Every claim names the artefact that would falsify it: file:line, command and output,
   commit, or event id. A claim with no locator is rejected, not corrected.
3. Say where your guarantee stops. "The tests pass" is not "the code is covered".
4. Never claim done, and never offer a green suite as acceptance. Only the owner accepts.
5. "Fixed on a branch" is not fixed. Name the branch and say whether it is merged.
6. The required gate does NOT cover packages/h2a-runtime: 73 test files there never run.
   A test you add there will not run. Put gated tests in packages/h2a/test.
7. A capability recorded as delivered may be unreachable. Before citing one, find the
   code path that switches it on.
8. An id you read in this working tree may not exist for anyone else: 264 of 785 journal
   events are uncommitted. Check origin/main before citing an item or decision id.
9. Work in an isolated git worktree based on origin/main, and run
   git branch --show-current before any commit: twelve actors share one checkout.
10. Do not widen the scope. Report other defects you find; do not fix them.
11. Never invoke the h2a CLI from a shell; a PreToolUse hook blocks it. Use MCP tools.
12. No Co-Authored-By or AI-attribution trailer. No backticks or $(...) in a git -m
    string; use -F file.
13. If your task needs any statement above to be false, stop and say so.
```

Lines 6 to 8 are the three hypotheses a fresh model re-proposes most reliably here, and
line 13 is what converts the list from advice into a stop. Compose nothing else per task
unless `RECALL.md` holds a `REF-*` entry that touches the task directly — then add it as a
fourteenth line, in the same imperative form.

### Deliver the preamble as a file when the channel fragments

Measured while delegating this lane's first subcontract, on the installed 0.88.0: a launch
prompt is typed into the pane **without a submit**. A multi-line prompt therefore
self-submits on its own newlines and arrives as *N separate messages* — the subcontractor
starts acting on fragment 1, before it has seen the task. A single-line prompt is never
submitted at all: `state: "started"`, 0 s of CPU, the prompt sitting in the input box.

**Which form to use, and when.** Paste the thirteen lines above whenever the channel
delivers a prompt intact — any harness, any agent tool, any hand-started session. That is
the default. Use a **file plus a one-line launch prompt** only for `h2a run` on 0.88.0,
whose delivery fragments as described: there, put the preamble and the task in a file in the
subcontractor's worktree and point at it in one line. It is not a retreat to "reference a
document and hope" — the launch prompt is the one thing a subcontractor cannot skip, and it
is written per task, so it is never a stale copy. When
`fix/h2a-run-prompt-delivery` merges, the paste form becomes correct there too.

Then **verify, before you consider the work started** — three checks, in this order:

1. The **composer is empty**. A prompt still sitting in the input box was never submitted.
2. The **child** process burns CPU — `ps --ppid <session.pid>`. `session.pid` is the wrapper
   and reads 0 s no matter what; measuring it proves nothing.
3. The last line of your preamble is visible in the transcript. If line 13 is missing, the
   prompt was truncated and the rules at the end never arrived.

A launch that reports `started` is not a launch that ran (RECALL.md REC-10, REC-14). And
never infer the routing from what you requested: read what the launch returned — `required`
is silently downgraded, not refused (REC-15).

---

## Block 1 — What you may not assume *(composed per task)*

The delegating actor pastes the `REF-*` lines from `RECALL.md` that touch this task, one
line each, plus this standing line:

> A passing test suite is not an acceptance. It proves a test passed, not that the owner
> got what they asked for.

Then, verbatim:

> If your work needs any of the statements above to be true, **stop and say so.** Do not
> design around it, and do not treat it as an open question you may settle yourself.

## Block 2 — The return contract *(fixed, paste verbatim)*

> - Every claim you make names the artefact that would falsify it: a file and line, a
>   command and its output, a commit, an event id. A claim with no locator will be
>   rejected, not corrected.
> - If you did not run it, write **"not measured"**. Never report a verdict you did not
>   obtain, and never a summary of one — cite the artefact itself.
> - Say where your guarantee **stops**. "The tests pass" is not "the code is covered".
> - "Fixed on a branch" is not "fixed". Name the branch, and say whether it is merged.
> - Report what you did **not** do, and what you skipped, as plainly as what you did.
> - Never claim done. Only the owner accepts.

## Block 3 — The write boundaries *(fixed, paste verbatim)*

> - Work in an **isolated git worktree based on `origin/main`**. Run
>   `git branch --show-current` before any commit: twelve actors share one checkout and
>   its local `main` has diverged from `origin/main`.
> - `--workspace` only bites on `item new`, `decision new`, `ingest`. On verbs taking an
>   `itemId` it is accepted, exits 0, and is ignored. Never call `track workspace-id` here.
> - `.track/` is append-only and single-writer: write from the repo root, never from a
>   concurrent worktree.
> - Never invoke the `h2a` CLI from a shell; a PreToolUse hook blocks it. Use the MCP tools.
> - **Do not widen the scope.** If you find another defect, report it and continue; do not
>   fix it.
> - No `Co-Authored-By` or AI-attribution trailer. No backticks or `$(...)` inside a
>   `git`/`gh` `-m` string — use `-F file`.

---

## The gate — what the delegating actor does on return

This is the enforceable half, and it belongs to the actor, who has a memory, not to the
subcontractor, who does not. **Reject the return, do not repair it, when:**

| # | reject if | because |
|---|---|---|
| 1 | a claim carries no locator | an unfalsifiable claim cannot be reviewed, only believed |
| 2 | a locator does not resolve | see RECALL.md QUARANTINE: four circulating claims died here |
| 3 | a verdict is reported without its artefact | reviews have been narrated rather than run |
| 4 | `done` is claimed, or a green suite is offered as acceptance | REF-02 |
| 5 | the return is broader than the task | scope drift is not a bonus |

Rejecting on the *form* of the return is what makes this work on a model that knows
nothing: you are not asking it to remember, you are refusing an unverifiable answer.

## Where this stops

For the subcontractor, a prompt convention sits at the **habit** rung: nothing forces the
actor to paste the preamble, and nothing forces block 1 to be composed correctly. The gate
is the only part above habit, and it is exactly as strong as the actor applying it — the
builder of a return must not be its own reviewer, and that includes when the builder is
your own subcontractor.

To push this to **structural**, the delegation surface itself would have to refuse a
return that carries no locator — a change to h2a's run and report path, which is not this
lane's to make. Traced, not taken.
