---
name: track-report
description: Use when asked for a track report, a status, or an advancement report — renders deterministic track facts into FAIT / À-FAIRE / DÉCISIONS / RECOMMANDATION in session, with no AI subprocess.
---

# harness/track-report

The agent already in the conversation supplies the contextual prose. `track` supplies complete,
deterministic facts. Do not call a model, adapter, gateway, or network-backed report path. Every command
below is a local, read-only projection of the folded log.

## Read the deterministic layer

Run these commands from the repository root, in this order:

```bash
track report --raw --format json
track report --wp --decisions --format json
track decision ls --outcome pending --format json
```

- The first command is the factual snapshot: all buckets, their raw total, recent events, decision
  `structure`, `outsideRollup`, and a reconciled `wpTotals`.
- The second is the complete conductor projection. Its `wpTree` and `view` are the only source for WP
  identity, per-WP percentages, directives, and their deterministic order. It never truncates rows.
- The third lists every pending decision without a renderer cap. Each row carries its exact `workspace`,
  `options`, `recommendation`, and `structure` (`structured` or `unstructured`).

Do not use `track report --flat` to recover omitted conductor rows: it is a deterministic flat diagnostic,
not an emergency route. The conductor projection above is complete. Do not use `track report --level wp`
to label WPs for this report; it is a different status projection. If it is useful as a diagnostic, its
labels now match the conductor, but the conductor remains the report's single source.

If `outsideRollup` is non-empty, render a visible **HORS ROLLUP** group with every row. `wpId` absent means
the item has no WP ancestor; a present `wpId` means an intermediate non-WP item is outside the leaf-only
rollup. Neither may disappear from the report. Check that `DONE + TO-DO + AWAITED + DROPPED` equals
`wpTotals.done + (wpTotals.active - wpTotals.done) + wpTotals.dropped`; if it does not, report the mismatch
as a tool defect rather than silently selecting a denominator.

## Inspect decisions safely

Never infer choices by parsing a prose `context` field.

- A `structured` decision has at least two stored `options` and a stored `recommendation`; render those
  choices, their stored titles/summaries, and the recommendation in **DÉCISIONS**. Do not invent an effect:
  no separate machine-readable effect field is exposed.
- An `unstructured` decision has no machine-readable choice set, even if its prose happens to contain
  “Choix A”. Put it in **À-FAIRE** as “dossier à structurer”; say explicitly that alternatives are not
  recorded. Do not present it as an owner choice with invented alternatives.

For a single structured dossier, use the exact workspace from `decision ls`:

```bash
track focus <decision-id> --workspace <workspace-from-decision-ls>
```

`--workspace` is required. A mismatched workspace is an error; never substitute `track workspace-id` or a
workspace inferred from the current directory. Number only structured decisions `D1…Dn`, in their relative
`decision ls` order, and retain each decision id alongside the number. Unstructured dossiers do not reserve
a D-number: list them in À-FAIRE as “dossier à structurer”.

## Render four sections, in this order

**FAIT** — `scope · avancement · dernières actions`. State the period you used (last report, baseline
commit, or explicit session boundary) and synthesize accomplishments, not inventory. Keep the raw and
conductor total distinction honest: they should now reconcile; mention HORS ROLLUP when it is non-empty.

**À-FAIRE** — `WP · av. · à faire · bloqué · prochaine action`. Render every WP from `view.tables`, then
the HORS ROLLUP rows when present. Start with the deterministic `view.directives` order: it combines the
recorded gate/acceptance/WIP ladder with stored WSJF where one exists. Do not call that subjective
“priority” when `facts.wsjf` is absent. A `priority-missing` directive means the log has no assessment;
only an owner-authorized write such as
`track priority assess <item-id> --ubv <n> --tc <n> --rr <n> --js <n>` can add one.

`prochaine action` must name an executor. The log does **not** record a model or reasoning effort. Use a
model/effort only when owner/session context supplied it; otherwise write exactly that the executor is
owner context required, for example: `exécuteur: contexte owner requis (modèle/effort non présents dans le
journal)`. Do not invent `sol xhigh` or similar conventions, and do not leave the field blank.

**DÉCISIONS** — only structured, genuine pending decisions. Render their stored alternatives and
recommendation in a drawn table inside a fenced block; terminal Markdown tables cannot carry those lines
reliably. Rule-derived blocker prompts and unstructured dossiers stay in À-FAIRE.

**RECOMMANDATION** — an executable plan conditioned on those decisions: name lanes that can start now,
what each answer unblocks, and where executor context is still required. The owner must be able to reply
`vas y` or `D1 A · D2 B` without the report pretending an unrecorded choice exists.

`track report --inline` is a compact terminal summary, not the complete report route: it may summarize a
tail with an explicit count. Do not use it to satisfy the four sections above or to recover HORS ROLLUP rows.

## Honesty rules

- Every conductor row, pending decision, and outside-rollup item appears. Never summarize a hidden tail as
  “+N autres”.
- A rule-derived prompt is not a decision. It belongs in À-FAIRE as a dossier/action to prepare.
- Prefer named items and concrete acceptance debt over generic counts.
- The deterministic layer proves structure and order; contextual wording remains the agent's responsibility.
  State uncertainty instead of promoting a missing stored fact to a conclusion.

Spec: `docs/specs/2026-07-28-track-report-contextual-rendering.md`.
