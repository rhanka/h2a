# Cold UAT record — served stage/status report (lot 6)

Cold acceptance of the amendment: a fresh checkout's `track` binary serves
`--status-table` over a synthetic journal built for the occasion, with no
development-conversation context. Every verification command below is
read-only against that journal; the build phase runs once, in a temp dir,
and the journal holds 54 events before and after (no mutation during
verification).

Environment: worktree at `feat/track-report-stage-status`, package built
with `npm run build -w @sentropic/track`, binary at
`packages/track/dist/cli/bin.js` (called `$BIN` below), journal at a
`mktemp -d` dir (called `$UAT` below).

## Recipe (fixture)

`node $BIN --track-dir $UAT init`, then one builder run. The builder uses
the public domain API (`EventStore`, `Track` from the built
`<checkout>/packages/track/dist/index.js`) — the same append path as the
CLI — because the demand lifecycle (`raise/claim/agree`) has no CLI verb,
and because the old phase needs genuine old timestamps (two `Track`
instances sharing one store, `now` pinned per phase):

```js
import { EventStore, Track } from '<checkout>/packages/track/dist/index.js'

const dir = process.argv[2]
const NOW_ISO = process.argv[3] ?? new Date().toISOString()
const OLD_ISO = '2026-09-20T10:00:00.000Z'

const store = new EventStore(`${dir}/events.jsonl`)
const old = new Track(store, { by: 'uat6', now: () => OLD_ISO })
const now = new Track(store, { by: 'uat6', now: () => NOW_ISO })
const ids = {}

// OLD phase: two WPs + one sub-WP, old open work (in-progress, no acceptance
// at all), old delivery (done + pass run at commit c-old), old withdrawal
// with a live dependency gate, irrelevant old withdrawal (no gate, no reason).
ids.wpa = old.createItem({ kind: 'chore', title: 'UAT Alpha', workspace: 'uat', role: 'workpackage' })
ids.wpb = old.createItem({ kind: 'chore', title: 'UAT Beta', workspace: 'uat', role: 'workpackage' })
ids.wpa1 = old.createItem({ kind: 'chore', title: 'UAT Alpha.1', workspace: 'uat', role: 'workpackage', parentId: ids.wpa })
ids.oldOpen = old.createItem({ kind: 'chore', title: 'old open work', workspace: 'uat', parentId: ids.wpa })
old.setRealization(ids.oldOpen, 'in-progress')
ids.oldDone = old.createItem({ kind: 'chore', title: 'old delivery', workspace: 'uat', parentId: ids.wpb })
old.setRealization(ids.oldDone, 'in-progress')
old.setRealization(ids.oldDone, 'done')
const e0 = old.linkEvidence(old.addCriterion(ids.oldDone, 'old delivery accepted'), 'manual', 'https://example.test/uat/old-delivery')
old.recordRun(e0, { commit: 'c-old', env: 'uat', runner: 'uat6', result: 'pass' })
ids.oldGone = old.createItem({ kind: 'chore', title: 'old withdrawal with live gate', workspace: 'uat', parentId: ids.wpa })
old.setRealization(ids.oldGone, 'cancelled')
ids.oldGate = old.createItem({ kind: 'chore', title: 'old external prerequisite', workspace: 'uat' })
old.openBlocker({ targetId: ids.oldGone, kind: 'dependency', ref: ids.oldGate, reason: 'Waiting on the old lane' })
ids.veryOld = old.createItem({ kind: 'chore', title: 'irrelevant old withdrawal', workspace: 'uat', parentId: ids.wpb })
old.setRealization(ids.veryOld, 'cancelled')

// NOW phase: sub-WP member, deployed member with a recorded delivery link,
// red lane work (dependency gate + recorded facts/proposal), blue choice work
// (structured answerable dossier), never-qualified work, parentless leaf,
// phase-only and stream-only leaves, one demand promoted to two items, and a
// fresh withdrawal whose reason comes from a settled linked decision.
ids.fresh = now.createItem({ kind: 'chore', title: 'fresh sub-WP work', workspace: 'uat', parentId: ids.wpa1 })
now.setRealization(ids.fresh, 'in-progress')
ids.deployed = now.createItem({ kind: 'chore', title: 'deployed member', workspace: 'uat', parentId: ids.wpb,
  links: [{ kind: 'deployed', locator: 'https://example.test/env/prod' }] })
now.setRealization(ids.deployed, 'in-progress')
now.setRealization(ids.deployed, 'done')
const ed = now.linkEvidence(now.addCriterion(ids.deployed, 'deployed member accepted'), 'manual', 'https://example.test/uat/deployed')
now.recordRun(ed, { commit: 'c-new', env: 'uat', runner: 'uat6', result: 'pass' })
ids.red = now.createItem({ kind: 'chore', title: 'red lane work', workspace: 'uat', parentId: ids.wpa })
now.setRealization(ids.red, 'in-progress')
ids.dep = now.createItem({ kind: 'chore', title: 'other lane prerequisite', workspace: 'uat' })
now.openBlocker({ targetId: ids.red, kind: 'dependency', ref: ids.dep, reason: 'Waiting on the other lane' })
now.setReportStatus(ids.red, { status: 'blocked', facts: 'Blocked by the other lane.',
  proposal: 'Restart the lane, then replay the check.' })
ids.blue = now.createItem({ kind: 'chore', title: 'blue choice work', workspace: 'uat', parentId: ids.wpa })
now.setRealization(ids.blue, 'in-progress')
ids.d1 = now.createDecision({ decisionKind: 'commitment', title: 'Share the UAT connector ?', workspace: 'uat', targets: [ids.blue],
  dossier: { context: 'The choice changes connection handling.', qa: [],
    readability: { readingBudgetMinutes: 2 },
    options: [{ id: 'a', title: 'Share', summary: 'One connection' },
              { id: 'b', title: 'Isolate', summary: 'Two connections' }],
    recommendation: { optionId: 'a', rationale: 'Fewer connections' },
    artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/share' }] } })
ids.nq = now.createItem({ kind: 'chore', title: 'never-qualified work', workspace: 'uat', parentId: ids.wpb })
now.setRealization(ids.nq, 'in-progress')
ids.orphan = now.createItem({ kind: 'chore', title: 'parentless leaf', workspace: 'uat' })
ids.phase = now.createItem({ kind: 'chore', title: 'phase only', workspace: 'uat', role: 'spec-phase' })
ids.phaseLeaf = now.createItem({ kind: 'chore', title: 'phase-only leaf', workspace: 'uat', parentId: ids.phase })
ids.stream = now.createItem({ kind: 'chore', title: 'stream only', workspace: 'uat', role: 'stream' })
ids.streamLeaf = now.createItem({ kind: 'chore', title: 'stream-only leaf', workspace: 'uat', parentId: ids.stream })
ids.demand = now.raiseDemand({ type: 'feature', workspace: 'uat',
  raw: { text: 'Split the UAT intake in two' }, source: { kind: 'human' }, handler: 'uat6' })
now.claimDemand(ids.demand, { handler: 'uat6' })
ids.halves = now.agreeDemand(ids.demand, { items: [{ title: 'first half' }, { title: 'second half' }] })
ids.freshGone = now.createItem({ kind: 'chore', title: 'fresh withdrawal', workspace: 'uat', parentId: ids.wpa })
now.setRealization(ids.freshGone, 'in-progress')
ids.gd = now.createDecision({ decisionKind: 'orientation', title: 'Keep the fresh scope ?', workspace: 'uat', targets: [ids.freshGone],
  dossier: { context: 'Scope cut.', qa: [], readability: { readingBudgetMinutes: 2 },
    options: [{ id: 'a', title: 'Keep', summary: 'Keep the scope' },
              { id: 'b', title: 'Cut', summary: 'Cut the scope: duplicate of the old lane' }],
    recommendation: { optionId: 'b', rationale: 'Duplicate' } } })
now.selectDecisionOption(ids.gd, 'b', 'go')
now.setRealization(ids.freshGone, 'cancelled')
```

