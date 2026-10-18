# Track report with stage and status — served example

This is the enriched example of the stage/status amendment
(`docs/specs/2026-07-29-track-report-period.md`, criteria 28–41). It shows the
served route — `track report --status-table` — over a synthetic journal, with
the seven-column À-FAIRE, neutral stage/status codes, withdrawal notices and
demand lineage. It is separate from the older artefacts: `track-report-contextual.md`
stays the form reference for the four sections, and `track-report-raw.txt`
stays byte-identical (its header included).

Served command (weekly default, French):

```bash
track report --status-table --format md
```

```text
# TRACK REPORT — global · 2/15 (13%)
*période : 2026-10-11T12:39:49.467Z → 2026-10-18T12:39:49.467Z (7 derniers jours glissants ; 37/54 événements)*
*baseline d’acceptance : 672aef97ac3a*
*couverture : 13 lignes projetées · 11 rendues · 7 hors WP (outside-wp) · 2 omises : 1 décision déjà tranchée (visible dans bloqué ou FAIT, plus rien à y répondre) · 1 retiré hors fenêtre, sans gate actif ni décision liée en fenêtre*
*sources : projection déterministe du journal (track report --wp --decisions) ; révision du journal : 54 événements ; tête : sha256:c221e5b35c6a4024d2cc3f6f6e719525291452ea8de0ad0c934ada16eb709122*

## FAIT
scope            avancement     dernières actions
──────────────   ────────────   ─────────────────
global           2/15 \(13%\)   deployed member

WP2 · UAT Beta   2/3 \(67%\)    deployed member

## À-FAIRE
*ordre = priorité ; les cinq premiers sont le focus*
WP                    av.   étape        statut                 à faire                                                         bloqué            prochaine action
───────────────────   ───   ──────────   ────────────────────   ─────────────────────────────────────────────────────────────   ───────────────   ────────────────────────────────────────
WP1 · UAT Alpha       0%    [1.1] dev    [1.1] — non qualifié   [1.1] old open work                                             D1 · dépendance   à instruire : ouvrir l’item et nommer le
                            [1.2] spec   [1.2] — retiré         [1.2] old withdrawal with live gate                                               geste
                            [1.3] dev    [1.3] 🔴 bloqué        [1.3] red lane work
                            [1.4] dev    [1.4] 🔵 décision      [1.4] blue choice work
                            [1.5] dev    attendue               [1.5] fresh sub\-WP work
                            [1.6] spec   [1.5] — non qualifié   [1.6] fresh withdrawal
                                         [1.6] — retiré         ↳ extrait : retiré : Cut the scope: duplicate of the old lane

WP2 · UAT Beta        67%   [2.1] dev    [2.1] — non qualifié   [2.1] never\-qualified work                                     —                 à instruire : ouvrir l’item et nommer le
                                                                                                                                                  geste

WP1.1 · UAT Alpha.1   0%    [3.1] dev    [3.1] — non qualifié   [3.1] fresh sub\-WP work                                        —                 à instruire : ouvrir l’item et nommer le
                                                                                                                                                  geste

WP3 · phase only      0%    [4.1] spec   [4.1] — non qualifié   [4.1] phase\-only leaf \(outside\-wp\)                          spec              à instruire : ouvrir l’item et nommer le
                                                                                                                                                  geste

S1 · stream only      0%    [5.1] spec   [5.1] — non qualifié   [5.1] stream\-only leaf \(outside\-wp\)                         spec              à instruire : ouvrir l’item et nommer le
                                                                                                                                                  geste

hors WP · items       n/a   [6.1] spec   [6.1] — non qualifié   [6.1] old external prerequisite \(outside\-wp\)                 —                 non instruite
                            [6.2] spec   [6.2] — non qualifié   [6.2] other lane prerequisite \(outside\-wp\)
                            [6.3] spec   [6.3] — non qualifié   [6.3] parentless leaf \(outside\-wp\)
                            [6.4] spec   [6.4] — non qualifié   [6.4] second half \(outside\-wp\)
                            [6.5] spec   [6.5] — non qualifié   [6.5] first half \(outside\-wp\)

## DÉCISIONS
```
┌────┬───────────────────────────┬─────────────────────────────┬───────┐
│ #  │ sujet                     │ alternatives                │ préco │
├────┼───────────────────────────┼─────────────────────────────┼───────┤
│ D1 │ Share the UAT connector ? │ A Share — One connection    │   A   │
│    │                           │ B Isolate — Two connections │       │
└────┴───────────────────────────┴─────────────────────────────┴───────┘
```

## RECOMMANDATION
Sans décision : WP2, WP1.1, WP3 peuvent démarrer — le geste concret reste à instruire par ligne.
D1 A → débloque WP1.
Réponds « vas y » (les lanes sans décision) ou « D1 A » (tout débloquer).
```

Reading notes (what this example proves):

- The window is rolling by default (`7 derniers jours glissants`, 37/54
  events); bounds come from the journal and the clock, never invented.
- À-FAIRE carries the seven columns; stage cells hold neutral codes (`dev`,
  `spec`) and status cells neutral states with health colour only where a
  conformity witness exists (`🔴 bloqué`, `🔵 décision attendue`).
  `— non qualifié` and `— retiré` carry no colour.
- The old delivery (2026-09-20) is out of the rolling week, so FAIT shows
  only the in-window `deployed member`; the long explicit period
  (`--since 2026-09-01 --until 2026-10-18`) shows both.
- `old withdrawal with live gate` stays served; `fresh withdrawal` keeps its
  recorded reason (`retiré : Cut the scope: duplicate of the old lane`); the
  irrelevant old withdrawal is omitted with its reason, counted in the
  header.
- `hors WP · items` gathers the parentless leaf, the phase/stream-only
  leaves and the two demand halves — flagged `(outside-wp)`, never silent.
- FAIT cells carry titles and excerpts only. Finality prose (criterion 26)
  is agent synthesis over inputs 1–3, not renderer output: the renderer
  deliberately hands no title list to paste.
- On this 7-day window the sub-WP row (`WP1.1`) is listed beside its parent
  and the shared item answers two handles (`1.5`, `3.1`); on a long window
  (`--since 2026-09-01 --until 2026-10-18`) sub-levels aggregate into their
  parent and the header declares it (`1 sous-WP agrégés dans leur parent`).

## Historical recipe warning (kept outside the raw file)

The reference renderer for a reproduction attempt of the historical raw
artefact is the pre-amendment validated five-column route at
`7670fbed6870fb7e5b985a1315ff55776b362fd8` (without `--status-table`), with
the journal at the recipe's `d01368f` and `--now 2026-07-29T12:00:00Z`. The
seven-column renderer above is not a byte-reproduction target for that
historical artefact. Exact reproduction is `unverified`: `d01368f` is absent
from this clone, and no run with that journal was made. Do not treat a
header's journal baseline as proof of a renderer revision or claim byte
reproduction from the form-only test.
