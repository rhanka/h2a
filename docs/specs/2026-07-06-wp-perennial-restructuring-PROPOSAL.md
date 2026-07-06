# Restructuring h2a workpackages into perennial themes — PROPOSAL (x8)

> **STATUS: PROPOSAL FOR CONSENSUS — NOT APPLIED.**
> This is an INPUT for a consensus, not a decision. Nothing in track is restructured, no item is
> reparented by this document. Ratification path: **architect + double-consensus (Opus-4-8 max +
> Codex 5.5 xhigh)**, then **`present-decision` to Fabien (PRINCIPAL)**. Only after ratification would
> the reparent plan below be written to track.
> Date: 2026-07-06 · Study: x8 / WP-ROADMAP · Conductor: claude:a2a-cli · Grounding: read-only over git + track.

---

## 1. The problem — milestone-WPs vs perennial-theme-WPs

Today's WPs are **milestones**, not themes. A milestone-WP is scoped to a bounded push and **closes at
100 %, then disappears from the active picture**:

- `WP-A Addressing & routing` → **7/7 (100 %)**, "WP clos".
- `WP-B Identity & workspace` → **4/4 (100 %)**, "WP clos".
- `WP-MIG Migration track+remote → h2a` → **4/4 (100 %)**, "WP clos".

But addressing is not *done* — it went 0.40 → 0.41 → 0.54 → 0.56 → 0.59 → 0.60 → 0.64 and **will keep
moving** (EVO-10 availability presence, future routing work). When the WP that owns it is closed, the
next addressing item has **no home**, and the 100+ commits of *past* addressing work are no longer
attributable to a living container. Same story for identity, for the migration, for governance.

A **workpackage should be a perennial theme** — a durable **owning concern** that **never closes** and
**accumulates past and future work**. A *milestone* ("ship 0.64 reach-guard", "merge remote into h2a")
is then a **stream / sub-milestone INSIDE a theme**, which may close; the theme stays open.

### Acceptance criteria for this study (x8)
1. **WP = perennial themes, not milestones.**
2. **Full coverage start → future**: every one of the **746 commits** since init (2026-05-18), *including
   the pre-addressing ones*, AND every future item, is attributable to **exactly one** theme-WP.
3. **Ratified by consensus**, not ad-hoc.

---

## 2. Method & grounding

Applied the `propose-workpackages` skill (cluster by **durable concern / owning artifact**, down-weight
milestone/date prefixes `WP-x`/`EVO-n`/`Lot`/`Pn`/`v0.x`, reject "misc"/single-ticket/milestone-only
names, one item → one parent, splits not multi-homes). Grounded on real data, not memory:

- **Git history** (746 commits, 2026-W21…W28): conventional-commit **type/scope** distribution + reverse
  sampling of the first ~110 commits (pre-addressing) and the W23/W27 windows.
- **Track** (`query --role workpackage`, `item ls`, event-log parent reconstruction from
  `.track/events.jsonl`): the 10 current WP-role items and their 60 children.
- **Existing model**: `2026-06-28-h2a-finalites-spec.md` (the **5 finalités**, already double-consensus
  ratified v1.1) and `2026-06-27-h2a-sentropic-resegmentation.md` (neutral *-protocol packages). The 5
  finalités are themselves a strong perennial-theme candidate and are treated as the **spine** below.

**What the history shows**: the recurring natures of work are visible **from commit #2**, long before
addressing. The scope distribution and the early sample prove the themes below already existed at init:

| Recurring nature (theme) | First appears | Evidence |
|---|---|---|
| Governance / RACI | **commit #2** | `79b3d31 docs: define h2a governance model`; DEC-039..048 declarative profiles (disclosure/recourse/obligation/jurisdiction) |
| Protocol & envelopes | commit ~#6–10 | `1f7a5ce append-only journal + ed25519`; `71999bf typed negotiate offer/counter`; `a88aaba session protocol vocabulary` |
| Coordination & loop | ~#18 | `858ee2a file-backed inbox/outbox`; `0975cba PRINCIPAL/CONDUCTORS`; later drumbeat/wake/objective-loop |
| Addressing & presence | ~#68 | `29fd91e session lifecycle + heartbeat + presence (DEC-051)`; `fe8b3f7 MCP push notifications` |
| Distribution / CLI / plugin | ~#8 | `c40cf9d npm publication`; `ca15fbb MCP server stub`; `8a89873 install-skills` |
| Infra / deploy / MCP | ~#100 | `cf57d69 K8s sidecar manifest + deploy verb`; `d6dc55b OCI image + GHCR` |
| Execution / hosts / runtime | ~#42 | `1b78d8d host setup adapter Codex/Claude`; `c44e573 rename remote-controle → remote` |
| Quality / CI / release | ~#55 | 136 `release:` commits; `dc3459f ci matrix ubuntu/macos/windows`; cross-platform runner |

Scope frequency (whole history): `track`(114), `h2a-cli`(39), `h2a`(27), `identity`(21),
`evo9/12/13/7/1/8/0/3/11`(~70 combined), `loop`(9), `drumbeat`(7), `wake`(6), `governance`(5),
`migration-p*`/`p5`(~10), `nhi`(4), `mcp`(3), `canevas`(4). These cluster cleanly onto the theme set below.

---

## 3. Proposed model — 5 finalités (spine) × perennial theme-WPs (imputation unit)

Recommendation: a **two-level perennial structure**, not a flat re-cut.

- **Level 1 — the 5 FINALITÉS** (`Coordonner · Exécuter · Suivre · Administrer · Étendre`). Already
  double-consensus ratified; product-facing; proven to cover the 255-command mapping. **Do not
  re-litigate them** — reuse them as the durable spine.
- **Level 2 — perennial THEME-WPs** nested under each finalité. This is the **owning-concern container
  and the imputation unit** (each commit / item lands on exactly one theme). Finalités alone are too
  coarse: collapsing `WP-A Addressing` and `WP-D Governance` both into "Coordonner" would erase the
  owner-seam the skill requires us to preserve (addressing ≠ governance ≠ protocol are different owners).
- **Milestones become STREAMS inside a theme.** `WP-A`, `WP-MIG`, `EVO-n`, `Lot-n`, a release train — all
  become closable **streams / sub-milestones** under a theme. track already supports this: `role:'stream'`
  (epic tier, S`<n>`, shipped) and a WP-under-WP guard exist. The theme never closes; the stream does.

**Why not just the 5 finalités as the WPs?** Viable (leanest option) and it satisfies criteria 1–2, but
it loses granularity for piloting (`%`-by-finalité is too aggregate to be actionable) and buries strong
owner-seams. **Why not 12 flat themes with no finalité layer?** Loses the ratified product spine and
re-opens a settled taxonomy. The two-level model keeps both. Granularity is an **open question** (§7 Q1).

---

## 4. Proposed perennial theme-WP set (11 + 1 optional)

Each theme: durable owning-concern, an explicit scope boundary (what is NOT here → where it lives), and
what it covers **past + future**. Non-positional `sourceKey` slugs (never a milestone name).

### Coordonner (the bus — who talks / decides / conducts)
| # | Theme (`sourceKey`) | Owning concern (durable definition) | Covers past → future |
|---|---|---|---|
| TH-PROTO | `theme:protocol-envelopes` | The wire contract: artifact schemas, envelopes, ed25519 signatures, negotiation offer/counter/sign/stabilize, escalation routing, `session-protocol` neutrality. **NOT** who is reachable (→ADDR), NOT the record (→TRACK). | Init journal/signatures → typed negotiate → envelope field-validation → future protocol versions |
| TH-ADDR | `theme:addressing-presence` | Reachability & truthful presence: session lifecycle, heartbeat, liveness/keepalive, discover, routing, host-qualified addressing, inbox/threading, connection-confidence. **NOT** the schema (→PROTO), NOT identity keys (→ID). | DEC-051 presence → 0.40 slug-stable → 0.64 reach-guard → false-live remediation → EVO-10 availability |
| TH-COORD | `theme:coordination-loop` | Active coordination: conductor election/drumbeat, wake/relance, mailboxes, **objective-loop** engine, anti-stall. **NOT** governance rules (→GOV), NOT the transport mechanism itself (→EXEC/INFRA). | inbox/outbox → CONDUCTORS → drumbeat/wake → EVO-1/2/3 relance → future loop work |
| TH-GOV | `theme:governance-raci` | Governance & authority: RACI, policy-precedence/disclosure/recourse/obligation/jurisdiction profiles, CoI / anti-COI, mandate, conductor election rules, trust (INTÉRÊT/CONFIANCE). **NOT** the identity crypto (→ID). | commit#2 governance model → DEC-039..048 → CoI gate → EVO-7 coach / EVO-9 trust → future |

