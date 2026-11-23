---
name: code-debt
description: Use when the owner asks to inventory, plan, or prioritise existing change-risk debt (functions already over the CRAP line) — computes the per-repo inventory, shapes independent lots, and gets the order ratified by the owner before any work is created. Never opens a refactoring inside a running lot.
---

# harness/code-debt

Native sentropic handling of EXISTING change-risk debt. The rule for new and touched code lives in
`harness/test` (Change risk); this skill handles what was already over the line. You **propose**; the
owner **ratifies**; only then is work created. It works on the repo it is invoked in.

## When

Only on an explicit owner request, or at a planning point the owner set. Never from inside a feature
or bugfix lot: there, a function already over the line is reported and left (`harness/test`), and the
lot goes on.

## The rules it relies on (`harness/test`)

- Debt is a function over 30. Between 10 and 30 is worth a look, not debt.
- The gate reports first and blocks later, per repo, on a measured criterion. It never fails on
  existing debt: only a function added or made more complex can trip it. So no debt lot is ever forced.
- A `case` that only delegates is not counted. That is the remedy for a dispatch function.

## 1. Inventory (computed, never hand-kept)

Run the repository's change-risk command on the whole repo, not on a diff. List every function over 30
with its complexity, coverage (or `N-A`), size, and package. Do not store the list in the repo: it is
recomputed each time, so it cannot drift. Keep only the count and the commit it was measured at.

Sort each function into one shape. The shape decides the remedy:

- **Under-tested** — complexity 30 or less, score over 30. Tests are enough; no code change.
- **Dispatch** — most of the complexity is `case` branches, or an `if` chain on one value. Make each
  branch delegate. The switch itself is not worth reducing.
- **Tangled** — nested decisions, long body. Pin the behaviour with tests first, then split.
- **Not ours to change** — generated, vendored, frozen evidence. Exclude it from the repository's
  change-risk perimeter, with a reason.

## 2. Lots

One lot is one function, or one tight cluster in one file. Each lot states the tests that pin current
behaviour (first commit), the change, the score expected after, the files touched, and what it must not
touch. Lots are independent: each can ship alone, in any order. A lot that needs a file a running branch
already owns is marked `waits for <branch>` and is not started. Keep one debt lot in progress per repo
unless the owner sets another limit.

## 3. Prioritise with the owner

Rank by what the owner bears, not by score alone: how often the function changes (git history), what
breaks if it breaks, how cheap the lot is. Present the proposal with `present-decision`: a short
dossier, the smallest useful first batch, and the option to do nothing now. Do not create work before
the owner answers.

## 4. Record in track (only on approval)

One parent item for the theme and one child item per ratified lot (`track item new --kind chore …
--parent <id>`); open the decision first (`track decision new`, through `present-decision`), then
record the owner's choice with `track decision select`. Each lot then runs as an
ordinary `harness/plan` lot on its own branch from the main branch, reviewed with `harness/review`.
Close the item when the function is back at or under 30, or excluded with a reason.

## Never

- Start a debt lot inside, or stacked on, a running feature branch.
- Split a function to move a number: tests first, and split only what stays readable.
- Lower a score with tests that assert nothing.
- Create or reorder work without the owner's answer.
- Impose the inventory on another repository.
