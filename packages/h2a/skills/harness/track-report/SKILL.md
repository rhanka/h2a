---
name: track-report
description: Use when asked for a track report, status, or advancement report. Read the deterministic conductor first; any contextual synthesis is advisory conversation work.
---

# harness/track-report

The agent already in the conversation supplies the contextual prose. `track` supplies complete,
deterministic facts. Do not call a model, adapter, gateway, or network-backed report path. Every command
below is a local, read-only projection of the folded log.

## Bootstrap a fresh clone

`track` is built from this repository; a fresh clone has neither `packages/track/dist` nor a local
`track` executable. From the repository root, bootstrap it once before the read commands:

```bash
npm ci
npm run build -w @sentropic/track
track() { npm exec --workspace @sentropic/track -- track "$@"; }
command -V track
```

The last command must report `track` as the local shell function. It invokes this checkout's built
workspace binary and cannot fall through to a globally installed `track`, which can describe another
revision. Keep the function in the shell that runs the report commands. The bootstrap and every command
below are read-only with respect to `.track/`.

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

The three commands are the live-report route. To verify the named historical golden only, materialize its
fixed log and run these **same three commands** with `--track-dir <fixture-dir>` and `--commit <fixture-sha>`
on every command. That fixture override is not a live-report default and must not replace the commands
above.

Do not use `track report --flat` to recover omitted conductor rows: it is a deterministic flat diagnostic,
not an emergency route. The conductor projection above is complete. Do not use `track report --level wp`
to label WPs for this report; it is a different status projection. If it is useful as a diagnostic, its
labels now match the conductor, but the conductor remains the report's single source.

If `outsideRollup` is non-empty, render a visible **HORS ROLLUP** group with every row, including its
emitted `id`, `workspace`, bucket, title, and attachment. `wpId` absent means the item has no WP ancestor;
a present `wpId` means an intermediate non-WP item is outside the leaf-only rollup. Neither may disappear
from the report. There is no persisted "fixture" or "suspect" classification: a row such as `seed A` in
`ws:test` must appear exactly as stored, not be silently hidden or labelled test noise. Check that
`DONE + TO-DO + AWAITED + DROPPED` equals
`wpTotals.done + (wpTotals.active - wpTotals.done) + wpTotals.dropped`; if it does not, report the mismatch
as a tool defect rather than silently selecting a denominator.

`view.directives` is already in canonical urgency order. Preserve that array order whenever directives are
listed; never re-sort or group it by `rank`. `rank` is a coarse display badge, so repeated/interleaved
badges are intentional. The fixed ladder is: decision/engagement wait, dependency, failed acceptance,
in-progress work, stale acceptance, missing specification, WSJF-ranked to-do, then fallback. WSJF breaks
ties only within its tier; it does not explain a change between these tiers.

## Inspect decisions safely

Never infer choices by parsing a prose `context` field.

- A `structured` decision has at least two stored `options` and a stored `recommendation`; render those
  choices, their stored titles/summaries, and the recommendation in **DÉCISIONS**. Do not invent an effect:
  no separate machine-readable effect field is exposed.
- An `unstructured` decision has no machine-readable choice set, even if its prose happens to contain
  “Choix A”. Put it in **À INSTRUIRE** as “dossier à structurer”; say explicitly that alternatives are not
  recorded. Do not present it as an owner choice with invented alternatives.

For a single structured dossier, use the exact workspace from `decision ls`:

```bash
track focus <decision-id> --workspace <workspace-from-decision-ls>
```

`--workspace` is required. A mismatched workspace is an error; never substitute `track workspace-id` or a
workspace inferred from the current directory. Unstructured dossiers do not reserve a D-number: list them
in À INSTRUIRE as “dossier à structurer”.

This skill is **advisory**. No command, hook, MCP tool, or validator executes it
or proves that a synthesis followed it. Do not describe this guidance as an
enforcement mechanism.

