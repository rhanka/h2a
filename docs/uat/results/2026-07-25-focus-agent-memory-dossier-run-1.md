# UAT result — Focus decision dossier (agent-memory) — run 1

Scenario: [`docs/uat/2026-07-25-focus-agent-memory-dossier.md`](../2026-07-25-focus-agent-memory-dossier.md)

- **Commit tested**: `119122fe58c10a93cc528088d9eb83f5fa7a50e9` (`origin/main`, "Merge pull request #29 from rhanka/docs/4b-cross-principal")
- **Run date**: 2026-07-25
- **Verdict**: **all 21 CRITICAL checkpoints (A–F) PASS.** One **non-critical FAIL** outside A–F: **G2** — the dossier renders **blank and unscrollable at viewport width ≤ 768 px**. G1 is **partial** (token half passes, light/dark half not coverable — the app ships no dark theme).
- **Release gates**: `npm run lint` ok · `npm run check` **0 errors / 1 warning** · `npm run build` ok.

> ## ⚠️ This run is PARTIAL with respect to current `main`
>
> `main` advanced **during** this run: PR **#32** (`d7d6c91`, *agent-memory dossier revision 2*) landed
> after the run started. It rewrites the fixture to revision **`agent-memory-2026-07-25`** with
> **13 decisions D1..D13** (43 options) instead of 7 (23), changes the page (+185 lines), **and amends the
> UAT document itself**, adding six new CRITICAL checkpoints.
>
> Everything below was executed against **`119122fe`** — the `origin/main` tip when the run began, and the
> version of the scenario document that existed then. It is a valid record of that commit and **not** a
> verification of current `main`.
>
> **Not covered for current `main` (revision 2) — must be run again:**
> **A1 as restated** (13 decisions D1..D13, `Nouvelle carte (révision 2)` badges) · **A4** (mechanism detail
> on the card with checkable sources) · **A5** (`Non vérifié` badges + "ce que nous n'avons pas pu établir") ·
> **A6** (corrections visible, never silent) · **A7** (round-2 cards quote the owner verbatim) ·
> **F1 as strengthened** (7 applied / 0 missing / 0 stale on the new revision) · **F3** (a revision bump
> states what carries over) · **F4** (a replay also names D8..D13 as uncovered).
>
> **Spot re-check performed on `d7d6c91` (revision 2, 14 cards)** — a partial confirmation, not a full re-run:
>
> | Checkpoint | On revision 2 | Evidence |
> |---|---|---|
> | Defect 1 (G2) | **still FAILS, identically** | blank + `maxScrollY 0`, `shellH/mainH = 0` at 375/640/768 px; correct at 769/800/1400 px (`shellH 6617`) |
> | D1 | still PASS | dead space **0 px on all 14 cards**; gap to nav constant **16 px**; heights 2323–5049 px (so up to 2726 px of dead space avoided) |
> | A2 | still PASS | `Recommandée` badge count **0** |
> | C1 / C3 | still PASS | note present on all 13 decision cards, width ratio to card **1.000** on every one |
> | B3 | still PASS | body horizontal overflow **0 px** |

## How it was served

Work was done in an isolated `git worktree` at the tested commit; **the primary checkout at `/home/antoinefa/src/a2a-cli` was never modified** (no pull, stash, checkout or build in it).

```
git worktree add <scratch>/uat/a2a-cli 119122fe --detach
npm ci --ignore-scripts && npm run build -w @sentropic/track   # repo root
cd apps/focus && npm ci && npm run build && npm run preview -- --port 5199
```

- Checkpoints were run against the **production build** served by `vite preview` on port **5199** (`npm run build` then `npm run preview`), not against source. The owner's own dev server on **5178** was left untouched.
- The worktree directory basename is exactly **`a2a-cli`** — this is what makes E1 real (see below).
- Browser: **isolated headless Chromium** (Playwright `chromium-1228`), viewport 1400×900 unless stated. All navigation/typing/dragging used real input events (`mouse.down/move/up`, `keyboard.press`, real element clicks).

### Two environment traps hit on the way (not product defects)

1. A first attempt drove the owner's **shared** Chrome. That tab was navigated away mid-run to another app on port **5211** serving a *"révision 2"* dossier with **13 decisions**. Measurements from that window were discarded and the run was redone in an isolated browser. Nothing in this report comes from port 5211.
2. In that shared/occluded window `requestAnimationFrame` never fired, so Playwright's click-stability wait timed out and rAF-based probes hung. This looked like a layout oscillation but was **not**: in the isolated browser the same clicks and measurements succeed and the measured height is stable.

