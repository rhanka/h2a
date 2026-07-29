---
name: track-report
description: Use when asked for a track report, status, or advancement report. Read the deterministic conductor first; any contextual synthesis is advisory conversation work.
---

# harness/track-report

`track` supplies complete, deterministic facts and already renders the four sections the owner
validated. The agent already in the conversation supplies the contextual synthesis on top of them. Do not
call a model, adapter, gateway, or network-backed report path. Every command below is a local, read-only
projection of the folded log.

The shape is not yours to choose. It is fixed by `docs/specs/examples/track-report-contextual.md` (the
artefact the owner approved) and by `docs/specs/2026-07-29-track-report-period.md` and its two
corrections. Where this file and that spec disagree, the spec wins.

## Bootstrap a fresh clone

`track` is built from this repository; a fresh clone has neither `packages/track/dist` nor a local
`track` executable. From the repository root, bootstrap it once before the read commands:

```bash
npm ci
npm run build -w @sentropic/track
track_bin="$(pwd -P)/packages/track/dist/cli/bin.js"
test -f "$track_bin"
node "$track_bin" --version
```

`track_bin` is an absolute path to this checkout's built executable. Record and reuse that value in every
later tool call: `node "$track_bin" …` cannot fall through to a globally installed `track`, even when a
tool persists only its cwd and not its shell functions. The bootstrap and every command below are read-only
with respect to `.track/`.

## Read the deterministic layer

Run these commands from the repository root, in this order:

```bash
node "$track_bin" report --raw --format json
node "$track_bin" report --wp --decisions --format json
node "$track_bin" decision ls --outcome pending --format json
```

- The first command is the factual snapshot: all buckets, their raw total, decision `structure`,
  `outsideRollup`, and a reconciled `wpTotals`. Its top-level `directives` has
  `directivesProjection.kind: "rule-derived-facts"` and
  `order: "aggregate-id-then-id"`: these are compact rule-derived facts, not the conductor actions.
  `recentEventsProjection` says that `recentEvents` is the last **up to 200** append-ordered,
  payload-free `position/eventId/kind/aggregateId` entries; it is history evidence, not a task queue.
- The second is the complete conductor projection. Its `wpTree` and `view` are the only source for WP
  identity, per-WP percentages, and action directives. `view.tables` is already the four sections in
  order. `view.directivesProjection` is `conductor-action-directives` in `canonical-urgency` order.
  `view.dispatchQueueProjection` identifies `dispatchQueue` as the canonical-order ids from that same
  array whose modes are `subagent` or `local`; resolve an id only against `view.directives`, never against
  raw-snapshot `directives`.
- The third lists every pending decision without a renderer cap. Each row carries its exact `workspace`,
  `options`, `recommendation`, and `structure` (`structured` or `unstructured`).

The three commands are the live-report route. To verify the named historical fixture only, materialize its
fixed log and run these **same three commands** with `--track-dir <fixture-dir>` and `--commit <fixture-sha>`
on every command. That fixture override is not a live-report default and must not replace the commands
above.

`--track-dir <directory-containing-events.jsonl>` is a documented global override: it may appear before or
after the command, and `TRACK_DIR` is its environment equivalent. Confirm its spelling with
`node "$track_bin" --help` or `node "$track_bin" report --help`. It redirects the whole **store**, reads and
writes alike — a write verb run under `--track-dir` appends to that directory. Point it at a copy, never at
a log you are not the designated writer for. The report commands above are read-only by themselves; the
override does not make an arbitrary command read-only.

Do not use `track report --flat` to recover omitted conductor rows: it is a deterministic flat diagnostic,
not an emergency route. Do not use `track report --level wp` to label WPs for this report; it is a
different status projection.

Check that `DONE + TO-DO + AWAITED + DROPPED` equals
`wpTotals.done + (wpTotals.active - wpTotals.done) + wpTotals.dropped`; if it does not, report the mismatch
as a tool defect rather than silently selecting a denominator.

`view.directives` is already in canonical urgency order. Preserve that array order whenever directives are
listed; never re-sort or group it by `rank`. `rank` is a coarse display badge, so repeated/interleaved
badges are intentional. The fixed ladder is: decision/engagement wait, dependency, failed acceptance,
in-progress work, stale acceptance, missing specification, WSJF-ranked to-do, then fallback. WSJF breaks
ties only within its tier; it does not explain a change between these tiers.

## The three inputs, declared

