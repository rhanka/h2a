# Contextual track report — rendered by the agent in session, not by a remote model

Status: **proposed**. Companion examples:
`docs/specs/examples/track-report-raw.txt` (deterministic output, captured verbatim)
and `docs/specs/examples/track-report-contextual.md` (the reference rendering).

## 1. The defect

Before this change, `track report` spawned an adapter (`h2a report-ai`) which called a gateway
and a model, then printed a narrative: SUMMARY / FACTS / RECENT CHANGES / ACTIVE WORK /
BLOCKERS / OWNER DECISIONS / AI SUGGESTIONS / UNCERTAINTY. The normal command is now a local,
deterministic renderer; the adapter remains a separately invoked legacy capability.

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

`track focus <decision-id> --workspace <workspace>` renders one decision dossier. Its workspace is
the decision's stored workspace, not the current-directory workspace. A mismatch is an error.

```
1/6 — Un nom de session peut-il envoyer une commande ?
Choix A : … Choix B : … Recommandation : A — …
Outcome [decision]: PENDING
```

For a structured dossier, alternatives and a recommendation are stored fields; option title/summary is the
only stored explanatory text surfaced by the deterministic route. There is no separate machine-readable
effect field. A historical prose-only dossier is explicitly `unstructured`; prose is never parsed to
manufacture a choice set.

So the report's structured **DÉCISIONS** section and `track focus` are **the same stored data in two
renders**: inline when the owner wants the whole picture, one dossier per screen when he wants to
decide. Switching to focus mode must never re-derive anything. An unstructured dossier belongs in
À-FAIRE as work to structure, not in DÉCISIONS.

**Consequence for the store:** the triplet must be structured fields, not a prose blob. Parsing
free text is forbidden: it silently produces an empty or invented cell when wording changes. The
read surface exposes `structure: structured|unstructured` so the renderer can say which case it has
without inspecting prose.

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
launch, what each answer unblocks, and any executor context the owner supplied. The log does not
record a model or reasoning effort; the report must name that missing context rather than invent it.
The owner must be able to reply
`vas y`, or `D1 A · D2 B · …`, and have work start.

## 5. Where this stops holding

The agent can still write a poor synthesis inside a cell, and no structure prevents that.
What the structure does guarantee is that no WP disappears, that no rule-derived prompt is
promoted to a decision, and that the report renders with the network down.

The deterministic route does not parse choices or a recommendation from a prose `context`.
An unstructured dossier remains visibly incomplete until an authorized writer records structured fields.

## 6. Disposition of the AI adapter

Not removed by this change — that is a separate decision with its own blast radius. What
this change does is make it UNNECESSARY: the contextual rendering no longer depends on it.

`report-ai` is now an explicit legacy command, not a `track report` dependency. Its adapter-specific
configuration and flags remain outside the deterministic report contract; do not use them as a report
fallback or document them in the report skill.

## 7. Deferred follow-up — enforce structured decisions at write time

Status: **not implemented by this change**. The deterministic read/render path now classifies existing
records as `structured` or `unstructured` and never parses prose. It does not change the decision model,
the outcome enum, `decision new`, or focus answer handling. The following is a future write-model proposal,
not a current CLI contract.

Owner rule, 2026-07-28: **never present a decision that has no alternatives and no
recommendation.** One without them asks the owner to invent the options himself, which is
the work the decision was supposed to save him.

Today that rule cannot be enforced, and the consequence is measurable:

```ts
export type Outcome = 'pending' | 'go' | 'no-go' | 'deferred'
```

There is no option in the store, so **an answer of "D1 A" cannot be recorded**. It lives in
the chat and, at best, as prose in a dossier. That is why eight decisions have been
`PENDING` for days: nothing can move them except `go`/`no-go`/`deferred`, and none of those
means "I chose A".

### Proposed changes

**Model.** A decision would carry `options: [{ key, label, effect? }]` and `recommendation: key`.
`Outcome` would gain a chosen-option form, so settling a decision names the alternative rather
than collapsing it to a boolean.

**Creation would be fail-closed.** `decision new` would require at least two options and a
recommendation. Refusing to create an optionless decision would be the enforcement; a convention
that one should add options is a habit, and habits get skipped — which is exactly how the
current eight came to exist.

**`track focus`** would render the structured options instead of a prose blob, and accept an
answer by key.

**The report** already renders stored options inline in DÉCISIONS and never parses free text:
a prose-only historical dossier is rendered as `unstructured`, so the report cannot silently
pretend that a written phrase is a recorded alternative.

**Migration.** The log would remain append-only and would not be rewritten. Existing decisions keep their
prose `context` and render as `unstructured`. New write-time validation would apply only after the migration;
there would be no backfill or invention of options nobody chose.

### Impact, both ways

| | Doing it | Not doing it |
|---|---|---|
| Cost | Model + CLI + focus render + report render; a migration that adds fields without rewriting history | Zero |
| Gain | An answer becomes an EVENT. The decision loop closes inside the record | — |
| Risk | Fail-closed creation will reject scripts that create decisions without options — intended, but it will break callers | **Decisions stay `PENDING` forever.** The owner answers, work proceeds, and the record still says nothing was decided — the gap between committed work and the tracked state that this repository keeps rediscovering |
