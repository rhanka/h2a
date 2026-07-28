---
name: track-report
description: Use when asked for a track report, a status, or an advancement report — renders the deterministic output into FAIT / À-FAIRE / DÉCISIONS / RECOMMANDATION in session, with no AI subprocess.
---

# harness/track-report

The deterministic layer is correct and stays untouched. Your job is the CONTEXTUAL
rendering: you already hold the conversation, so you already know what "the last period"
means and which work is in focus. Render it yourself.

**Never call a model to write this report.** No adapter, no gateway, no subprocess. That
chain has four links and each one has failed; a report that cannot be produced with the
network down is not a report. Everything you need is in the commands below plus the
session you are already in.

## Read the deterministic layer

```
track report --raw --format text      # buckets, rule-derived facts, recent events
```
plus the legacy conductor projection (MCP `track_report`, `format: text`,
`decisions: true`) for the FAIT / À-FAIRE / DÉCISIONS-ACTIONS table with real item titles,
and `track focus <decision-id>` for a decision's alternatives.

Reference output: `docs/specs/examples/track-report-raw.txt`.
Reference rendering: `docs/specs/examples/track-report-contextual.md`.

## Render four sections, in this order

**FAIT** — `scope · avancement · dernières actions`. Synthesise what was ACCOMPLISHED in
the period, not what exists. "54 items faits; poursuivre les WP ouverts" is the generic
cell you are replacing. The period has several scales: default to since the last report or
the baseline commit, and say which you used.

**À-FAIRE** — `WP · av. · à faire · bloqué · prochaine action`. One table, ordered by
priority; the focus WPs are simply the first rows. No focus column — `①②③ / dette / —` is
noise. `prochaine action` must be executable and name who runs it (which model, which
effort), because the owner acts on this column.

**DÉCISIONS** — only genuine decisions, each with its alternatives and a recommendation.

**RECOMMANDATION** — an executable plan conditioned on the decisions: which lanes start
now with no answer, and what each answer unblocks. The owner must be able to reply `vas y`
or `D1 A · D2 B · …` and have work begin.

## Alignment with `track focus` — same data, two renders

`track focus <id>` already carries `Choix A / Choix B / Recommandation / Effet` per
decision. The report's DÉCISIONS table is that same triplet rendered inline; focus mode is
one dossier per screen. **Switching to focus mode re-derives nothing.** Number the
decisions `D1…Dn` in the same order focus uses (`1/6`, `2/6`, …) so an answer of `D3 A`
is unambiguous in both views.

⚠️ That triplet is currently one prose `context` string, so the table render PARSES free
text. A parser over prose is a habit dressed as a mechanism: it will produce an empty cell
the day someone writes the context differently. When a cell comes out empty, say so —
never render a decision with no alternatives as if it had none.

## Four rules that carry the report's honesty

**Every WP appears.** A workpackage in the rollup is a row, interesting or not. If you
choose which to mention, absence stops carrying information and the report becomes an
essay.

**A rule-derived prompt is not a decision.** The raw layer emits
`[focus-decision] décision: Instruire le dossier puis trancher` automatically whenever an
item has an open blocker — nobody framed a choice. Putting those under DÉCISIONS tells the
owner he is the bottleneck when there is nothing to arbitrate. They belong in À-FAIRE as
"dossier to instruct".

**Substance, not counts.** "5 rerun-acceptance actions" says nothing. Name the items and
why it matters — those five are completed items whose acceptance went stale, so they
cannot serve as release evidence. That is the sentence worth printing.

**A drawn table for multi-line cells.** Markdown tables cannot hold a line break and
`<br>` renders literally in a terminal. Alternatives need several lines, so draw that
table inside a fenced block, exactly as `formatWpConductor` does.

## Where this stops holding

You can still write a poor synthesis inside a cell, and nothing here prevents it. What the
structure guarantees is narrower and worth stating: no WP disappears, no automatic prompt
is promoted to a decision, and the report renders offline.

Spec: `docs/specs/2026-07-28-track-report-contextual-rendering.md`.