### Exécuter (launch / pilot an agent, wherever it runs)
| # | Theme | Owning concern | Covers past → future |
|---|---|---|---|
| TH-EXEC | `theme:execution-runtime` | Launch & lifecycle of agents: host adapters (claude/codex/gemini/hermes/opencode), native h2a agent, run/attach/stop/logs/resume, delegate/jobs, sandbox/greywall, remote runtime, k8s exec backend. **NOT** the deploy manifests/infra (→INFRA), NOT identity-of-actor (→ID). | host adapters → remote(-controle) → EVO-0 agy parity → OPTIM runtime → x6 greywall / x10 attach fix → WP-CLI hosts |

### Administrer (identity, keys, hosts, deploy, MCP, liveness plumbing)
| # | Theme | Owning concern | Covers past → future |
|---|---|---|---|
| TH-ID | `theme:identity-auth-nhi` | Identity, auth & NHI: identity binding, proof-of-possession, git-derived workspace-id, provider-conversation re-anchor, 39-auth/OIDC RP, per-user root, keys/sign/revoke, NHI lifecycle/offboard, capability tokens. **NOT** presence liveness (→ADDR). | DEC-116 binding → per-workspace id → re-anchor → 39-auth/rootForSub → DEC-089 NHI offboard → future h2h2a |
| TH-INFRA | `theme:infra-deploy-mcp` | Deploy & wiring substrate: k8s/SCW/OCI/GHCR deploy, MCP connectors/wiring, gateway/mesh infra, mirror-ingester, `.h2a` root hygiene/prune, LLM account/mesh config. **NOT** the exec loop (→EXEC), NOT gateway *identity* (→ID). | k8s sidecar/deploy → OCI/GHCR → EVO-13 ingester → x1 bus cleanup / x2 gateway proxy / x4 MCP connectors / x9 broker |

### Suivre (state / record of work)
| # | Theme | Owning concern | Covers past → future |
|---|---|---|---|
| TH-TRACK | `theme:tracking-record` | The record: `@sentropic/track` package (record-only append-only log), report/decision/acceptance/provenance, canevas / decision screens, backlog structuring (incl. this x8 study). **NOT** governance logic (→GOV, track only validates+stamps). | DECISIONS.md → track SPEC/MVP → façade h2a→track → canevas → x8 restructuring |

### Étendre (additive capabilities & method)
| # | Theme | Owning concern | Covers past → future |
|---|---|---|---|
| TH-METHOD | `theme:method-harness` | Dev method: harness kernels (brainstorm/plan/review/test/verify), spec-ladder, scope-gate. **NOT** the tracking of results (→TRACK). | early SPEC/PLAN reviews → harness adoption → future method work |
| TH-DIST | `theme:distribution-cli-packaging` | Front-door & shipping: CLI syntax/verb mapping, single plugin/marketplace, install-skills, npm publish, release cadence, CLI auto-upgrade. **NOT** deploy infra (→INFRA). | npm publish → MCP server → install-skills → 255-cmd mapping → EVO-8 auto-upgrade → x5 sentropic align |
| TH-EXT | `theme:extensions-knowledge` | Additive tools keeping their own surface: graphify/knowledge, design-system, agent-stats/stats, agent memory/context. **NOT** the core bus. | graphify/design/agent-stats integration → x7 centralized memory → future extensions |