The contextual report is a synthesis over **three** inputs, and it names which one each claim comes from:

1. **the deterministic projection** — the three commands above. Structure, percentages, blockers,
   dossiers, handles.
2. **the repository history over the window** — `git log`, merged PRs, releases, tags. This is where
   `15 PR mergées`, `release 0.86.0`, `#53`, `37 → 52` come from. No amount of reading `.track` yields
   them. If you did not run the git commands, you do not have this input, and you write nothing that
   would need it.
3. **owner/session context** — the executor model (`sol xhigh`, `terra xhigh`), and which objectives the
   owner considers the focus.

Every **structured** claim in FAIT — a count, a version, a PR number, a percentage — carries its
provenance and must be recomputable from input 1 or input 2. A claim traceable to neither is a
fabrication. Free prose is not machine-checkable and this rule does not pretend it is.

## Authoritative section order

Render exactly four sections, in this order, and nothing else: **FAIT**, **À-FAIRE**, **DÉCISIONS**,
**RECOMMANDATION**. `view.tables` is already exactly that. There is no `À-FAIRE SANS WP`, no
`HORS ROLLUP`, no `À INSTRUIRE`, no `HISTORIQUE NON STRUCTURÉ`, no `ACTIONS DÉRIVÉES`: what those tables
carried is folded into the four, and what they carried that does not matter is not printed.

The header carries the **acceptance baseline** and states that the report covers the whole log. It carries
no bucket counters. **Do not name a window** — `--since`/`--until`/`--period` do not exist yet, so
`journée du 28/07` is a claim nothing can support. The header also carries the two coverage counts; keep
them.

**FAIT** — `scope · avancement · dernières actions`. The third column names what was accomplished, not the
arithmetic: `agrégat de périmètre; pas une action` and `WP clos (état enregistré)` are both forbidden.
The renderer fills it with the last recorded completions of that scope, most recent first, and declares
its own compression (`3 des 8 actions enregistrées`). Enrich it from input 2 when you have input 2, and
say so. **The global row is an aggregate: never turn its count into an accomplishment sentence.** Over a
long window, compress FAIT to themes and turning points and declare the compression — over the whole
project it is a short history, not a changelog.

**À-FAIRE** — exactly five columns: `WP · av. · à faire · bloqué · prochaine action`. There is no
`cible action` column; a DONE item carrying acceptance debt is named inside `à faire` with its bucket.
Print the line `ordre = priorité ; les cinq premiers sont le focus` under the heading.

- `bloqué` names the **answer** that unblocks — `D7`, `D1–D5` — or a short gate token (`spec`,
  `recette`, `dépendance`, `h2a`, `priorité`). It never restates the question.
- **An empty `bloqué` means no blockage is recorded.** A recorded gate rendered `—` is a failure, not a
  clean cell. The machine-only `gateDetail` property carries the precise gate phrase if you need it.
- `prochaine action` names the routing executor. A row gated on a decision has **no** next action until
  the decision lands — that is the only case where `—` is correct there.
- WP labels are short human names (`WP2 · Addressing`), never the full stored title.

**DÉCISIONS** — a drawn table `# · sujet · alternatives · préco`, numbered `D1…Dn`, each recommendation on
the line of its own option. The renderer already draws it; `formatWpConductor` adds no fence in `text`, and
fences it in `md`.

- **A `D` number is reserved for a dossier whose options AND recommendation are stored.** An unstructured
  dossier keeps its row, carries a `Q` handle instead, reads `à structurer`, carries **no letters**, and is
  **not** offered in the reply line. A report that prints alternatives absent from the log fails, however
  plausible they are.
- Never infer choices by parsing a prose `context` field. There is no machine-readable effect field; do not
  invent one.
- A settled dossier is rendered as history (`réglé (go)`), keeps its selected option when one is attested,
  and receives no reply number.
- For a single structured dossier, use the exact workspace from `decision ls`:
  `node "$track_bin" focus <decision-id> --workspace <workspace-from-decision-ls>`. `--workspace` is
  required; a mismatched workspace is an error. Never substitute `track workspace-id` or a workspace
  inferred from the current directory.

**RECOMMANDATION** — what starts with no answer at all, then what each answer unblocks, then a single
reply line. The owner must be able to answer `vas y` or `D1 A · D2 B · D3 A`. If `decision ls` has zero
`structure: "structured"` pending rows, this section says exactly:
`Aucun D# disponible : aucun dossier structuré sélectionnable dans le journal.` Do not invite `D1 A` in
that case; name only recorded non-decision directives that can start now, and name each unstructured
dossier as the prerequisite to a selectable decision. If no non-decision directive exists, say that no
executable lane is attested.

