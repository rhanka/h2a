---
name: track-report
description: Render owner requests as the five-column Track status table, preserving decision questions, consequences and dossier links.
---

# Owner status report

Use the fresh binary built in this checkout, never an installed h2a executable:

```bash
npm ci
npm run build -w @sentropic/track
track_bin="$(pwd -P)/packages/track/dist/cli/bin.js"
node "$track_bin" report --status-table --format md
node "$track_bin" report --status-table --format json
node "$track_bin" decision ls --outcome pending --format json
```

All three reads are local, deterministic projections of the log. No model, gateway or native host is
consulted. `--track-dir <directory-containing-events.jsonl>` redirects reads AND writes; only use read
verbs on an owner's register. `--scope <container-id|code|label>` selects a subtree, including nested
requests and their pending decisions, in text, Markdown or JSON. Capture the journal head and acceptance
baseline. A selected period labels the evidence window; the status table always shows current requests,
including completed and suspended requests. It does not silently omit an old request.

The owner report now uses `--status-table`. The earlier default four-section conductor remains available
for compatibility. This view replaces its FAIT / À-FAIRE activity tables with DEMANDES and retains
**DÉCISIONS** (including exact alternatives and recommendation) and **RECOMMANDATION**. Never remove the
decision expectations to make the table shorter. `--flat`, `--inline`, `--width`, `--raw`, `--level`,
`--resolve` and `--active-roster` cannot be combined with this view. Use the separate legacy report for
legacy handle resolution; `#` in the status table is an ordinal, not a durable handle. JSON row `id` is
the durable action identity.

## Exactly five columns