### Cross-cutting (optional 12th — open question §7 Q4)
| # | Theme | Owning concern | Covers past → future |
|---|---|---|---|
| TH-QUALITY | `theme:quality-ci-release` | Release quality: CI matrix / cross-platform / Windows, contract-tests, version-matrix, golden fixtures, test-bus isolation, 136 release trains. **Candidate to FOLD** each test into the theme it verifies instead. | ci matrix → cross-platform runner → migration golden/version-matrix guards → future CI |

---

## 5. Mapping — current milestone-WPs & items x1..x10 → theme (proof of coverage)

### 5.1 Current WP-role items → theme
| Current WP (milestone) | → Theme(s) | Note |
|---|---|---|
| WP-A Addressing & routing (7/7) | **TH-ADDR** (+TH-PROTO for envelope-validation item) | becomes a closed *stream* under ADDR |
| WP-B Identity & workspace (4/4) | **TH-ID** (+TH-ADDR for host-native session names) | closed stream under ID |
| WP-C Keepalive, presence & infra | **SPLIT**: presence/keepalive/liveness→ADDR · root/doctor/hygiene→INFRA · release/Windows-CI + test-bus-isolation→QUALITY | a bundle of 3 concerns |
| WP-D Governance (RACI/conductor) | **TH-GOV** (+TH-COORD for conductor-launch/drumbeat items) | |
| WP-E EVO roadmap (8/19) | **DISSOLVE** — pure milestone bucket: EVO-0→EXEC · EVO-1/2/3→COORD · EVO-7/9→GOV · EVO-8→DIST · EVO-10→ADDR · EVO-12→INFRA/ID · EVO-13→INFRA · DEC-089→ID · OPTIM→EXEC | clearest example of a non-theme |
| WP-F MCP-disconnect / false-live | **TH-ADDR** (presence honesty) (+TH-EXEC for host stdio reconnect) | |
| WP-MIG Migration track+remote→h2a (4/4) | **DISSOLVE**: façade track→TRACK+DIST · remote merge→EXEC · anti-cycle/contract-guard/golden→QUALITY · publish/release→DIST | milestone; work re-homed by concern |
| WP-CLI Support Hermes/OpenCode | **TH-EXEC** (host adapters) (+TH-DIST packaging) | |
| WP-ROADMAP / x8 (this study) | **TH-TRACK** | backlog structuring = record meta |
| Mapping CLI finalisé (255 cmds) | **TH-DIST** | |

### 5.2 Items x1..x10 → theme (x3 absent — gap in the x-series)
| Item | → Theme | Current parent |
|---|---|---|
| x1 — cleanup 6 local `.h2a` buses | TH-INFRA | WP-C |
| x2 — gateway/Claude subagent proxy bug | TH-INFRA | WP-F |
| x4 — h2a mcp to register MCP connectors | TH-INFRA | WP-E |
| x5 — h2a↔Sentropic integration + workspace alignment | TH-DIST (+TH-INFRA) | WP-E |
| x6 — Greywall transparent policy around CLIs | TH-EXEC | WP-E |
| x7 — centralized agent memory/context multi-session | **TH-EXT** *(candidate new concern — see Q2)* | WP-E |
| x8 — WP restructuring study | TH-TRACK | (self) |
| x9 — own CLI / gateway broker | TH-INFRA (+TH-DIST) | WP-CLI |
| x10 — h2a attach breaks on local session + [remote] branding | TH-EXEC | WP-MIG |

