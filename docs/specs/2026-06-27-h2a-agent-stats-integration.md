# `agent-stats` ↔ `h2a` — Integration (brainstorm / design-only)

**Status: design-only. No code, no plan.** Companion to
`2026-06-27-h2a-unified-cli-syntax.md` and `2026-06-27-h2a-agent-naming-brainstorm.md`.
Answers: what is `agent-stats`, what do the codex-claude artifacts add as *complements*,
and **how — if at all — does `h2a` take them up** without breaking the segmentation boundary
already decided in `../codex-claude/segmentation/`.

Read-only sources this session: `agent-stats` (README/plan/CHANGELOG/package.json + `packages/`),
`codex-claude` (`strategy-token-economy.md`, `segmentation/synthese.md` + `plan.md`, `cliproxy/`),
npm registry, and `graphify` (real downstream).

---

## 1. What `agent-stats` is (product + surface) — and what codex-claude adds

**Product.** A **session analyzer** for agentic CLIs (Claude Code, Codex, Cursor, Gemini/agy):
it reads on-disk vendor session folders (`~/.claude/projects`, `~/.codex/sessions`, Cursor SQLite,
`~/.gemini/tmp`), normalizes them to a common `SessionEvent` schema, and produces
**weekly/daily aggregations** (tokens split new/cached/cache-write/output/reasoning),
**honest cost** (Codex credits / Claude notional `~$`), **rate-limit quota peaks** (5h/7d),
**anomaly heuristics** (user frustration + AI-out-of-control), **tool/skill usage**, and
**secret redaction** (`clean`, secretlint). It carries git provenance (`gitBranch`/`gitCommit`/
`repoUrl`) and detects Codex subagent forks (`forkedFromId`/`subagentDepth`).

**Surface.**
- `@sentropic/agent-stats-core` — parsers + schema + aggregations + rate-card + anomalies + cleanser (lib).
- `@sentropic/agent-stats` — CLI binary `agent-stats`: `stats · report · anomalies · clean · analyze · web` (`bench` planned).
- `@sentropic/agent-stats-web` — Svelte/Vite local dashboard (the published surface).
- Federated as `stp agent-stats` (umbrella sub-command).

