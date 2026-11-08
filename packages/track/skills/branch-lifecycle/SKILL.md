---
name: branch-lifecycle
description: "Use at a branch merge or branch-close to protect track's event log from merge-time loss and to refresh acceptance. DETECT-and-GUIDE only, never auto-repair: judge git ancestry in the shell, detect STRUCTURAL event loss via `track events-contains` (NOT audit.orphan, which is blind to a reparent lost toward a valid parent), recover OPPORTUNISTICALLY from a surviving ref/reflog before declaring anything irrecoverable, then re-anchor acceptance freshness with query/report --require-accepted + consolidate and RE-READ to surface done-but-skipped items. Orchestrates the existing CLI; reimplements nothing."
---

# Branch Lifecycle (merge / branch-close)

Run this at a `.track`-bearing merge or branch-close. It is **record-only and detect-and-GUIDE**: it
diagnoses and reports, it **never repairs in autonomy**. It orchestrates the existing `track` CLI
(`events-contains`, `reseal`, `validate`, `query`, `report`, `consolidate`, `audit`, `restructure
apply`) and reimplements nothing. All git is done **in the shell** — track's core stays git-free.

## Why this exists

Track's system of record is one append-only NDJSON stream (`.track/events.jsonl`). A merge can silently
**drop committed events** — the graphify incident: a squash-merge threw away 18 committed reparent
events. Two protections now work together: (1) the repo pins `.track/events.jsonl merge=union` in
`.gitattributes`, so disjoint appends auto-reconcile — union keeps EVERY line from both parents, so the
merged log is always fold-recoverable; (2) a union-merged log carries a broken positional hash-chain
(and possibly duplicate `seq`, plus one side's stale `head.json`), so the **merge preparation step**
runs `npx track reseal && npx track validate` right after the merge (see "Merge preparation" below)
before any further `track` append — the store fail-closes on an invalid log. This skill's
**CONTAINMENT GATE** remains the safety net over whatever the merge driver did: it proves the
post-merge log contains every branch event id.

The gate is **event-id CONTAINMENT, not "squash vs merge-commit"**. Squash-vs-merge is the wrong
predicate — too weak (a default-driver merge-commit on a divergent log can still lose/conflict) and too
strong (a squash of a NON-divergent `.track` loses nothing). The real invariant is: the post-merge log
must **contain every branch event id**.

## 1. Judge ancestry (shell)

Establish the base and the branch tip, and whether the branch is already contained:

```bash
BASE_REF="${BASE_REF:-origin/main}"        # the integration target
BRANCH_REF="${BRANCH_REF:-HEAD}"           # the branch being merged/closed
git merge-base --is-ancestor "$BRANCH_REF" "$BASE_REF" && echo "already merged" || echo "diverged"
```

If the branch is already an ancestor of the base, there is nothing to merge — skip to step 4 (freshness).

## 2. Detect structural loss via `track events-contains` (NOT audit.orphan)

`audit.orphan` is **blind** to the graphify mode: a reparent lost toward a *valid* parent produces ZERO
orphans. Detect loss on the **event-id set** instead, against the **real** post-merge log produced by a
trial merge. Use the asset wrapper, which does exactly this:

```bash
bash "$(dirname "$0")/assets/check.sh"      # in CI; or run it from the skill's assets/ dir
```

It (a) trial-merges the branch into the base in a throwaway worktree (honoring whatever merge driver is
configured — a conflict on `events.jsonl` surfaces as an unevaluable candidate ⇒ rc=2, fail-closed),
(b) takes the branch tip's `.track/events.jsonl` as the set that must survive, (c) runs
`track events-contains --base <branch.jsonl> --candidate <post-merge.jsonl>`, and **FAILS on
non-containment** (rc=1 = loss; rc=2 = setup error). rc=0 means every branch event id survived the merge.

The merge gate predicate is precisely:

```
events(post-merge real) ⊇ events(branch)
```

## 3. Opportunistic recovery (before declaring irrecoverable)

A detected loss is **not** automatically irrecoverable. Recovery is opportunistic from a **surviving
copy** — this is exactly what saved graphify (events were RE-READ from the branch's `.track`, never
invented). If `events-contains` reports missing ids, try, in order:

1. The branch **ref** still pointing at the pre-merge tip:
   `git show <branch-sha>:.track/events.jsonl` — the lost events are right there.
2. The **reflog** if the ref was moved/deleted: `git reflog` / `git rev-parse <branch>@{1}` to find a
   surviving tip, then `git show <that-sha>:.track/events.jsonl`.

From a surviving copy, the recovery is to **re-apply the lost facts through the normal CLI** (e.g.
`track restructure apply` for lost reparentings) so they re-enter the append-only log legitimately —
never by hand-editing `.track`. Only when **no** copy survives (no ref, no reflog entry) do you report the
loss as **irrecoverable**. In every case this skill **reports**; it does not silently rewrite the store.

## 4. Refresh acceptance freshness, then RE-READ for done-but-skipped

A merge moves HEAD, so acceptance must be re-evaluated against the merge commit, and `done` items
re-anchored:

```bash
MERGE="${MERGE:-HEAD}"
DONE_IDS="$(track query --realization done --commit "$MERGE" --format json | jq -r '.[].id' | paste -sd,)"

track report --commit "$MERGE" --require-accepted          # surface what is NOT freshly accepted
track consolidate --items "$DONE_IDS" --commit "$MERGE"     # re-anchor eligible done items
```

`consolidate` is **safe to feed every done item** — it self-filters via its eligibility rule
(`isConsolidationEligible`); a stale-vs-merge skip is a no-op, not a hazard. But `consolidate` prints only
`ok` — it **never prints the count of skips**. So you MUST **RE-READ after** and surface the **done items
it SKIPPED** (a live `fail` criterion / `waived`-only acceptance makes an item ineligible):

```bash
track report --commit "$MERGE" --require-accepted          # RE-READ — list done items still NOT consolidated
```

Report any such items as **"NOT consolidated — to treat"**. Do not mark them done-and-accepted on their
behalf.

## Recommendation for `.track` branches

Because the gate is **containment**, a **merge commit** (two real parents) lets the containment check
operate on the actual merge; a squash collapses history and can drop a divergent residual. So **recommend
a merge commit** for PRs that touch `.track` — but **gate on containment, never on "is it a merge
commit"** (that proxy both misses real losses and blocks harmless squashes). The containment check fails
closed on any candidate it cannot evaluate, so a lossy or conflicting merge is blocked regardless of the
merge driver.

## Merge preparation (union + reseal)

Union keeps every line, so completing the merge means re-chaining the journal. When you merge — the
branch into the base, or the base into the branch — run:

```bash
git merge origin/main && npx track reseal && npx track validate
```

`track reseal` rewrites ONLY the integrity frame (`seq`, `prevHash`) of every event plus the `head.json`
anchor — never an event `id` or `contentHash`, so `events-contains` containment over ids survives a
reseal. It is idempotent on an already-valid log (byte-identical no-op) and fails closed — refusing to
write — on a tampered event core (`content-hash`), a duplicate id with divergent content
(`duplicate-event-id`), or a command batch interleaved across the merge seam
(`batch-noncontiguous`); in that last case the merged log is not resealable as-is — recover a
well-ordered copy from a surviving ref/reflog (step 3), reseal THAT, and only then re-apply any
residual facts through the normal CLI.

## Hard rules

- Record-only. Never auto-repair, never hand-edit `.track/events.jsonl`. The ONLY sanctioned
  whole-log rewrite is `track reseal` as merge preparation — it re-chains the integrity frame; it
  never invents, rewrites, or drops an event.
- Detect loss via `events-contains`, never via `audit.orphan`.
- Git lives in the shell / this skill; track's core stays git-free.
- Orchestrate the existing CLI; reimplement nothing.