## Compress, but never hide

The report is a decision surface, not an inventory. Compressing the projection is the work, not a defect —
the validated report renders 15 À-FAIRE rows against a raw projection of 64. Two rules make that safe:

- **State both counts.** The header says `N lignes projetées · M rendues` and how many were omitted.
  Omission is a declared act, never a silent one.
- **Two classes are never omitted**: every WP carrying open work, and every pending dossier. Deleting a
  row is never a way to turn a criterion green. An adversarial review once produced a report that passed
  every shape criterion while deleting 44 of 48 rows and inventing the decisions it kept; these two rules
  exist because of it.

What may be omitted: a WP with no open work, no recorded gate and no recorded completion. Nothing else.

## Handles, and what they are worth

Each actionable row carries a positional handle `[n.m]` — row `n`, item `m` — and the report ends with a
**resolution block** mapping every emitted handle to its item id, plus the one command that acts on it:

```bash
node "$track_bin" report --resolve <handle>
```

Handles are **per-report and positional**. Two reports over the same log may number differently; the
resolution block is what makes a reply unambiguous. A reply quoting `[3.2]` without the report it came
from is not actionable, and the report says so. The resolution block is the machine's half of the page,
not a table the owner reads — it is also the only place an item id appears.

**No ULID appears in any column the owner reads.** Not in À-FAIRE, not as decision identity, not in FAIT.
This is checkable by `[0-9A-HJKMNP-TV-Z]{26}` over the rendered table bodies, in every format.

## The executor, and what the log does not record

The log does **not** record a model or reasoning effort. Owner/session context means only (1) an explicit
owner statement in this report request/current conversation, or (2) an explicitly cited owner-authored
session artifact that maps this exact item, WP, or directive to an executor (and, if claimed, model/effort).
It excludes project memory, repository documents, installed configuration, defaults, prior conventions, and
inference. Context may enrich executor prose only; it never overrides emitted order, gates, or facts. When
the report needs model/effort but that narrow context is absent, write exactly:
`exécuteur: contexte owner requis (modèle/effort non présents dans le journal)`.

Do not call an absent `facts.wsjf` subjective "priority". A `priority-missing` directive means the log has
no assessment; only an owner-authorized write such as
`node "$track_bin" priority assess <item-id> --ubv <n> --tc <n> --rr <n> --js <n>` can add one.

## The compact route is not this report

`--inline` **and `--width <40..240>`** both select the same compact terminal summary — passing a width turns
inline on, whether or not you wrote `--inline`. That route is not the complete report: at every width it
drops **DÉCISIONS**, **RECOMMANDATION** and the handle resolution block, collapses a tail into “+N autres”,
and prints its own deterministic `PRÉCO` block. Never use either flag to satisfy the sections above, and do
not quote a `PRÉCO` line as the report's recommendation. The three read commands at the top of this file
carry no width and must not be given one.

`--decisions` changes the emitted JSON payload; it does not gate the DÉCISIONS section in text, Markdown, or
HTML, which render dossiers whenever the log holds any. Passing it is still correct — just do not conclude
from a missing section that the flag failed.

## Honesty rules

These describe the three read commands above. They are guarantees of that route only; `--inline`/`--width`
truncates by design and `--flat` is a different projection.

- Every WP carrying open work and every pending decision appears. Compression is declared with both
  counts; a hidden tail summarized as “+N autres” is not compression, it is hiding.
- A rule-derived prompt is not a decision. It belongs in À-FAIRE, never in DÉCISIONS, and never gets a
  D-number.
- Prefer named items and concrete acceptance debt over generic counts.
- The deterministic layer proves structure and order; contextual wording remains the agent's responsibility.
  State uncertainty instead of promoting a missing stored fact to a conclusion.

This skill is **advisory**. No command, hook, MCP tool, or validator executes it or proves that a synthesis
followed it. The unit tests bind the *renderer*, not an agent reading this file. Do not describe this
guidance as an enforcement mechanism.

Spec: `docs/specs/2026-07-29-track-report-period.md`.
Shape reference: `docs/specs/examples/track-report-contextual.md`.
Deterministic input: `docs/specs/examples/track-report-raw.txt`.