| # | Ta demande | Étape | Statut | Où ça en est / prochaine action |
| --- | --- | --- | --- | --- |
| 1 | Je veux retrouver mes agents (PR #42) | dev | 🔴 | La recette de reconnexion échoue. Proposition : corriger la résolution et rejouer cette recette. Ensuite : ouvrir le correctif. |

- **#**: most urgent first: blocked, owner decision, unforeseen issue, progressing; within a class,
  preserve canonical directive urgency, then priority, then stable item id. Do not reorder by version.
- **Ta demande**: the owner's purpose in their words. Prefer the event's `ownerRequest`, then the linked
  demand's immutable `raw.text`, then an explicitly labelled `Phrase owner : « … »` / `Phrases owner :
  « … »` quote in the item body (first quote, verbatim). Otherwise keep the historical title and flag
  its provenance in the action cell; investigate the actual quote before serving a contextual report.
  A version is never a subject. Versions and PR numbers support a purpose **in parentheses**. The
  renderer flags version/reference-only subjects `version-only-subject`; do not replace them with a
  fabricated purpose. Do not promote a delivery version into a new owner concern.
- **Étape**: only `spec`, `dev`, `PR`, `mergé`, `déployé`, as defined below. It is independent of color.
- **Statut**: exactly one of the four colors below, with no fifth color for waiting or suspension.
- **Où ça en est / prochaine action**: verified recorded facts first, then **« Ensuite : … »** naming
  the concrete next gesture. Include the observed commit, CI result and reviewer verdict only when
  actually checked; cite their evidence. `waitingOn` renders “En attente de …”; `suspended` renders
  “Suspendu : …” here. A lane wait uses the actual underlying color: blocked if it prevents progress,
  progressing if the planned wait is conforming; owner arbitration uses blue. Suspension is not a color.

## Étape is evidence, not a synonym for completion

| Étape | Meaning and derivation |
| --- | --- |
| spec | Request/specification work, no recorded implementation start or stronger structured evidence. `item.created`, spec transitions and a to-do realization stay here; “specified” alone does not mean dev. |
| dev | Implementation started (`realization.transition` to `in-progress`) or recorded done without delivery evidence. Done does not prove a PR, merge or deployment. A reopening returns old delivery evidence to dev until re-established. |
| PR | PR observed open; explicit stage event with evidence, or an item link with kind `pr-open`. A generic `pr` URL alone proves no state. |
| mergé | PR observed merged; explicit stage event with merge evidence, or item link kind `pr-merged`. CI success alone does not prove merge. |
| déployé | Deployment observed in a named target environment; explicit stage event with deployment receipt, or item link kind `deployed`. A release/tag/npm publication alone proves no deployment. |

`stage: {value, evidence}` on the latest `item.report-updated` overrides older creation links; evidence
is mandatory for PR/mergé/déployé. Otherwise the strongest explicit link kind wins, then realization.
`release` and `release-published` are supporting references only. Verify PR state through its provider
and deployment through its receipt before recording either; include state, commit/environment and
observation time in the evidence locator/description. Track records these assertions and their event
`at`/`by`; it never visits the URL or attests the external state. Old advanced-stage evidence preceding
a reopening is flagged and falls back to dev. Stage links are item-specific, never inherited from a WP.

## Exactly four colors

| Color | Meaning / obligation |
| --- | --- |
| 🟢 | Progressing and conforming, explicitly recorded as `progressing`. Absence of a blocker is not evidence of conformity. |
| 🟠 | Unforeseen issue (`unforeseen`); name the issue and its treatment. Legacy missing classification is a documentary issue: “statut de conformité non renseigné”, then verify and record it. |
| 🔴 | Blocked (`blocked`); **a concrete proposal is mandatory**. A missing proposal is flagged in the row and JSON (`missing-proposal`), never accepted as a conforming report. |
| 🔵 | Owner decision awaited (`decision-awaited`); exact question, options with each consequence, ≤2 minute reading summary, and clickable dossier link. |

Effective dependency/manual blockers or failed acceptance force red even over stale declared green.
Pending linked decisions force blue unless a separate blocker/failed acceptance forces red. Conflicts
are visibly flagged. Expectations for pending native decisions use the current dossier's subject/title,
options' titles/summaries, `readability.readingBudgetMinutes` and rendered-view artifact (or `dossier`
link). If absent, explicit expectations may fill the gap **only when question/options match**. The live
dossier wins; a settled dossier cannot remain a blue decision. Never infer options from prose context.

Every blue row must be answerable in two minutes: state the exact question, at least two distinct options,
the consequence of each, and the dossier link. `readingMinutes` must be >0 and ≤2, with a maximum of 400
summary words. This is a size/budget check, not proof of human comprehension. Missing presentation is
flagged `missing-decision-expectations`; complete the dossier before asking “ton GO”. Preserve the
existing **DÉCISIONS/attendus** and recorded recommendations; never turn a technical next action into an
owner decision. A blue row has “Ensuite : ton GO …”; execution waits for the actual answer.

## Persisting the new fields

Use `node "$track_bin" item report-set <item-id> --json '<object>'` only on a register you are authorized
to write. It appends **one `item.report-updated` event** on the existing item, preserving the integrity
chain. The event is a **full replacement**, not a patch: omitted fields clear prior report metadata;
`{}` resets metadata. It changes no realization, acceptance, priority or decision outcome. Supported keys:

```json
{
  "ownerRequest": "Je veux retrouver mes agents (PR #42)",
  "stage": {"value": "PR", "evidence": "PR #42 observed OPEN at commit abc, 2026-10-17; https://example.test/pr/42"},
  "status": "decision-awaited",
  "facts": "Le partage est à décider avant de finaliser la connexion.",
  "proposal": "Reprendre la connexion après le choix du propriétaire.",
  "decisionExpectations": {
    "question": "Partager ou isoler les connexions ?",
    "options": [{"label": "Partager", "consequence": "Une connexion commune."}, {"label": "Isoler", "consequence": "Une connexion par session."}],
    "dossier": "https://example.test/dossier/42",
    "readingMinutes": 2
  },
  "nextAction": "Ouvrir le correctif de connexion.",
  "waitingOn": "la piste de transport",
  "suspended": "reprise après arbitrage de capacité"
}
```

Historical events and hashes remain untouched; old items have no `report` field. Invalid declarations,
missing proposals, missing decision expectations and version-only purposes stay visible in text,
Markdown and JSON `statusTable.rows[].issues`. A renderer flag is an instruction to repair the report,
not a valid owner decision or permission to invent a fact. The skill's contextual synthesis adds only
facts it has independently checked, with provenance; it cannot claim a deterministic check verified prose.
