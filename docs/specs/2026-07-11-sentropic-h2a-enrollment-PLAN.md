# h2a ↔ sentropic enrollment — implementation PLAN (lot-based)

Companion to the double-GO design `2026-07-11-sentropic-h2a-enrollment.md` (+ §11 remote-control).
Lots are reversible increments, split **a2a-cli CLIENT** (this repo) vs **sentropic SERVER** (the
`~/src/sentropic` repo — out of scope for a2a-cli PRs, listed for sequencing). Blockers flagged.

## Lot 0 — client foundation (a2a-cli, pure, DEPENDENCY-FREE) — ✅ done in this branch
Pure, testable libs behind IO seams; no live 39-auth / server call. `packages/h2a-runtime/src/sentropic/`:
- `auth-token.ts` — the `~/.sentropic/h2a-auth.json` (0600, atomic) token model, **per-server
  namespace + `assertServerBound`** so a 39-auth token is never sent to another `--server` (§3).
- `enroll-flow.ts` — D1 flow SHAPE: PKCE-S256 authorize request + CSRF state, device-code poll
  backoff/expiry; the HTTP exchange is a `TokenExchange` seam (not implemented here).
- `bind-decision.ts` — C3 create-or-bind DECISION (§4): scoped lookup (no global first-wins),
  name≠identity, admin-gated explicit bind, multiple-visible→ambiguous, (workspace,fingerprint) pair
  routes uploads. Pure.
Tests: 21 unit tests (bind matrix, server-binding anti-exfil, PKCE/device backoff). Capability
separation (bind ≠ upload) is enforced by the plan consumer (Lot 1), not this layer.

## Lot 1 — client CLI + live auth/bind (a2a-cli) — needs Lot S1
Wire an `h2a sentropic enroll|bind|status` verb group over the Lot 0 libs: implement the
`TokenExchange` seam (real 39-auth browser + device-code) reusing the OAuth broker
(`packages/h2a/src/runtime/mcp-http/oauth/{oidc-rp,broker-login,crypto}.ts`); fetch the caller's
authorized workspaces + visible bindings from the sentropic API; render the C3 printed plan + one
confirmation. Adds CLI verbs → update `docs/contracts/golden/cli-verbs.json`, keep contract green.
**Blocked on Lot S1** (server endpoints must exist to fetch/bind).

## Lot S1 — sentropic SERVER API (sentropic repo) — out of a2a-cli scope
Enrollment import endpoint (largely PR #392), list-authorized-workspaces + list-bindings, create/bind
workspace (admin-gated), the **device-code IdP leg at 39-auth** (new upstream work). Per-user tenancy.

## Lot 2 — MCP-via-sentropic (EVO-12 broker) — a2a-cli + sentropic → *brique 1*
Expose the h2a MCP through the sentropic gateway per-tenant (DCR + 39-auth login + per-user root).
Tracked as EVO-12 gateway broker. Reuses `packages/h2a/src/runtime/mcp-http/*`.

## Lot 3 — session remote-control (§11) — a2a-cli + sentropic → *the "Code"-app UX*
Expose the EXISTING session control through the sentropic MCP gateway + a per-tenant control API +
a hosted session-list render:
- **local**: reuse `packages/h2a-runtime/src/tmux.ts` (`listLocalSessions`/`capturePane`/`attach`/
  local-tmux wake) + the new `readLaunchContext`.
- **k8s remote**: reuse the Pod-tmux exec/attach path.
- **liveness honesty**: a session shown `Connecté` must be verified live (presence + heartbeat), not a
  stale one (cf. the mcp-disconnect false-live hazard). No server-side minting of a human action.

## Lot 4 — conversation capitalization — a2a-cli + sentropic → *brique 2* — ⛔ BLOCKED
Encrypt-at-rest upload (client key) + generation hash-chain + resume (§6/§7). **Blocked by the §10
plan-tier decisions: (a) key custody/rotation mechanism, (b) per-host (Claude vs Codex) resume
verification matrices.** Do NOT start until the owner settles both.

## Lot 5 — hosted dossier + report presentation — sentropic → *brique 3*
Render the EVO-4b decision-canevas + the unified report (already built + merged here) **server-side in
sentropic**, per-workspace + neutral super-view ("artifacts"-like). RENDU only; client-side signature
never server-minted (EVO-4/4b invariants).

## Critical path to the first visible "h2a in sentropic" milestone
Lot 0 (done) → Lot S1 + Lot 1 (enroll/bind live) → Lot 2 (MCP via sentropic) + Lot 3 (session
remote-control) + a thin Lot 5 read view. Lot 4 waits on the two §10 decisions.
