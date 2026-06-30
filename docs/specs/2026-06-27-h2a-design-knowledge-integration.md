# `h2a design …` + `h2a knowledge …` — ADDITIVE federation integration (brainstorm)

**Status: brainstorm / design-only.** No code, no plan. Companion to
`2026-06-27-h2a-unified-cli-syntax.md` (the verb grammar). That doc described how `track` /
`remote` / `harness` get **absorbed** into `h2a` (their CLI folds in, they become libs).
This doc describes the **opposite, simpler model** for two *independent products*:
the **design-system** and **graphify**. They are exposed *inside* `h2a` as the Tier-2
namespaces `design` and `knowledge` **without losing their own binary** — a
federation / coexistence model, not an absorption.

Investigated read-only this session: DS (`README.md`, `PRODUCT.md`, `PLAN.md`,
`packages/skills` = the published `design`/`sentech-design` binary, `ds-theme-clone` skill,
~70 `theme-*` packages, `docs/chat-ui-contract.md`, `docs/graphics-roadmap.md`); graphify
(`README.md`, `ARCHITECTURE.md`, `AGENTS.md` = the `graphify` binary + skill); and
`track/INTENTION.md` (the "embeddable-view contract, defined once on the DS").

---

## 0. Why these two are NOT like track/remote

| Axis | `track` / `remote` (unified-syntax doc) | `design` / `graphify` (this doc) |
|---|---|---|
| Model | **Absorption** — CLI folds into `h2a` | **Federation / coexistence** — CLI stays |
| Own binary | Retired → legacy alias (`stp track`) | **Kept first-class** (`design`, `graphify`) |
| Becomes | A library behind `h2a` | An **independently released product** `h2a` *consumes* |
| Release train | Co-evolves lockstep with `h2a` | **Independent** (DS: npm Trusted Publishing + ~70 theme pkgs + external UI consumers; graphify: own npm + multi-assistant install) |
| External consumers | sentropic-internal only | DS → forge/NC/sentropic/openerp UIs; graphify → any repo, any assistant |
| Direction | Tight, sentropic-coordination | Two-way independent; absorbing them would **break their external consumers** |

The simplification: **we do not strip their CLI**, so `h2a` only needs to *re-expose* a
curated subset as a convenience front door. No re-modelling, no ownership fight.

---

## 1. `h2a design …` — DS lint / tokens / theme / views

The DS already ships a binary (`@sentropic/design-system-skills` → `design` /
`sentech-design`) with real subcommands. `h2a design <verb>` is a **thin dispatcher** onto
that binary; the verbs mirror the real surface so the contract is the package's, not h2a's.

| `h2a design …` | Consumes (today) | Notes |
|---|---|---|
| `lint <target>` | `design audit` (static jsdom, 7 rules) + `audit:visual` (headless Chromium) | bare = static; `--visual` = real layout |
| `check <target>` | `design check --tech\|--human --fail-under` | quality gate 0-100 |
| `tokens` | `design init --extract` (DESIGN.md from real CSS tokens) + `tokens`/`themes` pkgs | inspect/export the 3-layer tokens |
| `fidelity` | `sent-tech-design fidelity --theme --component` | edge-by-edge vs official DSFR/Carbon; the **a11y / WCAG-AA** evidence lives here |
| `theme clone <id>` | `ds-theme-clone` skill (measured-clone `theme-<id>`) | preserves the skill's scope rule (create only `packages/theme-<id>`, never touch shared files) |
| `build <feature>` | `design build` (Svelte 5 skeleton) | `--propose/--promote/--global` stay experimental (exit 2) |
| `views` | the **embeddable-view contract** (see §3) | list / describe the canvases the DS can render |

**How `h2a` consumes the DS without removing its CLI.** `h2a design` resolves the
`design` binary (optional dep / on `PATH`), forwards argv, and normalizes exit codes
(`0` clean / `1` findings / `2` runtime) + `--json` into the h2a output contract. The
`design` binary keeps shipping and releasing on its own train. If the package is absent,
`h2a design` degrades gracefully and `h2a doctor` reports "install
`@sentropic/design-system-skills`".

**Role of the embeddable-view contract (the key for canvases).** `track/INTENTION.md`
already pins it: track `report`/dossier screens, h2a screens and graphify outputs should
all be **DS-aligned Svelte views, embeddable in sentropic, under one contract defined once
on the DS** (`@sentropic/design-system-svelte` + `--st-*` tokens + `ThemeProvider`/theme
contract, cf. `chat-ui-contract.md`). So `design views` is the **seam that renders every
canvas**: `h2a knowledge` (§2) renders its Ontology Studio *through* this DS contract
instead of its own bundled SPA, and `h2a report` (track) renders the same way. One visual
layer, owned by the DS, consumed by knowledge/track/h2a/sentropic.

