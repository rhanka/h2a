# @sentropic/track

Typed product-backlog and **spec / realization / acceptance tracking** for the sentropic ecosystem — a **record-only system of record** with an append-only, integrity-checked event log.

> **Status:** MVP implemented (Lots 0–7). `docs-git` backend · single-writer · CLI. h2a coordination, external backends, MCP, multi-writer merge and UI are v2+ (see [`INTENTION.md`](./INTENTION.md), SPEC §9).

## Model (one line)

An **Item** carries three orthogonal axes — **specification** (`to-specify → specified`), **realization** (`to-do → in-progress → done | cancelled | rejected`), **acceptance** (computed `pass/fail/unknown/stale/waived`) — plus **blockers** (relations), **prioritization** (versioned, WSJF), and first-class linked **Decisions** (orientation/commitment, with a typed dossier + go/no-go `outcome`). `report --owner-table` projects the owner-validated 8-column status table (`# · Statut · Étape · ETA (étape cible) · Ta demande · Fait · À faire (qui) · Décision` + `Décisions qui t'attendent`), while bare `report` projects the conductor / done / to-do / awaited / dropped buckets. See [`docs/spec/SPEC.md`](./docs/spec/SPEC.md).

## Install & build

```bash
npm install
npm run build      # tsc → dist/ ; bin: `track` → dist/cli/index.js
npm test           # vitest
```

## CLI

State lives in `.track/events.jsonl` (append-only) in the current directory.

```bash
track init

# items
track item new --kind feature --title "Login" --workspace web [--body <md-path>] [--parent <id>]
track item spec     <itemId> specified
track item realize  <itemId> in-progress|done|cancelled
track item show     <itemId>
track item ls       [--workspace <w>] [--kind <k>] [--format json|text|md]

# decisions (orientation / commitment) — open a decision blocker per target until it settles
track decision new       --kind orientation --title "DB?" --workspace web --targets <id,id> [--context <c>]
track decision outcome   <decisionId> go|no-go|deferred       # no-go drops non-terminal targets
track decision dossier   <decisionId> --context <c>
track decision disposition <itemId> orientation|commitment required|skipped|not-applicable

# blockers
track blocker raise   --target <id> --kind dependency --ref <id> [--rule linked-done|manual] [--reason <r>]
track blocker resolve <blockerId>                              # only a `manual` dependency blocker

# acceptance (criteria → evidence → runs / waivers; status is computed vs --commit)
track accept criterion <itemId> --statement "user can log in"
track accept link      <criterionId> --kind unit|integration|e2e|manual --locator <id>
track accept run       <evidenceId> --result pass|fail [--commit <sha>] [--env <e>] [--runner <r>]
track accept run       --from junit.xml --format junit [--commit <sha>]     # ingest a report
track accept waive     <criterionId> --reason "<why>"

# prioritization (WSJF = (UBV + TC + RR/OE) / jobSize)
track priority assess <itemId> --ubv 8 --tc 4 --rr 2 --js 2

# views
track report [--owner-table] [--decisions] [--require-accepted] [--format json|text|md] [--commit <sha>]
track query  [--kind <k>] [--workspace <w>] [--bucket AWAITED|DROPPED|DONE|TO-DO] [--realization <r>] [--acceptance <a>] [--format <f>]

# integrity + prose↔log desync (§4); never repairs, only reports
track validate [--commit <sha>]

# BRANCH.md → track sidecar (read-only; idempotent; BRANCH.md stays the source of truth)
track branch import <plan/NN-BRANCH_*.md> [--commit <sha>]
```

`report --owner-table` serves the owner-validated 8-column status table (12 link-proven stages `brainstorm..done`, 8 statuses, target-stage ETAs, `Décisions qui t'attendent` `D1…Dn` + `Réponse :`, and blocking gates). Bare `report` / `--flat` buckets (first match wins): **AWAITED** (any open blocker) › **DROPPED** (cancelled/rejected) › **DONE** (done, and `pass` if `--require-accepted`) › **TO-DO**. `--commit` defaults to the repo git HEAD.

## Integrity

The event log is **append-only**; each event carries `contentHash = sha256(canonicalize(core))` and a positional `prevHash` chain + per-aggregate `seq` (faithful to the h2a journal). `track validate` recomputes the chain, the per-aggregate sequence, atomic-batch completeness, and a `head.json` truncation anchor. The contract was frozen after multi-round adversarial review — see [`docs/reviews/lot1-FROZEN.md`](./docs/reviews/lot1-FROZEN.md).

## Read contract (skills) & CI (M2a)

- **Read contract** — skills (`scope-check`/`lot-gate`) consume the versioned, read-only surface at `@sentropic/track/read`: `new TrackReader('.track/events.jsonl')` exposes `report`/`query`/`validate`/`branchProvenance`/`freshness`, plus a fail-closed `requireFresh(branchContent, locator)` that throws unless the sidecar is structurally current with `BRANCH.md` **and** integrity-intact — so a stale or tampered sidecar can never be trusted as the backlog (`BRANCH.md` stays master).
- **CI → acceptance** — `accept run --from <report> --format junit|json --commit $SHA` ingests test results; ingestion is **idempotent** (a run is skipped unless its result differs from the latest for `evidenceId+commit+env+runner`), so re-running a commit never multiplies events. A reusable GitHub Actions workflow ships at [`.github/workflows/track-acceptance.yml`](./.github/workflows/track-acceptance.yml).
- **MCP (read-only)** — a second bin, `track-mcp`, serves the read contract over MCP (stdio) for agents: tools `track_report` · `track_query` · `track_validate` · `track_branch_provenance` · `track_freshness`. CLI and MCP share one read command layer, so their JSON output is byte-identical (parity-tested); read tools are side-effect-free (never append). The caller supplies `baselineCommit` (no git in the server).

