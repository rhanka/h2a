# UAT — Focus decision dossier (agent-memory)

Purpose: the `agent-memory` decision dossier is the **acceptance scenario for Focus releases**.
It is committed, so it can be replayed; it exercises the whole decision-support surface (swipeable
cards, neutral presentation, notes, export, hand-off to a live CLI, a wide benchmark table); and
every defect the owner reported on it is listed below as a regression checkpoint that must not
come back.

- Dossier fixture: `apps/focus/src/lib/server/agent-memory-dossier.ts` (revision `agent-memory-2026-07-25`,
  which supersedes `agent-memory-2026-07-24` **without orphaning it**: D1..D7 keep their keys and their
  option keys, so the committed answer set below still replays in full)
- Page: `apps/focus/src/routes/dossier/agent-memory/`
- Owner answers to replay: `docs/decisions/2026-07-25-agent-memory-owner-answers.json` (captured against
  revision `agent-memory-2026-07-24` — the revision mismatch is expected and must be reported, not hidden)
- Hand-off precedent: `apps/focus/src/routes/api/decisions/inject/` (the live-CLI deposit used by the root
  page). NOTE: an earlier draft of this document cited `apps/focus/src/routes/dossier/session-safety/` as the
  reference implementation. That path is **untracked working-tree work — it exists in no commit and on no
  branch**, so it cannot serve as a reference. The shared resolution logic now lives in
  `apps/focus/src/lib/server/h2a-bus.ts`, used by both the inject and the dossier include routes.

## How to run

`apps/focus` is excluded from the root npm workspaces and has its own lockfile, and its SSR build
needs `@sentropic/track` built:

```
npm run build -w @sentropic/track     # from the repo root
cd apps/focus && npm ci && npm run dev
```

Then open `/dossier/agent-memory`. Run the checkpoints below in order. Pass = all CRITICAL
checkpoints hold; a failing CRITICAL checkpoint blocks the release.

## Checkpoints

### A. Content integrity (CRITICAL)
- A1. The thirteen decisions D1..D13 render, each with its question, why-now, options, criterion and
  next-work. D1..D7 are the original seven (kept, enriched, never re-keyed); D8..D13 were added in
  revision 2 and carry a "Nouvelle carte (révision 2)" badge.
- A2. **No option is presented as recommended.** The dossier is neutral by construction; the
  per-card field is a criterion to weigh, never a pick. A "Recommandée" badge appearing on an
  agent-memory option is a failure.
- A3. The benchmark matrix renders all approaches and columns.
- A4. **Mechanism detail is on the card, not in an appendix** (added revision 2, answering the owner's
  "il faut plus de détail"). Every decision card renders a "Comment ça marche réellement" list, and every
  entry carries a source (research section + file:line, issue, or arXiv id) that makes it checkable.
- A5. **Unverified claims are marked as such.** A mechanism fact the research could not establish at
  primary source renders a "Non vérifié" badge, and cards carry a "Ce que nous n'avons pas pu établir"
  section. Presenting an unverified claim as fact is a failure — the honest gap is the point.
- A6. **Corrections are visible, never silent.** The leading state-of-the-art card lists what the previous
  revision asserted and what the mechanism research found instead (Hermes caps in characters not tokens and
  no LLM consolidation; Letta not last-writer-wins; ctx's "convergent" is not a CRDT and it does ship MCP;
  graphify already ingests transcripts). A rewritten matrix cell with no corresponding entry is a failure.
- A7. Round-2 cards quote the owner's own answer **verbatim** ("Découle de votre réponse à …"). A paraphrase
  in that block is a failure: the note is the reasoning, and a card built on our paraphrase of him is not
  his decision. D13 legitimately has no quote — it is the card nobody raised.

### B. État de l'art placement (CRITICAL — regression, reported 2026-07-25)
- B1. The state of the art is the **first page** of the deck and carries **no decision**. It was
  previously a section at the bottom of the page, which the owner reported as counter-intuitive.
- B2. The progress counter does not lie: the leading state-of-the-art slide is not numbered as a
  decision; the decisions are numbered after it.
- B3. The matrix scrolls horizontally **inside its own container**. The page body must never scroll
  horizontally, at any viewport width.

### C. Notes (CRITICAL — the affordance must exist and persist)
- C1. Every decision card has a free-text note field. (Before 2026-07-25 the UI called the option
  *selection* "une note personnelle" while offering no note field — an interface must never promise
  an affordance it does not provide.)
- C2. Typing a note then **reloading** the page restores it (revision-scoped browser storage).
- C3. **Regression, reported 2026-07-25**: the note field spans the full width of the card. The
  design-system field caps width at `28rem` by default and must be overridden from the consumer,
  never by editing the component.
- C4. Dragging horizontally **inside** the note selects text and does **not** page the card. The
  swipe gesture must never steal typing or selection.

### D. Layout (CRITICAL — regression, reported 2026-07-25)
- D1. A short card shows **no dead vertical space** before the navigation controls. The slides used
  to sit side by side in one flex track, making the viewport as tall as the tallest card, so every
  shorter card displayed the difference as a large empty gap.
- D2. Swipe, the slide indicator and the Précédente/Suivante buttons all navigate, including to and
  from the leading state-of-the-art slide.
- D3. Non-active slides stay `inert` / `aria-hidden` (no focus traps, no hidden tab stops).
- D4. `prefers-reduced-motion` is honored.