## Runs and verdicts

| # | Command (read-only) | Observed | Verdict |
|---|---|---|---|
| 1 | `report --status-table --format md` | Rolling `7 derniers jours glissants`, 37/54 events; seven columns; `🔴 bloqué`, `🔵 décision attendue`, colourless `— non qualifié` / `— retiré`; D1 table with options + préco A; single reply line (`vas y` / `D1 A`) | pass |
| 2 | `report --status-table --period last-day --format md` | Rolling `24 dernières heures glissantes`, same structure | pass |
| 3 | `report --status-table --since 2026-09-01 --until 2026-10-18 --format md` | 54/54 events; FAIT shows both `deployed member` and `old delivery`; `1 sous-WP agrégés dans leur parent`; irrelevant old withdrawal served with `retiré — motif non enregistré` | pass |
| 4 | same + `--sub-wp` | Sub-WP row listed beside its parent on the long window | pass |
| 5 | `report --status-table --now 2026-11-10T12:00:00.000Z --format md` | Rolling week 11-03→11-10, 0/54 in window; FAIT honestly `aucune action enregistrée`; À-FAIRE still serves open work; omissions count the aged withdrawals | pass |
| 6 | `--format json` (+ `--lang fr/es/ja/pt`) | Same columns, ids, order, period, handles in all four; `es: 🔴 bloqueado`, `ja: 🔴 ブロック中`, `pt: 🔴 blocked` (unprepared ⇒ codes, never silent French) | pass |
| 7 | itemFacts/withdrawals/demandId in JSON
...[truncated 3881 chars]