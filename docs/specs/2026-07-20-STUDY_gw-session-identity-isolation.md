# STUDY — gateway session-identity isolation ("local-dev" collapse)

- **Trigger:** agy investigation — "avec la gw claude devient très con". Verified against real code 2026-07-20.
- **Status:** verified + proposal + action plan. No code changed yet.

## TL;DR

agy's diagnosis is **correct and code-anchored**, with one important attribution
correction: the collapse is caused by the **h2a consumer sending a STATIC
`sessionId: "local-dev"`** to the gateway, NOT by an aggressive rebind in the
gateway (the gateway explicitly does "no silent rebind"). Every local h2a session
— interactive terminal, objective loops, fan-out members, subagents — shares one
gateway session, hence one sticky lease, hence one upstream account. The fix is
primarily **h2a-side**: derive and thread a **unique `clientSessionId` per session**.

## Evidence (anchors)

- **Static id, consumer side (root):** `packages/h2a-runtime/src/llm-mesh.ts:495`
  (gateway startup) and `:619` (`acquireLlmMeshSessionEnv`, re-acquired per launched
  agent) both `POST /v1/session { sessionId: "local-dev", workspaceId }`.
- **Gateway owns the sticky file, keyed by the sessionId h2a passes:**
  `llm-mesh.ts:468` sets `LLM_GATEWAY_STICKY_FILE = llmMeshStickyPath()`; h2a-runtime
  only *names* the file, the gateway process reads/writes it.
- **Gateway already isolates per session (proof):** on-disk
  `~/.sentropic/llm-mesh-sticky.json` =
  `{"local-dev":"codex-oauth", "track-report-<uuid>":"{accountId:codex-oauth,requiredTransport:codex-responses}"}`.
  A flow that DID pass a unique sessionId (`track-report-<uuid>`) got its OWN isolated
  binding. So per-session isolation works when the id is unique.
- **Gateway does NOT silently rebind:** `node_modules/@sentropic/llm-gateway/dist/flow.js:13`
  and `ports/pool.js:10-12` — "sticky binding; **no silent rebind**"; `flow.js:62`
  `affinityKey: cost.correlationId`; `settle(... 'rate_limited' ...)` at `flow.js:171,228`.
  Failover is per-session, not a cross-session yank.
- **Per-session id IS available at the consumer call sites:** `index.ts` has
  `tmuxSession` in scope (`:1454,:1596,:1907` `const tmuxSession = local?.name ?? target`),
  `--name` (`:2120,:2200`), and `convId` (`:4738`, the conversation UUID / DEC-116
  re-anchor). The canonical-tmux-name work (commit 51c7259) already makes tmux names
  unique+stable per session.

## Verdict per claim