## Checkpoint-by-checkpoint

| # | Verdict | Evidence actually observed |
|---|---------|----------------------------|
| **A1** | **PASS** | 8 slides = 1 state-of-the-art + 7 decisions `D1..D7`. Each decision card carries a question (`h2`, 54–117 chars), a why-now paragraph, its options, an alert `Critère à trancher (neutre) …`, and an `h3 Prochain travail` with text. Rendered option counts per card **3 / 5 / 3 / 3 / 3 / 3 / 3 = 23**, matching the fixture (`behavior:` fields per decision block: D1 3, D2 5, D3–D7 3 each, total 23). |
| **A2** | **PASS** | `Recommandée` badge count in the whole 8-slide DOM = **0**. The string does not occur in the served HTML either (`grep -c` = 0). 7 cards each state `Aucune option n'est recommandée par défaut`. |
| **A3** | **PASS** | Matrix renders **9 columns** — Approche, Stockage, Récupération, Réconciliation / temporalité, Écriture, Partage multi-CLI, Auto-hébergement / RAM, Licence, Adéquation — and **19 body rows** (fixture: 19), **171 body cells, 0 empty**. Caption: `État de l'art — matrice de comparaison des substrats mémoire`. |
| **B1** | **PASS** | Slide **1 of 8** is the state of the art: badge `État de l'art`, `Carte 1 sur 8 — aucune décision ici`, **0 option tiles, 0 textareas, 0 include buttons**, contains the matrix, closes with `Rien à trancher sur cette carte`. |
| **B2** | **PASS** | On the leading slide the header badge reads `État de l'art — aucune décision` and the progress bar's `aria-valuetext` is `État de l'art` — **never "Décision 1"**. Decisions are numbered after it: `Décision 1 / 7` … `Décision 7 / 7`. (Card counter and decision counter are distinct: `aria-valuenow=1`, `aria-valuemax=8` counts cards, 7 counts decisions.) |
| **B3** | **PASS** | Page body horizontal overflow = **0 px** at 1400 px and at 375 px (`documentElement.scrollWidth − clientWidth`). The matrix scrolls **inside its own container**: the scroller is `.st-table-wrap` with `clientWidth 702` / `scrollWidth 1471`, `overflow-x: auto`, **769 px of available `scrollLeft`** (verified by setting `scrollLeft` and reading it back). Table intrinsic width 1471 px. |
| **C1** | **PASS** | Each of the **7** decision slides contains exactly **1 `textarea`**, labelled `Votre note`, with helper text `… Enregistrée dans votre navigateur au fil de la frappe.` |
| **C2** | **PASS** | Typed a note on D3 and selected an option. Storage keys are revision-scoped: `focus:dossier-agent-memory:agent-memory-2026-07-24:notes` = `{"D3":"UAT-RUN-1 note: …"}` and `…:choix` = `{"D3":"auto-extraction"}`. After a **full page reload** the textarea value is restored verbatim, the `Sélectionnée` badge is back, and the counter reads `1 décision(s) sur 7 annotée(s) ou sélectionnée(s)`. |
| **C3** | **PASS** | Measured on a decision card: note width **702 px**, card inner content width **702 px**, **ratio 1.0000**; computed `max-width` on the textarea = `none`; `--st-component-field-maxWidth` = `100%` on `.note-field` only. The DS default cap of `28rem` (448 px) is therefore lifted from the consumer, and 702 px > 448 px proves it took effect. |
| **C4** | **PASS** | A real 300 px horizontal drag starting inside the note selected **30 characters** (`selectionStart 0 → selectionEnd 30`), while the active slide stayed **3** and the track transform stayed `matrix(1,0,0,1,-2208,0)` — the gesture did not page the card. |
| **D1** | **PASS** | Measured on **all 8 slides**: `viewportHeight − activeSlideHeight` = **0 px every time**, and the gap between the card bottom and the navigation row is a constant **16 px** (the `Stack gap`). Slide heights range **1822 px (shortest) … 2491 px (tallest)**, so the old single-flex-track layout would have shown up to **2491 − 1822 = 669 px** of dead space on the shortest card. Measured dead space: **0 px**. |
| **D2** | **PASS** | All three affordances navigate, including to and from the leading slide: `Suivante` 0→1; indicator dot 8 → slide 7 (`Décision 7 / 7`); `Précédente` 7→6; **swipe left 0→1** and **swipe right 1→0** (real mouse drags of 220 px). Bounds correct: `Précédente` disabled at slide 0, `Suivante` disabled at the last slide. |
| **D3** | **PASS** | Non-active slides carry `aria-hidden="true"` **and** `inert`. Real keyboard traversal: **45 `Tab` presses** from `body` touched only the **active** slide (`distinctSlidesTouched = [null, 3]`) — **0 focus stops inside an inert slide**, despite 5–7 focusable elements existing in each. |
| **D4** | **PASS** | `.swipe-track` computed `transition-duration` = **0.18 s** normally and **0 s** under emulated `prefers-reduced-motion: reduce`. |
| **E1** | **PASS — genuinely covered** | `Inclure ce choix dans la CLI` is present on **all 7** decision cards. Clicking it on D3 returned **HTTP 200** with `{"ok":true,"delivered":true,"target":"claude:a2a-cli:d36d7390005e","recipientLive":true}` and the card rendered a **success** alert: `Transmis à claude:a2a-cli:d36d7390005e — … elle le verra à sa prochaine relève d'inbox.` This is a real delivery to a real live CLI session, not the no-live-CLI warning. See "E1b defeated" below. |
| **E2** | **PASS** | The envelope was read back **from the bus on disk** (`~/h2a-workspace/.h2a/inbox/claude__a2a-cli__d36d7390005e/env__focus-dossier-agent-memory-D3-1784972505598.json`): `topic: focus.dossier-include`, and `body.humanNote` = `"UAT-RUN-1 note: reasoning must travel with the choice."` **verbatim**, alongside `selectedOption {key: auto-extraction, title: Extraction automatique par le LLM}`, `decisionKey D3`, `revision agent-memory-2026-07-24`. The note travelled, not just the option. |
| **E3** | **PASS** | Reproduced honestly by serving a second instance with `FOCUS_REPO_ROOT` pointing at a root whose basename is not a live project (`zzz-uat-noproject`). Response: `{"ok":true,"delivered":false, note:"Aucune session h2a live sur « zzz-uat-noproject » : rien à qui remettre ce choix…"}` and the UI rendered a **warning**-tone alert `Aucune CLI live sur ce projet`. No delivery was claimed. |
| **E4** | **PASS** | `Copier ma synthèse` produced a **1192-char markdown** document in the clipboard containing all seven `## D1 —` … `## D7 —` sections, **7** `- Option retenue :` lines and **7** `- Note :` lines, including the typed note; success alert `Synthèse copiée`. Both paths remain available (clipboard buttons *and* per-card include). |
| **E5** | **PASS** | Nothing was recorded as a permanent Track decision. The deposited envelope is `type: "event"`, `topic: focus.dossier-include`, `actor: focus:local-human`, with `provenance: "… ceci ne signe aucune décision …"` — no signature, no attestation. `.track` checksum identical before and after the include (`md5 77007f22d00feb0daed98b14edadd12c` both times) and `git status --porcelain` empty in the worktree. |
| **F1** | **PASS** | `Rejouer les réponses enregistrées` loaded the committed set (`docs/decisions/2026-07-25-agent-memory-owner-answers.json`, revision `agent-memory-2026-07-24`, *direction, not ratified*) and reported `7 réponse(s) rejouée(s) … D1, D2, D3, D4, D5, D6, D7`. Both selections **and** notes were restored — per-card note lengths **237 / 251 / 66 / 79 / 221 / 71 / 0** chars (D7 legitimately has no note) with the matching option titles selected (e.g. D1 `Hybride : corpus curé et capture vivante en couches distinctes`). Counter: `7 décision(s) sur 7`. |
| **F2** | **PASS** | With a doctored answer set (revision `agent-memory-2026-08-01-FUTURE`, an extra `D9` key, and a `D1` option that no longer exists), the page warned **before** replay: `Révision différente — Ces réponses ont été capturées sur « … FUTURE », or ce dossier est en « agent-memory-2026-07-24 »`; it asked for confirmation because local answers existed; and after replay it **named what did not land**: `Réponses non rejouables : décision disparue … : D9` and `Options disparues : note rejouée, sélection non … : D1 → option-qui-nexiste-plus` (D1's note restored, 237 chars; its selection left empty). Nothing was dropped silently. |
| **G1** | **PARTIAL** | *Token half — PASS*: the dossier's **9 own CSS rules** contain **zero** hardcoded colour literals (no `#hex`, `rgb()`, `hsl()`); colours come from `var(--st-*)` only. *Light/dark half — **NOT COVERED**, see Defect 2*: the app pins a single theme, so `prefers-color-scheme: dark` changes nothing measurable (card background `rgb(255,255,255)` and text `rgb(15,23,42)` **identical** in light and dark emulation; **0** `prefers-color-scheme` rules in the served CSS). Light-theme readability is fine (card text 15,23,42 on white; secondary text 71,85,105 on white). |
| **G2** | **FAIL** | See Defect 1. At **375 px** the page is **blank** and `maxScrollY = 0` while the navigation row sits at `y ≈ 3802`. Horizontal body overflow is 0 px (that half of G2 holds), but "controls reachable, note usable" does not: no control is reachable and the note cannot be typed into. |

## Defects

### Defect 1 — the dossier renders blank and cannot be scrolled at viewport width ≤ 768 px (G2, FAIL)

**Reproduction**

1. Serve the built app (`npm run build && npm run preview`) at the tested commit.
2. Open `/dossier/agent-memory` in a browser window **768 px wide or narrower** (tested 375, 500, 639, 640, 700, 768; also with mobile emulation `isMobile/hasTouch` at 375).

**Observed**

- The viewport is **entirely empty** — a flat light-grey page, no title, no card, no controls (screenshots at 375 px and 768 px are single-colour images; the 769 px screenshot renders the dossier correctly).
- The page **cannot be scrolled at all**: `documentElement.scrollHeight === clientHeight` (720 = 720) and `window.scrollTo(0, 99999)` leaves `scrollY = 0`, while the navigation row's layout position is `y ≈ 3802` and `.st-appShell__main.scrollHeight` is `4525`.
- Consequently every affordance below the fold is unreachable: `Précédente` / `Suivante`, the slide indicator, the note field, `Inclure ce choix dans la CLI`, `Copier ma synthèse`, and the replay section. A real `click()` on the indicator dot fails with the theme wrapper `div` intercepting pointer events.

**Expected**

At a narrow mobile width the dossier is usable: the deck is visible, the page scrolls vertically, controls are reachable and the note can be typed into (UAT G2).

**Measured cause and exact breakpoint**

Broken at **≤ 768 px**, correct at **≥ 769 px** — a hard cliff matching the design-system rule

```
@media (max-width: 48rem) { .st-appShell__body { flex-flow: column; } }
```

(48 rem = 768 px, in `@sentropic/design-system-svelte`'s `AppShell`). Combined with the unconditional
`.st-appShell__main { flex: 1 1 0px; min-block-size: 0px; overflow: auto; }`, switching the body to
`column` makes `flex-basis: 0` apply on the **block** axis, so `main` becomes a **0-px-tall scrollport**
holding 4525 px of content. Measured: `.st-appShell` height `0`, `.st-appShell__body` height `0`,
`.st-appShell__main` height `0` with `scrollHeight 4525`; `grid-template-rows` on `.st-appShell` is
`0px 0px 0px` at 768 px versus `0px 3629.31px 0px` at 900 px.

**Still present on current `main`** — re-verified against `d7d6c91` (revision 2) after rebuilding and
re-serving: blank and `maxScrollY = 0` at 375 / 640 / 768 px, correct from 769 px up. The revision-2 work
did not touch it, and would not have: the cause is in the shell, not the dossier.

**Scope / ownership** — this is the shared `AppShell` (`variant="workspace"`), not dossier-specific markup: at 375 px the root page `/` shows the same collapse (`shellH 58`, `mainH 0`) though it still scrolls to 1870 px, so it degrades rather than going fully blank. The dossier is the page where it becomes total. The fix belongs in the design-system `AppShell` (or in how Focus wraps it), not in `apps/focus/src/routes/dossier/agent-memory/`. Not fixed in this run — this run only verifies.

### Defect 2 — no dark theme exists, so G1's light/dark half cannot hold (minor)

`apps/focus/src/routes/+layout.svelte` wraps the whole app in a single hardwired theme
(`<ThemeProvider theme={entropicTheme}>`), and `ThemeProvider` takes one theme object with no mode
input. The served CSS contains **0** `prefers-color-scheme` rules, and emulating a dark OS preference
leaves every measured colour identical (card `rgb(255,255,255)` / text `rgb(15,23,42)` in both). The page
is readable, but it is readable in *one* theme; "readable in both light and dark theme" is not something
the current app can satisfy. This is an app-level (layout/design-system) gap, not a dossier regression.

### Observation (cosmetic, no checkpoint) — duplicate `<title>` in the served HTML

`apps/focus/src/app.html:7` hardcodes `<title>Focus · Suivi</title>` while the dossier page adds its own
through `svelte:head`, so the SSR response contains **two** `<title>` elements. Chromium resolves
`document.title` to the dossier title, so nothing visibly breaks; it is still two titles on the wire.

## Not covered, and why

- **The whole of revision 2 (`agent-memory-2026-07-25`, main `d7d6c91`)** — the run predates it. The six new
  CRITICAL checkpoints **A4, A5, A6, A7, F3, F4**, the restated **A1** (13 decisions) and the strengthened
  **F1** were **never executed**. See the banner at the top for the exact list and for the partial spot
  re-check that was done. **Run 2 is required before revision 2 can be called accepted.**
- **G1, light/dark half** — not coverable at this commit: the app ships no dark theme (Defect 2). Reported as measurement, not as a pass.
- **Real touch swipe on a touchscreen** — swipe was exercised with real pointer/mouse drag sequences (`pointerdown/move/up`), which is what the component listens to, but not on physical touch hardware.
- **Any checkpoint at width ≤ 768 px other than G2 / B3** — impossible to run there: nothing renders (Defect 1). A–F verdicts are therefore established at **≥ 769 px** (1400×900). B3's zero-horizontal-overflow was additionally confirmed at 375 px.
- **The `npm run check` errors named in the UAT as pre-existing** — they did **not** occur, so there was nothing to confirm unchanged. With `@sentropic/track` built (as the UAT's own "How to run" prescribes), `svelte-check` reports **0 errors, 1 warning** over 523 files. The single warning is pre-existing and unrelated to the dossier: `src/routes/+page.svelte:21:17 state_referenced_locally`. The UAT's "add zero new errors" bar is met (0 total).
- **Cross-browser** — Chromium only. No Firefox or WebKit run.
- **Concurrent multi-session include** — a single include to one live target was verified; contention between several live CLI sessions was not exercised.

## E1b defeated — how E1 became a real pass

The scenario warns (E1b) that `projectName()` derives the project from the **directory basename**, so a
worktree named `a2a-cli-something` resolves to that name, finds no live session, and yields the honest
no-live-CLI warning instead of a delivery — which is not an E1 pass.

It was defeated legitimately, without touching the primary checkout:

1. The worktree was created at a path whose **basename is exactly `a2a-cli`**, so
   `repoRoot()` → `path.resolve(cwd, '..', '..')` from `apps/focus` gives the worktree root and
   `projectName()` returns **`a2a-cli`** — the real project name.
2. The h2a bus is machine-global and **cwd-independent** (`resolveRootInfo`: `--root` → `H2A_ROOT` →
   `~/h2a-workspace/.h2a`), so a server started from the worktree sees the same presence store as every
   other agent. No env override was needed and none was used for E1.
3. `packages/h2a/dist/bin.js` was built in the worktree (`npm run build:h2a`, CLI 0.85.25) so
   `liveSessionsForProject` had a real binary to call.

Result: the include resolved a live session whose instance contains `:a2a-cli:`
(`claude:a2a-cli:d36d7390005e`, `state: live`, `CLI_HOST_PREFIX` = `claude:`), delivered to it, and the
envelope was afterwards read back from that session's inbox on disk. E1 and E2 rest on an actual
delivery. E3 was then covered separately by pointing `FOCUS_REPO_ROOT` at a non-project basename, so both
branches of the hand-off — delivered and honestly-not-delivered — are observed rather than inferred.

## Tally

*(against the scenario as it stood at `119122fe`; see the banner for what revision 2 adds and what was not run)*

- **CRITICAL (A–F): 21 / 21 PASS** — A1–A3, B1–B3, C1–C4, D1–D4, E1–E5, F1–F2.
- **CRITICAL added by revision 2: 8 NOT COVERED** — A1 (restated), A4, A5, A6, A7, F1 (strengthened), F3, F4.
- **Non-critical (G): 1 FAIL (G2), 1 PARTIAL (G1)**.
- **Release gates**: lint PASS · check PASS (0 errors, 1 pre-existing warning) · build PASS.
- **Defects found**: 1 major (blank/unscrollable ≤ 768 px), 1 minor (no dark theme), 1 cosmetic observation (duplicate `<title>`).

No CRITICAL checkpoint blocks the release. G2 is a real, reproducible failure of the documented
scenario and should be fixed in the design-system `AppShell` before the dossier is claimed usable on
mobile.
