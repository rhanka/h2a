# Unified report presentation — one shared *lexicon + per-directive projection*

**Status: spec / design-only — passed independent double-consensus (both GO).** No plan executed yet.
Companion to `2026-06-27-h2a-canevas-evo4-decision-screen.md` §7.2 (RENDU/friendly layer should be
shared). Re-scoped after double-consensus (gpt-5.5 + Opus): the first draft over-stated the shared
surface and rested on two false premises (one machine artifact; byte-identical goldens) — corrected
below. The genuinely shared unit is the enum→French **lexicon** + the per-directive **projection**;
FAIT/À-FAIRE stay surface-specific.

> **The gap (Fabien, 2026-07-10).** The track report renders in two places with the same *intended*
> mode (French, jargon-free FAIT/À-FAIRE/PRÉCO/Décisions) but from **two independent codebases** that
> drift. Unify what is genuinely shared so terminal and cockpit can't skew — without pretending they
> are one render.

---

## 1. What is ACTUALLY shared (corrected — the two surfaces do NOT share an input)

- **Terminal** (`packages/track/src/report/format.ts`) starts from the **`WpNode[]` forest +
  `DecisionRow[]`** and calls `buildDirectives(tree,decisions)` *internally*. It has the full tree:
  per-leaf acceptance/blockers, `openLeaves`, `wpTotals`, `collapseLeafCohorts`, closed-WP detection.
- **Cockpit** (`apps/focus`) starts from a **`ReportPayload`**: `buckets` (flat `BucketRow[]` with
  `detail.summary`/`acceptanceLabel`) **+** `dates` (per-item done-dates from the event log) **+** the
  **`directives[]` JSON projection** (parsed from `formatWpConductor(tree,'json',…)`, discarding
  `tables`). It never sees the WP tree, leaves, or cohorts.

⇒ The **only** shared substrate is **`directives[]`** (the locked contract). So the shared unit is:

1. the **enum→French LEXICON** over a directive: rank/gate/step/mode/adviceNature/kind/acceptance/
   scope (today split as terminal `directivePhrase`/`directiveScopeLabel` vs cockpit
   `rankBadge`/`gatePhrase`/`stepAction`/`modeActor`/`adviceNature`/`kindFr`);
2. the **per-directive friendly PROJECTION** (`subjectOf` + the `todo`/`preco`/`decision` row shapes).

**NOT shared — surface-specific, stays where it is:**
- **FAIT**: terminal = WP-closed + a global totals line, **timeless**; cockpit = **dated** DONE items
  (`doneList` over `buckets`+`dates`, recency-sorted, ≤30). Different granularity, different inputs.
- **À-FAIRE**: terminal `text`/`md` = **WP-rows listing the first open leaves** (via
  `buildWpConductorView`); the **cohort-collapse** (`N× …`) is **inline-only**
  (`formatWpConductorInline`). Cockpit = **directive-rows**.
- Cohort-collapse (inline), width/truncation (`fitMiddle`/`truncateLine`/`wrapCell`), keystone
  phrasing, and the terminal's raw `[P1]` rank all stay **renderer-owned**.

## 2. Architecture (corrected)

```
directives[] (locked)  →  SHARED (pure track subpath):                 →  each renderer composes its own report
                          · enum→French LEXICON                            terminal: FAIT/À-FAIRE (tree+cohorts) + PRÉCO/DÉCISIONS (projection)
                          · per-directive PROJECTION (todo/preco/decision) cockpit:  Fait (buckets+dates) + À-faire/Leviers/Décisions (projection)
```

The renderers are **thin only for the directive-derived blocks** (PRÉCO/DÉCISIONS/À-faire-rows);
FAIT and the terminal's WP/cohort À-FAIRE remain surface-specific. No "one FriendlyReport both fully
consume" — that was the v1 error.

## 3. Packaging — **Step 0, mandatory** (both reviewers: blocking prerequisite)

- **Pure subpath export** `@sentropic/track/report/friendly` — module-level pure: transitively **no**
  `fs`/`child_process`/MCP/CLI/ANSI/HTML. (Feasible today: it imports only `directive.ts` types +
  pure helpers.) Enforced by an **import-lint**, not convention.
- **`exports` map gains a `types` condition + the subpath** (declarations already emit):
  `"./report/friendly": { "types": "./dist/report/friendly.d.ts", "import": "./dist/report/friendly.js" }`.
- **`apps/focus` adds `@sentropic/track` as a workspace dependency** (it has none today).
- **Import-lint in `apps/focus`**: forbid **barrel** value-imports of `@sentropic/track` (the `.`
  barrel `export *`s node-only `cli`/`mcp`/`events` → would poison the Vite/SSR bundle). Only the pure
  subpath may be statically imported.

## 4. Invariants (corrected)

