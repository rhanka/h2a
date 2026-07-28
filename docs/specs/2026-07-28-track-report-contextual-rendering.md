# Track report: deterministic conductor and advisory contextual prose

Status: **corrected after NO-GO review**. The reproducible input inventory is
`docs/specs/examples/track-report-raw.txt`; the corresponding non-narrative
golden is `docs/specs/examples/track-report-contextual.md`.

## Deterministic command contract

`track report` is a deterministic read of the folded log. It does not invoke a
report adapter, gateway, subprocess, or model.

- `text` and `md` default to the WP conductor when a WP forest exists; an empty
  or fully filtered forest uses the deterministic action fallback. `--flat` is
  the explicit legacy bucket-dump opt-out.
- `json` keeps its flat machine contract by default; `--wp` adds the WP tree and
  conductor view model. `--flat` is rejected for JSON because it would be a no-op.
- `html` is the deterministic conductor HTML fragment. It rejects `--flat`.
- `--wp --flat` is rejected in every format.

`formatWpConductor` renders ordinary text/Markdown tables; it does **not** add a
fenced block. A consumer that needs a fence owns that presentation choice.

The installed `/track` command describes this output as deterministic. It must
not call it “AI-prepared”.

## Decision record contract

The native model already has the required vocabulary:

```ts
Option { id, title, summary, pros?, cons? }
Dossier { context, options, qa, recommendation?: { optionId, rationale }, selectedOptionId? }
```

No second `{key,label,effect}` representation is introduced. A newly created or
revised dossier must have a string context, at least two distinct complete
options, and a recommendation for one declared option. The selected option may
be set only by `decision.option-selected`.

The enforcement applies at every write boundary:

1. `track decision new` requires `--options-json`, `--recommendation`, and
   `--rationale`; it no longer emits `options: []`.
2. `Track.createDecision` validates the dossier.
3. Neutral ingest `decision.create` maps to that validated facade.
4. `track decision dossier` and `Track.reviseDossier` validate a revision;
   neutral ingest `decision.dossier` maps to the same path.
5. In-repository fixtures that exercise a decision create/revise write use the
   native `Option` shape and recommendation. `packages/focus/tests/track.spec.ts`
   deliberately retains one read-only legacy dossier fixture so the Focus mapper
   continues to render pre-enforcement history; it never reaches a Track writer.

`track decision select <decisionId> <optionId> [--outcome go|no-go]` and neutral
ingest `decision.select` append `decision.option-selected` and the outcome in
one operation. The fold records `selectedOptionId`; an outcome by itself is not
evidence of a selected option.

`track decision outcome` and neutral ingest `decision.outcome` may only record
`deferred`; their `go`/`no-go` variants are rejected. This closes the legacy
settlement bypass while retaining an authenticated way to defer an unresolved
dossier.

## Legacy migration and owner presentation

The event log is append-only and is not rewritten. A legacy dossier is not
parsed into options by this renderer.

- A pending legacy dossier appears under **À INSTRUIRE**, with its ID and the
  statement that alternatives and recommendation are not recorded.
- A legacy dossier with a historical `go`, `no-go`, or `deferred` outcome appears
  under **HISTORIQUE NON STRUCTURÉ**. It names the historical outcome and states
  that no selected option is attested.
- A validated native dossier appears under **DÉCISIONS** with its recorded
  alternatives, recommendation, and (when present) selected option.

The owner or another authenticated author may use existing prose from
`track focus <id>` as source material, but must deliberately revise the dossier
into the native options and recommendation before selecting it. This preserves
what was actually written without inventing an option or retroactively claiming
that an old `go` selected one.

## Contextual rendering is advisory

`packages/h2a/skills/harness/track-report/SKILL.md` is guidance for an agent in
a conversation. Nothing executes that skill, validates its prose, or guarantees
that it was used. Therefore it has no place in a structural enforcement order.

The machine-checkable guarantees are narrower: the CLI renderer is deterministic,
new and revised decision dossiers are fail-closed, and selection has a durable
event. A contextual synthesis may add prose only when the session supplies its
window, focus ordering, lane/model choices, and any claimed decisions; otherwise
it must say those inputs are absent rather than infer them from the report.

## Golden boundary

The golden uses one pinned input commit,
`9b4efbcc039ac5f393cf1d35c51c3b2d9452f0d5`, and the explicit event window
`#1..#568` (state folded through cursor `count:568`). It contains all 22 WP
rows, all 15 decision rows, and the eight actual Focus prose captures. It makes
no release, PR, security, model-lane, or settlement claim beyond those inputs.
