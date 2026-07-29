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

## Acceptance criteria

1. A fresh-clone bootstrap defines an absolute `track_bin` pointing to that
   clone's `packages/track/dist/cli/bin.js`, verifies the file, and invokes it
   with `node "$track_bin"`; none of the three report reads depends on a shell
   function, `PATH`, or `npm exec`. A later tool call that retains only the cwd
   can reuse the recorded absolute path and cannot resolve a global `track`.
2. `track --help` and `track report --help` both exit successfully and document
   `--track-dir <directory-containing-events.jsonl>` as a global override that
   may appear before or after the command. The same help explains that the
   directory contains `events.jsonl` and that `TRACK_DIR` is its environment
   equivalent.
3. The two public `directives` arrays identify their different meanings in the
   emitted JSON: `report --raw` carries
   `directivesProjection: { kind: "rule-derived-facts", order:
   "aggregate-id-then-id" }`, whereas `view` carries
   `directivesProjection: { kind: "conductor-action-directives", order:
   "canonical-urgency" }`. A consumer preserves the latter order and never
   rank-sorts it; a cold agent can therefore distinguish the two arrays without
   inferring it from their JSON paths.
4. The deterministic conductor has no `decisions-actions` table and no table
   titled `DÉCISIONS/ACTIONS`. Its rule-derived rows are exclusively in
   `view.tables[id=rule-derived-actions]`, titled `ACTIONS DÉRIVÉES`; genuine
   structured dossiers remain exclusively in `view.tables[id=decisions]`.
5. `ReportView` has no `generalRecommendation`, and neither text/Markdown nor
   HTML conductor rendering prints a deterministic `RECOMMANDATION` section.
   Only a conversational author may add that section, using supplied owner
   context and the emitted facts.
6. The payload identifies `dispatchQueue` as
   `delegable-directive-ids` in canonical urgency order with modes `subagent`
   and `local`, and identifies raw `recentEvents` as the last up to 200
   payload-free `position/eventId/kind/aggregateId` entries in append order.
   These descriptors, plus the skill, make both arrays consumable without
   guessing their role.
7. The conductor table order is exactly `done`, `todo`, optional
   `todo-unscoped`, optional `outside-rollup`, optional `decisions`, optional
   `prepare`, optional `legacy-history`, then `rule-derived-actions`. A
   contextual report follows the matching visible order and places any
   conversational `RECOMMANDATION` only after `ACTIONS DÉRIVÉES`.
8. `view.tables[id=done]` exposes `scope`, `progress`, and `completion`, never
   an invented “dernières actions” field. Its global row is explicitly a scope
   aggregate, not a completion claim; a contextual **FAIT** lists the recorded
   completed WP rows and does not turn the global count into an accomplishment
   sentence.
9. Every `outside-rollup` view row exposes `id`, `workspace`, `scope`, bucket
   state, title, rendered acceptance, and `summary` labelled **extrait**. No
   report calls that field `attachment` or “as stored”: it is the emitted
   `detail.summary` excerpt and may already be truncated.
10. Every `todo` and `todo-unscoped` row exposes `actionTarget` beside its
    open-work text, blocker, and next action. It names the directive target and
    bucket, so a DONE acceptance-debt target is visibly intentional rather than
    requiring a hand join to `view.directives`.
11. The skill names `--width <40..240>` beside `--inline` in the same warning,
    and states what that route drops (HORS ROLLUP, ACTIONS DÉRIVÉES, a `+N
    autres` tail, plus its own deterministic `PRÉCO` block). The honesty rules
    carry their own boundary — they are guarantees of the three read commands,
    not of every route the CLI offers. `--width` is not a separate renderer: it
    turns `--inline` on, so it is rejected for any non-text format exactly as
    `--inline` is, and that rejection is the observable proof of the coupling.
    The skill does not call `--track-dir` read-only, because it redirects the
    whole store; and `track --help`, not only `report --help`, states that the
    override may appear before or after the command.

The tenth criterion was closed by a code change; the eleventh is closed by a
skill edit, which is a weaker rung. `skill-truncation-warning.test.ts` pins it
so the sentence cannot be deleted without turning something red — verified by
removing the warning and observing the suite fail. That is the ceiling here: no
command, hook, or validator forces an agent to read the skill at all.

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