### E. Hand-off — export and include (CRITICAL — regression, reported 2026-07-25)
- E1. **Include into a live CLI** exists per decision, mirroring the `/api/decisions/inject` precedent.
  Its absence in agent-memory was a regression: the owner had to fall back to copy-paste.
- E1b. Served from a git worktree, `projectName()` resolves the project from the directory basename, so it
  finds no live session. Run this checkpoint from the primary checkout, or expect the honest no-live-CLI
  warning rather than a delivery.
- E2. The include payload carries the owner's **note**, not only the selected option. The note is
  the reasoning and is the most valuable part.
- E3. With no live CLI for the project, the UI says so plainly (a warning) instead of claiming a
  delivery that did not happen.
- E4. "Copier ma synthèse" copies markdown with every decision, its selected option and its note.
  Both paths stay available: clipboard goes anywhere, include goes into a live CLI.
- E5. Neither path records a permanent Track decision. This dossier informs a choice; it does not
  settle one.

### F. Replay (CRITICAL)
- F1. The committed answer set (`docs/decisions/2026-07-25-agent-memory-owner-answers.json`) can be
  loaded back into the dossier, restoring selections **and** notes. On revision
  `agent-memory-2026-07-25` this must restore **all seven** D1..D7 answers: 7 applied, 0 missing
  decisions, 0 stale options.
- F2. If the dossier revision has changed, a replay states which decision keys no longer exist
  rather than dropping answers silently.
- F3. **A revision bump states what carries over** (added revision 2). Before the replay control, the page
  names how many decisions were kept from the previous revision and how many were added, so the reader can
  see that a revision mismatch is not a loss. A bump that orphans a committed answer set silently is a
  failure.
- F4. **A replay is honest in both directions** (added revision 2): besides answers that could not be
  replayed, it names the decisions of *this* revision that the answer set does not cover (D8..D13), so a
  "successful" replay never implies the whole dossier is answered.

### G. Theme and viewport
- G1. Readable in both light and dark theme; no hardcoded colors (design-system tokens only).
  **The light/dark half is currently not satisfiable and must not be scored as a pass**: the app pins a
  single hardwired theme (`<ThemeProvider theme={entropicTheme}>` in `src/routes/+layout.svelte`) and the
  served CSS contains **0** `prefers-color-scheme` rules, so emulating a dark OS preference changes no
  measured colour. Report it as a missing capability (a Focus/design-system gap), not as a checkpoint
  failure of whatever change is under test. Only the token half — zero hardcoded colour literals — is
  scoreable today.
- G2. Usable at a narrow mobile width: no horizontal body scroll, controls reachable, note usable.

## Gates for a Focus release

- `npm run lint`, `npm run check`, `npm run build` in `apps/focus` all pass.
- **`npm run check` must be clean.** Corrected 2026-07-25 (run 1, re-confirmed run 2): this document
  used to name three pre-existing errors to "confirm unchanged" — two in `src/lib/track-model.ts`
  (`@sentropic/track/report/friendly` unresolved) and one cascading in `src/routes/+page.svelte`.
  Those errors **only occur when `@sentropic/track` is not built**, which the "How to run" section
  above already forbids. With `@sentropic/track` built, `svelte-check` reports **0 errors / 1 warning
  over 523 files**; the single warning is `src/routes/+page.svelte:21:17 state_referenced_locally`,
  pre-existing and unrelated to the dossier. The bar is therefore **0 errors**, not "0 new errors on
  top of 3".
- A release must add **zero** new problems.
- The checkpoints above are run against a served build, not inferred from the source.

## History

- 2026-07-24 — dossier created (7 decisions, 23 options, none recommended; benchmark matrix).
- 2026-07-25 — real per-decision notes added, after the UI was found to promise notes it did not
  provide.
- 2026-07-25 — owner ran the dossier for real and reported four form defects: no include-to-CLI,
  state of the art placed last, note not full width, large dead space under short cards. They are
  checkpoints B1, C3, D1 and E1 above.
- 2026-07-25 — **revision 2** (`agent-memory-2026-07-25`, focus 0.3.0). The owner answered all seven
  decisions with substantive reasoning and flagged one gap explicitly — the first benchmark never showed
  *how* Hermes or the others actually work. Revision 2 answers it (mechanism facts on the cards, with
  sources and with unverified items marked) and turns his answers into six new cards: D8 graphify as both
  archive and live sink, D9 one graph both ontology-typed and bi-temporal, D10 the write trigger given that
  `PreCompact` cannot inject, D11 the pending-memory tier behind a Focus review session, D12 the
  single-writer-then-CRDT migration, D13 whether this dossier supersedes or extends the prior local design
  seed in graphify's gitignored scratch directory. New checkpoints: A4, A5, A6, A7, F3, F4. The revision
  bump deliberately keeps D1..D7 keyed identically so the committed answer set is not orphaned.
- 2026-07-25 — **G2 fixed** (focus 0.3.1). The dossier rendered blank and unscrollable at every width
  ≤ 768 px because the design-system `AppShell` gives `.st-appShell__main` a zero `flex-basis` that starts
  applying on the block axis once its own `max-width: 48rem` rule turns `.st-appShell__body` into a column.
  Corrected from the consumer in `apps/focus/src/app.css` (block-axis basis restored at that breakpoint
  only) — the component is not forked. Run 2 records the measurements.