**Published / used?** **Yes, and it has a real consumer.** `@sentropic/agent-stats` and
`@sentropic/agent-stats-core` are on npm (latest **0.2.0**; local repo at **0.3.0**, web not published).
**`graphify` depends on `@sentropic/agent-stats-core` as an OPTIONAL peer dependency** (`^0.3.0`,
`src/conversations.ts`, shipped via graphify PR #173) — the `conversations` connector decided in
segmentation. So agent-stats is **not a toy**: it is a shipped lib with a downstream contract.

**What the codex-claude artifacts add (the "complementary elements").**
- **`strategy-token-economy.md`** — a *measured, no-marketing* economy analysis (matchID = 91% of
  Codex from one 32-day parent thread replayed per subagent spawn; RTK debunked at 0.2% real saving;
  CLIProxyAPI OAuth-wrapping judged structurally fragile; Anthropic/OpenAI postures). This is the
  **analytics methodology + the governance signals** behind agent-stats' cost/quota/anomaly layer —
  in particular *quota-wall* and *runaway-parent-thread* detection.
- **`segmentation/`** — the **decided architecture** (2026-06-07, double-consensus): graphify = the
  only graph engine; **agent-stats inverted to "shared normalization lib + analytics + publication"**;
  the conversations→graph projection lives in graphify (not agent-stats, not h2a); stp owns the
  `AnalysisSurface` manifest; **AgenticWork is split: Observation ≠ Identity (h2a)**.
- **`cliproxy/`** — a *vendored third-party binary* (CLIProxyAPI 7.0.0) used only as a measurement
  substrate for the OAuth-bypass economy. **Not a product to absorb anywhere**; token-economy doc rates
  it "non-action stratégique". It informs the sentropic llm-mesh/gateway thread, nothing in h2a.

## 2. Integration model — ADDITIVE (federated), not ABSORBED

`h2a` absorbs CLIs whose domain *is* coordination plumbing (`remote`→`agent`, `track`, `harness`).
`agent-stats` is **not** that domain. Recommendation: **ADDITIVE / federated — like graphify and
design, not like track/remote.** `agent-stats` keeps its own CLI, repo, and release cadence; `h2a`
does **not** vendor it. Rationale:

1. **It is published + has a live downstream contract** (graphify's optional peer dep). Folding it into
   h2a would break a federated seam that already ships.
2. **Segmentation already assigned it a separate role** — "shared normalization lib + analytics +
   publication", explicitly *not* a graph engine and *not* coordination. Absorbing it re-merges the
   Observation≠Identity split the synthesis deliberately made.
3. **Format-churn isolation.** Vendor session formats churn fast (codex rollout sub-agents, `turn_context`);
   the synthesis warns against coupling a stable CLI's release cadence to that race. h2a (signed identity/
   coordination) must not inherit the vendor-format treadmill.
4. **Domain hygiene.** h2a = source of truth for roles/sessions/signatures/negotiations. agent-stats =
   observation/telemetry over disk artifacts. Different sources of truth → no merge.

**So "h2a reprend des éléments complémentaires" ≠ absorb.** It means h2a may **consume** agent-stats-core
(read-only, optional dep, the graphify pattern) to *annotate its own agent instances* with measured usage,
and may consume the token-economy *signals* to gate coordination decisions. The lib flows **into** h2a;
the analytics product stays standalone.

## 3. Candidate h2a surface — `h2a agent stats` (instance-scoped), not bare `h2a stats`

Reconciled with the **decided `agent` taxonomy** (naming-brainstorm MF1: `agent` = *runtime instances I
launch/supervise*, never bus peers / NHI / sub-registry):

| Candidate | Verdict | Why |
|---|---|---|
| `h2a agent-stats` | **Reject** | Hyphenated verb baking the product name; breaks the verb-first grammar and *implies absorption* of the standalone product. |
| `h2a stats` (bare) | **Reject** | `stats` is not a Tier-1 transverse verb. A bare top-level would claim h2a owns cross-vendor analytics — contradicting the segmentation boundary (analytics = agent-stats, viewer = stp surface) and colliding conceptually with `report` (work) / `status` (inventory). |
| **`h2a agent stats <slug\|id>`** | **Recommend** | Under `agent` = my launched instances, a **namespaced, instance-scoped** read-only projection of that instance's measured tokens/cost/quota — *delegating to agent-stats-core*, reimplementing nothing. |

**Why instance-scoped is the only taxonomy-clean reading.** MF1 says `h2a agent ls` = *my* launched
instances, never the estate. agent-stats analyzes *all* on-disk sessions regardless of who launched them —
that estate-wide, cross-vendor view is **out of scope for `agent`** and **stays in the standalone
`agent-stats` CLI** (`stp agent-stats stats|report|web`). `h2a agent stats <id>` only answers
"what did *this instance I launched* burn?" by mapping the instance → its session(s) and asking
agent-stats-core. Distinct from `agent status <id>` (current health snapshot) because stats is the
time-series tokens/cost/quota roll-up. Bare `h2a stats` may exist *only* as a deprecated alias to
`stp agent-stats`, never as an owned h2a verb.

## 4. Where the codex-claude complements go

| Element | Home | Note |
|---|---|---|
| Parsers + `SessionEvent` schema + cleanser | **`agent-stats-core`** (shared lib) | Already consumed by graphify; h2a may add the same optional dep. |
| Conversations → graph projection | **graphify** (`conversations` connector) | Decided; shipped (PR #173). Not h2a. |
| Dashboard / surface viewer | **stp `AnalysisSurface`** (= `agent-stats-web`) | stp owns the surface manifest; viewer embeds graphify's HTML export. |
| Cost rate-card / quota / anomaly **measurement** | **agent-stats-core** | The honest-measurement methodology from `strategy-token-economy.md`. |
| Governance **use** of usage signals (quota-aware wake / reap / conductor election) | **h2a capability** consuming agent-stats-core read-only | The genuine "h2a reprend" — quota-wall + runaway-parent-thread become liveness/health gates for the conductor/drumbeat (cf. h2a-governance vision: h2a = gatekeeper of wakes). |
| Multi-account / OAuth-proxy economy (`cliproxy`) | **sentropic llm-mesh / gateway** (research stays in codex-claude) | Measured *by* agent-stats; never owned by h2a. Token-economy doc: non-strategic. |

## 5. Anti-cycle invariant (hard constraint)

**Dependency direction is one-way: `h2a` → `agent-stats-core` → (nothing of h2a).** Verified today:
**no `agent-stats` or `codex-claude` code imports `h2a`/`a2a-cli`** (only markdown mentions). This MUST
hold:
- `agent-stats` stays a *pure observation tool over on-disk session folders*; it must **never** depend on
  h2a presence/bus/identity. Its input is the filesystem, not the coordination plane.
- If h2a annotates instances with stats, **h2a imports agent-stats-core** (optional dep, lazy `await import`,
  `external` in bundling) — exactly graphify's proven pattern — **never the reverse**.
- The instance→session mapping (h2a instance id → vendor `sessionId`/conversation UUID) lives in **h2a**,
  derived from data h2a already holds; agent-stats receives an opaque id, not an h2a type. No shared TS types
  across the seam (segmentation rule: couplings are process-/lib-level only).

## 6. Questions for the agent-stats owner (rhanka)

1. **Schema-contract stability.** Can h2a treat `agent-stats-core`'s `SessionEvent`/aggregation API as a
   stable optional-peer contract (as graphify does), or wait for the mooted neutral rename
   `@sentropic/agent-transcripts`?
2. **Per-instance query.** Is there (or can there be) a session-scoped lookup keyed by `sessionId` /
   provider conversation UUID, so h2a can map *one launched instance* → its measured usage? (h2a's identity
   unit is now the provider conversation UUID — does agent-stats key compatibly?)
3. **Quota-wall as a consumable signal.** Should the Codex 5h/7d ≥95% rate-limit peak and the
   runaway-parent-thread pattern be first-class anomalies h2a's conductor can read to gate wakes/reaping —
   and where does the rate-limit window data live in the schema?
4. **Publish cadence.** npm latest is 0.2.0 while graphify pins `^0.3.0` (unpublished) and web is not
   published. Confirm release cadence + web publication before h2a or the stp surface takes a hard dep.
5. **Rate-card ownership.** Does `rate-card.ts` stay in agent-stats, or move to a shared sentropic pricing
   lib also used by llm-mesh/gateway (the cliproxy/multi-account economy)?
6. **Federation reconciliation.** Confirm `agent-stats` stays `stp agent-stats` (peer of graphify) and is
   *not* on the absorb-into-`h2a` list of the unified-syntax doc.

---

### Evidence
- `agent-stats/README.md`, `plan.md`, `CHANGELOG.md`, `package.json`, `packages/{core,cli,web}` — product + surface.
- npm: `@sentropic/agent-stats(-core)@0.2.0` published; `-web` 404 (unpublished).
- `graphify/package.json` (optional peer `@sentropic/agent-stats-core ^0.3.0`) + `graphify/src/conversations.ts` — real downstream.
- `codex-claude/segmentation/{synthese,plan}.md` — the decided boundary (agent-stats = lib+analytics+publication; graphify = graph; stp = surface).
- `codex-claude/strategy-token-economy.md` — measured methodology + governance signals; `cliproxy/` = vendored CLIProxyAPI binary (non-strategic).
- Anti-cycle: grep confirms no h2a/a2a-cli import in agent-stats/codex-claude code.
