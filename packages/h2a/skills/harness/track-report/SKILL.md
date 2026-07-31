---
name: track-report
description: Use when the owner asks for a human contextual track report, status, or advancement (for example, “fais-moi un track report”); bootstrap this checkout's fresh `track` binary and apply the validated four-section format.
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

The header carries the **period**, the **acceptance baseline** and the two coverage counts. It carries no
bucket counters.

**There is always a window, and it always has bounds.** "The whole log" *is* a window: first recorded
event → now. Both bounds are in the log and need no selector, so the header always reads
`période : 2026-06-09 → 2026-07-29 (intégralité du journal)`. The phrase `aucune fenêtre` is wrong — it
described the absence of a flag, not the absence of a period. What is still forbidden is announcing a
window nothing supports: `--since`/`--until`/`--period` do not exist, so a window you did not measure in
the log is invented. `--now <iso>` pins the upper bound when you need a reproducible render.

The acceptance baseline is **not** a window. Keep the two apart in the sentence, as the renderer does.

**FAIT** — `scope · avancement · dernières actions`. The third column names what was accomplished, not the
arithmetic: `agrégat de périmètre; pas une action` and `WP clos (état enregistré)` are both forbidden.

**Write each cell by the finality.** Not the mechanism, not the chronology: the capability reached, what
it enables, what class of problem it closes. A reader who does not know the code must understand what was
gained. Numbers, versions, dates and identifiers come in support — once or twice, to prove — never as the
structure of the sentence.

What that means concretely, on WP2:

> ❌ *« reach-guard partagé sur les chemins réveil/relance et workspace-id git-dérivé (09/06),
> `discover --live` classé par confiance (14/06), signal de confiance de connexion honnête + arrêt
> gracieux et purge de présence fantôme (10/06), `touch()` qui ressuscite une présence balayée (18/06) »*
>
> ✅ *« Adresser un agent ne relève plus du pari.
> La cible est vérifiée avant l'envoi et les sessions mortes cessent de répondre — 337 destinataires
> annoncés, 3 réellement joignables. »*

The first is a commit list translated into French. What disappears: a parenthesised date on every clause,
symbol names in series, chronological enumeration. What stays: one or two measures that make the
capability credible.

**One idea per line.** A cell is written as an editor writes, with a line break between ideas — two to
four lines per WP on a long window. The renderer honours `\n` in every format, so use it. A cell that
overflows is enumerating instead of synthesising, which is the same defect again.

**Over a long window the deterministic layer cannot help you here, and it says so.** When a scope has more
completions than fit, the cell reads `bilan à écrire : N livraisons sur la fenêtre, titres seuls dans le
projeté. / Écrire par la finalité …`. **That is an instruction, not a result.** It deliberately does *not*
list the titles: a chronological list of item titles is exactly the shape forbidden above, and the
renderer will not hand you one to paste. Get the material from input 2 — `git log`, merged PRs, releases,
tags over the window — plus `track query --bucket DONE` for the item set, and name the provenance. If you
do not have input 2, leave the cell saying what is missing.

**The global row is an aggregate: never turn its count into an accomplishment sentence.**

**Stop at the WP on a long window.** A sub-WP is implementation detail; beside its own parent it inflates
the table, repeats the parent's information and blurs the reading by theme. On a window of two weeks or
more the renderer aggregates sub-levels into their parent — their leaves, deliveries and directives merge
upward, nothing is lost — and the header declares how many (`8 sous-WP agrégés dans leur parent`). Do not
re-expand them. They come back on a short window, or on the owner's explicit request
(`track report --sub-wp`).

**À-FAIRE** — exactly five columns: `WP · av. · à faire · bloqué · prochaine action`. There is no
`cible action` column; a DONE item carrying acceptance debt is named inside `à faire` with its bucket.
Print the line `ordre = priorité ; les cinq premiers sont le focus` under the heading.

- `bloqué` names the **answer** that unblocks — `D7`, `D1–D5` — or a short gate token (`spec`,
  `recette`, `dépendance`, `h2a`, `priorité`). It never restates the question.
- **An empty `bloqué` means no blockage is recorded.** A recorded gate rendered `—` is a failure, not a
  clean cell. The machine-only `gateDetail` property carries the precise gate phrase if you need it.
- `prochaine action` names **the concrete next gesture on that item** — the file, the function, the
  question to settle, the command to run. See the section below: this is the criterion that failed UAT.
- A row gated on a pending dossier has **no** next action until the decision lands — that is the only
  case where `—` is correct there.
- WP labels are short human names (`WP2 · Addressing`), never the full stored title.
- One item per line, and an item's recorded body excerpt on its own line beneath it
  (`↳ extrait : …`) — a supporting clause, never a paragraph appended to the title. The excerpt comes
  from the log and costs no investigation; a bare title means the log records only a title, and that is
  a different kind of emptiness from a row nobody has looked at yet. Keep the two distinguishable.