## Library

```ts
import { Track, EventStore } from '@sentropic/track'
const track = new Track(new EventStore('.track/events.jsonl'))
const id = track.createItem({ kind: 'feature', title: 'Login', workspace: 'web' })
track.setRealization(id, 'in-progress')
console.log(track.report({ baselineCommit: 'HEAD' }).buckets)
```

See [`INTENTION.md`](./INTENTION.md) for the full model, boundaries, and rationale; [`docs/plan/PLAN.md`](./docs/plan/PLAN.md) for the build lots; [`docs/reviews/`](./docs/reviews) for the per-lot double reviews.

## License

MIT — see [`LICENSE`](./LICENSE).
# Owner status table

`track report --owner-table [--format md|text|json] [--commit <sha>] [--now <iso>] [--policy <path>]`
selects the owner-validated 8-column status table (`# · Statut · Étape · ETA (étape cible) · Ta demande · Fait · À faire (qui) · Décision`) followed by `Décisions qui t'attendent` (`D1…Dn` with options `A..Z, AA..`, consequences, recommendation, dossier link, and a single `Réponse :` line). It derives the 12 workflow stages (`brainstorm | spec | plan | dev | test | pr | review | merged | published | preprod | prod | done`) from recorded delivery links (`merged` is never `✅ fait`) and the 8 statuses (`🔵 sur la voie`, `🟡 en attente`, `🟠 dérive`, `🔴 bloqué`, `⚪ pas commencé` / `⚪ en pause`, `✅ fait`, `⚫ retiré`, `— sans témoin`), enforcing blocking gates fail-closed at render time.

A demand with a single lot renders as one row (`kind: 'single'`). A demand with several lots renders as a title row (`kind: 'demand-title'`, verbatim `Ta demande` and demand-level decision cell, with `—` for status/stage/ETA unless a demand-level ETA is set) followed by one row per lot (`kind: 'lot'`, `parentDemandId`, `↳ lot N — <title>`), each carrying its own status, stage, ETA, `Fait`, `À faire (qui)`, and lot-targeted decisions:

| # | Statut | Étape | ETA (étape cible) | Ta demande | Fait | À faire (qui) | Décision |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | Migration en deux lots | — | — | — |
| 1 | 🔵 sur la voie | merged | published → — (inconnu) | ↳ lot 1 — Socle API | Lot 1 fusionné (PR #10). | — | — |
| 1 | 🔴 bloqué | dev | pr → — (inconnu) | ↳ lot 2 — Connecteur | Preuve : branch/lot-2 | Attente accès API tiers (équipe infra) | — |

`track report --status-table --format md` selects the four-section WP conductor report: À-FAIRE carries
`WP · av. · étape · statut · à faire · bloqué · prochaine action`, most urgent first, and DÉCISIONS keeps
its decision expectations. Over an identical period it renders byte-identical sections to the validated
route; without a selector it covers a rolling `last-week` window (`--period last-day` for one day).
Scope it with `--scope <container-id|code|label>`; text and JSON are also supported. Bare `track report`
is unchanged for CLI callers. Stage/status labels follow `--lang <bcp47>` (exact, then primary subtag, else neutral codes).

`track item report-set <item-id> --json '<object>'` records stage, status, proposal and decision
expectations in an additive event. It replaces all prior report metadata; `{}` clears only metadata.
See [the report skill](../h2a/skills/harness/track-report/SKILL.md) for the normalized vocabulary,
evidence rules, mandatory red proposals and blue decision dossiers. Legacy missing information is flagged.

## Adopting an existing journal (`track adopt`)

Bring a legacy journal to the point where `track report --owner-table --strict` exits 0 in three steps:

1. **Dry run first (read-only)**:
   ```bash
   track adopt plan --out adoption-plan.json
   ```
   Inspects the journal through the qualified reader and prints a JSON plan listing every gap as either `mechanical` (derivable from the journal alone) or `to-decide` (carries a human question and `resolution: null`). Writes nothing to the journal folder or state home; `--out` must point outside the journal folder.
2. **Resolve**: edit `adoption-plan.json` to supply a `resolution` value for every `to-decide` entry (row attachment, options and recommendation for an optionless decision, dossier link, blocked cause, or clean rewrite of a masked text).
3. **Apply (idempotent)**:
   ```bash
   track adopt apply adoption-plan.json [--writer-token-file <path>]
   ```
   Re-derives the plan to ensure the journal has not drifted, stamps every write with an entry-derived idempotency key (re-running writes nothing and reports `already applied`), and prints one line per entry (`applied`, `already applied`, or `refused: <reason>`), exiting 1 if any entry is refused. On an exclusive journal, application is refused unless the holder presents its writer token.

**What `track adopt` never does:**

- Never settles, withdraws, or archives a decision (the plan format has no such action; use `track decision select` once the owner answers).
- Never invents owner text, causes, options, recommendations, or dossier links (unresolved `to-decide` entries are refused by name).
- Never inscribes a reconstructed demand with `capture` provenance — reconstructed demands use the ordinary `cli` transport and are rendered `(non capté)`, never quoted.
