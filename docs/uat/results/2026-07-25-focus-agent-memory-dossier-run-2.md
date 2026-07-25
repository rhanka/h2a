# UAT result — Focus decision dossier (agent-memory) — run 2

Scenario: [`docs/uat/2026-07-25-focus-agent-memory-dossier.md`](../2026-07-25-focus-agent-memory-dossier.md)
Previous run: [`run 1`](./2026-07-25-focus-agent-memory-dossier-run-1.md) — a valid record of an **earlier
commit** (`119122fe`), deliberately left untouched.

- **Commit tested**: `74fa2db` (`origin/main`, "Merge pull request #33 from rhanka/docs/uat-focus-agent-memory-run-1")
  **plus the G2 fix and the two documentation corrections of this branch**, focus **0.3.1**.
- **Run date**: 2026-07-25
- **Purpose**: run the checkpoints that revision 2 added while run 1 was in flight and never executed —
  **A1 (restated, 13 decisions), A4, A5, A6, A7, F1 (strengthened), F3, F4** — and re-run **G2**, which
  run 1 recorded as a FAIL.
- **Verdict**: the eight previously-uncovered CRITICAL checkpoints **all PASS**. **G2 now PASSES** at
  375 / 500 / 639 / 640 / 700 / 768 / 769 / 1400 px. **G1 stays PARTIAL and is deliberately not marked
  pass** — the app ships no dark theme at all, so its light/dark half is not satisfiable by any change to
  this app's layout; it is recorded below as a **missing capability**, not as a failure of this change.
- **Release gates**: `npm run lint` **PASS** · `npm run check` **PASS — 0 errors / 1 pre-existing warning
  over 523 files** · `npm run build` **PASS**. Zero new problems.

## How it was served

- Worktree at the tested commit; the primary checkout and the owner's dev server on **5178** were never
  touched. Root `npm ci --ignore-scripts` + `npm run build -w @sentropic/track`, then
  `cd apps/focus && npm ci && npm run build && npm run preview -- --port 5299 --strictPort`.
- Checkpoints ran against the **production build** on port **5299**, not against source.
- Browser: **isolated headless Chromium** (`chromium-1228`), a fresh `browserContext` per viewport.
  This is deliberate: run 1 recorded two environment traps — driving the owner's shared Chrome had its tab
  navigated away mid-run, and in an occluded window `requestAnimationFrame` never fires, which times out
  Playwright's stability wait and *mimics* a layout oscillation. Neither occurred here.
- Interaction was real: `getByRole(...).click()`, `keyboard.type()`, real `scrollTo` / `scrollIntoView`,
  and an accepted `confirm()` dialog for the replay.

## G2 — the defect run 1 found, and the fix

### What was wrong

`@sentropic/design-system-svelte`'s `AppShell` styles the scrollport as

```
.st-appShell__main { flex: 1 1 0; min-block-size: 0; overflow: auto }   /* unconditional */
@media (max-width: 48rem) { .st-appShell__body { flex-flow: column nowrap } }
```

The zero `flex-basis` is written for a body laid out as a flex **row**, where it constrains the *inline*
axis and the block size comes from stretching. The media query moves the main axis to the **block**
direction, so `flex-basis: 0` starts sizing the *height*: `main` becomes a **0-px-tall scrollport** holding
the whole page. It is the shared shell, not dossier markup — the root route `/` collapsed the same way.

### The fix — consumer-side, not a fork

`apps/focus/src/app.css`:

```
@media (max-width: 48rem) {
  .st-appShell .st-appShell__body > .st-appShell__main { flex-basis: auto; }
}
```

One declaration. It is a **consumer override, not a fork**, on three counts:

1. It lives in the app's own global stylesheet. `node_modules` is untouched, no component file is copied,
   and `AppShell` keeps being imported from the package — a DS upgrade still lands in full.
