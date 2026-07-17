# Feature: consume llm-gateway 0.9.0 and onboard Google/Gemini

## Scope

**Allowed Paths (implementation scope)**
  - `BRANCH.md`
  - `apps/llm-gateway/package.json`
  - `package-lock.json`
  - `packages/h2a-runtime/package.json`
  - `packages/h2a-runtime/src/index.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/proxy-anthropic.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/proxy-gemini.ts`
  - `packages/h2a-runtime/src/llm-gateway-runtime/proxy-gemini.test.ts`
  - `packages/h2a-runtime/src/llm-mesh.ts`

**Forbidden Paths**
  - `packages/h2a-runtime/.test-scratch/**`
  - `.test-scratch/**`
  - `.cache/**`
  - `free-tmpfs-now.sh`
  - `apps/focus/src/routes/proposal/**`
  - `packages/h2a-runtime/src/llm-gateway-runtime/flow-bridge.ts`
  - `apps/llm-gateway/src/app-flow-bridge.ts`
  - `.track/**`

**Conditional Paths**
  - None.

## Plan / TODO

- [x] **Lot 1 — Upgrade the gateway consumer**
  - [x] Consume `@sentropic/llm-gateway` `^0.9.0` in the gateway app and runtime.
  - [x] Refresh the lockfile.
- [x] **Lot 2 — Onboard Google/Gemini**
  - [x] Add CLI enrollment from Google Code Assist OAuth credentials.
  - [x] Add Google/Gemini provider routing and Anthropic-to-Gemini proxying with tests.
- [x] **Lot 3 — Verify and coordinate**
  - [x] Run runtime and app typechecks, `npm run build:h2a`, gateway tests, and the complete runtime suite.
  - [x] Reply to agy via h2a with the gateway 0.9 alignment and deferred-cut status.
  - [x] Defer the sticky/failover mutualization cut until the gateway ships the transport-claim attestation contract from agy's `feat/gw-session-routing`.
- [ ] **Lot 4 — Publish**
  - [ ] Commit the scoped integration, open and merge the pull request, then release the lockstep patch version.