**DÉCISIONS** — a drawn table `# · sujet · alternatives · préco`, numbered `D1…Dn`, each recommendation on
the line of its own option. The renderer already draws it; `formatWpConductor` adds no fence in `text`, and
fences it in `md`.

**DÉCISIONS carries only pending dossiers the owner can answer now. Nothing else.**

- **A `D` number is reserved for a dossier whose options AND recommendation are stored.** A report that
  prints alternatives absent from the log fails, however plausible they are.
- **A settled dossier leaves the report.** It has nothing left to answer, it crowds out the dossiers that
  are still waiting, and it is already visible where it counts: in the freed `bloqué` cell of the row it
  used to gate, or in FAIT if it produced something. It is counted among the omitted rows, with its
  reason. Do not render it as history.
- **A pending dossier with no stored options cannot be answered either**, so it is not offered here.
  `non enregistrées — à structurer` teaches nothing and cannot be replied to. It belongs in À-FAIRE as
  the work of making it answerable: record its options and recommendation
  (`track decision dossier <id>`), then it earns a `D` number.
- Never infer choices by parsing a prose `context` field. There is no machine-readable effect field; do not
  invent one.
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

## `prochaine action` is investigated, not derived

This is the criterion the owner's UAT rejected, and it is the one that matters most.

The gate of a directive gives you `Terminer l'incrément en cours`, `Rédiger la spécification`,
`Relancer la vérification`. Those name the **class** of the work, never the work. Twenty rows, five
distinct sentences, zero information: that is a template, not a recommendation. The renderer no longer
serves them as next actions — it keeps the class on a machine-only `gateStep` property, and the class is
in any case what the `bloqué` column already says.

What the report must carry instead, **for every focus row**: the concrete next gesture on *that* item —
the file to change, the function, the question to settle, the command to run. You get it by **opening the
item**: its body, its acceptance criteria, the commits and the code it references. That is investigation,
not a rewording of the gate. `track report --resolve <handle>` gives you the id to open.

It costs real per-row work, so it is **bounded to the focus rows** — the five the ordering line names.
The renderer marks them `à instruire : ouvrir l'item et nommer le geste`; you must replace every one of
those markers before serving the report. Every other row keeps `non instruite`, which says plainly that
the action has not been instructed — that is honest, and it is what you leave there.

Checkable, and to be run before serving: `auditNextActions(values, gateClauses)` from
`@sentropic/track` returns `{ uninstructed, repeated, gateClauses, ok }`. `uninstructed > 0` means focus
rows still carry the renderer's marker — finish them. `ok === false` means a substantive action repeats
on three or more rows, or equals a gate clause: in both cases it names a class, not a gesture. Not
checkable, and the part that actually failed the UAT: whether the sentence is *right*. The owner judges
that, and no green test substitutes for it.

## Compress, but never hide

The report is a decision surface, not an inventory. Compressing the projection is the work, not a defect —
the validated report renders 15 À-FAIRE rows against a raw projection of 64. Two rules make that safe:

- **State both counts.** The header says `N lignes projetées · M rendues` and how many were omitted.
  Omission is a declared act, never a silent one.
- **Two classes are never omitted**: every WP carrying open work, and every pending dossier. Deleting a
  row is never a way to turn a criterion green. An adversarial review once produced a report that passed
  every shape criterion while deleting 44 of 48 rows and inventing the decisions it kept; these two rules
  exist because of it.

What may be omitted: a WP with no open work, no recorded gate and no recorded completion; and a settled
dossier, which has nothing left to answer. **Every omission names its reason** — the header groups them
(`60 omises : 47 WP sans item ouvert… · 13 décision déjà tranchée…`). An omission without a why is the
silence this rule exists to forbid.

**If you cannot make a row intelligible, do not serve it as it is.** `non enregistrées · aucune option
attestée` describes the state of a datum, not a situation to act on. Either instruct the row — say what
would make it answerable, what it would take to act — or count it among the omissions and say why. Those
are the only two outcomes. Serving the obscure verbatim is the third, and it is the one the UAT rejected.

## Handles, and what they are worth

Each actionable row carries a positional handle `[n.m]` — row `n`, item `m` — and the report ends with a
**resolution block** mapping every emitted handle to its item id, plus the one command that acts on it:

```bash
node "$track_bin" report --resolve <handle>
```

The handle token `[n.m]` is emitted **verbatim in text, Markdown and HTML** — it is machine-generated, so
it is exempt from the Markdown escaping applied to user-originated titles, and the three formats yield the
same handle set. Copy a handle straight from any rendering into `--resolve`; never unescape it first.

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
