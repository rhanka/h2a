# Decision-dossier presentation format (owner-validated)

The owner validated this format on 2026-08-03 as the **template for presenting mature owner
decisions** — a self-contained Focus surface, accessible **without a claude session** (the owner
cannot reach claude-remote on their second machine; sentropic is to become the primary work tool).

## The rule the owner enforced

A decision dossier presents the **substance**, not the process. The rejected first draft summarized
process only ("3 perspectives reviewed it, 4 counters resolved, trust us"). The owner's correction:

> présente les jeux, pas seulement pour le projet, mais du fond des décisions de spécification qui
> ont été prises. soit la spec est incluse commentée, avec les revues faites par chaque reviewer.

So a decision dossier MUST carry:

1. **Each specification decision, commented** — what it decides, its subject, and its **risk**.
2. **The real review of each reviewer** — what each one actually said (verdicts, counters, findings),
   never "everyone reviewed it".
3. **The honest open stakes** — what is deferred, reserved, or gated; and **what signing does NOT
   deliver** (here: signing the contract does not deliver the data feed, gated on BR-39l).
4. **The real object of the signature** — the substantive question the owner alone settles (here: the
   LIB/INTEGRATION boundary + deferring the data), not "the counters are resolved".
5. **No forced decision** — the dossier presents; it does not ask the owner to sign. Signing is a
   separate owner act, on the owner's terms. (Do NOT turn "show me the presentation" into "make me sign".)

## Committed example (replayable)

- `docs/focus/2026-08-03-d6-agents-surface-decision-dossier.html` — the D6 slice-a agents-surface
  fusion decision dossier. Self-contained HTML (light/dark themes, FACT/JUDGMENT tags, per-reviewer
  reviews, risk callouts, honest stakes). Open it in a browser to replay the demo.

## Precedent

The `agent-memory` decision dossier is the Focus release acceptance scenario, committed to be
replayed: `docs/uat/2026-07-25-focus-agent-memory-dossier.md` (page
`apps/focus/src/routes/dossier/agent-memory/`, fixture
`apps/focus/src/lib/server/agent-memory-dossier.ts`, replay answers
`docs/decisions/2026-07-25-agent-memory-owner-answers.json`).

## Next step (capitalize for Focus)

This static HTML is the immediate replayable artifact. The durable capitalization — routed to the
Focus/feed lane — is to render this dossier as a **native Focus scenario** (Svelte route + fixture +
replay JSON), like `agent-memory`, so it becomes a reusable, live-replayable decision surface —
and, per owner direction, presentable **inside sentropic (in a workspace)**, built in parallel with
conversation restitution (the sessions build).
