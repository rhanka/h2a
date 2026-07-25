# UAT — Focus decision dossier (agent-memory)

Purpose: the `agent-memory` decision dossier is the **acceptance scenario for Focus releases**.
It is committed, so it can be replayed; it exercises the whole decision-support surface (swipeable
cards, neutral presentation, notes, export, hand-off to a live CLI, a wide benchmark table); and
every defect the owner reported on it is listed below as a regression checkpoint that must not
come back.

- Dossier fixture: `apps/focus/src/lib/server/agent-memory-dossier.ts` (revision `agent-memory-2026-07-24`)
- Page: `apps/focus/src/routes/dossier/agent-memory/`
- Owner answers to replay: `docs/decisions/2026-07-25-agent-memory-owner-answers.json`
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
- A1. The seven decisions D1..D7 render, each with its question, why-now, options, criterion and
  next-work.
- A2. **No option is presented as recommended.** The dossier is neutral by construction; the
  per-card field is a criterion to weigh, never a pick. A "Recommandée" badge appearing on an
  agent-memory option is a failure.
- A3. The benchmark matrix renders all approaches and columns.

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
  loaded back into the dossier, restoring selections **and** notes.
- F2. If the dossier revision has changed, a replay states which decision keys no longer exist
  rather than dropping answers silently.

### G. Theme and viewport
- G1. Readable in both light and dark theme; no hardcoded colors (design-system tokens only).
- G2. Usable at a narrow mobile width: no horizontal body scroll, controls reachable, note usable.

## Gates for a Focus release

- `npm run lint`, `npm run check`, `npm run build` in `apps/focus` all pass.
- Known pre-existing `npm run check` errors, unrelated to the dossier: two in
  `src/lib/track-model.ts` (`@sentropic/track/report/friendly` unresolved when `@sentropic/track`
  is not built) and one in `src/routes/+page.svelte` (`FriendlyTone` indexing, which cascades from
  the first two). A release must add **zero** new errors; it is not required to fix these.
- The checkpoints above are run against a served build, not inferred from the source.

## History

- 2026-07-24 — dossier created (7 decisions, 23 options, none recommended; benchmark matrix).
- 2026-07-25 — real per-decision notes added, after the UI was found to promise notes it did not
  provide.
- 2026-07-25 — owner ran the dossier for real and reported four form defects: no include-to-CLI,
  state of the art placed last, note not full width, large dead space under short cards. They are
  checkpoints B1, C3, D1 and E1 above.
