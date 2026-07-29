# Track report over a period

Owner request, 2026-07-29.

A track report always answers a question about a **period**. Today nothing
carries one: `--commit <sha>` selects the acceptance baseline, not a window, and
the header prints raw bucket counters (`DONE 57 · TO-DO 29 · AWAITED 5 ·
DROPPED 2`) that the owner has stated plainly are of no interest. The period
must be an input, and it must come back out — in the raw projection, in the
contextual report, and in focus.

## 1. The period is an input

`track report` accepts a window. All three forms must work, because all three
are things the owner actually asks for:

```
track report --since <sha|date>              # since a commit, or a date
track report --since <sha|date> --until <sha|date>
track report --period today|week|month|all   # named shorthands
```

`--period all` means the whole log, from the first event. `--since` without
`--until` runs to the head of the log. A date is `YYYY-MM-DD` in local time; a
sha is resolved against the repository, and its committer date bounds the
window. Absent any of these, the report covers the whole log and says so — it
does not silently pick a default window and present it as everything.

`--since` and `--period` are mutually exclusive; passing both is an error, not a
precedence rule. `--commit` keeps its current meaning (acceptance baseline) and
is orthogonal: a report can be *about* July while its acceptance is judged
against HEAD.

## 2. The raw projection restitutes it

The emitted payload carries the window it was asked for, resolved to absolute
bounds, alongside what the fold actually saw:

```jsonc
"period": {
  "requested": "today",              // verbatim, as typed
  "from": "2026-07-28T00:00:00-04:00",
  "to":   "2026-07-28T23:59:59-04:00",
  "fromRef": "5fa272e",              // when the bound came from a sha
  "toRef": null,
  "eventsInWindow": 41,
  "eventsTotal": 566
}
```

`eventsInWindow` versus `eventsTotal` is the honest part: it lets any consumer
say how much of the log the report is speaking for. A report over one day out
of a three-month log must not read like a report over the project.

Text, Markdown and HTML print the resolved window in the header. No format may
omit it — a period that appears in one rendering and not another is the
split-surface defect this project has already paid for twice.

## 3. The contextual report restitutes it, and synthesises

The header carries the period, not bucket counters:

```
*période : journée du 28/07/2026, depuis `5fa272e` · 54/84 (64%)*
```

**FAIT is a synthesis of that period, and its density scales with the window.**
Over one day, `dernières actions` names what happened: *« 15 PR mergées ·
release 0.86.0 publiée et installée · file 22 → 4 »*. Over three months, listing
every merge is useless — FAIT must compress to themes and turning points, and
say what it compressed. Over the whole project it becomes a short history, not a
changelog.

What is forbidden in every case: replacing the synthesis with a restatement of
the counters (`agrégat de périmètre; pas une action`). The owner asked for what
was accomplished, not for a description of the arithmetic.

À-FAIRE is **not** scoped by the period — open work is open regardless of when
it was opened. Only FAIT is a window.

Reference artefacts, both at baseline `5fa272e`:

- `docs/specs/examples/track-report-raw.txt` — the deterministic input
- `docs/specs/examples/track-report-contextual.md` — the validated output

## 4. Focus follows the same rule

`track focus` is **not** to be fully automatic. It is circumstantiated the same
way the report is: today it renders FAIT without any synthesis, which is the
same defect in another surface.

Focus takes the same period selectors, and offers both readings of it:

- **brut** — the deterministic projection over the window, no interpretation
- **synthèse** — the same window, with FAIT synthesised

Both are reachable for any period, and the rendering states which one is on
screen. A synthesis that cannot be traced back to its raw counterpart is not
acceptable; the two must be produced from the same window and be switchable
without re-running a different query.

## Acceptance

1. `track report --since <sha>`, `--since <date>`, `--since … --until …` and
   `--period today|week|month|all` all resolve, and `--since` with `--period`
   is rejected.
2. The JSON payload carries `period` with `requested`, resolved `from`/`to`,
   the originating refs when applicable, and `eventsInWindow`/`eventsTotal`.
3. Text, Markdown and HTML all print the resolved window in the header. A test
   asserts the four formats agree.
4. With no period flag, the report covers the whole log and says so.
5. The contextual header carries the period and no bucket counters.
6. FAIT synthesises the window; over a long window it compresses and declares
   the compression. A report whose FAIT restates the counters fails.
7. À-FAIRE is unaffected by the window.
8. `track focus` accepts the same selectors and exposes both a **brut** and a
   **synthèse** reading of the same window, labelled on screen.
9. The two committed examples remain reproducible from a fresh clone at
   `5fa272e`.
