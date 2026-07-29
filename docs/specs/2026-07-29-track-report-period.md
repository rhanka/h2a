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
## Acceptance criteria — derived from the validated golden

These are not derived from this spec. They are derived from
`docs/specs/examples/track-report-contextual.md`, the artefact the owner
approved, by diffing it against what `main` produces today. Every criterion
names the observed regression it closes.

A cold agent — no context, fresh clone, the skill only — must produce a report
that satisfies all of them. Green unit tests and green CI do not substitute:
they never exercise an agent reading the skill.

1. **Header carries the period, not bucket counters.** The golden reads
   `*période : journée du 28/07/2026, depuis 5fa272e · 54/84 (64%)*`. Today it
   reads `DONE 57 · TO-DO 29 · AWAITED 5 · DROPPED 2`. The owner has stated the
   counters are of no interest. Percentage stays; the four counters go.

2. **Exactly four sections: FAIT, À-FAIRE, DÉCISIONS, RECOMMANDATION.** Today
   there are nine. `À-FAIRE SANS WP`, `HORS ROLLUP`, `À INSTRUIRE` and
   `HISTORIQUE NON STRUCTURÉ` are not top-level sections of a report the owner
   reads; anything they carry that matters belongs inside the four, and
   anything that does not matter is not printed.

3. **FAIT's third column is `dernières actions`, not `constat`.** The golden
   says `15 PR mergées · release 0.86.0 publiée et installée · file 22 → 4`.
   Today it says `agrégat de périmètre; pas une action` — a description of the
   arithmetic in place of the accomplishment.

4. **FAIT is a synthesis of the period, scaling with the window.** One day names
   facts; three months compresses to themes and declares the compression. A FAIT
   that restates counters fails, at any window length.

5. **À-FAIRE has exactly five columns: `WP · av. · à faire · bloqué · prochaine
   action`.** Today it has six; the added `cible action` injects
   `01KXHGD1ET2BKJ74C1TP6FQ65R · … [DONE]` into the owner's field of view.

6. **À-FAIRE is ordered by priority and says so**, with the line
   `ordre = priorité ; les cinq premiers sont le focus`. Today the order is the
   conductor's canonical urgency, unexplained.

7. **`bloqué` names D-numbers** (`D7`, `D1–D5`), not prose. Today it reads
   `En attente d'une décision : « 3/6 — Quand plusieurs sessions … ? »`, which
   restates the question instead of pointing at the answer that unblocks it.

8. **`prochaine action` names the executor including the model** — `sol xhigh`,
   `terra xhigh` — when owner/session context supplies it. Today the model is
   absent and the field says only `action (subagent): …`.

9. **DÉCISIONS is a drawn table `# · sujet · alternatives · préco`**, numbered
   `D1…Dn`, each recommendation on the line of the option it designates. Today
   it is a Markdown table keyed by dossier ULID.

10. **No ULID appears anywhere in the report.** Not in À-FAIRE, not as decision
    identity, not in a HORS ROLLUP row. The owner said plainly: the decision
    identifier is not what interests them. This is the single most visible
    regression and it is checkable by one regex over the whole output.

11. **Decision subjects are short questions** — `Un nom seul peut-il commander ?`
    — not the stored title pasted verbatim (`1/6 — Un nom de session peut-il
    envoyer une commande ?`).

12. **WP labels are short human names** — `WP2 · Addressing`, `WP5 · Runtime` —
    not the full stored title. Today a single cell carries
    `WP12 · MCP connector brokering & sharing — h2a as connector hub: register
    MCP connectors (gmail, …), share-or-keep-private per identity/workspace,
    broadcast to connected agents/CLIs (claude.ai-style)`.

13. **RECOMMANDATION states what starts with no answer at all**, then what each
    answer unblocks, then a single reply line: `vas y`, or
    `D1 A · D2 B · D3 A · D4 B · D5 A · D6 A · D7 A`. Today the deterministic
    renderer prints no RECOMMANDATION at all — criterion 5 of the previous round
    actively removed a section the owner had validated.

14. **Every WP row that carries open work carries a `prochaine action`.** A WP
    at 0% with `Aucune directive directe` and an empty next action is a row that
    tells the owner nothing.

15. **The report is reproducible**: the same clone, log and period produce the
    same four sections in the same order, and the two committed examples remain
    reproducible from a fresh clone at `5fa272e`.

### How the gap was measured

`main` at the time of writing produces nine sections, six À-FAIRE columns,
ULIDs in three places, `constat` in place of `dernières actions`, and no
RECOMMANDATION. The previous round's ten criteria were all green against those
outputs, because they were written from the same session that wrote the code.
That is the failure this list exists to prevent: a criterion set must be
derived from the approved artefact, not from the implementation.

---

## Correction after the double consensus — 2026-07-29

An adversarial review leg returned NO-GO on the criteria above. Three of its
findings were re-measured independently and hold. They are recorded here before
any implementation resumes, because two of them invalidate claims this document
makes about its own reference artefacts.

### The raw fixture does not produce the contextual one

Measured on the committed pair:

| | `track-report-contextual.md` | `track-report-raw.txt` |
|---|---|---|
| total | `54/84 (64%)` | `57/89 (64%)` |
| WP1 Protocol | `1/2 (50%)` | `1/1 (100%)` |
| a `DÉCISIONS` section | D1–D7 with alternatives | **0 occurrences** |
| `0.86.0`, `15 PR`, `37 → 52`, `18/07` | cited in FAIT | **0 occurrences** |