2. It wins by **specificity alone**, no `!important` and no reliance on stylesheet order: the component's
   own rule compiles to `.st-appShell__main.svelte-do0njo` (0,2,0) and the override is (0,3,0). Verified in
   the built bundle: `.st-appShell .st-appShell__body>.st-appShell__main{flex-basis:auto}` in
   `_app/immutable/assets/0.*.css`.
3. It is the same technique already used in this app for the note field's width cap
   (`.note-field { --st-component-field-maxWidth: 100% }`, checkpoint C3) — override from the consumer,
   never edit the component.

It changes **one** property, inside the DS's own breakpoint, and touches nothing at ≥ 769 px: the
computed `flex-basis` there is still `0px`, and every desktop measurement is identical to before the
change. `flex-grow`, `flex-shrink`, `min-block-size` and `overflow` are left exactly as the DS sets them.
When the design system fixes the block axis upstream this rule becomes a no-op and can be deleted; the
`app.css` comment says so.

### Measured before / after — `/dossier/agent-memory`

`docSH`/`docCH` = `documentElement.scrollHeight` / `clientHeight`; `mainH` = rendered height of
`.st-appShell__main`; `mainSH` = its `scrollHeight`; `maxScrollY` = `scrollY` after
`window.scrollTo(0, 99999)`; `hzOv` = `documentElement.scrollWidth − clientWidth`.

| width | | docSH/docCH | shellH | mainH | mainSH | maxScrollY | flex-basis | hzOv |
|---|---|---|---|---|---|---|---|---|
| **375** | before | 720 / 720 | 0 | **0** | 9323 | **0** | 0px | 0 |
| | **after** | **9323** / 720 | 9323 | **9323** | 9323 | **8603** | auto | 0 |
| **500** | before | 720 / 720 | 0 | **0** | 7843 | **0** | 0px | 0 |
| | **after** | **7843** / 720 | 7843 | **7843** | 7843 | **7123** | auto | 0 |
| **639** | before | 720 / 720 | 0 | **0** | 7047 | **0** | 0px | 0 |
| | **after** | **7047** / 720 | 7047 | **7047** | 7047 | **6327** | auto | 0 |
| **640** | before | 720 / 720 | 0 | **0** | 7047 | **0** | 0px | 0 |
| | **after** | **7047** / 720 | 7047 | **7047** | 7047 | **6327** | auto | 0 |
| **700** | before | 720 / 720 | 0 | **0** | 6772 | **0** | 0px | 0 |
| | **after** | **6772** / 720 | 6772 | **6772** | 6772 | **6052** | auto | 0 |
| **768** | before | 720 / 720 | 0 | **0** | 6617 | **0** | 0px | 0 |
| | **after** | **6617** / 720 | 6617 | **6617** | 6617 | **5897** | auto | 0 |
| **769** | before | 6617 / 720 | 6617 | 6617 | 6617 | 5897 | 0px | 0 |
| | **after** | 6617 / 720 | 6617 | 6617 | 6617 | 5897 | 0px | 0 |
| **1400** | before | 6617 / 720 | 6617 | 6617 | 6617 | 5897 | 0px | 0 |
| | **after** | 6617 / 720 | 6617 | 6617 | 6617 | 5897 | 0px | 0 |

**No desktop regression**: at 769 px and 1400 px every number is unchanged, digit for digit.

### The page is genuinely rendered, not merely tall

Screenshots of the viewport, counted by unique RGB values (the pre-fix rendering was reproduced in the same
browser by counter-overriding `flex-basis` back to `0px`, which restored `mainH 0` / `maxScrollY 0` exactly):

| width | before (unique colours) | after (unique colours) |
|---|---|---|
| 375 | **1** (a single flat grey image) | **2789** |
| 768 | **1** | **3477** |

### Controls are reachable and interactable at every width

Per width, with real input on the served build:

| width | click "Suivante" | progressbar after click | note field: click + type | typed value read back | note width / card inner width | textarea `max-width` |
|---|---|---|---|---|---|---|
| 375 | OK | `aria-valuenow=2` | OK | `G2-375px` | 309 / 311 px (0.994) | `none` |
| 500 | OK | 2 | OK | `G2-500px` | 434 / 436 px (0.995) | `none` |
| 639 | OK | 2 | OK | `G2-639px` | 573 / 575 px (0.997) | `none` |
| 640 | OK | 2 | OK | `G2-640px` | 574 / 576 px (0.997) | `none` |
| 700 | OK | 2 | OK | `G2-700px` | 634 / 636 px (0.997) | `none` |
| 768 | OK | 2 | OK | `G2-768px` | 702 / 704 px (0.997) | `none` |
| 769 | OK | 2 | OK | `G2-769px` | 702 / 704 px (0.997) | `none` |
| 1400 | OK | 2 | OK | `G2-1400px` | 702 / 704 px (0.997) | `none` |

(The 2 px gap is the textarea's own 1 px border on each side; `max-width: none` shows the DS 28 rem cap is
still lifted at mobile widths, so C3 holds there too. The 375 px screenshot shows the note field with
`G2-375px` in it.)

### The matrix still scrolls inside its own container, and the body never scrolls horizontally

`.st-table-wrap` keeps `overflow-x: auto` at every width, and the page body's horizontal overflow is **0 px
at all eight widths — including while the matrix is scrolled fully to the right**:

| width | 375 | 500 | 639 | 640 | 700 | 768 | 769 | 1400 |
|---|---|---|---|---|---|---|---|---|
| matrix available `scrollLeft` | 1246 | 1121 | 982 | 981 | 921 | 853 | 853 | 853 |
| body horizontal overflow | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| body h-overflow while matrix scrolled right | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**G2: PASS.**

### The root route `/` is fixed too

The override is app-wide (`app.css`), so the same collapse on `/` — which run 1 recorded as a degradation
rather than a blank page — is corrected without a second rule:

| width | shellH before → after | mainH before → after | maxScrollY before → after |
|---|---|---|---|
| 375 | 58 → **10877** | 0 → **10819** | 1870 → **10157** |
| 500 | 58 → **9679** | 0 → **9621** | 1675 → **8959** |
| 639 | 58 → **8794** | 0 → **8736** | 1507 → **8074** |
| 640 | 58 → **8794** | 0 → **8736** | 1507 → **8074** |
| 700 | 58 → **8475** | 0 → **8417** | 1339 → **7755** |
| 768 | 58 → **8102** | 0 → **8044** | 1110 → **7382** |
| 769 | 8102 (unchanged) | 8044 (unchanged) | 7382 (unchanged) |
| 1400 | 6276 (unchanged) | 6218 (unchanged) | 5556 (unchanged) |

Before the fix, `/` let the reader reach 1870 px of a 10819 px page at 375 px; now the whole page is
reachable.

## Checkpoints executed in this run