1. **`directives[]` byte-identical**: untouched (the projection is strictly downstream).
2. **`--format json` byte-identical**: `formatWpConductor(…, 'json')` emits `ReportView` — a **machine
   contract**. The friendly layer does **not** change any existing `--format` output shape; JSON stays
   `ReportView`, not `FriendlyReport`.
3. **Pure view unit**: no `fs`, no `Date.now()`, no ANSI/HTML. `now`/freshness are **parameters**
   (removes `frenchAgo`'s `Date.now()` default; the terminal — which is timeless — simply doesn't pass
   `now`, so dated-FAIT stays cockpit-only).
4. **i18n = renderer decorator** (`harmonize.ts` decorates post-hoc; source strings are French).
   Matches reality; unchanged.
5. **Terminal goldens change — by intent, reviewed.** The two lexicons diverge at the byte level today
   (`'` vs `'`, casing, actor-prefix, raw `[P1]` vs "Prioritaire"). Unifying onto **one canonical
   wording** is therefore an **intentional design change**, not a zero-diff refactor: the unify commit
   lands an **intended, reviewed terminal golden diff** — NOT byte-identical. (A shared module *could*
   instead carry per-surface wording fields; we prefer one canonical lexicon + a reviewed diff, so the
   two surfaces can never silently re-word apart.)
6. **Escaping ownership**: the shared unit emits **semantic French strings** (whitespace-normalized) but
   **not** format-escaped; each renderer keeps its escaping (terminal `MD_META`/cell-`|`→`¦`; cockpit
   `clean`/DS). The VM emits raw-ish; renderer escapes — so md-injection safety doesn't regress.

## 5. Migration (Step 0 added; each step reversible + tests-green)

0. **Packaging** (§3): subpath export + `types` condition + focus workspace dep + import-lint. No
   behaviour change. (green)
1. **Extract** the LEXICON + per-directive PROJECTION + `FriendlyRowFr` types in the pure subpath;
   unit-test **every** `DirectiveRank`/`GateCode`/`StepCode`/`Mode` enum + an unknown-enum fallback.
   Nothing consumes it yet. (green)
2. **Re-base terminal** PRÉCO/DÉCISIONS/ACTIONS composition onto the projection; **FAIT/À-FAIRE stay**
   (tree+cohorts). Land the **intended reviewed golden diff**; `--format json` untouched. (green,
   updated goldens)
3. **Re-base cockpit**: `apps/focus` statically imports the pure subpath (lexicon+projection) and
   builds friendly rows **server-side** (`+page.server.ts`), passing serialized data to Svelte (no
   track code shipped to browser; the engine/`buildDirectives` stays via the existing server-side
   dynamic import). **Delete** `track-model.ts`'s duplicated mappers; keep DS-only bits (tone→variant,
   `harmonize` hook, `doneList`/`frenchAgo`/dates which are cockpit-specific). Parity-test the new
   rows vs the old `buildFocusData` fixture. (focus build + svelte-check green)
4. **Cleanup**: remove dead mirrors; add a **shared-lexicon snapshot test both surfaces are checked
   against** (catches re-drift); enforce the import-lint in CI (build track before focus).

**Golden/test coverage (explicit).** Terminal goldens must cover `formatWpConductor(…, 'text')`,
`'md'`, `'json'` (the last stays `ReportView`, byte-identical) **and** `formatWpConductorInline()` at
fixed widths + `maxDirectives`. Add: an **enum-coverage + unknown-enum-fallback** test on the shared
lexicon; a **`buildFocusData`-fixture parity** test (old vs new cockpit rows); a **package-export /
`.d.ts` import smoke test** (the subpath resolves types + value from a consumer); and the
**shared-lexicon snapshot** both surfaces assert against.

## 6. Resolved / remaining questions

- **QV1 (home) → resolved**: a **pure subpath in `@sentropic/track`**, not a new package (reuses
  focus's existing track resolution; a new package adds release surface for no isolation gain).
- **QV2 (parity) → resolved**: FAIT/À-FAIRE are **surface-specific** (different granularity + inputs);
  shared = lexicon + directive projection only.
- **QV3 (types) → resolved**: focus imports track-owned types via the subpath `.d.ts` (static import,
  safe because the module is pure). The projection consumes the **locked `directives[]` contract**, so
  bundling it from focus's workspace track is **skew-robust across `FOCUS_REPO_ROOT` checkouts** (the
  contract is version-stable by design) — this dissolves the v1 "version-skew is a deleted feature"
  worry: the tolerated seam only ever mattered because the contract underneath is already stable.
- **Remaining open**: (QV-a) derive `launchable` from `dispatchQueue`/`affordances` (engine truth) vs
  the current `mode` heuristic; (QV-b) also fold the duplicated `decisionNeedsFocus`/focus-threshold
  into the shared unit so a third copy can't appear.

---

**Next:** double-consensus **closure** on v2 (the two reviewers verify their must-fixes are closed);
on GO, implement §5 Step 0→4 incrementally (tests green per step). Design-only until then.
