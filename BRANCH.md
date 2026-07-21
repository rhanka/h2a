# Fix: isolate Google pool and refresh Gemini OAuth

## Objective

- [x] Prevent Google/Gemini accounts from being selected for Codex model routes.
- [x] Refresh an expired Google OAuth access token during local enrollment without re-login.
- [ ] Replace the runtime Gemini transport only after llm-mesh ships the complete Antigravity transport contract.

## Scope

**Allowed Paths (implementation scope)**
  - `BRANCH.md`
  - `packages/h2a-runtime/src/index.ts`
  - `packages/h2a-runtime/src/llm-mesh.ts`
  - `packages/h2a-runtime/src/llm-mesh.test.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.test.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/proxy-anthropic.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/proxy-anthropic.test.ts`

**Forbidden Paths**
  - `packages/h2a-runtime/.test-scratch/**`
  - `.test-scratch/**`
  - `.cache/**`
  - `free-tmpfs-now.sh`
  - `apps/focus/src/routes/proposal/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`

**Conditional Paths**
  - `packages/h2a-runtime/src/llm-gateway-runtime/proxy-gemini.ts` — unchanged until the mesh replacement is available.

## Lot 1 — Google pool isolation

- [x] Add a distinct `google` account pool.
- [x] Map `google`, `gemini`, `gcp`, and `gemini-code-assist` only to that pool.
- [x] Reject a Codex model route bound to a Google session before network dispatch.
- [x] Preflight the local session provider before spawn; prefer Codex and never bind Google implicitly.
- [x] Test: `model-catalog.test.ts`.
- [x] Test: `proxy-anthropic.test.ts`.
- [x] Gate: Google never silently executes a Codex route.

## Lot 2 — Google OAuth refresh

- [x] Treat `expiresAt` as authoritative for opaque Google access tokens.
- [x] Use the official Gemini CLI OAuth client identity for the refresh-token grant.
- [x] Refresh during `llm-mesh enroll google` before persisting the account.
- [x] Keep refresh tokens provider-bound and exclude stale credentials from the gateway process.
- [x] Test: `llm-mesh.test.ts`.
- [x] Gate: live enrollment refreshes the existing credential without re-login.
- [x] Gate: `llm-mesh status` reports Codex and Google credentials as unexpired.

## Lot 3 — Verification and mesh sequencing

- [x] Keep `proxy-gemini.ts` present and unchanged.
- [x] Run focused unit tests for pool, refresh, guard, and existing Gemini translation.
- [x] Run the TypeScript build.
- [x] Run scoped runtime tests and final harness verification.
- [x] Obtain two-peer review consensus and reconcile every blocking finding.
- [ ] Open the micro-PR without publishing npm.

## Feedback Loop

- [ ] AWAITED: `claude:llm-mesh:e5f8b95941e9` delivers the complete Antigravity transport, project discovery, and Code Assist metadata contract.
- [x] Decision: h2a lands only non-breaking pool, refresh, and guard corrections before that dependency.
- [x] Escalation: report the sequencing dependency asynchronously to `claude:a2a-cli:d36d7390005e`; do not escalate it to the owner.
