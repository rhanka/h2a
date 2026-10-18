# Stage/status acceptance record — correction of PR #374

The earlier record ended in a truncated tool response and audited raw markers
as if they were a served report. It is superseded by the complete artifacts
below. Human semantic acceptance: pending. Independent cold-agent acceptance: not run.
This is a reproducible synthetic exercise with authored contextual synthesis,
not evidence of either of those two acceptance gates.

## Reproduction

From this checkout, build its own package and run:

```bash
npm run build -w @sentropic/track
node scripts/uat-track-report-stage-status.mjs docs/specs/examples
node --test scripts/track-report-stage-status-example.test.mjs
```

The executable fixture is [uat-track-report-stage-status.mjs](../../../scripts/uat-track-report-stage-status.mjs).
It uses a disposable journal, deterministic identities, an old phase at
2026-09-20T10:00:00Z and one captured clock at 2026-10-18T12:00:00Z.
It never reads an owner journal, installed binary, native host or provider.
All six report commands and handle resolutions are read-only; the journal's
bytes are compared before and after all report/language passes.

## Observations

| Case | Selector | Result |
|---|---|---|
| Weekly default | no explicit selector | last-week, 10-11T12:00Z → 10-18T12:00Z |
| Daily | --period last-day | 10-17T12:00Z → 10-18T12:00Z |
| Long | --since 2026-09-01 --until 2026-10-18 | old and current deliveries, sub-WP aggregated |
| Expanded | same plus --sub-wp | sub-WP shown with its own handle |
| Empty | --now 2026-11-10T12:00:00Z | zero events in window, current open work and gates retained |
| Whole journal | --period all | old withdrawal relevant, acceptance baseline remains c-new |

The fixture contains two WPs, one sub-WP, one immutable Spanish demand
promoted into two items, parentless/phase-only/stream-only leaves, old open
work, deliveries inside/outside the window, never-qualified work, relevant
and irrelevant withdrawals, a red dependency, a blue answerable dossier and
an explicitly historical prose-only dossier to structure. Current writes
still require structured dossiers; the legacy record is fixture data only.

| Artifact | Actions owed | Red/blue audit | Reply lines |
|---|---:|---|---:|
| [French](track-report-stage-status.md) | 0 | pass | 1 |
| [Spanish](track-report-stage-status.es.md) | 0 | pass | 1 |
| [Japanese](track-report-stage-status.ja.md) | 0 | pass | 1 |
| [Portuguese](track-report-stage-status.pt.md) | 0 | pass | 1 |

Portuguese is unprepared by the deterministic lexicon: its raw stage/status
labels are neutral codes. Its contextual prose is authored in Portuguese.
The four artifacts preserve ids, handles, ordering, percentages, bounds,
option identities A/B and the immutable source quotation. Each red proposal
is present in its next action and recommendation and tagged investigated.
Native D1 links and both option consequences remain available; Q1 provides
no selectable choice. A translated placeholder still owes one action and
fails the serving condition. Journal mutations: zero.

The [evidence JSON](track-report-stage-status-evidence.json) distinguishes
the raw action audit from the served audits and records all six periods.
Mechanical presence checks do not establish proposal or translation quality.
A fresh agent and then the owner must still judge the contextual reports.
No peer consensus or human sign-off is claimed under confinement.

## Preservation and limits

Historical track-report-contextual.md, track-report-raw.txt, goldens and
snapshots are unchanged by this correction. Reproducing the historical raw
example requires its original journal at d01368f and the pre-amendment
five-column renderer at 7670fbed; those objects are unverified here. The
new seven-column examples are not a reproduction of that historical output.

No full local suite, owner journals, deployed environment verification,
provider validation, host cleanup or independent cold-agent acceptance was run.