| # | Verdict | Evidence actually observed |
|---|---------|----------------------------|
| **A1** (restated) | **PASS** | **14 slides = 1 state-of-the-art + 13 decisions `D1..D13`**, in order. Every decision card carries a question (`h2`, 54–163 chars), a why-now paragraph (236–789 chars), its options, an `Alert` titled `Critère à trancher (neutre)`, and an `h3 Prochain travail` with 123–267 chars of text — present on **13 / 13**. Rendered option counts: D1 3 · D2 5 · D3 3 · D4 3 · D5 3 · D6 3 · D7 3 · D8 3 · D9 3 · D10 4 · D11 3 · D12 3 · D13 3 = **42**, matching the fixture exactly (42 `behavior:` fields). `Nouvelle carte (révision 2)` badge on exactly **D8..D13** (6 cards) and on none of D1..D7. Each decision card also has exactly **1** textarea and **1** `Inclure ce choix dans la CLI` button. *(Note: run 1's banner described revision 2 as "43 options"; the fixture and the render both say **42** — the banner figure was an estimate written without running A1.)* |
| **A4** | **PASS** | `Comment ça marche réellement (N)` renders on **13 / 13** decision cards — never in an appendix — with N = 6 · 6 · 5 · 3 · 3 · 4 · 1 · 6 · 5 · 5 · 4 · 4 · 5 = **57 mechanism entries**. **Every one of the 57 carries a non-empty source**, and the sources are checkable in form: file:line (`recherche §1 — memory_tool.py:16,69,776-783`), a named function (`memory_tool.py, format_for_system_prompt()`), or a research section (`recherche §1`). Zero unsourced entries. |
| **A5** | **PASS** | `Non vérifié` (warning `Badge`) renders on the mechanism entries the research could not establish at primary source — **2 occurrences**, on D2 and D9 — and `Ce que nous n’avons pas pu établir` renders as its own `section.unknowns` on **10 of 13** cards (D1 2 items, D2 3, D3 2, D4 1, D8 1, D9 2, D10 2, D11 2, D12 2, D13 2 = **19 declared unknowns**). The three cards without the section (D5, D6, D7) declare no `unknowns` in the fixture, so nothing is being hidden — the section is conditional on having something to admit, which is the honest behaviour. No unverified claim was found rendered as fact. |
| **A6** | **PASS** | The leading state-of-the-art card renders `Corrections à la révision précédente (7)` with **7 list items**, each stating subject / what revision 1 asserted / what the mechanism research found / a source. The seven are: Hermes caps (**characters, not tokens** — `memory_char_limit = 2200`, `user_char_limit = 1375`, `tools/memory_tool.py:167`) · Hermes consolidation (**no LLM consolidation pass at all**; over-budget writes are rejected synchronously) · Hermes licence (MIT) · Letta/MemGPT (**not last-writer-wins** — SQLAlchemy `version_id_col` optimistic locking plus a `BlockHistory` table) · ctx "convergent" (**an epistemic claim, not a CRDT**) · ctx surface (**it does ship MCP**, extensively) · graphify (**already ingests transcripts**, plus a memory sink, temporal recall and an 18-tool MCP server). All five items the scenario names are present, and the matrix caption itself is marked `(corrigée en révision 2)`. |
| **A7** | **PASS** | The 5 round-2 cards that derive from an owner answer (D8, D9, D10, D11, D12) each render `Découle de votre réponse à …` with a `blockquote`. Each quoted segment was compared against `docs/decisions/2026-07-25-agent-memory-owner-answers.json`: **all 6 segments are exact contiguous substrings of the owner's own note** for the decision they are attributed to — D8 ← D1 (146 chars) **and** D4 (79 chars), D9 ← D2 (71), D10 ← D2 (177), D11 ← D3 (65), D12 ← D6 (71) — modulo typographic apostrophes and the card's own framing punctuation. **0 paraphrases.** **D13 renders no quote**, exactly as the scenario says it should: it is the card nobody raised. |
| **F1** (strengthened) | **PASS** | `Rejouer les réponses enregistrées` on revision `agent-memory-2026-07-25` reports `7 réponse(s) rejouée(s)` / `Sélections et notes restaurées pour : D1, D2, D3, D4, D5, D6, D7` with **0 missing decisions and 0 stale options** (success tone; neither the `décision disparue` nor the `Options disparues` alert rendered). Restored per-card note lengths **237 / 251 / 66 / 79 / 221 / 71 / 0** chars — D7 legitimately has no note — with the matching options selected (D1 `Hybride : corpus curé et capture vivante en couches distinctes`, D2 `Graphe ontologique de corpus`, D3 `Extraction automatique avec porte d’approbation`, D4 `Réconciliation bi-temporelle`, D5 `Embarqué, local-first`, D6 `Écritures concurrentes sûres (CRDT / append-log)`, D7 `ActiveMemory/ctx (Go)`). The committed answer set is **not orphaned** by the revision bump. |
| **F3** | **PASS** | Above the replay control the page renders `Report depuis « agent-memory-2026-07-24 » : 7 décisions conservées, 6 ajoutées` with the carry-over statement (same keys, same option keys, text enriched not replaced, so the set replays in full). DOM order was asserted, not eyeballed: `compareDocumentPosition` puts the replay button **after** that heading. |
| **F4** | **PASS** | The replay is honest in both directions. Besides the applied list it renders `6 décision(s) sans réponse dans ce jeu — Ce jeu enregistré ne couvre pas : D8, D9, D10, D11, D12, D13`, and the progress counter reads `7 décision(s) sur 13 annotée(s) ou sélectionnée(s)`. A "successful" replay therefore never implies the whole dossier is answered. |
| **G2** | **PASS** | See the section above: fixed and measured at 375 / 500 / 639 / 640 / 700 / 768 / 769 / 1400 px. |
| **G1** | **PARTIAL — not a pass, and not a failure of this change** | *Token half — PASS*: the dossier's own CSS rules contain **zero** hardcoded colour literals; colours come from `var(--st-*)`. *Light/dark half — NOT SATISFIABLE*: **0** `prefers-color-scheme` rules exist in the served CSS (out of 221 rules walked across every stylesheet), and emulating `colorScheme: 'dark'` leaves every measured colour identical to light — card background `rgb(255,255,255)` and heading colour `rgb(15,23,42)` in **both**. See the finding below. |

### Re-confirmed in passing (already PASS in run 1, re-measured on revision 2)

| # | Verdict | Evidence |
|---|---------|----------|
| **A2** | **PASS** | `Recommandée` occurs **0** times in the whole 14-slide DOM, and 0 per card. |
| **A3** | **PASS** | Matrix renders **9 columns**, **19 body rows**, **171 body cells, 0 empty**; caption `État de l’art — matrice de comparaison des substrats mémoire (corrigée en révision 2)`. |
| **B3** | **PASS** | Body horizontal overflow **0 px at all eight widths**, including while `.st-table-wrap` is scrolled fully right; the matrix keeps `overflow-x: auto` and 853–1246 px of its own `scrollLeft`. |
| **C1** | **PASS** | Exactly **1** textarea labelled `Votre note` on each of the **13** decision cards. |
| **C3** | **PASS** | Note width / card inner width **0.994–0.997** at every width, computed `max-width: none` — the DS 28 rem cap stays lifted, mobile included. |

## Findings

### Finding 1 (this run's fix) — G2 closed

The blank/unscrollable page at ≤ 768 px is fixed consumer-side; numbers above. The **root cause remains a
design-system bug**: `flex: 1 1 0` on a scrollport whose flex direction is switched to `column` by the
component's own media query. Focus is now immune, but **every other consumer of `AppShell` is still
affected**. This belongs in the `@sentropic/design-system-svelte` lane as its own fix — the sane upstream
change is for the `max-width: 48rem` block to set the block-axis basis at the same time as it switches the
flow. Until then the `app.css` comment tells the next reader why the override exists and when to delete it.

### Finding 2 (capability missing, not a regression) — Focus has no dark theme

`src/routes/+layout.svelte` wraps the app in one hardwired theme (`<ThemeProvider theme={entropicTheme}>`)
and `ThemeProvider` takes a single theme object with no mode input. Measured: **0** `prefers-color-scheme`
rules in the served CSS, and identical colours under light and dark emulation. G1's light/dark half cannot
be satisfied by any layout change to this app — it needs a colour-mode capability (a dark theme plus a mode
switch or an `auto` binding), which is a Focus + design-system feature, not a dossier defect. The scenario
document has been amended to say so, so no future run scores G1 as a pass it cannot earn.

### Finding 3 (fixed here, cosmetic) — duplicate `<title>` in the SSR response

`apps/focus/src/app.html` hardcoded `<title>Focus · Suivi</title>` while pages add their own via
`svelte:head`, so `/dossier/agent-memory` shipped **two** `<title>` elements. Fixed by removing it from
`app.html` and giving the root route its own `svelte:head` title, so no route loses one. Verified on the
served build: `/` now returns exactly **1** title (`Focus · Suivi`) and `/dossier/agent-memory` exactly
**1** (`Dossier de décisions — mémoire de l’agent persistant (révision 2)`).

### Finding 4 (pre-existing, out of scope, unchanged by this fix) — `/` overflows horizontally below 640 px

Not a dossier checkpoint (B3 is about the dossier, which is clean), but measured on the way: the **root
route** has body horizontal overflow of **213 px at 375 px** and **88 px at 500 px**, and **0 px from
639 px up**. The numbers are **identical before and after** this change, so the fix neither caused nor
cured it. It is a separate root-page layout defect and should get its own ticket.

### Finding 5 (documentation) — the UAT's "three pre-existing `check` errors" line was stale

Run 1 already recorded that the three errors do not occur; run 2 confirms it on the current tip. With
`@sentropic/track` built — which the scenario's own "How to run" prescribes — `svelte-check` reports
**0 errors / 1 warning over 523 files**. The single warning,
`src/routes/+page.svelte:21:17 state_referenced_locally`, is pre-existing and unrelated. The scenario's
"confirm they are unchanged" wording was therefore describing an environment it forbids; **the gate section
has been corrected in this branch** to state a **0-error** bar.

## Not covered, and why

- **G1's light/dark half** — not coverable: the capability does not exist (Finding 2). Reported as
  measurement, never as a pass.
- **E1 / E2 / E5 (live-CLI hand-off) were not re-executed on revision 2.** Run 1 covered them with a real
  delivery to a real live session and read the envelope back off the bus on disk, and this change touches
  no server route, no `h2a-bus.ts`, and no include payload — but the strengthened per-card include across
  D8..D13 was verified only *structurally* here (the button is present and enabled on all 13 cards), not by
  13 real deliveries. A live-delivery re-run needs the primary checkout (E1b) and a live session.
- **C2 (note persistence across reload), C4 (drag-inside-note selects), D2/D3/D4, E3, E4, F2** — carried
  over from run 1, unchanged by this branch, not re-executed. This run's scope was the eight
  never-executed revision-2 checkpoints plus G2 and G1.
- **A–F at widths ≤ 768 px** — now *possible* for the first time, but only G2's own assertions (nav click,
  note typing, matrix scroll, no horizontal body overflow) were actually run at those widths. The
  remaining A–F verdicts still rest on ≥ 769 px measurements. A full narrow-width pass of A–F is now
  unblocked and worth doing once.
- **Real touch swipe on touch hardware** — pointer/mouse drag only, as in run 1.
- **Cross-browser** — Chromium only. No Firefox, no WebKit.
- **The root-route horizontal overflow below 640 px** (Finding 4) — measured, not fixed; out of scope.

## Tally

- **CRITICAL previously NOT COVERED, now executed: 8 / 8 PASS** — A1 (restated, 13 decisions), A4, A5, A6,
  A7, F1 (strengthened), F3, F4.
- **CRITICAL re-confirmed in passing: 4 / 4 PASS** — A2, A3, B3, C1 (+ C3).
- **Non-critical (G): G2 FAIL → PASS. G1 remains PARTIAL** (token half pass, light/dark half not
  satisfiable — recorded as a missing capability, not a checkpoint failure of this change).
- **Release gates**: lint PASS · check PASS (**0 errors**, 1 pre-existing warning, 523 files) · build PASS.
  **Zero new problems.**
- **Defects**: 1 major closed (blank/unscrollable ≤ 768 px, plus the same collapse on `/`), 1 cosmetic
  closed (duplicate `<title>`), 1 capability gap recorded (no dark theme), 1 pre-existing root-route
  horizontal overflow recorded, 1 design-system bug referred upstream.