So criterion 15 — "the two committed examples remain reproducible from a fresh
clone at `5fa272e`" — is false against its own reference. The reproduction
recipe in `track-report-raw.txt` does not reproduce the contextual report, and
never could: the validated report is a synthesis over **three** inputs, only one
of which was written down.

**The contextual report's inputs are, and must be enumerated as:**

1. the deterministic projection (`track report --wp --decisions`) — structure,
   percentages, blockers, dossiers;
2. **the repository history over the window** — `git log`, merged PRs, releases,
   tags. This is where `15 PR mergées`, `release 0.86.0`, `#53`, `37 → 52` come
   from. No amount of reading `.track` yields them;
3. owner/session context — the executor model (`sol xhigh`, `terra xhigh`), and
   which objectives the owner considers the focus.

A criterion demanding byte-reproduction of the contextual report from the raw
alone is unsatisfiable. What *is* verifiable, and what replaces criterion 15:

- **15a** — the deterministic raw is reproducible from a fresh clone at a named
  commit, byte for byte.
- **15b** — every factual claim in FAIT is traceable to input 1 or input 2, and
  the report names which. A claim traceable to neither is a fabrication.
- **15c** — the contextual report declares its three inputs and the window they
  were read over.

### The golden's DÉCISIONS table was not derivable at its own baseline

At `5fa272e` the log carried **zero** structured dossiers: the eight pending
ones had no stored options and no stored recommendation, and the shipped skill
says in terms that such a dossier must be listed as *à structurer*, never
"presented as an owner choice with invented alternatives". The golden
nonetheless renders D1–D6 with three alternatives each, and D7 (`CLI native :
quelle étude fait foi ? A 18/07 · B 17/07`) has no source row anywhere.

This is not a defect of the *shape* the owner validated — that shape is right,
and is what this spec targets. It is a defect of the **pairing**: a report
produced from a live session was filed against a log that could not produce it.

Since `#76` the same table is derivable without inventing anything: the log now
carries **10 structured dossiers** (options and recommendation stored), 6 pending
and 4 settled with a selected option. The correct fix is therefore to regenerate
the raw fixture at a baseline where the dossiers are structured, and to keep the
validated report as the shape reference it is.

**16** — a D-number is reserved for a dossier whose options **and**
recommendation are stored. An unstructured dossier appears as *à structurer*,
carries no letters, and is not offered in the reply line. A report that prints
alternatives absent from the log fails, regardless of how plausible they are.

### Banning every identifier removes the ability to act

Criterion 10 forbids ULIDs everywhere. In the raw, the per-row `ULID · title ·
[STATE]` field is the only handle a row carries; the golden has none. So an
owner reading `WP8 · Tracking — Restructuration WP tranchée, non appliquée` and
wanting to dispatch it has nothing to dispatch: no ULID, no stable title, and
`WP8` in the raw is `2/2 (100%)` with no open item, so the title does not
resolve either.

"The identifier does not interest the owner" is not "the report must contain no
identifier". Criterion 10 is therefore split:

- **10a** — no ULID appears in any column the owner reads. Checkable by
  `[0-9A-HJKMNP-TV-Z]{26}` over the rendered body, in all four formats.
- **10b** — every actionable row carries a short stable handle (`[8.1]`), and
  the report documents the one command that resolves a handle to its item. A
  report you cannot act on is a newsletter.

### The set constrains shape, never content

The review constructed a report that satisfies all fifteen criteria while
deleting 44 of 48 rows — including the owner's three declared priorities — and
inventing the decisions it keeps. Nothing fired. The set has no completeness
rule and no traceability rule, so an implementer may delete anything and invent
anything.

- **17** — no row present in the deterministic projection may vanish without
  appearing, by title, inside one of the four sections. The report states the
  raw row count and the rendered row count.
- **18** — every WP carrying open work appears, and every pending dossier
  appears. Deleting a row is never a way to turn a criterion green.
- **19** — `bloqué` empty means *no blockage is recorded*. A recorded gate that
  renders as `—` is a failure, not a clean cell.

### Criteria contradicted by their own reference

- **14** as written is universal ("every WP row that carries open work carries a
  `prochaine action`") but the golden violates it: `WP3 · Coordination | 83% |
  Réveil par hôte dans chaque plugin | D1–D5 | —`. Either the rule is universal
  and the golden is corrected, or the rule is scoped and says so. It is scoped:
  a row blocked on a decision has no next action until the decision lands, and
  its `bloqué` cell carries the D-number that unblocks it.
- **1** demands a period in the header while `--since`/`--until`/`--period` do
  not exist yet. Until they ship, the header carries the acceptance baseline and
  states that the report covers the whole log. **A named window
  (`journée du 28/07`) is forbidden until the selectors exist** — otherwise
  criterion 1 mandates a claim nothing can support.
- **2** says `main` produces nine sections; the committed raw has seven, and
  `ACTIONS DÉRIVÉES` — 15 rows, including 5 acceptance re-verification prompts —
  is named neither among the four kept nor the four removed. Its rows land in
  À-FAIRE as open work, which is what they are.

### What this means for the skill

`packages/h2a/skills/harness/track-report/SKILL.md` currently mandates the
opposite of several criteria above: `constat` rather than `dernières actions`,
canonical-urgency order rather than priority, the global row never turned into
an accomplishment, and a fixed executor string with no model. The skill is
rewritten in the same increment as the renderer. Where they conflict, this
document wins — and the anti-fabrication clauses of the skill (no invented
alternatives, no unsourced period, no hidden row) are **kept**, because criteria
16, 17 and 15b restate them rather than repeal them.
