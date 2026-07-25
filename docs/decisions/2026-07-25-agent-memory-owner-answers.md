# Agent-memory dossier — owner answers, first pass (2026-07-25)

Status: **direction, NOT a ratified decision.** This records what the owner answered on the
first pass over the Focus decision dossier `/dossier/agent-memory`
(revision `agent-memory-2026-07-24`), so the reasoning survives outside one browser's
`localStorage` and the dossier can be **replayed** later against the same answers.

- The dossier itself (questions, options, benchmark matrix) is committed at
  `apps/focus/src/lib/server/agent-memory-dossier.ts` — it is the replayable fixture.
- The machine-readable answer set is `2026-07-25-agent-memory-owner-answers.json`
  (same directory), keyed by decision id and option key so it can be loaded back into the page.
- Notes are reproduced **verbatim, in the owner's words (French)**. Paraphrasing them would
  corrupt the capital: the note is the reasoning, the selection is only its label.

## The target model this dossier serves

A persistent agent = **a MEMORY** (the durable thing) + one or more **ephemeral sessions**
that consume it, shared across several CLI agents (claude/codex/gemini/hermes), multi-session,
local-first under RAM/OOM constraints. The dossier is neutral by construction: no option is
marked recommended, and each card names a criterion to weigh rather than a pick.

## Answers

| # | Question | Selected option | Option key |
|---|---|---|---|
| D1 | Nature of the memory | Hybrid: curated corpus + live capture, in distinct layers | `hybride` |
| D2 | Structure of the substrate | Corpus ontology graph | `graphe-ontologique-corpus` |
| D3 | Who decides a fact enters memory | Automatic extraction **with an approval gate** | `ecriture-gatee` |
| D4 | Reconciling contradictory facts | Bi-temporal reconciliation | `bi-temporelle` |
| D5 | Hosting under the RAM/OOM constraint | Embedded, local-first | `embarque-local` |
| D6 | Concurrent multi-CLI writes | Safe concurrent writes (CRDT / append-log) | `crdt-append-log` |
| D7 | Which project is "ctx" | ActiveMemory/ctx (Go) | `activememory-ctx` |

### Notes (verbatim)

**D1** — "Zep/Graphiti ressemble a ce qu'on fait avec graphify. on pourrait donc utiliser a la
fois graphify pour la mémoire d'archive et la capture vivante. cependant tu ne m'as pas présenté
comment hermes fait ou d'autres, il faut plus de détail"

**D2** — "J'aimerais une approche hybride de graphe entre ontology et bi-temporel - la
bi-temporalité pourrait être une forme de gestion de mémoire longue au dela de la journée ou
simplement du dépassement de contexte (avec des prehook de compaction, l'idéal ?)"

**D3** — "j'imagine des sessions via h2a focus pour la révision de mémoires."

**D4** — "on repose a maxima sur graphify pour cela (évolution bi temporelle a co-design)"

**D5** — "il faut pouvoir reposer sur local first et permettre la capitalisation. graphify embarque
un backend db et pourrait être configuré pour l'usage d'une tierce db, surtout lorsque h2a devient
intégré a sentropic, version web"

**D6** — "j hesite entre 1 et 2. peut être 2 avec opt in 1 dans un deuxieme temps"

**D7** — (none)

## Tensions and gaps recorded deliberately

These are kept explicit so a replay does not silently lose them.

1. **D6 selection vs note.** The selected option is CRDT/append-log, but the note says the owner
   hesitates and would perhaps take **namespace + single-writer first, with CRDT opt-in in a
   second step**. The note is the more considered position; the selection should not be read as
   settled. Treat D6 as OPEN.
2. **D1/D2 point past the option list.** The owner does not want one archetype but a **composition**:
   graphify serving both archive memory and live capture (D1), and a graph that is **both
   ontology-typed and bi-temporal** (D2). Neither is an option as written — the dossier's options
   are archetypes, and the answer is "combine C and B". That composition is unproven and is the
   real design question.
3. **D2 introduces an idea the benchmark never covered**: bi-temporality as *long-memory
   management* triggered at **compaction boundaries** ("prehook de compaction"), i.e. consolidate
   what is about to be dropped from context. Prior art for compaction-as-consolidation-boundary
   was not in the first benchmark.
4. **D3 names a surface, not just a policy**: memory review through **h2a Focus sessions** —
   a human-in-the-loop approval queue for memory writes.
5. **Explicit research gap the owner flagged (D1)**: the first benchmark did not show *how*
   Hermes (or others) actually works, only what it is. Mechanism-level detail was requested.

## Replay

To replay this dossier with these answers: serve Focus, open `/dossier/agent-memory`, and load
the answer set from the JSON next to this file. The dossier is revision-scoped
(`agent-memory-2026-07-24`); if the revision changes, a replay must state which decision keys
still exist rather than dropping answers silently.

### Carry-over into revision 2 (`agent-memory-2026-07-25`)

The dossier has since moved to revision `agent-memory-2026-07-25`. **This answer set is not
orphaned, and the JSON below is unchanged on purpose** — it is the fixture the replay checkpoint
loads, so rewriting it would destroy the very thing it proves.

- D1..D7 keep their decision keys **and** their option keys in revision 2. Their text was enriched
  with mechanism-level detail; nothing was re-keyed. A replay therefore applies **7 of 7** answers,
  with 0 missing decisions and 0 stale options.
- The revision string differs, so the page shows a revision-mismatch warning. That warning is
  correct and must stay: the answers *were* captured against the older revision. It is accompanied
  by an explicit carry-over statement so a mismatch is not read as a loss.
- Revision 2 adds D8..D13, which this answer set does not cover. The replay report names them
  rather than letting a "successful" replay imply the whole dossier is answered.

The six added cards come from these very answers — they card the compositions the answers pointed
at, which were not options in revision 1: graphify as both archive and live sink (D8, from D1+D4),
one graph both ontology-typed and bi-temporal (D9, from D2+D4), the write trigger behind
"prehook de compaction" (D10, from D2), the pending-memory tier behind a Focus review session
(D11, from D3), the single-writer-then-CRDT migration (D12, from D6), and one card nobody raised:
whether this dossier supersedes or extends the prior local design seed (D13).

See also `docs/uat/2026-07-25-focus-agent-memory-dossier.md`, which uses this same dossier as the
acceptance scenario for Focus releases.