## 2. `h2a knowledge …` — the graphify knowledge graph

graphify *turns a corpus into a reconciled, ontology-typed knowledge graph*. Its binary
(`graphify`) + skill (`/graphify`) stay; `h2a knowledge <verb>` re-exposes the durable
verbs:

| `h2a knowledge …` | Consumes (today) | Notes |
|---|---|---|
| `ingest <path>` | `/graphify .` build · `--update` · `--directed` · `--mode deep` | build/refresh the graph from a corpus (code AST + docs/papers/images) |
| `query <q>` | `graphify query` · `path` · `explain` · `summary` | the read surface — ask the graph, don't re-read files |
| `graph` | `graphify serve` (read-only MCP) · `watch` · `clone` · `merge-graphs` | lifecycle + the MCP transport `h2a` re-exposes |
| `ontology` | `profile {validate,dataprep,report}` · `ontology {candidates,patch,decision-log,studio}` | profiles + the reviewable patch lifecycle (validate→dry-run→apply) |
| `export` | `studio export` · json/html/svg/graphml/cypher/neo4j/wiki/obsidian | artifacts; studio renders via the DS view contract (§1) |
| `agents` | `graphify agent-stats {sync,sessions,wp}` | **natural seam** — attributes branches/commits/WPs to agent sessions using **h2a registry identity + Track WP** |

**Why `knowledge` is the right name.** The unified grammar is verb-first, namespace =
*the object*, host/tool-agnostic (like `remote`→`sess`, `bus` not `remote`). The object
here is **knowledge** (a reconciled entity+relation graph), not the brand "graphify".
`h2a` already names its other knowledge domains by object — `track` (realization),
`nego` (trust), `nhi` (identity); `knowledge` (corpus/graph) sits beside them. graphify is
simply the implementation behind it, swappable, never leaked into the grammar.

**Additive integration.** Same dispatcher model as `design`: resolve `graphify`
(optional dep / PATH), forward argv, normalize `--json`/exit. graphify keeps its npm
package, its per-assistant `install`, its `.graphify/` outputs and its own MCP server.
`h2a knowledge` is an *extra* front door, never a replacement.

## 3. Integration mechanism — federation registry (the `stp` shape, inside h2a)

```
h2a <domain> <verb> ...args
        │
        ├─ domain ∈ {absorbed: track, sess, job, dev, …}  → in-process h2a code (unified-syntax doc)
        └─ domain ∈ {federated: design, knowledge}         → dispatch to the consumed package
                                                              (bin on PATH / optional dep / lib export),
                                                              forward argv, normalize --json + exit codes
```

- **Sub-command registry.** `h2a` carries a federation table:
  `design → @sentropic/design-system-skills` (bin `design`), `knowledge → @sentropic/graphify`
  (bin `graphify`). New federated tools = one table row, no h2a rewrite. Mirrors the `stp`
  federation roster, but the umbrella is `h2a` itself.
- **Optional dependency.** Federated packages are `optionalDependencies` / resolved on
  `PATH`; absent → graceful degrade + `h2a doctor` install hint. Present → re-exposed.
- **The tool keeps its binary.** `design` and `graphify` remain installable, releasable
  and runnable standalone, with their own consumers. `h2a design`/`h2a knowledge` are
  additive convenience, not the only door.
- **⚠️ Anti-cycle invariant (non-negotiable).** `@sentropic/design-system-skills` and
  `@sentropic/graphify` **MUST NOT import `h2a`**. The dependency arrow is one-way
  (`h2a → {design, graphify}`). This keeps both products publishable/usable without h2a,
  prevents a dependency cycle, and is what makes the federation *additive*. The one read
  that crosses the line today — `agent-stats` reading the h2a **registry identity** — must
  be a **stable, documented data contract** (read a file/format), never a code import of h2a.

## 4. What stays out (clarifying the boundary)

- `h2a` does **not** re-model the DS token layers, the theme catalog, or graphify's
  ontology/patch core. It dispatches; the model stays in the product.
- `h2a` does **not** publish the DS theme packages or graphify's npm — independent release
  trains (DS: Trusted Publishing OIDC; graphify: own CI).
- Federation is **read/dispatch**, not absorption: removing `h2a` must leave `design` and
  `graphify` fully functional.

## 5. Questions to discuss with the owners

