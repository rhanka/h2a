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

   *Amended by D3 of the 2026-10-18 amendment (criteria 28+ below): À-FAIRE has
   exactly seven columns
   `WP · av. · stage · status · à faire · bloqué · prochaine action`.*

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

---

## Reconciliation — 2026-07-29, after both review legs

Two independent legs returned NO-GO from different angles. They converge on one
conflict this document created, and it is settled here.

### Compactness wins over completeness

Criterion 17 was added to stop an implementer turning criteria green by deletion.
As written it demands that no projected row vanish. But the validated golden
renders **15 À-FAIRE rows against the raw's 64** — so the artefact the owner
approved fails the criterion written to protect it.

The golden is right. A report the owner reads is a decision surface, not an
inventory; compressing 64 rows to the 15 that matter is the work, not a defect.
Criterion 17 is therefore replaced:

- **17** — the report states both counts (`64 lignes projetées, 15 rendues`).
  Omission is a declared act, never a silent one. What is omitted is omitted
  because it carries no open work and no recorded gate — never because it was
  inconvenient.
- **18** stands unchanged and is what makes 17 safe: every WP carrying open work
  appears, and every pending dossier appears. Those two classes are never
  omitted, whatever the compression ratio.

Between them: an implementer may compress, and may not hide. The deletion attack
fails on 18; the golden passes on 17.

### The handle cannot avoid the identifier — only move it

Criterion 10b asked for a short stable handle. Leg A established it is not
derivable: ordering, titles and WP membership all change between runs, and the
only stable per-item identity is the ULID the owner does not want to read.

So the identifier is not removed, it is **relocated**:

- **10a** — no ULID in any column the owner reads. Checkable by
  `[0-9A-HJKMNP-TV-Z]{26}` over the rendered table bodies, in every format.
- **10b** — each actionable row carries `[n.m]`, positional within the report.
  The report ends with a compact resolution block mapping every emitted handle
  to its item id, and names the one command that acts on it. The block is not a
  table the owner reads; it is the machine's half of the page.
- **10c** — handles are per-report and positional. Two reports over the same log
  may number differently. The resolution block is what makes a reply
  unambiguous, so a reply that cites handles without its report is not
  actionable, and the report says so.

### Reproducibility, stated honestly

