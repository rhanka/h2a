# Agent-memory dossier — owner answers, second pass (2026-07-25)

Status: **owner direction, NOT a ratified design.** This is the second answer record for the
Focus decision dossier `/dossier/agent-memory`, revision `agent-memory-2026-07-25`. It records
the newly answered D8–D13 cards and the owner's amendments to D2–D6 before either corpus is
merged.

- The first-pass D1–D7 answer set remains committed, unchanged, at
  `2026-07-25-agent-memory-owner-answers.{md,json}`. It is the replay fixture used by the Focus
  UAT and is not replaced by this record.
- The dossier itself remains committed at `apps/focus/src/lib/server/agent-memory-dossier.ts`.
  This second pass does not rewrite that replayable artefact.
- The machine-readable companion is `2026-07-25-agent-memory-owner-answers-v2.json`.
- Every note below is reproduced **verbatim, in the owner's words (French)**. The note is the
  reasoning; the selected option is only its label.

## New answers

| # | Question | Selected option | Option key |
|---|---|---|---|
| D8 | Jusqu'où graphify porte-t-il à la fois la mémoire d'archive et la capture vivante ? | Un seul substrat : graphify devient aussi le puits vivant | `graphify-substrat-unique` |
| D9 | Un même graphe à la fois typé par une ontologie et bi-temporel | Construire la reconciliation d'assertion | `detecteur-assertions` |
| D10 | Qu'est-ce qui déclenche une écriture en mémoire longue ? | Compte de tours, ou silence debounce | `compte-de-tours` |
| D11 | Statut d'une mémoire capturée mais pas encore revue | Garder la porte binaire, mais reduire ce qui atteint l humain | `reduire-la-surface` |
| D12 | Migration du mono-écrivain aux écritures concurrentes sûres | Le journal fait foi, le graphe est une projection | `journal-plus-fold` |
| D13 | Le dossier supersède-t-il ou étend-il la conception locale antérieure ? | Fusionner les deux en un seul document, et le sortir du scratch. | `fusionner-en-un-document` |

### Notes (verbatim)

**D8** — "graphify doit pouvoir continuer a jouer le role qu'elle joue aujourd'hui + le role de memoire vivante selon le contexte d'utilisation."

**D9** — "in claro: on va adopter ontologie + bi temporalite avec contradiction, comme graphifi, mais dans graphify, et graphify sera couche vivante version a froid."

**D10** — "Je n'ai pas de conviction, j'ai choisi ce qui me semblait le plus evident. Mais ca pose des questions sur les \"/rewind\" par exemple. et sur l'articulation avec le commit. Dans ce mode, il faudra probablement preconiser de ne plus commiter le graph avec le repo, ou bien changer le mode de commit. J'aime bien quand meme avoir la memoire commitee, mais on risque d'avoir plusieurs roles d'agents avec des memoires distinctes (cf les roles dans sentropic: architect, conductor, llm-mesh, cowork, sentropic-chat, sentropic-app etc). dans ce cas si on commit il faut avoir les mecanismes de reconciliation live vs commit + potentielle mutualisation de memoire inter-agents (une couche h2a par dessus graphify)"

**D11** — "utiliser le principe de double consensus. avec des agents de haut grade (consenus 5.6 terra xhigh, opus 5 xhigh suffisant)"

**D12** — "tu m'a un peu dissuade d'un CRDT j'ai donc choisi l'option par defaut de journal"

**D12, note (suite)** — "cependant tu as critique automerge pas GUN. ce serait peut etre a approfondir, mais avec decision par defaut de journal"

**D13** — (none)

## Amendments to the first-pass notes (verbatim)

These are additions to the historical D1–D7 record, not edits to it. A reader or replay must keep
the original note and this amendment together.

**D2** — "Il faudra mener la correction a la contradiction identifiee dans graphify"

**D3** — "inspire toi des meilleurs mecanismes qu on implementera dans graphify. il est important de confier l etude et le dossier de decision integral a graphify pour qu il dispose du meme point de depart"

**D4** — "il faut ajouter un algo de reconciliation d assertion a graphify c est parfaitement ce que je souhaitait lire. S inspirer de graphifi / cognee et donner ces elments d analyse a graphify"

**D5** — "update note v2: si le backend db n est pas encore en rw il faut demander la completion pour les besoin de la memoire / knowledge"

**D6** — "pour les limites en max graph bytes de graphify: il faut probablement lever une etude d options pour lever cette limite quand on ira a la specification avec graphify"

## Deliberately open

D10 is not a settled mechanism. Its selected label records the option clicked, while its note says
explicitly: "Je n'ai pas de conviction". The merged design must therefore carry the trigger, `/rewind`,
commit mode, per-role memories, live-versus-commit reconciliation, and possible h2a mutualisation as
open questions rather than silently promoting the label into a decision.

## Replay relationship

The Focus UAT continues to replay the original D1–D7 JSON fixture against the thirteen-card dossier.
This v2 record is an additional provenance artefact. It does not change the dossier revision, option
keys, original answers, UAT scenario, or either UAT run report.