**graphify** (`claude:graphify:f9fbe548d3a5`):
- Q-K1 — Surface: which verbs under `h2a knowledge` (ingest/query/graph/ontology/export/agents)?
- Q-K2 — `agent-stats`: live under `h2a knowledge agents` **or** under `h2a track` (WP
  attribution)? It already joins **h2a identity + Track WP** — where does it belong?
- Q-K3 — Confirm consumption as **bin/lib federation with zero `h2a` import**; formalize the
  `agent-stats` read of the h2a registry as a one-way data contract.
- Q-K4 — Re-expose the **read-only `graphify serve` MCP** as the transport behind
  `h2a knowledge graph`, keeping mutation (`ontology serve --write`) explicit/guarded?
- Q-K5 — Domain name: `knowledge` vs `graph` vs keep `graphify`?

**design** (`claude:sent-tech-design-system:6956afd62234`):
- Q-D1 — Surface: which `design` subcommands under `h2a design` (lint/check/tokens/fidelity/theme-clone/build/views)?
- Q-D2 — **Embeddable-view contract**: confirm the DS is the canonical owner, and **version
  it**, as the single rendering contract consumed by track / h2a / knowledge / sentropic
  (§1) — the key for rendering all canvases.
- Q-D3 — `ds-theme-clone` as `h2a design theme clone`: must preserve the skill's scope rule
  (create only `packages/theme-<id>`, never touch shared docs/registration) end-to-end.
- Q-D4 — Confirm the DS skills package **never imports `h2a`** (anti-cycle, §3).
- Q-D5 — Version pinning: which DS skills/version range does `h2a` resolve, given the DS's
  independent release cadence?

---

**Next:** double-consensus review, then negotiate the two surfaces with the graphify and DS
owners over h2a before any spec/plan. This is design-only; nothing is implemented and no
repo other than this doc is touched.

---

## Revue DS owner (Q-D1..D5) — corrections intégrées (2026-06-27, owner-validée)

Le DS owner valide le modèle fédération/coexistence et corrige les **verbes réels** (vérifiés dans son `cli.ts`).

**Verbes réels du binaire** `@sentropic/design-system-skills` : `init / audit / audit:visual / audit:parity / build / check / align / polish`.

**Mapping `h2a design` corrigé :**
- **Dispatch DIRECT** (verbes binaires réels) : `h2a design lint` → `audit` / `audit:visual` / `audit:parity` ; `h2a design check` → `check` (gate 0-100) ; `h2a design build|align|polish|init` → dispatch direct.
- **`h2a design fidelity`** = **alias de `audit:parity`** (edge-by-edge vs DSFR/Carbon = la preuve a11y/WCAG-AA). ⚠️ PAS un verbe binaire.
- **`h2a design tokens`** = **wrapper fédéré** (`init --extract` DESIGN.md depuis CSS réel + packages tokens/themes inspect/export). ⚠️ PAS un verbe binaire.
- **`h2a design theme clone`** = **wrapper fédéré** sur le skill `ds-theme-clone` (hors binaire) ; doit préserver de bout en bout sa règle de scope (crée UNIQUEMENT `packages/theme-<id>`, ne touche jamais docs/registration/lockfile partagés).
- **`h2a design views`** = **wrapper** sur le package contrat (hors binaire, cf. ci-dessous).
→ Règle : dispatch direct pour les verbes binaires réels ; `fidelity`/`tokens`/`theme-clone`/`views` = wrappers fédérés explicites (sources ≠ binaire).

**Q-D2 — contrat de vues** : le **DS est l'owner canonique**, **versionné** (semver sur le futur `@sentropic/design-system-views`) ; contrat de rendu unique consommé par track/h2a/knowledge/sentropic (aligné track/INTENTION + chat-ui-contract).

**Q-D4 — anti-cycle (invariant DUR non-négociable)** : les packages DS **n'importent JAMAIS h2a** ; flèche one-way `h2a → design` ; seul croisement toléré = **lecture d'un contrat de données stable documenté**, jamais un import de code.

**Q-D5 — version pinning** : binaire skills **pas encore publié npm** (parqué post-WP8 + rename) → résolution PATH/optionalDependency/workspace en attendant. Une fois publié : h2a épingle un **range CARET `^MAJOR`** (cadence DS indépendante), `h2a doctor` signale si la version résolue est hors-range ; la **table de fédération porte le range**, pas un pin dur.

**Statut `h2a design` : owner-validé** (modèle + verbes réels + anti-cycle + pinning). Reste séquencé derrière BR-42 + le pixel-perfect DS.