### 5.3 Historical commit sample → theme (spread across the whole timeline — proves start → future)
| Commit | Week | → Theme |
|---|---|---|
| `79b3d31 docs: define h2a governance model` | W21 (#2) | TH-GOV |
| `1f7a5ce append-only journal + ed25519 signature` | W21 | TH-PROTO |
| `29fd91e session lifecycle + heartbeat + presence (DEC-051)` | W21 | TH-ADDR |
| `cf57d69 K8s sidecar manifest renderer + deploy verb (DEC-058)` | W21 | TH-INFRA |
| `c479353 fix(identity): perennial id per (host, workspaceId)` | W23 | TH-ID |
| `e195823 initial intention for @sentropic/track` | W23 | TH-TRACK |
| `a596b4e feat(evo1): inbox-wake hook (signed wake on arrival)` | W23 | TH-COORD |
| `b41755d feat(evo12-p2): 39-auth OIDC RP core` | W23 | TH-ID |
| `aa093d2 feat(P3): façade track — h2a decision/report delegue` | W27 | TH-TRACK (+DIST) |
| `e30f0b9 release: v0.76.0` | W27 | TH-QUALITY |
| *(future)* x7 centralized memory · x6 greywall | future | TH-EXT · TH-EXEC |

Coverage demonstrated **commit #2 (W21) → commit #746 (W27) → future items** — no orphan period.

---

## 6. How to impute a commit to a theme (mechanics — for consensus)

A perennial theme is only pilotable if every commit/item is deterministically attributable. Options:

- **Option A — theme = derived from the existing conventional-commit `scope`** via a maintained
  `scope → theme` lookup (e.g. `identity|nhi → TH-ID`, `evo13|deploy|mcp → TH-INFRA`, `loop|drumbeat|wake
  → TH-COORD`). **Pro**: zero new author friction, works retroactively on all 746 commits. **Con**: needs
  a lookup table kept current; ambiguous scopes (`track` = tool-dev vs record) need a rule.
- **Option B — explicit `Theme: <slug>` trailer** on each commit going forward. **Pro**: unambiguous,
  self-describing. **Con**: author discipline; retroactive history still needs Option A.
- **Option C — impute at the track layer only** (items → theme via `parentId`; commits ride the item
  they realize through `assign-code`). **Pro**: no commit-message convention. **Con**: loose commits
  (releases, hygiene) not tied to an item are unattributed.
- **Recommendation**: **A for the 746 historical commits + a small fixed scope vocabulary aligned to the
  themes going forward; C at the track layer for items** (parentId → theme-WP, milestones as streams).
  B optional for cross-cutting commits. To decide by consensus (Q3).

---

## 7. Open questions for the consensus

- **Q1 — Granularity / level.** Two-level (5 finalités × ~11 themes) as recommended, OR the 5 finalités
  *are* the WPs (leaner, `4–7` skill target) OR ~11 flat themes without the finalité spine? Trade-off:
  pilotability & owner-seams vs simplicity.
- **Q2 — New concerns.** Does `x7 centralized memory/context` warrant its own perennial theme
  (`theme:memory-context`) rather than folding into TH-EXT? Any other emerging concern under-served by
  the set (e.g. gateway/LLM-mesh as its own theme vs inside TH-INFRA)?
- **Q3 — Commit→theme mechanics.** Ratify Option A/B/C (§6). Which authority maintains the
  `scope→theme` lookup, and how is the `track` scope (tool-dev vs record) disambiguated?
- **Q4 — Quality/CI/release.** Standalone TH-QUALITY (12th theme) vs fold each test/release into the
  theme it verifies (skill's "no catch-all" preference)? 136 release commits + CI is a real perennial
  concern but risks becoming a bucket.
- **Q5 — Milestones-as-streams representation.** Confirm milestones (`WP-A`, `WP-MIG`, `EVO-n`, `Lot`,
  release trains) map to `role:'stream'` (S`<n>`) under a theme-WP, closable, `%` rolled up to the theme
  which never closes. Does the WP-under-WP guard + stream tier already cover this, or is a 3rd tier
  (finalité) a new role?
- **Q6 — Migration of existing items.** For the ~60 current children: bulk reparent by the §5 table, or
  split the multi-concern bundles (WP-C, WP-E, WP-MIG) first? Splits (not multi-homes) per the skill.

---

## 8. Status & next step

**PROPOSAL for consensus — NOT applied.** No reparent, no new WP written by this document.

Ratification path (as required by acceptance criterion 3):
1. **Architect + double-consensus** (Opus-4-8 max + Codex 5.5 xhigh) on the theme set + granularity (Q1).
2. **`present-decision` to Fabien (PRINCIPAL)** — a consequential, cross-owner restructuring of the whole
   backlog qualifies for the full dossier path (options = candidate WP cuts with case for/against), not a
   quick ask.
3. Only on approval: apply the §5 reparent/split plan via the track CLI (create theme-WPs, `item
   reparent`, milestones → streams), then verify `%` rollup with `track report`.
</content>
</invoke>