Acceptance item 9 of section 1–4 ("the two committed examples remain
reproducible from a fresh clone at `5fa272e`") is **withdrawn**. It was measured
false and 15a/15b/15c replace it. The raw is reproducible; the contextual report
is a synthesis over three inputs and is not.

15b is narrowed to what a test can reach: every **structured** claim in FAIT — a
count, a version, a PR number, a percentage — carries its provenance and is
recomputable from input 1 or input 2. Free prose is not machine-checkable and
the spec stops claiming it is.

### Delivery boundary

This increment ships: the four-section renderer, the five À-FAIRE columns, the
DÉCISIONS drawn table with D-numbers, RECOMMANDATION, 10a/10b/10c, 16, 17, 18,
19, and the rewritten skill. Text, Markdown, HTML and JSON all agree on section
set and order.

This increment does **not** ship: `--since`/`--until`/`--period` (sections 1–4),
the period block in the payload, and the focus `brut`/`synthèse` split. Until
the selectors exist the header carries the acceptance baseline and states that
the report covers the whole log — **a named window such as
`journée du 28/07` is forbidden**, because nothing can yet support it.

The fixture pair is regenerated at a baseline where the dossiers are structured,
so the DÉCISIONS table is derivable without inventing an alternative. The
validated report stays in the repository as the shape reference it is, with a
note saying it predates that baseline.

---

## UAT — 2026-07-29, owner. Verdict : NO-GO

Quatre constats sur le rendu froid à `a8fe747`. Ils portent tous sur la même
faute de fond : **le rapport décrit la forme du travail au lieu de dire le
travail**. Il annonce des catégories (« terminer l'incrément », « rédiger la
spécification ») là où l'owner attend une phrase qui lui apprend quelque chose.

### 20 — BLOQUANT. `prochaine action` doit être investiguée, pas dérivée

Rendu observé : `action (subagent): Terminer l'incrément en cours` répété huit
fois, `Rédiger la spécification` sept fois, `Relancer la vérification` quatre
fois. Vingt lignes, cinq phrases distinctes, zéro information.

Ces chaînes viennent du gate de la directive : elles nomment la **classe** de
l'action, jamais son contenu. C'est un template, pas une recommandation.

Exigence : pour toute ligne du focus, `prochaine action` nomme le prochain geste
concret sur *cet* item — le fichier, la fonction, la question à trancher, la
commande à lancer. L'agent l'obtient en **ouvrant l'item** : son corps, sa
recette, les commits et le code qu'il référence. Ce n'est pas une reformulation
du gate, c'est une investigation.

Le coût est réel : cela demande de lire, par ligne, ce que le journal désigne.
Il est donc borné aux lignes du focus, et le rapport dit explicitement pour les
autres que l'action reste à instruire — plutôt que de servir un template en
prétendant que c'en est une.

Ce qu'un test peut vérifier : qu'aucune valeur de `prochaine action` n'apparaît
plus de deux fois dans le rapport, et qu'aucune n'est égale à une chaîne de
gate connue. Ce qu'aucun test n'atteint : si la phrase est *juste*. C'est
l'owner qui juge, et ce critère est celui qui a échoué à l'UAT.

### 21 — MAJEUR. Il y a toujours une fenêtre, et elle a des bornes

Rendu observé : `couvre l'intégralité du journal (aucune fenêtre de période)`.

C'est faux. « L'intégralité du journal » **est** une fenêtre : elle va du premier
événement enregistré à maintenant. Ces deux bornes sont dans le log, lisibles
sans aucun sélecteur.

Exigence : l'en-tête porte toujours des dates. Sans sélecteur, il lit
`période : <date du premier événement> → <maintenant> (intégralité du journal)`.
La formule « aucune fenêtre » disparaît : elle décrivait l'absence d'un drapeau,
pas l'absence d'une période.

Cela lève aussi la contrainte du critère 1, qui interdisait une fenêtre nommée
tant que `--since` n'existe pas : une fenêtre **mesurée dans le journal** n'est
pas une fenêtre inventée. Ce qui reste interdit, c'est d'annoncer une fenêtre
que rien ne soutient.

### 22 — MAJEUR. Sur une longue période, FAIT est un bilan, pas les dernières actions

Rendu observé : `Eradiquer le CLI remote legacy · Terra xhigh par défaut ·
Délégation de subagents — 3 des 54 actions enregistrées`. Sur cinq semaines de
travail, le rapport sert trois titres pris au hasard de l'ordre du log et
annonce qu'il en cache 51.

Trois actions sur cinquante-quatre ne sont pas un résumé, c'est un échantillon.

Exigence : sur une fenêtre longue, FAIT énonce **ce qui a été accompli** —
thèmes, bascules, capacités livrées — pas les derniers titres enregistrés. La
densité suit la fenêtre : un jour nomme les faits, cinq semaines racontent une
histoire courte.

Le projeté déterministe ne suffit probablement pas pour cela, et c'est un
constat, pas une excuse : il porte des titres d'items, pas une lecture. Les
entrées nécessaires sont celles déjà énumérées en 15a/15b/15c — la projection,
l'historique git sur la fenêtre, le contexte owner. Si le rapport ne peut pas
produire un bilan, il doit dire ce qui lui manque, pas servir un échantillon
en le présentant comme une synthèse.

### 23 — Les décisions déjà prises n'ont rien à faire dans DÉCISIONS

Rendu observé : `Q1 … A retenu · réglé (go)`, idem Q2, Q3, Q4.

DÉCISIONS est la surface où l'owner tranche. Une décision déjà tranchée n'y a
pas sa place : elle occupe l'espace de celles qui attendent et brouille la
lecture. Elle est déjà visible là où elle compte — dans la case `bloqué` d'une
ligne débloquée, ou dans FAIT si elle a produit un livrable.

Exigence : DÉCISIONS ne contient que les dossiers en attente que l'owner peut
répondre maintenant. Rien d'autre.

### 24 — Ne pas servir de l'obscur en l'état

Rendu observé : `Q5 Release 0.86.0 — non enregistrées — à structurer`,
`Q7…Q15 (9 dossiers historiques) — non enregistrées — réglé · aucune option
attestée`.

Ces lignes n'apprennent rien et ne se répondent pas. « Aucune option attestée »
décrit l'état d'une donnée, pas une situation à traiter.

Exigence : ce qui ne peut pas être rendu utile n'est pas rendu. Un dossier sans
options ne va pas dans DÉCISIONS : soit il porte du travail ouvert et il apparaît
comme tel dans À-FAIRE avec ce qu'il faut faire pour le rendre répondable, soit
il ne porte rien et il est compté dans les lignes omises. L'historique réglé
sort du rapport.

La règle générale, qui vaut au-delà de ces lignes : **si l'agent ne peut pas
rendre une ligne intelligible, il ne la sert pas telle quelle.** Il l'instruit,
ou il la compte parmi les omissions en disant pourquoi.

---

## UAT — 2026-07-29, deuxième passe. Verdict : mieux, pas bon

Trois constats sur le rendu froid à `88d460c`. Ils portent tous sur la même
faute : **le rapport énumère des livrables techniques au lieu de dire ce que le
produit sait faire maintenant.** C'est un compte rendu d'atelier, pas un rapport
d'avancement.

### 25 — Sur une fenêtre longue, on ne descend pas sous le WP

Rendu observé : `WP2.1 · WP-A Routing`, `WP2.2 · WP-F False-live`,
`WP4.1 · WP-D Conductor`, `WP5.17 · Parité`, `WP6.1 · WP-B Workspace`,
`WP8.10 · Restructuration` — six sous-niveaux mêlés aux WP racines, dont
plusieurs répètent la même information que leur parent.

Sur un rapport long, le sous-WP est du détail d'implémentation : il gonfle le
tableau et brouille la lecture par thème. Le WP est l'unité de lecture.

Exigence : sur une fenêtre longue, FAIT et À-FAIRE s'arrêtent au WP. Les
sous-niveaux sont agrégés dans leur parent, jamais listés à côté de lui. Ils ne
réapparaissent que sur une fenêtre courte, ou sur demande explicite de l'owner.

### 26 — Le bénéfice porte la rédaction ; la métrique l'illustre

Rendu observé, sur WP2 : *« reach-guard partagé sur les chemins réveil/relance
et workspace-id git-dérivé (09/06), `discover --live` classé par confiance
(14/06), signal de confiance de connexion honnête + arrêt gracieux et purge de
présence fantôme (10/06), `touch()` qui ressuscite une présence balayée
(18/06)… »*

C'est une liste de commits traduite en français. Elle nomme des mécanismes, des
dates et des identifiants ; elle ne dit à aucun moment **ce que le produit sait
faire qu'il ne savait pas faire avant**.

Ce que la même chose devrait dire : *« Adresser un agent ne relève plus du pari.
La cible est vérifiée avant l'envoi et les sessions mortes cessent de répondre —
337 destinataires annoncés, 3 réellement joignables. »*

Exigence : chaque cellule de FAIT est écrite **par la finalité** — la capacité
atteinte, ce qu'elle permet, ce qu'elle ferme comme classe de problème. Les
chiffres, versions, dates et identifiants viennent en appui, une ou deux fois,
pour prouver ; jamais comme structure du propos. Un lecteur qui ne connaît pas
le code doit comprendre ce qui a été gagné.

Ce qui disparaît : les dates entre parenthèses sur chaque clause, les noms de
symboles en série, l'énumération chronologique. Ce qui reste : une ou deux
mesures qui rendent la capacité crédible.

### 27 — Une cellule n'est pas un paragraphe monolithique

Rendu observé : des cellules de huit à douze lignes en un seul bloc, sans
respiration, où le lecteur perd le fil avant la fin.

Exigence : la cellule est rédigée comme l'écrirait un rédacteur — une idée par
ligne, retour à la ligne entre les idées. Le rendu dessiné le permet déjà
(l'à-FAIRE le fait pour ses items) ; FAIT doit en faire autant.

Concrètement : une capacité par ligne, deux à quatre lignes par WP sur une
fenêtre longue. Si une cellule dépasse, c'est qu'elle énumère au lieu de
synthétiser — voir 26.

### Ce que ces trois-là disent ensemble

Le rapport a cessé de mentir (critères 20–24). Il doit maintenant cesser d'être
illisible. Un rapport d'avancement se lit par ce qu'il apporte, pas par ce qu'il
a coûté — et un owner doit pouvoir en tirer une décision sans ouvrir le code.

---

## Amendment — stage and status in the validated report — 2026-10-18

This amendment appends dated criteria 28–41 to the set above. It does not
rewrite criteria 1–27 except criterion 5, amended explicitly by criterion 30
(D3) below. Full rationale: `SPEC_AMENDMENT_TRACK_REPORT_STAGE_STATUS.v2.md`
(owner requests 1–8 of 2026-10-17/18, owner decisions of 2026-10-18, two
independent analyses converging on `origin/main`). GO-CODE from two independent
reviewers. No implementation is part of this section.

28. **One report contract; the DEMANDES view is withdrawn as a rendering.**
    An owner request for a track report, a status table, or progress reporting
    invokes the validated report: exactly four sections
    FAIT · À-FAIRE · DÉCISIONS · RECOMMANDATION, in that order, same set and
    order in text, Markdown and JSON (criterion 2 unchanged). Stage and status
    are added to that report. The 2026-10-17 `--status-table` rendering whose
    tables were `[requests, decisions, recommendation]` (a DEMANDES inventory
    replacing FAIT and À-FAIRE) is withdrawn as a rendering; its
    stage-evidence and flagging rules survive as derivation rules (criteria
    32–34). `--status-table` remains accepted as a selector of the validated
    report (criterion 31); it no longer selects a second projection.

29. **Stage and status are neutral, derived codes.** Computed per tracked item
    from facts already recorded in the journal (realisation, spec status, open
    blockers, acceptance, linked pending dossiers, explicit delivery links,
    reopenings). JSON carries codes, never localised words, as identity.
    Stage ∈ `spec | dev | pr | merged | deployed`. Status ∈ `progressing |
    unforeseen | blocked | decision-awaited | not-qualified`, plus the
    terminal `withdrawn` state (criterion 36); only the first four carry a
    health colour (🟢 🟠 🔴 🔵). No report may require a write to become
    conforming: no mandatory backfill; derivation, not storage, is primary.

30. **À-FAIRE gains exactly two columns: stage and status (amends criterion
    5).** À-FAIRE has exactly seven columns
    `WP · av. · stage · status · à faire · bloqué · prochaine action`.
    FAIT, DÉCISIONS and RECOMMANDATION keep their validated shapes and
    columns; stage and status are not added to FAIT. Stage and status annotate
    identifiable tracked items, never a WP as a whole: a WP whose members sit
    at different stages must not be shown at one invented stage, and
    aggregating members must not hide a 🔴 proposal or a 🔵 dossier
    (criteria 17/18 unchanged). The single À-FAIRE golden is regenerated for
    these two columns, diff reviewed and traced here; every other named
    golden, example and snapshot stays byte-identical.

31. **A status table is the validated report over a rolling period.**
    New additive period values: `--period last-week` = `[now − 7 days, now]`
    and `--period last-day` = `[now − 24 h, now]`, `now` the single captured
    report time (the existing `--now` pin). Bounds resolved and printed with
    time and offset, like every period; the full `period` payload
    (`requested, from, to, refs, eventsInWindow, eventsTotal`) is present in
    every format and every mode. Existing selectors keep their documented
    meaning (`today|week|month|all`, `week` stays the current calendar week;
    `--since/--until` unchanged). A status-table request without an explicit
    selector uses `last-week`; an explicit user period always wins. The
    validated CLI route without `--status-table` and without a selector keeps
    criterion 4 (whole journal, and says so). Period semantics unchanged: the
    full journal is folded first; FAIT synthesises the window; À-FAIRE and
    DÉCISIONS show current open state; an empty window still shows current
    open work and decisions.

32. **Stage requires recorded evidence; reopening requalifies.** `pr`,
    `merged` and `deployed` require an explicit recorded delivery link or
    equally explicit recorded evidence. `done` does not prove a merge; CI does
    not prove a merge; publishing a release does not prove deployment.
    A reopening after a stage was derived or stored voids that stage until the
    item is requalified. No lifecycle state is inferred from localised titles
    or prose. Track records assertions and references; it does not verify a PR
    provider or a deployed environment itself (NOT covered).

33. **Status meaning: four colours, absence is never orange.** One precedence
    table governs; first matching row wins. Open gates and acceptance are
    evaluated against the report's baseline. An unforeseen fact is an
    unresolved recorded reopening/regression or a stale acceptance, never mere
    silence or elapsed time.

    | Priority | Recorded condition | Status code | Health colour |
    |---|---|---|---|
    | 1 | Current realisation `cancelled`/`rejected`, even with a live gate | `withdrawn` | none (criterion 36) |
    | 2 | Open non-decision blocker or acceptance `fail` | `blocked` | 🔴 |
    | 3 | Effective decision gate on a pending, structured, answerable native dossier | `decision-awaited` | 🔵 |
    | 4 | Unforeseen fact as defined above, not superseded by requalification | `unforeseen` | 🟠 |
    | 5 | No open gate and qualifying fact present, with realisation `in-progress` or (`done` and acceptance `pass`) | `progressing` | 🟢 |
    | 6 | Otherwise, including `in-progress`, no gate, acceptance `unknown`, no qualifying fact | `not-qualified` | none |

    A qualifying fact is either current `acceptanceStatus = pass` backed by its
    recorded runs, or a valid `item.report-updated` assertion with
    `status = progressing` and non-empty `facts` (a recorded conformity
    assertion, not independently verified; its event is the evidence locator).
    Either witness must postdate the last reopening/regression and must not be
    superseded by a contrary fact. A bare stored green, a stage,
    `in-progress`, `done`, or absence of a gate is not such a witness.
    An unstructured decision gate remains visible as structuring work, never
    an invented D-number or green. A live gate overrides a stored green. When
    red and a pending dossier coexist, red is the status and its D-number and
    full expectations remain visible in `bloqué` and DÉCISIONS.

34. **Red carries a proposal, or the served report fails its audit.** The
    deterministic layer flags each `blocked` row lacking an investigated
    proposal (`missing-proposal`). The proposal itself is investigated agent
    work of the same nature as criterion 20, carried by `prochaine action`
    and RECOMMANDATION; the deterministic layer never fabricates proposal
    text. `auditStatusProposals`, exported from `report/audit.ts` through the
    report barrel and the root public barrel for `@sentropic/track`, fails a
    served report that has a 🔴 row without a proposal or a 🔵 row with no
    matching DÉCISIONS entry. A generic instruction to "handle red rows" is
    not a proposal. Report generation neither authorises execution nor appends
    an owner answer.

35. **Never-qualified conformity: "not qualified", no colour.** When no
    higher-priority fact in the criterion 33 table applies, an item without a
    qualifying fact renders status code `not-qualified` with no health colour
    (`—` glyph in the cell, the code in JSON). Absence of qualification never
    renders orange. The row and its qualification work stay visible; the state
    is a reported gap, not a fabricated incident and not conforming progress.

36. **Withdrawn or rejected requests: shown without colour, only if
    relevant.** A withdrawn/rejected (`cancelled`/`rejected`) request carries
    no progress colour and is never 🟢. Shown only when relevant to the
    selected period (withdrawn or decided inside the window, or still carrying
    a live gate), with its recorded reason. The withdrawal notice is an
    identifiable item in À-FAIRE under its actual container/WP, with
    `status = withdrawn` and no health glyph; a withdrawal event is never a
    delivery in FAIT. With no live gate the action cell states that no action
    is owed, without implying open work. A later reopening means current
    status is no longer `withdrawn`. If the reason is absent, that absence is
    declared instead of invented. This is the sole declared membership
    exception to the two-column enrichment; adding a notice changes neither
    legacy bucket/tally rules nor the delivery projection.

37. **Any user language; nothing language-specific is hardcoded.** Codes are
    the identity (criterion 29). Human labels for the new surface come from a
    per-language lexicon keyed by an open `--lang <bcp47>` parameter — never
    a closed language enum, never a silent French fallback: an unknown
    language renders the codes themselves, and the contextual agent layer
    renders the served report in any language the user requests. Changing only
    the output language changes no ids, order, period, percentages, handles,
    or selectable options. No extraction, classification or detection may
    pattern-match a natural language, in any language. The served path removes
    `versionOnlySubject` and the French marker/prefix recognition in
    `auditNextActions`; replacing them with other languages is not a fix.
    Translated placeholders remain uninstructed; a gate-class action remains a
    gate-class action after translation. Scope limit: this amendment makes the
    new stage/status surface language-neutral and keeps the any-language path
    at the agent layer; full localisation of the existing French deterministic
    renderer is a separate WP, NOT covered here.

    Declared test migration (see criterion 20 note below): criterion 20's
    mechanical `auditNextActions` call-site test in
    `validated-report-shape.test.ts` migrates its inputs to structured audit
    descriptors, retaining every outcome assertion (uninstructed, repeated,
    gate-class, investigated). This removes the language-dependent API
    assumption, not the validated investigation criterion.

38. **Every request stays attached to its WP; orphans are flagged.** The two
    new columns preserve the existing `wpId`/`wpLabel` presentation fields.
    Strict attachment is derived separately with the existing
    `wpRootId(items, itemId)` helper (highest ancestor whose role is exactly
    `workpackage`), surfaced additively without changing the historical
    fields. `outside-wp` and its header count depend only on the absence of
    this strict root. The existing demand model is reused (`demand`, immutable
    `raw.text`, `item.demandId`, promotion 1→N); no parallel "owner request"
    registry is created. An item with no WP ancestor renders with the visible
    machine flag `outside-wp`, is counted in the header coverage line, is
    never presented as a normal case, and is never silently dropped.
    Generating a report never creates, duplicates or reparents work. A
    write-side guard is explicitly out of this amendment.

39. **Decision expectations are kept in full.** DÉCISIONS keeps its drawn
    table, structured pending dossiers only, settled ones removed and counted,
    unstructured ones routed to À-FAIRE as structuring work. RECOMMANDATION
    keeps all three parts and exactly one reply line. Native dossiers take
    priority for 🔵; no option is inferred from prose; stored
    `decisionExpectations` without an answerable native dossier create no
    `D#` and no selectable choice. A `deferred` dossier is not settled. Each
    line is written by its finality; versions, PRs and releases are supporting
    references in parentheses, never the subject.

40. **One skill, one handle grammar.** The canonical skill is again
    `packages/h2a/skills/harness/track-report/SKILL.md` alone. The 2026-10-17
    precedence paragraph is deleted, and the duplicate
    `packages/track/skills/track-report/` skill is removed from the
    `track install-skills` bundle. Handles remain the validated `[n.m]`
    everywhere; the withdrawn view's `#` numbering survives, if at all, only
    as an alias resolving to the exact same report context.

41. **Preservation contract: goldens and legacy payloads.** Criteria 1–27
    stand, except criterion 5 as amended by criterion 30. The legacy JSON
    contract `{buckets, wpTree, wpTotals}` changes additively only (per-row
    `stage`/`status` codes, strict WP ancestry and audit metadata, full
    `period` block in every mode). Exactly one golden is regenerated, with
    its diff reviewed and traced to criterion 30; every other named golden,
    example and snapshot stays byte-identical.

Note on criterion 20's mechanical audit test: the single call-site test in
`validated-report-shape.test.ts` migrates to structured audit descriptors in
the language-foundations lot, retaining every outcome assertion. Any further
change to a validated test block outside criterion 5 and the skill block is a
deviation and must be justified here before it lands — none is authorised by
this amendment.

Implementation note — 2026-10-18 (lot 5, upholding criterion 34): the
deterministic layer flags each 🔴 row lacking an investigated proposal
(`missing-proposal`) and each 🔵 row with no matching DÉCISIONS entry via
`auditStatusProposals` (`packages/track/src/report/audit.ts`, exported
through the report barrel and the `@sentropic/track` root barrel). The audit
consumes derived status codes, recorded `item.report-updated` proposals,
machine-only `gateStep` phrases and `D#`/`Q#` handle tokens — never prose in
any language. It echoes ids and recorded text only and never fabricates
proposal text; a green mechanical audit never certifies prose quality. The
audit changes no served byte: report generation neither authorises execution
nor appends an owner answer.