**FAIT** — `scope · avancement · dernières actions`. State this boundary exactly: `journal plié courant;
baseline d’acceptance: <resolvedCommit emitted by the raw snapshot>`. A current-request, explicitly supplied
owner session boundary may be added verbatim. Do not claim a "last report", a time period, or a delta:
none is retrievable from these calls, and `--commit` is an acceptance baseline, not a reporting window.
Synthesize accomplishments, not inventory. Keep the raw and conductor total distinction honest: they
should now reconcile; mention HORS ROLLUP when it is non-empty.

**À-FAIRE** — consume the emitted tables; do not join `view.tables.todo` to `view.directives` yourself.
`view.tables[id=todo]` already has exactly `WP · avancement · à faire · bloqué · prochaine action` for each
WP row. Its machine-only `directiveIds` property is an audit link, not a field an agent must use to derive
text. `bloqué` is render-ready: it says `Aucun blocage enregistré` only when there is no `gate`; a gate with
no `blockedBy` still has its precise rendered phrase (including `spec-not-ready` and `acceptance-stale`).
`prochaine action` already names the routing executor. When present,
`view.tables[id=todo-unscoped]` follows immediately as **À-FAIRE SANS WP**, with the same five columns;
render every row there. Those directives have no `scope.wpId` and are not HORS ROLLUP rows. Do not assign
them to a similarly named WP or omit them.

Do not call an absent `facts.wsjf` subjective "priority". A `priority-missing` directive means the log has
no assessment; only an owner-authorized write such as
`track priority assess <item-id> --ubv <n> --tc <n> --rr <n> --js <n>` can add one.

The log does **not** record a model or reasoning effort. Owner/session context means only (1) an explicit
owner statement in this report request/current conversation, or (2) an explicitly cited owner-authored
session artifact that maps this exact item, WP, or directive to an executor (and, if claimed, model/effort).
It excludes project memory, repository documents, installed configuration, defaults, prior conventions, and
inference. Context may enrich executor prose only; it never overrides emitted order, gates, or facts. When
the report needs model/effort but that narrow context is absent, write exactly:
`exécuteur: contexte owner requis (modèle/effort non présents dans le journal)`.

**DÉCISIONS** — only structured, genuine native dossiers (pending or settled). Render their stored alternatives,
recommendation, and a durable selected option when present. `formatWpConductor` uses ordinary
drawn tables and does not add a fence; add one only when the destination requires it. Rule-derived
blocker prompts stay in À-FAIRE; unstructured dossiers stay in À INSTRUIRE.

Number only pending structured dossiers `D1…Dn`, in their relative `decision ls` order, and retain each
decision id. Settled structured dossiers may be rendered as history but receive no reply number from this
command. If `decision ls` has zero `structure: "structured"` rows, RECOMMANDATION must say exactly:
`Aucun D# disponible : aucun dossier structuré sélectionnable dans le journal.` Do not invite `D1 A`; name
only recorded non-decision directives that can start now, and name each unstructured dossier's revision in
À INSTRUIRE as the prerequisite to a selectable decision. If no non-decision directive exists, say that no
executable lane is attested.

**À INSTRUIRE** — render every `view.tables[id=prepare]` row as a legacy dossier to structure. Its prose
may be source material for an authenticated revision, but does not create alternatives or a reply choice.

**HISTORIQUE NON STRUCTURÉ** — render every `view.tables[id=legacy-history]` row after À INSTRUIRE and
before DÉCISIONS/ACTIONS. It records a settled legacy outcome and must state that no selected option is
attested; it is neither a current choice nor a D-number.

**RECOMMANDATION** — an executable plan conditioned on those decisions: name lanes that can start now,
what each answer unblocks, and where executor context is still required. The owner must be able to reply
`vas y` or `D1 A · D2 B` only when such structured pending D-numbers exist; it must not pretend an
unrecorded choice exists.

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
