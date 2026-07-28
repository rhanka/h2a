# Contextual track report — rendered by the agent in session, not by a remote model

Status: **proposed**. Companion examples:
`docs/specs/examples/track-report-raw.txt` (deterministic output, captured verbatim)
and `docs/specs/examples/track-report-contextual.md` (the reference rendering).

## 1. The defect

`track report` today spawns an adapter (`h2a report-ai`) which calls a gateway which
calls a model, and prints a narrative: SUMMARY / FACTS / RECENT CHANGES / ACTIVE WORK /
BLOCKERS / OWNER DECISIONS / AI SUGGESTIONS / UNCERTAINTY.

Three things are wrong with that, and only the third is about taste.

**It was never asked for.** The owner's request, repeatedly, is that the agent already
running the command reformulates the deterministic table. A second model was nobody's
requirement.

**It is a four-link chain, and every link broke in one day**: `adapter-nonzero` with the
child's stderr discarded; `readFileSync(0)` returning `EAGAIN` on a 160 KB envelope;
a model id the gateway does not serve; an OAuth token expired at 13:39 while the process
kept reporting `status: active` with `modelIds: []`. A report that cannot be produced
when the network is down is not a report.

**It REPLACED a better rendering.** `formatWpConductor` — FAIT / À-FAIRE / DÉCISIONS-ACTIONS,
still present in `packages/track/src/report/format.ts` — is reachable only through the
legacy MCP projection. Its cells already carry the real item titles. The narrative
substituted README paraphrase for them, because `degraded sources: git:truncated` starves
it of the actual history: **the AI layer describes the documentation because it cannot see
the work**.

Worse, the flags lie in two directions: `--wp`, `--decisions` and `--format text` are
ACCEPTED AND IGNORED on the AI path, and REJECTED on `--raw`. An option that claims a
capability it no longer has is worse than a removed one.

## 2. What replaces it

The deterministic layer stays exactly as it is — it is correct, and the owner said so.
The contextual rendering is produced **by the agent already in the conversation**, from
that output plus what the session knows. No subprocess, no gateway, no model call, no
network. This is a skill, not a pipeline.

The skill is `packages/h2a/skills/harness/track-report/SKILL.md`.

## 3. Alignment with `track focus` — same data, two renders

This is the load-bearing part of the design, and it was nearly missed.

`track focus <decision-id>` already renders, per decision:

```
1/6 — Un nom de session peut-il envoyer une commande ?
Choix A : … Choix B : … Recommandation : A — … Effet : débloque le lot adressage sûr.
Outcome [decision]: PENDING
```

Alternatives, recommendation AND effect **already exist** in the dossier. They are merely
flattened into one prose `context` string.

So the report's DÉCISIONS section and `track focus` are **the same data in two renders**:
inline as a table when the owner wants the whole picture, one dossier per screen when he
wants to decide. Switching to focus mode must therefore never re-derive anything — it
renders the same `Choix / Recommandation / Effet` triplet, one at a time.

**Consequence for the store, and it is the only structural change worth making:** that
triplet should be structured fields, not a prose blob. While it is prose, the table render
must PARSE it, and a parser over free text is a habit dressed as a mechanism — it will
silently produce an empty cell the day someone writes the context differently. Recorded
here as a follow-up rather than smuggled into this change.

## 4. Rules the rendering must respect

**Every WP appears.** A workpackage present in the rollup is a row whether or not it is
interesting. When the AI chose which WPs to mention, absence carried no information.
Structure comes from the log; only prose comes from the agent.

**A decision is not a rule-derived prompt.** The raw layer emits
`[focus-decision] décision: Instruire le dossier puis trancher` automatically whenever an
item has an open blocker. Nobody framed a choice. Rendering those as "Pending owner
decision" tells the owner he is the bottleneck when there is nothing yet to arbitrate.
Only a decision with actual alternatives belongs in DÉCISIONS; the rest is À-FAIRE.

**No counts where substance is needed.** "5 rerun-acceptance actions" says nothing. WHICH
items, and why it matters — those five are completed items whose acceptance went stale, so
they cannot serve as release evidence. That is the sentence worth printing.

**Focus is an ordering, not a column.** The priority WPs are the first rows. A dedicated
column holding `①②③ / dette / —` is noise.

**Markdown tables cannot hold a line break.** `<br>` renders literally in a terminal. Any
cell needing several lines — the alternatives — must be a DRAWN table inside a fenced
block, which is what `formatWpConductor` already does.

**RECOMMANDATION is an executable plan**, conditioned on the decisions: which lanes to
launch, on which model, and what each answer unblocks. The owner must be able to reply
`vas y`, or `D1 A · D2 B · …`, and have work start.

## 5. Where this stops holding

The agent can still write a poor synthesis inside a cell, and no structure prevents that.
What the structure does guarantee is that no WP disappears, that no rule-derived prompt is
promoted to a decision, and that the report renders with the network down.

The `Choix / Recommandation / Effet` parsing over a prose `context` is the weakest link and
is named as such above.

## 6. Disposition of the AI adapter

Not removed by this change — that is a separate decision with its own blast radius. What
this change does is make it UNNECESSARY: the contextual rendering no longer depends on it.

Follow-up, recorded not done: make `report-ai` opt-in rather than mandatory, and reconcile
the flags so `--wp` and `--decisions` mean the same thing on both paths or are rejected on
both with a message naming what replaced them.
