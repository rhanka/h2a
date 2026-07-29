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