| # | agy claim | Verdict |
|---|---|---|
| 1 | Upstream cross-talk (all sessions share one upstream session id → model loses the thread) | **CONFIRMED (mechanism).** All callers share `sessionId:"local-dev"` → one gateway session forwarding upstream under one identity. "Becomes dumb" is the plausible consequence of shared session/context; severity depends on upstream provider behavior, but the shared-identity mechanism is real. |
| 2 | Routing/fallback domino: a background 429 flips the MAIN session to a dead fallback → 401 | **CONFIRMED, re-attributed.** Real, but NOT an aggressive gateway rebind (gateway = "no silent rebind"). Root = the SHARED `"local-dev"` lease: since all agents share one session/lease, a 429-driven failover of that single shared account affects every caller, including the untouched interactive one. Unique ids give each its own lease → no cross-session effect. |
| 3 | tmux status-bar pane collision keyed on session id | **PLAUSIBLE-PARTIAL.** Consistent with the shared-id root (status routing can't distinguish panes when all are "local-dev"); the exact gateway→pane mechanism is not fully pinned here — flagged as a mesh confirmation item. |
| 4 | Globalized quota (all local activity = one intensive client) | **CONFIRMED (corollary of 1+2).** One shared session/account ⇒ the provider sees one client ⇒ shared rate-limit budget. Unique per-session leases spread load across accounts. |

## Root cause (one line)

The h2a consumer hardcodes `sessionId: "local-dev"` (`llm-mesh.ts:495,619`) instead of
a per-session `clientSessionId`, collapsing all local sessions onto one gateway
session / sticky lease / upstream account. The gateway already isolates correctly
when given distinct ids.

## Split — h2a vs sentropic

- **h2a (primary, ~90%):** derive a unique `clientSessionId` per session and thread it
  `injectLlmMeshGatewayEnv(mode, …, clientSessionId)` (`index.ts:1859,1893,4735,5174`)
  → `acquireLlmMeshSessionEnv(dir, clientSessionId)` (`llm-mesh.ts:591`) → the
  `/v1/session` body (`:495,:619`). Source id = `tmuxSession` (canonical, unique per
  session) with `convId`/`--name` as refinements; subagents/fan-out/loops each derive
  their own.
- **sentropic/mesh (confirm-only, NOT 100% theirs):** confirm that (a) per-session
  failover never crosses sessions (a 429 on session A's leased account must not change
  session B's binding — the "no silent rebind" invariant, verified in flow.js, but
  confirm under the multi-session concurrent case), and (b) the tmux-pane status routing
  (claim 3) is keyed per session id. No new gateway feature is required for the core fix.

## Proposal — strict per-session identity

1. **`clientSessionId` = the session's canonical tmux name** (`tmuxSession`), which is
   already unique+stable (commit 51c7259) and 1:1 with a pane. Fallback to `convId`
   (conversation UUID) for headless/no-tmux, then a per-process UUID. NEVER a static
   literal.
2. Thread it as an OPTIONAL param end-to-end; **default preserves today's behavior**
   only for callers that don't yet pass it (so the change is incremental), but every
   real launch path passes the real id.
3. Each subagent / fan-out member / objective-loop executor derives ITS OWN id (so a
   subagent saturating an account never touches the parent's lease).

## Action plan (phased, small, testable)

- **Lot A (h2a) — thread clientSessionId (core):** add optional `clientSessionId` to
  `acquireLlmMeshSessionEnv` + the startup session acquire; replace the two `"local-dev"`
  literals; thread from `injectLlmMeshGatewayEnv` call sites using `tmuxSession`/`convId`.
  **Test:** two concurrent acquisitions with distinct ids write TWO distinct keys in
  `llm-mesh-sticky.json`; a simulated 429 on one key leaves the other's binding
  unchanged (no cross-session rebind). Regression: a single session still works (its own
  key instead of "local-dev").
- **Lot B (h2a) — subagent/loop propagation:** ensure fan-out members, objective-loop
  executors, and subagents each derive a distinct id (not the parent's). Test: parent +
  child get distinct keys.
- **Lot C (sentropic confirm):** joint check — per-session failover isolation under
  concurrency + tmux-pane routing per session id. Coordinate via the mesh lane; only
  becomes h2a work if a gateway gap is found.
- **Lot D (observability):** surface the resolved `clientSessionId` + bound account in
  `h2a status --human` / tmux status (ties into the L2b + tmux status-bar work).

**Irreversible/risky decision:** the id SCHEME (tmux-name vs convId vs uuid). Recommend
tmux canonical name (already unique/stable, human-legible in the sticky file, 1:1 with
pane). Migrating the scheme later means stale sticky keys — pick once. Low blast radius:
old shared-"local-dev" keys simply stop being written; a one-line GC can prune them.

**Blast radius today:** high user-visible impact (the 401s, "dumb" model, shared quota)
but bounded to the multi-concurrent-session case; single-session users are unaffected.
**Regression risk of the fix:** low — distinct keys are strictly more isolated; the only
risk is a caller path that fails to pass an id and falls back to a per-process UUID
(still isolated, just not stable across restarts — acceptable, and better than shared).

## Related
- DEC-116 / [[identity_reanchor_conversation]] (id unit = conversation UUID) — align the
  clientSessionId scheme with this.
- commit 51c7259 canonical tmux session names — the unique-id source.
- [[tmux_liveness_activatable_cr]] and the tmux status-bar design — share the per-session id.
